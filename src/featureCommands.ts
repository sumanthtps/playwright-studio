import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { captureProcess } from './processCapture';
import { buildRunCommand, buildToolCommand, buildWorkspaceRunCommand, getConfig } from './config';
import { EnvProfileManager } from './envProfile';
import { historyMarkdown } from './historyView';
import { getPlaywrightProjectGraph, getPlaywrightProjects } from './playwrightProjects';
import { ResultStore, SpecResult } from './resultStore';
import { parseTests } from './testParser';
import { getExecutionEnv, runCommand, runCommandAndWait, stopAllRuns } from './terminal';
import { CommandInvocation, capturedTestPattern } from './commandLine';
import { ArtifactViewer } from './artifactViewer';
import { PlaywrightTestExplorer } from './testExplorer';
import { configHasJsonReporter, findPlaywrightConfig } from './setupHelpers';
import { injectVideoEnvironmentBridge } from './videoConfig';
import { AnalyticsViewer } from './analyticsViewer';
import { artifactFile, requireWorkspaceTrust } from './security';
import { readBoundedFile, replaceReviewedFile } from './fileSecurity';

interface RunPreset {
  name: string;
  scope: 'workspace' | 'file';
  projects?: string[];
  grep?: string;
  headed?: boolean;
  trace?: 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
  workers?: number;
  retries?: number;
  repeatEach?: number;
  lastFailed?: boolean;
  envProfile?: string;
  timeout?: number;
  maxFailures?: number;
  grepInvert?: string;
  shard?: string;
  updateSnapshots?: 'changed' | 'missing' | 'all' | 'none';
  fullyParallel?: boolean;
  forbidOnly?: boolean;
  failOnFlakyTests?: boolean;
  onlyChanged?: boolean;
  video?: 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';
}

interface ArtifactArgument {
  spec?: SpecResult;
  attachment?: { name: string; path?: string; body?: string; contentType?: string };
  detailKind?: 'attachment' | 'error' | 'output';
}

function activeResource(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? vscode.window.activeTextEditor.document.uri.fsPath
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function showMarkdown(content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document, { preview: true });
}

function appendPreset(command: { args: string[] }, preset: RunPreset): void {
  for (const project of preset.projects ?? []) command.args.push('--project', project);
  if (preset.grep) command.args.push('--grep', preset.grep);
  if (preset.headed) command.args.push('--headed');
  if (preset.trace) command.args.push('--trace', preset.trace);
  if (preset.workers !== undefined) command.args.push('--workers', String(preset.workers));
  if (preset.retries !== undefined) command.args.push('--retries', String(preset.retries));
  if (preset.repeatEach !== undefined)
    command.args.push('--repeat-each', String(preset.repeatEach));
  if (preset.lastFailed) command.args.push('--last-failed');
  if (preset.timeout !== undefined) command.args.push('--timeout', String(preset.timeout));
  if (preset.maxFailures !== undefined)
    command.args.push('--max-failures', String(preset.maxFailures));
  if (preset.grepInvert) command.args.push('--grep-invert', preset.grepInvert);
  if (preset.shard) command.args.push('--shard', preset.shard);
  if (preset.updateSnapshots) command.args.push('--update-snapshots', preset.updateSnapshots);
  if (preset.fullyParallel) command.args.push('--fully-parallel');
  if (preset.forbidOnly) command.args.push('--forbid-only');
  if (preset.failOnFlakyTests) command.args.push('--fail-on-flaky-tests');
  if (preset.onlyChanged) command.args.push('--only-changed');
}

async function numericOption(
  label: string,
  defaultValue: string,
  minimum = 0,
): Promise<number | undefined | null> {
  const value = await vscode.window.showInputBox({
    prompt: label,
    value: defaultValue,
    validateInput: (input) =>
      /^\d+$/.test(input) && Number(input) >= minimum
        ? undefined
        : `Enter an integer of at least ${minimum}`,
  });
  return value === undefined ? null : Number(value);
}

