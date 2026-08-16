import * as vscode from 'vscode';
import { extractFixtureDefinitions } from './fixtureParser';
import { isTestFile } from './testParser';

interface FixtureDef {
  name: string;
  uri: vscode.Uri;
  position: vscode.Position;
}

// Matches files that define fixtures via extend
const EXTEND_RE = /\.extend\s*[<(]/;

let cachedIndex: FixtureDef[] | null = null;
let cacheInvalidated = false;

async function buildIndex(): Promise<FixtureDef[]> {
  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
    '{**/node_modules/**,**/dist/**,**/build/**}'
  );

  const defs: FixtureDef[] = [];

  for (const file of files) {
    try {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();
      if (!EXTEND_RE.test(text)) continue;

      for (const def of extractFixtureDefinitions(text)) {
        defs.push({
          name: def.name,
          uri: file,
          position: new vscode.Position(def.line, def.column),
        });
      }
    } catch {
      // skip unreadable files
    }
  }

  return defs;
}

async function getIndex(): Promise<FixtureDef[]> {
  if (!cachedIndex || cacheInvalidated) {
    cachedIndex = await buildIndex();
    cacheInvalidated = false;
  }
  return cachedIndex;
}

export function invalidateFixtureIndex(): void {
  cacheInvalidated = true;
}

export class FixtureNavigationProvider
  implements vscode.DefinitionProvider, vscode.HoverProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'
    );
    watcher.onDidChange(() => invalidateFixtureIndex());
    watcher.onDidCreate(() => invalidateFixtureIndex());
    watcher.onDidDelete(() => invalidateFixtureIndex());
    this.disposables.push(watcher);
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[]> {
    if (!isTestFile(document)) return [];
    const range = document.getWordRangeAtPosition(position);
    if (!range || !isFixtureReference(document, range)) return [];
    const word = document.getText(range);
    const index = await getIndex();
    return index
      .filter(d => d.name === word)
      .map(d => new vscode.Location(d.uri, d.position));
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (!isTestFile(document)) return undefined;
    const range = document.getWordRangeAtPosition(position);
    if (!range || !isFixtureReference(document, range)) return undefined;
    const word = document.getText(range);
    const index = await getIndex();
    const matches = index.filter(d => d.name === word);
    if (matches.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown(`**Playwright Fixture: \`${word}\`**\n\n`);
    for (const def of matches) {
      const rel = escapeMarkdown(vscode.workspace.asRelativePath(def.uri));
      const line = def.position.line + 1;
      md.appendMarkdown(
        `Defined in [${rel}:${line}](${def.uri.with({ fragment: `L${line}` })})\n\n`
      );
    }
    return new vscode.Hover(md, range);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

function isFixtureReference(document: vscode.TextDocument, range: vscode.Range): boolean {
  const offset = document.offsetAt(range.start);
  const before = document.getText().slice(Math.max(0, offset - 2000), offset);
  const openBrace = before.lastIndexOf('{');
  const closeBrace = before.lastIndexOf('}');
  if (openBrace < 0 || closeBrace > openBrace) return false;
  return /(?:async\s*)?\(\s*$/.test(before.slice(0, openBrace));
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, '\\$&');
}
