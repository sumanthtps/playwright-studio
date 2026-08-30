const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SNIPPETS_PATH = path.join(__dirname, '..', 'snippets', 'playwright.json');

let snippets;

describe('Snippets JSON', () => {
  it('file exists', () => {
    assert.ok(fs.existsSync(SNIPPETS_PATH), `snippets file not found at ${SNIPPETS_PATH}`);
  });

  it('is valid JSON', () => {
    const raw = fs.readFileSync(SNIPPETS_PATH, 'utf8');
    snippets = JSON.parse(raw);
  });

  it('is a non-empty object', () => {
    assert.equal(typeof snippets, 'object');
    assert.ok(!Array.isArray(snippets));
    assert.ok(Object.keys(snippets).length > 0, 'snippets file is empty');
  });
});

describe('Each snippet', () => {
  before(() => {
    const raw = fs.readFileSync(SNIPPETS_PATH, 'utf8');
    snippets = JSON.parse(raw);
  });

  it('has required fields: prefix, description, body', () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      assert.ok(snippet.prefix !== undefined, `"${name}" is missing "prefix"`);
      assert.ok(snippet.description !== undefined, `"${name}" is missing "description"`);
      assert.ok(snippet.body !== undefined, `"${name}" is missing "body"`);
    }
  });

  it('has non-empty body (string or array)', () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      const isString = typeof snippet.body === 'string' && snippet.body.length > 0;
      const isArray = Array.isArray(snippet.body) && snippet.body.length > 0;
      assert.ok(isString || isArray, `"${name}" body must be a non-empty string or array`);
    }
  });

  it('has string or array prefixes', () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      const valid =
        typeof snippet.prefix === 'string' ||
        (Array.isArray(snippet.prefix) && snippet.prefix.every((p) => typeof p === 'string'));
      assert.ok(valid, `"${name}" prefix must be a string or array of strings`);
    }
  });

  it('has non-empty description strings', () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      assert.equal(typeof snippet.description, 'string', `"${name}" description must be a string`);
      assert.ok(snippet.description.trim().length > 0, `"${name}" description is blank`);
    }
  });

  it('has no duplicate prefixes', () => {
    const seen = new Map();
    for (const [name, snippet] of Object.entries(snippets)) {
      const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
      for (const prefix of prefixes) {
        if (seen.has(prefix)) {
          assert.fail(`Duplicate prefix "${prefix}" found in "${name}" and "${seen.get(prefix)}"`);
        }
        seen.set(prefix, name);
      }
    }
  });

  it('body lines are all strings (when array)', () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      if (Array.isArray(snippet.body)) {
        for (const line of snippet.body) {
          assert.equal(typeof line, 'string', `"${name}" body contains a non-string line: ${JSON.stringify(line)}`);
        }
      }
    }
  });

  it('does not emit removed APIs or repository-specific helper symbols', () => {
    const bodies = Object.values(snippets)
      .flatMap((snippet) => Array.isArray(snippet.body) ? snippet.body : [snippet.body])
      .join('\n');
    for (const unsupported of [
      'page.accessibility.snapshot',
      'Timeout.$',
      'integrationTest(',
      'EnvironmentType.',
      'clickSelector(',
      'preciseClick(',
      'navigateToUrl(',
      'verifyPageURL(',
      'fillValueInControl(',
    ]) {
      assert.equal(bodies.includes(unsupported), false, `Unsupported snippet symbol: ${unsupported}`);
    }
  });
});
