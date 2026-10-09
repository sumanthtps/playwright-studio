import { studioDirectory } from '../studioStorage';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { getConfig, buildToolCommand } from '../config';
import { runCommand, runCommandAndWait, onDidStopAllRuns, stopAllRuns } from '../terminal';
import { ResultStore, RunRecord } from '../resultStore';
import {
  IntelligenceStorage,
  Scenario,
  TestReference,
  changedFiles,
  digest,
  localFile,
  revisionEvidence,
  validateScenario,
} from './model';
import {
  SourceFile,
  SourceIndex,
  applyMutation,
  auditRepair,
  indexSources,
  instrumentScenario,
  investigate,
  matches,
  mutationCandidates,
  planImpact,
  promiseEvidence,
  referenceFor,
} from './analysis';
import {
  ExperimentWorkspace,
  ExecutionResult,
  scenarioFixture,
  scenarioVariants,
  sourceFiles,
} from './execution';
import { IntelligencePanel, IntelligenceReport, features } from './panel';
import { traceSummary } from './trace';
import { LabController, labActions } from './labController';
import { LabStorage } from './labModel';
import { artifactFile, requireWorkspaceTrust } from '../security';
import { atomicWriteFile, readBoundedFile } from '../fileSecurity';
import { boundedHistory, loadRunHistory } from '../runHistory';
export const intelligenceCommands = ['openIntelligence', ...features.map((f) => f[0])];
const internalActions = [
  'checkWorkspace',
  'openIntelligenceHelp',
  'openSelectorIntelligence',
  'cancelWorkflow',
  'editIntelligenceConfig',
  'saveScenario',
  'runScenario',
  'exportScenario',
  'runImpactPlan',
  'runFullSuite',
  'runFailureExperiment',
  'importTestCoverage',
  'createPromise',
  'runProductPromises',
  'createJourney',
  'runJourney',
  'openEvidence',
  'openRunArtifact',
  'openSource',
];
const fingerprint = (files: SourceFile[]) =>
  digest(files.map((f) => f.file + '\0' + digest(f.source)).join('\n'));
