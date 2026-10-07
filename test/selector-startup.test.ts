import { it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Browser, BrowserType } from 'playwright';
import { launchSelectorBrowser } from '../src/selectors/startup';
import { SelectorError, selectorErrorReply } from '../src/selectors/errors';
import { SelectorBrowser } from '../src/selectors/browser';

const chromiumMissing = new Error(
  "browserType.launch: Executable doesn't exist at /private/cache/chrome-headless-shell",
);
const chromeMissing = new Error(
  "browserType.launch: Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app",
);

function fakeLauncher(launch: BrowserType['launch']): BrowserType {
  return { launch } as BrowserType;
}

it('automatic startup prefers the installed Playwright browser', async () => {
  const calls: (string | undefined)[] = [];
  const browser = {} as Browser;
  const result = await launchSelectorBrowser(
    fakeLauncher(async (options) => {
      calls.push(options?.channel);
      assert.equal(options?.headless, true);
      assert.equal(options?.timeout, 10000);
      return browser;
    }),
  );
  assert.deepEqual(calls, [undefined]);
  assert.equal(result.browser, browser);
  assert.equal(result.browserName, 'Chromium');
});

it('missing Playwright Chromium automatically falls back to installed Chrome', async () => {
  const calls: (string | undefined)[] = [];
  const result = await launchSelectorBrowser(
    fakeLauncher(async (options) => {
      calls.push(options?.channel);
      if (!options?.channel) throw chromiumMissing;
      return {} as Browser;
    }),
  );
  assert.deepEqual(calls, [undefined, 'chrome']);
  assert.equal(result.browserName, 'Google Chrome');
});

it('automatic startup tries Edge only when Chromium and Chrome executables are absent', async () => {
  const calls: (string | undefined)[] = [];
  const result = await launchSelectorBrowser(
    fakeLauncher(async (options) => {
      calls.push(options?.channel);
      if (!options?.channel) throw chromiumMissing;
      if (options.channel === 'chrome') throw chromeMissing;
      return {} as Browser;
    }),
  );
  assert.deepEqual(calls, [undefined, 'chrome', 'msedge']);
  assert.equal(result.browserName, 'Microsoft Edge');
});

it('all absent browsers produce bounded setup guidance without paths or Playwright banners', async () => {
  const calls: (string | undefined)[] = [];
  await assert.rejects(
    launchSelectorBrowser(
      fakeLauncher(async (options) => {
        calls.push(options?.channel);
        throw chromiumMissing;
      }),
    ),
    (error: unknown) => {
      const reply = selectorErrorReply(error);
      assert.equal(reply.errorCode, 'browser-missing');
      assert.equal(reply.errorTitle, 'A browser is needed');
      assert.match(reply.error!, /Install Chromium/);
      assert.ok(reply.error!.length < 200);
      assert.doesNotMatch(JSON.stringify(reply), /private|Applications|browserType\.launch|╔/);
      return true;
    },
  );
  assert.deepEqual(calls, [undefined, 'chrome', 'msedge']);
});

for (const channel of ['chrome', 'msedge']) {
  it(`an explicitly selected ${channel} does not silently switch browsers`, async () => {
    const calls: (string | undefined)[] = [];
    await assert.rejects(
      launchSelectorBrowser(
        fakeLauncher(async (options) => {
          calls.push(options?.channel);
          throw chromeMissing;
        }),
        channel,
      ),
      (error: unknown) => {
        assert.equal(selectorErrorReply(error).errorCode, 'browser-missing');
        assert.match(selectorErrorReply(error).error!, /Choose automatic/);
        return true;
      },
    );
    assert.deepEqual(calls, [channel]);
  });
}

for (const failure of [
  'spawn EPERM',
  'Timeout 10000ms exceeded',
  'Target page, context or browser has been closed',
]) {
  it(`does not try another browser after a launch failure: ${failure}`, async () => {
    let calls = 0;
    await assert.rejects(
      launchSelectorBrowser(
        fakeLauncher(async () => {
          calls++;
          throw new Error(failure);
        }),
      ),
      (error: unknown) => {
        assert.equal(selectorErrorReply(error).errorCode, 'browser-launch');
        assert.equal(selectorErrorReply(error).browserName, 'Chromium');
        return true;
      },
    );
    assert.equal(calls, 1);
  });
}

