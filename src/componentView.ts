import * as vscode from 'vscode';
import { readBoundedFile } from './fileSecurity';

const STORY_GLOB = '**/*.{stories,story}.{ts,tsx,js,jsx}';

function maskCommentsAndStrings(source: string): string {
  const output = source.split('');
  let state: 'code' | 'string' | 'line' | 'block' = 'code';
  let quote = '',
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i],
      next = source[i + 1];
    if (state === 'line') {
      if (char === '\n') state = 'code';
      else output[i] = ' ';
      continue;
    }
    if (state === 'block') {
      if (char !== '\n' && char !== '\r') output[i] = ' ';
      if (char === '*' && next === '/') {
        output[i + 1] = ' ';
        state = 'code';
        i++;
      }
      continue;
    }
    if (state === 'string') {
      if (char !== '\n' && char !== '\r') output[i] = ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') {
      output[i] = output[i + 1] = ' ';
      state = 'line';
      i++;
    } else if (char === '/' && next === '*') {
      output[i] = output[i + 1] = ' ';
      state = 'block';
      i++;
    } else if (char === "'" || char === '"' || char === '`') {
      output[i] = ' ';
      quote = char;
      state = 'string';
    }
  }
  return output.join('');
}

class StoryFileNode extends vscode.TreeItem {
  readonly kind = 'file' as const;
  constructor(
    public readonly uri: vscode.Uri,
    public readonly stories: StoryNode[],
  ) {
    super(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = uri;
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.description = `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`;
    this.contextValue = 'playwrightComponentFile';
  }
}

class StoryNode extends vscode.TreeItem {
  readonly kind = 'story' as const;
  constructor(
    public readonly uri: vscode.Uri,
    public readonly exportName: string,
    public readonly line: number,
  ) {
    super(exportName, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('preview');
    this.contextValue = 'playwrightComponentStory';
    this.command = {
      command: 'vscode.open',
      title: 'Open component story',
      arguments: [uri, { selection: new vscode.Range(line, 0, line, 0) }],
    };
  }
}

type ComponentNode = StoryFileNode | StoryNode;

export class ComponentViewProvider
  implements vscode.TreeDataProvider<ComponentNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<ComponentNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private files: StoryFileNode[] = [];
  private readonly watcher: vscode.FileSystemWatcher;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher(STORY_GLOB);
    this.watcher.onDidCreate(() => void this.refresh());
    this.watcher.onDidChange(() => void this.refresh());
    this.watcher.onDidDelete(() => void this.refresh());
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const uris = await vscode.workspace.findFiles(
      STORY_GLOB,
      '**/{node_modules,.git,dist,build}/**',
      5000,
    );
    const files: StoryFileNode[] = [];
    for (let index = 0; index < uris.length; index += 50) {
      files.push(
        ...(await Promise.all(
          uris.slice(index, index + 50).map(async (uri) => {
            const stories: StoryNode[] = [];
            let source: string;
            try {
              source = readBoundedFile(uri.fsPath, 4 * 1024 * 1024).toString('utf8');
            } catch {
              return new StoryFileNode(uri, []);
            }
            const code = maskCommentsAndStrings(source);
            const lineAt = (offset: number) => source.slice(0, offset).split('\n').length - 1;
            const patterns = [
              /\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
              /\bexport\s*\{([^}]+)\}/g,
            ];
            for (const match of code.matchAll(patterns[0])) {
              if (match.index !== undefined && match[1] !== 'meta')
                stories.push(new StoryNode(uri, match[1], lineAt(match.index)));
            }
            for (const match of code.matchAll(patterns[1])) {
              if (match.index === undefined) continue;
              for (const part of match[1].split(',')) {
                const name = part
                  .trim()
                  .split(/\s+as\s+/)
                  .at(-1);
                if (name && name !== 'default')
                  stories.push(new StoryNode(uri, name, lineAt(match.index)));
              }
            }
            return new StoryFileNode(uri, stories);
          }),
        )),
      );
    }
    this.files = files;
    this.files.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
    this.changed.fire(undefined);
  }

  getTreeItem(element: ComponentNode): vscode.TreeItem {
    return element;
  }
  getChildren(element?: ComponentNode): ComponentNode[] {
    if (!element) return this.files;
    return element.kind === 'file' ? element.stories : [];
  }

  dispose(): void {
    this.watcher.dispose();
    this.changed.dispose();
  }
}
