import type { Browser, BrowserContext, BrowserType, Dialog, Page } from 'playwright';
import { inspectPoint } from './inspect';
import { BrowserAction, BrowserReply, VIEWPORT } from './protocol';
import { SelectorError } from './errors';
import { launchSelectorBrowser } from './startup';
import { SelectorDevTools } from './devtools';
import { pressNativeSelectKey } from './nativeSelect';
import { copyWebsiteSelection } from './clipboard';

export class SelectorBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private dialog?: Dialog;
  private name?: string;
  private disconnected = false;
  private devtools?: SelectorDevTools;

  constructor(
    private readonly chromium: BrowserType,
    private readonly channel?: string,
    private readonly devtoolsHeadless = false,
  ) {}

  get browserName(): string | undefined {
    return this.name;
  }

  private async open(action: BrowserAction): Promise<Page> {
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) return this.page;
    if (this.disconnected && action.type !== 'navigate') {
      // Never replay a click or keystroke on a different, recreated page.
      throw new SelectorError(
        'browser-launch',
        'Browser session ended',
        'Open the website again to reconnect to the browser.',
        true,
        this.name,
      );
    }
    if (!this.browser?.isConnected()) {
      const launched = await launchSelectorBrowser(this.chromium, this.channel);
      const browser = launched.browser;
      this.browser = browser;
      this.name = launched.browserName;
      this.disconnected = false;
      this.devtools = new SelectorDevTools(this.chromium, browser, this.devtoolsHeadless);
      browser.on('disconnected', () => {
        if (this.browser !== browser) return;
        this.browser = undefined;
        this.context = undefined;
        this.page = undefined;
        this.dialog = undefined;
        this.disconnected = true;
        void this.devtools?.close().catch(() => {});
        this.devtools = undefined;
      });
    }
    if (!this.context) {
      const context = await this.browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        acceptDownloads: false,
      });
      this.context = context;
      context.setDefaultTimeout(5000);
      context.on('page', (page) => {
        this.page = page;
        page.on('dialog', (dialog) => {
          this.dialog = dialog;
        });
        page.on('close', () => {
          if (this.page !== page) return;
          this.dialog = undefined;
          this.page = context
            .pages()
            .filter((candidate) => !candidate.isClosed())
            .at(-1);
          if (!this.page) this.disconnected = true;
        });
      });
    }
    this.page = await this.context.newPage();
    this.disconnected = false;
    return this.page;
  }

  async perform(action: BrowserAction): Promise<Omit<BrowserReply, 'id'>> {
    if (action.type === 'close') {
      await this.close();
      return {};
    }
    const page = await this.open(action);
    if (action.type === 'devtools') await this.devtools?.open(page);
    if (this.dialog && action.type !== 'dialog') {
      return {
        browserName: this.name,
        devtoolsOpen: this.devtools?.isOpen,
        dialog: { type: this.dialog.type(), message: this.dialog.message().slice(0, 10000) },
      };
    }
    let inspection: BrowserReply['inspection'];
    let clipboardText: string | undefined;
    switch (action.type) {
      case 'navigate':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        break;
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        break;
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
        break;
      case 'inspect':
        inspection = await inspectPoint(page, action.x, action.y);
        break;
      case 'click':
        await page.mouse.click(action.x, action.y, { clickCount: action.clickCount ?? 1 });
        break;
      case 'hover':
        await page.mouse.move(action.x, action.y);
        break;
      case 'drag':
        await page.mouse.move(action.x, action.y);
        await page.mouse.down();
        try {
          await page.mouse.move(action.toX, action.toY, { steps: 10 });
        } finally {
          await page.mouse.up();
        }
        break;
      case 'scroll':
        if (action.x !== undefined && action.y !== undefined)
          await page.mouse.move(action.x, action.y);
        await page.mouse.wheel(0, action.delta);
        break;
      case 'type':
        if (action.paste) await page.keyboard.insertText(action.text);
        else await page.keyboard.type(action.text);
        break;
      case 'clipboard':
        clipboardText = await copyWebsiteSelection(page, action.operation);
        break;
      case 'key':
        if (!(await pressNativeSelectKey(page, action.key))) await page.keyboard.press(action.key);
        break;
      case 'dialog': {
        const dialog = this.dialog;
        this.dialog = undefined;
        if (action.accept) await dialog?.accept(action.text);
        else await dialog?.dismiss();
        break;
      }
    }
    if (this.dialog)
      return {
        browserName: this.name,
        devtoolsOpen: this.devtools?.isOpen,
        dialog: { type: this.dialog.type(), message: this.dialog.message().slice(0, 10000) },
      };
    const active = this.page ?? page;
    await this.devtools?.follow(active);
    const screenshot = await active.screenshot({ type: 'jpeg', quality: 75, timeout: 5000 });
    return {
      url: active.url(),
      screenshot: screenshot.toString('base64'),
      inspection,
      browserName: this.name,
      devtoolsOpen: this.devtools?.isOpen,
      ...(clipboardText !== undefined ? { clipboardText } : {}),
    };
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const devtools = this.devtools;
    this.devtools = undefined;
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.dialog = undefined;
    this.name = undefined;
    this.disconnected = false;
    await Promise.all([devtools?.close(), browser?.close()]);
  }
}
