import * as vscode from 'vscode';
import { buildToolCommand } from '../config';
import { runCommand } from '../terminal';

export async function codeGen(): Promise<void> {
  const url = await vscode.window.showInputBox({
    prompt: 'Enter starting URL for Playwright Codegen (leave blank to skip)',
    placeHolder: 'https://example.com',
    value: '',
  });

  if (url === undefined) {
    // User cancelled
    return;
  }

  const resource = vscode.window.activeTextEditor?.document.uri;
  await runCommand(buildToolCommand('codegen', url ? [url] : [], resource), {
    resource,
    name: 'Playwright Codegen',
  });
}
