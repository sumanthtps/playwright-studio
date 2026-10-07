import * as vscode from 'vscode';

const LOCATOR_CALL = /\b(page|this\.page)\.locator\(\s*(['"`])([^\n]*?)\2\s*\)/g;
const LEGACY_CALL = /\b(page|this\.page)\.(click|check|uncheck|hover)\(\s*(['"`])([^\n]*?)\3\s*\)/g;

function searchableSource(source: string, maskQuotedStrings: boolean): string {
  const output = source.split('');
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code';
  let escaped = false;
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
    if (state !== 'code') {
      if (state === 'template' || maskQuotedStrings) {
        if (char !== '\n' && char !== '\r') output[i] = ' ';
      }
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      )
        state = 'code';
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
      state = char === "'" ? 'single' : char === '"' ? 'double' : 'template';
      if (state === 'template' || maskQuotedStrings) output[i] = ' ';
    }
  }
  return output.join('');
}

export function semanticLocatorReplacement(original: string): string | undefined {
  LOCATOR_CALL.lastIndex = 0;
  const match = LOCATOR_CALL.exec(original);
  LOCATOR_CALL.lastIndex = 0;
  if (!match) return undefined;
  const receiver = match[1];
  const selector = match[3];
  // Escaped strings, interpolation and text-engine regexes need a full parser;
  // do not offer a rewrite that changes what they match.
  if (selector.includes('\\') || (match[2] === '`' && selector.includes('${'))) return undefined;
  if (selector.startsWith('text=')) {
    const text = selector.slice(5);
    if (/^["'/]/.test(text)) return undefined;
    return `${receiver}.getByText(${JSON.stringify(text)})`;
  }
  const testId = /^\[data-testid=["']?([^\]"']+)["']?\]$/.exec(selector);
  if (testId) return `${receiver}.getByTestId(${JSON.stringify(testId[1])})`;
  const label = /^\[aria-label=["']?([^\]"']+)["']?\]$/.exec(selector);
  if (label) return `${receiver}.getByLabel(${JSON.stringify(label[1])}, { exact: true })`;
  const placeholder = /^\[placeholder=["']?([^\]"']+)["']?\]$/.exec(selector);
  if (placeholder)
    return `${receiver}.getByPlaceholder(${JSON.stringify(placeholder[1])}, { exact: true })`;
  const role = /^role=([\w-]+)(?:\[name=["']?([^\]"']+)["']?\])?$/.exec(selector);
  if (role)
    return `${receiver}.getByRole(${JSON.stringify(role[1])}${role[2] ? `, { name: ${JSON.stringify(role[2])} }` : ''})`;
  return undefined;
}

export function legacyLocatorReplacement(original: string): string | undefined {
  LEGACY_CALL.lastIndex = 0;
  const match = LEGACY_CALL.exec(original);
  LEGACY_CALL.lastIndex = 0;
  if (!match) return undefined;
  return `${match[1]}.locator(${match[3]}${match[4]}${match[3]}).${match[2]}()`;
}

export class LocatorAssistant implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('playwrightLocators');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => this.inspect(document)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.supported(event.document)) return;
        const key = event.document.uri.toString();
        clearTimeout(this.timers.get(key));
        this.timers.set(
          key,
          setTimeout(() => {
            this.timers.delete(key);
            this.inspect(event.document);
          }, 150),
        );
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        clearTimeout(this.timers.get(document.uri.toString()));
        this.timers.delete(document.uri.toString());
        this.diagnostics.delete(document.uri);
      }),
    );
    for (const document of vscode.workspace.textDocuments) this.inspect(document);
  }

  private supported(document: vscode.TextDocument): boolean {
    return ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(
      document.languageId,
    );
  }

  private inspect(document: vscode.TextDocument): void {
    if (!this.supported(document)) return;
    const source = document.getText();
    if (source.length > 1024 * 1024) {
      this.diagnostics.delete(document.uri);
      return;
    }
    const searchable = searchableSource(source, false);
    const codeMask = searchableSource(source, true);
    const diagnostics: vscode.Diagnostic[] = [];
    LOCATOR_CALL.lastIndex = 0;
    for (const match of searchable.matchAll(LOCATOR_CALL)) {
      if (codeMask.slice(match.index, match.index! + match[1].length) !== match[1]) continue;
      const selector = match[3];
      let message: string | undefined;
      let code: string | undefined;
      if (/^(?:text=|role=|\[(?:data-testid|aria-label|placeholder)=)/.test(selector)) {
        message = 'This selector has a more readable, user-facing Playwright locator.';
        code = 'semantic-locator';
      } else if (/^(?:xpath=|\/\/)/.test(selector)) {
        message =
          'XPath selectors are brittle. Prefer getByRole, getByLabel, getByText, or getByTestId.';
        code = 'brittle-locator';
      } else if (
        /nth-child|nth-of-type|(?:^|\s)>\s|[.#][A-Za-z0-9_-]{12,}/.test(selector) ||
        selector.length > 100
      ) {
        message = 'This CSS locator may be coupled to implementation details.';
        code = 'brittle-locator';
      }
      if (!message || match.index === undefined) continue;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          document.positionAt(match.index),
          document.positionAt(match.index + match[0].length),
        ),
        message,
        code === 'semantic-locator'
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = 'Playwright Studio';
      diagnostic.code = code;
      diagnostics.push(diagnostic);
    }
    LEGACY_CALL.lastIndex = 0;
    for (const match of searchable.matchAll(LEGACY_CALL)) {
      if (codeMask.slice(match.index, match.index! + match[1].length) !== match[1]) continue;
      if (match.index === undefined) continue;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          document.positionAt(match.index),
          document.positionAt(match.index + match[0].length),
        ),
        `Prefer a Locator and call .${match[2]}() on it for auto-waiting and reuse.`,
        vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = 'Playwright Studio';
      diagnostic.code = 'legacy-selector-action';
      diagnostics.push(diagnostic);
    }
    const nth = /\.nth\(\s*\d+\s*\)/g;
    for (const match of codeMask.matchAll(nth)) {
      if (match.index === undefined) continue;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          document.positionAt(match.index),
          document.positionAt(match.index + match[0].length),
        ),
        'Index-based selection can silently target the wrong element when the UI changes.',
        vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = 'Playwright Studio';
      diagnostic.code = 'nth-locator';
      diagnostics.push(diagnostic);
    }
    this.diagnostics.set(document.uri, diagnostics);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics.filter(
      (item) => item.source === 'Playwright Studio',
    )) {
      const original = document.getText(diagnostic.range);
      if (diagnostic.code === 'semantic-locator') {
        const replacement = semanticLocatorReplacement(original);
        if (replacement) {
          const action = new vscode.CodeAction(
            'Convert to semantic locator',
            vscode.CodeActionKind.QuickFix,
          );
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, diagnostic.range, replacement);
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
      }
      if (diagnostic.code === 'legacy-selector-action') {
        const replacement = legacyLocatorReplacement(original);
        if (replacement) {
          const action = new vscode.CodeAction(
            'Convert to Locator action',
            vscode.CodeActionKind.QuickFix,
          );
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, diagnostic.range, replacement);
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
      }
      const picker = new vscode.CodeAction(
        'Open Playwright locator picker',
        vscode.CodeActionKind.QuickFix,
      );
      picker.command = {
        command: 'playwrightSnippets.openLocatorPicker',
        title: 'Open Playwright locator picker',
      };
      picker.diagnostics = [diagnostic];
      actions.push(picker);
    }
    return actions;
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.diagnostics.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
