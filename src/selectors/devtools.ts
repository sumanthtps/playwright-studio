import * as fs from 'fs/promises';
import * as path from 'path';
import type { Browser, BrowserType, Page } from 'playwright';
import { SelectorError } from './errors';
import { launchDevToolsBrowser } from './startup';

export function devToolsFrontendUrl(port: number, targetId: string): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid local debugging port.');
  if (!/^[a-f\d]{32}$/i.test(targetId)) throw new Error('Invalid browser target.');
  return `devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:${port}/devtools/page/${targetId}`;
}

async function debuggingPort(browser: Browser): Promise<number> {
  const connection = await browser.newBrowserCDPSession();
  try {
    const commandLine = await connection.send('Browser.getBrowserCommandLine');
    const profileArgument = commandLine.arguments.find((argument) =>
      argument.startsWith('--user-data-dir='),
    );
    const profile = profileArgument?.slice('--user-data-dir='.length);
    if (!profile || !path.isAbsolute(profile)) throw new Error('Browser profile unavailable.');
    // This path comes from the browser we own, never from the inspected page.
    const file = await fs.open(path.join(profile, 'DevToolsActivePort'), 'r');
    try {
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) throw new Error('Invalid debugging endpoint.');
      const port = Number(buffer.toString('utf8', 0, bytesRead).split(/\r?\n/)[0]);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw new Error('Invalid debugging endpoint.');
      return port;
    } finally {
      await file.close();
    }
  } finally {
    await connection.detach();
  }
}

async function pageTarget(page: Page): Promise<string> {
  const connection = await page.context().newCDPSession(page);
  try {
    return (await connection.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    await connection.detach();
  }
}

/** A separate browser displays Chrome's bundled frontend for the existing page. */
export class SelectorDevTools {
  private browser?: Browser;
  private frontend?: Page;
  private target?: Page;
  private port?: number;

  constructor(
    private readonly chromium: BrowserType,
    private readonly inspectedBrowser: Browser,
    // Browser tests use a headless frontend; the extension always opens a window.
    private readonly headless = false,
  ) {}

  get isOpen(): boolean {
    return !!this.browser?.isConnected() && !!this.frontend && !this.frontend.isClosed();
  }

  async open(page: Page): Promise<Page> {
    try {
      this.port ??= await debuggingPort(this.inspectedBrowser);
      const url = devToolsFrontendUrl(this.port, await pageTarget(page));
      if (!this.isOpen) {
        await this.close();
        const browser = await launchDevToolsBrowser(this.chromium, this.headless);
        this.browser = browser;
        browser.on('disconnected', () => {
          if (this.browser !== browser) return;
          this.browser = undefined;
          this.frontend = undefined;
          this.target = undefined;
        });
        this.frontend = await browser.newPage({
          viewport: { width: 1180, height: 820 },
          acceptDownloads: false,
        });
        this.frontend.on('close', () => {
          if (this.browser === browser) void this.close().catch(() => {});
        });
      }
      const frontend = this.frontend!;
      if (this.target !== page) {
        await frontend.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        this.target = page;
      }
      await frontend.bringToFront();
      return frontend;
    } catch (error) {
      await this.close().catch(() => {});
      if (error instanceof SelectorError) throw error;
      throw new SelectorError(
        'action',
        'Chrome DevTools could not connect',
        'DevTools could not connect to this browser session. Try again or reopen the website. Your current page has not been replaced.',
      );
    }
  }

  async follow(page: Page): Promise<void> {
    if (!this.isOpen || this.target === page) return;
    // A popup becomes the active page in the embedded browser. Keep DevTools
    // on that same target without interrupting ordinary browsing if it closed.
    try {
      await this.open(page);
    } catch {
      await this.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.frontend = undefined;
    this.target = undefined;
    await browser?.close();
  }
}
