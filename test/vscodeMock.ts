import * as fs from 'node:fs';
import * as path from 'node:path';
export class Disposable {
  constructor(private fn = () => {}) {}
  dispose() {
    this.fn();
  }
}
export class EventEmitter<T> {
  listeners = new Set<(value: T) => void>();
  event = (fn: (value: T) => void) => {
    this.listeners.add(fn);
    return new Disposable(() => this.listeners.delete(fn));
  };
  fire(value: T) {
    for (const fn of [...this.listeners]) fn(value);
  }
  dispose() {
    this.listeners.clear();
  }
}
export class CancellationTokenSource {
  private emitter = new EventEmitter<void>();
  token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event };
  cancel() {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
  dispose() {
    this.emitter.dispose();
  }
}
export class Uri {
  scheme = 'file';
  constructor(public fsPath: string) {}
  static file(value: string) {
    return new Uri(path.resolve(value));
  }
  static parse(value: string) {
    if (value.startsWith('file:')) return Uri.file(new URL(value).pathname);
    const uri = new Uri(value);
    uri.scheme = value.split(':')[0];
    return uri;
  }
  static joinPath(base: Uri, ...parts: string[]) {
    return Uri.file(path.join(base.fsPath, ...parts));
  }
  toString() {
    return this.scheme === 'file' ? `file://${this.fsPath}` : this.fsPath;
  }
}
export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}
export class TestMessage {
  constructor(public message: string) {}
}
export class TestTag {
  constructor(public id: string) {}
}
export class TestRunRequest {
  constructor(
    public include?: unknown[],
    public exclude?: unknown[],
    public profile?: unknown,
    public continuous = false,
  ) {}
}
export const TestRunProfileKind = { Run: 1, Debug: 2, Coverage: 3 };
export const tests = {
  createTestController: () => {
    throw new Error('Supply an explicit test controller in mock tests.');
  },
};
export class FileCoverage {
  static fromDetails(uri: Uri, details: unknown[]) {
    return { uri, details };
  }
}
export class BranchCoverage {
  constructor(
    public executed: number,
    public location?: any,
    public label?: string,
  ) {}
}
export class StatementCoverage {
  constructor(
    public executed: number,
    public location: any,
    public branches: BranchCoverage[] = [],
  ) {}
}
export class DeclarationCoverage {
  constructor(
    public name: string,
    public executed: number,
    public location: any,
  ) {}
}
export class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    this.start = a instanceof Position ? a : new Position(a, b as number);
    this.end = b instanceof Position ? b : new Position(c!, d!);
  }
}
export class TreeItem {
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}
export class ThemeIcon {
  constructor(..._args: unknown[]) {}
}
export class ThemeColor {
  constructor(..._args: unknown[]) {}
}
export class RelativePattern {
  constructor(
    public base: unknown,
    public pattern: string,
  ) {}
}
export class ProcessExecution {
  constructor(
    public process: string,
    public args: string[],
    public options: any,
  ) {}
}
export class Task {
  presentationOptions: unknown;
  constructor(
    public definition: unknown,
    public scope: unknown,
    public name: string,
    public source: string,
    public execution: ProcessExecution,
    ..._rest: unknown[]
  ) {}
}
export class MarkdownString {
  value = '';
  appendMarkdown(value: string) {
    this.value += value;
  }
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const TaskScope = { Workspace: 1 };
export const TaskRevealKind = { Always: 1 };
export const TaskPanelKind = { Shared: 1 };
export const ConfigurationTarget = { WorkspaceFolder: 3 };
export const ProgressLocation = { Window: 1, Notification: 15 };
export const QuickPickItemKind = { Separator: -1 };
export const ViewColumn = { Beside: 2 };
export const CodeActionKind = { QuickFix: 'quickfix' };
export const state = {
  root: '',
  settings: {} as Record<string, any>,
  handlers: new Map<string, (...args: any[]) => any>(),
  picks: [] as any[],
  inputs: [] as any[],
  messages: [] as any[],
  errors: [] as string[],
  tasks: [] as Task[],
  debug: [] as any[],
  calls: [] as any[],
  clipboard: '',
  documents: [] as any[],
  files: [] as Uri[],
  save: undefined as Uri | undefined,
  exitCode: 0,
  processEvent: true,
  panels: [] as any[],
  open: undefined as Uri[] | undefined,
};
const taskEnd = new EventEmitter<any>(),
  processStart = new EventEmitter<any>(),
  processEnd = new EventEmitter<any>();
const debugStart = new EventEmitter<any>(),
  debugEnd = new EventEmitter<any>();
function document(uri: Uri, content: string) {
  const offset = (pos: Position) =>
    content
      .split('\n')
      .slice(0, pos.line)
      .reduce((sum, line) => sum + line.length + 1, 0) + pos.character;
  return {
    uri,
    fileName: uri.fsPath,
    languageId: 'typescript',
    getText: (range?: Range) =>
      range ? content.slice(offset(range.start), offset(range.end)) : content,
    lineAt: (line: number) => ({ text: content.split('\n')[line] }),
    replace: (range: Range, value: string) => {
      content = content.slice(0, offset(range.start)) + value + content.slice(offset(range.end));
    },
  };
}
export function editor(file: string, content = "test('example', async () => {});") {
  const doc = document(Uri.file(file), content);
  return {
    document: doc,
    selection: {
      active: { line: 0 },
      isEmpty: false,
      start: new Position(0, 0),
      end: new Position(0, content.length),
    },
    edit: async (fn: any) => {
      fn({ replace: doc.replace });
      return true;
    },
  };
}
export const workspace = {
  isTrusted: true,
  textDocuments: [] as any[],
  get workspaceFolders() {
    return [{ uri: Uri.file(state.root), name: 'fixture', index: 0 }];
  },
  getWorkspaceFolder: (uri: Uri) =>
    uri.fsPath.startsWith(state.root + path.sep) || uri.fsPath === state.root
      ? workspace.workspaceFolders[0]
      : undefined,
  getConfiguration: () => ({
    get: (key: string, fallback?: unknown) => state.settings[key] ?? fallback,
    update: async (key: string, value: unknown) => {
      state.settings[key] = value;
    },
  }),
  findFiles: async () => state.files,
  asRelativePath: (uri: Uri) => path.relative(state.root, uri.fsPath),
  openTextDocument: async (input: any) => {
    const doc =
      typeof input?.content === 'string'
        ? document(new Uri('untitled'), input.content)
        : document(
            input instanceof Uri ? input : Uri.file(input),
            fs.readFileSync(input instanceof Uri ? input.fsPath : input, 'utf8'),
          );
    state.documents.push(doc);
    return doc;
  },
  fs: { writeFile: async (uri: Uri, bytes: Uint8Array) => fs.writeFileSync(uri.fsPath, bytes) },
};
export const window = {
  createWebviewPanel: (_type: string, title: string, ..._args: any[]) => {
    const message = new EventEmitter<any>(),
      dispose = new EventEmitter<void>();
    const panel = {
      title,
      options: _args[1],
      webview: {
        html: '',
        posted: [] as unknown[],
        postMessage(message: unknown) {
          this.posted.push(message);
          return Promise.resolve(true);
        },
        cspSource: 'https://studio.invalid',
        asWebviewUri: (uri: Uri) => uri,
        onDidReceiveMessage: message.event,
      },
      onDidDispose: dispose.event,
      reveal() {
        if (!state.panels.includes(panel)) state.panels.push(panel);
      },
      dispose() {
        dispose.fire();
      },
      receive: async (value: any) => {
        for (const listener of message.listeners) await listener(value);
      },
    };
    state.panels.push(panel);
    return panel;
  },
  activeTextEditor: undefined as any,
  showQuickPick: async (items: any[], options: any) => {
    const response = state.picks.shift();
    return typeof response === 'function'
      ? response(items, options)
      : typeof response === 'number'
        ? items[response]
        : response;
  },
  showInputBox: async (options: any) => {
    const response = state.inputs.shift();
    if (response !== undefined && options?.validateInput?.(response))
      throw new Error(options.validateInput(response));
    return response;
  },
  showInformationMessage: async (..._args: any[]) => state.messages.shift(),
  showWarningMessage: async (...args: any[]) => {
    const response = state.messages.shift();
    return typeof response === 'function' ? response(...args) : response;
  },
  showErrorMessage: async (message: string) => {
    state.errors.push(message);
  },
  showTextDocument: async (input: any) => {
    state.calls.push(['showDocument', input]);
    return input;
  },
  showSaveDialog: async () => state.save,
  showOpenDialog: async () => state.open,
  withProgress: async (_: any, fn: any) => fn({ report() {} }, new CancellationTokenSource().token),
};
export const commands = {
  registerCommand: (id: string, fn: any) => {
    state.handlers.set(id, fn);
    return new Disposable(() => state.handlers.delete(id));
  },
  executeCommand: async (id: string, ...args: any[]) => {
    state.calls.push([id, ...args]);
    return state.handlers.get(id)?.(...args);
  },
};
export const env = {
  clipboard: {
    writeText: async (text: string) => {
      state.clipboard = text;
    },
  },
  openExternal: async (uri: Uri) => {
    state.calls.push(['external', uri]);
    return true;
  },
};
export const tasks = {
  onDidStartTaskProcess: processStart.event,
  onDidEndTask: taskEnd.event,
  onDidEndTaskProcess: processEnd.event,
  executeTask: async (task: Task) => {
    state.tasks.push(task);
    const execution = { task, terminate: () => taskEnd.fire({ execution }) };
    // End before executeTask resolves to exercise event ordering.
    processStart.fire({ execution, processId: 1 });
    if (state.processEvent) processEnd.fire({ execution, exitCode: state.exitCode });
    taskEnd.fire({ execution });
    return execution;
  },
};
export const debug = {
  onDidStartDebugSession: debugStart.event,
  onDidTerminateDebugSession: debugEnd.event,
  startDebugging: async (_: unknown, configuration: any) => {
    state.debug.push(configuration);
    const session = { configuration };
    debugStart.fire(session);
    debugEnd.fire(session);
    return true;
  },
  stopDebugging: async (session: any) => {
    state.calls.push(['stopDebug', session]);
    debugEnd.fire(session);
  },
};
export function reset(root: string) {
  Object.assign(state, {
    root,
    settings: { testCommand: 'npx playwright test', reporter: 'list' },
    picks: [],
    inputs: [],
    messages: [],
    errors: [],
    tasks: [],
    debug: [],
    calls: [],
    clipboard: '',
    documents: [],
    files: [],
    save: undefined,
    exitCode: 0,
    processEvent: true,
    panels: [],
    open: undefined,
  });
  window.activeTextEditor = editor(path.join(root, 'example.spec.ts'));
}
