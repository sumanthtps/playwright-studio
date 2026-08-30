<h1 align="center">Playwright Studio</h1>

<p align="center">
  <img src="images/playwright-logo.png" alt="Playwright Studio logo" width="148" />
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=sumanthtps.playwright-test-code-snippets"><img src="https://img.shields.io/badge/version-1.1.1-0f6b44?style=flat-square" alt="Version"></a>
  <a href="https://github.com/sumanthtps/playwright-studio/actions"><img src="https://github.com/sumanthtps/playwright-studio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/sumanthtps/playwright-studio/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgray.svg" alt="License"></a>
</p>

<p align="center">
  <strong>The Playwright IDE that actually feels like an IDE.</strong>
</p>

<p align="center">
  Inline tag filters · multi-project picker · environment profiles · coverage heatmap ·<br>
  fixture Go-to-Definition · save-as-snippet · 338 typed snippets — and the rest of what you'd expect.
</p>

<p align="center">
  <img src="images/preview.gif" alt="Preview of Playwright Studio inside VS Code" width="920" />
</p>

---

## Why Playwright Studio?

If you already use Microsoft's official **Playwright Test for VS Code**, you have run / debug / inspect / codegen / trace. Playwright Studio adds the layer on top — the things you *also* want every day.

|                                                  | Playwright Test for VS Code (Microsoft) | **Playwright Studio**       |
| ------------------------------------------------ | --------------------------------------- | --------------------------- |
| Run / Debug / Inspect from CodeLens              | ✅                                       | ✅                           |
| Codegen launcher                                 | ✅                                       | ✅                           |
| Trace Viewer & HTML Report shortcuts             | ✅                                       | ✅                           |
| Inline `@tag` filter lenses on each test         | ❌                                       | ✅                           |
| Multi-project picker (chromium, firefox, …)      | ❌                                       | ✅                           |
| Environment profile switcher (status bar)        | ❌                                       | ✅                           |
| Coverage heatmap — find untested code            | ❌                                       | ✅                           |
| Fixture Go-to-Definition + Hover                 | ❌                                       | ✅                           |
| Save selected code as a reusable snippet         | ❌                                       | ✅                           |
| 338 typed snippets (page, locator, assert, …)    | ❌                                       | ✅                           |
| Live results panel + gutter icons + diagnostics  | ✅                                       | ✅                           |

You can run both extensions side-by-side — they don't conflict.

---

## Features

### CodeLens Test Runner

Open any Playwright spec file and get inline actions on every test and suite:

```
Run All   Debug All   Inspect All   $(tag) Run with Tag   $(layers) Run with Project
──────────────────────────────────────────────────────────────────────────────────────
Run       Debug       Inspect       @smoke  @regression
Run Suite Debug Suite Inspect Suite
```

- **Run / Debug / Inspect** at the file, suite, and individual test level.
- **Run with Tag** — filter by `@tag` found in test names, or enter a custom regex grep pattern.
- **Run with Project** — pick one or more projects from your `playwright.config.ts` (e.g. `chromium`, `firefox`, `webkit`).
- Per-test tag lenses appear automatically when your test name contains `@tags`.

---

### Live Test Results Panel

After each run a **Playwright Results** tree appears in the Explorer sidebar:

- Tests grouped by file with pass / fail counts.
- Click any test node to jump directly to its source line.
- Failed tests show their error message as a tooltip.
- Tests with an attached trace file show an "Open Trace" action.

Result capture is **on by default**. The first time the extension activates against a workspace whose `playwright.config.*` is missing the `json` reporter, it offers a one-click **"Add JSON reporter"** button — the config is patched safely and the panel starts working. You can re-run the prompt any time via **Command Palette → Playwright Studio: Set Up Result Capture (Add JSON Reporter)**.

