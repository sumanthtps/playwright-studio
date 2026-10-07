/// <reference lib="dom" />
import type { Frame, Page } from 'playwright';

export const MAX_CLIPBOARD_TEXT = 100_000;

async function focusedFrame(page: Page): Promise<Frame> {
  let frame = page.mainFrame();
  for (let depth = 0; depth < 20; depth++) {
    const handle = await frame.evaluateHandle(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    });
    try {
      const element = handle.asElement();
      if (!element) return frame;
      const child = await element.contentFrame();
      if (!child) return frame;
      frame = child;
    } finally {
      await handle.dispose();
    }
  }
  return frame;
}

/** Export only the user's current selection; never read the operating-system clipboard. */
export async function copyWebsiteSelection(
  page: Page,
  operation: 'copy' | 'cut',
): Promise<string | undefined> {
  const frame = await focusedFrame(page);
  return frame.evaluate(
    ({ operation, limit }) => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!active) return;
      // Passwords must never leave the browser through the copy bridge, including page handlers.
      if (active instanceof HTMLInputElement && active.type === 'password') return;

      const transfer = new DataTransfer();
      const event = new ClipboardEvent(operation, {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      const useDefault = active.dispatchEvent(event);
      if (!useDefault) {
        // A page may replace clipboard text or decline the operation entirely.
        if (!transfer.types.includes('text/plain')) return;
        const text = transfer.getData('text/plain');
        if (text.length > limit)
          throw new Error(
            'The selected clipboard text is too large. Select less text and try again.',
          );
        return text;
      }

      let text = '';
      const field =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
          ? active
          : undefined;
      if (field && field.selectionStart !== null && field.selectionEnd !== null) {
        if (field.selectionEnd - field.selectionStart > limit)
          throw new Error(
            'The selected clipboard text is too large. Select less text and try again.',
          );
        text = field.value.slice(field.selectionStart, field.selectionEnd);
      } else {
        const root = active.getRootNode() as
          Document | (ShadowRoot & { getSelection?(): Selection | null });
        text = (root.getSelection?.() ?? document.getSelection())?.toString() || '';
      }
      if (text.length > limit)
        throw new Error(
          'The selected clipboard text is too large. Select less text and try again.',
        );
      if (!text) return;

      const editable = field
        ? !field.readOnly && !field.disabled
        : active instanceof HTMLElement && active.isContentEditable;
      if (operation === 'cut' && editable) {
        // This editing command retains browser undo history and emits input events without
        // issuing an OS clipboard command or inventing a Backspace keyboard event.
        document.execCommand('delete');
      }
      return text;
    },
    { operation, limit: MAX_CLIPBOARD_TEXT },
  );
}
