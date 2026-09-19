// @ts-check
'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit').default;
const Debug = require('../lib/Debug');
const HadithMcp = require('../lib/HadithMcp');
const HadithMcpSkills = require('../lib/HadithMcpSkills');

const debug = Debug('hadithdb:Mcp');
const router = express.Router();
const MAX_MCP_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_MCP_RATE_LIMIT_PER_IP = 120;
const DEFAULT_MCP_LOG_RETENTION_DAYS = 30;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
  'https://claude.ai',
  'https://cursor.com',
  'https://vscode.dev',
  'https://mcpplaygroundonline.com',
  'https://www.mcpplaygroundonline.com'
]);
const JSON_RPC_ERRORS = Object.freeze({
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});
const AUDITABLE_RPC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
  'tools/call',
  'skills/list',
  'skills/get',
  'resources/read'
]);

function envPositiveInteger(name, fallback) {
  const value = Number.parseInt((process.env[name] || '').toString().trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function requestRateLimitIp(req) {
  return req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function safeRequestId(value) {
  value = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : crypto.randomUUID();
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch (err) {
    return '';
  }
}

function allowedOrigins() {
  const configured = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map(value => normalizedOrigin(value.trim())).filter(Boolean);
  const siteOrigin = normalizedOrigin(global.settings && global.settings.site && global.settings.site.url);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured, siteOrigin].filter(Boolean));
}

function logRetentionDays() {
  return envPositiveInteger('MCP_LOG_RETENTION_DAYS', DEFAULT_MCP_LOG_RETENTION_DAYS);
}

function auditableRpcMethod(req) {
  const method = req.body && typeof req.body.method === 'string' ? req.body.method : 'http';
  return AUDITABLE_RPC_METHODS.has(method) ? method : 'unknown';
}

function auditableToolName(req) {
  if (auditableRpcMethod(req) !== 'tools/call' || !req.body.params || typeof req.body.params.name !== 'string')
    return '-';
  return HadithMcp.TOOLS.some(tool => tool.name === req.body.params.name) ? req.body.params.name : 'unknown';
}

function protocolError(req, res, message) {
  res.locals.mcpOutcome = 'protocol_error';
  return res.status(400).json(jsonRpcError(req.body && req.body.id, JSON_RPC_ERRORS.INVALID_REQUEST, message));
}

const mcpRequestLimiter = rateLimit({
  windowMs: envPositiveInteger('MCP_RATE_LIMIT_WINDOW_MS', DEFAULT_MCP_RATE_LIMIT_WINDOW_MS),
  limit: envPositiveInteger('MCP_RATE_LIMIT_PER_IP', DEFAULT_MCP_RATE_LIMIT_PER_IP),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestRateLimitIp,
  handler(req, res) {
    res.locals.mcpOutcome = 'rate_limited';
    res.status(429).json({ error: 'Too many MCP requests. Please wait and try again.' });
  }
});

router.use(function identifyAndAuditMcpRequest(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.mcpRequestId = safeRequestId(req.get('x-request-id'));
  res.setHeader('X-Request-ID', req.mcpRequestId);
  res.on('finish', function () {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const rpcMethod = auditableRpcMethod(req);
    const toolName = auditableToolName(req);
    const outcome = res.locals.mcpOutcome || (res.statusCode < 400 ? 'success' : 'http_error');
    debug.info(`MCP request request_id=${req.mcpRequestId} method=${rpcMethod} tool=${toolName || '-'} status=${res.statusCode} latency_ms=${latencyMs.toFixed(1)} outcome=${outcome} retention_days=${logRetentionDays()}`);
  });
  next();
});

router.use(function validateOriginAndSetTransportHeaders(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    const normalized = normalizedOrigin(origin);
    if (!normalized || !allowedOrigins().has(normalized)) {
      res.locals.mcpOutcome = 'origin_rejected';
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
  }
  // The public edge owns CORS for /mcp. Keep Origin validation here for the
  // transport security contract, but do not emit a second CORS header set.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('MCP-Protocol-Version', HadithMcp.PROTOCOL_VERSION);
  next();
});

router.options('/', function (req, res) {
  res.sendStatus(204);
});

router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);
router.put('/', methodNotAllowed);
router.patch('/', methodNotAllowed);

