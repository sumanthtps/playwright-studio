# Changelog

User-facing changes to Playwright Studio, newest first. Historical entries were reconstructed from Git tags, commit diffs and the version recorded in `package.json`. Dates below are repository dates; Marketplace publication dates have not been independently verified.

## 2.0.1 — 2026-10-08

### Fixed

- Support VS Code 1.70.0 and newer instead of requiring VS Code 1.140.
- Declare command and view activation events explicitly for older VS Code versions.
- Enable native coverage and continuous runs only when supported by the VS Code host.
- Build for Node.js 16 and pin VS Code API typings to 1.70.0 to preserve compatibility.

## 2.0.0 — 2026-10-07

### Added

- Native Test Explorer and a dedicated Studio activity-bar container for Tests, Results, History, Components, Annotations and Features.
- **Inspect Tests** beside Run and Debug in the Tests toolbar and on test, suite and file rows.
- **Selector Intelligence:** open a website inside VS Code, switch between browsing and inspection, and compare ranked Playwright locators, CSS selectors and XPath. Candidates are checked against the selected live element and labeled with their match count. Includes form input, open shadow roots, frame-scoped locators and copy actions.
- **Open Chrome DevTools** in the selector toolbar opens full DevTools in a separate browser window attached to the existing page, retaining its login and form state. DevTools follows the active popup and can be closed independently.
- Saved run presets, matrix options, project selection, environment-file selection, failed-test reruns, repetition, sharding and configuration health checks.
- Persistent run history, run comparisons, flaky/slow-test analytics, artifact previews and reviewed snapshot replacement.
- Istanbul/V8 coverage import, locator diagnostics and quick fixes, component/story discovery, and tag/annotation navigation.
- Intelligence workflows for failure investigation, mutation experiments, scenarios, behavior maps, change-based test selection, repair verification, product promises and journey benchmarks.
- Advanced workflows for bug capsules, checkpoint branching, product laws, agent comparisons, repair challenges, behavior differences and incident memory.
- An installed feature catalog, setup guides, JSON configuration schemas, issue templates and contributor documentation.

### Changed

- Updated development dependencies and GitHub Actions to current stable releases, with readable action version tags. TypeScript 7 handles type checks while Microsoft's TypeScript 6 compatibility package supplies the runtime AST API.
- Requires VS Code 1.140 or newer, aligned with the current VS Code API types.
- Replaced the README tour with a 48-second v2 feature GIF covering selectors, DevTools, Intelligence and Scenario Lab alongside core test workflows.
- Keep Studio and Lab configuration, generated helper scripts and exported law regressions in VS Code workspace storage outside the repository. Migrate legacy `.playwright-studio` data with conflict detection and verified copies; leave Git ignore files unchanged.

- Studio captures its runs automatically through a bundled reporter while preserving existing project reporters. Standard extension runs no longer need a configuration edit or reporter prompt.
- Test execution uses VS Code tasks and debug sessions with literal arguments, workspace-scoped configuration and cancellation tracking.
- Intelligence groups everyday workflows separately from advanced experiments, includes searchable prerequisites and setup/help shortcuts, and displays action progress, errors and retry feedback.
- Selector Intelligence uses a compact address toolbar, Browse/Inspect controls, dedicated preview states and copy confirmation.
- Closing and reopening the Selector Intelligence tab resumes its live browser, Browse/Inspect mode, selector results, sidebar scroll and unfinished address edit. State stays in memory for the current VS Code window session; reload/restart ends it.
- The Marketplace title and description emphasize test execution and snippets. The README leads with installation and first use; the full catalog remains expandable.
- Browser-side analytics and history validation are separated into named, typed helpers. Source formatting and unused-local/parameter checks are enforced.

### Fixed

