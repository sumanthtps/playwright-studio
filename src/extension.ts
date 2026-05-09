import * as vscode from 'vscode';
import * as fs from 'fs';
import { PlaywrightCodeLensProvider } from './codeLensProvider';
import { registerCommands } from './commands/index';
import { disposeTerminal, setExtraEnvProvider } from './terminal';
import { ResultStore } from './resultStore';
import { GutterDecorationManager } from './gutterDecorations';
import { TestResultsViewProvider } from './testResultsView';
import { EnvProfileManager } from './envProfile';
import { StatusBarManager } from './statusBar';
import { CoverageHeatmap } from './coverageHeatmap';
import { FixtureNavigationProvider } from './fixtureNavigation';
import { setResultsBaseDir } from './resultsPath';

export function activate(context: vscode.ExtensionContext): void {
  // Store run results outside the user's repo, in VS Code-managed extension storage.
  const storageUri = context.storageUri ?? context.globalStorageUri;
  fs.mkdirSync(storageUri.fsPath, { recursive: true });
  setResultsBaseDir(storageUri.fsPath);

  // Core providers
  const codeLens = new PlaywrightCodeLensProvider();
  const store = new ResultStore(context);
  const profiles = new EnvProfileManager(context);

  // Wire profile env into the terminal
  setExtraEnvProvider(() => profiles.getActiveEnv());
  profiles.onDidChange(() => setExtraEnvProvider(() => profiles.getActiveEnv()));

  // Register CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
      ],
      codeLens
    )
  );

  // Feature 1: Sidebar results tree view
  const resultsView = new TestResultsViewProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playwrightStudio.resultsView', resultsView)
  );

  // Features 2 & 11: Gutter decorations + failure diagnostics with trace links
  const gutterManager = new GutterDecorationManager(context, store);
  context.subscriptions.push(gutterManager);

  // Feature 5 + 9: Status bar (env profile switcher + last run summary)
  const statusBar = new StatusBarManager(store, profiles);
  context.subscriptions.push(statusBar);

  // Feature 6: Coverage heatmap
  const heatmap = new CoverageHeatmap(context, store);
  context.subscriptions.push(heatmap);

  // Feature 7: Fixture navigation (definition + hover)
  const fixtureNav = new FixtureNavigationProvider();
  const langSelector = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
  ];
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(langSelector, fixtureNav),
    vscode.languages.registerHoverProvider(langSelector, fixtureNav),
    fixtureNav
  );

  // Register all commands (features 3, 4, 5, 8 and existing)
  registerCommands(context, codeLens, profiles);

  // Start watching AFTER all providers are subscribed so they catch the initial load
  store.start();

  // Refresh code lenses on save/open
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => codeLens.refresh()),
    vscode.workspace.onDidOpenTextDocument(() => codeLens.refresh())
  );
}

export function deactivate(): void {
  disposeTerminal();
}
