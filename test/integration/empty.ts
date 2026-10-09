import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders?.length ?? 0, 0);
  const extension = vscode.extensions.getExtension('sumanthtps.playwright-test-code-snippets');
  assert.ok(extension);
  await extension.activate();
  for (const view of [
    'testsView',
    'resultsView',
    'historyView',
    'componentsView',
    'annotationsView',
    'featuresView',
  ]) {
    await vscode.commands.executeCommand(`playwrightStudio.${view}.focus`);
    console.log(`PASS empty-window sidebar view: ${view}`);
  }
}
