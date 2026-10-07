# Security review — September 10, 2026

Reviewed process execution, workspace trust, report and coverage imports, artifact
webviews, snapshot writes, portable capsules, generated tests, dependencies, and
GitHub Actions. Findings below describe the local implementation reviewed here;
they are not CVE assignments or a claim of exhaustive security certification.

## Corrected findings

| Finding | Previous behavior and prerequisite | Fix |
| --- | --- | --- |
| Report-controlled file access | A crafted attachment path could point outside the workspace. Artifact rendering read text from that path and added its parent directory to webview permissions. Experiment JSON evidence and coverage sources also accepted external paths. | Resolve real paths against workspace/extension-storage roots, or the host-created experiment output directory. Reports cannot add roots. Block escaping symlinks; keep non-media webviews' local resource roots empty. |
| Dangling symlink write escape | A workspace symlink pointing to a nonexistent external destination passed `existsSync`-based ancestor validation; a later write could follow it outside the workspace. | Stop at links using `lstat`, require a resolvable ancestor, and check its real path against the workspace. |
| Predictable configuration temporary files | Reporter/video setup wrote predictable temporary filenames inside the workspace. A pre-planted symlink at that name could redirect the write to an external file. Video setup also used content captured before its confirmation dialog. | Create unpredictable temporary files exclusively, replace atomically, reject linked external targets, and reject configuration changes since review. |
| Snapshot replacement races and hardlinks | A destination checked before the confirmation dialog could become a symlink while the dialog was open. Copying into a hardlinked expected snapshot also modified the other linked file. | Retain reviewed hashes, reject changed source/destination files and changed views, recheck after confirmation, and atomically replace the destination directory entry instead of writing through it. |
| Imported-file resource exhaustion | Several import paths read entire files without limits or regular-file checks. A FIFO could block a synchronous read. The repeated-group base64 expression could exhaust the regexp stack on valid large capsules. Coverage branch ownership repeatedly recomputed nested scans. | Read bounded regular files using nonblocking opens, reject oversized inputs before allocating, validate base64 with a canonical linear round-trip, and compute branch owners once under a work limit. |
| Platform-dependent capsule paths | Paths containing Windows alternate-stream syntax, reserved device names, trailing dots/spaces, or differently cased excluded directories could bypass portable-file assumptions. | Reject unsafe portable path components on every operating system and compare excluded names without case sensitivity. |
| Configured external URI handlers | The component-gallery setting was passed to `openExternal` without restricting its scheme. A workspace could direct the gallery action to another application's URI handler. | Permit HTTP and HTTPS gallery URLs only. |

The security suite uses temporary sentinel files, adversarial reports, dangling
links, hardlinks, a confirmation-time destination swap, a FIFO, and a valid 4 MB
capsule to exercise these boundaries. No real private files are used. File-symlink
and FIFO tests run on macOS/Linux; Windows still runs portable-path, hardlink,
artifact-root, trust, size-limit, and webview tests.

## Additional hardening

- Explicitly declare that the extension requires Workspace Trust, and enforce it
  in command handlers, native task/debug execution, direct CLI discovery, and
  intelligence/lab actions. VS Code already disabled the previous undeclared
  extension in Restricted Mode by default; this adds checks at execution boundaries.
- Accept webview messages only for actions exposed by the currently rendered
  workflow. Use cryptographic CSP nonces in all script-enabled panels.
- Exclude credential filenames/directories such as `.npmrc`, `.netrc`, `.ssh`,
  `.aws`, `.docker`, and `.git-credentials` from portable capsules. Review is still
  necessary for credentials embedded in otherwise ordinary source or HAR files.
- Verify capsule hashes and parse the same bounded bytes before replay, avoiding
  separate reads for the recorded hash and executable contents.
- Disable external diffs and text conversion in Git change enumeration.
- Pin GitHub Actions to official release commit hashes, disable persisted checkout
  credentials, add a dependency-audit gate, and configure Dependabot updates.
  Release publication consumes the validated VSIX rather than rebuilding while
  the Marketplace token is available.