async function collectPreset(
  resource: string,
  profiles: EnvProfileManager,
): Promise<RunPreset | undefined> {
  const scope = await vscode.window.showQuickPick(
    [
      { label: 'Current file', value: 'file' as const },
      { label: 'Workspace', value: 'workspace' as const },
    ],
    { placeHolder: 'Choose test scope' },
  );
  if (!scope) return undefined;

  const projects = await getPlaywrightProjects(resource);
  const selectedProjects = projects.length
    ? await vscode.window.showQuickPick(
        projects.map((label) => ({ label })),
        {
          placeHolder: 'Select projects, or confirm an empty selection for all projects',
          canPickMany: true,
        },
      )
    : [];
  if (projects.length && selectedProjects === undefined) return undefined;
  const flags = await vscode.window.showQuickPick(
    [
      { label: 'Headed', id: 'headed' },
      { label: 'Trace: on', id: 'trace' },
      { label: 'Workers: 1', id: 'workers' },
      { label: 'Retries: 2', id: 'retries' },
      { label: 'Repeat each: 10', id: 'repeat' },
      { label: 'Last failed only', id: 'lastFailed' },
      { label: 'Video policy', id: 'video' },
      { label: 'Custom timeout', id: 'timeout' },
      { label: 'Maximum failures', id: 'maxFailures' },
      { label: 'Invert grep', id: 'grepInvert' },
      { label: 'Shard', id: 'shard' },
      { label: 'Update snapshots', id: 'snapshots' },
      { label: 'Fully parallel', id: 'fullyParallel' },
      { label: 'Forbid test.only', id: 'forbidOnly' },
      { label: 'Fail on flaky tests', id: 'failOnFlakyTests' },
      { label: 'Only changed tests', id: 'onlyChanged' },
    ],
    { placeHolder: 'Choose run options', canPickMany: true },
  );
  if (!flags) return undefined;
  const grep = await vscode.window.showInputBox({
    prompt: 'Optional grep/tag regex (leave empty for all tests)',
    placeHolder: '@smoke or login|checkout',
  });
  if (grep === undefined) return undefined;
  const profileNames = profiles.getProfileNames(resource);
  const envProfile = profileNames.length
    ? await vscode.window.showQuickPick(
        [
          { label: 'Use active/default profile', value: undefined },
          ...profileNames.map((name) => ({ label: name, value: name })),
        ],
        { placeHolder: 'Environment profile' },
      )
    : { value: undefined };
  if (!envProfile) return undefined;
  const selected = new Set(flags.map((flag) => flag.id));
  const trace = selected.has('trace')
    ? ((await vscode.window.showQuickPick(['on', 'retain-on-failure', 'on-first-retry', 'off'], {
        placeHolder: 'Trace policy',
      })) as RunPreset['trace'])
    : undefined;
  if (selected.has('trace') && !trace) return undefined;
  const video = selected.has('video')
    ? ((await vscode.window.showQuickPick(['on', 'retain-on-failure', 'on-first-retry', 'off'], {
        placeHolder: 'Video policy (uses the Playwright Studio config bridge)',
      })) as RunPreset['video'])
    : undefined;
  if (selected.has('video') && !video) return undefined;
  const timeout = selected.has('timeout')
    ? await numericOption('Per-test timeout in milliseconds', '30000')
    : undefined;
  if (timeout === null) return undefined;
  const maxFailures = selected.has('maxFailures')
    ? await numericOption('Stop after this many failures (0 disables)', '1')
    : undefined;
  if (maxFailures === null) return undefined;
  const grepInvert = selected.has('grepInvert')
    ? await vscode.window.showInputBox({ prompt: 'Exclude tests matching this regex' })
    : undefined;
  if (selected.has('grepInvert') && grepInvert === undefined) return undefined;
  const shard = selected.has('shard')
    ? await vscode.window.showInputBox({
        prompt: 'Shard in current/total format',
        value: '1/2',
        validateInput: (value) => {
          const match = /^(\d+)\/(\d+)$/.exec(value);
          return match && Number(match[1]) >= 1 && Number(match[1]) <= Number(match[2])
            ? undefined
            : 'Use current/total with current between 1 and total';
        },
      })
    : undefined;
  if (selected.has('shard') && !shard) return undefined;
  const updateSnapshots = selected.has('snapshots')
    ? ((await vscode.window.showQuickPick(['changed', 'missing', 'all', 'none'], {
        placeHolder: 'Snapshot update policy',
      })) as RunPreset['updateSnapshots'])
    : undefined;
  if (selected.has('snapshots') && !updateSnapshots) return undefined;
  const workers = selected.has('workers')
    ? await numericOption('Number of parallel workers', '1', 1)
    : undefined;
  if (workers === null) return undefined;
  const retries = selected.has('retries') ? await numericOption('Retry count', '2') : undefined;
  if (retries === null) return undefined;
  const repeatEach = selected.has('repeat')
    ? await numericOption('Repeat each test this many times', '10', 1)
    : undefined;
  if (repeatEach === null) return undefined;
  return {
    name: 'Ad hoc',
    scope: scope.value,
    projects: selectedProjects?.map((project) => project.label),
    grep: grep || undefined,
    headed: selected.has('headed'),
    trace,
    workers: workers ?? undefined,
    retries: retries ?? undefined,
    repeatEach: repeatEach ?? undefined,
    lastFailed: selected.has('lastFailed'),
    envProfile: envProfile.value,
    timeout: timeout ?? undefined,
    maxFailures: maxFailures ?? undefined,
    grepInvert: grepInvert || undefined,
    shard,
    updateSnapshots,
    fullyParallel: selected.has('fullyParallel'),
    forbidOnly: selected.has('forbidOnly'),
    failOnFlakyTests: selected.has('failOnFlakyTests'),
    onlyChanged: selected.has('onlyChanged'),
    video,
  };
}

function configuredPresets(resource?: string): RunPreset[] {
  return vscode.workspace
    .getConfiguration('playwrightSnippets', resource ? vscode.Uri.file(resource) : undefined)
    .get<RunPreset[]>('runPresets', [])
    .filter(
      (preset) =>
        preset &&
        typeof preset.name === 'string' &&
        preset.name.trim() &&
        (preset.scope === 'file' || preset.scope === 'workspace'),
    );
}

async function savePresets(resource: string, presets: RunPreset[]): Promise<void> {
  await vscode.workspace
    .getConfiguration('playwrightSnippets', vscode.Uri.file(resource))
    .update('runPresets', presets, vscode.ConfigurationTarget.WorkspaceFolder);
}

async function runPreset(
  resource: string,
  preset: RunPreset,
  profiles: EnvProfileManager,
): Promise<void> {
  if (preset.video && !(await ensureVideoBridge(resource))) return;
  const isTestFile = /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(resource);
  if (preset.scope === 'file' && !isTestFile)
    throw new Error('Open a Playwright test file to run a file-scoped preset.');
  const command =
    preset.scope === 'file' ? buildRunCommand(resource) : buildWorkspaceRunCommand(resource);
  appendPreset(command, preset);
  await runCommand(command, {
    resource,
    name: `Playwright: ${preset.name}`,
    extraEnv: {
      ...(preset.envProfile ? profiles.getProfileEnv(preset.envProfile, resource) : {}),
      ...(preset.video ? { PLAYWRIGHT_STUDIO_VIDEO: preset.video } : {}),
    },
  });
}

