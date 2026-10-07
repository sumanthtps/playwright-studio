/// <reference lib="dom" />
import type { ElementHandle, Frame, JSHandle, Page } from 'playwright';

async function focusedSelect(page: Page): Promise<ElementHandle<HTMLSelectElement> | undefined> {
  let frame: Frame | null = page.mainFrame();
  for (let depth = 0; frame && depth < 20; depth++) {
    const active: JSHandle<Element | null> = await frame.evaluateHandle(() => {
      let element = document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element;
    });
    const element = active.asElement();
    if (!element) {
      await active.dispose();
      return;
    }
    const tag = await element.evaluate((node) => node.tagName);
    if (tag === 'SELECT') return element as ElementHandle<HTMLSelectElement>;
    frame = tag === 'IFRAME' || tag === 'FRAME' ? await element.contentFrame() : null;
    await active.dispose();
  }
  return;
}

/** Native popup menus cannot receive CDP key events on some headless platforms. */
export async function pressNativeSelectKey(page: Page, key: string): Promise<boolean> {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return false;
  const select = await focusedSelect(page);
  if (!select) return false;
  try {
    const selection = await select.evaluate((element, requestedKey) => {
      if (element.disabled || element.multiple || element.size > 1) return;
      const enabled = Array.from(element.options)
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => !option.disabled && !option.closest('optgroup[disabled]'))
        .map(({ index }) => index);
      const current = element.selectedIndex;
      let next: number | undefined;
      if (requestedKey === 'Home') next = enabled[0];
      else if (requestedKey === 'End') next = enabled.at(-1);
      else if (requestedKey === 'ArrowDown') next = enabled.find((index) => index > current);
      else next = enabled.reverse().find((index) => index < current);
      return { current, next: next ?? current };
    }, key);
    if (!selection) return false;

    // Respect website key handlers, including preventDefault(), before providing the fallback.
    const keyState = await select.evaluateHandle((element) => {
      const state = { prevented: false, cleanup: () => {} };
      const listener = (event: KeyboardEvent) => {
        queueMicrotask(() => {
          state.prevented = event.defaultPrevented;
        });
      };
      element.addEventListener('keydown', listener, { once: true, capture: true });
      state.cleanup = () => element.removeEventListener('keydown', listener, { capture: true });
      return state;
    });
    try {
      await page.keyboard.down(key);
      const prevented = await keyState.evaluate((state) => state.prevented);
      const current = await select.evaluate((element) => element.selectedIndex);
      if (!prevented && current === selection.current && selection.next !== current) {
        // Public Playwright selection dispatches the input/change events expected by form apps.
        await select.selectOption({ index: selection.next });
      }
    } finally {
      await page.keyboard.up(key);
      await keyState.evaluate((state) => state.cleanup());
      await keyState.dispose();
    }
    return true;
  } finally {
    await select.dispose();
  }
}
