// @ts-check
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit').default;
const Debug = require('../lib/Debug');
const HadithMcp = require('../lib/HadithMcp');

const debug = Debug('hadithdb:Mcp');
const router = express.Router();
const MAX_MCP_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_MCP_RATE_LIMIT_PER_IP = 120;
const JSON_RPC_ERRORS = Object.freeze({
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});

function envPositiveInteger(name, fallback) {
  const value = Number.parseInt((process.env[name] || '').toString().trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function requestRateLimitIp(req) {
  return req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

const mcpRequestLimiter = rateLimit({
  windowMs: envPositiveInteger('MCP_RATE_LIMIT_WINDOW_MS', DEFAULT_MCP_RATE_LIMIT_WINDOW_MS),
  limit: envPositiveInteger('MCP_RATE_LIMIT_PER_IP', DEFAULT_MCP_RATE_LIMIT_PER_IP),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestRateLimitIp,
  message: { error: 'Too many MCP requests. Please wait and try again.' }
});

router.use(function setMcpHeaders(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, MCP-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version');
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
  if (message.id === undefined) {
    if (message.method !== 'notifications/initialized' && message.method !== 'notifications/cancelled')
      debug(`ignored MCP notification method=${message.method}`);
    return res.sendStatus(202);
  }

  try {
    const result = await dispatch(message, req);
    if (result === undefined)
      return res.status(200).json(jsonRpcError(message.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${message.method}`));
    return res.status(200).json({ jsonrpc: '2.0', id: message.id, result });
  } catch (err) {
    const messageText = err && err.message ? err.message : 'MCP request failed.';
    const invalidParams = message.method === 'tools/call';
    if (invalidParams) {
      debug(`MCP ${message.method} rejected: ${messageText}`);
    } else {
      debug.error(`MCP ${message.method} failed: ${err && err.stack ? err.stack : messageText}`);
    }
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
      capabilities: { tools: {} },
      serverInfo: { name: HadithMcp.SERVER_NAME, version: HadithMcp.SERVER_VERSION },
      instructions: 'Use exact-reference lookup tools when a Quran or hadith citation is known. Use list_tafsirs to resolve uncertain tafsir names. Results are read-only source records; preserve grading attribution and distinguish exact hadith wording from broader parallel reports.'
    };
  }
  if (message.method === 'ping')
    return {};
  if (message.method === 'tools/list')
    return { tools: HadithMcp.TOOLS };
  if (message.method === 'tools/call') {
    const name = message.params && message.params.name;
    if (typeof name !== 'string' || !HadithMcp.TOOLS.some(tool => tool.name === name))
      throw new Error(`Unknown tool: ${name || ''}`);
    const args = (message.params && message.params.arguments) || {};
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