async function ensureVideoBridge(resource: string, explicit = false): Promise<boolean> {
  const configPath = findPlaywrightConfig(getConfig(resource).workingDirectory);
  if (!configPath) {
    void vscode.window.showErrorMessage(
      'No playwright.config.* was found for the video policy override.',
    );
    return false;
  }
  const source = readBoundedFile(configPath, 4 * 1024 * 1024).toString('utf8');
  const result = injectVideoEnvironmentBridge(source, /\.[cm]?ts$/.test(configPath));
  if (!result.changed && result.text) {
    if (explicit)
      void vscode.window.showInformationMessage(
        'The Playwright Studio video policy bridge is already configured.',
      );
    return true;
  }
  if (!result.text) {
    const action = await vscode.window.showWarningMessage(
      `The config could not be patched safely: ${result.reason ?? 'unknown structure'}`,
      'Open Config',
    );
    if (action === 'Open Config') await vscode.window.showTextDocument(vscode.Uri.file(configPath));
    return false;
  }
  const choice = await vscode.window.showInformationMessage(
    'Video run-matrix options require a small environment bridge in playwright.config. Apply it now?',
    {
      modal: true,
      detail:
        'The existing video policy remains the fallback. Review the resulting source-control diff before committing.',
    },
    'Apply Bridge',
    'Open Config',
  );
  if (choice === 'Open Config') await vscode.window.showTextDocument(vscode.Uri.file(configPath));
  if (choice !== 'Apply Bridge') return false;
  requireWorkspaceTrust();
  replaceReviewedFile(configPath, source, result.text);
  void vscode.window.showInformationMessage('Video policy bridge added to Playwright config.');
  return true;
}

async function chooseEnvFile(resource: string): Promise<void> {
  const files = await vscode.workspace.findFiles('**/.env*', '**/{node_modules,.git}/**', 100);
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(circle-slash) None', uri: undefined },
      ...files.map((uri) => ({
        label: vscode.workspace.asRelativePath(uri),
        description: 'Values remain hidden',
        uri,
      })),
    ],
    { placeHolder: 'Select an environment file (secret values are never displayed)' },
  );
  if (!picked) return;
  const configuration = vscode.workspace.getConfiguration(
    'playwrightSnippets',
    vscode.Uri.file(resource),
  );
  await configuration.update(
    'envFile',
    picked.uri ? path.relative(getConfig(resource).workingDirectory, picked.uri.fsPath) : '',
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
}

function resultMarkdown(store: ResultStore, resource?: string): string {
  const results = resource ? store.getResultsFor(resource) : store.results;
  if (!results) return '# Playwright results\n\nNo captured run yet.';
  const s = results.summary;
  const lines = [
    '# Playwright results',
    '',
    `Passed: ${s.passed} · Failed: ${s.failed} · Flaky: ${s.flaky} · Skipped: ${s.skipped} · Duration: ${s.duration}ms`,
    '',
  ];
  for (const spec of results.specs) {
    lines.push(
      `- **${spec.status}** ${spec.title} — ${spec.projectName ?? 'default'} (${spec.duration}ms)`,
    );
    if (spec.error) lines.push(`  - ${spec.error.split('\n')[0]}`);
  }
  return lines.join('\n');
}

