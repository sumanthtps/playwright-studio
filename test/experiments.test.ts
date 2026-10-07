import { it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { ExperimentWorkspace, scenarioFixture } from '../src/intelligence/execution';
import {
  applyMutation,
  instrumentScenario,
  mutationCandidates,
} from '../src/intelligence/analysis';
import { parseReportJson } from '../src/resultParser';
const repo = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-experiment-tests-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let lastOutput = '';
const execute = (
  command: {
    executable: string;
    args: string[];
  },
  cwd: string,
  env: Record<string, string>,
): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    execFile(
      command.executable,
      command.args,
      { cwd, env: { ...process.env, ...env }, timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        lastOutput = stdout + stderr;
        if (!error) resolve(0);
        else if (typeof error.code === 'number') resolve(error.code);
        else if (error.killed) resolve(undefined);
        else reject(error);
      },
    );
  });
function fixture(name: string): string {
  const app = path.join(root, name);
  fs.mkdirSync(path.join(app, 'tests'), { recursive: true });
  fs.symlinkSync(
    path.join(repo, 'node_modules'),
    path.join(app, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(path.join(app, 'package.json'), '{"private":true}');
  fs.writeFileSync(
    path.join(app, 'playwright.config.ts'),
    "export default {testDir:'./tests',timeout:5000};",
  );
  fs.writeFileSync(
    path.join(app, 'app.ts'),
    'export function sum(a:number,b:number){return a+b;} export function unused(){return true;}',
  );
  fs.writeFileSync(
    path.join(app, 'tests/calc.spec.ts'),
    "import {test,expect} from '@playwright/test'; import {sum} from '../app'; test('total',()=>{expect(sum(3,2)).toBe(5);});",
  );
  return fs.realpathSync(app);
}
const refs = [{ file: 'tests/calc.spec.ts', title: 'total', titlePath: ['total'] }];
it('real Playwright detects a mutation, reports an unexercised survivor, and preserves the application', async () => {
  const app = fixture('mutation'),
    source = fs.readFileSync(path.join(app, 'app.ts'), 'utf8');
  const workspace = await ExperimentWorkspace.create(
    app,
    path.join(root, 'storage'),
    { executable: process.execPath, args: [cli, 'test'] },
    execute,
  );
  try {
    const baseline = await workspace.run('baseline', refs);
    assert.equal(baseline.outcome, 'passed', JSON.stringify(baseline) + lastOutput);
    assert.equal(baseline.report?.specs[0].attempts?.length, 1);
    assert.equal(baseline.report?.rootDir, app);
    const mutations = mutationCandidates({ file: 'app.ts', source });
    await workspace.write('app.ts', applyMutation(source, mutations[0]));
    const detected = await workspace.run('detect', refs);
    assert.equal(detected.outcome, 'failed', lastOutput);
    await workspace.write('app.ts', applyMutation(source, mutations[1]));
    assert.equal((await workspace.run('survivor', refs)).outcome, 'passed', lastOutput);
    assert.equal(fs.readFileSync(path.join(app, 'app.ts'), 'utf8'), source);
  } finally {
    await workspace.dispose();
  }
  assert.equal(fs.existsSync(workspace.root), false);
});
it('real repair checks preserve original failure, run three candidate attempts, and reject missing selections', async () => {
  const app = fixture('repair');
  const original = fs
    .readFileSync(path.join(app, 'tests/calc.spec.ts'), 'utf8')
    .replace('toBe(5)', 'toBe(7)');
  fs.writeFileSync(path.join(app, 'tests/calc.spec.ts'), original);
  const workspace = await ExperimentWorkspace.create(
    app,
    path.join(root, 'storage'),
    { executable: process.execPath, args: [cli, 'test'] },
    execute,
  );
  try {
    assert.equal((await workspace.run('original', refs)).outcome, 'failed', lastOutput);
    await workspace.write('tests/calc.spec.ts', original.replace('toBe(7)', 'toBe(5)'));
    const candidate = await workspace.run('candidate', refs, {}, 3);
    assert.equal(candidate.outcome, 'passed', lastOutput);
    assert.equal(candidate.report?.specs.length, 3);
    assert.equal(
      (await workspace.run('missing', [{ file: 'tests/calc.spec.ts', title: 'does not exist' }]))
        .outcome,
      'inconclusive',
    );
    assert.equal(fs.readFileSync(path.join(app, 'tests/calc.spec.ts'), 'utf8'), original);
  } finally {
    await workspace.dispose();
  }
});
it('real scenario fixtures extend a custom test base and attach actual interception counts', async () => {
  const app = fixture('scenario');
  // A deterministic browser adapter exercises fixture composition without requiring downloaded browsers.
  const source =
    "import { test as base, expect } from '@playwright/test'; const test=base.extend({context:async({},use)=>{await use({setOffline:async()=>{},route:async(_glob,handler)=>{await handler({fulfill:async()=>{},fallback:async()=>{}});}});}}); test('scenario',async()=>{expect(true).toBe(true);});";
  fs.writeFileSync(path.join(app, 'tests/scenario.spec.ts'), source);
  const workspace = await ExperimentWorkspace.create(
    app,
    path.join(root, 'storage'),
    { executable: process.execPath, args: [cli, 'test'] },
    execute,
  );
  try {
    await workspace.write('.studio-fixture.ts', scenarioFixture());
    await workspace.write(
      'tests/scenario.spec.ts',
      instrumentScenario({ file: 'tests/scenario.spec.ts', source }, '../.studio-fixture'),
    );
    const result = await workspace.run(
      'scenario',
      [{ file: 'tests/scenario.spec.ts', title: 'scenario' }],
      {
        PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify({
          name: 'failure',
          urlPattern: '**/api/**',
          latencyMs: 1,
          status: 503,
        }),
      },
    );
    assert.equal(result.outcome, 'passed', lastOutput);
    const attachment = result.report?.specs[0].attachments?.find(
      (a) => a.name === 'studio-scenario',
    );
    assert.ok(attachment?.body);
    assert.equal(
      JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')).intercepted,
      1,
    );
  } finally {
    await workspace.dispose();
  }
});
it('real capture reporter retains configured reporter output and captures workspace revision metadata', async () => {
  const app = fixture('reporter');
  const reportFile = path.join(app, 'captured.json');
  fs.writeFileSync(
    path.join(app, 'playwright.config.ts'),
    "export default {testDir:'./tests',reporter:[['junit',{outputFile:'junit.xml'}]]};",
  );
  const code = await execute({ executable: process.execPath, args: [cli, 'test'] }, app, {
    PW_TEST_REPORTER: path.join(repo, 'dist/captureReporter.js'),
    PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
  });
  assert.equal(code, 0, lastOutput);
  assert.ok(fs.existsSync(path.join(app, 'junit.xml')));
  const result = parseReportJson(fs.readFileSync(reportFile, 'utf8'), app)!;
  assert.equal(result.rootDir, app);
  assert.equal(result.evidence?.workspaceRoot, app);
  assert.ok(result.evidence?.capturedAt);
  assert.equal(result.specs[0].file, path.join(app, 'tests/calc.spec.ts'));
});
it('journey adapter receives shared task criteria and produces repeated outcomes', async () => {
  const app = fixture('journey');
  fs.writeFileSync(
    path.join(app, 'tests/journey.spec.ts'),
    "import {test,expect} from '@playwright/test';test('agent',()=>{const j=JSON.parse(process.env.PLAYWRIGHT_STUDIO_JOURNEY!);expect(j.successCriteria).toContain('done');expect(j.mode).toBe('agent');});",
  );
  const workspace = await ExperimentWorkspace.create(
    app,
    path.join(root, 'storage'),
    { executable: process.execPath, args: [cli, 'test'] },
    execute,
  );
  try {
    const result = await workspace.run(
      'agent',
      [{ file: 'tests/journey.spec.ts', title: 'agent' }],
      {
        PLAYWRIGHT_STUDIO_JOURNEY: JSON.stringify({
          mode: 'agent',
          model: 'fixture-v1',
          successCriteria: ['done'],
        }),
      },
      3,
    );
    assert.equal(result.outcome, 'passed', lastOutput);
    assert.equal(result.report?.specs.length, 3);
  } finally {
    await workspace.dispose();
  }
});

it('capture preserves projects, nested titles, retries, output, steps, annotations and attachments', async () => {
  const app = fixture('reporter-evidence');
  const reportFile = path.join(app, 'captured.json');
  fs.writeFileSync(
    path.join(app, 'playwright.config.ts'),
    "export default {testDir:'./tests',retries:1,projects:[{name:'desktop'},{name:'mobile'}],reporter:[['junit',{outputFile:'junit.xml'}]]};",
  );
  fs.writeFileSync(
    path.join(app, 'tests/calc.spec.ts'),
    `import {test,expect} from '@playwright/test';
test.describe('Checkout',()=>{
  test('recovers', {tag:'@smoke',annotation:{type:'issue',description:'demo-123'}}, async({},info)=>{
    console.log('captured output');
    await test.step('attach evidence',async()=>{
      await info.attach('details',{body:Buffer.from('safe fixture'),contentType:'text/plain'});
    });
    expect(info.retry).toBe(1);
  });
  test.skip('pending',()=>{});
});`,
  );
  const code = await execute({ executable: process.execPath, args: [cli, 'test'] }, app, {
    PW_TEST_REPORTER: path.join(repo, 'dist/captureReporter.js'),
    PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
  });
  assert.equal(code, 0, lastOutput);
  assert.ok(fs.existsSync(path.join(app, 'junit.xml')));
  const report = parseReportJson(fs.readFileSync(reportFile, 'utf8'), app)!;
  assert.equal(report.specs.length, 4);
  assert.equal(report.summary.flaky, 2);
  assert.equal(report.summary.skipped, 2);
  for (const project of ['desktop', 'mobile']) {
    const spec = report.specs.find(
      (item) => item.projectName === project && item.title === 'recovers',
    )!;
    assert.equal(spec.status, 'flaky');
    assert.deepEqual(spec.titlePath?.slice(-2), ['Checkout', 'recovers']);
    assert.ok(!spec.titlePath?.includes(project));
    assert.deepEqual(spec.tags, ['@smoke']);
    assert.ok(spec.annotations?.some((item) => item.description === 'demo-123'));
    assert.equal(spec.attempts?.length, 2);
    assert.equal(spec.attempts?.[0].status, 'failed');
    assert.equal(spec.attempts?.[1].status, 'passed');
    assert.match(spec.output!, /captured output/);
    assert.ok(spec.attempts?.[1].steps.some((step) => step.title === 'attach evidence'));
    assert.equal(Buffer.from(spec.attachments![0].body!, 'base64').toString(), 'safe fixture');
  }
});
