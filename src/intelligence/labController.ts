import { studioDirectory, studioFile, studioFiles } from '../studioStorage';
import { getResultsBaseDir } from '../resultsPath';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { IntelligenceReport } from './panel';
import { ExperimentWorkspace, ExecutionResult, sourceFiles, snapshotWorkspace } from './execution';
import {
  IntelligenceStorage,
  localFile,
  TestReference,
  changedFiles,
  revisionEvidence,
  digest,
} from './model';
import {
  auditRepair,
  indexSources,
  mutationCandidates,
  Mutation,
  referenceFor,
  matches,
} from './analysis';
import {
  LabStorage,
  LabConfig,
  BranchCondition,
  ProductLaw,
  parseIncident,
  lawCases,
  reduceSequence,
  LawCase,
} from './labModel';
import {
  bundleFiles,
  capsuleCandidates,
  failureSignature,
  parseCapsule,
  runtimeInfo,
  runtimeDifferences,
  revisionFiles,
} from './capsule';
import {
  installLabFixture,
  labFixture,
  lawSpec,
  lawAdapterTemplate,
  attachments,
  branchEvidence,
  compareBehavior,
  agentMetrics,
  runControl,
  repairVerdict,
} from './labRuntime';
import { TestResults } from '../resultParser';
import { readBoundedFile } from '../fileSecurity';
import { requireWorkspaceTrust } from '../security';

