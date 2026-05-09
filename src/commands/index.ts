import * as vscode from 'vscode';
import { PlaywrightCodeLensProvider } from '../codeLensProvider';
import { parseTests } from '../testParser';
import { buildRunArgs } from '../config';
import { runInTerminal } from '../terminal';
import { EnvProfileManager } from '../envProfile';
import { getPlaywrightProjects } from '../playwrightProjects';
import { saveAsSnippet } from '../snippetGenerator';
import { codeGen } from './codeGen';
import { debugInspectFile, debugInspectTest } from './debugInspectTest';
import { debugFile, debugTest } from './debugTest';
import { inspectFile, inspectTest } from './inspectTest';
import { runFile, runTest } from './runTest';
import { showReport } from './showReport';
import { showTrace } from './showTrace';

function getActiveFile(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === 'file') {
    return editor.document.uri.fsPath;
  }
  void vscode.window.showErrorMessage('Open a Playwright test file first.');
  return undefined;
}

function resolveFileTarget(file: unknown): string | undefined {
  if (typeof file === 'string' && file) return file;
  return getActiveFile();
}

async function resolveTestTarget(
  file: unknown,
  name: unknown
): Promise<{ file: string; name: string } | undefined> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return undefined;

  if (typeof name === 'string' && name) return { file: resolvedFile, name };

  const document = await vscode.workspace.openTextDocument(resolvedFile);
  const tests = parseTests(document).filter(item => item.kind === 'test');
  if (tests.length === 0) {
    void vscode.window.showErrorMessage('No Playwright tests were found in the current file.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    tests.map(test => ({ label: test.name, description: `Line ${test.line + 1}` })),
    { placeHolder: 'Select a Playwright test' }
  );
  if (!picked) return undefined;

  return { file: resolvedFile, name: picked.label };
}

async function runWithTag(file: unknown, tag: unknown): Promise<void> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return;

  // CodeLens passes the tag directly; skip the quick pick in that case.
  if (typeof tag === 'string' && tag) {
    const args = buildRunArgs(resolvedFile);
    args.push('--grep', JSON.stringify(tag));
    runInTerminal(args.join(' '));
    return;
  }

  const document = await vscode.workspace.openTextDocument(resolvedFile);
  const tests = parseTests(document);
  const allTags = new Set<string>();
  for (const t of tests) {
    for (const tg of t.tags) allTags.add(tg);
  }

  const customPatternItem: vscode.QuickPickItem = {
    label: '$(edit) Enter custom pattern…',
    description: 'Type a regex to grep tests',
  };
  const items: vscode.QuickPickItem[] = [customPatternItem];
  if (allTags.size > 0) {
    items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Tags found in file' });
    for (const tg of allTags) {
      items.push({ label: tg, description: `Run tests tagged ${tg}` });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a tag or enter a pattern',
  });
  if (!picked) return;

  let pattern: string;
  if (picked === customPatternItem) {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter grep pattern (regex)',
      placeHolder: 'e.g. @smoke or login|checkout',
    });
    if (!input) return;
    pattern = input;
  } else {
    pattern = picked.label;
  }

  const args = buildRunArgs(resolvedFile);
  args.push('--grep', JSON.stringify(pattern));
  runInTerminal(args.join(' '));
}

async function runWithProject(file: unknown): Promise<void> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return;

  const projects = await getPlaywrightProjects();
  if (projects.length === 0) {
    void vscode.window.showInformationMessage(
      'No projects found in playwright.config.ts. Running with default project.'
    );
    runFile(resolvedFile);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    projects.map(p => ({ label: p })),
    { placeHolder: 'Select Playwright project(s) to run', canPickMany: true }
  );
  if (!picked || picked.length === 0) return;

  const args = buildRunArgs(resolvedFile);
  for (const p of picked) args.push('--project', p.label);
  runInTerminal(args.join(' '));
}

export function registerCommands(
  context: vscode.ExtensionContext,
  codeLens: PlaywrightCodeLensProvider,
  profiles: EnvProfileManager
): void {
  const register = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('playwrightSnippets.runTest', async (file: unknown, name: unknown) => {
    const target = await resolveTestTarget(file, name);
    if (target) runTest(target.file, target.name);
  });

  register('playwrightSnippets.runFile', (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) runFile(target);
  });

  register('playwrightSnippets.debugTest', async (file: unknown, name: unknown) => {
    const target = await resolveTestTarget(file, name);
    if (target) await debugTest(target.file, target.name);
  });

  register('playwrightSnippets.debugFile', async (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) await debugFile(target);
  });

  register('playwrightSnippets.inspectTest', async (file: unknown, name: unknown) => {
    const target = await resolveTestTarget(file, name);
    if (target) inspectTest(target.file, target.name);
  });

  register('playwrightSnippets.inspectFile', (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) inspectFile(target);
  });

  register('playwrightSnippets.debugInspectTest', async (file: unknown, name: unknown) => {
    const target = await resolveTestTarget(file, name);
    if (target) debugInspectTest(target.file, target.name);
  });

  register('playwrightSnippets.debugInspectFile', (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) debugInspectFile(target);
  });

  register('playwrightSnippets.codeGen', () => codeGen());
  register('playwrightSnippets.showTrace', (traceFile: unknown) =>
    showTrace(typeof traceFile === 'string' ? traceFile : undefined)
  );
  register('playwrightSnippets.showReport', () => showReport());

  register('playwrightSnippets.runTestAtCursor', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const file = editor.document.uri.fsPath;
    const line = editor.selection.active.line;
    const items = parseTests(editor.document);
    const test = [...items].reverse().find(item => item.line <= line && item.kind === 'test');
    if (test) runTest(file, test.name);
    else runFile(file);
  });

  register('playwrightSnippets.refreshCodeLens', () => codeLens.refresh());

  register('playwrightSnippets.runWithTag', (file: unknown, tag: unknown) =>
    runWithTag(file, tag)
  );
  register('playwrightSnippets.runWithProject', (file: unknown) => runWithProject(file));
  register('playwrightSnippets.switchEnvProfile', () => profiles.switchProfile());
  register('playwrightSnippets.saveAsSnippet', () => saveAsSnippet());
}