- Result capture uses Playwright's public reporter API instead of loading internal files removed in recent Playwright releases. Projects, retries, annotations, steps, output and attachments remain available.
- DevTools discovery explicitly enables the automation command-line API required by current Chromium.
- Windows builds no longer confuse the extension's build script with the esbuild CLI. Consistent LF checkouts and directory junction fixtures make validation portable.
- Updated the VS Code test harness for the current macOS executable layout and isolated webview test documents to reset WebKit CSP state.
- Exact file selection no longer includes similarly named files such as a `.spec.tsx` sibling of a selected `.spec.ts` file.
- CLI discovery and health checks support Windows command shims, keep diagnostics separate from JSON output, close stdin, and bound output and execution time.
- Probe timeout cleanup terminates child processes when process inspection is available, with a fallback when process inspection is blocked.
- Invalid unchanged result files are not reparsed on every poll; watcher reloads are debounced and pending work is disposed.
- Result lookup selects the nearest matching project root without using a nested project's results for its parent.
- Test Explorer reports launch failures, nonzero exits and global report errors instead of showing a false pass or leaving a run unfinished.
- Editor discovery and locator diagnostics debounce edits. Suite nesting uses a single pass through parsed declarations.
- Intelligence acknowledges completed/cancelled picker actions, reports failures in the panel, rejects duplicate requests and permits cancellation while an action runs.
- Cancel All Runs cancels the experiment loop as well as the currently executing task.
- Selector browsing queues interactions during screenshot updates instead of silently dropping clicks or text, and clears stale candidates after page changes.
- Browse mode accepts typing directly after clicking a website field, including Enter/Tab navigation, selection shortcuts, undo/redo, plain-text paste and composed text. Ordinary typing emits keyboard events for input masks and page handlers; adjacent queued text is combined without reordering clicks or edits.
- Forward double-clicks, hover menus, drag gestures and pointer-positioned scrolling. Fix native dropdown keyboard selection on headless Chrome. Copy/cut selected text with Cmd/Ctrl+C/X, retain undo behavior, and prevent copying passwords. Escape returns keyboard focus to the toolbar.
- Selector Intelligence handles a missing Playwright Chromium executable by trying installed Chrome and Edge under the default browser setting. Explicit browser settings remain respected.
- Browser startup errors show readable recovery actions instead of a raw launch-error dump. Install Chromium uses the project's Playwright installer and retries the last URL; Use Chrome and Use Edge apply to the current VS Code window session.
- Exclude generated HTML reports and local Studio state from the extension package.
- Correct task/debug event races, runtime/parameterized case selection, environment parsing, coverage boundaries, and reporter/video configuration edits.
- Retain cancellation requested during task startup until the process can be terminated, and never report a cancelled execution as successful.
- Use platform-aware path assertions and allow sufficient browser and DevTools startup time in cross-platform validation. Disable hardware GPU rendering in Linux extension-host tests under Xvfb.

### Security

- Enforce Workspace Trust at process and command boundaries; constrain webview actions and use cryptographic CSP nonces.
- Restrict report-driven artifact access and coverage sources to authorized filesystem roots; reject escaping symlinks and unsafe portable paths.
- Bound imported files and archives, reject devices/FIFOs, and validate capsule hashes and encoded content.
- Review snapshot changes before replacement and avoid writing through linked destination files or predictable temporary paths.
- Validate history records before use; cap each history file at 16 MB and 500 records and write it atomically. Records that exceed the budget are not retained in history.
- Selector Intelligence renders website screenshots rather than executing website HTML in the extension webview. Its worker accepts fixed browser actions, and selector copies use inspected candidates. Website copy/cut text is accepted only for an explicit pending clipboard action and never retained in panel state. Full DevTools uses a random loopback port with access restricted to Chrome’s bundled frontend origin.
- Dependency audit and pinned GitHub Actions gate packaging and release. Bundled dependency licenses are included.

### Removed

- Obsolete automatic JSON-reporter prompting and its unused dismissal state.
- An unused capsule file reader, unused imports/parameters, and the completed snippet migration script. Edit snippet definitions directly.
- Unused `semantic-release` and `semantic-release-vsce` development dependencies; their removal pruned 399 installed packages.
- Obsolete local VSIX builds and the changelog's ignore rule, so release notes can be versioned and packaged.

### Upgrade notes

- The extension ID remains `sumanthtps.playwright-test-code-snippets`; existing users retain the same update path.
- Requires VS Code 1.140 or newer and a trusted workspace for execution. Use the project's installed Playwright and browser binaries.
- Selector Intelligence tries Playwright Chromium by default, with installed Chrome and Edge as fallbacks for missing executables. Set `playwrightSnippets.selectorBrowserChannel` to `chrome` or `msedge` to select that browser explicitly. Its browser session is separate from your normal browser profile.
- Full DevTools requires a graphical desktop and installed Chrome, full Playwright Chromium or Edge. A headless-shell-only browser installation cannot display its frontend. Browser and DevTools state is not restored across VS Code reloads or restarts.
- Test recency highlighting is not measured application line coverage. Import Istanbul/V8 data for line coverage.
- Advanced workflows require their documented adapters, selected tests or recorded evidence. Isolated source copies are not an operating-system sandbox for untrusted code.

## Changes after 1.1.1 — August 2026

These commits retain version 1.1.1 in `package.json` and have no later release tag. They are listed separately rather than attributed to a fabricated 1.2.0 release.

