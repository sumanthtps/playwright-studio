import * as vscode from 'vscode';
import { getConfig, getCaptureEnv } from './config';
import { CommandInvocation } from './commandLine';
import { loadConfiguredEnvFile } from './envFile';
import { randomUUID } from 'crypto';
import { requireWorkspaceTrust } from './security';

let extraEnvProvider: ((resource?: vscode.Uri | string) => Record<string, string>) | undefined;
const activeExecutions = new Set<vscode.TaskExecution>();
const stopListeners = new Set<() => void>();
const activeDebugSessions = new Set<vscode.DebugSession>();

export function setExtraEnvProvider(
  fn: (resource?: vscode.Uri | string) => Record<string, string>,
): void {
  extraEnvProvider = fn;
}

export function getExecutionEnv(
  resource?: vscode.Uri | string,
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const { env } = getConfig(resource);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...inherited,
    ...loadConfiguredEnvFile(typeof resource === 'string' ? resource : resource?.fsPath),
    ...env,
    ...(extraEnvProvider?.(resource) ?? {}),
    ...getCaptureEnv(resource),
    ...extraEnv,
  };
}

function taskScope(resource?: vscode.Uri | string): vscode.WorkspaceFolder | vscode.TaskScope {
  const uri =
    resource instanceof vscode.Uri
      ? resource
      : typeof resource === 'string'
        ? vscode.Uri.file(resource)
        : undefined;
  return (
    (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ??
    vscode.workspace.workspaceFolders?.[0] ??
    vscode.TaskScope.Workspace
  );
}

export function platformExecutable(executable: string): string {
  if (
    process.platform === 'win32' &&
    !/\.[A-Za-z0-9]+$/.test(executable) &&
    ['npm', 'npx', 'pnpm', 'yarn'].includes(executable.toLowerCase())
  ) {
    return `${executable}.cmd`;
  }
  return executable;
}

export async function runCommand(
  command: CommandInvocation,
  options: {
    resource?: vscode.Uri | string;
    extraEnv?: Record<string, string>;
    name?: string;
  } = {},
): Promise<void> {
  requireWorkspaceTrust();
  const { workingDirectory } = getConfig(options.resource);
  const executable = platformExecutable(command.executable);
  const definition = {
    type: 'process',
    id: 'playwrightStudio',
    executable,
  };
  const execution = new vscode.ProcessExecution(executable, command.args, {
    cwd: workingDirectory,
    env: getExecutionEnv(options.resource, options.extraEnv),
  });
  const task = new vscode.Task(
    definition,
    taskScope(options.resource),
    options.name ?? 'Playwright',
    'Playwright Studio',
    execution,
    [],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
  };
  let taskExecution: vscode.TaskExecution | undefined;
  let ended = false;
  const disposable = vscode.tasks.onDidEndTask((event) => {
    if (event.execution.task !== task) return;
    ended = true;
    if (taskExecution) activeExecutions.delete(taskExecution);
    disposable.dispose();
  });
  try {
    taskExecution = await vscode.tasks.executeTask(task);
    if (!ended) activeExecutions.add(taskExecution);
  } catch (error) {
    disposable.dispose();
    throw error;
  }
}

/** Execute a Playwright task and resolve when its process exits. */
export async function runCommandAndWait(
  command: CommandInvocation,
  options: {
    resource?: vscode.Uri | string;
    extraEnv?: Record<string, string>;
    name?: string;
    token?: vscode.CancellationToken;
    cwd?: string;
  } = {},
): Promise<number | undefined> {
  requireWorkspaceTrust();
  if (options.token?.isCancellationRequested) return undefined;
  const { workingDirectory } = getConfig(options.resource);
  const executable = platformExecutable(command.executable);
  const execution = new vscode.ProcessExecution(executable, command.args, {
    cwd: options.cwd ?? workingDirectory,
    env: getExecutionEnv(options.resource, options.extraEnv),
  });
  const task = new vscode.Task(
    { type: 'process', id: 'playwrightStudio', executable },
    taskScope(options.resource),
    options.name ?? 'Playwright',
    'Playwright Studio',
    execution,
    [],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
  };

  let taskExecution: vscode.TaskExecution | undefined;
  let ended = false;
  let cancellation: vscode.Disposable = new vscode.Disposable(() => undefined);
  let resolveEnd: (code: number | undefined) => void = () => undefined;
  const completed = new Promise<number | undefined>((resolve) => {
    resolveEnd = resolve;
  });
  const finish = (code: number | undefined) => {
    if (ended) return;
    ended = true;
    end.dispose();
    taskEnd.dispose();
    cancellation.dispose();
    if (taskExecution) activeExecutions.delete(taskExecution);
    resolveEnd(code);
  };
  const end = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution.task === task) finish(event.exitCode);
  });
  const taskEnd = vscode.tasks.onDidEndTask((event) => {
    if (event.execution.task === task) finish(undefined);
  });
  try {
    taskExecution = await vscode.tasks.executeTask(task);
    if (!ended) {
      activeExecutions.add(taskExecution);
      cancellation =
        options.token?.onCancellationRequested(() => taskExecution?.terminate()) ??
        new vscode.Disposable(() => undefined);
      if (options.token?.isCancellationRequested) taskExecution.terminate();
    }
    return await completed;
  } catch (error) {
    end.dispose();
    taskEnd.dispose();
    cancellation.dispose();
    if (taskExecution) activeExecutions.delete(taskExecution);
    throw error;
  }
}

