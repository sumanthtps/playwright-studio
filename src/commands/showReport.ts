import * as vscode from 'vscode';
import { buildToolCommand } from '../config';
import { runCommand } from '../terminal';

export async function showReport(resource?: vscode.Uri | string): Promise<void> {
  const resolvedResource = resource ?? vscode.window.activeTextEditor?.document.uri;
  await runCommand(buildToolCommand('show-report', [], resolvedResource), {
    resource: resolvedResource,
    name: 'Playwright HTML Report',
  });
}