function escapeXml(value: string): string {
  const valid = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code === 0x9 ||
        code === 0xa ||
        code === 0xd ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      );
    })
    .join('');
  return valid
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resultJUnit(store: ResultStore, resource?: string): string {
  const results = resource ? store.getResultsFor(resource) : store.results;
  if (!results) return '<?xml version="1.0" encoding="UTF-8"?><testsuites tests="0" />';
  const cases = results.specs
    .map((spec) => {
      const seconds = (spec.duration / 1000).toFixed(3);
      const failure =
        spec.status === 'failed' || spec.status === 'timedOut'
          ? `<failure message="${escapeXml(spec.status)}">${escapeXml(spec.error ?? '')}</failure>`
          : spec.status === 'skipped'
            ? '<skipped />'
            : '';
      return `<testcase classname="${escapeXml(spec.projectName ?? 'default')}" name="${escapeXml(spec.title)}" file="${escapeXml(spec.file)}" line="${spec.line + 1}" time="${seconds}">${failure}</testcase>`;
    })
    .join('');
  const s = results.summary;
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="Playwright" tests="${results.specs.length}" failures="${s.failed}" skipped="${s.skipped}" time="${(s.duration / 1000).toFixed(3)}">${cases}</testsuite></testsuites>`;
}

async function openArtifact(
  value: ArtifactArgument,
  context: vscode.ExtensionContext,
): Promise<void> {
  const attachment = value.attachment;
  if (attachment?.path) {
    const file = artifactFile(attachment.path, context);
    if (!file)
      throw new Error('Artifact is unavailable or outside the workspace and Studio storage.');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    return;
  }
  const raw = attachment?.body;
  let content =
    value.detailKind === 'error'
      ? value.spec?.error
      : value.detailKind === 'output'
        ? value.spec?.output
        : raw;
  if (raw) {
    try {
      content = Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      content = raw;
    }
  }
  const document = await vscode.workspace.openTextDocument({
    content: content ?? 'Artifact is unavailable.',
    language: 'plaintext',
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function captureCommand(
  command: CommandInvocation,
  resource: string,
): Promise<{ ok: boolean; output: string }> {
  requireWorkspaceTrust();
  const config = getConfig(resource);
  const env = getExecutionEnv(resource);
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PW_TEST_REPORTER;
  const result = await captureProcess(command, { cwd: config.workingDirectory, env });
  return {
    ok: result.ok,
    output: result.error ?? [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  };
}

async function captureTool(
  tool: string,
  args: string[],
  resource: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    return await captureCommand(buildToolCommand(tool, args, resource), resource);
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

async function healthCheck(resource: string): Promise<void> {
  const config = getConfig(resource);
  const configPath = findPlaywrightConfig(config.workingDirectory);
  const configFile = configPath ? path.basename(configPath) : undefined;
  const testFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(
      vscode.Uri.file(config.workingDirectory),
      '**/*.{spec,test}.{ts,tsx,js,jsx,mts,mjs,cts,cjs}',
    ),
    '**/{node_modules,.git}/**',
    10001,
  );
  const projectGraph = await getPlaywrightProjectGraph(resource);
  const projects = projectGraph.map((project) => project.name);
  const names = new Set(projects);
  const missingDependencies = [
    ...new Set(
      projectGraph
        .flatMap((project) => project.dependencies)
        .filter((dependency) => !names.has(dependency)),
    ),
  ];
  const duplicateProjects = projects.filter((name, index) => projects.indexOf(name) !== index);
  const reportPath = config.reportPath
    ? path.resolve(config.workingDirectory, config.reportPath)
    : path.join(config.workingDirectory, 'playwright-report');
  const envPath = config.envFile
    ? path.isAbsolute(config.envFile)
      ? config.envFile
      : path.resolve(config.workingDirectory, config.envFile)
    : undefined;
  const configuredProfiles = vscode.workspace
    .getConfiguration('playwrightSnippets', vscode.Uri.file(resource))
    .get<Record<string, Record<string, string>>>('envProfiles', {});
  const envKeys = [
    ...new Set([
      ...Object.keys(config.env),
      ...Object.values(configuredProfiles).flatMap((profile) => Object.keys(profile)),
    ]),
  ];
  const [version, browsers] = await Promise.all([
    captureTool('--version', [], resource),
    captureTool('install', ['--dry-run'], resource),
  ]);
  const browserLocations = browsers.output
    .split(/\r?\n/)
    .map((line) => /(?:Install location|Location):\s*(.+)$/i.exec(line)?.[1]?.trim())
    .filter((value): value is string => !!value);
  const installedLocations = browserLocations.filter((location) => fs.existsSync(location)).length;
  const jsonReporter =
    config.captureResults ||
    !!config.reporter ||
    (!!configPath && configHasJsonReporter(configPath));
  const videoBridge =
    !!configPath &&
    (() => {
      const source = fs.readFileSync(configPath, 'utf8');
      const check = injectVideoEnvironmentBridge(source, /\.[cm]?ts$/.test(configPath));
      return !check.changed && !!check.text;
    })();
  await showMarkdown(
    [
      '# Playwright Studio health check',
      '',
      `- ${fs.existsSync(config.workingDirectory) ? '✅' : '❌'} Working directory: \`${config.workingDirectory}\``,
      `- ${configFile ? '✅' : '⚠️'} Config: ${configFile ?? 'not found (defaults may be used)'}`,
      `- ${testFiles.length ? '✅' : '⚠️'} Test files discovered: ${testFiles.length}${testFiles.length > 10000 ? '+' : ''}`,
      `- ${projects.length ? '✅' : '⚠️'} Projects: ${projects.join(', ') || 'none discovered'}`,
      `- ${duplicateProjects.length ? '❌' : '✅'} Duplicate project names: ${duplicateProjects.join(', ') || 'none'}`,
      `- ${missingDependencies.length ? '❌' : '✅'} Missing project dependencies: ${missingDependencies.join(', ') || 'none'}`,
      `- ${version.ok ? '✅' : '❌'} Playwright CLI: ${version.output.split(/\r?\n/)[0] || 'unavailable'}`,
      `- ${browsers.ok && (!browserLocations.length || installedLocations === browserLocations.length) ? '✅' : '⚠️'} Browser binaries: ${browserLocations.length ? `${installedLocations}/${browserLocations.length} install locations exist` : browsers.ok ? 'installation command is available' : browsers.output.split(/\r?\n/)[0] || 'could not verify'}`,
      `- ${config.captureResults ? '✅' : '⚠️'} JSON result capture: ${config.captureResults ? 'enabled' : 'disabled'}`,
      `- ${jsonReporter ? '✅' : '❌'} JSON reporter: ${config.captureResults ? 'added automatically for extension runs' : config.reporter || (jsonReporter ? 'configured in Playwright config' : 'not enabled')}`,
      `- ${fs.existsSync(reportPath) ? '✅' : 'ℹ️'} HTML report path: \`${reportPath}\``,
      `- ${!envPath || fs.existsSync(envPath) ? (envPath ? '✅' : 'ℹ️') : '❌'} Environment file: ${envPath ?? 'not selected'}`,
      `- ℹ️ Environment/profile keys: ${envKeys.join(', ') || 'none'} (values hidden)`,
      `- ${videoBridge ? '✅' : 'ℹ️'} Video matrix bridge: ${videoBridge ? 'configured' : 'not configured (only required for video presets)'}`,
      '',
      'Use “Install Playwright Browsers” to verify or install browser binaries.',
    ].join('\n'),
  );
}

async function quarantineAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const current = parseTests(editor.document).find(
    (test) =>
      test.kind === 'test' &&
      test.line <= editor.selection.active.line &&
      test.endLine >= editor.selection.active.line,
  );
  if (!current) throw new Error('Place the cursor inside a Playwright test first.');
  const line = editor.document.lineAt(current.line);
  const match = /\b(?:test|it)(?:\.(?:only|skip|fixme|fail))*\s*(?=\()/.exec(line.text);
  if (!match) throw new Error('The test call could not be rewritten safely.');
  if (match[0].trim() === 'test.fixme') {
    void vscode.window.showInformationMessage('This test is already quarantined.');
    return;
  }
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(current.line, match.index, current.line, match.index + match[0].length),
      'test.fixme',
    ),
  );
}

