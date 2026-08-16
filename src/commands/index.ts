import * as vscode from 'vscode';
import { PlaywrightCodeLensProvider } from '../codeLensProvider';
import { parseTests } from '../testParser';
import { buildWorkspaceRunCommand } from '../config';
import { runCommand } from '../terminal';
import { EnvProfileManager } from '../envProfile';
import { getPlaywrightProjects } from '../playwrightProjects';
import { saveAsSnippet } from '../snippetGenerator';
import { runJsonReporterSetup } from '../setupHelpers';
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
  if (file instanceof vscode.Uri && file.scheme === 'file') return file.fsPath;
  return getActiveFile();
}

async function resolveTestTarget(
  file: unknown,
  name: unknown,
  line: unknown
): Promise<{ file: string; name: string; line?: number } | undefined> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return undefined;

  if (typeof name === 'string' && name) {
    return {
      file: resolvedFile,
      name,
      line: typeof line === 'number' && Number.isInteger(line) ? line : undefined,
    };
  }

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

  const selected = tests.find(test => test.name === picked.label && `Line ${test.line + 1}` === picked.description);
  return { file: resolvedFile, name: picked.label, line: selected?.line };
}

async function runWithTag(file: unknown, tag: unknown): Promise<void> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return;

  // CodeLens passes the tag directly; skip the quick pick in that case.
  if (typeof tag === 'string' && tag) {
    const command = buildWorkspaceRunCommand(resolvedFile);
    command.args.push('--grep', tag);
    await runCommand(command, { resource: resolvedFile });
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

  const command = buildWorkspaceRunCommand(resolvedFile);
  command.args.push('--grep', pattern);
  await runCommand(command, { resource: resolvedFile });
}

async function runWithProject(file: unknown): Promise<void> {
  const resolvedFile = resolveFileTarget(file);
  if (!resolvedFile) return;

  const projects = await getPlaywrightProjects(resolvedFile);
  if (projects.length === 0) {
    void vscode.window.showInformationMessage(
      'No projects found in the Playwright config. Running all tests with the default project.'
    );
    await runCommand(buildWorkspaceRunCommand(resolvedFile), { resource: resolvedFile });
    return;
  }

  const picked = await vscode.window.showQuickPick(
    projects.map(p => ({ label: p })),
    { placeHolder: 'Select Playwright project(s) to run', canPickMany: true }
  );
  if (!picked || picked.length === 0) return;

  const command = buildWorkspaceRunCommand(resolvedFile);
  for (const p of picked) command.args.push('--project', p.label);
  await runCommand(command, { resource: resolvedFile });
}

function tracePathFromArgument(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'spec' in value) {
    const spec = (value as { spec?: { traceFile?: unknown } }).spec;
    if (typeof spec?.traceFile === 'string') return spec.traceFile;
  }
  return undefined;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  codeLens: PlaywrightCodeLensProvider,
  profiles: EnvProfileManager
): void {
  const register = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          return await fn(...args);
        } catch (error) {
          await vscode.window.showErrorMessage(
            `Playwright Studio: ${error instanceof Error ? error.message : String(error)}`
          );
          return undefined;
        }
      })
    );

  register('playwrightSnippets.runTest', async (file: unknown, name: unknown, line: unknown) => {
    const target = await resolveTestTarget(file, name, line);
    if (target) await runTest(target.file, target.name, target.line);
  });

  register('playwrightSnippets.runFile', async (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) await runFile(target);
  });

  register('playwrightSnippets.debugTest', async (file: unknown, name: unknown, line: unknown) => {
    const target = await resolveTestTarget(file, name, line);
    if (target) await debugTest(target.file, target.name, target.line);
  });

  register('playwrightSnippets.debugFile', async (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) await debugFile(target);
  });

  register('playwrightSnippets.inspectTest', async (file: unknown, name: unknown, line: unknown) => {
    const target = await resolveTestTarget(file, name, line);
    if (target) await inspectTest(target.file, target.name, target.line);
  });

  register('playwrightSnippets.inspectFile', async (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) await inspectFile(target);
  });

  register('playwrightSnippets.debugInspectTest', async (file: unknown, name: unknown, line: unknown) => {
    const target = await resolveTestTarget(file, name, line);
    if (target) await debugInspectTest(target.file, target.name, target.line);
  });

  register('playwrightSnippets.debugInspectFile', async (file: unknown) => {
    const target = resolveFileTarget(file);
    if (target) await debugInspectFile(target);
  });

  register('playwrightSnippets.codeGen', () => codeGen());
  register('playwrightSnippets.showTrace', (traceFile: unknown) =>
    showTrace(tracePathFromArgument(traceFile))
  );
  register('playwrightSnippets.showReport', (resource: unknown) =>
    showReport(resource instanceof vscode.Uri || typeof resource === 'string' ? resource : undefined)
  );

  register('playwrightSnippets.runTestAtCursor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const file = editor.document.uri.fsPath;
    const line = editor.selection.active.line;
    const items = parseTests(editor.document);
    const test = [...items].reverse().find(item => item.line <= line && item.kind === 'test');
    if (test) await runTest(file, test.name, test.line);
    else await runFile(file);
  });

  register('playwrightSnippets.inspectTestAtCursor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const file = editor.document.uri.fsPath;
    const line = editor.selection.active.line;
    const items = parseTests(editor.document);
    const test = [...items].reverse().find(item => item.line <= line && item.kind === 'test');
    if (test) await inspectTest(file, test.name, test.line);
    else await inspectFile(file);
  });

  register('playwrightSnippets.refreshCodeLens', () => codeLens.refresh());

  register('playwrightSnippets.runWithTag', (file: unknown, tag: unknown) =>
    runWithTag(file, tag)
  );
  register('playwrightSnippets.runWithProject', (file: unknown) => runWithProject(file));
  register('playwrightSnippets.switchEnvProfile', () => profiles.switchProfile());
  register('playwrightSnippets.saveAsSnippet', () => saveAsSnippet());
  register('playwrightSnippets.setupCaptureResults', () => runJsonReporterSetup(context));
}
