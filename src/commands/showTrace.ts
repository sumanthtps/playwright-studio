import * as vscode from 'vscode';
import { buildToolCommand, getConfig } from '../config';
import { runCommand } from '../terminal';

export async function showTrace(traceFilePath?: string): Promise<void> {
  let tracePath: string;

  if (traceFilePath) {
    tracePath = traceFilePath;
  } else {
    const { workingDirectory } = getConfig();
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Open Trace',
      filters: { 'Playwright Trace': ['zip'] },
      defaultUri: vscode.Uri.file(workingDirectory),
    });

    if (!uris || uris.length === 0) return;
    tracePath = uris[0].fsPath;
  }

  await runCommand(buildToolCommand('show-trace', [tracePath]), {
    resource: tracePath,
    name: 'Playwright Trace Viewer',
  });
}
