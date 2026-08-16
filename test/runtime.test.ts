import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegex, parseCommandLine } from '../src/commandLine';
import { extractFixtureDefinitions } from '../src/fixtureParser';
import { extractProjectNames } from '../src/projectParser';
import { hasJsonReporterText, injectJsonReporterText } from '../src/reporterConfig';
import { parseReportJson } from '../src/resultParser';

describe('structured command parsing', () => {
  it('keeps quoted arguments together without evaluating shell syntax', () => {
    assert.deepEqual(parseCommandLine('pnpm exec playwright test --config "e2e config.ts"'), {
      executable: 'pnpm',
      args: ['exec', 'playwright', 'test', '--config', 'e2e config.ts'],
    });
    assert.deepEqual(parseCommandLine('npx playwright test "$(touch /tmp/unsafe)"').args.at(-1),
      '$(touch /tmp/unsafe)');
    assert.equal(parseCommandLine('"C:\\Program Files\\nodejs\\npx.cmd" playwright test').executable,
      'C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('escapes Playwright regex filters literally', () => {
    assert.equal(escapeRegex('/repo/tests/total [draft].spec.ts'),
      '/repo/tests/total \\[draft\\]\\.spec\\.ts');
  });
});

describe('fixture parsing', () => {
  it('indexes every top-level fixture in an extend body', () => {
    const source = `
      export const test = base.extend<{ first: string; second: string }>({
        first: async ({ page }, use) => {
          await use(await page.title());
        },
        second: [async ({}, use) => {
          await use('value with } braces');
        }, { scope: 'worker' }],
      });
    `;
    assert.deepEqual(extractFixtureDefinitions(source).map(item => item.name), ['first', 'second']);
  });
});

describe('project parsing', () => {
  it('handles nested arrays and ignores nested name properties', () => {
    const source = `export default defineConfig({
      projects: [
        { name: 'chromium', use: { permissions: ['camera'], name: 'not-a-project' } },
        { name: "firefox", dependencies: ['setup'] },
      ],
    });`;
    assert.deepEqual(extractProjectNames(source), ['chromium', 'firefox']);
  });
});

describe('reporter config editing', () => {
  it('does not mistake comments or reporter options for the JSON reporter', () => {
    assert.equal(hasJsonReporterText(`export default {
      // reporter: [['json']],
      reporter: [['custom', { outputFile: 'json' }]],
    }`), false);
  });

  it('adds JSON to string, array, and missing reporter declarations', () => {
    assert.match(injectJsonReporterText(`export default { reporter: 'list' }`) ?? '',
      /reporter: \[\['list'\], \['json'\]\]/);
    assert.match(injectJsonReporterText(`export default { reporter: [['html']] }`) ?? '',
      /\['json'\]/);
    assert.match(injectJsonReporterText(`export default defineConfig({ use: {} })`) ?? '',
      /reporter: \[\['json'\]\]/);
    assert.match(injectJsonReporterText(`module.exports = { use: {} }`) ?? '',
      /reporter: \[\['json'\]\]/);
  });
});

describe('Playwright JSON result parsing', () => {
  it('keeps every project and uses all retry attempts', () => {
    const report = {
      config: { rootDir: '/repo' },
      suites: [{
        specs: [{
          title: 'works', file: 'tests/example.spec.ts', line: 5,
          tests: [
            {
              projectName: 'chromium', status: 'expected',
              results: [{ status: 'passed', duration: 10, attachments: [] }],
            },
            {
              projectName: 'firefox', status: 'unexpected',
              results: [
                { status: 'failed', duration: 20, error: { message: 'first' }, attachments: [] },
                {
                  status: 'timedOut', duration: 30, error: { message: 'final' },
                  attachments: [{ name: 'trace', path: 'artifacts/trace.zip' }],
                },
              ],
            },
          ],
        }],
      }],
      stats: {
        expected: 1, unexpected: 1, skipped: 0, flaky: 0,
        duration: 60, startTime: '2026-01-02T03:04:05.000Z',
      },
    };
    const parsed = parseReportJson(JSON.stringify(report), '/fallback');
    assert.ok(parsed);
    assert.equal(parsed.specs.length, 2);
    assert.equal(parsed.specs[1].status, 'timedOut');
    assert.equal(parsed.specs[1].duration, 50);
    assert.equal(parsed.specs[1].error, 'final');
    assert.equal(parsed.specs[1].traceFile, '/repo/artifacts/trace.zip');
  });
});
