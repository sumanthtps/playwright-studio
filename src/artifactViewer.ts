import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SpecResult, TestAttachment } from './resultParser';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { artifactFile, artifactRoots, requireWorkspaceTrust } from './security';
import { readBoundedFile, readableFileInRoots } from './fileSecurity';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonce(): string {
  return randomBytes(24).toString('base64');
}
const snapshotLimit = 32 * 1024 * 1024;
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');

function inferredContentType(attachment: TestAttachment): string {
  if (attachment.contentType) return attachment.contentType;
  switch (path.extname(attachment.path ?? '').toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.json':
      return 'application/json';
    case '.txt':
    case '.log':
    case '.md':
    case '.yml':
    case '.yaml':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function readableText(attachment: TestAttachment): string | undefined {
  if (attachment.body) {
    if (attachment.body.length > 3_000_000) return 'Attachment is too large to preview.';
    try {
      return Buffer.from(attachment.body, 'base64').toString('utf8');
    } catch {
      return attachment.body;
    }
  }
  if (!attachment.path || !fs.existsSync(attachment.path)) return undefined;
  try {
    return readBoundedFile(attachment.path, 2_000_000).toString('utf8');
  } catch {
    return undefined;
  }
}

export class ArtifactViewer implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentSpec: SpecResult | undefined;
  private messageSubscription: vscode.Disposable | undefined;
  private reviewedSnapshots = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  show(spec: SpecResult): void {
    this.panel?.dispose();
    this.currentSpec = spec;
    this.reviewedSnapshots.clear();
    for (const attachment of spec.attachments ?? []) {
      const file = artifactFile(attachment.path, this.context);
      if (file && /actual|expected/i.test(attachment.name)) {
        try {
          this.reviewedSnapshots.set(file, hash(readBoundedFile(file, snapshotLimit)));
        } catch {
          /* Unreadable/oversized snapshots cannot be accepted. */
        }
      }
    }
    const panel = vscode.window.createWebviewPanel(
      'playwrightStudio.artifacts',
      'Playwright Artifact Review',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: artifactRoots(this.context).map((root) => vscode.Uri.file(root)),
      },
    );
    this.panel = panel;
    const messages = panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message).catch((error) => {
        void vscode.window.showErrorMessage(
          `Could not open or save artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
    this.messageSubscription = messages;
    panel.onDidDispose(() => {
      messages.dispose();
      if (this.panel !== panel) return;
      this.messageSubscription = undefined;
      this.panel = undefined;
      this.currentSpec = undefined;
    });
    panel.title = `Artifacts: ${spec.title}`;
    panel.webview.html = this.html(panel.webview, spec);
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private safeArtifactPath(candidate: unknown): string | undefined {
    if (typeof candidate !== 'string' || !this.currentSpec) return undefined;
    const normalized = path.normalize(candidate);
    return this.currentSpec.attachments?.some(
      (attachment) => attachment.path && path.normalize(attachment.path) === normalized,
    )
      ? artifactFile(normalized, this.context)
      : undefined;
  }

  private async handleMessage(message: {
    type?: unknown;
    path?: unknown;
    index?: unknown;
  }): Promise<void> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'save' && Number.isInteger(message.index) && this.currentSpec) {
      const attachment = this.currentSpec.attachments?.[Number(message.index)];
      if (!attachment?.body) return;
      if (attachment.body.length > 48 * 1024 * 1024)
        throw new Error('Attachment exceeds the save size limit.');
      const extension =
        attachment.contentType?.split('/')[1]?.replace(/[^A-Za-z0-9]/g, '') || 'bin';
      const safeName = (attachment.name || 'attachment').replace(/[^A-Za-z0-9._-]/g, '_');
      const base = vscode.workspace.workspaceFolders?.[0]?.uri ?? this.context.globalStorageUri;
      const destination = await vscode.window.showSaveDialog({
        title: `Save ${attachment.name}`,
        defaultUri: vscode.Uri.joinPath(base, `${safeName}.${extension}`),
      });
      if (destination)
        await vscode.workspace.fs.writeFile(destination, Buffer.from(attachment.body, 'base64'));
      return;
    }
    const artifactPath = this.safeArtifactPath(message.path);
    if (message.type === 'open' && artifactPath) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(artifactPath));
      return;
    }
    if (message.type !== 'accept' || !artifactPath || !this.currentSpec) return;
    requireWorkspaceTrust();
    const reviewedSpec = this.currentSpec;
    const actual = this.currentSpec.attachments?.find(
      (attachment) =>
        artifactFile(attachment.path, this.context) === artifactPath &&
        /actual/i.test(attachment.name),
    );
    if (!actual) return;
    const expected = this.currentSpec.attachments?.find(
      (attachment) =>
        attachment.name === actual.name.replace(/actual/i, 'expected') && attachment.path,
    )?.path;
    if (!expected || !fs.existsSync(artifactPath) || !fs.existsSync(expected)) {
      void vscode.window.showErrorMessage('Expected and actual snapshot files are both required.');
      return;
    }
    const expectedUri = vscode.Uri.file(expected);
    const folder = vscode.workspace.getWorkspaceFolder(expectedUri);
    if (!folder) {
      void vscode.window.showErrorMessage(
        'For safety, snapshots outside the open workspace cannot be overwritten.',
      );
      return;
    }
    const realExpected = readableFileInRoots(expected, [folder.uri.fsPath]);
    if (!realExpected) {
      void vscode.window.showErrorMessage(
        'The expected snapshot resolves outside the workspace through a symbolic link.',
      );
      return;
    }
    if (artifactPath === realExpected) {
      void vscode.window.showErrorMessage(
        'Actual and expected snapshot paths are identical; nothing was changed.',
      );
      return;
    }
    const actualBytes = readBoundedFile(artifactPath, snapshotLimit);
    const expectedHash = hash(readBoundedFile(realExpected, snapshotLimit));
    const unchanged = () =>
      artifactFile(actual.path, this.context) === artifactPath &&
      readableFileInRoots(expected, [folder.uri.fsPath]) === realExpected &&
      hash(readBoundedFile(artifactPath, snapshotLimit)) ===
        this.reviewedSnapshots.get(artifactPath) &&
      hash(readBoundedFile(realExpected, snapshotLimit)) ===
        this.reviewedSnapshots.get(realExpected);
    if (
      hash(actualBytes) !== this.reviewedSnapshots.get(artifactPath) ||
      expectedHash !== this.reviewedSnapshots.get(realExpected) ||
      !unchanged()
    ) {
      throw new Error('Snapshot changed since review. Reopen the artifacts before accepting it.');
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Replace ${vscode.workspace.asRelativePath(expectedUri)} with the reviewed actual snapshot?`,
      {
        modal: true,
        detail:
          'This changes a tracked workspace file. The operation cannot be undone by the extension.',
      },
      'Accept Snapshot',
    );
    if (confirmation !== 'Accept Snapshot') return;
    requireWorkspaceTrust();
    if (
      this.currentSpec !== reviewedSpec ||
      !unchanged() ||
      hash(readBoundedFile(realExpected, snapshotLimit)) !== expectedHash
    ) {
      throw new Error(
        'Snapshot changed during confirmation. Reopen the artifacts before accepting it.',
      );
    }
    // Replace the directory entry instead of writing through a symlink/hardlink.
    const temporary = path.join(path.dirname(realExpected), `.studio-snapshot-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, actualBytes, {
        flag: 'wx',
        mode: fs.statSync(realExpected).mode & 0o777,
      });
      fs.renameSync(temporary, realExpected);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    void vscode.window.showInformationMessage(
      'Snapshot accepted. Review the source-control diff before committing.',
    );
  }

  private mediaUri(webview: vscode.Webview, attachment: TestAttachment): string | undefined {
    if (attachment.path && fs.existsSync(attachment.path)) {
      return webview.asWebviewUri(vscode.Uri.file(attachment.path)).toString();
    }
    if (attachment.body) return `data:${inferredContentType(attachment)};base64,${attachment.body}`;
    return undefined;
  }

  private card(webview: vscode.Webview, attachment: TestAttachment, index: number): string {
    const originalPath = attachment.path;
    attachment = { ...attachment, path: artifactFile(originalPath, this.context) };
    const type = inferredContentType(attachment);
    const uri = this.mediaUri(webview, attachment);
    const title = escapeHtml(attachment.name || `Attachment ${index + 1}`);
    let preview =
      '<p class="muted">Attachment is unavailable or outside the workspace and Studio storage.</p>';
    if (uri && type.startsWith('image/')) {
      preview = `<img src="${escapeHtml(uri)}" alt="${title}" loading="lazy">`;
    } else if (uri && type.startsWith('video/')) {
      preview = `<video src="${escapeHtml(uri)}" controls preload="metadata" aria-label="${title}"></video>`;
    } else if (type.startsWith('text/') || type.includes('json') || type.includes('yaml')) {
      preview = `<pre tabindex="0">${escapeHtml(readableText(attachment) ?? 'Attachment content is unavailable.')}</pre>`;
    }
    const open = attachment.path
      ? `<button class="secondary" data-open="${escapeHtml(originalPath!)}">Open file</button>`
      : '';
    const save = attachment.body
      ? `<button class="secondary" data-save="${index}">Save attachment</button>`
      : '';
    return `<article class="card" data-name="${escapeHtml(attachment.name.toLowerCase())}">
      <header><h2>${title}</h2><span>${escapeHtml(type)}</span></header>
      <div class="preview">${preview}</div>${open}${save}
    </article>`;
  }

  private html(webview: vscode.Webview, spec: SpecResult): string {
    const token = nonce();
    const attachments = spec.attachments ?? [];
    const actual = attachments.find(
      (attachment) => /actual/i.test(attachment.name) && attachment.path,
    );
    const expected = attachments.find(
      (attachment) => /expected/i.test(attachment.name) && attachment.path,
    );
    const canAccept =
      actual?.path &&
      expected?.path &&
      artifactFile(actual.path, this.context) &&
      artifactFile(expected.path, this.context);
    const annotationText = (spec.annotations ?? [])
      .map(
        (annotation) =>
          `${annotation.type}${annotation.description ? `: ${annotation.description}` : ''}`,
      )
      .join(' · ');
    const cards = attachments
      .map((attachment, index) => this.card(webview, attachment, index))
      .join('');
    const error = spec.error
      ? `<section><h2>Error</h2><pre tabindex="0">${escapeHtml(spec.error)}</pre></section>`
      : '';
    const output = spec.output
      ? `<section><h2>Captured output</h2><pre tabindex="0">${escapeHtml(spec.output)}</pre></section>`
      : '';
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data:; style-src 'nonce-${token}'; script-src 'nonce-${token}';">
      <style nonce="${token}">
        :root{color-scheme:light dark}body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px;margin:0}h1{font-size:20px;margin:0 0 6px}h2{font-size:14px;margin:0}.meta,.muted{color:var(--vscode-descriptionForeground)}.toolbar{display:flex;gap:8px;align-items:center;margin:16px 0;position:sticky;top:0;padding:10px 0;background:var(--vscode-editor-background);z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.card,section{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px;margin:12px 0;background:var(--vscode-sideBar-background)}.card header{display:flex;justify-content:space-between;gap:12px}.card header span{color:var(--vscode-descriptionForeground);font-size:11px}.preview{display:grid;place-items:center;min-height:120px;margin:10px 0;background:var(--vscode-editor-background);overflow:auto}.preview img,.preview video{max-width:100%;max-height:65vh}pre{white-space:pre-wrap;word-break:break-word;max-height:45vh;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:10px}button{border:0;padding:7px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer;border-radius:2px}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.empty{padding:30px;text-align:center}
      </style></head><body>
      <h1>${escapeHtml(spec.title)}</h1><div class="meta">${escapeHtml(spec.projectName ?? 'default project')} · ${spec.duration}ms · ${escapeHtml(spec.status)}${annotationText ? ` · ${escapeHtml(annotationText)}` : ''}</div>
      <div class="toolbar"><button id="show-all">All artifacts</button><button class="secondary" id="show-snapshots">Snapshot comparison</button>${canAccept ? `<button id="accept" data-path="${escapeHtml(actual!.path!)}">Accept actual</button>` : ''}</div>
      <main class="grid">${cards || '<div class="empty muted">No attachments were captured for this test.</div>'}</main>${error}${output}
      <script nonce="${token}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'open',path:b.dataset.open})));document.querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'save',index:Number(b.dataset.save)})));document.getElementById('accept')?.addEventListener('click',e=>vscode.postMessage({type:'accept',path:e.currentTarget.dataset.path}));const cards=[...document.querySelectorAll('.card')];document.getElementById('show-all').addEventListener('click',()=>cards.forEach(c=>c.hidden=false));document.getElementById('show-snapshots').addEventListener('click',()=>cards.forEach(c=>c.hidden=!/expected|actual|diff/.test(c.dataset.name)));
      </script></body></html>`;
  }

  dispose(): void {
    this.messageSubscription?.dispose();
    this.panel?.dispose();
  }
}
