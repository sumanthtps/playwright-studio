import * as vscode from 'vscode';
import * as path from 'path';

export interface PlaywrightConfig {
  workingDirectory: string;
  testCommand: string;
  reporter: string;
  env: Record<string, string>;
  captureResults: boolean;
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('playwrightSnippets');
}

export function getConfig(): PlaywrightConfig {
  const root = getWorkspaceRoot();
  const workingDir = cfg().get<string>('workingDirectory', '');
  return {
    workingDirectory: workingDir ? path.resolve(root, workingDir) : root,
    testCommand: cfg().get<string>('testCommand', 'npx playwright test'),
    reporter: cfg().get<string>('reporter', ''),
    env: cfg().get<Record<string, string>>('env', {}),
    captureResults: cfg().get<boolean>('captureResults', false),
  };
}

export function getCaptureEnv(): Record<string, string> {
  if (!cfg().get<boolean>('captureResults', false)) return {};
  return { PLAYWRIGHT_JSON_OUTPUT_NAME: 'playwright-studio-results.json' };
}

export function buildRunArgs(testFile: string, testName?: string): string[] {
  const { testCommand, reporter, captureResults } = getConfig();
  const args = testCommand.split(/\s+/);
  args.push(JSON.stringify(testFile));
  if (testName) {
    args.push('--grep', JSON.stringify(testName));
  }

  let effectiveReporter = reporter;
  if (captureResults) {
    effectiveReporter = reporter ? `${reporter},json` : 'list,json';
  }
  if (effectiveReporter) {
    args.push('--reporter', effectiveReporter);
  }

  return args;
}

export function buildDebugArgs(testFile: string, testName?: string): string[] {
  const args = buildRunArgs(testFile, testName);
  args.push('--debug');
  return args;
}

export function buildInspectArgs(testFile: string, testName?: string): string[] {
  return buildRunArgs(testFile, testName);
}
