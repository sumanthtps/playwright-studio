# Validation and feature coverage

Run `npm run typecheck` to check both extension source and tests. Run `npm test` for the portable test suites, and `npm run test:integration` for a real VS Code extension host. The integration runner creates disposable fixtures under `.vscode-test`; it does not run tests in the user's application repository.

## v2 dependency refresh — 2026-10-07

Local validation uses the latest stable direct dependencies, including Playwright 1.63, TypeScript 7 and the TypeScript 6 AST compatibility package. The checks cover 245 portable tests, six real Playwright experiments, four advanced experiments, Chromium/WebKit browser workflows, 17 selector-browser tests, four DevTools tests, and the VS Code integration workflow with 34 feature checks. Formatting, type checks, dependency audit and VSIX verification are separate gates.

The capture-reporter regression runs two projects with retries and verifies nested titles, flaky/skipped outcomes, annotations, tags, output, steps and binary attachments while preserving a configured JUnit reporter. It exercises the public Playwright reporter API rather than internal package paths.

Firefox cannot launch on this local macOS host because its profile directory is inaccessible. This matches the [upstream macOS Firefox issue](https://github.com/microsoft/playwright/issues/42768). Firefox remains enabled in Linux CI; a local launch failure is not counted as passing coverage. Windows and Linux results require a new GitHub Actions run of the updated branch.

To regenerate the README panels from tested local fixtures, run `npm run demo:captures`; on macOS, `npm run demo:gif` assembles the captioned tour using FFmpeg and Swift. See the [tour guide](../docs/tour.md).

## Verified on 2026-09-07

- Source and test TypeScript checks: passed.
- Snippets: 10 checks validating all 338 snippet definitions.
- Runtime helpers: 27 tests covering command parsing, case filtering, test/fixture/project parsing, automatic project detection, reporter/video configuration edits, report parsing and JSONC snippet edits.
- Commands: 63 tests, including a completeness assertion for all 54 published commands.
- VS Code: original activation, task execution, multi-root diagnostics, quarantine, trace/report routing, locator actions, coverage and artifact smoke workflow, plus 30 feature checks.
- Production bundle and installable VSIX: built successfully.
- Real Playwright 1.58.2: a browser-free test captured JSON through the bundled reporter bridge while retaining the project's HTML and JUnit reporters.

## Test boundaries

Command tests simulate prompts, task execution, debug sessions, clipboard access and external application handoffs. Their GitHub posting test never sends a comment. Project graph and health-check command tests use a local mock CLI. The live VS Code tests execute real local Node tasks and verify cancellation, editor APIs, discovery, diagnostics, providers and webview creation, using mock Playwright reports.

The tests do not install/update browser binaries, contact an application under test, invoke a remote AI agent, publish GitHub comments, or overwrite a user's snapshot baseline. Browser rendering, real Playwright Inspector/Codegen sessions, remote-service outcomes, and Windows/Linux behavior still require environment-specific smoke testing. Snippet checks validate definitions and selected known-invalid APIs, not the execution of every snippet against every supported Playwright version.

## Regressions covered

- Tasks ending without a process event and debug sessions terminating during launch no longer strand waiters.
- Cancellation does not launch a pre-cancelled task or stop unrelated debug sessions.
- Results received before process completion are consumed; runtime cases are matched by title/project.
- Failed-case reruns include project/title filtering and allow the tags Playwright appends to grep titles.
- Test Explorer updates unsaved edits, clears deleted targets and nests suites sharing one line correctly.
- File presets reject non-test editors; environment paths are relative to the configured working directory.
- Environment parsing preserves single-quoted backslashes, handles multiline quoted values/comments and reports unreadable configured files.
- Locator actions preserve escaped selectors and ignore examples in comments/strings.
- Coverage preserves multiline end columns, includes single-range V8 functions and counts nested branches once.
- Result and annotation views initialize/count correctly; parameterized cases remain separate in analytics and comparisons.
- Report parsing rejects unrelated JSON and preserves terminal hyperlink labels.
- Artifact command-palette invocation works without a tree argument; snapshot acceptance requires a corresponding actual/expected pair.
- History clearing uses a confirmation picker, avoiding VS Code's test-host restriction on modal dialogs.
- Default result capture does not require config edits; explicit reporters and disabling capture are covered.

Playwright's grep title composition is documented in the [TestConfig API](https://playwright.dev/docs/api/class-testconfig#test-config-grep).

## Intelligence validation (2026-09-10)

The eight Intelligence workflows add nine public commands and a shared webview. Validation now includes:

- `npm run typecheck`: source and test types.
- `npm test`: 125 portable checks (10 snippet, 27 runtime, 72 command, 16 Intelligence).
- `npm run test:experiments`: five real Playwright checks for detected/surviving mutations, three-attempt repair verification, scenario fixture composition, reporter compatibility, and journey adapter inputs.
- `npm run test:integration`: native VS Code activation/task/provider checks plus 31 feature checks, including the Intelligence webview.
- `STUDIO_BROWSER_CHANNEL=chrome npm run test:browser`: real HTTP faults, latency, clock control, offline behavior, trace extraction, dashboard rendering, and scenario form interactions. Uses a temporary local server and fresh headless browser profiles.

The real-runner tests use disposable application copies and preserve their original sources. They test missing selections and expected failures as inconclusive outcomes. Agent-provider calls are not exercised; journey tests validate the executable adapter contract. See [Intelligence guide](../docs/intelligence.md) for configuration, supported inputs, isolation boundaries, and retention limits.

## Advanced workflows and CI

`npm test` includes schema/path validation, deterministic law generation and reduction,
negative-control verdicts, behavior comparison, agent metrics, command coverage and UI contracts.
Every contributed command is required to have a behavioral command test.

Additional suites execute the workflows with real Playwright:

```sh
npm run test:lab-experiments   # Capsules, repair challenges, incident regression controls
npx playwright install chromium
npm run test:lab-browser      # Checkpoint branches, laws, agent metrics, Git behavior diffs
```

To use installed Chrome locally, prefix browser commands with
`STUDIO_BROWSER_CHANNEL=chrome`. Set `STUDIO_BROWSER=firefox` or `webkit` after
installing that engine to run both browser suites against it. The simulated agent
adapter in tests needs no provider credentials. Process logs, JSON reports and
trace artifacts from the new execution suites stay in `.test-dist/lab-experiments`
and `.test-dist/lab-browser`; temporary application sources are deleted.

The reusable `.github/workflows/validation.yml` runs:

| Job | Coverage |
| --- | --- |
| Quality | TypeScript and all portable tests on Linux/Windows/macOS with Node 22; Linux also uses Node 24 and 26. |
| Experiments | Existing mutation/repair/reporter/journey tests and new capsule/repair-challenge/incident workflows on all three operating systems. |
| Browsers | Scenario injection, trace inspection, webview interaction, branches, laws, agent metrics and behavior diffs on Chromium, Firefox and WebKit. |
| Extension host | Command registration and feature integration on VS Code Stable for all three operating systems, plus Insiders on Linux. |
| Package | Build a VSIX only after all jobs pass; inspect its runtime, command contributions, feature catalog, schemas, 1,500,000-byte budget, and exclusion of development files and demo media. |

CI calls this validation workflow only on pull requests. Release tags trigger a
separate workflow that packages and publishes the extension without running tests.
The release workflow can also be started manually for a release tag.
Browser/experiment jobs retain artifacts even after failure. No live provider
credentials or repository write permissions are needed for validation.

`STUDIO_VSCODE_VERSION=stable` or `insiders` selects a downloaded extension host.
Without it, the integration harness can use the installed macOS VS Code or
`VSCODE_EXECUTABLE_PATH`. Linux CI uses `xvfb-run` for Electron.

The portable checks also run `npm run check:features`: every contributed command
must have a unique described entry in `src/featureCatalog.json`, and the README
and packaged guide must match it. After catalog changes, run `npm run docs:features`.
The extension-host suite checks sidebar entries and opening their documentation.
Demo GIF/screenshots remain in the repository and are linked remotely by the
documentation; runtime icons, walkthrough images, schemas and licenses stay in the VSIX.

`npm run test:security` is part of `npm test`. It covers file-access boundaries,
dangling symlinks, snapshot races/hardlinks, bounded imports, capsule paths and
credentials, process trust checks, URL schemes, and webview action authorization.
See [the security review](../docs/security-review.md) for findings and behavior changes.
CI also audits locked dependencies before packaging. Verify the release VSIX
locally before publishing.

## September 12 cleanup regressions

`npm run test:production` covers exact file filtering, malformed report coordinates,
invalid/oversized history, bounded retention, atomic writes and link protection,
result polling and disposal, project-root matching, CLI output/timeout handling,
and Test Explorer error states. It is included in `npm test`.

The browser suite also executes the extracted analytics client, checks workspace/project
filtering and empty history, and verifies that a script-shaped test title stays text.
The lab experiment suite exercises the shared process-tree cleanup against a detached
child. Browser and process-inspection tests require a host that permits localhost
listeners, browser launch and process inspection.

`npm run format:check` and unused-local/parameter TypeScript checks now run in CI.

## Selector and Intelligence interaction checks

`npm run test:selectors` is part of `npm test`. It covers the browser action protocol,
Workspace Trust, candidate-only clipboard writes, all 15 dashboard action routes,
error/retry feedback, duplicate requests and cancelling the experiment loop.
The session suite also covers closing and reopening the selector panel without launching
a replacement browser, restored view preferences, replies arriving while closed or before
the new webview is ready, pending action status, delayed clipboard completion, and browser
installation continuing across panel replacement. These checks use a fake worker and do
not persist website data to disk.

`npm run test:selector-browser` uses real Chromium to verify ranked role/test-ID/CSS/XPath
locators, ambiguous names, labels, placeholders, images, shadow roots, iframe scopes,
form input, the packaged worker and interactive webview copy/navigation behavior.
It also checks that pending browser work cannot swallow user interactions and that
errors clear queued actions. Browse regressions exercise direct typing through the preview,
keyboard focus, Enter/Tab, text selection and editing, multiline and iframe fields,
and input queued during screenshot updates. Protocol checks validate bounded paste actions.
Backend checks cover page keyboard handlers,
double-click selection and scrolling at the pointer position. Scenario Lab's browser check covers all 16 combinations
of latency, offline mode, HTTP error and clock controls.
It runs in the Chromium CI job. `STUDIO_BROWSER_CHANNEL=chrome` uses installed Chrome
for local validation. The extension-host suite also checks sidebar Inspect routing.

Full Chrome DevTools is a separate window attached to the existing browser target. Its
browser checks verify that the frontend opens, retains the page's form and session state,
and follows active popups. A headed smoke check requires a graphical desktop; headless
frontend checks do not prove window-manager behavior on every supported operating system.
Panel restoration applies within one VS Code window session, not after an extension-host
restart.

## Local data and browser interaction regressions

`npm run test:storage` verifies migration, clean Git status with unchanged ignore files, config persistence, project isolation, conflicts and unsafe paths. The Product Laws browser test also migrates an adapter with relative imports and executes its exported regression from local storage.

`npm run test:selector-browser` covers direct Browse typing, rapid input, masked and controlled fields, Enter/Tab, selection/deletion, paste/composition, copy/cut/undo, password protection, native selects, hover menus, drag controls, scrolling, iframe/shadow inputs and panel restoration. `npm run test:selector-devtools` checks the full DevTools frontend against the same page, its Console connection, popup tracking, window lifecycle and rejected webpage origins.
