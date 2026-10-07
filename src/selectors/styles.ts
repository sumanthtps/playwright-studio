// Static styles for the Selector Intelligence webview. Colors follow the active VS Code theme.
export const selectorStyles = `
:root {
  color-scheme: light dark;
  --background: var(--vscode-editor-background, #181a20);
  --surface: var(--vscode-sideBar-background, #20232b);
  --text: var(--vscode-foreground, #d9dce3);
  --muted: var(--vscode-descriptionForeground, #9da5b5);
  --border: var(--vscode-panel-border, #363b46);
  --accent: var(--vscode-focusBorder, #6c9fff);
  --field: var(--vscode-input-background, #171a21);
}
* {
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
body {
  margin: 0;
  padding: 24px;
  color: var(--text);
  background: var(--background);
  font: 13px/1.5
    var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
button,
input {
  font: inherit;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
button:hover {
  background: var(--vscode-toolbar-hoverBackground, #ffffff0d);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible,
#website:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
button.primary {
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #356bd8);
  border-color: transparent;
}
button.primary:hover {
  background: var(--vscode-button-hoverBackground, #447de9);
}
input {
  min-width: 0;
  padding: 6px 10px;
  color: var(--vscode-input-foreground, var(--text));
  background: var(--field);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: 5px;
}
input::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--muted));
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.35px;
}
h2 {
  font-size: 13px;
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.app {
  max-width: 1720px;
  margin: 0 auto;
}
.page-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.brand-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--accent);
}
.brand-icon svg {
  width: 21px;
  height: 21px;
}
.page-heading p {
  margin-top: 3px;
  color: var(--muted);
}
.workspace {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(300px, 370px);
  align-items: start;
  gap: 18px;
}
.browser-panel,
.selector-panel {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.browser-toolbar {
  padding: 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
#navigation {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
}
.navigation-buttons {
  display: flex;
  gap: 2px;
}
.icon-button {
  padding: 5px;
  width: 30px;
  min-height: 30px;
  border-color: transparent;
}
.address-field {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  background: var(--field);
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: 5px;
}
.address-field:focus-within {
  border-color: var(--accent);
  outline: 1px solid var(--accent);
}
.address-field > svg {
  color: var(--muted);
  width: 15px;
  height: 15px;
  margin-left: 10px;
  flex-shrink: 0;
}
#address {
  width: 100%;
  height: 32px;
  border: 0;
  background: transparent;
  outline: none;
}
#address:focus-visible {
  outline: none;
}
.preview-toolbar {
  min-height: 49px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}
.segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.segmented button {
  min-height: 26px;
  font-size: 12px;
  padding: 3px 9px;
  border: 0;
  border-radius: 3px;
  color: var(--muted);
}
.segmented button[aria-pressed="true"] {
  background: var(--vscode-list-activeSelectionBackground, #284875);
  color: var(--vscode-list-activeSelectionForeground, #fff);
}
.browser-meta {
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
#activity {
  width: 6px;
  height: 6px;
  background: var(--muted);
  border-radius: 50%;
}
#activity.working {
  background: var(--accent);
  animation: pulse 1s infinite alternate;
}
@keyframes pulse {
  to {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  #activity.working {
    animation: none;
  }
}
#previewArea {
  position: relative;
  min-height: 300px;
  background: var(--surface);
}
.preview-image {
  position: relative;
  line-height: 0;
}
#website {
  display: block;
  width: 100%;
  height: auto;
  cursor: crosshair;
  user-select: none;
}
#website.browsing {
  cursor: default;
}
.preview-image.dragging #website {
  cursor: grabbing;
}
.preview-image.keyboard-connected::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 2px solid var(--accent);
  pointer-events: none;
}
#websiteInput {
  position: absolute;
  left: 0;
  top: 0;
  width: 2px;
  height: 16px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
  resize: none;
}
.keyboard-hint {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
}
.keyboard-hint.connected {
  color: var(--accent);
}
#selectionMarker {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  outline: 2px solid #397bf6;
  border-radius: 50%;
  box-shadow: 0 1px 8px #0007;
  pointer-events: none;
}
.empty-preview {
  min-height: 400px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 36px;
  background: radial-gradient(ellipse at center, #7f9acb09, transparent 70%);
}
.preview-illustration {
  width: 150px;
  height: 104px;
  border: 1px solid var(--border);
  border-radius: 9px;
  margin-bottom: 23px;
  background: var(--background);
  transform: rotate(-3deg);
  box-shadow:
    6px 6px 0 var(--surface),
    6px 6px 0 1px var(--border);
}
.illustration-toolbar {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 9px;
  border-bottom: 1px solid var(--border);
}
.illustration-toolbar i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--muted);
  opacity: 0.55;
}
.illustration-content {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 15px;
  position: relative;
}
.illustration-content span {
  height: 5px;
  border-radius: 3px;
  background: var(--border);
  width: 72%;
}
.illustration-content span:last-of-type {
  width: 45%;
}
.illustration-content svg {
  position: absolute;
  right: 16px;
  top: 20px;
  width: 30px;
  height: 30px;
  color: var(--accent);
  fill: var(--background);
}
#emptyTitle {
  font-size: 15px;
  font-weight: 600;
}
#emptyDescription {
  max-width: 340px;
  margin-top: 8px;
  color: var(--muted);
}
.preview-steps {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 23px;
  color: var(--muted);
  font-size: 11px;
}
.preview-steps span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.preview-steps b {
  font-size: 10px;
  width: 17px;
  height: 17px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  font-weight: 500;
}
.status-bar {
  padding: 9px 12px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
  min-height: 36px;
}
#status {
  flex: 1;
  overflow-wrap: anywhere;
}
#browserName {
  flex-shrink: 0;
  font-size: 10px;
}
#typing {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px;
  flex-wrap: wrap;
  background: var(--background);
}
#typingTools {
  border-top: 1px solid var(--border);
}
#typingTools > summary {
  padding: 8px 12px;
  color: var(--muted);
  font-size: 11px;
}
#typing label {
  width: 100%;
  font-size: 11px;
  color: var(--muted);
}
#input {
  flex: 1;
  min-width: 140px;
}
#typing button {
  font-size: 11px;
}
.selector-heading {
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
#selectorCount {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--vscode-badge-background, #3b4559);
  color: var(--vscode-badge-foreground, #dce5f5);
  font-size: 11px;
}
#selectedElement {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
#elementTag {
  color: var(--vscode-symbolIcon-classForeground, #d8b878);
  flex-shrink: 0;
}
#elementText {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted);
}
#candidates {
  padding: 12px;
  max-height: calc(100vh - 235px);
  min-height: 230px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.selector-placeholder {
  padding: 28px 10px;
  color: var(--muted);
}
.selector-placeholder strong {
  display: block;
  color: var(--text);
  margin-bottom: 8px;
}
.selector-placeholder p + p {
  margin-top: 14px;
  font-size: 12px;
}
.selector-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
}
.selector-card:last-child {
  margin-bottom: 0;
}
.selector-card.recommended {
  border-color: var(--accent);
}
.candidate-top {
  display: flex;
  align-items: start;
  flex-direction: column;
  gap: 6px;
}
.candidate-top strong {
  font-size: 12px;
  font-weight: 600;
}
.match {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.match::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.unique {
  color: var(--vscode-testing-iconPassed, #77bf82);
}
.ambiguous {
  color: var(--vscode-editorWarning-foreground, #e5b567);
}
pre {
  font: 11px/1.7 var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  margin: 10px 0;
  padding: 9px;
  background: var(--surface);
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.candidate-reason {
  color: var(--muted);
  font-size: 11px;
}
.candidate-actions {
  margin-top: 11px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.copy-button {
  min-height: 26px;
  padding: 3px 8px;
  font-size: 11px;
}
.selector-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
}
.inspection-note {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 12px;
}
#errorPanel {
  padding: 24px;
  background: var(--background);
  border-bottom: 1px solid var(--border);
}
.error-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.error-heading svg {
  width: 18px;
  height: 18px;
  color: var(--vscode-editorWarning-foreground, #e5b567);
  flex-shrink: 0;
}
#errorTitle {
  font-size: 14px;
}
#errorDescription {
  max-width: 600px;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.recovery-actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.recovery-actions button {
  font-size: 12px;
}
#retry {
  margin-top: 14px;
}
#details {
  margin-top: 15px;
  color: var(--muted);
  font-size: 11px;
}
summary {
  cursor: pointer;
}
#errorDetails {
  max-height: 150px;
  overflow: auto;
}
#playwrightRecovery pre {
  display: inline-block;
}
#dialog {
  padding: 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
#dialog p {
  margin: 6px 0 10px;
  overflow-wrap: anywhere;
}
.dialog-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
#prompt {
  flex: 1;
}
@media (max-width: 1050px) {
  body {
    padding: 16px;
  }
  .workspace {
    grid-template-columns: minmax(320px, 1fr) minmax(260px, 310px);
    gap: 12px;
  }
  .empty-preview {
    min-height: 340px;
    padding: 24px;
  }
  .navigation-buttons {
    gap: 0;
  }
  .icon-button {
    width: 26px;
  }
  #openWebsite {
    padding: 5px 8px;
  }
}
@media (max-width: 760px) {
  body {
    padding: 12px;
  }
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .page-heading {
    margin-bottom: 14px;
  }
  h1 {
    font-size: 17px;
  }
  .page-heading p {
    font-size: 12px;
  }
  .selector-panel {
    min-height: 200px;
  }
  #candidates {
    max-height: 500px;
    min-height: 150px;
  }
  .selector-placeholder {
    padding: 18px 8px;
  }
}
@media (max-width: 420px) {
  .browser-toolbar {
    padding: 8px;
  }
  #navigation {
    flex-wrap: wrap;
  }
  .navigation-buttons {
    order: 1;
  }
  .address-field {
    flex-basis: calc(100% - 115px);
  }
  #openWebsite {
    order: 2;
    margin-left: auto;
  }
  .preview-steps {
    gap: 8px;
  }
  .browser-meta {
    font-size: 10px;
  }
  .empty-preview {
    padding: 22px 12px;
  }
}
`;
