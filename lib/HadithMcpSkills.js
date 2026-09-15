// @ts-check
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parseFrontMatter = require('front-matter');

const SKILLS_ROOT = path.join(__dirname, '..', 'skills');
const SKILL_AUTHORITY = 'hadithdb';
const SKILLS_PAGE_SIZE = 3;

function regularFiles(directory, relativeDirectory = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...regularFiles(absolutePath, relativePath));
    else if (entry.isFile())
      files.push(relativePath);
  }
  return files;
}

function resourceUri(skillName, relativePath) {
  const encodedPath = relativePath.split(path.sep).map(encodeURIComponent).join('/');
  return `skill://${SKILL_AUTHORITY}/${skillName}/${encodedPath}`;
}

function digest(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function loadCatalog() {
  const skills = [];
  const resources = new Map();
  const skillDirectories = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of skillDirectories) {
    const skillName = directory.name;
    const skillDirectory = path.join(SKILLS_ROOT, skillName);
    const skillPath = path.join(skillDirectory, 'SKILL.md');
    if (!fs.existsSync(skillPath))
      continue;

    const skillText = fs.readFileSync(skillPath, 'utf8');
    const parsed = parseFrontMatter(skillText);
    if (parsed.attributes.name !== skillName)
      throw new Error(`Skill directory '${skillName}' does not match its frontmatter name.`);
    if (typeof parsed.attributes.description !== 'string' || !parsed.attributes.description.trim())
      throw new Error(`Skill '${skillName}' must have a description.`);

    const manifestResources = regularFiles(skillDirectory).map(relativePath => {
      const absolutePath = path.join(skillDirectory, relativePath);
      const contents = fs.readFileSync(absolutePath);
      const uri = resourceUri(skillName, relativePath);
      resources.set(uri, {
        uri,
        mimeType: relativePath.endsWith('.md') ? 'text/markdown' : 'text/plain',
        text: contents.toString('utf8')
      });
      return { uri, digest: digest(contents) };
    });

    skills.push(Object.freeze({
      uri: resourceUri(skillName, 'SKILL.md'),
      frontmatter: parsed.attributes,
      resources: manifestResources
    }));
  }

  return { skills: Object.freeze(skills), resources };
}

const CATALOG = loadCatalog();

function catalogFingerprint() {
  return crypto.createHash('sha256').update(CATALOG.skills.map(skill => skill.uri).join('\n')).digest('hex').slice(0, 16);
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, o: offset, f: catalogFingerprint() }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 512)
    throw new Error('Invalid skills cursor.');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || !Number.isInteger(parsed.o) || parsed.o < 0 || parsed.o >= CATALOG.skills.length || parsed.f !== catalogFingerprint())
      throw new Error('Invalid skills cursor.');
    return parsed.o;
  } catch (err) {
    throw new Error('Invalid skills cursor.');
  }
}

function listSkills(params = {}) {
  if (!params || Array.isArray(params) || typeof params !== 'object')
    throw new Error('skills/list params must be an object.');
  const unknown = Object.keys(params).filter(key => key !== 'cursor');
  if (unknown.length)
    throw new Error(`Unknown skills/list argument: ${unknown[0]}.`);
  const offset = params.cursor === undefined ? 0 : decodeCursor(params.cursor);
  const skills = CATALOG.skills.slice(offset, offset + SKILLS_PAGE_SIZE);
  const nextOffset = offset + skills.length;
  return {
    skills,
    ...(nextOffset < CATALOG.skills.length ? { nextCursor: encodeCursor(nextOffset) } : {})
  };
}

function getSkill(params = {}) {
  if (!params || Array.isArray(params) || typeof params !== 'object')
    throw new Error('skills/get params must be an object.');
  if (typeof params.uri !== 'string' || !params.uri)
    throw new Error('skills/get requires a skill URI.');
  const skill = CATALOG.skills.find(entry => entry.uri === params.uri);
  if (!skill)
    throw new Error(`Unknown skill URI: ${params.uri}`);
  return { skill };
}

function readResource(params = {}) {
  if (!params || Array.isArray(params) || typeof params !== 'object')
    throw new Error('resources/read params must be an object.');
  if (typeof params.uri !== 'string' || !params.uri)
    throw new Error('resources/read requires a resource URI.');
  const resource = CATALOG.resources.get(params.uri);
  if (!resource)
    throw new Error(`Unknown skill resource URI: ${params.uri}`);
  return { contents: [resource] };
}

module.exports = {
  SKILLS_ROOT,
  SKILLS_PAGE_SIZE,
  getSkill,
  listSkills,
  readResource
};
