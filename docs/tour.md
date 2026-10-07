# Playwright Studio in VS Code

[Back to README](../README.md) · [Setup guide](guide.md) · [Watch the GIF](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/preview.gif)

The tour contains **19 captioned scenes**, including a catalog of the **54 commands available when recorded**. Each link below opens the original capture at full size.

These are captures of the running extension in a VS Code development window. The checkout example uses deterministic sample results, artifacts, and coverage. Captions are placed below the original interface. The four **Available actions** scenes show command entry points; they do not claim that external browsers, Inspector, Codegen, remote agents, or GitHub posting were executed in this recording.

## Scene index

| Start | Scene | What is shown |
| --- | --- | --- |
| 0:00 | [Run, debug, inspect](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/01-editor.jpg) | File, suite, test and tag actions directly above your code. |
| 0:04 | [338 Playwright snippets](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/13-snippets.jpg) | Browse JavaScript and TypeScript completions with the p- prefix. |
| 0:08 | [Locator diagnostics and quick fixes](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/12-locator-fixes.jpg) | Convert legacy selectors to semantic locators or open the live picker. |
| 0:12 | [Navigate custom fixtures](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/19-fixtures.jpg) | Hover over a fixture parameter to find its definition and source link. |
| 0:16 | [Native Test Explorer](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/07-test-explorer.jpg) | Discover files, suites and tests; access run, debug and continuous-run controls. |
| 0:20 | [Choose browser projects](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/09-projects.jpg) | Select Chromium, Firefox, WebKit or your own configured projects. |
| 0:24 | [Switch environment profiles](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/08-environments.jpg) | Choose a named environment without editing your test code. |
| 0:28 | [Build a run configuration](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/10-matrix.jpg) | Workers, retries, repeat, trace, video, timeouts, shards and snapshot policies. |
| 0:32 | [Reuse saved presets](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/03-presets.jpg) | Keep frequent project, scope and run-option combinations in a picker. |
| 0:36 | [Review captured results](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/02-results.jpg) | Passing, failing and flaky sample outcomes with source navigation. |
| 0:40 | [Compare snapshot artifacts](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/06-artifacts.jpg) | Expected and actual attachments; component stories and annotations in the sidebar. |
| 0:44 | [Revisit run history](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/04-history.jpg) | Persisted sample runs, test outcomes and failure-first navigation. |
| 0:48 | [Track flaky and slow tests](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/05-analytics.jpg) | Failure trends, unstable tests and durations from captured sample history. |
| 0:52 | [Import native code coverage](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/18-coverage.jpg) | An Istanbul fixture rendered as covered and uncovered lines in VS Code. |
| 0:56 | [Export and share results](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/11-exports.jpg) | Markdown, JSON, JUnit and GitHub summary actions. No external post is made. |
| 1:00 | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) | Cancellation, history, CI commands, debug, Inspector, agents and coverage. |
| 1:08 | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) | Browsers, presets, Codegen, live picker, UI Mode, components and quarantine. |
| 1:16 | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) | Shards, failed runs, health checks, tags, custom snippets and optional setup. |
| 1:24 | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) | HTML reports, project graph, traces, environments, browser updates and watch. |

## Command coverage

The 54 commands recorded for this tour are visible in at least one catalog capture. See the [current feature catalog](features.md) for all available commands and editor integrations. Some also appear in the dedicated workflow scenes above. This table tracks visibility in the animation, not behavioral test coverage.

| Command | Catalog capture |
| --- | --- |
| Cancel All Runs | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Clear Run History | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Compare Two Runs | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Copy Sharded CI Command | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Create Test Plan with Planner Agent | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Debug All Tests in File | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Debug All Tests with Inspector | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Debug Test | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Debug Test with Inspector | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Export Latest Results | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Generate Tests from Reviewed Plan | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Heal Captured Failures with Agent | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Import Istanbul/V8 Coverage | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Initialize Playwright Test Agents | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Inspect All Tests in File | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Inspect Test | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Inspect Test at Cursor | [Available actions 1/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/14-command-catalog.jpg) |
| Install Playwright Browsers | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Manage Saved Run Presets | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Codegen | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Component Testing Gallery | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Live Locator Picker | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Multi-Root Workspace Dashboard | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Playwright UI Mode | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Run History as Markdown | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Open Test Artifact | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Post Latest Results to GitHub | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Quarantine Test at Cursor | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Remove Test Quarantine at Cursor | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Repeat Until Failure | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Review and Accept Snapshot Artifacts | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Run a Shard | [Available actions 2/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/15-command-catalog.jpg) |
| Run All Tests in File | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Configuration Health Check | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Failed Tests | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Last Failed | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Saved Preset | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Test | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Test at Cursor | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Tests with Project Selection | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run Tests with Tag / Grep Filter | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Run with Matrix Options | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Save Selection as Snippet | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Select .env File | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Set Up Result Capture (Add JSON Reporter) | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Set Up Video Policy Override | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Show Flaky and Duration Analytics | [Available actions 3/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/16-command-catalog.jpg) |
| Show HTML Report | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Show Project Dependency Graph | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Show Trace Viewer | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Switch Environment Profile | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Update Playwright Browsers | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Update Screenshots and ARIA Snapshots | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |
| Watch Current Test File in UI Mode | [Available actions 4/4](https://raw.githubusercontent.com/sumanthtps/playwright-studio/main/images/demo/17-command-catalog.jpg) |

The snippet scene shows the completion list, rather than expanding all 338 snippets individually. The README preserves the full snippet reference.

## Refreshing the tour

Replace captures in `images/demo` with images of the actual extension. Update `scripts/demo-scenes.json` when a scene or command changes, then run `node scripts/build-demo-gif.js` on macOS with Swift and FFmpeg installed. The build checks that every published command has a catalog scene, adds captions without covering the interface, and produces the looping GIF. Keep sample data and external-tool entry points clearly identified.
