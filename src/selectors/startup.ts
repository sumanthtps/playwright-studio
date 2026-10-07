import type { Browser, BrowserType } from 'playwright';
import { SelectorError } from './errors';

// The inspected browser exposes CDP only on loopback. Only Chrome's bundled
// DevTools frontend may connect from a browser origin; ordinary websites cannot.
export const SELECTOR_DEBUGGING_ARGS = [
  '--enable-automation',
  '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=devtools://devtools',
];

export function browserDisplayName(channel?: string): string {
  if (channel === 'chrome') return 'Google Chrome';
  if (channel === 'msedge') return 'Microsoft Edge';
  return 'Chromium';
}

function executableMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Executable doesn't exist at |Chromium distribution '[^']+' is not found/i.test(
    error.message,
  );
}

export async function launchSelectorBrowser(
  chromium: BrowserType,
  channel?: string,
): Promise<{ browser: Browser; browserName: string }> {
  // A configured channel is intentional. Automatic mode falls back only when
  // a browser is absent, never after a crash, policy restriction or permission error.
  const channels = channel ? [channel] : [undefined, 'chrome', 'msedge'];
  for (const candidate of channels) {
    const browserName = browserDisplayName(candidate);
    try {
      const browser = await chromium.launch({
        headless: true,
        timeout: 10000,
        args: SELECTOR_DEBUGGING_ARGS,
        ...(candidate ? { channel: candidate } : {}),
      });
      return { browser, browserName };
    } catch (error) {
      if (executableMissing(error)) continue;
      throw new SelectorError(
        'browser-launch',
        `${browserName} could not start`,
        'The browser could not start. Retry, or check whether your system allows Playwright to launch this browser.',
        true,
        browserName,
      );
    }
  }
  throw new SelectorError(
    'browser-missing',
    channel ? `${browserDisplayName(channel)} is not installed` : 'A browser is needed',
    channel
      ? `The selected ${browserDisplayName(channel)} browser is unavailable. Choose automatic browser selection or install the selected browser.`
      : 'Playwright Chromium, Google Chrome and Microsoft Edge were not found. Install Chromium to open websites here.',
    true,
    channel ? browserDisplayName(channel) : undefined,
  );
}

export async function launchDevToolsBrowser(
  chromium: BrowserType,
  headless = false,
): Promise<Browser> {
  for (const channel of ['chrome', undefined, 'msedge']) {
    try {
      return await chromium.launch({
        headless,
        // A cold desktop Chrome launch can exceed the embedded browser's budget.
        timeout: 30000,
        ...(channel ? { channel } : {}),
      });
    } catch (error) {
      if (executableMissing(error)) continue;
      throw new SelectorError(
        'action',
        'Chrome DevTools could not open',
        'The DevTools window could not start. Check that Chrome can open a window, then try again. Your website remains open in VS Code.',
      );
    }
  }
  throw new SelectorError(
    'action',
    'A desktop browser is needed',
    'Install Google Chrome or the full Playwright Chromium browser to open DevTools. Your website remains open in VS Code.',
  );
}
