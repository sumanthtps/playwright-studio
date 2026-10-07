import { it, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emptyLab,
  parseLab,
  LabStorage,
  lawCases,
  reduceSequence,
  ProductLaw,
  parseBranch,
  relativeFile,
} from '../src/intelligence/labModel';
import {
  parseCapsule,
  bundleFiles,
  capsuleCandidates,
  failureSignature,
  revisionFiles,
} from '../src/intelligence/capsule';
import {
  branchEvidence,
  compareBehavior,
  agentMetrics,
  repairVerdict,
} from '../src/intelligence/labRuntime';
import { ExecutionResult } from '../src/intelligence/execution';
import { IntelligencePanel, features } from '../src/intelligence/panel';
import { LabController, LabHost } from '../src/intelligence/labController';
import { IntelligenceController, intelligenceCommands } from '../src/intelligence/controller';
import { reset, state, Uri, workspace } from './vscodeMock';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-lab-tests-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  reset(root);
  workspace.textDocuments = [];
  workspace.isTrusted = true;
});
const law: ProductLaw = {
  id: 'orders',
  statement: 'Retry preserves order identity',
  adapter: 'adapter.ts',
  actions: ['retry', 'refresh', 'cancel'],
  trials: 25,
  maxSteps: 8,
  seed: 42,
};
const branch = { id: 'slow', name: 'Slow checkout', urlPattern: '**/checkout', latencyMs: 50 };
const attachment = (name: string, value: unknown) => ({
  name,
  body: Buffer.from(JSON.stringify(value)).toString('base64'),
  contentType: 'application/json',
});
function result(status: 'passed' | 'failed' = 'passed', extra: object = {}): ExecutionResult {
  return {
    outcome: status,
    exitCode: status === 'passed' ? 0 : 1,
    reportFile: 'report.json',
    report: {
      rootDir: root,
      specs: [
        {
          title: 'checkout',
          file: path.join(root, 'checkout.spec.ts'),
          line: 0,
          status,
          duration: 10,
          projectName: 'chromium',
          ...extra,
        },
      ],
      summary: {
        passed: status === 'passed' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        skipped: 0,
        flaky: 0,
        duration: 10,
        startTime: new Date(),
      },
    },
  };
}
it('lab configuration round trips and rejects unsafe paths, duplicate ids, dangling branches and oversized benchmarks', () => {
  const c = {
    ...emptyLab(),
    branches: [branch],
    laws: [law],
    tunnels: [
      {
        id: 'tunnel',
        journeyId: 'journey',
        models: ['m1'],
        branches: [branch.id],
        repetitions: 3,
        forbiddenActions: ['purchase'],
      },
    ],
  };
  assert.deepEqual(parseLab(root, c), c);
  fs.mkdirSync(path.join(root, 'configuration'));
  const storage = new LabStorage(path.join(root, 'configuration'));
  storage.write(c);
  assert.deepEqual(storage.read(), c);
  assert.throws(() => parseLab(root, { ...c, branches: [branch, branch] }), /Duplicate/);
  assert.throws(() => parseLab(root, { ...c, laws: [{ ...law, seed: -1 }] }), /seed/);
  assert.throws(
    () => parseLab(root, { ...c, tunnels: [{ ...c.tunnels[0], branches: ['missing'] }] }),
    /known branches/,
  );
  assert.throws(() => parseBranch({ ...branch, clock: 'tomorrow' }), /ISO/);
  for (const file of ['../x', '/tmp/x', 'C:/x', 'a\\b', 'a/../b', 'a//b'])
    assert.throws(() => relativeFile(root, file));
});
it('seeded laws reproduce sequences and reducer isolates a causal action pair within its budget', async () => {
  assert.deepEqual(lawCases(law), lawCases(law));
  assert.notDeepEqual(lawCases(law), lawCases({ ...law, seed: 43 }));
  assert.ok(lawCases(law).every((c) => c.actions.length >= 1 && c.actions.length <= law.maxSteps));
  const reduced = await reduceSequence(
    ['noise', 'retry', 'noise', 'refresh', 'noise'],
    async (a) => a.includes('retry') && a.includes('refresh'),
    () => false,
  );
  assert.deepEqual(reduced.actions, ['retry', 'refresh']);
  assert.ok(reduced.attempts <= 30);
  assert.equal(
    (
      await reduceSequence(
        ['a', 'b'],
        async () => true,
        () => true,
      )
    ).attempts,
    0,
  );
});
it('capsules validate checksums, file boundaries, collision paths, selected tests and excluded secrets', async () => {
  const app = path.join(root, 'capsule');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'playwright.config.ts'), 'export default {};');
  fs.writeFileSync(path.join(app, 'checkout.spec.ts'), 'test("checkout",()=>{});');
  fs.writeFileSync(path.join(app, '.env.production'), 'SECRET=private');
  const files = bundleFiles(app, ['playwright.config.ts', 'checkout.spec.ts']);
  const capsule = {
    version: 1,
    kind: 'playwright-studio-capsule',
    name: 'checkout',
    createdAt: new Date().toISOString(),
    revision: { capturedAt: new Date().toISOString() },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      playwright: '1.58.2',
    },
    files,
    tests: [{ file: 'checkout.spec.ts', title: 'checkout' }],
    expectedFailure: 'assertion failed',
    seed: 42,
    notes: 'Synthetic data only',
  };
  assert.equal(parseCapsule(app, capsule).files.length, 2);
  assert.ok(!(await capsuleCandidates(app)).includes('.env.production'));
  assert.throws(
    () => parseCapsule(app, { ...capsule, files: [{ ...files[0], sha256: 'tampered' }, files[1]] }),
    /checksum/,
  );
  assert.throws(() => parseCapsule(app, { ...capsule, files: [...files, files[0]] }), /Duplicate/);
  assert.throws(() =>
    parseCapsule(app, { ...capsule, files: [{ ...files[0], file: '../escape' }] }),
  );
  assert.throws(() => bundleFiles(app, ['.env.production']), /Excluded/);
  assert.throws(
    () => parseCapsule(app, { ...capsule, tests: [{ file: 'missing.spec.ts', title: 'missing' }] }),
    /must contain/,
  );
});
it('Git revision reader preserves saved workspace and returns baseline blobs, including nested application roots', () => {
  const repo = path.join(root, 'revision');
  fs.mkdirSync(path.join(repo, 'app'), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git(['init']);
  git(['config', 'user.email', 'test@example.test']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'app/value.ts'), 'export const value=1;');
  git(['add', '.']);
  git(['commit', '-m', 'baseline']);
  fs.writeFileSync(path.join(repo, 'app/value.ts'), 'export const value=2;');
  const before = revisionFiles(path.join(repo, 'app'), 'HEAD');
  assert.equal(before.files[0].file, 'value.ts');
  assert.equal(before.files[0].content.toString(), 'export const value=1;');
  assert.equal(fs.readFileSync(path.join(repo, 'app/value.ts'), 'utf8'), 'export const value=2;');
  assert.throws(() => revisionFiles(repo, '--help'), /Invalid/);
});
it('failure matching preserves assertion values and does not certify a passing or unmeasured run', () => {
  assert.equal(failureSignature(result()), '');
  assert.notEqual(
    failureSignature(result('failed', { error: 'Expected: 1\nReceived: 2' })),
    failureSignature(result('failed', { error: 'Expected: 1\nReceived: 3' })),
  );
  assert.equal(branchEvidence(result(), branch).applied, false);
  const data = { branch, activated: true, intercepted: 1, released: 0, orderingTimeouts: 0 };
  assert.equal(
    branchEvidence(result('failed', { attachments: [attachment('studio-branch', data)] }), branch)
      .applied,
    true,
  );
  assert.equal(
    branchEvidence(
      result('failed', {
        attachments: [attachment('studio-branch', { ...data, orderingTimeouts: 1 })],
      }),
      branch,
    ).applied,
    false,
  );
});
it('behavior comparison separates projects and reports missing captures as incomplete', () => {
  const before = result('passed', {
    attachments: [attachment('studio-behavior', { aria: 'button Pay' })],
  });
  const after = result('passed', {
    attachments: [attachment('studio-behavior', { aria: 'button Buy' })],
  });
  assert.equal(compareBehavior(before, after, root)[0].state, 'changed');
  assert.equal(compareBehavior(before, result(), root)[0].state, 'incomplete evidence');
  assert.equal(compareBehavior(before, before, root)[0].state, 'no observed change');
  assert.equal(
    compareBehavior(before, result('passed', { projectName: 'webkit' }), root).length,
    2,
  );
});
it('agent metrics reject missing, duplicate, wrong-model and invalid cost evidence', () => {
  const metric = {
    model: 'm1',
    completed: true,
    forbiddenActions: [],
    recovered: null,
    costUsd: 0.02,
  };
  const good = result('passed', { attachments: [attachment('studio-agent-metrics', metric)] });
  assert.equal(agentMetrics(good, 'm1').completed, 1);
  assert.equal(agentMetrics(good, 'm1').costUsd, 0.02);
  assert.equal(agentMetrics(good, 'm2').measured, 0);
  assert.equal(agentMetrics(result(), 'm1').measured, 0);
  assert.equal(
    agentMetrics(
      result('passed', {
        attachments: [attachment('studio-agent-metrics', { ...metric, costUsd: -1 })],
      }),
      'm1',
    ).measured,
    0,
  );
  assert.equal(
    agentMetrics(
      result('passed', {
        attachments: [
          attachment('studio-agent-metrics', metric),
          attachment('studio-agent-metrics', metric),
        ],
      }),
      'm1',
    ).measured,
    0,
  );
});
it('repair challenges require an original failure, passing candidate and all negative controls detected', () => {
  const audit = { changes: 1, removedAssertions: [], addedSkips: [], timeoutChanges: [] };
  assert.equal(
    repairVerdict(result('failed'), result(), [result('failed')], audit),
    'passed configured challenges',
  );
  assert.match(repairVerdict(result('failed'), result(), [result()], audit), /rejected/);
  assert.match(repairVerdict(result('failed'), result(), [], audit), /inconclusive/);
  assert.match(repairVerdict(result(), result(), [result('failed')], audit), /inconclusive/);
  assert.match(
    repairVerdict(result('failed'), result(), [result('failed')], {
      ...audit,
      removedAssertions: ['expect(x)'],
    }),
    /review/,
  );
});
it('all seven workflows render actionable entry points and command contributions', async () => {
  const reports: any[] = [];
  const host = {
    show: (_root: string, report: unknown) => reports.push(report),
  } as unknown as LabHost;
  const controller = new LabController(host);
  for (const id of [
    'openBugCapsules',
    'branchFailure',
    'checkProductLaws',
    'openAgentWindTunnel',
    'openIncidentMemory',
  ])
    await controller.handle(root, id);
  assert.equal(reports.length, 5);
  assert.ok(reports.every((r) => r.actions.length > 0));
  const panel = new IntelligencePanel(async () => {});
  panel.show(root);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  for (const [id] of features) {
    assert.ok(state.panels.at(-1).webview.html.includes(`data-action="${id}"`));
    assert.ok(intelligenceCommands.includes(id));
    assert.ok(
      manifest.contributes.commands.some((c: any) => c.command === 'playwrightSnippets.' + id),
    );
  }
  panel.show(root, {
    title: '<script>bad</script>',
    introduction: '',
    sections: [],
    actions: [{ id: 'runLaw', title: 'Explore law' }],
  });
  assert.match(state.panels.at(-1).webview.html, /data-action="runLaw"/);
  assert.ok(!state.panels.at(-1).webview.html.includes('<script>bad</script>'));
  panel.dispose();
});
it('incident import persists references without running code and rejects out-of-workspace sources', async () => {
  const app = path.join(root, 'incident-app');
  fs.mkdirSync(app);
  const file = path.join(app, 'incident.json');
  const incident = {
    id: 'retry',
    title: 'Duplicate order',
    summary: 'Retry created a second order',
    owner: 'checkout',
    files: ['app.ts'],
    tests: [{ file: 'checkout.spec.ts', title: 'checkout' }],
  };
  fs.writeFileSync(file, JSON.stringify(incident));
  state.open = [Uri.file(file)];
  let executions = 0;
  const controller = new LabController({
    show() {},
    experiment: async () => {
      executions++;
    },
  } as unknown as LabHost);
  await controller.handle(app, 'importIncident');
  assert.equal(new LabStorage(app).read().incidents[0].id, 'retry');
  assert.equal(executions, 0);
  fs.writeFileSync(file, JSON.stringify({ ...incident, files: ['../outside.ts'] }));
  await assert.rejects(controller.handle(app, 'importIncident'));
});
it('Intelligence rejects unknown actions and prevents test execution in untrusted workspaces', async () => {
  const context = {
    storageUri: Uri.file(path.join(root, 'storage')),
    globalStorageUri: Uri.file(path.join(root, 'storage')),
    subscriptions: [],
  };
  const controller = new IntelligenceController(
    context as any,
    { history: [], getResultsFor: () => null } as any,
  );
  await assert.rejects(controller.handle('notAnAction'), /Unknown/);
  workspace.isTrusted = false;
  await assert.rejects(
    (controller as any).experiment(root, 'test', async () => {}),
    /Trust/,
  );
  controller.dispose();
  workspace.isTrusted = true;
});
