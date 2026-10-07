import { it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emptyConfig,
  parseConfig,
  validateScenario,
  localFile,
  revisionEvidence,
  changedFiles,
} from '../src/intelligence/model';
import {
  indexSources,
  mutationCandidates,
  applyMutation,
  auditRepair,
  investigate,
  planImpact,
  promiseEvidence,
  instrumentScenario,
  matches,
} from '../src/intelligence/analysis';
import {
  classifyExecution,
  scenarioVariants,
  snapshotWorkspace,
} from '../src/intelligence/execution';
import { parseReportJson, TestResults } from '../src/resultParser';
import { RunRecord } from '../src/resultStore';
import { traceSummary } from '../src/intelligence/trace';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-intelligence-test-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const source = {
  file: 'app.ts',
  source:
    '// a + b; return true;\nconst label="a + b";\nexport function sum(a:number,b:number){return a+b;}\nexport function allowed(){return true;}',
};
const testSource = {
  file: 'app.spec.ts',
  source:
    "import {sum} from './app'; import {test, expect} from '@playwright/test'; test.describe('checkout',()=>{test('total',async({page})=>{await page.goto('/checkout'); await test.step('pay',async()=>{ await expect(page.getByRole('button')).toBeVisible(); }); expect(sum(1,2)).toBe(3);});});",
};
const report = (
  status: 'passed' | 'failed' | 'skipped' | 'flaky' = 'passed',
  time = 100,
): TestResults => ({
  rootDir: root,
  specs: [
    {
      title: 'total',
      titlePath: ['app.spec.ts', 'checkout', 'total'],
      file: path.join(root, 'app.spec.ts'),
      line: 0,
      status,
      duration: 200,
      projectName: 'chromium',
    },
  ],
  summary: {
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    skipped: status === 'skipped' ? 1 : 0,
    flaky: status === 'flaky' ? 1 : 0,
    duration: 200,
    startTime: new Date(time),
  },
});
const record = (r: TestResults): RunRecord => ({
  ...r,
  id: String(r.summary.startTime.getTime()),
  capturedAt: r.summary.startTime,
  workspaceRoot: root,
});
it('indexes semantic behaviors, nested suites, and transitive module relationships', () => {
  const index = indexSources([source, testSource]);
  assert.deepEqual(index.dependencies['app.spec.ts'], ['app.ts']);
  assert.deepEqual(index.tests[0].routes, ['/checkout']);
  assert.deepEqual(index.tests[0].roles, ['button']);
  assert.deepEqual(index.tests[0].titlePath, ['checkout', 'total']);
  assert.equal(index.tests[0].assertions.length, 2);
  assert.deepEqual(index.tests[0].steps, ['pay']);
});
it('AST mutations never modify examples or comments and reject stale offsets', () => {
  const mutants = mutationCandidates(source);
  assert.equal(mutants.length, 2);
  assert.match(applyMutation(source.source, mutants[0]), /return a-b/);
  assert.match(applyMutation(source.source, mutants[1]), /return false/);
  assert.throws(() => applyMutation('', mutants[0]), /changed/);
  assert.deepEqual(mutationCandidates(testSource), []);
});
it('repair audit flags deleted assertions, skips, only, and changed timeouts', () => {
  const audit = auditRepair(testSource, {
    file: testSource.file,
    source: "test.only('total',async()=>{test.skip();test.setTimeout(60000);});",
  });
  assert.equal(audit.removedAssertions.length, 2);
  assert.equal(audit.addedSkips.length, 2);
  assert.ok(audit.timeoutChanges.length);
});
it('scenario instrumentation changes real imports without rewriting strings or comments', () => {
  const input = {
    file: 'x.ts',
    source:
      "// import {test} from '@playwright/test';\nconst example=\"@playwright/test\";\nimport {test,expect} from '@playwright/test';",
  };
  const output = instrumentScenario(input, './fixture');
  assert.match(output, /from "\.\/fixture"/);
  assert.match(output, /const example="@playwright\/test"/);
  assert.match(output, /\/\/ import \{test\} from '@playwright\/test'/);
});
it('execution verdict requires selected tests and consistent successful exit; skips and errors never pass', () => {
  const refs = [{ file: 'app.spec.ts', title: 'total', project: 'chromium' }];
  assert.equal(classifyExecution(0, report(), refs, root).outcome, 'passed');
  assert.equal(classifyExecution(1, report('failed'), refs, root).outcome, 'failed');
  for (const [exit, r] of [
    [undefined, report()],
    [0, undefined],
    [0, report('skipped')],
    [0, report('flaky')],
    [2, report('failed')],
    [1, report()],
    [0, { ...report(), errors: ['config failed'] }],
  ] as [number | undefined, TestResults | undefined][])
    assert.equal(classifyExecution(exit, r, refs, root).outcome, 'inconclusive');
  assert.equal(
    classifyExecution(0, report(), [{ file: 'app.spec.ts', title: 'missing' }], root).outcome,
    'inconclusive',
  );
});
it('test matching separates duplicate names in different suites and projects', () => {
  const spec = report().specs[0];
  assert.equal(
    matches(spec, { file: 'app.spec.ts', title: 'total', titlePath: ['checkout', 'total'] }, root),
    true,
  );
  assert.equal(
    matches(spec, { file: 'app.spec.ts', title: 'total', titlePath: ['refund', 'total'] }, root),
    false,
  );
  assert.equal(
    matches(spec, { file: 'app.spec.ts', title: 'total', project: 'webkit' }, root),
    false,
  );
});
it('failure detective chooses only earlier passing runs in the same workspace and project', () => {
  const previous = record(report('passed', 10)),
    future = record(report('passed', 200));
  const foreign = { ...record(report('passed', 30)), rootDir: '/other' };
  const latest = report('failed', 100);
  latest.specs[0].error = 'Timeout 3000ms';
  const clusters = investigate(latest, [future, foreign, previous]);
  assert.equal(clusters[0].tests[0].passingBaseline?.run, '10');
  assert.match(clusters[0].tests[0].experiment, /one worker/);
});
it('impact plans rank transitively affected tests and state omitted coverage within the budget', () => {
  const other = { file: 'other.spec.ts', source: "test('other',async()=>{});" };
  const index = indexSources([source, testSource, other]);
  const plan = planImpact(index, ['app.ts'], [], [], root, { capturedAt: '' }, 35000, []);
  assert.equal(plan.selected.length, 1);
  assert.equal(plan.selected[0].title, 'total');
  assert.equal(plan.omitted[0].title, 'other');
  assert.ok(plan.estimatedMs <= plan.budgetMs);
  const tiny = planImpact(index, ['app.ts'], [], [], root, { capturedAt: '' }, 100, []);
  assert.equal(tiny.selected.length, 0);
  assert.equal(tiny.omitted.length, 2);
});
it('promise evidence cannot become supported from stale, skipped, unknown, or different-revision runs', () => {
  const promise = {
    id: 'billing',
    statement: 'Correct total',
    owner: 'team',
    priority: 'critical' as const,
    maxAgeDays: 1,
    tests: [{ file: 'app.spec.ts', title: 'total' }],
  };
  const current = { fingerprint: 'abc', capturedAt: new Date().toISOString() };
  const pass = { ...report(), evidence: current };
  assert.equal(
    promiseEvidence([promise], [record(pass)], root, current, 1000)[0].evidence[0].status,
    'supported',
  );
  assert.equal(
    promiseEvidence([promise], [record(pass)], root, current, 200000000)[0].evidence[0].status,
    'stale',
  );
  assert.equal(
    promiseEvidence([promise], [record(report())], root, current, 1000)[0].evidence[0].status,
    'different-or-unknown-revision',
  );
  assert.equal(
    promiseEvidence([promise], [record(report('failed'))], root, current, 1000)[0].evidence[0]
      .status,
    'failed',
  );
  assert.equal(
    promiseEvidence([promise], [record(report('skipped'))], root, current, 1000)[0].evidence[0]
      .status,
    'incomplete',
  );
});
it('config validation rejects traversal, duplicate ids, excessive repetitions, and invalid scenarios', () => {
  assert.throws(() => localFile(root, '../escape'), /escapes/);
  assert.throws(
    () =>
      validateScenario({ id: 'a', name: 'bad', urlPattern: '**', latencyMs: -1, offline: false }),
    /latency/,
  );
  assert.throws(
    () =>
      validateScenario({
        id: 'a',
        name: 'bad',
        urlPattern: '**',
        latencyMs: 0,
        offline: false,
        clock: '2030-01-01',
      }),
    /timezone/,
  );
  const config = emptyConfig();
  config.scenarios = [{ id: 'a', name: 'slow', urlPattern: '**', latencyMs: 1, offline: false }];
  config.scenarios.push(config.scenarios[0]);
  assert.throws(() => parseConfig(root, JSON.stringify(config)), /Duplicate/);
  config.scenarios = [];
  config.journeys = [
    {
      id: 'a',
      name: 'task',
      objective: 'task',
      successCriteria: ['done'],
      human: { file: 'a.spec.ts', title: 'a' },
      agent: { file: 'b.spec.ts', title: 'b' },
      model: 'test',
      repetitions: 99,
    },
  ];
  assert.throws(() => parseConfig(root, JSON.stringify(config)), /repetitions/);
});
it('scenario reduction removes one active condition per candidate', () => {
  const s = {
    id: 'a',
    name: 'stress',
    urlPattern: '**',
    latencyMs: 100,
    status: 503,
    offline: true,
    clock: '2030-01-01T00:00:00Z',
  };
  const variants = scenarioVariants(s);
  assert.equal(variants.length, 4);
  for (const v of variants)
    assert.equal(
      Object.keys(s).filter((key) => s[key as keyof typeof s] !== v[key as keyof typeof v]).length,
      1,
    );
});
it('report parser preserves attempt evidence, global errors, and workspace metadata', () => {
  const parsed = parseReportJson(
    JSON.stringify({
      config: {
        rootDir: path.join(root, 'tests'),
        metadata: {
          playwrightStudio: {
            workspaceRoot: root,
            revision: '123',
            capturedAt: '2030-01-01T00:00:00Z',
          },
        },
      },
      suites: [
        {
          specs: [
            {
              id: 'test-id',
              title: 'retry',
              file: 'retry.spec.ts',
              line: 1,
              tests: [
                {
                  status: 'flaky',
                  results: [
                    {
                      status: 'failed',
                      retry: 0,
                      duration: 2,
                      error: { message: 'first' },
                      steps: [{ title: 'click', duration: 1 }],
                      stdout: [{ text: 'log' }],
                    },
                    { status: 'passed', retry: 1, duration: 3 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [{ message: 'worker error' }],
    }),
    root,
  )!;
  assert.equal(parsed.rootDir, root);
  assert.equal(parsed.specs[0].file, path.join(root, 'tests/retry.spec.ts'));
  assert.equal(parsed.specs[0].attempts?.length, 2);
  assert.equal(parsed.specs[0].attempts?.[0].output, 'log');
  assert.equal(parsed.specs[0].attempts?.[0].steps[0].title, 'click');
  assert.equal(parsed.evidence?.revision, '123');
  assert.deepEqual(parsed.errors, ['worker error']);
});
it('snapshots preserve original sources and dependency links, and clean up when source links are unsafe', async () => {
  const application = fs.mkdtempSync(path.join(root, 'application-'));
  fs.writeFileSync(path.join(application, 'app.ts'), 'original');
  fs.mkdirSync(path.join(application, 'node_modules'));
  const snapshot = await snapshotWorkspace(application);
  try {
    fs.writeFileSync(path.join(snapshot, 'app.ts'), 'changed');
    assert.equal(fs.readFileSync(path.join(application, 'app.ts'), 'utf8'), 'original');
    assert.ok(fs.lstatSync(path.join(snapshot, 'node_modules')).isSymbolicLink());
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
  fs.symlinkSync(
    os.tmpdir(),
    path.join(application, 'external'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(snapshotWorkspace(application), /symlink/);
  assert.throws(() => localFile(application, 'external/escape'), /outside/);
});
it('revision fingerprints include dirty source content and nested Git path changes', () => {
  const repo = fs.mkdtempSync(path.join(root, 'git-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init');
  fs.mkdirSync(path.join(repo, 'app'));
  fs.writeFileSync(path.join(repo, 'app/a.ts'), 'one');
  git('add', '.');
  git(
    '-c',
    'user.name=Studio Test',
    '-c',
    'user.email=studio@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
  const clean = revisionEvidence(path.join(repo, 'app'));
  fs.writeFileSync(path.join(repo, 'app/a.ts'), 'two');
  const dirty = revisionEvidence(path.join(repo, 'app'));
  assert.equal(clean.dirty, false);
  assert.equal(dirty.dirty, true);
  assert.notEqual(clean.fingerprint, dirty.fingerprint);
  assert.deepEqual(changedFiles(path.join(repo, 'app')), ['a.ts']);
});
it('invalid or missing trace data produces an explicit evidence limitation', () => {
  const file = path.join(root, 'bad.zip');
  fs.writeFileSync(file, 'not a zip');
  assert.match(traceSummary(file).note!, /unavailable/);
  assert.match(traceSummary(path.join(root, 'missing')).note!, /unavailable/);
});
it('expected-failure annotations cannot certify a mutation baseline or product promise', () => {
  const r = report();
  r.specs[0].attempts = [{ retry: 0, status: 'failed', duration: 10, attachments: [], steps: [] }];
  assert.equal(
    classifyExecution(0, r, [{ file: 'app.spec.ts', title: 'total' }], root).outcome,
    'inconclusive',
  );
  const revision = { fingerprint: 'same', capturedAt: new Date().toISOString() };
  r.evidence = revision;
  const p = {
    id: 'a',
    statement: 'works',
    owner: 'team',
    priority: 'normal' as const,
    maxAgeDays: 1,
    tests: [{ file: 'app.spec.ts', title: 'total' }],
  };
  assert.equal(
    promiseEvidence([p], [record(r)], root, revision, 1000)[0].evidence[0].status,
    'incomplete',
  );
});
