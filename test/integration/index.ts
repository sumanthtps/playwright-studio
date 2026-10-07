import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { featureChecks } from './features';

function waitForTask(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      disposable.dispose();
      reject(new Error('Timed out waiting for the Playwright Studio task.'));
    }, 10_000);
    const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.source !== 'Playwright Studio') return;
      clearTimeout(timeout);
      disposable.dispose();
      if (event.exitCode === 0) resolve();
      else reject(new Error(`Playwright Studio task exited with ${event.exitCode}`));
    });
  });
}

async function waitForDiagnostics(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages
      .getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === 'Playwright Studio');
    if (diagnostics.length > 0) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return [];
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'The integration workspace should be open.');
  const secondFolder = vscode.workspace.workspaceFolders?.find(
    (item) => item.name === 'workspace-two',
  );
  assert.ok(secondFolder, 'The second integration workspace root should be open.');
  const first = vscode.Uri.joinPath(folder.uri, 'tests', 'first.spec.ts');
  const second = vscode.Uri.joinPath(folder.uri, 'tests', 'second.spec.ts');
  const locators = vscode.Uri.joinPath(folder.uri, 'tests', 'locators.spec.ts');
  const coverage = vscode.Uri.joinPath(folder.uri, 'coverage-final.json');
  const third = vscode.Uri.joinPath(secondFolder.uri, 'tests', 'third.spec.ts');
  const extension = vscode.extensions.getExtension('sumanthtps.playwright-test-code-snippets');
  assert.ok(extension, 'Extension should be discoverable.');
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes('playwrightSnippets.runFile'));
  assert.ok(commands.includes('playwrightSnippets.runTestAtCursor'));
  assert.ok(commands.includes('playwrightSnippets.runMatrix'));
  assert.ok(commands.includes('playwrightSnippets.openUIMode'));
  assert.ok(commands.includes('playwrightSnippets.cancelRuns'));
  assert.ok(commands.includes('playwrightSnippets.manageRunPresets'));
  assert.ok(commands.includes('playwrightSnippets.setupVideoOverride'));
  assert.ok(commands.includes('playwrightSnippets.generateTestsFromPlan'));
  assert.ok(commands.includes('playwrightSnippets.postGitHubComment'));

  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
    'vscode.executeCodeLensProvider',
    first,
  );
  assert.ok(lenses?.some((lens) => lens.command?.title === '@smoke'));
  assert.ok(lenses?.some((lens) => lens.command?.title === '@fast'));

  const firstEditor = await vscode.window.showTextDocument(first, {
    viewColumn: vscode.ViewColumn.One,
  });
  firstEditor.selection = new vscode.Selection(1, 0, 1, 0);
  await vscode.commands.executeCommand('playwrightSnippets.quarantineTest');
  assert.match(firstEditor.document.lineAt(1).text, /test\.fixme\s*\(/);
  await vscode.commands.executeCommand('playwrightSnippets.unquarantineTest');
  assert.match(firstEditor.document.lineAt(1).text, /^test\s*\(/);
  const outsideLine = firstEditor.document.lineCount - 1;
  firstEditor.selection = new vscode.Selection(outsideLine, 0, outsideLine, 0);
  const firstTask = waitForTask();
  await vscode.commands.executeCommand('playwrightSnippets.runTestAtCursor');
  await firstTask;
  const invocation = JSON.parse(
    fs.readFileSync(path.join(folder.uri.fsPath, 'last-invocation.json'), 'utf8'),
  ) as { argv: string[] };
  assert.doesNotMatch(invocation.argv[0], /:\d+$/, 'Cursor outside a test should run the file.');

  await vscode.window.showTextDocument(second, { viewColumn: vscode.ViewColumn.Two });
  const firstDiagnostics = await waitForDiagnostics(first);
  const secondDiagnostics = await waitForDiagnostics(second);
  assert.equal(firstDiagnostics.length, 1);
  assert.equal(secondDiagnostics.length, 1);
  assert.equal(firstDiagnostics[0].message, '[chromium] first failed');
  assert.equal(secondDiagnostics[0].message, '[chromium] second failed');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    vscode.languages.getDiagnostics(second).filter((d) => d.source === 'Playwright Studio').length,
    1,
    'Diagnostics for hidden files should remain in the Problems panel.',
  );

  const secondRootTask = waitForTask();
  await vscode.commands.executeCommand('playwrightSnippets.runFile', third);
  await secondRootTask;
  const thirdDiagnostics = await waitForDiagnostics(third);
  assert.equal(thirdDiagnostics.length, 1);
  assert.equal(thirdDiagnostics[0].message, '[webkit] third failed');
  assert.equal(
    vscode.languages.getDiagnostics(first).filter((d) => d.source === 'Playwright Studio').length,
    1,
    'A result from another workspace root must not erase existing diagnostics.',
  );

  const reportTask = waitForTask();
  await vscode.commands.executeCommand('playwrightSnippets.showReport', first);
  await reportTask;
  const toolInvocation = JSON.parse(
    fs.readFileSync(path.join(folder.uri.fsPath, 'last-tool-invocation.json'), 'utf8'),
  ) as { argv: string[] };
  assert.deepEqual(toolInvocation.argv, [
    'show-report',
    path.join(folder.uri.fsPath, 'custom-report'),
  ]);

  const locatorDocument = await vscode.workspace.openTextDocument(locators);
  await vscode.window.showTextDocument(locatorDocument);
  const locatorDiagnostics = await waitForDiagnostics(locators);
  assert.ok(locatorDiagnostics.some((diagnostic) => diagnostic.code === 'semantic-locator'));
  const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
    'vscode.executeCodeActionProvider',
    locators,
    locatorDiagnostics.find((diagnostic) => diagnostic.code === 'semantic-locator')!.range,
  );
  assert.ok(
    actions?.some((action) => 'title' in action && action.title === 'Convert to semantic locator'),
  );

  await vscode.commands.executeCommand('playwrightSnippets.importCoverage', coverage);
  await vscode.commands.executeCommand('playwrightSnippets.openArtifact', {
    spec: {
      title: 'artifact smoke test',
      file: first.fsPath,
      line: 1,
      status: 'passed',
      duration: 1,
      attachments: [],
    },
  });
  let artifactTab: vscode.TabInputWebview | undefined;
  const webviewDeadline = Date.now() + 3_000;
  while (!artifactTab && Date.now() < webviewDeadline) {
    artifactTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => tab.input)
      .find((input): input is vscode.TabInputWebview => input instanceof vscode.TabInputWebview);
    if (!artifactTab) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(artifactTab instanceof vscode.TabInputWebview);
  await featureChecks(folder);
}
