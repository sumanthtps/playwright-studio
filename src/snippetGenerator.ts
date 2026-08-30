import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseSnippetFile, upsertSnippet } from './snippetFile';

function getUserSnippetsDir(context: vscode.ExtensionContext): string {
  // globalStorageUri follows the active VS Code product/profile/user-data directory.
  // Walk from User[/profiles/<id>]/globalStorage/<extension-id> to its snippets sibling.
  const profileRoot = path.dirname(path.dirname(context.globalStorageUri.fsPath));
  return path.join(profileRoot, 'snippets');
}

export async function saveAsSnippet(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showErrorMessage('No active editor.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    await vscode.window.showErrorMessage('Select code to save as a snippet first.');
    return;
  }

  const selectedText = editor.document.getText(selection);

  const prefix = await vscode.window.showInputBox({
    prompt: 'Snippet prefix — the shortcut you type to trigger it',
    placeHolder: 'e.g. p-my-login-flow',
    validateInput: v => (v?.trim() ? undefined : 'Prefix is required'),
  });
  if (!prefix) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Snippet name — a short human-readable description',
    placeHolder: 'e.g. My login flow snippet',
    value: prefix,
    validateInput: value => (value?.trim() ? undefined : 'Name is required'),
  });
  if (!name) return;

  const snippetsDir = getUserSnippetsDir(context);
  const snippetsFile = path.join(snippetsDir, 'playwright-custom.code-snippets');

  let existing: Record<string, unknown> = {};
  let original = '{}\n';
  if (fs.existsSync(snippetsFile)) {
    try {
      original = fs.readFileSync(snippetsFile, 'utf8');
      existing = parseSnippetFile(original);
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Cannot save the snippet because ${path.basename(snippetsFile)} is not valid JSON. ` +
        `Fix the file first; its existing contents were left unchanged. (${String(error)})`
      );
      return;
    }
  }

  const snippetName = name.trim();
  if (Object.prototype.hasOwnProperty.call(existing, snippetName)) {
    const choice = await vscode.window.showWarningMessage(
      `A snippet named "${snippetName}" already exists. Replace it?`,
      { modal: true },
      'Replace'
    );
    if (choice !== 'Replace') return;
  }

  // Split into lines and escape $ signs
  const body = selectedText.split('\n').map(line => line.replace(/\$/g, '\\$'));

  const snippet = {
    prefix: prefix.trim(),
    body,
    description: snippetName,
    scope: 'javascript,typescript,javascriptreact,typescriptreact',
  };

  try {
    fs.mkdirSync(snippetsDir, { recursive: true });
    const temporary = `${snippetsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, upsertSnippet(original, snippetName, snippet));
    try {
      fs.renameSync(temporary, snippetsFile);
    } catch {
      // Windows may not replace an existing destination atomically.
      fs.copyFileSync(temporary, snippetsFile);
      fs.unlinkSync(temporary);
    }

    const action = await vscode.window.showInformationMessage(
      `Snippet "${prefix}" saved to playwright-custom.code-snippets`,
      'View File'
    );
    if (action === 'View File') {
      await vscode.window.showTextDocument(vscode.Uri.file(snippetsFile));
    }
  } catch (err) {
    await vscode.window.showErrorMessage(`Failed to save snippet: ${String(err)}`);
  }
}
