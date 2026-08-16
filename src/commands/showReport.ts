import * as vscode from 'vscode';
import { buildToolCommand } from '../config';
import { runCommand } from '../terminal';

export async function showReport(resource?: vscode.Uri | string): Promise<void> {
  await runCommand(buildToolCommand('show-report'), {
    resource: resource ?? vscode.window.activeTextEditor?.document.uri,
    name: 'Playwright HTML Report',
  });
}
