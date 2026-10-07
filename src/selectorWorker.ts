import { createRequire } from 'module';
import * as path from 'path';
import type { BrowserType } from 'playwright';
import { SelectorBrowser } from './selectors/browser';
import { BrowserAction, parseBrowserAction } from './selectors/protocol';
import { SelectorError, selectorErrorReply } from './selectors/errors';

// Website JavaScript stays in Chromium. Only fixed, validated actions cross IPC.
const root = process.env.PLAYWRIGHT_STUDIO_SELECTOR_ROOT;
if (!root) throw new Error('Missing project root.');
const projectRequire = createRequire(path.join(root, 'package.json'));
let browser: SelectorBrowser | undefined;
let busy = false;
process.on('message', async (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const { id, action } = message as { id: unknown; action: unknown };
  if (!Number.isSafeInteger(id) || busy) return;
  busy = true;
  let parsed: BrowserAction | undefined;
  try {
    parsed = parseBrowserAction(action);
    if (!parsed) throw new Error('Unsupported browser action.');
    if (!browser) {
      let chromium: BrowserType;
      try {
        chromium = (projectRequire('playwright') as { chromium: BrowserType }).chromium;
      } catch {
        try {
          chromium = (projectRequire('@playwright/test') as { chromium: BrowserType }).chromium;
        } catch {
          throw new SelectorError(
            'playwright-missing',
            'Playwright is needed in this project',
            'Install @playwright/test or playwright in this project, then retry. The setup guide includes the installation command.',
          );
        }
      }
      browser = new SelectorBrowser(
        chromium,
        process.env.PLAYWRIGHT_STUDIO_SELECTOR_CHANNEL || undefined,
      );
    }
    const result = await browser.perform(parsed);
    process.send?.({ id, ...result });
  } catch (error) {
    process.send?.({
      id,
      ...selectorErrorReply(error, parsed, browser?.browserName),
    });
  } finally {
    busy = false;
  }
});
process.on('disconnect', () => {
  void Promise.resolve(browser?.close()).finally(() => process.exit(0));
});