async function unquarantineAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const current = parseTests(editor.document).find(
    (test) =>
      test.kind === 'test' &&
      test.line <= editor.selection.active.line &&
      test.endLine >= editor.selection.active.line,
  );
  if (!current) throw new Error('Place the cursor inside a quarantined Playwright test first.');
  const line = editor.document.lineAt(current.line);
  const match = /\btest\.fixme\s*(?=\()/.exec(line.text);
  if (!match) throw new Error('The selected test does not use the test.fixme quarantine modifier.');
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(current.line, match.index, current.line, match.index + match[0].length),
      'test',
    ),
  );
}

async function agentFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(
    '**/{.github/agents,.playwright/agents}/**/*.{md,agent.md}',
    '**/{node_modules,.git}/**',
    100,
  );
}

async function openAgentWorkflow(
  kind: 'planner' | 'generator' | 'healer',
  query: string,
): Promise<void> {
  const agents = await agentFiles();
  const matching = agents.find((uri) => path.basename(uri.fsPath).toLowerCase().includes(kind));
  if (!matching) {
    const action = await vscode.window.showWarningMessage(
      `The Playwright ${kind} agent is not initialized in this workspace.`,
      'Initialize Agents',
    );
    if (action === 'Initialize Agents')
      await vscode.commands.executeCommand('playwrightSnippets.initializeAgents');
    return;
  }
  await vscode.env.clipboard.writeText(query);
  await vscode.commands.executeCommand('workbench.action.chat.open', { query });
  void vscode.window.showInformationMessage(
    `Opened the ${kind} workflow. The request is also on the clipboard; select the Playwright ${kind} custom agent if Chat did not select it automatically.`,
  );
}

async function postGitHubComment(
  context: vscode.ExtensionContext,
  store: ResultStore,
  resource: string,
): Promise<void> {
  const target = await vscode.window.showInputBox({
    prompt: 'GitHub issue/PR number or URL',
    placeHolder: '123 or https://github.com/org/repo/pull/123',
    validateInput: (value) =>
      /^\d+$/.test(value) ||
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+$/.test(value)
        ? undefined
        : 'Enter an issue/PR number or a full github.com issue/PR URL',
  });
  if (!target) return;
  const markdown = resultMarkdown(store, resource);
  const confirmation = await vscode.window.showWarningMessage(
    `Post the latest Playwright result summary to GitHub ${target}?`,
    { modal: true, detail: markdown.slice(0, 500) },
    'Post Comment',
  );
  if (confirmation !== 'Post Comment') return;
  const storage = context.storageUri ?? context.globalStorageUri;
  fs.mkdirSync(storage.fsPath, { recursive: true });
  const bodyFile = path.join(storage.fsPath, 'github-result-comment.md');
  fs.writeFileSync(bodyFile, markdown, 'utf8');
  const exitCode = await runCommandAndWait(
    { executable: 'gh', args: ['issue', 'comment', target, '--body-file', bodyFile] },
    { resource, name: 'Post Playwright Results to GitHub' },
  );
  if (exitCode !== 0)
    throw new Error(
      `GitHub CLI exited with code ${exitCode ?? 'unknown'}. Ensure gh is installed and authenticated.`,
    );
  void vscode.window.showInformationMessage('Playwright result comment posted to GitHub.');
}