router.post('/', mcpRequestLimiter, async function (req, res) {
  if (!req.is('application/json'))
    return res.status(415).json(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Content-Type must be application/json.'));
  const requestBytes = Buffer.byteLength(JSON.stringify(req.body || null), 'utf8');
  if (requestBytes > MAX_MCP_REQUEST_BYTES)
    return res.status(413).json(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'MCP request body is too large.'));

  const message = req.body;
  if (!validJsonRpcMessage(message))
    return res.status(400).json(jsonRpcError(message && message.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request.'));
  if (message.method === 'initialize') {
    if (!message.params || typeof message.params.protocolVersion !== 'string' || !message.params.protocolVersion.trim())
      return protocolError(req, res, 'initialize requires a protocolVersion.');
  } else {
    const protocolVersion = req.get('mcp-protocol-version');
    if (!protocolVersion)
      return protocolError(req, res, 'MCP-Protocol-Version header is required after initialization.');
    if (protocolVersion !== HadithMcp.PROTOCOL_VERSION)
      return protocolError(req, res, `Unsupported MCP protocol version: ${protocolVersion}.`);
  }
  if (message.id === undefined) {
    return res.sendStatus(202);
  }

  try {
    const result = await dispatch(message, req);
    if (result === undefined) {
      res.locals.mcpOutcome = 'method_not_found';
      return res.status(200).json(jsonRpcError(message.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${message.method}`));
    }
    if (result && result.isError)
      res.locals.mcpOutcome = 'tool_error';
    return res.status(200).json({ jsonrpc: '2.0', id: message.id, result });
  } catch (err) {
    const messageText = err && err.message ? err.message : 'MCP request failed.';
    const invalidParams = ['tools/call', 'skills/list', 'skills/get', 'resources/read'].includes(message.method);
    res.locals.mcpOutcome = invalidParams ? 'invalid_params' : 'internal_error';
    const logMethod = AUDITABLE_RPC_METHODS.has(message.method) ? message.method : 'unknown';
    if (invalidParams)
      debug(`MCP request rejected request_id=${req.mcpRequestId} method=${logMethod}`);
    else
      debug.error(`MCP request failed request_id=${req.mcpRequestId} method=${logMethod}`);
    return res.status(200).json(jsonRpcError(
      message.id,
      invalidParams ? JSON_RPC_ERRORS.INVALID_PARAMS : JSON_RPC_ERRORS.INTERNAL_ERROR,
      messageText
    ));
  }
});

function methodNotAllowed(req, res) {
  res.setHeader('Allow', 'POST, OPTIONS');
  res.status(405).json({ error: 'Method Not Allowed', message: 'This stateless MCP endpoint accepts POST requests.' });
}

function validJsonRpcMessage(message) {
  return Boolean(message && !Array.isArray(message) && typeof message === 'object' &&
    message.jsonrpc === '2.0' && typeof message.method === 'string' && message.method.length > 0);
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

async function dispatch(message, req) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: HadithMcp.PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        extensions: {
          'io.modelcontextprotocol/skills': {}
        }
      },
      serverInfo: { name: HadithMcp.SERVER_NAME, version: HadithMcp.SERVER_VERSION },
      instructions: 'For substantive Islamic topic or worship how-to questions, use research_islamic_topic to consult source reports and relevant shuruh before the first answer. For explanations of Quran ayahs, use research_quran_ayah to consult major available tafsirs, then derive concepts from those texts and research hadith and shuruh for those concepts in the same turn. Respect explicitly narrow requests. Research depth is independent of answer length; inspect coverage and distinguish direct tafsir from conceptual candidates. Use exact-reference lookup tools when a Quran or hadith citation is known. Use list_tafsirs to resolve uncertain tafsir names. For Quran listening requests, use get_quran_audio (default reciter: Juhani); resolve other reciters with list_quran_reciters. Audio URLs require client playback using the returned start/end timings. Use lookup_quran_page for Mushaf pages and source-based page overviews; list_quran_sections and lookup_quran_passage expose editorial headings and introductions, which must be distinguished from Quran text. Results are read-only source records; preserve grading attribution and distinguish exact hadith wording from broader parallel reports.'
    };
  }
  if (message.method === 'ping')
    return {};
  if (message.method === 'tools/list')
    return { tools: HadithMcp.TOOLS };
  if (message.method === 'skills/list')
    return HadithMcpSkills.listSkills(message.params || {});
  if (message.method === 'skills/get')
    return HadithMcpSkills.getSkill(message.params || {});
  if (message.method === 'resources/read')
    return HadithMcpSkills.readResource(message.params || {});
  if (message.method === 'tools/call') {
    const name = message.params && message.params.name;
    const args = (message.params && message.params.arguments) || {};
    if (typeof name !== 'string' || !HadithMcp.TOOLS.some(tool => tool.name === name))
      throw new Error(`Unknown tool: ${name || ''}`);
    HadithMcp.validateToolArguments(name, args);
    try {
      return await HadithMcp.callTool(name, args, { req });
    } catch (err) {
      const messageText = err && err.message ? err.message : 'HadithDB tool call failed.';
      return {
        isError: true,
        structuredContent: { error: messageText },
        content: [{ type: 'text', text: messageText }]
      };
    }
  }
  return undefined;
}

module.exports = router;
module.exports.dispatch = dispatch;
module.exports.jsonRpcError = jsonRpcError;
module.exports.validJsonRpcMessage = validJsonRpcMessage;
