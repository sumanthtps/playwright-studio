import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
import { PlaywrightTestExplorer } from './testExplorer';
import { HistoryViewProvider } from './historyView';
import { LocatorAssistant } from './locatorAssistant';
import { ArtifactViewer } from './artifactViewer';
import { ComponentViewProvider } from './componentView';
import { AnnotationsViewProvider } from './annotationsView';
import { AnalyticsViewer } from './analyticsViewer';
import { FeaturesViewProvider } from './featuresView';
import { studioDirectory } from './studioStorage';

export function activate(context: vscode.ExtensionContext): void {
  // Store run results outside the user's repo, in VS Code-managed extension storage.
  const storageUri = context.storageUri ?? context.globalStorageUri;
  fs.mkdirSync(storageUri.fsPath, { recursive: true });
  setResultsBaseDir(storageUri.fsPath);
  const migrateStudioData = () => {
    if (!vscode.workspace.isTrusted) return;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      try {
        const legacy = vscode.Uri.joinPath(folder.uri, '.playwright-studio').fsPath;
        if (
          vscode.workspace.textDocuments.some(
            (document) => document.isDirty && document.uri.fsPath.startsWith(legacy + path.sep),
          )
        ) {
          throw new Error(
            'Save your open Studio configuration before reopening the extension to move it into local storage.',
          );
        }
        studioDirectory(folder.uri.fsPath, storageUri.fsPath);
      } catch (error) {
        void vscode.window.showWarningMessage(
          `Playwright Studio local data: ${error instanceof Error ? error.message : 'Migration could not finish. Existing files were preserved.'}`,
        );
      }
    }
  };
  migrateStudioData();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(migrateStudioData));

  // Core providers
  const codeLens = new PlaywrightCodeLensProvider();
  const store = new ResultStore(context);
  const profiles = new EnvProfileManager(context);
  const artifactViewer = new ArtifactViewer(context);
  const analyticsViewer = new AnalyticsViewer(store);
  context.subscriptions.push(codeLens, store, profiles, artifactViewer, analyticsViewer);

  // Wire profile env into the terminal
  setExtraEnvProvider((resource) => profiles.getActiveEnv(resource));

  // Register CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
      ],
      codeLens,
    ),
  );

  // Feature 1: Sidebar results tree view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'playwrightStudio.featuresView',
      new FeaturesViewProvider(),
    ),
  );
  const resultsView = new TestResultsViewProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playwrightStudio.resultsView', resultsView),
    resultsView,
  );

  const historyView = new HistoryViewProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playwrightStudio.historyView', historyView),
    historyView,
  );
  const componentView = new ComponentViewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playwrightStudio.componentsView', componentView),
    componentView,
  );
  const annotationsView = new AnnotationsViewProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playwrightStudio.annotationsView', annotationsView),
    annotationsView,
  );

  // Native Testing API integration (Test Explorer run/debug profiles).
  const testExplorer = new PlaywrightTestExplorer(store);
  context.subscriptions.push(
    testExplorer,
    vscode.window.registerTreeDataProvider('playwrightStudio.testsView', testExplorer),
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
    fixtureNav,
  );

  const locatorAssistant = new LocatorAssistant();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(langSelector, locatorAssistant, {
      providedCodeActionKinds: LocatorAssistant.providedCodeActionKinds,
    }),
    locatorAssistant,
  );

  // Register all commands (features 3, 4, 5, 8 and existing)
  registerCommands(
    context,
    codeLens,
    profiles,
    store,
    artifactViewer,
    testExplorer,
    analyticsViewer,
  );

  // Start watching AFTER all providers are subscribed so they catch the initial load
  store.start();

  // Refresh code lenses on save/open
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => codeLens.refresh()),
    vscode.workspace.onDidOpenTextDocument(() => codeLens.refresh()),
  );
}

export function deactivate(): void {
  disposeTerminal();
}
