import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { hasJsonReporterText, injectJsonReporterText } from './reporterConfig';
import { readBoundedFile, replaceReviewedFile } from './fileSecurity';

const CONFIG_FILENAMES = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.cts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];
export function findPlaywrightConfig(workingDir: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(workingDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function configHasJsonReporter(filePath: string): boolean {
  try {
    return hasJsonReporterText(readBoundedFile(filePath, 4 * 1024 * 1024).toString('utf8'));
  } catch {
    return false;
  }
}

export function injectJsonReporter(filePath: string): boolean {
  try {
    const original = readBoundedFile(filePath, 4 * 1024 * 1024).toString('utf8');
    const updated = injectJsonReporterText(original);
    if (updated === null) return false;
    if (updated === original) return true;
    replaceReviewedFile(filePath, original, updated);
    return true;
  } catch {
    return false;
  }
}

export async function runJsonReporterSetup(resource?: vscode.Uri | string): Promise<void> {
  const { workingDirectory } = getConfig(resource);
  const configPath = findPlaywrightConfig(workingDirectory);
  if (!configPath) {
    void vscode.window.showWarningMessage(
      `Playwright Studio: no playwright.config.* found in ${workingDirectory}. Set 'playwrightSnippets.workingDirectory' to the folder that contains it.`,
    );
    return;
  }

  if (configHasJsonReporter(configPath)) {
    void vscode.window.showInformationMessage(
      'Playwright Studio: JSON reporter is already configured.',
    );
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'Studio captures extension runs automatically. Add a JSON reporter for runs started outside Studio?',
    'Add JSON reporter',
    'Open config',
  );

  if (choice === 'Open config') {
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
    return;
  }

  if (choice !== 'Add JSON reporter') return;

  const ok = injectJsonReporter(configPath);
  if (ok) {
    void vscode.window.showInformationMessage(
      `Playwright Studio: added the JSON reporter to ${path.basename(configPath)}.`,
    );
  } else {
    void vscode.window.showWarningMessage(
      `Playwright Studio: couldn't safely edit ${path.basename(configPath)}. Add ['json'] to the reporter array manually.`,
    );
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
  }
}
