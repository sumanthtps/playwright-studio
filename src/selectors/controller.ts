import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { fork, ChildProcess } from 'child_process';
import { getConfig } from '../config';
import { requireWorkspaceTrust } from '../security';
import { terminateProcessTree } from '../processTree';
import {
  BrowserAction,
  BrowserReply,
  Inspection,
  SelectorViewState,
  parseBrowserAction,
  parseSelectorViewState,
} from './protocol';
import { selectorHtml } from './view';
import { getExecutionEnv, runCommandAndWait } from '../terminal';
import { SelectorError, selectorErrorReply } from './errors';
import { MAX_CLIPBOARD_TEXT } from './clipboard';

export class SelectorIntelligence implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private panelReady = false;
  private disposed = false;
  private worker?: ChildProcess;
  private pending?: { id: number; timer: NodeJS.Timeout; action: BrowserAction['type'] };
  private sequence = 0;
  private inspection?: Inspection;
  private root?: string;
  private lastUrl?: string;
  private channelOverride?: string;
  private setupCancellation?: vscode.CancellationTokenSource;
  // Session data is kept in memory only, and is released with the extension.
  private cachedReply: BrowserReply = { id: 0 };
  private uiState: SelectorViewState = { mode: 'inspect' };

  constructor(private readonly context: vscode.ExtensionContext) {}

  show(): void {
    if (this.disposed) return;
    requireWorkspaceTrust();
    if (!this.panel) {
      this.root = this.projectRoot();
      const panel = vscode.window.createWebviewPanel(
        'playwrightStudio.selectors',
        'Selector Intelligence',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
      );
      this.panel = panel;
      this.panelReady = false;
      panel.onDidDispose(() => {
        if (this.panel !== panel) return;
        this.panel = undefined;
        this.panelReady = false;
      });
      panel.webview.onDidReceiveMessage((message) => {
        if (this.panel !== panel || this.disposed) return;
        void this.handle(message).catch((error) => this.reportError(error));
      });
      panel.webview.html = selectorHtml();
    }
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private reply(message: BrowserReply): void {
    // Clipboard contents are consumed only at the explicit request boundary below.
    const safeMessage = { ...message };
    delete safeMessage.clipboardText;
    this.cachedReply = {
      url: this.cachedReply.url,
      screenshot: this.cachedReply.screenshot,
      browserName: this.cachedReply.browserName,
      ...safeMessage,
      inspection: this.inspection,
    };
    if (this.panelReady) void this.panel?.webview.postMessage(safeMessage);
  }

  private async restoreView(): Promise<void> {
    if (this.panelReady) return;
    const panel = this.panel;
    // Refresh an existing browser only. Opening the panel never launches or navigates one.
    if (this.worker && !this.pending && !this.setupCancellation && !this.cachedReply.error)
      await this.handle({ type: 'refresh' });
    if (!panel || this.panel !== panel || this.disposed) return;
    this.panelReady = true;
    void this.panel.webview.postMessage({
      ...this.cachedReply,
      uiState: this.uiState,
      setupBusy: Boolean(this.setupCancellation),
      sessionBusy: Boolean(this.pending),
      sessionAction: this.pending?.action,
    } satisfies BrowserReply);
  }

  private projectRoot(): string {
    if (this.root) return this.root;
    const root = getConfig().workingDirectory;
    if (
      !vscode.workspace.workspaceFolders?.length ||
      !fs.existsSync(root) ||
      !fs.statSync(root).isDirectory()
    )
      throw new Error('Open a local Playwright project folder before inspecting a website.');
    return root;
  }

  private reportError(error: unknown): void {
    this.reply({
      id: 0,
      ...selectorErrorReply(error),
      sessionBusy: Boolean(this.pending),
      sessionAction: this.pending?.action,
      setupBusy: Boolean(this.setupCancellation),
    });
  }

  private startWorker(): ChildProcess {
    if (this.worker) return this.worker;
    const root = this.projectRoot();
    this.root = root;
    const worker = fork(
      path.join(this.context.extensionUri.fsPath, 'dist', 'selectorWorker.js'),
      [],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...getExecutionEnv(root),
          ELECTRON_RUN_AS_NODE: '1',
          PLAYWRIGHT_STUDIO_SELECTOR_ROOT: root,
          PLAYWRIGHT_STUDIO_SELECTOR_CHANNEL:
            this.channelOverride ??
            vscode.workspace
              .getConfiguration('playwrightSnippets', vscode.Uri.file(root))
              .get<string>('selectorBrowserChannel', ''),
        },
        execArgv: [],
      },
    );
    this.worker = worker;
    // Errors are returned through IPC. Drain diagnostics without retaining website data.
    worker.stderr?.resume();
    worker.on('message', (message: BrowserReply) => {
      void this.receiveWorkerReply(worker, message);
    });
    const fail = (message: string) => {
      if (this.worker !== worker) return;
      this.stop();
      this.reply({ id: 0, error: message });
    };
    worker.on('error', () => fail('The browser could not start. Try opening the website again.'));
    worker.on('exit', () =>
      fail('The browser closed. Open the website again to start a new session.'),
    );
    return worker;
  }

  private async receiveWorkerReply(worker: ChildProcess, message: BrowserReply): Promise<void> {
    const pending = this.pending;
    if (this.worker !== worker || message.id !== pending?.id) return;
    const reply = { ...message };
    delete reply.clipboardText;
    if (pending.action === 'clipboard' && message.clipboardText !== undefined && !message.error) {
      if (
        typeof message.clipboardText !== 'string' ||
        message.clipboardText.length > MAX_CLIPBOARD_TEXT
      ) {
        reply.error = 'The selected clipboard text is too large. Select less text and try again.';
      } else {
        try {
          await vscode.env.clipboard.writeText(message.clipboardText);
        } catch {
          reply.error = 'Could not write to the clipboard. Try copying the selection again.';
        }
      }
    }
    // Clipboard access may finish after this session was disposed, timed out or replaced.
    if (this.worker !== worker || this.pending !== pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (reply.inspection) this.inspection = reply.inspection;
    if (reply.url && !reply.error) this.lastUrl = reply.url;
    this.reply(reply);
  }

  private async handle(message: unknown): Promise<void> {
    if (this.disposed) return;
    requireWorkspaceTrust();
    if (!message || typeof message !== 'object') return;
    const value = message as Record<string, unknown>;
    if (value.type === 'ready') {
      await this.restoreView();
      return;
    }
    if (value.type === 'viewState') {
      const state = parseSelectorViewState(value.state);
      if (state) this.uiState = state;
      return;
    }
    if (value.type === 'copy') {
      if (typeof value.index !== 'number' || !Number.isInteger(value.index)) return;
      const inspection = this.inspection;
      const panel = this.panel;
      const candidate = inspection?.candidates[value.index];
      const text =
        value.format === 'playwright'
          ? candidate?.code
          : value.format === 'selector'
            ? candidate?.selector
            : undefined;
      if (text) {
        await vscode.env.clipboard.writeText(text);
        if (this.panel !== panel || this.inspection !== inspection || !this.panelReady) return;
        void panel?.webview.postMessage({
          type: 'copied',
          index: value.index,
          format: value.format,
        });
      }
      return;
    }
    if (value.type === 'setup') {
      await this.setup(value.action);
      return;
    }
    let action: ReturnType<typeof parseBrowserAction>;
    try {
      action = parseBrowserAction(value);
    } catch {
      throw new SelectorError(
        'navigation',
        'Enter a valid website address',
        'Use a complete http:// or https:// website URL, then open it again.',
      );
    }
    if (!action) throw new Error('Unsupported browser action.');
    if (action.type === 'close') {
      this.cancelSetup();
      this.stop();
      this.lastUrl = undefined;
      this.cachedReply = { id: 0 };
      this.uiState = { mode: this.uiState.mode };
      this.reply({ id: 0, sessionClosed: true, uiState: this.uiState });
      return;
    }
    if (this.pending || this.setupCancellation) return;
    if (action.type === 'navigate') this.lastUrl = action.url;
    if (!this.worker && action.type !== 'navigate') {
      this.reply({ id: 0, error: 'Open a website first.' });
      return;
    }
    if (
      !['refresh', 'inspect', 'devtools'].includes(action.type) &&
      !(action.type === 'clipboard' && action.operation === 'copy')
    ) {
      this.inspection = undefined;
      this.cachedReply.inspection = undefined;
    }
    const worker = this.startWorker();
    const id = ++this.sequence;
    this.pending = {
      id,
      action: action.type,
      timer: setTimeout(
        () => {
          this.stop();
          this.reply({
            id,
            error:
              'The browser stopped responding. Open the website again. Check Playwright browser installation if this persists.',
          });
        },
        action.type === 'navigate' ? 40000 : 25000,
      ),
    };
    worker.send({ id, action }, (error) => {
      if (error && this.worker === worker) {
        this.stop();
        this.reply({
          id,
          error: 'The browser connection was interrupted. Open the website again.',
          retryable: true,
        });
      }
    });
  }

  private async setup(action: unknown): Promise<void> {
    if (action === 'openGuide') {
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        vscode.Uri.joinPath(this.context.extensionUri, 'docs', 'selectors.md'),
      );
      return;
    }
    if (!['installChromium', 'useChrome', 'useEdge', 'retry'].includes(String(action)))
      throw new Error('Unsupported browser setup action.');
    if (this.setupCancellation || this.pending) return;
    this.stop();
    if (action === 'useChrome') this.channelOverride = 'chrome';
    if (action === 'useEdge') this.channelOverride = 'msedge';
    if (action === 'installChromium') {
      const root = this.projectRoot();
      const projectRequire = createRequire(path.join(root, 'package.json'));
      let cli: string;
      try {
        try {
          cli = projectRequire.resolve('@playwright/test/cli');
        } catch {
          cli = path.join(
            path.dirname(projectRequire.resolve('playwright/package.json')),
            'cli.js',
          );
        }
        if (!fs.existsSync(cli)) throw new Error('Missing CLI');
      } catch {
        this.reply({
          id: 0,
          errorCode: 'playwright-missing',
          errorTitle: 'Playwright is not installed in this project',
          error: 'Install @playwright/test in your project, then try again.',
          retryable: true,
        });
        return;
      }
      const cancellation = new vscode.CancellationTokenSource();
      this.setupCancellation = cancellation;
      this.reply({ id: 0, setupBusy: true });
      let installed = false;
      let cancelled = false;
      try {
        const exitCode = await runCommandAndWait(
          { executable: process.execPath, args: [cli, 'install', 'chromium'] },
          {
            resource: root,
            cwd: root,
            name: 'Install Chromium for Selector Intelligence',
            extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
            token: cancellation.token,
          },
        );
        installed = exitCode === 0 && !cancellation.token.isCancellationRequested;
      } catch {
        // The terminal retains installation diagnostics; keep the panel readable.
      } finally {
        cancelled = cancellation.token.isCancellationRequested;
        if (this.setupCancellation === cancellation) this.setupCancellation = undefined;
        cancellation.dispose();
      }
      if (this.disposed || cancelled) return;
      if (!installed) {
        this.reply({
          id: 0,
          setupBusy: false,
          errorCode: 'browser-missing',
          errorTitle: 'Browser setup did not finish',
          error:
            'Check the installation terminal for details, or use an installed Chrome or Edge browser.',
          retryable: true,
        });
        return;
      }
      this.channelOverride = '';
    }
    if (this.lastUrl) await this.handle({ type: 'navigate', url: this.lastUrl });
    else this.reply({ id: 0, setupBusy: false });
  }

  private stop(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.inspection = undefined;
    this.cachedReply.inspection = undefined;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) void terminateProcessTree(worker);
  }

  private cancelSetup(): void {
    const cancellation = this.setupCancellation;
    this.setupCancellation = undefined;
    cancellation?.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSetup();
    this.panel?.dispose();
    this.panel = undefined;
    this.stop();
    this.cachedReply = { id: 0 };
    this.uiState = { mode: 'inspect' };
    this.root = undefined;
    this.lastUrl = undefined;
    this.channelOverride = undefined;
  }
}
