# Playwright Studio feature catalog

Each of the **98 entries** below has its own description. Open **Playwright Studio → Features** in the sidebar, or run **Playwright Studio: Open Feature Catalog**. Entries include all **76 commands** and editor integrations; all **338 snippets** are listed in the [snippet reference](../README.md#snippets-reference).

Select a feature in the sidebar to open its entry here. To use a command, open the Command Palette and search for its name. Editor commands use your active test file or selection; open that file before running them.

[Setup and troubleshooting](guide.md) · [Intelligence workflows](intelligence.md) · [Advanced workflows](lab.md)

## Editor and sidebar features

<a id="snippets"></a>

### 338 JavaScript and TypeScript snippets

Type p- in JavaScript, TypeScript, JSX or TSX to browse test, locator, assertion, API, network, browser and other snippet families.

<a id="test-discovery"></a>

### Native Test Explorer

Discover files, suites and tests in the Studio Tests view and VS Code Testing view; captured runtime cases extend static discovery.

<a id="continuous-runs"></a>

### Continuous test runs

Enable continuous runs through the native Testing API to rerun selected tests when relevant files change.

<a id="codelens"></a>

### Editor CodeLens actions

Use inline Run, Debug and Inspect actions above tests and suites, including tag actions.

<a id="result-capture"></a>

### Automatic result capture

Studio adds its capture reporter at run time while preserving existing reporters; normal extension runs need no JSON reporter edit.

<a id="results-tree"></a>

### Results sidebar

Browse captured passed, failed, flaky and skipped outcomes, project groups and source locations.

<a id="failure-gutter"></a>

### Test status in the editor gutter

See pass, failure, flaky and skipped status beside test source lines.

<a id="failure-problems"></a>

### Failure diagnostics in Problems

Navigate captured failures through the Problems panel with messages and available trace links.

<a id="captured-evidence"></a>

### Attempts, steps and output

Inspect captured attempts, step summaries, stdout/stderr, attachments and source/runtime metadata through results and evidence reports.

<a id="persistent-history"></a>

### Persistent run history

Retain workspace run summaries and outcomes between VS Code sessions and navigate back to their source.

<a id="status-bar"></a>

### Environment and run status bar

See the selected environment and most recent run summary in the VS Code status bar.

<a id="recency-heatmap"></a>

### Test recency highlights

Highlight test coverage recency from captured results; this is separate from measured application line coverage.

<a id="fixture-definition"></a>

### Go to fixture definition

Jump from a custom fixture parameter to its workspace definition.

<a id="fixture-hover"></a>

### Fixture hover information

Hover over a fixture parameter to inspect its definition and source link.

<a id="locator-diagnostics"></a>

### Locator diagnostics

Highlight supported legacy selector patterns and suggest more maintainable locators.

<a id="locator-quick-fixes"></a>

### Locator quick fixes

Apply supported semantic locator or legacy API replacements through editor quick fixes.

<a id="component-sidebar"></a>

### Components sidebar

Discover component tests and stories and navigate to their source.

<a id="annotations-sidebar"></a>

### Tags and annotations sidebar

Browse captured tags, test annotations and quarantine context with source navigation.

<a id="config-detection"></a>

### Automatic project detection

Find the nearest supported Playwright configuration and resolve runs in the appropriate project or workspace root.

<a id="json-config"></a>

### Studio and lab JSON validation

Get validation and completions for local Studio and Lab configuration in VS Code workspace storage.

<a id="keyboard-shortcuts"></a>

### Keyboard shortcuts

Run the test at the cursor with Ctrl+Alt+R (Cmd+Alt+R on macOS) or open tag/grep selection with Ctrl+Alt+T (Cmd+Alt+T).

<a id="getting-started"></a>

### Getting started walkthrough

Use VS Code Get Started to learn editor execution, Codegen and trace/report inspection.

## Run and debug

<a id="runtest"></a>

### Run Test

Run one test or suite selected from the active test file.

**Command:** Playwright Studio: Run Test

<a id="runfile"></a>

### Run All Tests in File

Run every test in the active or selected test file.

**Command:** Playwright Studio: Run All Tests in File

<a id="debugtest"></a>

### Debug Test

Run a selected test under the VS Code debugger with breakpoints.

**Command:** Playwright Studio: Debug Test

<a id="debugfile"></a>

### Debug All Tests in File

Debug every test in a file with the VS Code debugger.

**Command:** Playwright Studio: Debug All Tests in File

<a id="inspecttest"></a>

### Inspect Test

Run a selected test with Playwright Inspector.

**Command:** Playwright Studio: Inspect Test

<a id="inspectfile"></a>

### Inspect All Tests in File

Run a file with Playwright Inspector.

**Command:** Playwright Studio: Inspect All Tests in File

<a id="debuginspecttest"></a>

### Debug Test with Inspector

Use VS Code debugging and Playwright Inspector together for a selected test.

**Command:** Playwright Studio: Debug Test with Inspector

<a id="debuginspectfile"></a>

### Debug All Tests with Inspector

Use VS Code debugging and Playwright Inspector together for a test file.

**Command:** Playwright Studio: Debug All Tests with Inspector

<a id="runtestatcursor"></a>

### Run Test at Cursor

Run the test at the editor cursor using its source line.

**Command:** Playwright Studio: Run Test at Cursor

<a id="inspecttestatcursor"></a>

### Inspect Test at Cursor

Open Playwright Inspector for the test at the editor cursor.

**Command:** Playwright Studio: Inspect Test at Cursor

<a id="runexplorertests"></a>

### Run Tests

Run the selected test, suite or file from the Tests sidebar, or all discovered tests from its toolbar.

**Command:** Playwright Studio: Run Tests

<a id="debugexplorertests"></a>

### Debug Tests

Debug the selected sidebar tests, or all discovered tests from its toolbar.

**Command:** Playwright Studio: Debug Tests

<a id="inspectexplorertests"></a>

### Inspect Tests

Open selected tests, suites or files in Playwright Inspector from the eye icon beside Run and Debug.

**Command:** Playwright Studio: Inspect Tests

<a id="refreshtests"></a>

### Refresh Tests

Refresh source discovery in the Studio sidebar and native Test Explorer.

**Command:** Playwright Studio: Refresh Tests

<a id="openuimode"></a>

### Open Playwright UI Mode

Launch Playwright UI Mode for interactive test execution and inspection.

**Command:** Playwright Studio: Open Playwright UI Mode

<a id="watchfile"></a>

### Watch Current Test File in UI Mode

Launch UI Mode scoped to the current test file for reruns while editing.

**Command:** Playwright Studio: Watch Current Test File in UI Mode

<a id="cancelruns"></a>

### Cancel All Runs

Stop the extension's active test tasks and debug sessions, including the current experiment execution.

**Command:** Playwright Studio: Cancel All Runs

## Run selection and configuration

<a id="runwithtag"></a>

### Run Tests with Tag / Grep Filter

Select a discovered tag or enter a grep expression to filter tests.

**Command:** Playwright Studio: Run Tests with Tag / Grep Filter

<a id="runwithproject"></a>

### Run Tests with Project Selection

Choose one or more configured Playwright browser projects.

**Command:** Playwright Studio: Run Tests with Project Selection

<a id="runmatrix"></a>

### Run with Matrix Options

Choose scope, projects, grep, headed mode, workers, retries, repetitions, timeouts, trace/video policies, shards and snapshot options; optionally save a preset.

**Command:** Playwright Studio: Run with Matrix Options

<a id="runpreset"></a>

### Run Saved Preset

Run a saved combination of test scope, projects, options and environment profile.

**Command:** Playwright Studio: Run Saved Preset

<a id="managerunpresets"></a>

### Manage Saved Run Presets

Rename, duplicate, edit, delete or run saved presets.

**Command:** Playwright Studio: Manage Saved Run Presets

<a id="runfailed"></a>

### Run Failed Tests

Rerun failed tests from the latest captured results.

**Command:** Playwright Studio: Run Failed Tests

<a id="runlastfailed"></a>

### Run Last Failed

Use Playwright's last-failed selection for the project.

**Command:** Playwright Studio: Run Last Failed

<a id="repeatuntilfailure"></a>

### Repeat Until Failure

Repeat a selected test with an iteration limit and stop on failure.

**Command:** Playwright Studio: Repeat Until Failure

<a id="runshard"></a>

### Run a Shard

Run one numbered shard of the selected test suite.

**Command:** Playwright Studio: Run a Shard

<a id="copycicommand"></a>

### Copy Sharded CI Command

Copy a Playwright command with sharding options for use in CI.

**Command:** Playwright Studio: Copy Sharded CI Command

## Results and artifacts

<a id="setupcaptureresults"></a>

### Set Up Result Capture (Add JSON Reporter)

Optionally add JSON reporting to the project config for runs outside Studio; extension-managed runs already capture results automatically.

**Command:** Playwright Studio: Set Up Result Capture (Add JSON Reporter)

<a id="showtrace"></a>

### Show Trace Viewer

Open a captured or selected trace archive in Playwright Trace Viewer.

**Command:** Playwright Studio: Show Trace Viewer

<a id="showreport"></a>

### Show HTML Report

Open the project's Playwright HTML report.

**Command:** Playwright Studio: Show HTML Report

<a id="openartifact"></a>

### Open Test Artifact

Inspect captured screenshot, video, trace and other test attachments.

**Command:** Playwright Studio: Open Test Artifact

<a id="reviewsnapshots"></a>

### Review and Accept Snapshot Artifacts

Review expected, actual and diff attachments and choose whether to accept a snapshot.

**Command:** Playwright Studio: Review and Accept Snapshot Artifacts

<a id="updatesnapshots"></a>

### Update Screenshots and ARIA Snapshots

Rerun tests with screenshot and ARIA snapshot updates enabled.

**Command:** Playwright Studio: Update Screenshots and ARIA Snapshots

<a id="setupvideooverride"></a>

### Set Up Video Policy Override

Set up the optional config hook that allows Studio's video policy override to take effect.

**Command:** Playwright Studio: Set Up Video Policy Override

## History and test health

<a id="showanalytics"></a>

### Show Flaky and Duration Analytics

Review flaky tests, failure frequency and test durations from captured run history.

**Command:** Playwright Studio: Show Flaky and Duration Analytics

<a id="compareruns"></a>

### Compare Two Runs

Compare outcomes and timing between two saved runs.

**Command:** Playwright Studio: Compare Two Runs

<a id="exporthistory"></a>

### Open Run History as Markdown

Open the workspace's recorded run history as Markdown.

**Command:** Playwright Studio: Open Run History as Markdown

<a id="clearhistory"></a>

### Clear Run History

Remove saved run history after confirmation.

**Command:** Playwright Studio: Clear Run History

<a id="quarantinetest"></a>

### Quarantine Test at Cursor

Mark the test at the cursor as quarantined with a reason.

**Command:** Playwright Studio: Quarantine Test at Cursor

<a id="unquarantinetest"></a>

### Remove Test Quarantine at Cursor

Remove the quarantine marker from the test at the cursor.

**Command:** Playwright Studio: Remove Test Quarantine at Cursor

## Writing and maintaining tests

<a id="codegen"></a>

### Open Codegen

Launch Playwright Codegen to record interactions and generate tests.

**Command:** Playwright Studio: Open Codegen

<a id="openlocatorpicker"></a>

### Open Live Locator Picker

Launch the live Playwright locator picker for a target page.

**Command:** Playwright Studio: Open Live Locator Picker

<a id="saveassnippet"></a>

### Save Selection as Snippet

Save the selected editor text as a reusable snippet in the current VS Code profile.

**Command:** Playwright Studio: Save Selection as Snippet

<a id="opencomponentgallery"></a>

### Open Component Testing Gallery

Browse component test files and Storybook stories discovered in the workspace.

**Command:** Playwright Studio: Open Component Testing Gallery

<a id="initializeagents"></a>

### Initialize Playwright Test Agents

Initialize Playwright's supported test-agent files in the project.

**Command:** Playwright Studio: Initialize Playwright Test Agents

<a id="generatetestplan"></a>

### Create Test Plan with Planner Agent

Hand a planning prompt to a supported installed agent workflow for review.

**Command:** Playwright Studio: Create Test Plan with Planner Agent

<a id="generatetestsfromplan"></a>

### Generate Tests from Reviewed Plan

Hand a reviewed plan to the test-generation agent workflow.

**Command:** Playwright Studio: Generate Tests from Reviewed Plan

<a id="healfailures"></a>

### Heal Captured Failures with Agent

Prepare a healer-agent handoff using captured failing-test evidence.

**Command:** Playwright Studio: Heal Captured Failures with Agent

<a id="openselectorintelligence"></a>

### Open Selector Intelligence

Browse a website inside VS Code, inspect an element, and compare live-verified Playwright locators, CSS selectors and XPath with uniqueness counts.

**Command:** Playwright Studio: Open Selector Intelligence

## Projects and environments

<a id="switchenvprofile"></a>

### Switch Environment Profile

Choose a named environment profile for subsequent runs.

**Command:** Playwright Studio: Switch Environment Profile

<a id="selectenvfile"></a>

### Select .env File

Choose an optional .env file whose values are loaded for execution.

**Command:** Playwright Studio: Select .env File

<a id="openworkspacedashboard"></a>

### Open Multi-Root Workspace Dashboard

Review detected Playwright roots across a multi-root workspace.

**Command:** Playwright Studio: Open Multi-Root Workspace Dashboard

<a id="showprojectgraph"></a>

### Show Project Dependency Graph

Display configured Playwright projects and their dependencies.

**Command:** Playwright Studio: Show Project Dependency Graph

<a id="healthcheck"></a>

### Run Configuration Health Check

Check project detection, configuration, execution settings and result/report paths.

**Command:** Playwright Studio: Run Configuration Health Check

<a id="installbrowsers"></a>

### Install Playwright Browsers

Install Playwright browser binaries using the project's tool command.

**Command:** Playwright Studio: Install Playwright Browsers

<a id="updatebrowsers"></a>

### Update Playwright Browsers

Refresh the browser binaries for the project's installed Playwright version.

**Command:** Playwright Studio: Update Playwright Browsers

## Coverage and sharing

<a id="importcoverage"></a>

### Import Istanbul/V8 Coverage

Import existing Istanbul or V8 coverage into VS Code's native test coverage UI.

**Command:** Playwright Studio: Import Istanbul/V8 Coverage

<a id="exportresults"></a>

### Export Latest Results

Export the latest captured results as Markdown, JSON or JUnit XML, or copy a summary.

**Command:** Playwright Studio: Export Latest Results

<a id="postgithubcomment"></a>

### Post Latest Results to GitHub

Review the destination and confirm before posting a captured result summary through GitHub CLI.

**Command:** Playwright Studio: Post Latest Results to GitHub

## Playwright Intelligence

<a id="openintelligence"></a>

### Open Intelligence Dashboard

Open the dashboard containing all 15 intelligence and advanced testing workflows.

**Command:** Playwright Studio: Open Intelligence Dashboard

<a id="investigatefailures"></a>

### Investigate Failures

Failure Detective groups captured failures using signatures, traces and source evidence; explanations are investigation hypotheses.

**Command:** Playwright Studio: Investigate Failures

<a id="testthetests"></a>

### Test the Tests with Mutations

Challenge selected tests with isolated application mutations, comparing a passing baseline with each changed source.

**Command:** Playwright Studio: Test the Tests with Mutations

<a id="openscenariolab"></a>

### Open Scenario Lab

Save and run latency, HTTP error, offline and clock scenarios; compare against baseline and reduce failing recipes.

**Command:** Playwright Studio: Open Scenario Lab

<a id="showbehaviormap"></a>

### Show Living Behavior Map

Index literal routes, semantic UI roles, steps, assertions, imports and promise links into a Living Behavior Map.

**Command:** Playwright Studio: Show Living Behavior Map

<a id="showchangeradar"></a>

### Show Change Radar

Select checks for changed files under a time budget using imports, coverage links, history, promises and recorded incidents.

**Command:** Playwright Studio: Show Change Radar

<a id="verifyrepair"></a>

### Verify a Candidate Repair

Reproduce the original failure, audit a candidate test repair and run it repeatedly in an isolated copy before review.

**Command:** Playwright Studio: Verify a Candidate Repair

<a id="benchmarkjourneys"></a>

### Benchmark Human and Agent Journeys

Compare scripted human-style interactions with user-supplied agent adapters against shared success criteria.

**Command:** Playwright Studio: Benchmark Human and Agent Journeys

<a id="managepromises"></a>

### Manage Product Promises

Record observable product promises, owners, priority and linked tests, then inspect evidence freshness for the current source.

**Command:** Playwright Studio: Manage Product Promises

## Advanced testing workflows

<a id="openbugcapsules"></a>

### Open Bug Capsules

Capture reviewed, checksummed source bundles that reproduce a failure; inspect or reproduce imported capsules in disposable copies.

**Command:** Playwright Studio: Open Bug Capsules

<a id="branchfailure"></a>

### Branch the Failure

Rerun a journey with checkpoint-triggered network, cookie, offline, clock or misleading-text conditions and compare observed outcomes.

**Command:** Playwright Studio: Branch the Failure

<a id="checkproductlaws"></a>

### Check Product Laws

Run seeded sequences against a user-defined business invariant, reduce reproduced failures and export regression tests.

**Command:** Playwright Studio: Check Product Laws

<a id="openagentwindtunnel"></a>

### Open Agent Wind Tunnel

Compare user-supplied agent adapters across model labels and branch conditions using measured completion, forbidden actions, recovery and cost.

**Command:** Playwright Studio: Open Agent Wind Tunnel

<a id="challengerepair"></a>

### Challenge a Candidate Repair

Challenge a candidate repair with known application defects as negative controls, alongside failure reproduction and repeated candidate runs.

**Command:** Playwright Studio: Challenge a Candidate Repair

<a id="showbehaviordiff"></a>

### Compare Runtime Behavior Across Revisions

Run selected journeys against a Git revision and the saved workspace, comparing outcomes, ARIA snapshots, focus, URLs and response statuses.

**Command:** Playwright Studio: Compare Runtime Behavior Across Revisions

<a id="openincidentmemory"></a>

### Open Incident Memory

Record and exchange incident summaries, regression links and optional negative controls; validate them and feed affected files into Change Radar.

**Command:** Playwright Studio: Open Incident Memory

## Feature discovery

<a id="openfeaturecatalog"></a>

### Open Feature Catalog

Open this complete feature catalog; the Features sidebar lists each entry separately with a description.

**Command:** Playwright Studio: Open Feature Catalog
