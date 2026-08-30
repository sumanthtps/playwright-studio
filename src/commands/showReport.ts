import * as vscode from 'vscode';
import * as path from 'path';
import { buildToolCommand, getConfig } from '../config';
import { runCommand } from '../terminal';

export async function showReport(resource?: vscode.Uri | string): Promise<void> {
  const resolvedResource = resource ?? vscode.window.activeTextEditor?.document.uri;
  const { reportPath, workingDirectory } = getConfig(resolvedResource);
  const configuredPath = reportPath.trim();
  const args = configuredPath
    ? [path.isAbsolute(configuredPath) ? configuredPath : path.resolve(workingDirectory, configuredPath)]
    : [];
  await runCommand(buildToolCommand('show-report', args, resolvedResource), {
    resource: resolvedResource,
    name: 'Playwright HTML Report',
  });
}
