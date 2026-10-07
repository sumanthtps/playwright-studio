import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { captureProcess } from './processCapture';
import { getConfig } from './config';
import { parseCommandLine } from './commandLine';
import {
  extractProjectNames,
  extractProjectGraphFromListReport,
  isProjectListStaticallyComplete,
  ProjectGraphNode,
} from './projectParser';
import { getExecutionEnv } from './terminal';
import { requireWorkspaceTrust } from './security';
import { readBoundedFile } from './fileSecurity';

async function discoverProjectsWithCli(
  resource?: vscode.Uri | string,
): Promise<ProjectGraphNode[]> {
  requireWorkspaceTrust();
  const config = getConfig(resource);
  const command = parseCommandLine(config.testCommand);
  const env = getExecutionEnv(resource);
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PW_TEST_REPORTER;

  const result = await captureProcess(
    { executable: command.executable, args: [...command.args, '--list', '--reporter=json'] },
    { cwd: config.workingDirectory, env },
    20_000,
    5_000_000,
  );
  return result.ok ? extractProjectGraphFromListReport(result.stdout) : [];
}

function staticProjects(resource?: vscode.Uri | string): { names: string[]; complete: boolean } {
  const root = getConfig(resource).workingDirectory;
  for (const name of [
    'playwright.config.ts',
    'playwright.config.cts',
    'playwright.config.js',
    'playwright.config.mts',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ]) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    try {
      const content = readBoundedFile(full, 4 * 1024 * 1024).toString('utf8');
      return {
        names: extractProjectNames(content),
        complete: isProjectListStaticallyComplete(content),
      };
    } catch {
      return { names: [], complete: false };
    }
  }
  return { names: [], complete: false };
}

export async function getPlaywrightProjects(resource?: vscode.Uri | string): Promise<string[]> {
  const fallback = staticProjects(resource);
  if (fallback.names.length > 0 && fallback.complete) return fallback.names;

  const discovered = await discoverProjectsWithCli(resource);
  return discovered.length > 0 ? discovered.map((project) => project.name) : fallback.names;
}

export async function getPlaywrightProjectGraph(
  resource?: vscode.Uri | string,
): Promise<ProjectGraphNode[]> {
  const discovered = await discoverProjectsWithCli(resource);
  if (discovered.length > 0) return discovered;
  return staticProjects(resource).names.map((name) => ({ name, dependencies: [] }));
}
