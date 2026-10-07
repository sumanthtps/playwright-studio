import * as vscode from 'vscode';
import { getResultsBaseDir } from './resultsPath';
import { readableFileInRoots } from './fileSecurity';

export function requireWorkspaceTrust(): void {
  if (vscode.workspace.isTrusted !== true) {
    throw new Error(
      'Trust this workspace in VS Code before running Playwright tools or changing workspace files.',
    );
  }
}

export function artifactRoots(context?: vscode.ExtensionContext): string[] {
  return [
    ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []),
    context ? (context.storageUri ?? context.globalStorageUri).fsPath : getResultsBaseDir(),
  ];
}

export function artifactFile(
  candidate: unknown,
  context?: vscode.ExtensionContext,
): string | undefined {
  return typeof candidate === 'string'
    ? readableFileInRoots(candidate, artifactRoots(context))
    : undefined;
}
