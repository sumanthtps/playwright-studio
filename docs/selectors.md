# Selector Intelligence

Open **Playwright Studio: Open Selector Intelligence** from the Command Palette or the Intelligence dashboard. Enter an HTTP or HTTPS URL in the address bar and open it. Choose **Inspect**, then click an element in the preview to list matching selectors; inspection does not activate the element.

## Setup

Open a trusted local project with `playwright` or `@playwright/test` installed. The worker uses your project's Playwright package. With the default browser setting, it tries Playwright's Chromium, then installed Google Chrome, then installed Microsoft Edge if the preceding browser executable is missing. Other launch failures are shown for you to resolve.

If no browser is available, select **Install Chromium** in the panel. Studio runs your project's Playwright browser installer, then retries the last URL when installation succeeds. You can also choose **Use Chrome** or **Use Edge** if either browser is already installed. These choices apply to the current VS Code window session; they do not change your settings.

To always use one installed browser, set `playwrightSnippets.selectorBrowserChannel` to `chrome` or `msedge`. An explicit setting is respected without automatically switching to another browser. **Retry** reopens the last URL after you resolve a problem; **Open guide** opens these instructions.

## Browse and inspect

- Switch to **Browse**, click a field in the website and type directly. The **Keyboard connected** hint confirms that keystrokes go to the website. Text, passwords, textareas and editable content use the field's normal input behavior.
- Use **Tab** and **Shift+Tab** to move between fields, **Enter** to submit or activate a control, and **Shift+Enter** when the page uses it for a newline. Selection arrows, Home/End, select all, undo/redo, copy/cut and plain-text paste are forwarded. Password fields cannot be copied. Use Cmd on macOS or Ctrl on Windows/Linux for those shortcuts. Double-click to select a word, drag to select text or adjust a control, hover to open menus, and scroll over the part of the page you want to scroll. Native single-select dropdowns support arrow keys and Home/End.
- Press **Esc** to send Escape to the website and return keyboard focus to the toolbar. Clicking the address bar or another Studio control also stops forwarding text. The expandable **Text entry tools** offer an alternative for inserting text into the focused website field; text entered in that helper is masked.
- Back, Forward, Reload and scrolling update the preview. JavaScript dialogs expose accept/dismiss controls.
- Return to **Inspect** and click the target. Unique locators appear before ambiguous ones; each candidate explains its type and match count. Prefer a stable accessible role/name or a deliberate test ID, then confirm it remains stable across application states.
- **Copy Playwright** copies a `page` locator expression and confirms the copy. CSS and XPath candidates also offer their raw selector. Open shadow roots and nested frames are inspected with appropriate locator scopes.
- Navigation and interaction clear previous candidates. Inspect again after changing the page.

## Resume a session

Closing the Selector Intelligence tab keeps its browser running. Open **Playwright Studio: Open Selector Intelligence** again in the same VS Code window to return to that live page, including its navigation history and current browser session. Studio restores Browse/Inspect mode, selector results, selector-list scroll position and an unfinished address-bar edit. Actions already sent to the browser can finish while the tab is closed.

This state stays in memory. Reloading the VS Code window, disabling the extension or exiting VS Code ends the session; it is not restored after a restart. The website can continue updating while its panel is closed.

## Chrome DevTools

Select **Open Chrome DevTools** in the preview toolbar to open full DevTools in a separate Chrome window attached to the same website page. Use Elements, Console, Network and the other DevTools panels while keeping the VS Code preview open. This does not reopen the website in a new login session. If browsing opens a popup, DevTools follows the active page.

Studio prefers installed Chrome for the DevTools window, with full Playwright Chromium and installed Edge as fallbacks when a browser executable is missing. It uses a separate temporary profile. A graphical desktop and a browser with the full DevTools frontend are required; a headless-shell-only installation is insufficient. Install full Chromium or Chrome if the panel reports that the frontend is unavailable.

Closing DevTools leaves the website running. Closing and reopening the Selector Intelligence tab also retains its DevTools window. Reloading or exiting VS Code closes the session and its DevTools window.

## Inspect tests

The **Inspect Tests** eye icon sits beside Run and Debug in the Studio Tests toolbar and on test, suite and file rows. It runs the selected scope with Playwright's `--debug` Inspector. The toolbar action inspects all discovered tests. Use Cancel All Runs to stop execution.

## Limits

The preview is a live sequence of screenshots from a separate browser session, so sites that forbid iframe embedding can still be inspected. Website HTML does not run inside the privileged extension webview. The session does not share your normal browser's cookies or profile.

Sites requiring unsupported browser features, bot challenges, client certificates or extensions may need another workflow. File upload/download and ordinary browser context menus are not exposed through the preview. Clipboard forwarding supports selected plain text and plain-text paste; it does not continuously synchronize clipboards. Closed shadow roots cannot be inspected, and frame traversal is bounded. Accessible-role suggestions require a Playwright version with `locator.ariaSnapshot`; older versions still offer other matching candidates. A unique selector is not a guarantee of future stability. Match counts describe the page at inspection time.
