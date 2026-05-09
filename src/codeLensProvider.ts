import * as vscode from 'vscode';
import { isTestFile, parseTests } from './testParser';

export class PlaywrightCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isTestFile(document)) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const items = parseTests(document);
    const fileRange = new vscode.Range(0, 0, 0, 0);
    const filePath = document.uri.fsPath;

    // File-level lenses
    lenses.push(
      new vscode.CodeLens(fileRange, {
        title: '$(play) Run All',
        command: 'playwrightSnippets.runFile',
        arguments: [filePath],
        tooltip: 'Run All Tests in File',
      }),
      new vscode.CodeLens(fileRange, {
        title: '$(debug) Debug All',
        command: 'playwrightSnippets.debugFile',
        arguments: [filePath],
        tooltip: 'Debug All Tests in File',
      }),
      new vscode.CodeLens(fileRange, {
        title: '$(eye) Inspect All',
        command: 'playwrightSnippets.inspectFile',
        arguments: [filePath],
        tooltip: 'Inspect All Tests in File',
      }),
      new vscode.CodeLens(fileRange, {
        title: '$(tag) Tag',
        command: 'playwrightSnippets.runWithTag',
        arguments: [filePath],
        tooltip: 'Run with Tag / Grep Filter',
      }),
      new vscode.CodeLens(fileRange, {
        title: '$(layers) Project',
        command: 'playwrightSnippets.runWithProject',
        arguments: [filePath],
        tooltip: 'Run with Project Selection',
      })
    );

    for (const item of items) {
      const range = new vscode.Range(item.line, 0, item.line, 0);

      if (item.kind === 'test') {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '$(play) Run',
            command: 'playwrightSnippets.runTest',
            arguments: [filePath, item.name],
            tooltip: 'Run Test',
          }),
          new vscode.CodeLens(range, {
            title: '$(debug) Debug',
            command: 'playwrightSnippets.debugTest',
            arguments: [filePath, item.name],
            tooltip: 'Debug Test',
          }),
          new vscode.CodeLens(range, {
            title: '$(eye) Inspect',
            command: 'playwrightSnippets.inspectTest',
            arguments: [filePath, item.name],
            tooltip: 'Inspect Test',
          })
        );

        // Per-test tag lenses
        for (const tag of item.tags) {
          lenses.push(
            new vscode.CodeLens(range, {
              title: tag,
              command: 'playwrightSnippets.runWithTag',
              arguments: [filePath, tag],
              tooltip: `Run all tests tagged ${tag}`,
            })
          );
        }
        continue;
      }

      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(play) Run Suite',
          command: 'playwrightSnippets.runTest',
          arguments: [filePath, item.name],
          tooltip: 'Run Suite',
        }),
        new vscode.CodeLens(range, {
          title: '$(debug) Debug Suite',
          command: 'playwrightSnippets.debugTest',
          arguments: [filePath, item.name],
          tooltip: 'Debug Suite',
        }),
        new vscode.CodeLens(range, {
          title: '$(eye) Inspect Suite',
          command: 'playwrightSnippets.inspectTest',
          arguments: [filePath, item.name],
          tooltip: 'Inspect Suite',
        })
      );
    }

    return lenses;
  }
}
