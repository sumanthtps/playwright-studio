import * as vscode from 'vscode';

interface FixtureDef {
  name: string;
  uri: vscode.Uri;
  position: vscode.Position;
}

// Matches fixture implementation keys: `  myFixture: async ({ ... }, use) =>`
const FIXTURE_IMPL_RE = /^(\s{1,6})(\w+)\s*:\s*async\s*\(/;
// Matches files that define fixtures via extend
const EXTEND_RE = /\.extend\s*[<(]/;

let cachedIndex: FixtureDef[] | null = null;
let cacheInvalidated = false;

async function buildIndex(): Promise<FixtureDef[]> {
  const files = await vscode.workspace.findFiles(
    '**/*.{ts,js}',
    '{**/node_modules/**,**/dist/**,**/build/**}'
  );

  const defs: FixtureDef[] = [];

  for (const file of files) {
    try {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();
      if (!EXTEND_RE.test(text)) continue;

      let inExtendBody = false;
      let braceDepth = 0;

      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text;

        if (!inExtendBody) {
          if (EXTEND_RE.test(line)) {
            inExtendBody = true;
            braceDepth = 0;
          }
          continue;
        }

        braceDepth += (line.match(/\{/g) ?? []).length;
        braceDepth -= (line.match(/\}/g) ?? []).length;

        if (braceDepth <= 0 && i > 0) {
          inExtendBody = false;
          continue;
        }

        const match = FIXTURE_IMPL_RE.exec(line);
        if (match) {
          const col = line.indexOf(match[2]);
          defs.push({ name: match[2], uri: file, position: new vscode.Position(i, col) });
        }
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
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js}');
    watcher.onDidChange(() => invalidateFixtureIndex());
    watcher.onDidCreate(() => invalidateFixtureIndex());
    watcher.onDidDelete(() => invalidateFixtureIndex());
    this.disposables.push(watcher);
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[]> {
    const word = document.getText(document.getWordRangeAtPosition(position));
    if (!word) return [];
    const index = await getIndex();
    return index
      .filter(d => d.name === word)
      .map(d => new vscode.Location(d.uri, d.position));
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return undefined;
    const word = document.getText(range);
    const index = await getIndex();
    const matches = index.filter(d => d.name === word);
    if (matches.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**Playwright Fixture: \`${word}\`**\n\n`);
    for (const def of matches) {
      const rel = vscode.workspace.asRelativePath(def.uri);
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
