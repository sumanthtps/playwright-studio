import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getUserSnippetsDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
      'snippets'
    );
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'snippets');
  }
  return path.join(home, '.config', 'Code', 'User', 'snippets');
}

export async function saveAsSnippet(): Promise<void> {
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

  const snippetsDir = getUserSnippetsDir();
  const snippetsFile = path.join(snippetsDir, 'playwright-custom.code-snippets');

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(snippetsFile)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(snippetsFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The top-level value must be an object.');
      }
      existing = parsed as Record<string, unknown>;
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

  existing[snippetName] = {
    prefix: prefix.trim(),
    body,
    description: snippetName,
    scope: 'javascript,typescript,javascriptreact,typescriptreact',
  };

  try {
    fs.mkdirSync(snippetsDir, { recursive: true });
    const temporary = `${snippetsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(existing, null, 2));
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