Then just run tests through the extension (CodeLens, right-click menu, or Command Palette). See [Troubleshooting](#troubleshooting) if the panel stays empty.

---

### Gutter Decorations & Failure Diagnostics

Pass/fail status is shown inline after every test run:

| Icon            | Meaning                 |
| --------------- | ----------------------- |
| 🟢 Green circle  | Test passed             |
| 🔴 Red circle    | Test failed / timed out |
| ⚫ Grey circle   | Test skipped            |
| 🟠 Orange circle | Test flaky              |

- **Overview ruler** in the scrollbar highlights failures and flaky tests at a glance.
- **Diagnostics** (squiggles) appear on failed tests with the first line of the error message.
- When a trace file is attached to the failure, the diagnostic code link opens the **Trace Viewer** directly.

---

### Status Bar — Last Run Summary & Env Profile

**Last run summary** appears in the status bar after each run:

```
$(pass) 24 passed      ← click to open HTML report
$(error) 21 passed  3 failed
```

**Environment profile switcher** shows the active profile next to it:

```
$(server-environment) staging    ← click to switch profile
```

Configure profiles in settings:

```json
"playwrightSnippets.envProfiles": {
  "staging":    { "BASE_URL": "https://staging.example.com" },
  "production": { "BASE_URL": "https://example.com" }
}
```

Switch profiles via the status bar or `Playwright Studio: Switch Environment Profile` from the Command Palette. The Playwright terminal is automatically recreated with the new environment.

---

### Coverage Heatmap — Find Untested Code

Tests that have **never been run** (or not run within the configured threshold) are highlighted with a subtle amber background and an inline `never run` label.

- Threshold is configurable via `playwrightSnippets.heatmapThresholdDays` (default: 7 days).
- Hover over a highlighted test to see when it was last run.
- Decorations update automatically after each test run.

---

### Fixture Navigation — Go to Definition & Hover

Playwright fixtures are first-class citizens:

- **Ctrl+Click** (Go to Definition) on any fixture name in a test callback jumps to where it is defined in your fixture file.
- **Hover** over a fixture name shows which file and line it is defined on.
- The fixture index is built automatically by scanning workspace files that use `.extend(`.

---

### Save Selection as Snippet

Capture any code block as a personal snippet:

1. Select code in the editor.
2. Right-click → **Playwright Studio: Save Selection as Snippet**.
3. Enter a prefix (the shortcut you'll type) and a name.
4. The snippet is saved to `playwright-custom.code-snippets` in your VS Code user folder and is immediately available in all projects.

---

### Trace Viewer & HTML Report

- **Show Trace Viewer** — pick a `.zip` trace file via file dialog, or click the trace link from a failure diagnostic.
- **Show HTML Report** — opens the Playwright HTML report, also clickable from the status bar summary.

---

### Code Generation

- **Open Codegen** — launches `playwright codegen` with an optional start URL. Record browser interactions and paste generated selectors straight into your test.

---

## Command Palette Reference

| Command                                               | Description                                   |
| ----------------------------------------------------- | --------------------------------------------- |
| `Playwright Studio: Run Test`                         | Run a single test (prompts if none selected)  |
| `Playwright Studio: Run All Tests in File`            | Run every test in the active file             |
| `Playwright Studio: Debug Test`                       | Run a test in debug mode                      |
| `Playwright Studio: Debug All Tests in File`          | Debug all tests in the active file            |
| `Playwright Studio: Inspect Test (PWDEBUG=1)`         | Open Playwright Inspector for a test          |
| `Playwright Studio: Inspect All Tests in File`        | Inspect all tests in the active file          |
| `Playwright Studio: Debug Test with Inspector`        | Combined debug + inspector                    |
| `Playwright Studio: Run Test at Cursor`               | Run the test surrounding the cursor           |
| `Playwright Studio: Run Tests with Tag / Grep Filter` | Filter by `@tag` or regex pattern             |
| `Playwright Studio: Run Tests with Project Selection` | Pick Playwright browser projects              |
| `Playwright Studio: Switch Environment Profile`       | Switch active env profile from the status bar |
| `Playwright Studio: Open Codegen`                     | Launch `playwright codegen`                   |
| `Playwright Studio: Show Trace Viewer`                | Open a trace `.zip` file                      |
| `Playwright Studio: Show HTML Report`                 | Open the Playwright HTML report               |
| `Playwright Studio: Save Selection as Snippet`        | Save selected code as a reusable snippet      |
| `Playwright Studio: Set Up Result Capture (Add JSON Reporter)` | One-click patch to add `['json']` to your `playwright.config` reporter array |

### Keyboard Shortcuts

| Shortcut                        | Command                          |
| ------------------------------- | -------------------------------- |
| `Ctrl+Alt+R` (`Cmd+Alt+R` on macOS) | Run Test at Cursor               |
| `Ctrl+Alt+T` (`Cmd+Alt+T` on macOS) | Run Tests with Tag / Grep Filter |

---

## Right-Click Context Menu

Right-click anywhere in a test file for quick access to:

- Run Test at Cursor
- Run Tests with Tag / Grep Filter
- Run Tests with Project Selection
- Open Codegen
- Save Selection as Snippet *(only when code is selected)*

Right-click a file in the **Explorer** sidebar for:

- Run All Tests in File
- Debug All Tests in File
- Debug All Tests with Inspector
- Run Tests with Project Selection

---

## Quick Start

1. Install the extension from the VS Code Marketplace.
2. Install Playwright in your project: `npm i -D @playwright/test`.
3. Open any `.spec.ts`, `.test.ts`, `.spec.js`, or `.test.js` file.
4. Use the CodeLens above your first test to run it.

Or install from the terminal:

```bash
code --install-extension sumanthtps.playwright-test-code-snippets
```

> **Note:** The extension writes its results JSON to per-workspace VS Code storage (`%APPDATA%\Code\User\workspaceStorage\<hash>\sumanthtps.playwright-test-code-snippets\` on Windows; `~/Library/Application Support/Code/User/workspaceStorage/<hash>/...` on macOS), so nothing lands in your repo and there's nothing to gitignore.

---

## Configuration

All settings live under `playwrightSnippets.*`:

| Setting                                   | Default                 | Description                                                                                                    |
| ----------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `playwrightSnippets.workingDirectory`     | `""`                    | Working directory for test runs (relative or absolute)                                                         |
| `playwrightSnippets.testCommand`          | `"npx playwright test"` | Executable and arguments used to run tests. Quotes are supported; shell operators and expansion are not executed |
| `playwrightSnippets.toolCommand`          | `""`                    | Optional Playwright command prefix for Codegen, Trace Viewer, and reports; derived from `testCommand` when empty |
| `playwrightSnippets.reporter`             | `""`                    | Optional comma-separated CLI reporters. Leave empty to use the config; `json` is appended when capture is enabled |
| `playwrightSnippets.env`                  | `{}`                    | Extra environment variables passed to every test run                                                           |
| `playwrightSnippets.captureResults`       | `true`                  | Sets `PLAYWRIGHT_JSON_OUTPUT_FILE` so the JSON reporter writes results that power gutter icons, the sidebar panel, status bar, and trace links. Requires `['json']` in your config when the reporter setting is empty |
| `playwrightSnippets.envProfiles`          | `{}`                    | Named env profiles — each key is a profile name, value is a map of env vars                                    |
| `playwrightSnippets.heatmapThresholdDays` | `7`                     | Days after which a test is highlighted as never/rarely run                                                     |

### Example `settings.json`

```json
{
  "playwrightSnippets.workingDirectory": "e2e",
  "playwrightSnippets.testCommand": "npx playwright test",
  "playwrightSnippets.reporter": "list",
  "playwrightSnippets.captureResults": true,
  "playwrightSnippets.heatmapThresholdDays": 7,
  "playwrightSnippets.env": {
    "CI": "false"
  },
  "playwrightSnippets.envProfiles": {
    "staging": {
      "BASE_URL": "https://staging.example.com",
      "AUTH_TOKEN": "staging-token"
    },
    "production": {
      "BASE_URL": "https://example.com"
    }
  }
}
```

---

## Troubleshooting

### Playwright Results panel stays empty

The panel only populates when a Playwright run writes a JSON report to the extension's per-workspace storage directory. Walk this checklist top to bottom — each step depends on the previous one.

1. **Enable result capture.** In your workspace `.vscode/settings.json` (or User settings):
   ```json
   { "playwrightSnippets.captureResults": true }
   ```
   This makes the extension export `PLAYWRIGHT_JSON_OUTPUT_FILE` into the processes it starts.

2. **Add the `json` reporter to `playwright.config.ts`.** When `playwrightSnippets.reporter` is empty, the JSON reporter must be present in your config:
   ```ts
   reporter: [
     ['list'],
     ['html', { open: 'never' }],
     ['json'], // required for the results panel
   ],
   ```
   Without this, no JSON file is ever written, no matter what env vars are set.

3. **Set `workingDirectory` if your `playwright.config.ts` is not at the workspace root.** Common in monorepos. Example for a config at `<workspace>/tests/playwright.config.ts`:
   ```json
   { "playwrightSnippets.workingDirectory": "tests" }
   ```

4. **Run tests via the extension, not a manual terminal.** Use CodeLens (`▶ Run Test`), the editor right-click menu (**Playwright Studio → Run Test at Cursor**), or the Command Palette (**Playwright Studio: Run Test**). Manual terminals do not receive the extension's result-capture environment.

5. **Settings apply to the next run.** Each run receives a fresh working directory and environment, so no window reload or terminal cleanup is needed.

6. **Verify the JSON file is being written.** It lives at:
   - **Windows:** `%APPDATA%\Code\User\workspaceStorage\<hash>\sumanthtps.playwright-test-code-snippets\playwright-studio-results.json`
   - **macOS:** `~/Library/Application Support/Code/User/workspaceStorage/<hash>/sumanthtps.playwright-test-code-snippets/playwright-studio-results.json`
   - **Linux:** `~/.config/Code/User/workspaceStorage/<hash>/sumanthtps.playwright-test-code-snippets/playwright-studio-results.json`

   If the file is **missing** after a run, the json reporter or env var isn't reaching the test process — go back to steps 1–4. If the file **exists** but the panel is still empty, it's a refresh issue — the panel polls mtime every 1.5s, so toggling focus or running the test once more will pick it up.

### Test run launches but reports "no tests found"

`playwrightSnippets.workingDirectory` is wrong. Playwright doesn't search up the directory tree for `playwright.config.ts` — set `workingDirectory` to the folder that actually contains it.

### Reporter selection

Leave `playwrightSnippets.reporter` empty to use `playwright.config.*`. When the setting is non-empty, it is passed through `--reporter` and therefore overrides the config for that run; `json` is added automatically while result capture is enabled.

---

## Snippets Reference

### Prefix Families

| Prefix            | Category           |
| ----------------- | ------------------ |
| `p-import`        | Imports            |
| `p-t*`            | Test structure     |
| `p-b-*`           | Browser            |
| `p-bc-*`          | BrowserContext     |
| `p-loc-*`         | Locator            |
| `p-get-*`         | Locator getBy      |
| `p-e-*` / `p-et*` | Assertions         |
| `p-wf*`           | Wait actions       |
| `p-on-*`          | Page events        |
| `p-route-*`       | Network routing    |
| `p-clock-*`       | Clock / time       |
| `p-trace-*`       | Tracing            |
| `p-video-*`       | Video recording    |
| `p-api-*`         | API requests       |
| `p-net-*`         | Network inspection |
| `p-ws-*`          | WebSocket          |
| `p-download-*`    | Downloads          |

---

### Imports

| Prefix         | Description                        |
| -------------- | ---------------------------------- |
| `p-import`     | `import { test, expect }`          |
| `p-import-api` | `import { test, expect, request }` |
| `p-i-pw`       | `require('playwright')`            |
| `p-i-chromium` | `require` Chromium                 |
| `p-i-firefox`  | `require` Firefox                  |
| `p-i-webkit`   | `require` WebKit                   |
| `p-i-devices`  | `require` devices                  |

---

### Test Structure

| Prefix         | Description                         |
| -------------- | ----------------------------------- |
| `p-td`         | `test.describe()`                   |
| `p-t`          | `test()`                            |
| `p-ts`         | `test.step()`                       |
| `p-ts-timeout` | `test.step()` with timeout (v1.50+) |
| `p-ts-skip`    | `test.step.skip()` (v1.50+)         |
| `p-tbe`        | `test.beforeEach()`                 |
| `p-tae`        | `test.afterEach()`                  |
| `p-tba`        | `test.beforeAll()`                  |
| `p-taa`        | `test.afterAll()`                   |
| `p-tuse`       | `test.use()`                        |
| `p-tonly`      | `test.only()`                       |
| `p-tskip`      | `test.skip()`                       |
| `p-tskipc`     | `test.skip()` conditional           |
| `p-tfail`      | `test.fail()`                       |
| `p-tfail-only` | `test.fail.only()` (v1.49+)         |
| `p-tfixme`     | `test.fixme()`                      |
| `p-tslow`      | `test.slow()`                       |
| `p-t-timeout`  | `test.setTimeout()`                 |
| `p-tinfo`      | `test.info()`                       |
| `p-textend`    | `test.extend()` — custom fixtures   |
| `p-tdo`        | `test.describe.only()`              |
| `p-tdp`        | `test.describe.parallel()`          |
| `p-tds`        | `test.describe.serial()`            |
| `p-td-config`  | `test.describe.configure()`         |

---

### Browser

| Prefix                | Description                    |
| --------------------- | ------------------------------ |
| `p-b-newContext`      | `browser.newContext()`         |
| `p-b-newPage`         | `browser.newPage()`            |
| `p-b-contexts`        | `browser.contexts()`           |
| `p-b-close`           | `browser.close()`              |
| `p-b-isConnected`     | `browser.isConnected()`        |
| `p-b-version`         | `browser.version()`            |
| `p-b-type`            | `browser.browserType().name()` |
| `p-b-on-disconnected` | `browser.on('disconnected')`   |
| `p-b-tracing-start`   | `browser.startTracing()`       |
| `p-b-tracing-stop`    | `browser.stopTracing()`        |
| `p-l-chromium`        | Launch Chromium                |
| `p-ls-chromium`       | Launch Chromium Server         |
| `p-connect-chromium`  | Connect to Chromium            |
| `p-l-firefox`         | Launch Firefox                 |
| `p-ls-firefox`        | Launch Firefox Server          |
| `p-connect-firefox`   | Connect to Firefox             |
| `p-l-webkit`          | Launch WebKit                  |
| `p-ls-webkit`         | Launch WebKit Server           |
| `p-connect-webkit`    | Connect to WebKit              |
| `p-bs-close`          | `browserServer.close()`        |
| `p-bs-kill`           | `browserServer.kill()`         |
| `p-bs-on-close`       | `browserServer.on('close')`    |

---

### BrowserContext

| Prefix              | Description                                 |
| ------------------- | ------------------------------------------- |
| `p-context-newPage` | `context.newPage()`                         |
| `p-context-pages`   | `context.pages()`                           |
| `p-bc-close`        | `context.close()`                           |
| `p-bc-cookies`      | `context.cookies()`                         |
| `p-bc-addcookies`   | `context.addCookies()`                      |
| `p-bc-clrcookies`   | `context.clearCookies()`                    |
| `p-bc-storage`      | `context.storageState()` — save auth        |
| `p-bc-auth`         | `newContext({ storageState })` — reuse auth |
| `p-bc-route`        | `context.route()`                           |
| `p-bc-routehar`     | `context.routeFromHAR()`                    |
| `p-bc-ws-route`     | `context.routeWebSocket()` (v1.48+)         |
| `p-bc-unroute`      | `context.unroute()`                         |
| `p-bc-unroute-all`  | `context.unrouteAll()`                      |
| `p-bc-gperm`        | `context.grantPermissions()`                |
| `p-bc-clrperm`      | `context.clearPermissions()`                |
| `p-bc-setgeo`       | `context.setGeolocation()`                  |
| `p-bc-offline`      | `context.setOffline()`                      |
| `p-bc-sethdrs`      | `context.setExtraHTTPHeaders()`             |
| `p-bc-ais`          | `context.addInitScript()`                   |
| `p-bc-expfn`        | `context.exposeFunction()`                  |
| `p-bc-expbind`      | `context.exposeBinding()`                   |
| `p-bc-sdto`         | `context.setDefaultTimeout()`               |
| `p-bc-sdnto`        | `context.setDefaultNavigationTimeout()`     |
| `p-bc-wfe`          | `context.waitForEvent()`                    |
| `p-bc-cdp`          | `context.newCDPSession()` (Chromium)        |
| `p-bc-on-close`     | `context.on('close')`                       |
| `p-bc-on-page`      | `context.on('page')`                        |
| `p-bc-on-weberror`  | `context.on('weberror')`                    |

---

### Page — Navigation & Interaction

| Prefix           | Description            |
| ---------------- | ---------------------- |
| `p-goto`         | `page.goto()`          |
| `p-reload`       | `page.reload()`        |
| `p-goBack`       | `page.goBack()`        |
| `p-goFwd`        | `page.goForward()`     |
| `p-setcontent`   | `page.setContent()`    |
| `p-url`          | `page.url()`           |
| `p-title`        | `page.title()`         |
| `p-content`      | `page.content()`       |
| `p-pause`        | `page.pause()` — debug |
| `p-iclosed`      | `page.isClosed()`      |
| `p-ctx`          | `page.context()`       |
| `p-opener`       | `page.opener()`        |
| `p-close`        | `page.close()`         |
| `p-bringToFront` | `page.bringToFront()`  |

### Page — Locating Elements

| Prefix        | Description               |
| ------------- | ------------------------- |
| `p-locator`   | `page.locator()`          |
| `p-fl`        | `page.frameLocator()`     |
| `p-frames`    | `page.frames()`           |
| `p-frame`     | `page.frame()`            |
| `p-mainframe` | `page.mainFrame()`        |
| `p-get-txt`   | `page.getByText()`        |
| `p-get-r`     | `page.getByRole()`        |
| `p-get-l`     | `page.getByLabel()`       |
| `p-get-ti`    | `page.getByTestId()`      |
| `p-get-p`     | `page.getByPlaceholder()` |
| `p-get-atxt`  | `page.getByAltText()`     |
| `p-get-title` | `page.getByTitle()`       |
| `p-$`         | Create a locator           |
| `p-$$`        | `locator.all()`            |
| `p-$eval`     | `locator.evaluate()`       |
| `p-$$eval`    | `locator.evaluateAll()`    |

### Page — Actions

| Prefix     | Description              |
| ---------- | ------------------------ |
| `p-clk`    | `page.click()`           |
| `p-dbclk`  | `locator.dblclick()`     |
| `p-clki`   | `page.nth().click()`     |
| `p-fill`   | `locator.fill()`         |
| `p-type`   | `locator.pressSequentially()` |
| `p-chk`    | `page.check()`           |
| `p-uchk`   | `page.uncheck()`         |
| `p-hover`  | `page.hover()`           |
| `p-focus`  | `locator.focus()`        |
| `p-press`  | `locator.press()`        |
| `p-so`     | `page.selectOption()`    |
| `p-sif`    | `page.setInputFiles()`   |
| `p-dnd`    | `page.dragAndDrop()`     |
| `p-svp`    | `page.setViewportSize()` |
| `p-emedia` | `page.emulateMedia()`    |

### Page — State & Evaluation

| Prefix        | Description                  |
| ------------- | ---------------------------- |
| `p-isv`       | `page.isVisible()`           |
| `p-ish`       | `page.isHidden()`            |
| `p-isc`       | `page.isChecked()`           |
| `p-isen`      | `page.isEnabled()`           |
| `p-isd`       | `page.isDisabled()`          |
| `p-ised`      | `page.isEditable()`          |
| `p-getattr`   | `page.getAttribute()`        |
| `p-itxt`      | `page.innerText()`           |
| `p-count`     | `page.count()`               |
| `p-eval`      | `page.evaluate()`            |
| `p-evalh`     | `page.evaluateHandle()`      |
| `p-ais`       | `page.addInitScript()`       |
| `p-addscript` | `page.addScriptTag()`        |
| `p-addstyle`  | `page.addStyleTag()`         |
| `p-expfn`     | `page.exposeFunction()`      |
| `p-expbind`   | `page.exposeBinding()`       |
| `p-sdto`      | `page.setDefaultTimeout()`   |
| `p-sethdrs`   | `page.setExtraHTTPHeaders()` |
| `p-reqgc`     | `page.requestGC()` (v1.48+)  |

### Page — Capture & Output

| Prefix                 | Description          |
| ---------------------- | -------------------- |
| `p-screenshot-full`    | Full page screenshot |
| `p-screenshot-element` | Element screenshot   |
| `p-pdf`                | `page.pdf()`         |

### Page — Debug & Inspection (v1.56+)

| Prefix           | Description              |
| ---------------- | ------------------------ |
| `p-console-msgs` | `page.consoleMessages()` |
| `p-page-errors`  | `page.pageErrors()`      |
| `p-page-reqs`    | `page.requests()`        |

### Page — Routing

| Prefix          | Description                                  |
| --------------- | -------------------------------------------- |
| `p-route`       | `page.route()`                               |
| `p-routehar`    | `page.routeFromHAR()`                        |
| `p-unroute`     | `page.unrouteAll()`                          |
| `p-unroute-url` | `page.unroute()` — specific URL              |
| `p-ws-route`    | `page.routeWebSocket()` (v1.48+)             |
| `p-alh`         | `page.addLocatorHandler()` — overlay handler |
| `p-rlh`         | `page.removeLocatorHandler()`                |
| `p-ral`         | `page.removeAllListeners()`                  |

---

### Locator Methods

| Prefix             | Description                                  |
| ------------------ | -------------------------------------------- |
| `p-loc-all`        | `locator.all()`                              |
| `p-loc-ait`        | `locator.allInnerTexts()`                    |
| `p-loc-atc`        | `locator.allTextContents()`                  |
| `p-loc-and`        | `locator.and()` — AND match                  |
| `p-loc-or`         | `locator.or()` — OR match                    |
| `p-loc-first`      | `locator.first()`                            |
| `p-loc-last`       | `locator.last()`                             |
| `p-loc-nth`        | `locator.nth()`                              |
| `p-loc-sub`        | `locator.locator()` — sub-locator            |
| `p-loc-clear`      | `locator.clear()`                            |
| `p-loc-blur`       | `locator.blur()`                             |
| `p-loc-tap`        | `locator.tap()`                              |
| `p-loc-press`      | `locator.press()`                            |
| `p-loc-pseq`       | `locator.pressSequentially()`                |
| `p-loc-drag`       | `locator.dragTo()`                           |
| `p-loc-stxt`       | `locator.selectText()`                       |
| `p-loc-sc`         | `locator.setChecked()`                       |
| `p-loc-siv`        | `locator.scrollIntoViewIfNeeded()`           |
| `p-loc-bbox`       | `locator.boundingBox()`                      |
| `p-loc-ival`       | `locator.inputValue()`                       |
| `p-loc-ihtml`      | `locator.innerHTML()`                        |
| `p-loc-tc`         | `locator.textContent()`                      |
| `p-loc-wf`         | `locator.waitFor()` — with state             |
| `p-loc-eval`       | `locator.evaluate()`                         |
| `p-loc-evalall`    | `locator.evaluateAll()`                      |
| `p-loc-de`         | `locator.dispatchEvent()`                    |
| `p-loc-cf`         | `locator.contentFrame()`                     |
| `p-loc-filter-vis` | `locator.filter({ visible: true })` (v1.51+) |
| `p-locator-filter` | `locator.filter()` — text/not                |
| `p-loc-describe`   | `locator.describe()` (v1.53+)                |
| `p-loc-hl`         | `locator.highlight()` — debug                |
| `p-loc-aria`       | `locator.ariaSnapshot()`                     |
| `p-loc-ss`         | `locator.screenshot()`                       |

---

### Wait Actions

| Prefix     | Description                  |
| ---------- | ---------------------------- |
| `p-wf`     | `locator.waitFor()`          |
| `p-loc-wf` | `locator.waitFor({ state })` |
| `p-wfs`    | `locator.waitFor()`          |
| `p-wfls`   | `page.waitForLoadState()`    |
| `p-wft`    | `page.waitForTimeout()`      |
| `p-wfe`    | `page.waitForEvent()`        |
| `p-wff`    | `page.waitForFunction()`     |
| `p-wfn`    | `page.waitForURL()`          |
| `p-wfreq`  | `page.waitForRequest()`      |
| `p-wfres`  | `page.waitForResponse()`     |
| `p-wfurl`  | `page.waitForURL()`          |

---

### Page Events

| Prefix                  | Description                   |
| ----------------------- | ----------------------------- |
| `p-on-close`            | `page.on('close')`            |
| `p-on-console`          | `page.on('console')`          |
| `p-on-crash`            | `page.on('crash')`            |
| `p-on-dialog`           | `page.on('dialog')`           |
| `p-on-domcontentloaded` | `page.on('domcontentloaded')` |
| `p-on-download`         | `page.on('download')`         |
| `p-on-filechooser`      | `page.on('filechooser')`      |
| `p-on-frameattached`    | `page.on('frameattached')`    |
| `p-on-framedetached`    | `page.on('framedetached')`    |
| `p-on-framenavigated`   | `page.on('framenavigated')`   |
| `p-on-load`             | `page.on('load')`             |
| `p-on-pageerror`        | `page.on('pageerror')`        |
| `p-on-popup`            | `page.on('popup')`            |
| `p-on-request`          | `page.on('request')`          |
| `p-on-requestfailed`    | `page.on('requestfailed')`    |
| `p-on-requestfinished`  | `page.on('requestfinished')`  |
| `p-on-response`         | `page.on('response')`         |
| `p-on-websocket`        | `page.on('websocket')`        |
| `p-on-worker`           | `page.on('worker')`           |

---

### Assertions

#### State Assertions

| Prefix         | Description                  |
| -------------- | ---------------------------- |
| `p-etbv`       | `toBeVisible()`              |
| `p-etbh`       | `toBeHidden()`               |
| `p-etbe`       | `toBeEnabled()`              |
| `p-etbd`       | `toBeDisabled()`             |
| `p-etbc`       | `toBeChecked()`              |
| `p-e-attached` | `toBeAttached()`             |
| `p-e-empty`    | `toBeEmpty()`                |
| `p-e-focused`  | `toBeFocused()`              |
| `p-e-viewport` | `toBeInViewport()`           |
| `p-e-editable` | `toBeEditable()`             |
| `p-e-ok`       | `toBeOK()` — response status |

#### Content Assertions

| Prefix          | Description                     |
| --------------- | ------------------------------- |
| `p-etb`         | `expect().toBe()`               |
| `p-ethtxt`      | `toHaveText()`                  |
| `p-etctxt`      | `toContainText()`               |
| `p-etht`        | `toHaveTitle()`                 |
| `p-ethURL`      | `toHaveURL()`                   |
| `p-ethattr`     | `toHaveAttribute()`             |
| `p-ethc`        | `toHaveCount()`                 |
| `p-ethss`       | `toHaveScreenshot()`            |
| `p-e-val`       | `toHaveValue()`                 |
| `p-e-vals`      | `toHaveValues()` — multi-select |
| `p-e-class`     | `toHaveClass()`                 |
| `p-e-contclass` | `toContainClass()` (v1.52+)     |
| `p-e-css`       | `toHaveCSS()`                   |
| `p-e-id`        | `toHaveId()`                    |
| `p-e-jsprop`    | `toHaveJSProperty()`            |
| `p-e-role`      | `toHaveRole()`                  |

#### Accessibility Assertions

| Prefix        | Description                               |
| ------------- | ----------------------------------------- |
| `p-e-accname` | `toHaveAccessibleName()`                  |
| `p-e-accdesc` | `toHaveAccessibleDescription()`           |
| `p-e-accerrm` | `toHaveAccessibleErrorMessage()` (v1.50+) |
| `p-e-aria`    | `toMatchAriaSnapshot()` (v1.49+)          |

#### Advanced Assertions

| Prefix            | Description                         |
| ----------------- | ----------------------------------- |
| `p-config-expect` | `expect.configure()` — soft/timeout |
| `p-e-poll`        | `expect.poll()` — polling           |
| `p-e-pass`        | `expect.toPass()` — retry block     |
| `p-soft-assert`   | Soft assertions block pattern       |

---

### Network Routing

| Prefix             | Description                                  |
| ------------------ | -------------------------------------------- |
| `p-route-fulfill`  | `route.fulfill()` — mock response            |
| `p-route-abort`    | `route.abort()` — block request              |
| `p-route-continue` | `route.continue()` — pass through with edits |
| `p-route-fallback` | `route.fallback()` — next handler            |
| `p-route-fetch`    | `route.fetch()` — fetch + modify             |
| `p-route-modify`   | Intercept and modify JSON response pattern   |
| `p-net-req`        | Inspect request (method, url, headers, body) |
| `p-net-res`        | Inspect response (status, url, json)         |
| `p-net-assert`     | Wait for and assert an API response          |

---

### WebSocket Routing

| Prefix           | Description                         |
| ---------------- | ----------------------------------- |
| `p-ws-route`     | `page.routeWebSocket()` (v1.48+)    |
| `p-bc-ws-route`  | `context.routeWebSocket()` (v1.48+) |
| `p-ws-mock`      | Full WebSocket mock pattern         |
| `p-on-websocket` | `page.on('websocket')`              |

---

### Clock API (v1.45+)

| Prefix            | Description                         |
| ----------------- | ----------------------------------- |
| `p-clock-install` | `page.clock.install()` — fake clock |
| `p-clock-fixed`   | `page.clock.setFixedTime()`         |
| `p-clock-systime` | `page.clock.setSystemTime()`        |
| `p-clock-ff`      | `page.clock.fastForward()`          |
| `p-clock-run`     | `page.clock.runFor()`               |
| `p-clock-pause`   | `page.clock.pauseAt()`              |
| `p-clock-resume`  | `page.clock.resume()`               |

---

### Tracing

| Prefix              | Description                              |
| ------------------- | ---------------------------------------- |
| `p-trace-start`     | `context.tracing.start()`                |
| `p-trace-stop`      | `context.tracing.stop()`                 |
| `p-trace-chunk`     | `context.tracing.startChunk()`           |
| `p-trace-stopchunk` | `context.tracing.stopChunk()`            |
| `p-trace-group`     | `context.tracing.group()` + `groupEnd()` |
| `p-trace-full`      | Full tracing setup (beforeAll/afterAll)  |

---

### Video Recording

| Prefix         | Description                   |
| -------------- | ----------------------------- |
| `p-video-ctx`  | `newContext({ recordVideo })` |
| `p-video-path` | `page.video().path()`         |
| `p-video-save` | `page.video().saveAs()`       |

---

### Downloads & File Chooser

| Prefix               | Description                      |
| -------------------- | -------------------------------- |
| `p-on-download`      | `page.on('download')` handler    |
| `p-download-full`    | Wait + save download pattern     |
| `p-download-path`    | `download.path()`                |
| `p-download-save`    | `download.saveAs()`              |
| `p-download-name`    | `download.suggestedFilename()`   |
| `p-on-filechooser`   | `page.on('filechooser')` handler |
| `p-filechooser-full` | Wait + set files pattern         |

---

### API Testing

| Prefix          | Description                         |
| --------------- | ----------------------------------- |
| `p-api-ctx`     | `request.newContext()`              |
| `p-api-get`     | `request.get()`                     |
| `p-api-post`    | `request.post()`                    |
| `p-api-put`     | `request.put()`                     |
| `p-api-patch`   | `request.patch()`                   |
| `p-api-del`     | `request.delete()`                  |
| `p-api-head`    | `request.head()`                    |
| `p-api-fetch`   | `request.fetch()` — custom method   |
| `p-api-storage` | `request.storageState()`            |
| `p-api-dispose` | `request.dispose()`                 |
| `p-req-get`     | `page.request.get()` — shares auth  |
| `p-req-post`    | `page.request.post()` — shares auth |

---

### Keyboard, Mouse & Touch

| Prefix                  | Description                  |
| ----------------------- | ---------------------------- |
| `p-keyboard-press`      | `page.keyboard.press()`      |
| `p-keyboard-down`       | `page.keyboard.down()`       |
| `p-keyboard-up`         | `page.keyboard.up()`         |
| `p-keyboard-type`       | `page.keyboard.type()`       |
| `p-keyboard-insertText` | `page.keyboard.insertText()` |
| `p-mouse-clk`           | `page.mouse.click()`         |
| `p-mouse-dbclk`         | `page.mouse.dblclick()`      |
| `p-mouse-down`          | `page.mouse.down()`          |
| `p-mouse-move`          | `page.mouse.move()`          |
| `p-mouse-up`            | `page.mouse.up()`            |
| `p-mouse-wheel`         | `page.mouse.wheel()`         |
| `p-touch-tap`           | `page.touchscreen.tap()`     |

---

### iFrame Handling

| Prefix        | Description                 |
| ------------- | --------------------------- |
| `p-fl`        | `page.frameLocator()`       |
| `p-fl-loc`    | `frameLocator.locator()`    |
| `p-fl-role`   | `frameLocator.getByRole()`  |
| `p-fl-nested` | Nested `frameLocator` chain |
| `p-loc-cf`    | `locator.contentFrame()`    |

---

### Dialog Handling

| Prefix             | Description            |
| ------------------ | ---------------------- |
| `p-on-dialog`      | `page.on('dialog')`    |
| `p-dialog-accept`  | Accept dialog pattern  |
| `p-dialog-dismiss` | Dismiss dialog pattern |

---

### Workers & Accessibility

| Prefix          | Description                     |
| --------------- | ------------------------------- |
| `p-on-worker`   | `page.on('worker')`             |
| `p-worker-eval` | `worker.evaluate()`             |
| `p-worker-url`  | `worker.url()`                  |
| `p-acc-snap`    | `page.accessibility.snapshot()` |

---

### Page Object Model (POM)

| Prefix   | Description                   |
| -------- | ----------------------------- |
| `p-pam`  | `public async method()`       |
| `m-pom`  | POM class template            |
| `m-pome` | POM class with extended class |

---

### Complete Patterns & Templates

| Prefix               | Description                           |
| -------------------- | ------------------------------------- |
| `p-sample`           | Basic Playwright test                 |
| `p-testBlock`        | Complete test block with describe     |
| `p-newPage`          | Handle new tab / popup page           |
| `p-newPopup`         | Handle popup window                   |
| `p-dragdrop-sample`  | Drag and drop with mouse              |
| `p-saveHAR`          | Record HAR file                       |
| `p-auth-setup`       | Global auth setup with `storageState` |
| `p-route-modify`     | Intercept and modify API response     |
| `p-soft-assert`      | Soft assertions block                 |
| `p-trace-full`       | Full tracing setup                    |
| `p-ws-mock`          | Mock WebSocket responses              |
| `p-download-full`    | Wait and save file download           |
| `p-filechooser-full` | Wait and handle file chooser          |
| `p-tls-cert`         | TLS client certificate setup (v1.46+) |
| `p-mobile`           | Mobile device emulation               |
| `p-config`           | Full `playwright.config.ts` template  |

---

## Links

- Marketplace: https://marketplace.visualstudio.com/items?itemName=sumanthtps.playwright-test-code-snippets
- Repository: https://github.com/sumanthtps/playwright-studio
- Issues & feature requests: https://github.com/sumanthtps/playwright-studio/issues

---

## License

MIT