it('does not skip broken Chrome to Edge after the bundled browser is absent', async () => {
  const calls: (string | undefined)[] = [];
  await assert.rejects(
    launchSelectorBrowser(
      fakeLauncher(async (options) => {
        calls.push(options?.channel);
        if (!options?.channel) throw chromiumMissing;
        throw new Error('Browser policy denied this launch');
      }),
    ),
    (error: unknown) => {
      assert.equal(selectorErrorReply(error).errorCode, 'browser-launch');
      assert.equal(selectorErrorReply(error).browserName, 'Google Chrome');
      return true;
    },
  );
  assert.deepEqual(calls, [undefined, 'chrome']);
});

for (const [failure, expected] of [
  [
    'page.goto: net::ERR_NAME_NOT_RESOLVED at https://secret.example/?token=secret',
    /address could not be found/,
  ],
  ['page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000', /development server/],
  ['page.goto: net::ERR_CERT_AUTHORITY_INVALID', /certificate/],
  ['page.goto: Timeout 15000ms exceeded', /too long to respond/],
] as const) {
  it(`navigation error provides useful guidance for ${String(expected)}`, () => {
    const reply = selectorErrorReply(
      new Error(failure),
      { type: 'navigate', url: 'https://example.com' },
      'Google Chrome',
    );
    assert.equal(reply.errorCode, 'navigation');
    assert.equal(reply.browserName, 'Google Chrome');
    assert.match(reply.error!, expected);
    assert.doesNotMatch(JSON.stringify(reply), /token|secret|localhost|page\.goto/);
    assert.equal(reply.retryable, true);
  });
}

it('unknown errors do not expose diagnostic data from the workspace or website', () => {
  for (const error of [
    new Error('Sensitive local path /private/project; password=secret'),
    'secret',
    null,
  ]) {
    const reply = selectorErrorReply(error);
    assert.equal(reply.errorCode, 'action');
    assert.doesNotMatch(JSON.stringify(reply), /private|password|secret/);
  }
  assert.equal(
    selectorErrorReply(
      new SelectorError('playwright-missing', 'Setup needed', 'Install Playwright.'),
    ).errorCode,
    'playwright-missing',
  );
});

function fakeBrowser() {
  let connected = true;
  const pages: ReturnType<typeof newPage>[] = [];
  const context = Object.assign(new EventEmitter(), {
    setDefaultTimeout: () => {},
    pages: () => pages,
    newPage: async () => {
      const page = newPage();
      pages.push(page);
      context.emit('page', page);
      return page;
    },
  });
  let contexts = 0;
  const browser = Object.assign(new EventEmitter(), {
    isConnected: () => connected,
    newContext: async () => {
      contexts++;
      return context;
    },
    close: async () => {
      connected = false;
      browser.emit('disconnected');
    },
  });
  function newPage() {
    let closed = false;
    let url = 'about:blank';
    const page = Object.assign(new EventEmitter(), {
      isClosed: () => closed,
      url: () => url,
      goto: async (value: string) => {
        url = value;
      },
      screenshot: async () => Buffer.from('screenshot'),
      close: () => {
        closed = true;
        page.emit('close');
      },
    });
    return page;
  }
  return { browser, context, pages, contexts: () => contexts };
}

it('a disconnected browser can reopen a website, without replaying stale interactions', async () => {
  const sessions: ReturnType<typeof fakeBrowser>[] = [];
  const session = new SelectorBrowser(
    fakeLauncher(async () => {
      const fake = fakeBrowser();
      sessions.push(fake);
      return fake.browser as unknown as Browser;
    }),
  );
  try {
    assert.equal(
      (await session.perform({ type: 'navigate', url: 'https://example.com' })).browserName,
      'Chromium',
    );
    await sessions[0].browser.close();
    await assert.rejects(session.perform({ type: 'click', x: 10, y: 10 }), /reconnect/);
    assert.equal(sessions.length, 1);
    const reopened = await session.perform({ type: 'navigate', url: 'https://example.com/next' });
    assert.equal(reopened.url, 'https://example.com/next');
    assert.equal(sessions.length, 2);
    assert.ok(reopened.screenshot);
  } finally {
    await session.close();
  }
});

it('closing the last page requires navigation and reuses the existing browser context', async () => {
  const fake = fakeBrowser();
  const session = new SelectorBrowser(fakeLauncher(async () => fake.browser as unknown as Browser));
  try {
    await session.perform({ type: 'navigate', url: 'https://example.com' });
    fake.pages[0].close();
    await assert.rejects(session.perform({ type: 'refresh' }), /reconnect/);
    await session.perform({ type: 'navigate', url: 'https://example.com/next' });
    assert.equal(fake.contexts(), 1);
    assert.equal(fake.pages.length, 2);
  } finally {
    await session.close();
  }
});
