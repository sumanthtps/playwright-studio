import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';

const CONFIG_FILENAMES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];
const PROMPT_DISMISSED_KEY = 'playwrightStudio.jsonReporterPromptDismissed';

export function findPlaywrightConfig(workingDir: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(workingDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function configHasJsonReporter(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Strip line and block comments to avoid false positives from commented-out reporters
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:/])\/\/[^\n]*/g, '$1');
    return /['"`]json['"`]/.test(stripped);
  } catch {
    return false;
  }
}

export function injectJsonReporter(filePath: string): boolean {
  try {
    const original = fs.readFileSync(filePath, 'utf8');

    const arrayMatch = original.match(/(\breporter\s*:\s*\[)/);
    if (arrayMatch && typeof arrayMatch.index === 'number') {
      const insertAt = arrayMatch.index + arrayMatch[0].length;
      const updated =
        original.slice(0, insertAt) + "\n    ['json']," + original.slice(insertAt);
      fs.writeFileSync(filePath, updated, 'utf8');
      return true;
    }

    const stringMatch = original.match(/(\breporter\s*:\s*)(['"`])([^'"`]+)\2/);
    if (stringMatch && typeof stringMatch.index === 'number') {
      const fullMatch = stringMatch[0];
      const existing = stringMatch[3];
      const replacement = `reporter: [['${existing}'], ['json']]`;
      const updated =
        original.slice(0, stringMatch.index) +
        replacement +
        original.slice(stringMatch.index + fullMatch.length);
      fs.writeFileSync(filePath, updated, 'utf8');
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export async function runJsonReporterSetup(
  context: vscode.ExtensionContext,
  options: { silent?: boolean } = {}
): Promise<void> {
  const { workingDirectory } = getConfig();
  const configPath = findPlaywrightConfig(workingDirectory);
  if (!configPath) {
    if (!options.silent) {
      void vscode.window.showWarningMessage(
        `Playwright Studio: no playwright.config.* found in ${workingDirectory}. Set 'playwrightSnippets.workingDirectory' to the folder that contains it.`
      );
    }
    return;
  }

  if (configHasJsonReporter(configPath)) {
    if (!options.silent) {
      void vscode.window.showInformationMessage(
        'Playwright Studio: JSON reporter is already configured.'
      );
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'Playwright Studio needs the JSON reporter to populate the Results panel. Add it to your playwright.config now?',
    'Add JSON reporter',
    'Open config',
    "Don't show again"
  );

  if (choice === 'Open config') {
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
    return;
  }

  if (choice === "Don't show again") {
    await context.globalState.update(PROMPT_DISMISSED_KEY, true);
    return;
  }

  if (choice !== 'Add JSON reporter') return;

  const ok = injectJsonReporter(configPath);
  if (ok) {
    void vscode.window.showInformationMessage(
      `Playwright Studio: added the JSON reporter to ${path.basename(configPath)}.`
    );
  } else {
    void vscode.window.showWarningMessage(
      `Playwright Studio: couldn't safely edit ${path.basename(configPath)}. Add ['json'] to the reporter array manually.`
    );
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
  }
}

export async function checkAndPromptForJsonReporter(
  context: vscode.ExtensionContext
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('playwrightSnippets');
  if (!cfg.get<boolean>('captureResults', true)) return;
  if (context.globalState.get<boolean>(PROMPT_DISMISSED_KEY)) return;

  const { workingDirectory } = getConfig();
  const configPath = findPlaywrightConfig(workingDirectory);
  if (!configPath) return;
  if (configHasJsonReporter(configPath)) return;

  await runJsonReporterSetup(context);
}
