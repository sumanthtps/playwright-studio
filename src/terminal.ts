import * as vscode from 'vscode';
import { getConfig, getCaptureEnv } from './config';
import { CommandInvocation } from './commandLine';

let extraEnvProvider: (() => Record<string, string>) | undefined;

export function setExtraEnvProvider(fn: () => Record<string, string>): void {
  extraEnvProvider = fn;
}

function executionEnv(resource?: vscode.Uri | string, extraEnv: Record<string, string> = {}): Record<string, string> {
  const { env } = getConfig(resource);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return {
    ...inherited,
    ...env,
    ...(extraEnvProvider?.() ?? {}),
    ...getCaptureEnv(resource),
    ...extraEnv,
  };
}

function taskScope(resource?: vscode.Uri | string): vscode.WorkspaceFolder | vscode.TaskScope {
  const uri = resource instanceof vscode.Uri
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

function platformExecutable(executable: string): string {
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
  } = {}
): Promise<void> {
  const { workingDirectory } = getConfig(options.resource);
  const executable = platformExecutable(command.executable);
  const definition = {
    type: 'playwrightStudio',
    executable,
  };
  const execution = new vscode.ProcessExecution(executable, command.args, {
    cwd: workingDirectory,
    env: executionEnv(options.resource, options.extraEnv),
  });
  const task = new vscode.Task(
    definition,
    taskScope(options.resource),
    options.name ?? 'Playwright',
    'Playwright Studio',
    execution,
    []
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
  };
  await vscode.tasks.executeTask(task);
}

export async function debugCommand(
  command: CommandInvocation,
  options: { resource?: vscode.Uri | string; name?: string } = {}
): Promise<boolean> {
  const { workingDirectory } = getConfig(options.resource);
  const executable = platformExecutable(command.executable);
  const uri = options.resource instanceof vscode.Uri
    ? options.resource
    : typeof options.resource === 'string'
      ? vscode.Uri.file(options.resource)
      : undefined;
  const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
  const configuration: vscode.DebugConfiguration = {
    type: 'node',
    request: 'launch',
    name: options.name ?? 'Debug Playwright',
    runtimeExecutable: executable,
    runtimeArgs: command.args,
    cwd: workingDirectory,
    env: executionEnv(options.resource),
    console: 'integratedTerminal',
    internalConsoleOptions: 'neverOpen',
    autoAttachChildProcesses: true,
    skipFiles: ['<node_internals>/**'],
  };
  return vscode.debug.startDebugging(folder, configuration);
}

export function disposeTerminal(): void {
  // Commands now use isolated ProcessExecution tasks/debug sessions, so there
  // is no cached shell terminal to dispose.
}
