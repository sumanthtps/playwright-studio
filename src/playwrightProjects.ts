import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getConfig } from './config';
import { parseCommandLine } from './commandLine';
import { extractProjectNames, extractProjectNamesFromListReport } from './projectParser';
import { getExecutionEnv, platformExecutable } from './terminal';

async function discoverProjectsWithCli(resource?: vscode.Uri | string): Promise<string[]> {
  const config = getConfig(resource);
  const command = parseCommandLine(config.testCommand);
  const env = getExecutionEnv(resource);
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;

  return new Promise(resolve => {
    const child = spawn(
      platformExecutable(command.executable),
      [...command.args, '--list', '--reporter=json'],
      { cwd: config.workingDirectory, env, windowsHide: true, shell: false }
    );
    let output = '';
    const append = (chunk: Buffer) => {
      if (output.length < 5_000_000) output += chunk.toString();
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(extractProjectNamesFromListReport(output)));
    const timer = setTimeout(() => {
      child.kill();
      resolve([]);
    }, 20_000);
    child.once('close', () => clearTimeout(timer));
  });
}

export async function getPlaywrightProjects(resource?: vscode.Uri | string): Promise<string[]> {
  const root = getConfig(resource).workingDirectory;

  const candidates = [
    'playwright.config.ts',
    'playwright.config.cts',
    'playwright.config.js',
    'playwright.config.mts',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ];

  for (const name of candidates) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      const names = extractProjectNames(content);
      if (names.length > 0) return names;
    } catch {
      // skip unreadable config
    }
  }

  return discoverProjectsWithCli(resource);
}
