import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function extractProjectNames(content: string): string[] {
  // Match the projects array block (handles multiline)
  const projectsMatch = /projects\s*:\s*\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]/s.exec(content);
  if (!projectsMatch) return [];

  const block = projectsMatch[1];
  const names: string[] = [];
  const nameRe = /name\s*:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(block)) !== null) {
    names.push(match[1]);
  }
  return names;
}

export async function getPlaywrightProjects(): Promise<string[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return [];

  const candidates = [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mts',
    'playwright.config.mjs',
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
