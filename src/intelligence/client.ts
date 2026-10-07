/// <reference lib="dom" />
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** Serialized into the webview; no Node or extension APIs belong here. */
export function intelligenceClient(): void {
  const vscode = acquireVsCodeApi();
  const status = document.getElementById('status')!;
  let busy = false;
  function setBusy(value: boolean, message: string, error = false): void {
    busy = value;
    status.textContent = message;
    status.classList.toggle('error', error);
    document.body.setAttribute('aria-busy', String(value));
    document
      .querySelectorAll<HTMLButtonElement>('button[data-action], #scenario button[type="submit"]')
      .forEach((button) => {
        button.disabled = value && button.dataset.action !== 'cancelWorkflow';
      });
    document.getElementById('cancel')!.hidden = !value;
  }
  function submit(action: string, value?: unknown): void {
    if (busy && action !== 'cancelWorkflow') return;
    if (action === 'cancelWorkflow') status.textContent = 'Cancelling the current run…';
    else setBusy(true, 'Working… Check VS Code for a selection picker or progress notification.');
    vscode.postMessage({ action, value });
  }
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button?.dataset.action) return;
    submit(
      button.dataset.action,
      button.dataset.file
        ? { file: button.dataset.file, line: Number(button.dataset.line) }
        : undefined,
    );
  });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type !== 'actionState') return;
    setBusy(Boolean(message.busy), message.message || 'Ready.', Boolean(message.error));
  });
  document.getElementById('search')?.addEventListener('input', (event) => {
    const query = (event.target as HTMLInputElement).value.toLowerCase().trim();
    let count = 0;
    document.querySelectorAll<HTMLElement>('.workflow-card').forEach((card) => {
      card.hidden = !card.textContent?.toLowerCase().includes(query);
      if (!card.hidden) count++;
    });
    document.querySelectorAll<HTMLElement>('.workflow-group').forEach((group) => {
      const visible = Array.from(group.querySelectorAll<HTMLElement>('.workflow-card')).some(
        (card) => !card.hidden,
      );
      group.hidden = !visible;
      if (query && group instanceof HTMLDetailsElement && visible) group.open = true;
    });
    document.getElementById('noMatches')!.hidden = count > 0;
  });
  document.getElementById('scenario')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    submit('saveScenario', {
      id: 'scenario-' + Date.now(),
      name: form.get('name'),
      urlPattern: form.get('urlPattern'),
      latencyMs: Number(form.get('latencyMs')),
      status: form.get('status') ? Number(form.get('status')) : undefined,
      offline: form.get('offline') === 'on',
      clock: form.get('clock') || undefined,
    });
  });
}
