import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { extractProjectNames } from './projectParser';

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

  return [];
}