export function registerFeatureCommands(
  context: vscode.ExtensionContext,
  store: ResultStore,
  profiles: EnvProfileManager,
  artifactViewer: ArtifactViewer,
  testExplorer: PlaywrightTestExplorer,
  analyticsViewer: AnalyticsViewer,
): void {
  let cancelGeneration = 0;
  const register = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          requireWorkspaceTrust();
          return await fn(...args);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Playwright Studio: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
      }),
    );
  const resource = () => {
    const value = activeResource();
    if (!value) throw new Error('Open a workspace or Playwright test file first.');
    return value;
  };

  register('playwrightSnippets.runMatrix', async () => {
    const file = resource();
    const preset = await collectPreset(file, profiles);
    if (!preset) return;
    const action = await vscode.window.showQuickPick(['Run now', 'Save preset and run'], {
      placeHolder: 'Run configuration ready',
    });
    if (!action) return;
    if (action.startsWith('Save')) {
      const name = await vscode.window.showInputBox({ prompt: 'Preset name' });
      if (!name) return;
      preset.name = name;
      const config = vscode.workspace.getConfiguration('playwrightSnippets', vscode.Uri.file(file));
      const presets = configuredPresets(file).filter((item) => item.name !== name);
      await config.update(
        'runPresets',
        [...presets, preset],
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }
    await runPreset(file, preset, profiles);
  });
  register('playwrightSnippets.runPreset', async () => {
    const file = resource();
    const presets = configuredPresets(file);
    const picked = await vscode.window.showQuickPick(
      presets.map((preset) => ({ label: preset.name, preset })),
      { placeHolder: 'Select a saved run preset' },
    );
    if (picked) await runPreset(file, picked.preset, profiles);
  });
  register('playwrightSnippets.manageRunPresets', async () => {
    const file = resource();
    const presets = configuredPresets(file);
    if (!presets.length) {
      void vscode.window.showInformationMessage(
        'No saved presets. Use “Run with Matrix Options” to create one.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      presets.map((preset) => ({ label: preset.name, description: preset.scope, preset })),
      { placeHolder: 'Select a preset to manage' },
    );
    if (!picked) return;
    const action = await vscode.window.showQuickPick(
      ['Run', 'Replace options', 'Rename', 'Duplicate', 'Delete'],
      { placeHolder: picked.preset.name },
    );
    if (!action) return;
    if (action === 'Run') return runPreset(file, picked.preset, profiles);
    if (action === 'Delete') {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete run preset “${picked.preset.name}”?`,
        { modal: true },
        'Delete',
      );
      if (confirmed === 'Delete')
        await savePresets(
          file,
          presets.filter((preset) => preset !== picked.preset),
        );
      return;
    }
    if (action === 'Replace options') {
      const replacement = await collectPreset(file, profiles);
      if (!replacement) return;
      replacement.name = picked.preset.name;
      await savePresets(
        file,
        presets.map((preset) => (preset === picked.preset ? replacement : preset)),
      );
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: action === 'Rename' ? 'New preset name' : 'Name for duplicated preset',
      value: action === 'Rename' ? picked.preset.name : `${picked.preset.name} copy`,
      validateInput: (value) =>
        !value.trim()
          ? 'A name is required'
          : presets.some(
                (preset) =>
                  (action === 'Duplicate' || preset !== picked.preset) &&
                  preset.name === value.trim(),
              )
            ? 'That preset name already exists'
            : undefined,
    });
    if (!name) return;
    if (action === 'Rename') {
      await savePresets(
        file,
        presets.map((preset) =>
          preset === picked.preset ? { ...preset, name: name.trim() } : preset,
        ),
      );
    } else {
      await savePresets(file, [...presets, { ...picked.preset, name: name.trim() }]);
    }
  });
  register('playwrightSnippets.setupVideoOverride', () => ensureVideoBridge(resource(), true));
  register('playwrightSnippets.runFailed', async () => {
    const generation = cancelGeneration;
    const file = resource();
    const failed =
      store
        .getResultsFor(file)
        ?.specs.filter((spec) => spec.status === 'failed' || spec.status === 'timedOut') ?? [];
    if (!failed.length) throw new Error('The latest captured run has no failed tests.');
    for (const spec of failed) {
      if (generation !== cancelGeneration) break;
      const command = buildRunCommand(spec.file, { line: spec.line });
      command.args.push('--grep', capturedTestPattern(spec.title, spec.titlePath));
      if (spec.projectName !== undefined) command.args.push('--project', spec.projectName);
      await runCommandAndWait(command, { resource: spec.file, name: `Retry: ${spec.title}` });
    }
  });
  register('playwrightSnippets.runLastFailed', async () => {
    const file = resource();
    const command = buildWorkspaceRunCommand(file);
    command.args.push('--last-failed');
    await runCommand(command, { resource: file, name: 'Playwright: Last Failed' });
  });
  register('playwrightSnippets.repeatUntilFailure', async () => {
    const file = resource();
    const count = await vscode.window.showInputBox({
      prompt: 'Maximum repetitions',
      value: '100',
      validateInput: (value) =>
        /^\d+$/.test(value) && Number(value) > 0 ? undefined : 'Enter a positive integer',
    });
    if (!count) return;
    const command = /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)
      ? buildRunCommand(file)
      : buildWorkspaceRunCommand(file);
    command.args.push('--repeat-each', count, '--max-failures', '1', '--workers', '1');
    await runCommand(command, { resource: file, name: 'Playwright: Repeat Until Failure' });
  });
  register('playwrightSnippets.runShard', async () => {
    const file = resource();
    const shard = await vscode.window.showInputBox({
      prompt: 'Shard in current/total format',
      value: '1/2',
      validateInput: (value) => {
        const match = /^(\d+)\/(\d+)$/.exec(value);
        return match && Number(match[1]) >= 1 && Number(match[1]) <= Number(match[2])
          ? undefined
          : 'Use current/total with current between 1 and total';
      },
    });
    if (!shard) return;
    const command = buildWorkspaceRunCommand(file);
    command.args.push('--shard', shard);
    await runCommand(command, { resource: file, name: `Playwright: Shard ${shard}` });
  });
  register('playwrightSnippets.copyCICommand', async () => {
    const file = resource();
    const shards = await vscode.window.showInputBox({
      prompt: 'Number of CI shards',
      value: '4',
      validateInput: (value) =>
        /^\d+$/.test(value) && Number(value) >= 1 ? undefined : 'Enter a positive integer',
    });
    if (!shards) return;
    const config = getConfig(file);
    const command = `${config.testCommand} --shard=\${SHARD_INDEX}/${shards} --reporter=blob`;
    await vscode.env.clipboard.writeText(command);
    void vscode.window.showInformationMessage(
      'CI shard command copied. Set SHARD_INDEX from 1 to the shard count.',
    );
  });
  register('playwrightSnippets.openUIMode', async () => {
    const file = resource();
    const command = buildWorkspaceRunCommand(file);
    command.args.push('--ui');
    const config = vscode.workspace.getConfiguration('playwrightSnippets', vscode.Uri.file(file));
    const host = config.get<string>('uiHost', '');
    const port = config.get<number>('uiPort', 0);
    if (host) command.args.push('--ui-host', host);
    if (port) command.args.push('--ui-port', String(port));
    await runCommand(command, { resource: file, name: 'Playwright UI Mode' });
  });
  register('playwrightSnippets.watchFile', async () => {
    const file = resource();
    if (!/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
      throw new Error('Open a Playwright test file first.');
    const command = buildRunCommand(file);
    command.args.push('--ui');
    await runCommand(command, { resource: file, name: `Watch: ${path.basename(file)}` });
  });
  register('playwrightSnippets.updateSnapshots', async () => {
    const file = resource();
    const mode = await vscode.window.showQuickPick(['changed', 'missing', 'all', 'none'] as const, {
      placeHolder: 'Snapshot update mode',
    });
    if (!mode) return;
    const command = /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)
      ? buildRunCommand(file)
      : buildWorkspaceRunCommand(file);
    command.args.push('--update-snapshots', mode);
    await runCommand(command, { resource: file, name: `Update Snapshots: ${mode}` });
  });
  register('playwrightSnippets.installBrowsers', async () =>
    runCommand(buildToolCommand('install', [], resource()), {
      resource: resource(),
      name: 'Install Playwright Browsers',
    }),
  );
  register('playwrightSnippets.updateBrowsers', async () =>
    runCommand(buildToolCommand('install', ['--force'], resource()), {
      resource: resource(),
      name: 'Update Playwright Browsers',
    }),
  );
  register('playwrightSnippets.initializeAgents', async () => {
    const current = resource();
    const exitCode = await runCommandAndWait(
      buildToolCommand('init-agents', ['--loop=vscode'], current),
      { resource: current, name: 'Initialize Playwright Test Agents' },
    );
    if (exitCode !== 0)
      throw new Error(`Playwright agent initialization exited with code ${exitCode ?? 'unknown'}.`);
    const agents = await agentFiles();
    if (!agents.length)
      throw new Error(
        'Playwright completed but no VS Code agent definitions were discovered. Check the Playwright version and command output.',
      );
    void vscode.window.showInformationMessage(
      `Initialized ${agents.length} Playwright agent definition${agents.length === 1 ? '' : 's'}.`,
    );
  });
  register('playwrightSnippets.generateTestPlan', async () => {
    const url = await vscode.window.showInputBox({
      prompt: 'Application URL for the planner',
      placeHolder: 'http://localhost:3000',
    });
    if (url === undefined) return;
    const objective = await vscode.window.showInputBox({
      prompt: 'What user journey or feature should be planned?',
      placeHolder: 'Checkout as a returning customer',
    });
    if (!objective) return;
    const query = `Use the Playwright planner agent. Explore ${url || 'the configured application'} and create a detailed Markdown test plan for: ${objective}. Include preconditions, user-visible assertions, accessibility checks, negative cases, and data requirements. Do not generate test code yet; stop for human review.`;
    await openAgentWorkflow('planner', query);
  });
  register('playwrightSnippets.generateTestsFromPlan', async () => {
    const plans = await vscode.workspace.findFiles(
      '**/*{plan,PLAN}*.md',
      '**/{node_modules,.git}/**',
      200,
    );
    const picked = await vscode.window.showQuickPick(
      plans.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
      { placeHolder: 'Select the reviewed test plan' },
    );
    if (!picked) return;
    const query = `Use the Playwright generator agent to generate maintainable Playwright tests from the reviewed plan at ${picked.uri.fsPath}. Prefer semantic locators, reusable fixtures, deterministic data, and the existing repository conventions. Show the proposed files and wait for review before writing.`;
    await openAgentWorkflow('generator', query);
  });
  register('playwrightSnippets.healFailures', async () => {
    const failures =
      store
        .getResultsFor(resource())
        ?.specs.filter((spec) => spec.status === 'failed' || spec.status === 'timedOut') ?? [];
    const details = failures
      .map((spec) => `${spec.file}:${spec.line + 1} ${spec.title}\n${spec.error ?? ''}`)
      .join('\n\n');
    const query = `Use the Playwright healer agent to diagnose these failures. Propose a patch and wait for review before editing:\n\n${details || 'No captured failure; inspect the active test.'}`;
    await openAgentWorkflow('healer', query);
  });
  register('playwrightSnippets.openComponentGallery', async () => {
    const current = resource();
    const stories = await vscode.workspace.findFiles(
      '**/*.{stories,story}.{ts,tsx,js,jsx}',
      '**/{node_modules,.git}/**',
      500,
    );
    const options = [
      { label: '$(globe) Open component gallery', uri: undefined as vscode.Uri | undefined },
      ...stories.map((uri) => ({
        label: `$(symbol-class) ${vscode.workspace.asRelativePath(uri)}`,
        uri,
      })),
    ];
    const picked = await vscode.window.showQuickPick(options, {
      placeHolder: `${stories.length} component stories discovered`,
    });
    if (!picked) return;
    if (picked.uri) await vscode.window.showTextDocument(picked.uri);
    else {
      const url = vscode.workspace
        .getConfiguration('playwrightSnippets', vscode.Uri.file(current))
        .get<string>('componentGalleryUrl', 'http://localhost:3100');
      if (!['http:', 'https:'].includes(new URL(url).protocol))
        throw new Error('Component gallery URL must use http or https.');
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  });
  register('playwrightSnippets.showProjectGraph', async () => {
    const projects = await getPlaywrightProjectGraph(resource());
    const ids = new Map(projects.map((project, index) => [project.name, `p${index}`]));
    const unknowns = [
      ...new Set(
        projects
          .flatMap((project) => project.dependencies)
          .filter((dependency) => !ids.has(dependency)),
      ),
    ];
    unknowns.forEach((dependency, index) => ids.set(dependency, `u${index}`));
    const nodes = projects.map(
      (project, index) => `  p${index}["${project.name.replace(/"/g, "'")}"]`,
    );
    const unknownNodes = unknowns.map(
      (dependency) =>
        `  ${ids.get(dependency)}["Missing: ${dependency.replace(/"/g, "'")}"]:::missing`,
    );
    const edges = projects.flatMap((project) =>
      project.dependencies.map(
        (dependency) => `  ${ids.get(dependency)} --> ${ids.get(project.name)}`,
      ),
    );
    await showMarkdown(
      [
        '# Playwright project graph',
        '',
        '```mermaid',
        'flowchart LR',
        ...nodes,
        ...unknownNodes,
        ...edges,
        '  classDef missing stroke:#f85149,stroke-width:2px',
        '```',
        '',
        'Dependencies are read from Playwright’s effective CLI configuration.',
      ].join('\n'),
    );
  });
  register('playwrightSnippets.importCoverage', (source: unknown) =>
    testExplorer.importCoverage(source instanceof vscode.Uri ? source : undefined),
  );
  register('playwrightSnippets.showAnalytics', () => analyticsViewer.show());
  register('playwrightSnippets.openWorkspaceDashboard', () => analyticsViewer.show());
  register('playwrightSnippets.compareRuns', async () => {
    if (store.history.length < 2)
      throw new Error('Capture at least two runs before comparing them.');
    const picks = await vscode.window.showQuickPick(
      store.history.map((record) => ({
        label: record.capturedAt.toLocaleString(),
        description: `${record.summary.passed} passed · ${record.summary.failed} failed`,
        record,
      })),
      { canPickMany: true, placeHolder: 'Select exactly two runs to compare' },
    );
    if (!picks || picks.length !== 2) return;
    const [newer, older] = picks
      .sort((a, b) => b.record.capturedAt.getTime() - a.record.capturedAt.getTime())
      .map((item) => item.record);
    const key = (spec: SpecResult) =>
      JSON.stringify([spec.file, spec.line, spec.projectName, spec.titlePath ?? [spec.title]]);
    const before = new Map(older.specs.map((spec) => [key(spec), spec]));
    const changed = newer.specs.filter((spec) => before.get(key(spec))?.status !== spec.status);
    await showMarkdown(
      [
        '# Run comparison',
        '',
        `Newer: ${newer.capturedAt.toLocaleString()}`,
        `Older: ${older.capturedAt.toLocaleString()}`,
        '',
        `Duration change: ${newer.summary.duration - older.summary.duration}ms`,
        `Failure change: ${newer.summary.failed - older.summary.failed}`,
        '',
        '## Status changes',
        '',
        ...changed.map(
          (spec) =>
            `- ${spec.title}: ${before.get(key(spec))?.status ?? 'new'} → **${spec.status}**`,
        ),
      ].join('\n'),
    );
  });
  register('playwrightSnippets.reviewSnapshots', async () => {
    const specs =
      store
        .getResultsFor(resource())
        ?.specs.filter((spec) =>
          (spec.attachments ?? []).some((attachment) =>
            /expected|actual|diff/i.test(attachment.name),
          ),
        ) ?? [];
    const picked = await vscode.window.showQuickPick(
      specs.map((spec) => ({ label: spec.title, description: spec.projectName, spec })),
      { placeHolder: 'Select a snapshot failure to review' },
    );
    if (!picked) return;
    artifactViewer.show(picked.spec);
  });
  register('playwrightSnippets.exportResults', async () => {
    const currentResource = resource();
    const currentResults = store.getResultsFor(currentResource);
    const markdown = resultMarkdown(store, currentResource);
    const action = await vscode.window.showQuickPick(
      [
        'Copy Markdown',
        'Save Markdown',
        'Save JUnit XML',
        'Save JSON',
        'Copy GitHub comment',
        'Post GitHub comment',
      ],
      { placeHolder: 'Export results' },
    );
    if (!action) return;
    if (action === 'Post GitHub comment') return postGitHubComment(context, store, currentResource);
    if (action.startsWith('Save')) {
      const isXml = action.includes('JUnit');
      const isJson = action.includes('JSON');
      const extension = isXml ? 'xml' : isJson ? 'json' : 'md';
      const uri = await vscode.window.showSaveDialog({
        filters: { [isXml ? 'JUnit XML' : isJson ? 'JSON' : 'Markdown']: [extension] },
        defaultUri: vscode.Uri.file(
          path.join(getConfig(resource()).workingDirectory, `playwright-results.${extension}`),
        ),
      });
      const content = isXml
        ? resultJUnit(store, currentResource)
        : isJson
          ? JSON.stringify(currentResults, null, 2)
          : markdown;
      if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    } else {
      await vscode.env.clipboard.writeText(markdown);
      void vscode.window.showInformationMessage('Playwright result summary copied.');
    }
  });
  register('playwrightSnippets.exportHistory', () => showMarkdown(historyMarkdown(store)));
  register('playwrightSnippets.postGitHubComment', () =>
    postGitHubComment(context, store, resource()),
  );
  register('playwrightSnippets.clearHistory', async () => {
    const answer = await vscode.window.showQuickPick(
      [
        { label: 'Cancel', clear: false },
        {
          label: 'Clear run history',
          description: 'Remove saved runs from this workspace',
          clear: true,
        },
      ],
      {
        title: 'Clear Playwright run history?',
        placeHolder: 'This removes saved history. Current results and test files are kept.',
      },
    );
    if (answer?.clear) store.clearHistory();
  });
  register('playwrightSnippets.selectEnvFile', () => chooseEnvFile(resource()));
  register('playwrightSnippets.healthCheck', () => healthCheck(resource()));
  register('playwrightSnippets.openArtifact', async (value: ArtifactArgument = {}) => {
    if (value?.spec) artifactViewer.show(value.spec);
    else await openArtifact(value, context);
  });
  register('playwrightSnippets.cancelRuns', () => {
    cancelGeneration++;
    stopAllRuns();
  });
  register('playwrightSnippets.quarantineTest', quarantineAtCursor);
  register('playwrightSnippets.unquarantineTest', unquarantineAtCursor);
}