## Import limits and behavior

- Result and coverage JSON: 64 MB. Studio/lab configuration and incident/per-test
  coverage imports: 8 MB. Candidate repair source: 4 MB.
- Editor discovery/config files: 4 MB each. Intelligence source scans: regular
  files only, 1 MB per file and 32 MB total. Revision fingerprinting: 20,000 changed
  files and 32 MB total; unavailable evidence remains unverified. Environment
  files: 1 MB.
- Capsule: 48 MB encoded file, 32 MB decoded total, 4 MB per source file.
- Trace analysis: 64 MB archive and 16 MB event data. Text artifact preview: 2 MB.
  Snapshot acceptance: 32 MB per file.
- File-backed experiment metrics must reside under the experiment's output
  directory. Inline JSON attachments remain supported.
- Artifact previews and report-driven Open actions only access workspace files
  and Studio storage. For an intentionally external trace, invoke Show Trace
  Viewer without a supplied report path and select the file in the file picker.
- Coverage source files must belong to the selected project's root. Oversized
  branch analyses are rejected rather than freezing the extension host.

## Validation and limits

The online npm audit on September 10, 2026 reported **0 known vulnerabilities**
across the locked dependency tree. This does not assess application logic; the
code findings above were identified separately. CI repeats the audit and blocks
packages/releases for moderate-or-higher advisories.

Run `npm run typecheck`, `npm test`, and `npm run test:integration`. The real
Playwright and browser suites are documented in [the test guide](https://github.com/sumanthtps/playwright-studio/blob/main/test/README.md).
The package verifier also enforces the existing 1,500,000-byte VSIX budget.

Trusted tests, configurations, dependencies and imported capsule sources execute
with the user's permissions. Disposable experiment copies isolate Studio's edits;
they are not an operating-system sandbox for malicious code. This review does not
audit users' applications, third-party agent providers, or remote CI execution.

Implementation follows VS Code's [Workspace Trust guidance](https://code.visualstudio.com/api/extension-guides/workspace-trust)
and [webview security guidance](https://code.visualstudio.com/api/extension-guides/webview#security).

## Follow-up hardening — September 12, 2026

- CLI probes now use a shared launcher with Windows shim support, separate stdout/stderr, closed stdin, byte limits and process-tree cleanup on timeout. The cleanup follows descendants so detached test servers can also be stopped when process inspection is available.
- Both history stores read bounded regular files. Invalid records are skipped; atomic writes use exclusive, unpredictable temporary files and do not write through destination hardlinks. Each history file is limited to 16 MB and 500 records. Old records, and individual records exceeding the total byte budget, are omitted from retained history; the original captured report remains separate.
- Report source lines are normalized to bounded integers and NUL paths are rejected before creating editor locations. Test Explorer no longer treats a passing test result as success when the process exits nonzero or reports a global error.
- Debounced result/editor events are disposed with their owners. Invalid unchanged reports are not reparsed on every poll. Suite nesting uses one source-order pass.
- Removed unused release dependencies (399 installed packages), obsolete setup prompting, and an unused capsule file reader. Source and test compilation reject unused locals and parameters; CI checks source formatting.

The September 12 online npm audit after dependency cleanup reported **0 known vulnerabilities**. Validation details and platform limits are recorded in [the test guide](../test/README.md). No claim of exhaustive bug removal or guaranteed Marketplace ranking is made.

## Selector browser boundary

Selector Intelligence uses an isolated browser process and passes screenshots to its
webview. Website markup is never inserted into the webview. Browser messages use a
fixed action protocol with bounded input and coordinates; clipboard actions refer to
the latest inspected candidates. Workspace Trust is required before worker launch.
The session uses a fresh browser context, supports HTTP/HTTPS navigation, disables
downloads and closes with the panel. The browser is still visiting user-selected
websites with network access; it is not an operating-system security sandbox.
