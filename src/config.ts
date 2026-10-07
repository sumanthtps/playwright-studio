import * as vscode from 'vscode';
import * as path from 'path';
import { getResultsFilePath } from './resultsPath';
import { detectWorkingDirectory } from './workspaceDetection';
import {
  buildPlaywrightToolInvocation,
  CommandInvocation,
  escapeRegex,
  parseCommandLine,
} from './commandLine';

export interface PlaywrightConfig {
  workingDirectory: string;
  testCommand: string;
  toolCommand: string;
  reportPath: string;
  reporter: string;
  env: Record<string, string>;
  envFile: string;
  captureResults: boolean;
}

function asUri(resource?: vscode.Uri | string): vscode.Uri | undefined {
  if (resource instanceof vscode.Uri) return resource;
  if (typeof resource === 'string' && resource) return vscode.Uri.file(resource);
  return vscode.window.activeTextEditor?.document.uri;
}

function getWorkspaceRoot(resource?: vscode.Uri | string): string {
  const uri = asUri(resource);
  return (
    (uri ? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath : undefined) ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    process.cwd()
  );
}

function cfg(resource?: vscode.Uri | string): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('playwrightSnippets', asUri(resource));
}

export function getConfig(resource?: vscode.Uri | string): PlaywrightConfig {
  const root = getWorkspaceRoot(resource);
  const workingDir = cfg(resource).get<string>('workingDirectory', '');
  return {
    workingDirectory: workingDir
      ? path.resolve(root, workingDir)
      : detectWorkingDirectory(root, asUri(resource)?.fsPath),
    testCommand: cfg(resource).get<string>('testCommand', 'npx playwright test'),
    toolCommand: cfg(resource).get<string>('toolCommand', ''),
    reportPath: cfg(resource).get<string>('reportPath', ''),
    reporter: cfg(resource).get<string>('reporter', ''),
    env: cfg(resource).get<Record<string, string>>('env', {}),
    envFile: cfg(resource).get<string>('envFile', ''),
    captureResults: cfg(resource).get<boolean>('captureResults', true),
  };
}

export function getCaptureEnv(resource?: vscode.Uri | string): Record<string, string> {
  if (!cfg(resource).get<boolean>('captureResults', true)) return {};
  const config = getConfig(resource);
  return {
    PLAYWRIGHT_JSON_OUTPUT_FILE: getResultsFilePath(config.workingDirectory),
    // Playwright appends this reporter to the effective configuration, retaining
    // HTML/custom reporters and their options without editing the user's file.
    ...(config.reporter.trim()
      ? {}
      : { PW_TEST_REPORTER: path.join(__dirname, 'captureReporter.js') }),
  };
}

function exactFileFilter(testFile: string, line?: number): string {
  // Playwright matches file filters as regexes against normalized absolute paths.
  const normalized = path.resolve(testFile).replace(/\\/g, '/');
  const filter = `${escapeRegex(normalized)}$`;
  return line === undefined ? filter : `${filter}:${line + 1}`;
}

function withReporterArgs(args: string[], config: PlaywrightConfig): void {
  const reporters = config.reporter
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (reporters.length === 0) return;
  if (config.captureResults && !reporters.includes('json')) reporters.push('json');
  args.push('--reporter', reporters.join(','));
}

export function buildRunCommand(
  testFile: string,
  options: { testName?: string; line?: number } = {},
): CommandInvocation {
  const config = getConfig(testFile);
  const command = parseCommandLine(config.testCommand);
  command.args.push(exactFileFilter(testFile, options.line));
  if (options.testName && options.line === undefined) {
    command.args.push('--grep', escapeRegex(options.testName));
  }
  withReporterArgs(command.args, config);
  return command;
}

export function buildWorkspaceRunCommand(resource?: vscode.Uri | string): CommandInvocation {
  const config = getConfig(resource);
  const command = parseCommandLine(config.testCommand);
  withReporterArgs(command.args, config);
  return command;
}

export function buildDebugCommand(
  testFile: string,
  options: { testName?: string; line?: number } = {},
): CommandInvocation {
  const command = buildRunCommand(testFile, options);
  command.args.push('--debug');
  return command;
}

export function buildToolCommand(
  tool: string,
  args: string[] = [],
  resource?: vscode.Uri | string,
): CommandInvocation {
  const config = getConfig(resource);
  return buildPlaywrightToolInvocation(config.testCommand, config.toolCommand, tool, args);
}