- **2026-08-30:** Add `reportPath` configuration and improve HTML-report path handling. [bcd563f](https://github.com/sumanthtps/playwright-studio/commit/bcd563f)
- **2026-08-30:** Improve command arguments, test/project parsing, environment profiles, gutter handling and snippet-file updates; add runtime and VS Code integration checks; correct snippet definitions. [69c8295](https://github.com/sumanthtps/playwright-studio/commit/69c8295)
- **2026-08-16:** Validate snippet names/prefixes and improve error handling when saving snippets. [84763c4](https://github.com/sumanthtps/playwright-studio/commit/84763c4)

## [1.1.1] — 2026-05-09

- Add optional JSON-reporter setup, including detection of an existing reporter, an Add JSON Reporter command and an Open Config action.
- Add setup prompting and workspace dismissal handling used by this historical version.
- Document result-capture setup and troubleshooting.

Source: [changes from 1.1.0 to 1.1.1](https://github.com/sumanthtps/playwright-studio/compare/v1.1.0...v1.1.1).

## [1.1.0] — 2026-05-09

- Add the results sidebar, pass/fail/flaky/skipped gutter markers, failure diagnostics and result storage.
- Add environment profiles and status-bar summaries.
- Add fixture definition navigation, test-recency highlighting, and Save Selection as Snippet.
- Add tag extraction and project selection; improve Inspector and trace/report commands.
- Add configurable result capture and execution environment integration.
- Update the locked `lodash-es` dependency in the April 2 maintenance commit preceding this release. [487bd86](https://github.com/sumanthtps/playwright-studio/commit/487bd86)

Source: [1.1.0 changes](https://github.com/sumanthtps/playwright-studio/commit/18167cf).

## [1.0.0] — 2026-03-28

- Add getting-started walkthroughs for running tests, Codegen and Trace Viewer.
- Improve command target resolution and CodeLens labels.
- Correct run/inspect behavior by removing unnecessary working-directory changes.
- Update the feature documentation and preview; refresh locked dependencies for security fixes.

Sources: [feature update](https://github.com/sumanthtps/playwright-studio/commit/8faf1a6), [dependency refresh at the release tag](https://github.com/sumanthtps/playwright-studio/commit/fdaf5d1).

## [0.0.6] — 2026-03-20

- Introduce the Playwright Studio name and editor CodeLens for running, debugging and inspecting tests and suites.
- Add Codegen, Trace Viewer and HTML-report commands.
- Add working-directory, test-command, reporter and environment configuration.
- Introduce the TypeScript extension runtime and bundled build.
- Expand the snippet catalog to 338 definitions during the March updates.
- Add snippet validation, CI/release workflows and packaging exclusions; remove generated VSIX files from source control.

Sources: [Studio runtime](https://github.com/sumanthtps/playwright-studio/commit/2aaab3f), [CI and package cleanup](https://github.com/sumanthtps/playwright-studio/commit/a332898). The package version first changed to 0.0.6 on March 19; the Studio transition was committed on March 20.

## 0.0.5 — 2023-12-28

- Expand the snippet catalog from 81 to 150 definitions.
- Refresh the README and display name to Playwright Snippets 2024.

Source: [81e7643](https://github.com/sumanthtps/playwright-studio/commit/81e7643).

## 0.0.4 — 2023-08-21

- Update the README and package version. The catalog remains at 81 snippets.

Source: [4f7deea](https://github.com/sumanthtps/playwright-studio/commit/4f7deea).

## 0.0.3 — 2023-08-21

- Expand the catalog from 57 to 81 snippets and refresh the documentation and package metadata.
- Use the Playwright Snippets 2023 display name.

Source: [ab89964](https://github.com/sumanthtps/playwright-studio/commit/ab89964). The repository's `snippets` tag points to this commit.

## 0.0.2 — 2023-08-12

- Expand the catalog from 40 to 57 snippets and update usage documentation.

Source: [62bcf11](https://github.com/sumanthtps/playwright-studio/commit/62bcf11).

## 0.0.1 — 2023-07-30

- Initial Playwright Snippets Suite with 40 snippet definitions, an extension icon, preview and MIT license.

Source: [9c6982a](https://github.com/sumanthtps/playwright-studio/commit/9c6982a).

[1.1.1]: https://github.com/sumanthtps/playwright-studio/releases/tag/v1.1.1
[1.1.0]: https://github.com/sumanthtps/playwright-studio/releases/tag/v1.1.0
[1.0.0]: https://github.com/sumanthtps/playwright-studio/releases/tag/v1.0.0
[0.0.6]: https://github.com/sumanthtps/playwright-studio/releases/tag/v0.0.6