export class IntelligenceController implements vscode.Disposable {
  private readonly panel: IntelligencePanel;
  private readonly lab: LabController;
  private panelRoot?: string;
  private evidenceFile?: string;
  private busy = false;
  private impact?: {
    root: string;
    fingerprint: string;
    plan: ReturnType<typeof planImpact>;
  };
  private readonly executionHistory: RunRecord[] = [];
  private readonly savedRuns: string;
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ResultStore,
  ) {
    this.panel = new IntelligencePanel((action, value) =>
      this.handle(action, value, this.panelRoot),
    );
    this.lab = new LabController({
      storageRoot: this.storageRoot,
      show: (root, report) => this.show(root, report),
      report: (root, kind, report, data) => this.report(root, kind, report, data),
      experiment: (root, title, work) => this.experiment(root, title, work),
      chooseTests: (root, many, prompt, supplied) => this.chooseTests(root, many, prompt, supplied),
      latest: (root) => this.store.getResultsFor(root) ?? undefined,
      remember: (result) => this.remember(result),
    });
    this.savedRuns = path.join(this.storageRoot, 'intelligence-history.json');
    this.executionHistory.push(...loadRunHistory(this.savedRuns).slice(0, 100));
  }
  private get storageRoot(): string {
    return (this.context.storageUri ?? this.context.globalStorageUri).fsPath;
  }
  private history(): RunRecord[] {
    return [...this.executionHistory, ...this.store.history];
  }
  private storage(root: string): IntelligenceStorage {
    return new IntelligenceStorage(root, this.storageRoot);
  }
  private show(root: string, report?: IntelligenceReport): void {
    this.panelRoot = root;
    this.evidenceFile = report?.evidenceFile;
    this.panel.show(root, report);
  }
  private report(root: string, kind: string, report: IntelligenceReport, data: unknown): void {
    report.evidenceFile = this.storage(root).save(kind, data);
    this.show(root, report);
  }
  private remember(result: ExecutionResult): void {
    if (!result.report) return;
    this.executionHistory.unshift({
      ...result.report,
      id: randomUUID(),
      capturedAt: new Date(),
      workspaceRoot: result.report.rootDir,
    });
    this.executionHistory.splice(100);
    fs.mkdirSync(this.storageRoot, { recursive: true });
    const bounded = boundedHistory(this.executionHistory, 100);
    this.executionHistory.splice(0, this.executionHistory.length, ...bounded.records);
    atomicWriteFile(this.savedRuns, bounded.json);
  }
  async handle(action: string, value?: unknown, fixedRoot?: string): Promise<void> {
    if (![...intelligenceCommands, ...internalActions, ...labActions].includes(action))
      throw new Error('Unknown Intelligence action.');
    requireWorkspaceTrust();
    if (action === 'cancelWorkflow') {
      stopAllRuns();
      return;
    }
    if (this.busy) {
      await vscode.window.showInformationMessage(
        'An Intelligence workflow is already running. Finish or cancel it before starting another.',
      );
      return;
    }
    this.busy = true;
    try {
      const root = fixedRoot ?? getConfig().workingDirectory;
      if (!vscode.workspace.workspaceFolders?.length || !fs.existsSync(root))
        throw new Error('Open a local application workspace before using Intelligence.');
      if ((labActions as readonly string[]).includes(action)) {
        await this.lab.handle(root, action);
        return;
      }
      if (
        ['saveScenario', 'createPromise', 'createJourney', 'importTestCoverage'].includes(action) &&
        vscode.workspace.textDocuments?.some(
          (doc) => doc.isDirty && doc.uri.fsPath === this.storage(root).configPath,
        )
      )
        throw new Error('Save the Studio configuration before updating it from the panel.');
      switch (action) {
        case 'checkWorkspace':
          await vscode.commands.executeCommand('playwrightSnippets.healthCheck');
          break;
        case 'openSelectorIntelligence':
          await vscode.commands.executeCommand('playwrightSnippets.openSelectorIntelligence');
          break;
        case 'openIntelligenceHelp':
          await vscode.commands.executeCommand(
            'markdown.showPreview',
            vscode.Uri.joinPath(this.context.extensionUri, 'docs', 'intelligence.md'),
          );
          break;
        case 'openIntelligence':
          this.show(root);
          break;
        case 'investigateFailures':
          await this.detective(root);
          break;
        case 'testTheTests':
          await this.mutations(root);
          break;
        case 'openScenarioLab':
          this.scenarios(root);
          break;
        case 'showBehaviorMap':
          await this.behaviorMap(root);
          break;
        case 'showChangeRadar':
          await this.radar(root);
          break;
        case 'verifyRepair':
          await this.repair(root);
          break;
        case 'benchmarkJourneys':
          this.journeys(root);
          break;
        case 'managePromises':
          this.promises(root);
          break;
        case 'editIntelligenceConfig': {
          const storage = this.storage(root);
          if (!fs.existsSync(storage.configPath)) storage.writeConfig(storage.readConfig());
          await vscode.window.showTextDocument(
            await vscode.workspace.openTextDocument(storage.configPath),
          );
          break;
        }
        case 'saveScenario': {
          const storage = this.storage(root),
            config = storage.readConfig();
          const scenario = validateScenario(value);
          if (config.scenarios.some((s) => s.id === scenario.id))
            throw new Error('Scenario id already exists.');
          config.scenarios.push(scenario);
          storage.writeConfig(config);
          this.scenarios(root);
          break;
        }
        case 'runScenario':
          await this.runScenario(root);
          break;
        case 'exportScenario':
          await this.exportScenario(root);
          break;
        case 'runImpactPlan':
          await this.runImpact(root);
          break;
        case 'runFullSuite':
          await this.runFullSuite(root);
          break;
        case 'runFailureExperiment':
          await this.runFailureExperiment(root);
          break;
        case 'importTestCoverage':
          await this.importCoverage(root);
          break;
        case 'createPromise':
          await this.createPromise(root);
          break;
        case 'runProductPromises':
          await this.runPromises(root);
          break;
        case 'createJourney':
          await this.createJourney(root);
          break;
        case 'runJourney':
          await this.runJourney(root);
          break;
        case 'openEvidence':
          if (this.evidenceFile)
            await vscode.window.showTextDocument(
              await vscode.workspace.openTextDocument(this.evidenceFile),
            );
          break;
        case 'openRunArtifact':
          await this.openArtifact(root);
          break;
        case 'openSource': {
          if (!value || typeof value !== 'object') throw new Error('Invalid source reference.');
          const input = value as {
            file?: unknown;
            line?: unknown;
          };
          if (typeof input.file !== 'string') throw new Error('Invalid source path.');
          const document = await vscode.workspace.openTextDocument(localFile(root, input.file));
          const line =
            typeof input.line === 'number' && Number.isInteger(input.line)
              ? Math.max(0, Math.min(document.lineCount - 1, input.line - 1))
              : 0;
          await vscode.window.showTextDocument(document, {
            selection: new vscode.Range(line, 0, line, 0),
          });
          break;
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private async index(root: string): Promise<{
    files: SourceFile[];
    index: SourceIndex;
  }> {
    const files = await sourceFiles(root);
    return { files, index: indexSources(files) };
  }
  private async openArtifact(root: string): Promise<void> {
    if (!this.evidenceFile) return;
    const paths = new Set<string>();
    const collect = (value: unknown, key = '') => {
      if (
        typeof value === 'string' &&
        ['path', 'trace', 'traceFile', 'reportFile', 'file'].includes(key)
      ) {
        const file = artifactFile(value, this.context);
        if (file) paths.add(file);
      } else if (Array.isArray(value)) value.forEach((item) => collect(item));
      else if (value && typeof value === 'object')
        Object.entries(value).forEach(([key, item]) => collect(item, key));
    };
    collect(JSON.parse(fs.readFileSync(this.evidenceFile, 'utf8')));
    if (!paths.size) {
      await vscode.window.showInformationMessage(
        'No retained file artifacts are available for this report.',
      );
      return;
    }
    const item = await vscode.window.showQuickPick(
      [...paths].map((file) => ({ label: path.basename(file), description: file, file })),
      { placeHolder: 'Open a source file, report, or captured artifact' },
    );
    if (!item) return;
    if (/\.zip$/i.test(item.file))
      await runCommand(buildToolCommand('show-trace', [item.file], root), { resource: root });
    else await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.file));
  }
  private async chooseTests(
    root: string,
    many = true,
    prompt = 'Select tests to execute',
    supplied?: TestReference[],
  ): Promise<TestReference[] | undefined> {
    const tests = supplied ?? (await this.index(root)).index.tests;
    const unique = [...new Map(tests.map((test) => [JSON.stringify(test), test])).values()];
    if (!unique.length)
      throw new Error('No statically named tests found. Add executable Playwright tests first.');
    const items = unique.map((test) => ({
      label: test.title,
      description: `${test.file}${test.project ? ' · ' + test.project : ''}`,
      test,
    }));
    if (many) {
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: prompt,
      });
      return picked?.length ? picked.map((p) => p.test) : undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: prompt });
    return picked ? [picked.test] : undefined;
  }
  private async experiment<T>(
    root: string,
    title: string,
    work: (workspace: ExperimentWorkspace, cancelled: () => boolean) => Promise<T>,
  ): Promise<T> {
    if (vscode.workspace.isTrusted === false)
      throw new Error('Trust this workspace before executing its tests.');
    if (
      vscode.workspace.textDocuments?.some(
        (doc) =>
          doc.isDirty && doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(root + path.sep),
      )
    )
      throw new Error('Save workspace edits before running an isolated experiment.');
    try {
      createRequire(path.join(root, 'package.json')).resolve('@playwright/test');
    } catch {
      throw new Error('Install @playwright/test in the application before running experiments.');
    }
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, progressToken) => {
        const workflowCancellation = new vscode.CancellationTokenSource();
        const cancelProgress = progressToken.onCancellationRequested(() =>
          workflowCancellation.cancel(),
        );
        const cancelAll = onDidStopAllRuns(() => workflowCancellation.cancel());
        if (progressToken.isCancellationRequested) workflowCancellation.cancel();
        const token = workflowCancellation.token;
        let workspace: ExperimentWorkspace | undefined;
        try {
          const deadline = vscode.workspace
            .getConfiguration('playwrightSnippets')
            .get<number>('intelligenceRunTimeoutMs', 180000);
          workspace = await ExperimentWorkspace.create(
            root,
            this.storageRoot,
            buildToolCommand('test', [], root),
            async (command, cwd, env, name) => {
              if (token.isCancellationRequested) return undefined;
              progress.report({ message: name });
              const cancellation = new vscode.CancellationTokenSource();
              const subscription = token.onCancellationRequested(() => cancellation.cancel());
              const timer = setTimeout(
                () => cancellation.cancel(),
                Math.max(1000, Math.min(deadline, 3600000)),
              );
              try {
                return await runCommandAndWait(command, {
                  cwd,
                  resource: root,
                  extraEnv: env,
                  name,
                  token: cancellation.token,
                });
              } finally {
                clearTimeout(timer);
                subscription.dispose();
                cancellation.dispose();
              }
            },
          );
          return await work(workspace, () => token.isCancellationRequested);
        } finally {
          cancelProgress.dispose();
          cancelAll.dispose();
          workflowCancellation.dispose();
          await workspace?.dispose();
        }
      },
    );
  }
  private async detective(root: string): Promise<void> {
    const latest = this.store.getResultsFor(root);
    if (!latest) {
      this.show(root, {
        title: 'Failure Detective',
        introduction: 'Run your tests with result capture enabled to begin an investigation.',
        sections: [],
      });
      return;
    }
    const clusters = investigate(latest, this.history());
    const summarize = (candidate?: string) => {
      const file = artifactFile(candidate, this.context);
      return file ? traceSummary(file) : undefined;
    };
    const traces = clusters.flatMap((c) =>
      c.tests.map((test) => ({
        test: test.test,
        failing: summarize(test.trace),
        passing: summarize(test.passingBaseline?.trace),
      })),
    );
    const changes = (() => {
      try {
        return changedFiles(root);
      } catch {
        return [];
      }
    })();
    this.report(
      root,
      'investigation',
      {
        title: 'Failure Detective',
        introduction: `${clusters.reduce((n, c) => n + c.count, 0)} unstable tests grouped into ${clusters.length} shared symptoms. Suggested experiments are hypotheses, not confirmed causes.`,
        sections: [
          ...clusters.map((cluster) => ({
            title: `${cluster.count} test(s): ${cluster.symptom}`,
            columns: ['Test', 'Project', 'Passing baseline', 'Suggested experiment'],
            rows: cluster.tests.map((t) => [
              t.test.title,
              t.test.project ?? 'default',
              t.passingBaseline?.run ?? 'No comparable passing run',
              t.experiment,
            ]),
            details: cluster.tests,
          })),
          {
            title: 'Trace evidence',
            text: 'Network statuses and browser errors are extracted locally. DOM state and unsupported trace events remain available in Trace Viewer.',
            details: traces,
          },
          {
            title: 'Current working changes',
            text: 'These changes are context, not proof of causation. Compare the captured run revision before attributing a failure.',
            details: changes,
          },
        ],
      },
      { clusters, traces, changes, capturedRevision: latest.evidence },
    );
  }
  private async runFailureExperiment(root: string): Promise<void> {
    const latest = this.store.getResultsFor(root);
    const failures =
      latest?.specs.filter((s) => ['failed', 'timedOut', 'flaky'].includes(s.status)) ?? [];
    const refs = await this.chooseTests(
      root,
      true,
      'Select failures to repeat with one worker and tracing',
      failures.map((s) => referenceFor(s, root)),
    );
    if (!refs) return;
    const result = await this.experiment(root, 'Failure reproduction', (workspace) =>
      workspace.run('Repeat failures with tracing', refs, {}, 3),
    );
    this.remember(result);
    this.report(
      root,
      'failure-experiment',
      {
        title: 'Failure Detective',
        introduction: `Reproduction: ${result.outcome}. Compare attempts and trace artifacts before attributing a cause.`,
        sections: [{ title: 'Repeated execution', details: result }],
      },
      result,
    );
  }
  private async runFullSuite(root: string): Promise<void> {
    const plan = this.impact?.root === root ? this.impact.plan : undefined;
    const result = await this.experiment(root, 'Full-suite validation', (workspace) =>
      workspace.run('Full-suite validation'),
    );
    this.remember(result);
    const missed =
      result.report?.specs.filter(
        (s) =>
          ['failed', 'timedOut'].includes(s.status) &&
          !plan?.selected.some((t) => matches(s, t, root)),
      ) ?? [];
    this.report(
      root,
      'full-suite',
      {
        title: 'Change Radar',
        introduction: `Full suite: ${result.outcome}. ${missed.length} failing tests were outside the last selection.`,
        sections: [
          {
            title: 'Failures outside selection',
            columns: ['Test', 'Source'],
            rows: missed.map((s) => [s.title, s.file]),
          },
          { title: 'Full execution', details: result },
        ],
      },
      { plan, result, missed },
    );
  }
  private async mutations(root: string): Promise<void> {
    const { files } = await this.index(root);
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    let changed: string[] = [];
    try {
      changed = changedFiles(root);
    } catch {
      /* Non-Git workspaces can use the active source. */
    }
    const candidates = files
      .filter((f) => changed.includes(f.file) || path.resolve(root, f.file) === active)
      .flatMap((f) => mutationCandidates(f))
      .slice(0, 100);
    if (!candidates.length) {
      this.show(root, {
        title: 'Test the Tests',
        introduction:
          'Open or change an application source file containing a comparison, arithmetic expression, logical condition, or boolean return.',
        sections: [],
      });
      return;
    }
    const chosen = await vscode.window.showQuickPick(
      candidates.map((m) => ({
        label: m.description,
        description: `${m.file}:${m.line + 1}`,
        mutation: m,
      })),
      { canPickMany: true, placeHolder: 'Choose up to 10 controlled mutations' },
    );
    if (!chosen?.length) return;
    if (chosen.length > 10) throw new Error('Choose at most 10 mutations per experiment.');
    const refs = await this.chooseTests(root);
    if (!refs) return;
    for (const { mutation } of chosen)
      if (
        fs.readFileSync(localFile(root, mutation.file), 'utf8') !==
        files.find((f) => f.file === mutation.file)!.source
      )
        throw new Error('Application sources changed during selection. Discover mutations again.');
    const evidence = await this.experiment(
      root,
      'Testing assertion strength',
      async (workspace, cancelled) => {
        const baseline = await workspace.run('Mutation baseline', refs);
        const results: {
          mutation: (typeof candidates)[number];
          verdict: string;
          result: ExecutionResult;
        }[] = [];
        if (baseline.outcome === 'passed')
          for (const { mutation } of chosen) {
            if (cancelled()) break;
            const original = files.find((f) => f.file === mutation.file)!.source;
            try {
              await workspace.write(mutation.file, applyMutation(original, mutation));
              const result = await workspace.run(`Mutation: ${mutation.description}`, refs);
              results.push({
                mutation,
                verdict:
                  result.outcome === 'failed'
                    ? 'detected'
                    : result.outcome === 'passed'
                      ? 'survived'
                      : 'inconclusive',
                result,
              });
            } finally {
              await workspace.write(mutation.file, original);
            }
          }
        return {
          baseline,
          results,
          requested: chosen.length,
          cancelled: cancelled(),
          revision: workspace.revision,
        };
      },
    );
    this.report(
      root,
      'mutations',
      {
        title: 'Test the Tests',
        introduction: `Baseline: ${evidence.baseline.outcome}. Evaluated ${evidence.results.length}/${evidence.requested} mutations. Source edits ran in an isolated copy.`,
        sections: [
          {
            title: 'Mutation results',
            columns: ['Source', 'Mutation', 'Verdict'],
            rows: evidence.results.map((r) => [
              `${r.mutation.file}:${r.mutation.line + 1}`,
              `${r.mutation.before} → ${r.mutation.after}`,
              r.verdict,
            ]),
            details: evidence,
          },
          {
            title: 'Interpretation',
            text: 'A survivor means the selected execution did not detect the change. Confirm the application loaded the mutated source before concluding an assertion is missing. Remote servers and prebuilt assets are not rebuilt automatically. Configuration failures, missing tests, skips, and cancellation are inconclusive.',
          },
        ],
      },
      evidence,
    );
  }
  private scenarios(root: string): void {
    const scenarios = this.storage(root).readConfig().scenarios;
    this.show(root, {
      title: 'Scenario Lab',
      introduction:
        'Create repeatable browser conditions. Each experiment runs a baseline, applies the scenario, and tries removing conditions from a reproducible failure.',
      sections: [
        {
          title: 'Saved scenarios',
          columns: ['Name', 'URL glob', 'Latency', 'HTTP', 'Offline', 'Clock'],
          rows: scenarios.map((s) => [
            s.name,
            s.urlPattern,
            s.latencyMs,
            s.status ?? 'unchanged',
            s.offline ? 'yes' : 'no',
            s.clock ?? 'real time',
          ]),
        },
        {
          title: 'Scope',
          text: 'The isolated runner instruments @playwright/test imports, including custom fixtures that extend that base. HTTP routing may be overridden by application fixtures or service workers. Interception counts are attached to results. Browser time does not change backend time.',
        },
      ],
    });
  }
  private async selectScenario(root: string): Promise<Scenario | undefined> {
    const scenarios = this.storage(root).readConfig().scenarios;
    if (!scenarios.length) {
      this.scenarios(root);
      return;
    }
    return (
      await vscode.window.showQuickPick(
        scenarios.map((s) => ({ label: s.name, scenario: s })),
        { placeHolder: 'Choose a scenario' },
      )
    )?.scenario;
  }
  private async runScenario(root: string): Promise<void> {
    const scenario = await this.selectScenario(root);
    if (!scenario) return;
    const refs = await this.chooseTests(root);
    if (!refs) return;
    const evidence = await this.experiment(root, 'Scenario Lab', async (workspace, cancelled) => {
      const files = await sourceFiles(workspace.root);
      const fixtureName = `.studio-fixture-${randomUUID()}.ts`;
      await workspace.write(fixtureName, scenarioFixture());
      let instrumented = 0;
      for (const file of files) {
        if (/playwright\.config\./.test(file.file)) continue;
        let relative = path.posix.relative(path.posix.dirname(file.file), fixtureName);
        if (!relative.startsWith('.')) relative = './' + relative;
        const source = instrumentScenario(file, relative);
        if (source !== file.source) {
          await workspace.write(file.file, source);
          instrumented++;
        }
      }
      if (!instrumented)
        throw new Error(
          'No @playwright/test imports found to instrument. Export the scenario fixture and integrate it with your custom test base.',
        );
      const baseline = await workspace.run('Scenario baseline', refs);
      const result =
        baseline.outcome === 'passed'
          ? await workspace.run(scenario.name, refs, {
              PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify(scenario),
            })
          : undefined;
      let minimal = scenario;
      const reductions: {
        scenario: Scenario;
        result: ExecutionResult;
      }[] = [];
      const failureSignature = (r: ExecutionResult) =>
        r.report?.specs
          .filter((s) => ['failed', 'timedOut'].includes(s.status))
          .map((s) => s.title + '\0' + (s.error ?? '').replace(/\b\d+\b/g, '#'))
          .sort()
          .join('\n');
      if (result?.outcome === 'failed') {
        for (const dimension of ['latencyMs', 'status', 'offline', 'clock'] as const) {
          if (cancelled()) break;
          const candidate = scenarioVariants(minimal).find(
            (s) => s[dimension] !== minimal[dimension],
          );
          if (!candidate) continue;
          const reduced = await workspace.run(`Reduce ${dimension}`, refs, {
            PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify(candidate),
          });
          reductions.push({ scenario: candidate, result: reduced });
          if (
            reduced.outcome === 'failed' &&
            failureSignature(reduced) === failureSignature(result)
          )
            minimal = candidate;
        }
      }
      return {
        baseline,
        scenario,
        result,
        minimal,
        reductions,
        cancelled: cancelled(),
        revision: workspace.revision,
      };
    });
    this.report(
      root,
      'scenario',
      {
        title: 'Scenario Lab',
        introduction: `Baseline: ${evidence.baseline.outcome}. Scenario: ${evidence.result?.outcome ?? 'not run'}. Reduction is bounded and does not prove a global minimum.`,
        sections: [
          {
            title: 'Reproduction recipe',
            text: 'The recipe and all run evidence are saved. Use Export reusable fixture to apply a saved scenario in your own test suite.',
            details: evidence,
          },
        ],
      },
      evidence,
    );
    if (
      evidence.result?.outcome === 'failed' &&
      JSON.stringify(evidence.minimal) !== JSON.stringify(scenario)
    ) {
      const storage = this.storage(root),
        config = storage.readConfig();
      config.scenarios.push({
        ...evidence.minimal,
        id: randomUUID(),
        name: scenario.name + ' (reduced)',
      });
      storage.writeConfig(config);
    }
  }
  private async exportScenario(root: string): Promise<void> {
    const scenario = await this.selectScenario(root);
    if (!scenario) return;
    const directory = studioDirectory(root, this.storageRoot);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `scenario-${randomUUID()}.ts`);
    fs.writeFileSync(
      file,
      scenarioFixture()
        .split("JSON.parse(process.env.PLAYWRIGHT_STUDIO_SCENARIO || '{}')")
        .join(JSON.stringify(scenario)),
    );
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  }
  private async behaviorMap(root: string): Promise<void> {
    const { index } = await this.index(root);
    const config = this.storage(root).readConfig();
    const configuredTests = new Set(
      config.promises.flatMap((p) => p.tests.map((t) => t.file + '\0' + t.title)),
    );
    const routeMap = new Map<string, typeof index.tests>();
    index.tests.forEach((test) =>
      test.routes.forEach((route) => routeMap.set(route, [...(routeMap.get(route) ?? []), test])),
    );
    this.report(
      root,
      'behavior-map',
      {
        title: 'Living Behavior Map',
        introduction: `${index.tests.length} statically named tests across ${routeMap.size} literal routes. Source declarations describe intended coverage; passing runs provide execution evidence.`,
        sections: [
          {
            title: 'Route → test → assertions',
            columns: ['Route', 'Tests', 'Semantic roles', 'Assertions'],
            rows: [...routeMap].map(([route, tests]) => [
              route,
              tests.map((t) => t.title).join('\n'),
              [...new Set(tests.flatMap((t) => t.roles))].join(', '),
              tests.reduce((sum, t) => sum + t.assertions.length, 0),
            ]),
          },
          {
            title: 'Test behaviors',
            columns: ['Test', 'Source', 'Steps', 'Assertions', 'Promise link'],
            rows: index.tests.map((t) => [
              t.title,
              `${t.file}:${t.line + 1}`,
              t.steps.join('\n'),
              t.assertions.length,
              configuredTests.has(t.file + '\0' + t.title)
                ? 'configured'
                : t.promises.join(', ') || 'unlinked',
            ]),
            details: index,
          },
          {
            title: 'Gaps to review',
            details: {
              testsWithoutInlineAssertions: index.tests
                .filter((t) => !t.assertions.length)
                .map((t) => t.title),
              promisesWithoutTests: config.promises.filter((p) => !p.tests.length),
              unresolvedImports: index.unresolvedImports,
            },
            text: 'Assertions in helpers and dynamic routes/titles may not appear. Semantic roles such as button are UI roles, not authorization roles. These are review candidates, not proof of missing coverage.',
          },
        ],
      },
      { index, promises: config.promises },
    );
  }
  private async radar(root: string): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: 'Testing budget in minutes',
      value: '5',
      validateInput: (v) =>
        Number.isFinite(Number(v)) && Number(v) >= 0.1 && Number(v) <= 120
          ? undefined
          : 'Use a number between 0.1 and 120.',
    });
    if (input === undefined) return;
    const { files, index } = await this.index(root);
    const config = this.storage(root).readConfig();
    let changes: string[];
    try {
      changes = changedFiles(root);
    } catch {
      throw new Error('Change Radar requires a Git repository with a HEAD revision.');
    }
    const relatedIncidents = new LabStorage(root, this.storageRoot)
      .read()
      .incidents.filter((i) => i.files.some((f) => changes.includes(f)));
    const incidentPromises = relatedIncidents.map((i) => ({
      id: 'incident:' + i.id,
      statement: i.title,
      owner: i.owner,
      priority: 'critical' as const,
      tests: i.tests,
      maxAgeDays: 7,
    }));
    const plan = planImpact(
      index,
      changes,
      config.coverage,
      this.history(),
      root,
      revisionEvidence(root),
      Number(input) * 60000,
      [...config.promises, ...incidentPromises],
    );
    this.impact = { root, fingerprint: fingerprint(files), plan };
    this.report(
      root,
      'impact',
      {
        title: 'Change Radar',
        introduction: `${plan.selected.length} selected tests, approximately ${Math.ceil(plan.estimatedMs / 1000)} seconds within a ${input}-minute budget. ${plan.omitted.length} tests remain unverified.`,
        sections: [
          {
            title: 'Selected checks',
            columns: ['Test', 'Estimated seconds', 'Why selected'],
            rows: plan.selected.map((t) => [
              t.title,
              Math.ceil(t.estimatedMs / 1000),
              t.reasons.join('; '),
            ]),
          },
          {
            title: 'Unverified checks',
            columns: ['Test', 'Reason'],
            rows: plan.omitted.map((t) => [
              t.title,
              t.score ? 'Outside estimated budget' : 'No known link to current changes',
            ]),
          },
          {
            title: 'Evidence limits',
            text: plan.note,
            details: {
              changes,
              uncoveredChanges: plan.uncoveredChanges,
              unresolvedImports: plan.unresolvedImports,
            },
          },
          {
            title: 'Related incidents',
            columns: ['Incident', 'Owner', 'Regression checks'],
            rows: relatedIncidents.map((i) => [
              i.title,
              i.owner,
              i.tests.map((t) => t.title).join(', '),
            ]),
            text: 'Incident regressions receive critical priority when a recorded affected file changes. Unresolved dependencies still require review.',
          },
        ],
      },
      plan,
    );
  }
  private async runImpact(root: string): Promise<void> {
    if (!this.impact || this.impact.root !== root || !this.impact.plan.selected.length)
      throw new Error('Create a Change Radar plan with selected tests first.');
    if (fingerprint(await sourceFiles(root)) !== this.impact.fingerprint)
      throw new Error('Sources changed since planning. Refresh Change Radar before running.');
    const plan = this.impact.plan;
    const result = await this.experiment(root, 'Run impact plan', (workspace) =>
      workspace.run('Change Radar checks', plan.selected),
    );
    this.remember(result);
    this.report(
      root,
      'impact-run',
      {
        title: 'Change Radar',
        introduction: `Selected checks: ${result.outcome}. ${plan.omitted.length} tests remain unverified.`,
        sections: [{ title: 'Execution', details: result }],
      },
      { plan, result },
    );
  }
  private async importCoverage(root: string): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Per-test coverage JSON': ['json'] },
      title:
        'Import {version: 1, coverage: [{test: {file,title,project?}, files: [...], revision: "commit"}]}',
    });
    if (!files?.length) return;
    const imported = JSON.parse(readBoundedFile(files[0].fsPath, 8 * 1024 * 1024).toString('utf8'));
    if (imported.version !== 1 || !Array.isArray(imported.coverage))
      throw new Error('Expected version: 1 and a coverage array.');
    const storage = this.storage(root),
      config = storage.readConfig();
    config.coverage = imported.coverage;
    storage.writeConfig(config);
    await vscode.window.showInformationMessage(
      `Imported ${config.coverage.length} per-test coverage links. Refresh Change Radar to use them.`,
    );
  }
  private async repair(root: string): Promise<void> {
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!active || !/\.(spec|test)\.[cm]?[jt]sx?$/.test(active))
      throw new Error('Open the original failing test file first.');
    const relative = path.relative(root, active);
    localFile(root, relative);
    const candidate = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Candidate repaired test': ['ts', 'js', 'tsx', 'jsx', 'mts', 'mjs'] },
      title: 'Select a candidate repair file; the original stays unchanged',
    });
    if (!candidate?.length) return;
    const before = {
        file: relative,
        source: readBoundedFile(active, 4 * 1024 * 1024).toString('utf8'),
      },
      after = {
        file: relative,
        source: readBoundedFile(candidate[0].fsPath, 4 * 1024 * 1024).toString('utf8'),
      };
    const audit = auditRepair(before, after);
    if (!audit.changes) throw new Error('Candidate is identical to the original.');
    const refs = await this.chooseTests(
      root,
      true,
      'Select failing tests to validate',
      indexSources([before]).tests,
    );
    if (!refs) return;
    if (readBoundedFile(active, 4 * 1024 * 1024).toString('utf8') !== before.source)
      throw new Error('The original test changed during selection. Restart repair verification.');
    const evidence = await this.experiment(root, 'Verify candidate repair', async (workspace) => {
      const baseline = await workspace.run('Original failing test', refs);
      if (baseline.outcome !== 'failed')
        return {
          baseline,
          audit,
          candidate: undefined,
          verdict: 'inconclusive: original failure was not reproduced',
        };
      await workspace.write(relative, after.source);
      const result = await workspace.run('Candidate repair (3 repetitions)', refs, {}, 3);
      const findings =
        audit.removedAssertions.length + audit.addedSkips.length + audit.timeoutChanges.length;
      return {
        baseline,
        audit,
        candidate: result,
        verdict:
          result.outcome !== 'passed'
            ? 'not verified'
            : findings
              ? 'passes with review findings'
              : 'passes repeated execution; assertion protection still needs a negative control',
      };
    });
    this.report(
      root,
      'repair',
      {
        title: 'Verified Repair',
        introduction: evidence.verdict,
        sections: [
          {
            title: 'Assertion and control-flow review',
            details: audit,
            text: 'Changed assertion expressions are flagged conservatively, including legitimate locator repairs. Repeated passing execution is not proof that the assertion detects a defect.',
          },
          { title: 'Before / after execution', details: evidence },
          {
            title: 'Candidate',
            text:
              candidate[0].fsPath +
              ' — review and apply the candidate separately after inspecting this report.',
          },
        ],
      },
      { ...evidence, originalHash: digest(before.source), candidateHash: digest(after.source) },
    );
  }
  private promises(root: string): void {
    const promises = this.storage(root).readConfig().promises;
    const evidence = promiseEvidence(promises, this.history(), root, revisionEvidence(root));
    this.report(
      root,
      'promises',
      {
        title: 'Product Promises',
        introduction:
          'Versioned behavior requirements linked to executable tests, owners, and revision-specific evidence.',
        sections: [
          {
            title: 'Promises',
            columns: ['Promise', 'Owner', 'Priority', 'Evidence'],
            rows: evidence.map((p) => [
              p.statement,
              p.owner,
              p.priority,
              p.evidence.length
                ? p.evidence.map((e) => `${e.test.title}: ${e.status}`).join('\n')
                : 'No linked tests',
            ]),
            details: evidence,
          },
          {
            title: 'Interpretation',
            text: 'Supported means all recorded linked checks passed on the current captured source fingerprint within the freshness window. This does not prove the requirement is exhaustively tested. Old reports without a revision remain unverified.',
          },
        ],
      },
      evidence,
    );
  }
  private async createPromise(root: string): Promise<void> {
    const statement = await vscode.window.showInputBox({
      prompt: 'Product promise (an observable behavior)',
    });
    if (!statement?.trim()) return;
    const owner = await vscode.window.showInputBox({ prompt: 'Owner', value: 'team' });
    if (!owner?.trim()) return;
    const priority = await vscode.window.showQuickPick(['critical', 'normal'], {
      placeHolder: 'Business priority',
    });
    if (!priority) return;
    const refs = await this.chooseTests(
      root,
      true,
      'Select tests that provide evidence for this promise',
    );
    if (!refs) return;
    const storage = this.storage(root),
      config = storage.readConfig();
    config.promises.push({
      id: randomUUID(),
      statement,
      owner,
      priority: priority as 'critical' | 'normal',
      tests: refs,
      maxAgeDays: 7,
    });
    storage.writeConfig(config);
    this.promises(root);
  }
  private async runPromises(root: string): Promise<void> {
    const promises = this.storage(root).readConfig().promises;
    const refs = [
      ...new Map(promises.flatMap((p) => p.tests).map((t) => [JSON.stringify(t), t])).values(),
    ];
    if (!refs.length) throw new Error('Add a promise with linked tests first.');
    const result = await this.experiment(root, 'Check product promises', (workspace) =>
      workspace.run('Product promises', refs),
    );
    this.remember(result);
    this.promises(root);
  }
  private journeys(root: string): void {
    const journeys = this.storage(root).readConfig().journeys;
    this.show(root, {
      title: 'Human & Agent Journeys',
      introduction:
        'Run two executable test adapters against the same objective and success criteria. The human adapter is a scripted interaction path; the agent adapter uses your chosen agent integration.',
      sections: [
        {
          title: 'Benchmarks',
          columns: [
            'Journey',
            'Success criteria',
            'Scripted test',
            'Agent test',
            'Model/version',
            'Repetitions',
          ],
          rows: journeys.map((j) => [
            j.name,
            j.successCriteria.join('\n'),
            j.human.title,
            j.agent.title,
            j.model,
            j.repetitions,
          ]),
        },
        {
          title: 'Adapter contract',
          text: 'Both adapters receive PLAYWRIGHT_STUDIO_JOURNEY as JSON containing objective, successCriteria, model, and mode. Each test must assert the listed criteria. The agent adapter invokes its own provider and checks unintended actions. Studio records outcomes; it does not infer safety or accessibility from a passing task.',
        },
      ],
    });
  }
  private async createJourney(root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Journey name' });
    if (!name?.trim()) return;
    const objective = await vscode.window.showInputBox({
      prompt: 'Task both adapters must complete',
    });
    if (!objective?.trim()) return;
    const criteria = await vscode.window.showInputBox({
      prompt: 'Success criteria, separated by semicolons',
    });
    if (!criteria?.trim()) return;
    const human = await this.chooseTests(root, false, 'Select the scripted interaction test');
    if (!human) return;
    const agent = await this.chooseTests(root, false, 'Select the agent adapter test');
    if (!agent) return;
    if (JSON.stringify(human[0]) === JSON.stringify(agent[0]))
      throw new Error('Choose distinct scripted and agent test adapters.');
    const model = await vscode.window.showInputBox({
      prompt: 'Agent provider/model/version identifier',
    });
    if (!model?.trim()) return;
    const storage = this.storage(root),
      config = storage.readConfig();
    config.journeys.push({
      id: randomUUID(),
      name,
      objective,
      successCriteria: criteria
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean),
      human: human[0],
      agent: agent[0],
      model,
      repetitions: 3,
    });
    storage.writeConfig(config);
    this.journeys(root);
  }
  private async runJourney(root: string): Promise<void> {
    const journeys = this.storage(root).readConfig().journeys;
    if (!journeys.length) {
      this.journeys(root);
      return;
    }
    const chosen = await vscode.window.showQuickPick(
      journeys.map((j) => ({ label: j.name, journey: j })),
      { placeHolder: 'Choose a journey benchmark' },
    );
    if (!chosen) return;
    const journey = chosen.journey;
    const evidence = await this.experiment(
      root,
      'Benchmark human and agent journeys',
      async (workspace, cancelled) => {
        const runs: {
          mode: string;
          result: ExecutionResult;
        }[] = [];
        for (const mode of ['human', 'agent'] as const) {
          if (cancelled()) break;
          const result = await workspace.run(
            `${journey.name}: ${mode}`,
            [journey[mode]],
            { PLAYWRIGHT_STUDIO_JOURNEY: JSON.stringify({ ...journey, mode }) },
            journey.repetitions,
          );
          runs.push({ mode, result });
        }
        return { journey, runs, cancelled: cancelled(), revision: workspace.revision };
      },
    );
    this.report(
      root,
      'journey',
      {
        title: 'Human & Agent Journeys',
        introduction: `${journey.name} · ${journey.model}. Outcomes reflect the assertions implemented by each adapter.`,
        sections: [
          {
            title: 'Observed results',
            columns: [
              'Mode',
              'Passed',
              'Failed',
              'Skipped / other',
              'Total duration (ms)',
              'Outcome',
            ],
            rows: evidence.runs.map((r) => {
              const specs =
                r.result.report?.specs.filter((s) =>
                  matches(s, journey[r.mode as 'human' | 'agent'], root),
                ) ?? [];
              return [
                r.mode,
                specs.filter((s) => s.status === 'passed').length,
                specs.filter((s) => ['failed', 'timedOut'].includes(s.status)).length,
                specs.filter((s) => !['passed', 'failed', 'timedOut'].includes(s.status)).length,
                specs.reduce((n, s) => n + s.duration, 0),
                r.result.outcome,
              ];
            }),
            details: evidence,
          },
        ],
      },
      evidence,
    );
  }
  dispose(): void {
    this.panel.dispose();
  }
}
export function registerIntelligenceCommands(
  context: vscode.ExtensionContext,
  store: ResultStore,
): void {
  const controller = new IntelligenceController(context, store);
  context.subscriptions.push(controller);
  for (const action of intelligenceCommands)
    context.subscriptions.push(
      vscode.commands.registerCommand(`playwrightSnippets.${action}`, async () => {
        try {
          await controller.handle(action);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Playwright Studio: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
}