export const labActions = [
  'openBugCapsules',
  'branchFailure',
  'checkProductLaws',
  'openAgentWindTunnel',
  'challengeRepair',
  'showBehaviorDiff',
  'openIncidentMemory',
  'editLabConfig',
  'createBugCapsule',
  'importBugCapsule',
  'replayBugCapsule',
  'createBranch',
  'runBranch',
  'exportLabFixture',
  'createLaw',
  'runLaw',
  'exportLawRegression',
  'createTunnel',
  'runTunnel',
  'createIncident',
  'importIncident',
  'exportIncident',
  'runIncident',
] as const;
export interface LabHost {
  storageRoot?: string;
  show(root: string, report: IntelligenceReport): void;
  report(root: string, kind: string, report: IntelligenceReport, data: unknown): void;
  experiment<T>(
    root: string,
    title: string,
    work: (workspace: ExperimentWorkspace, cancelled: () => boolean) => Promise<T>,
  ): Promise<T>;
  chooseTests(
    root: string,
    many?: boolean,
    prompt?: string,
    supplied?: TestReference[],
  ): Promise<TestReference[] | undefined>;
  latest(root: string): TestResults | undefined;
  remember(result: ExecutionResult): void;
}
const action = (id: string, title: string) => ({ id, title });
const edit = action('editLabConfig', 'Edit lab configuration');
export class LabController {
  private capsule?: { root: string; file: string; hash: string };
  private regression?: { root: string; law: ProductLaw; sample: LawCase; file: string };
  constructor(private readonly host: LabHost) {}
  private get storageRoot(): string {
    return this.host.storageRoot ?? getResultsBaseDir();
  }
  private config(root: string): LabConfig {
    return new LabStorage(root, this.storageRoot).read();
  }
  private update(root: string, work: (config: LabConfig) => void): void {
    const storage = new LabStorage(root, this.storageRoot);
    if (vscode.workspace.textDocuments?.some((d) => d.isDirty && d.uri.fsPath === storage.file))
      throw new Error('Save lab.json before updating it.');
    const config = storage.read();
    work(config);
    storage.write(config);
  }
  private async open(file: string): Promise<void> {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  }
  private async pick<T extends { id: string }>(
    values: T[],
    label: (value: T) => string,
    prompt: string,
  ): Promise<T | undefined> {
    if (!values.length) throw new Error('Add an entry with the dashboard action first.');
    return (
      await vscode.window.showQuickPick(
        values.map((value) => ({ label: label(value), description: value.id, value })),
        { placeHolder: prompt },
      )
    )?.value;
  }
  async handle(root: string, id: string): Promise<void> {
    requireWorkspaceTrust();
    switch (id) {
      case 'openBugCapsules':
        this.capsules(root);
        break;
      case 'createBugCapsule':
        await this.capture(root);
        break;
      case 'importBugCapsule':
        await this.importCapsule(root);
        break;
      case 'replayBugCapsule':
        await this.replay(root);
        break;
      case 'branchFailure':
        this.branches(root);
        break;
      case 'createBranch':
        await this.createBranch(root);
        break;
      case 'runBranch':
        await this.runBranch(root);
        break;
      case 'exportLabFixture':
        await this.exportFixture(root);
        break;
      case 'checkProductLaws':
        this.laws(root);
        break;
      case 'createLaw':
        await this.createLaw(root);
        break;
      case 'runLaw':
        await this.runLaw(root);
        break;
      case 'exportLawRegression':
        await this.exportRegression(root);
        break;
      case 'openAgentWindTunnel':
        this.tunnels(root);
        break;
      case 'createTunnel':
        await this.createTunnel(root);
        break;
      case 'runTunnel':
        await this.runTunnel(root);
        break;
      case 'challengeRepair':
        await this.challenge(root);
        break;
      case 'showBehaviorDiff':
        await this.behaviorDiff(root);
        break;
      case 'openIncidentMemory':
        this.incidents(root);
        break;
      case 'createIncident':
        await this.createIncident(root);
        break;
      case 'importIncident':
        await this.importIncident(root);
        break;
      case 'exportIncident':
        await this.exportIncident(root);
        break;
      case 'runIncident':
        await this.runIncident(root);
        break;
      case 'editLabConfig': {
        const storage = new LabStorage(root, this.storageRoot);
        if (!fs.existsSync(storage.file)) storage.write(storage.read());
        await this.open(storage.file);
        break;
      }
      default:
        throw new Error('Unknown lab action.');
    }
  }
  private capsules(root: string): void {
    this.host.show(root, {
      title: 'Bug Capsules',
      introduction:
        'Capture a failure using reviewed source files, then replay that exact bundle in a disposable application copy.',
      actions: [
        action('createBugCapsule', 'Capture failure'),
        action('importBugCapsule', 'Open capsule'),
      ],
      sections: [
        {
          title: 'Reproduction contract',
          text: 'The bundle contains checksummed sources, selected tests, runtime versions, dependency lock fingerprint, a synthetic seed, and an optional branch recipe. Backend resets and HAR fixtures must be implemented by your tests. Review selected files before exporting; automatic exclusions do not detect every secret.',
        },
      ],
    });
  }
  private async capture(root: string): Promise<void> {
    const latest = this.host.latest(root);
    const failed = latest?.specs
      .filter((s) => ['failed', 'timedOut'].includes(s.status))
      .map((s) => referenceFor(s, root));
    const refs = await this.host.chooseTests(
      root,
      true,
      'Select the failure to package',
      failed?.length ? failed : undefined,
    );
    if (!refs) return;
    const files = await capsuleCandidates(root);
    const selected = await vscode.window.showQuickPick(
      files.map((file) => ({
        label: file,
        picked: /(?:\.[cm]?[jt]sx?|\.json|\.html|\.css|\.ya?ml)$/.test(file),
      })),
      {
        canPickMany: true,
        placeHolder:
          'Review capsule contents; include config, lockfile, server, fixtures and assets needed to reproduce',
      },
    );
    if (!selected?.length) return;
    const branches = this.config(root).branches;
    const branchChoice = await vscode.window.showQuickPick(
      [
        { label: 'No branch', branch: undefined as BranchCondition | undefined },
        ...branches.map((branch) => ({ label: branch.name, branch })),
      ],
      { placeHolder: 'Optional reproduction condition' },
    );
    if (!branchChoice) return;
    const name = await vscode.window.showInputBox({ prompt: 'Capsule name', value: refs[0].title });
    if (!name?.trim()) return;
    const notes = await vscode.window.showInputBox({
      prompt: 'Backend reset / fixture prerequisites',
      value: 'Tests own their data reset. Seed is available as PLAYWRIGHT_STUDIO_SEED.',
    });
    if (!notes?.trim()) return;
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(root, `failure-${Date.now()}.capsule.json`)),
      filters: { 'Bug capsule': ['json'] },
    });
    if (!destination) return;
    const bundle = bundleFiles(
      root,
      selected.map((s) => s.label),
    );
    const seed = 42,
      branch = branchChoice.branch;
    // Validate the portable manifest before executing; placeholder signature is replaced after reproduction.
    const capsule = parseCapsule(root, {
      version: 1,
      kind: 'playwright-studio-capsule',
      name,
      createdAt: new Date().toISOString(),
      revision: revisionEvidence(root),
      runtime: runtimeInfo(root),
      tests: refs,
      files: bundle,
      expectedFailure: 'pending',
      seed,
      notes,
      branch,
    });
    const result = await this.host.experiment(
      root,
      'Capture portable failure',
      async (workspace) => {
        await workspace.replaceSources(
          bundle.map((f) => ({ file: f.file, content: Buffer.from(f.content, 'base64') })),
        );
        if (branch) await installLabFixture(workspace);
        return workspace.run('Reproduce reviewed capsule sources', refs, {
          PLAYWRIGHT_STUDIO_SEED: String(seed),
          ...(branch ? { PLAYWRIGHT_STUDIO_BRANCH: JSON.stringify(branch) } : {}),
        });
      },
    );
    if (!failureSignature(result) || (branch && !branchEvidence(result, branch).applied)) {
      this.host.report(
        root,
        'capsule-capture',
        {
          title: 'Bug Capsules',
          introduction:
            'Capsule not exported: the reviewed bundle did not reproduce a supported failure.',
          sections: [{ title: 'Capture evidence', details: result }],
        },
        result,
      );
      return;
    }
    capsule.expectedFailure = failureSignature(result);
    fs.writeFileSync(destination.fsPath, JSON.stringify(capsule, null, 2) + '\n');
    this.capsule = {
      root,
      file: destination.fsPath,
      hash: digest(fs.readFileSync(destination.fsPath)),
    };
    this.host.report(
      root,
      'capsule-capture',
      {
        title: 'Bug Capsules',
        introduction: `Captured ${name} with ${bundle.length} checksummed files.`,
        actions: [
          action('replayBugCapsule', 'Reproduce capsule'),
          action('importBugCapsule', 'Open another capsule'),
        ],
        sections: [
          {
            title: 'Bundle',
            text: destination.fsPath,
            details: { files: bundle.map((f) => f.file), runtime: capsule.runtime, notes },
          },
          { title: 'Observed failure', details: result },
        ],
      },
      { capsuleFile: destination.fsPath, capsuleHash: this.capsule.hash, result },
    );
  }
  private async importCapsule(root: string): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Bug capsule': ['json'] },
    });
    if (!files?.length) return;
    const bytes = readBoundedFile(files[0].fsPath, 48 * 1024 * 1024);
    const capsule = parseCapsule(root, JSON.parse(bytes.toString('utf8')));
    this.capsule = { root, file: files[0].fsPath, hash: digest(bytes) };
    this.host.show(root, {
      title: 'Bug Capsules',
      introduction: `${capsule.name}: review the imported application before executing its tests.`,
      actions: [action('replayBugCapsule', 'Reproduce imported sources')],
      sections: [
        {
          title: 'Sources and prerequisites',
          details: {
            files: capsule.files.map((f) => f.file),
            tests: capsule.tests,
            notes: capsule.notes,
            branch: capsule.branch,
            runtime: capsule.runtime,
            differences: runtimeDifferences(capsule.runtime, runtimeInfo(root)),
          },
          text: 'Open the capsule JSON to inspect source contents. Reproduce executes imported tests and server commands in an isolated copy; installed workspace dependencies are reused.',
        },
      ],
    });
    await this.open(files[0].fsPath);
  }
  private async replay(root: string): Promise<void> {
    if (!this.capsule || this.capsule.root !== root)
      throw new Error('Open or capture a capsule first.');
    const bytes = readBoundedFile(this.capsule.file, 48 * 1024 * 1024);
    if (digest(bytes) !== this.capsule.hash)
      throw new Error('Capsule changed. Open it again before reproducing.');
    const capsule = parseCapsule(root, JSON.parse(bytes.toString('utf8'))),
      differences = runtimeDifferences(capsule.runtime, runtimeInfo(root));
    const result = await this.host.experiment(root, 'Replay bug capsule', async (workspace) => {
      await workspace.replaceSources(
        capsule.files.map((f) => ({ file: f.file, content: Buffer.from(f.content, 'base64') })),
      );
      if (capsule.branch) await installLabFixture(workspace);
      return workspace.run('Capsule reproduction', capsule.tests, {
        PLAYWRIGHT_STUDIO_SEED: String(capsule.seed),
        ...(capsule.branch ? { PLAYWRIGHT_STUDIO_BRANCH: JSON.stringify(capsule.branch) } : {}),
      });
    });
    const reproduced =
      failureSignature(result) === capsule.expectedFailure &&
      (!capsule.branch || branchEvidence(result, capsule.branch).applied);
    this.host.report(
      root,
      'capsule-replay',
      {
        title: 'Bug Capsules',
        introduction: reproduced
          ? `Failure signature reproduced${differences.length ? '; runtime parity is unverified' : ' with matching recorded runtime'}.`
          : 'The captured failure was not reproduced.',
        sections: [
          { title: 'Runtime differences', details: differences },
          { title: 'Reproduction', details: result },
        ],
      },
      {
        capsuleHash: this.capsule.hash,
        capturedRevision: capsule.revision,
        reproduced,
        differences,
        result,
      },
    );
  }
  private branches(root: string): void {
    this.host.show(root, {
      title: 'Branch the Failure',
      introduction:
        'Replay setup from the beginning, then change conditions at a named checkpoint. Hold one request until a second response has arrived.',
      actions: [
        action('createBranch', 'Add branch'),
        action('runBranch', 'Run comparison'),
        action('exportLabFixture', 'Export checkpoint fixture'),
        edit,
      ],
      sections: [
        {
          title: 'Branches',
          columns: ['Name', 'Checkpoint', 'Request', 'Condition'],
          rows: this.config(root).branches.map((b) => [
            b.name,
            b.checkpoint ?? 'Before journey',
            b.urlPattern,
            b.releaseAfter
              ? `Release after response containing ${b.releaseAfter}`
              : JSON.stringify(b),
          ]),
        },
        {
          title: 'Checkpoints',
          text: 'Use await studio.checkpoint("before payment") from the exported fixture. Leave checkpoint empty to apply before the journey. This is a controlled replay, not restoration of backend state from a trace.',
        },
      ],
    });
  }
  private async createBranch(root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Branch name' });
    if (!name?.trim()) return;
    const checkpoint = await vscode.window.showInputBox({
      prompt: 'Checkpoint name (empty applies before the journey)',
      value: '',
    });
    if (checkpoint === undefined) return;
    const urlPattern = await vscode.window.showInputBox({
      prompt: 'Request glob to change',
      value: '**/api/**',
    });
    if (!urlPattern?.trim()) return;
    const kind = await vscode.window.showQuickPick([
      'Delay response',
      'HTTP error',
      'Response ordering',
      'Go offline',
      'Expire cookies',
      'Change browser time',
      'Misleading page content',
    ]);
    if (!kind) return;
    const branch: BranchCondition = {
      id: randomUUID(),
      name,
      urlPattern,
      latencyMs: 0,
      ...(checkpoint.trim() ? { checkpoint } : {}),
    };
    if (kind === 'Go offline') branch.offline = true;
    else if (kind === 'Expire cookies') branch.clearCookies = true;
    else {
      const value = await vscode.window.showInputBox({
        prompt:
          kind === 'Misleading page content'
            ? 'Synthetic page text to test whether the agent follows untrusted instructions'
            : kind === 'Response ordering'
              ? 'Release after a response URL contains (use a different request)'
              : kind === 'Change browser time'
                ? 'ISO browser time with timezone'
                : kind === 'HTTP error'
                  ? 'HTTP status (400–599)'
                  : 'Latency in milliseconds (1–30000)',
        value: kind === 'HTTP error' ? '503' : kind === 'Delay response' ? '500' : '',
      });
      if (!value?.trim()) return;
      if (kind === 'Response ordering') branch.releaseAfter = value;
      else if (kind === 'Misleading page content') branch.pageText = value;
      else if (kind === 'Change browser time') branch.clock = value;
      else if (kind === 'HTTP error') {
        branch.status = Number(value);
        if (branch.status < 400) throw new Error('Choose an HTTP error status.');
      } else branch.latencyMs = Number(value);
    }
    this.update(root, (c) => c.branches.push(branch));
    this.branches(root);
  }
  private async runBranch(root: string): Promise<void> {
    const branch = await this.pick(this.config(root).branches, (b) => b.name, 'Select branch');
    if (!branch) return;
    const refs = await this.host.chooseTests(root);
    if (!refs) return;
    const evidence = await this.host.experiment(
      root,
      'Branch the failure',
      async (workspace, cancelled) => {
        await installLabFixture(workspace);
        const baseline = await workspace.run('Original conditions', refs);
        const result =
          !cancelled() && baseline.outcome !== 'inconclusive'
            ? await workspace.run(branch.name, refs, {
                PLAYWRIGHT_STUDIO_BRANCH: JSON.stringify(branch),
              })
            : undefined;
        return {
          branch,
          baseline,
          result,
          application: result ? branchEvidence(result, branch) : undefined,
          cancelled: cancelled(),
        };
      },
    );
    this.host.report(
      root,
      'branch',
      {
        title: 'Branch the Failure',
        introduction: `Original: ${evidence.baseline.outcome}. Branch: ${evidence.result?.outcome ?? 'not run'}. ${evidence.application?.reason ?? ''}`,
        actions: [
          action('runBranch', 'Run another comparison'),
          action('createBugCapsule', 'Capture as capsule'),
        ],
        sections: [{ title: 'Comparison evidence', details: evidence }],
      },
      evidence,
    );
  }
  private async exportFixture(root: string): Promise<void> {
    const file = studioFile(root, `lab-fixture-${randomUUID()}.ts`, this.storageRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, labFixture(), { flag: 'wx' });
    await this.open(file);
  }
  private laws(root: string): void {
    this.host.show(root, {
      title: 'Product Laws',
      introduction:
        'Run independently implemented invariants across deterministic action sequences. Reduce a reproduced failure and export a regular Playwright regression.',
      actions: [
        action('createLaw', 'Add law and adapter'),
        action('runLaw', 'Explore law'),
        ...(this.regression?.root === root
          ? [action('exportLawRegression', 'Export last regression')]
          : []),
        edit,
      ],
      sections: [
        {
          title: 'Configured laws',
          columns: ['Law', 'Adapter', 'Trials', 'Max steps', 'Seed'],
          rows: this.config(root).laws.map((l) => [
            l.statement,
            l.adapter,
            l.trials,
            l.maxSteps,
            l.seed,
          ]),
        },
        {
          title: 'Adapter contract',
          text: 'Export setup(fixtures, seed), actions, check(state), and cleanup(state). setup resets test data for each trial; check independently asserts the product law. Studio records a seed and the action sequence; it cannot infer your business rules.',
        },
      ],
    });
  }
  private async createLaw(root: string): Promise<void> {
    const statement = await vscode.window.showInputBox({
      prompt: 'Invariant that must remain true after every action',
    });
    if (!statement?.trim()) return;
    const names = await vscode.window.showInputBox({
      prompt: 'Action names, separated by commas',
      value: 'retry, refresh',
    });
    if (!names?.trim()) return;
    const actions = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const id = randomUUID(),
      adapter = `.playwright-studio/law-${id}.ts`;
    const file = studioFile(root, path.posix.basename(adapter), this.storageRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const template = lawAdapterTemplate().replace(
      /export const actions:[\s\S]*?\n};/,
      `export const actions:Record<string,(state:any)=>Promise<void>>={\n${actions.map((a) => `  ${JSON.stringify(a)}:async(state)=>{throw new Error(${JSON.stringify('Implement action ' + a)});},`).join('\n')}\n};`,
    );
    this.update(root, (c) =>
      c.laws.push({ id, statement, adapter, actions, trials: 50, maxSteps: 10, seed: 42 }),
    );
    fs.writeFileSync(file, template, { flag: 'wx' });
    this.laws(root);
    await this.open(file);
  }
  private async runLaw(root: string): Promise<void> {
    const law = await this.pick(this.config(root).laws, (l) => l.statement, 'Select product law');
    if (!law) return;
    const adapterFile = law.adapter.startsWith('.playwright-studio/')
      ? studioFile(root, law.adapter.slice('.playwright-studio/'.length), this.storageRoot)
      : localFile(root, law.adapter);
    if (!fs.existsSync(adapterFile)) throw new Error('Implement the configured law adapter first.');
    const refs = await this.host.chooseTests(
      root,
      false,
      'Choose a test directory/project for the generated law runner',
    );
    if (!refs) return;
    const file = path.posix.join(
      path.posix.dirname(refs[0].file),
      `studio-law-${randomUUID()}.spec.ts`,
    );
    let adapter = path.posix.relative(path.posix.dirname(file), law.adapter);
    if (!adapter.startsWith('.')) adapter = './' + adapter;
    const test = { file, title: 'Product law: ' + law.id, project: refs[0].project };
    const evidence = await this.host.experiment(
      root,
      'Explore product law',
      async (workspace, cancelled) => {
        for (const entry of studioFiles(studioDirectory(root, this.storageRoot))) {
          await workspace.write(
            path.posix.join('.playwright-studio', entry.relative.replace(/\\/g, '/')),
            entry.content,
          );
        }
        await workspace.write(file, lawSpec(adapter, law, lawCases(law)));
        const exploration = await workspace.run(law.statement, [test]);
        const failed = attachments(exploration, 'studio-law-failure')[0] as
          { seed: number; actions: string[]; attempted?: string } | undefined;
        const runs: ExecutionResult[] = [];
        let sample: LawCase | undefined;
        if (exploration.outcome === 'failed' && failed && Array.isArray(failed.actions)) {
          sample = {
            seed: failed.seed,
            actions: [...failed.actions, ...(failed.attempted ? [failed.attempted] : [])],
          };
          const reproduce = await workspace.run('Reproduce law counterexample', [test], {
            PLAYWRIGHT_STUDIO_LAW_CASE: JSON.stringify(sample),
          });
          runs.push(reproduce);
          if (
            failureSignature(reproduce) &&
            failureSignature(reproduce) === failureSignature(exploration)
          ) {
            const reduced = await reduceSequence(
              sample.actions,
              async (actions) => {
                const result = await workspace.run('Reduce law counterexample', [test], {
                  PLAYWRIGHT_STUDIO_LAW_CASE: JSON.stringify({ seed: failed.seed, actions }),
                });
                runs.push(result);
                return failureSignature(result) === failureSignature(reproduce);
              },
              cancelled,
            );
            sample = { seed: failed.seed, actions: reduced.actions };
          } else sample = undefined;
        }
        return { law, exploration, sample, reductions: runs, cancelled: cancelled() };
      },
    );
    this.regression = evidence.sample ? { root, law, sample: evidence.sample, file } : undefined;
    const measured = attachments(evidence.exploration, 'studio-law-summary').length > 0;
    this.host.report(
      root,
      'law',
      {
        title: 'Product Laws',
        introduction: evidence.sample
          ? 'Reproduced a counterexample; a reduced regression is ready to export.'
          : evidence.exploration.outcome === 'passed' && measured
            ? `${law.trials} seeded trials passed.`
            : 'Law exploration is inconclusive or did not produce a reproducible counterexample.',
        actions: [
          ...(evidence.sample ? [action('exportLawRegression', 'Export regression')] : []),
          action('runLaw', 'Explore another law'),
        ],
        sections: [
          {
            title: 'Law evidence',
            details: evidence,
            text: 'Reduction is bounded to 30 attempts. Replaying a seed requires deterministic setup and action adapters.',
          },
        ],
      },
      evidence,
    );
  }
  private async exportRegression(root: string): Promise<void> {
    const r = this.regression;
    if (!r || r.root !== root) throw new Error('Run a law with a reproducible failure first.');
    let adapter = path.posix.relative(path.posix.dirname(r.file), r.law.adapter);
    if (!adapter.startsWith('.')) adapter = './' + adapter;
    // Preserve relative adapter imports and dependencies in a local project copy.
    const local = studioDirectory(root, this.storageRoot);
    const exported = await snapshotWorkspace(root, path.join(path.dirname(local), 'exports'));
    try {
      for (const entry of studioFiles(local)) {
        const target = localFile(exported, path.join('.playwright-studio', entry.relative));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.content, { flag: 'wx' });
      }
      const file = localFile(exported, r.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, lawSpec(adapter, r.law, [r.sample]), { flag: 'wx' });
      await this.open(file);
    } catch (error) {
      fs.rmSync(exported, { recursive: true, force: true });
      throw error;
    }
  }
  private tunnels(root: string): void {
    this.host.show(root, {
      title: 'Agent Wind Tunnel',
      introduction:
        'Run the configured agent journey across model labels, branch conditions and repeated attempts. Missing adapter metrics remain unknown.',
      actions: [
        action('createTunnel', 'Add benchmark'),
        action('runTunnel', 'Run wind tunnel'),
        edit,
      ],
      sections: [
        {
          title: 'Benchmarks',
          columns: ['ID', 'Journey', 'Models', 'Branches', 'Repetitions'],
          rows: this.config(root).tunnels.map((t) => [
            t.id,
            t.journeyId,
            t.models.join(', '),
            t.branches.join(', '),
            t.repetitions,
          ]),
        },
        {
          title: 'Measured adapter contract',
          text: 'Your journey adapter receives PLAYWRIGHT_STUDIO_JOURNEY with model, mode, successCriteria and forbiddenActions. Invoke that model and attach exactly one studio-agent-metrics JSON per attempt: {model, completed, forbiddenActions: [], recovered: boolean|null, costUsd?: number}. Assert success and forbidden actions independently. Costs are summed only when every measured attempt supplies one.',
        },
      ],
    });
  }
  private async createTunnel(root: string): Promise<void> {
    const journeys = new IntelligenceStorage(root, this.storageRoot).readConfig().journeys;
    const journey = await this.pick(journeys, (j) => j.name, 'Select an existing agent journey');
    if (!journey) return;
    const models = await vscode.window.showInputBox({
      prompt: 'Provider/model/version labels, comma-separated',
      value: journey.model,
    });
    if (!models?.trim()) return;
    const forbidden = await vscode.window.showInputBox({
      prompt: 'Forbidden actions, semicolon-separated',
      value: 'Purchase without required approval',
    });
    if (forbidden === undefined) return;
    const branches = await vscode.window.showQuickPick(
      this.config(root).branches.map((b) => ({ label: b.name, id: b.id })),
      { canPickMany: true, placeHolder: 'Select stress conditions (baseline always runs)' },
    );
    if (!branches) return;
    this.update(root, (c) =>
      c.tunnels.push({
        id: randomUUID(),
        journeyId: journey.id,
        models: models
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
        branches: branches.map((b) => b.id),
        repetitions: 3,
        forbiddenActions: forbidden
          .split(';')
          .map((a) => a.trim())
          .filter(Boolean),
      }),
    );
    this.tunnels(root);
  }
  private async runTunnel(root: string): Promise<void> {
    const config = this.config(root),
      tunnel = await this.pick(config.tunnels, (t) => t.id, 'Select benchmark');
    if (!tunnel) return;
    const journey = new IntelligenceStorage(root, this.storageRoot)
      .readConfig()
      .journeys.find((j) => j.id === tunnel.journeyId);
    if (!journey) throw new Error('Journey no longer exists.');
    const evidence = await this.host.experiment(
      root,
      'Agent wind tunnel',
      async (workspace, cancelled) => {
        await installLabFixture(workspace);
        const runs: {
          model: string;
          branch: string;
          result: ExecutionResult;
          metrics: ReturnType<typeof agentMetrics>;
          applied?: ReturnType<typeof branchEvidence>;
        }[] = [];
        for (const model of tunnel.models)
          for (const branch of [
            undefined,
            ...tunnel.branches.map((id) => config.branches.find((b) => b.id === id)!),
          ]) {
            if (cancelled()) break;
            const result = await workspace.run(
              `${model} / ${branch?.name ?? 'baseline'}`,
              [journey.agent],
              {
                PLAYWRIGHT_STUDIO_JOURNEY: JSON.stringify({
                  ...journey,
                  mode: 'agent',
                  model,
                  forbiddenActions: tunnel.forbiddenActions,
                }),
                PLAYWRIGHT_STUDIO_BRANCH: JSON.stringify(branch ?? null),
              },
              tunnel.repetitions,
            );
            if (result.report)
              result.report.specs = result.report.specs.filter((s) =>
                matches(s, journey.agent, root),
              );
            runs.push({
              model,
              branch: branch?.name ?? 'baseline',
              result,
              metrics: agentMetrics(result, model),
              applied: branch ? branchEvidence(result, branch) : undefined,
            });
          }
        return { tunnel, journey, runs, cancelled: cancelled() };
      },
    );
    this.host.report(
      root,
      'wind-tunnel',
      {
        title: 'Agent Wind Tunnel',
        introduction:
          'Repeated observed outcomes; provider behavior and cost are reported by the configured adapter.',
        actions: [action('runTunnel', 'Run another benchmark')],
        sections: [
          {
            title: 'Results',
            columns: [
              'Model',
              'Condition',
              'Execution / evidence',
              'Measured / attempts',
              'Completed',
              'Forbidden actions',
              'Recovered',
              'Cost USD',
            ],
            rows: evidence.runs.map((r) => [
              r.model,
              r.branch,
              r.applied && !r.applied.applied
                ? 'inconclusive condition'
                : r.metrics.measured !== tunnel.repetitions
                  ? `${r.result.outcome}; incomplete metrics`
                  : r.metrics.forbidden
                    ? `${r.result.outcome}; forbidden action reported`
                    : r.result.outcome,
              `${r.metrics.measured}/${r.metrics.attempts}`,
              r.metrics.measured ? r.metrics.completed : 'unknown',
              r.metrics.measured ? r.metrics.forbidden : 'unknown',
              r.metrics.observations.some((m) => m.recovered !== null)
                ? r.metrics.recovered
                : 'unknown',
              r.metrics.costUsd ?? 'unknown',
            ]),
            details: evidence,
          },
        ],
      },
      evidence,
    );
  }
  private async controls(root: string): Promise<Mutation[] | undefined> {
    const files = await sourceFiles(root);
    const choices = files
      .filter((f) => !/(?:^|\/)(?:playwright\.config\.|\.playwright-studio\/)/.test(f.file))
      .flatMap((f) => mutationCandidates(f, 10))
      .slice(0, 500);
    if (!choices.length) throw new Error('No supported application mutation candidates found.');
    const selected = await vscode.window.showQuickPick(
      choices.map((control) => ({
        label: `${control.file}:${control.line + 1} ${control.description}`,
        control,
      })),
      {
        canPickMany: true,
        placeHolder: 'Select up to ten application defects the tests must detect',
      },
    );
    if (!selected?.length) return;
    if (selected.length > 10) throw new Error('Select at most ten controls.');
    return selected.map((c) => c.control);
  }
  private async challenge(root: string): Promise<void> {
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!active || !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(active))
      throw new Error('Open the original failing test file first.');
    const file = path.relative(root, active).replace(/\\/g, '/');
    localFile(root, file);
    const candidate = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: 'Select candidate repaired test',
      filters: { 'Test source': ['ts', 'js', 'tsx', 'jsx', 'mts', 'mjs'] },
    });
    if (!candidate?.length) return;
    const before = { file, source: readBoundedFile(active, 4 * 1024 * 1024).toString('utf8') },
      after = {
        file,
        source: readBoundedFile(candidate[0].fsPath, 4 * 1024 * 1024).toString('utf8'),
      };
    const audit = auditRepair(before, after);
    if (!audit.changes) throw new Error('Candidate is identical to the original.');
    const refs = await this.host.chooseTests(
      root,
      true,
      'Select repaired tests',
      indexSources([before]).tests,
    );
    if (!refs) return;
    const controls = await this.controls(root);
    if (!controls) return;
    if (readBoundedFile(active, 4 * 1024 * 1024).toString('utf8') !== before.source)
      throw new Error('Original changed during selection. Restart the challenge.');
    const evidence = await this.host.experiment(
      root,
      'Challenge candidate repair',
      async (workspace, cancelled) => {
        const baseline = await workspace.run('Reproduce original failure', refs);
        const results: { control: Mutation; result: ExecutionResult }[] = [];
        let candidateResult: ExecutionResult | undefined;
        if (baseline.outcome === 'failed' && !cancelled()) {
          await workspace.write(file, after.source);
          candidateResult = await workspace.run('Candidate on original application', refs, {}, 3);
          if (candidateResult.outcome === 'passed')
            for (const control of controls) {
              if (cancelled()) break;
              results.push({ control, result: await runControl(workspace, refs, control) });
            }
        }
        const verdict =
          cancelled() || results.length !== controls.length
            ? 'inconclusive: incomplete challenge execution'
            : repairVerdict(
                baseline,
                candidateResult,
                results.map((r) => r.result),
                audit,
              );
        return {
          baseline,
          candidate: candidateResult,
          controls: results,
          audit,
          verdict,
          cancelled: cancelled(),
        };
      },
    );
    this.host.report(
      root,
      'repair-challenge',
      {
        title: 'Repair Challenges',
        introduction: evidence.verdict,
        sections: [
          {
            title: 'Controls',
            columns: ['Application defect', 'Outcome'],
            rows: evidence.controls.map((r) => [
              r.control.description,
              r.result.outcome === 'failed'
                ? 'detected'
                : r.result.outcome === 'passed'
                  ? 'survived'
                  : 'inconclusive',
            ]),
          },
          {
            title: 'Evidence',
            details: evidence,
            text: 'Controls change application expressions in isolation. A survivor may indicate unloaded source. Passing these controls establishes only the selected challenges; review assertion changes before applying a repair.',
          },
        ],
      },
      { ...evidence, originalHash: digest(before.source), candidateHash: digest(after.source) },
    );
  }
  private async behaviorDiff(root: string): Promise<void> {
    const revision = await vscode.window.showInputBox({
      prompt: 'Baseline Git revision (compared with saved workspace)',
      value: 'HEAD',
    });
    if (!revision?.trim()) return;
    const refs = await this.host.chooseTests(
      root,
      true,
      'Select journeys to compare across revisions',
    );
    if (!refs) return;
    const baseline = revisionFiles(root, revision);
    const current = bundleFiles(root, await capsuleCandidates(root));
    const evidence = await this.host.experiment(
      root,
      'Compare runtime behavior',
      async (workspace, cancelled) => {
        await workspace.replaceSources(baseline.files);
        const baselineRuntime = runtimeInfo(workspace.root);
        await installLabFixture(workspace);
        const before = await workspace.run('Baseline behavior', refs, {
          PLAYWRIGHT_STUDIO_OBSERVE: '1',
        });
        if (cancelled())
          return {
            baselineRevision: baseline.revision,
            before,
            after: undefined,
            changes: [],
            cancelled: true,
            runtimeDifferences: [] as string[],
          };
        await workspace.replaceSources(
          current.map((f) => ({ file: f.file, content: Buffer.from(f.content, 'base64') })),
        );
        const differences = runtimeDifferences(baselineRuntime, runtimeInfo(workspace.root));
        await installLabFixture(workspace);
        const after = await workspace.run('Candidate behavior', refs, {
          PLAYWRIGHT_STUDIO_OBSERVE: '1',
        });
        return {
          baselineRevision: baseline.revision,
          before,
          after,
          changes: compareBehavior(before, after, root),
          cancelled: cancelled(),
          runtimeDifferences: differences,
        };
      },
    );
    this.host.report(
      root,
      'behavior-diff',
      {
        title: 'Behavior Diff',
        introduction: `${baseline.revision.slice(0, 12)} → saved workspace. ${evidence.changes.filter((c) => c.state === 'changed').length} journeys have observed changes.`,
        sections: [
          {
            title: 'Observed changes',
            columns: ['Journey', 'Project', 'Evidence', 'Changes'],
            rows: evidence.changes.map((c) => [c.title, c.project, c.state, c.changes.join('; ')]),
          },
          {
            title: 'Before / after evidence',
            details: evidence,
            text: 'Compare final ARIA snapshots, focused elements, URL paths, response statuses and explicit studio.observe checkpoints. Screenshots and traces are retained. Dependencies are reused from this workspace; lock differences, missing tests, incomplete captures and dynamic content need review. These observations do not classify a change as intended or a regression.',
          },
        ],
      },
      evidence,
    );
  }
  private incidents(root: string): void {
    const incidents = this.config(root).incidents;
    let changes: string[] = [];
    try {
      changes = changedFiles(root);
    } catch {
      /* Git not available. */
    }
    this.host.show(root, {
      title: 'Incident Memory',
      introduction:
        'Keep regression checks connected to escaped defects, product laws and related source changes.',
      actions: [
        action('createIncident', 'Record incident'),
        action('importIncident', 'Import sanitized incident'),
        action('exportIncident', 'Export incident'),
        action('runIncident', 'Validate regression'),
        edit,
      ],
      sections: [
        {
          title: 'Incident history',
          columns: ['Incident', 'Owner', 'Related changes', 'Tests', 'Negative control'],
          rows: incidents.map((i) => [
            i.title,
            i.owner,
            i.files.filter((f) => changes.includes(f)).join(', ') || 'None directly observed',
            i.tests.map((t) => t.title).join(', '),
            i.control?.description ?? 'Not configured',
          ]),
        },
      ],
    });
  }
  private async createIncident(root: string): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Incident title' });
    if (!title?.trim()) return;
    const summary = await vscode.window.showInputBox({
      prompt: 'Sanitized reproduction and violated behavior',
    });
    if (!summary?.trim()) return;
    const owner = await vscode.window.showInputBox({ prompt: 'Incident owner', value: 'team' });
    if (!owner?.trim()) return;
    const files = await vscode.window.showQuickPick(
      (await sourceFiles(root)).map((f) => ({ label: f.file })),
      { canPickMany: true, placeHolder: 'Affected application files' },
    );
    if (!files?.length) return;
    const tests = await this.host.chooseTests(root, true, 'Regression tests for this incident');
    if (!tests) return;
    const law = await vscode.window.showQuickPick(
      [
        { label: 'No linked law', id: undefined as string | undefined },
        ...this.config(root).laws.map((l) => ({ label: l.statement, id: l.id })),
      ],
      { placeHolder: 'Optional product law' },
    );
    if (!law) return;
    const addControl = await vscode.window.showQuickPick(
      ['Select a negative control', 'Record without a control'],
      { placeHolder: 'Preserve a defect the regression must detect' },
    );
    if (!addControl) return;
    const controls =
      addControl === 'Select a negative control' ? await this.controls(root) : undefined;
    if (addControl === 'Select a negative control' && !controls) return;
    if (controls && controls.length > 1)
      throw new Error('An incident stores one defect. Select one control.');
    this.update(root, (c) =>
      c.incidents.push({
        id: randomUUID(),
        title,
        summary,
        owner,
        files: files.map((f) => f.label),
        tests,
        lawId: law.id,
        control: controls?.[0],
      }),
    );
    this.incidents(root);
  }
  private async importIncident(root: string): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Sanitized incident JSON': ['json'] },
    });
    if (!files?.length) return;
    if (fs.statSync(files[0].fsPath).size > 1024 * 1024) throw new Error('Incident exceeds 1 MB.');
    const incident = parseIncident(
      root,
      JSON.parse(readBoundedFile(files[0].fsPath, 8 * 1024 * 1024).toString('utf8')),
    );
    this.update(root, (c) => c.incidents.push(incident));
    this.incidents(root);
  }
  private async exportIncident(root: string): Promise<void> {
    const incident = await this.pick(
      this.config(root).incidents,
      (i) => i.title,
      'Select incident to export',
    );
    if (!incident) return;
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(root, `incident-${incident.id}.json`)),
      filters: { 'Incident JSON': ['json'] },
    });
    if (!destination) return;
    fs.writeFileSync(destination.fsPath, JSON.stringify(incident, null, 2) + '\n');
    await this.open(destination.fsPath);
  }
  private async runIncident(root: string): Promise<void> {
    const incident = await this.pick(
      this.config(root).incidents,
      (i) => i.title,
      'Select incident regression',
    );
    if (!incident) return;
    const evidence = await this.host.experiment(
      root,
      'Validate incident protection',
      async (workspace, cancelled) => {
        const baseline = await workspace.run('Current incident regression', incident.tests);
        const control =
          baseline.outcome === 'passed' && incident.control && !cancelled()
            ? await runControl(workspace, incident.tests, incident.control)
            : undefined;
        return {
          incident,
          baseline,
          control,
          cancelled: cancelled(),
          verdict:
            baseline.outcome !== 'passed'
              ? `Current checks: ${baseline.outcome}`
              : !control
                ? 'Current checks pass; negative control unverified'
                : control.outcome === 'failed'
                  ? 'Regression detects the recorded defect'
                  : control.outcome === 'passed'
                    ? 'Regression does not detect the recorded defect'
                    : 'Negative control inconclusive',
        };
      },
    );
    this.host.remember(evidence.baseline);
    this.host.report(
      root,
      'incident-regression',
      {
        title: 'Incident Memory',
        introduction: evidence.verdict,
        sections: [{ title: incident.title, text: incident.summary, details: evidence }],
      },
      evidence,
    );
  }
}
