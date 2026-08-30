import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { hasJsonReporterText, injectJsonReporterText } from './reporterConfig';

const CONFIG_FILENAMES = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.cts',
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
    return hasJsonReporterText(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

export function injectJsonReporter(filePath: string): boolean {
  try {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = injectJsonReporterText(original);
    if (updated === null) return false;
    if (updated === original) return true;
    const temporary = `${filePath}.playwright-studio.tmp`;
    fs.writeFileSync(temporary, updated, 'utf8');
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      fs.copyFileSync(temporary, filePath);
      fs.unlinkSync(temporary);
    }
    return true;
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
    await context.workspaceState.update(PROMPT_DISMISSED_KEY, true);
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
  const { workingDirectory, reporter, captureResults } = getConfig();
  if (!captureResults) return;
  if (context.workspaceState.get<boolean>(PROMPT_DISMISSED_KEY)) return;

  // A non-empty reporter setting is passed on the CLI and JSON is appended by
  // buildRunCommand, so no config mutation is required in that mode.
  if (reporter.trim()) return;
  const configPath = findPlaywrightConfig(workingDirectory);
  if (!configPath) return;
  if (configHasJsonReporter(configPath)) return;

  await runJsonReporterSetup(context);
}