export function onDidStopAllRuns(listener: () => void): vscode.Disposable {
  stopListeners.add(listener);
  return new vscode.Disposable(() => stopListeners.delete(listener));
}

export function stopAllRuns(): void {
  for (const listener of stopListeners) listener();
  for (const execution of activeExecutions) execution.terminate();
  activeExecutions.clear();
  for (const session of activeDebugSessions) void vscode.debug.stopDebugging(session);
}

export async function debugCommand(
  command: CommandInvocation,
  options: { resource?: vscode.Uri | string; name?: string; sessionId?: string } = {},
): Promise<boolean> {
  requireWorkspaceTrust();
  const { workingDirectory } = getConfig(options.resource);
  const executable = platformExecutable(command.executable);
  const uri =
    options.resource instanceof vscode.Uri
      ? options.resource
      : typeof options.resource === 'string'
        ? vscode.Uri.file(options.resource)
        : undefined;
  const folder = uri
    ? vscode.workspace.getWorkspaceFolder(uri)
    : vscode.workspace.workspaceFolders?.[0];
  const configuration: vscode.DebugConfiguration = {
    type: 'node',
    request: 'launch',
    name: options.name ?? 'Debug Playwright',
    runtimeExecutable: executable,
    runtimeArgs: command.args,
    cwd: workingDirectory,
    env: getExecutionEnv(options.resource),
    console: 'integratedTerminal',
    internalConsoleOptions: 'neverOpen',
    autoAttachChildProcesses: true,
    skipFiles: ['<node_internals>/**'],
    playwrightStudioSession: options.sessionId ?? randomUUID(),
  };
  let session: vscode.DebugSession | undefined;
  const start = vscode.debug.onDidStartDebugSession((candidate) => {
    if (candidate.configuration.playwrightStudioSession !== configuration.playwrightStudioSession)
      return;
    session = candidate;
    activeDebugSessions.add(candidate);
  });
  const end = vscode.debug.onDidTerminateDebugSession((candidate) => {
    if (candidate !== session) return;
    activeDebugSessions.delete(candidate);
    start.dispose();
    end.dispose();
  });
  try {
    const started = await vscode.debug.startDebugging(folder, configuration);
    if (!started) {
      start.dispose();
      end.dispose();
    }
    return started;
  } catch (error) {
    start.dispose();
    end.dispose();
    throw error;
  }
}

/** Subscribe before launch so fast debug processes cannot finish unnoticed. */
export async function debugCommandAndWait(
  command: CommandInvocation,
  options: { resource?: vscode.Uri | string; name?: string; token: vscode.CancellationToken },
): Promise<boolean> {
  if (options.token.isCancellationRequested) return false;
  const sessionId = randomUUID();
  let resolveEnd!: () => void;
  const completed = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  let session: vscode.DebugSession | undefined;
  const start = vscode.debug.onDidStartDebugSession((candidate) => {
    if (candidate.configuration.playwrightStudioSession !== sessionId) return;
    session = candidate;
    if (options.token.isCancellationRequested) void vscode.debug.stopDebugging(candidate);
  });
  const end = vscode.debug.onDidTerminateDebugSession((candidate) => {
    if (candidate.configuration.playwrightStudioSession === sessionId) resolveEnd();
  });
  const cancel = options.token.onCancellationRequested(() => {
    if (session) void vscode.debug.stopDebugging(session);
    resolveEnd();
  });
  try {
    const started = await debugCommand(command, { ...options, sessionId });
    if (started && !options.token.isCancellationRequested) await completed;
    return started;
  } finally {
    start.dispose();
    end.dispose();
    cancel.dispose();
  }
}

export function disposeTerminal(): void {
  stopAllRuns();
}
