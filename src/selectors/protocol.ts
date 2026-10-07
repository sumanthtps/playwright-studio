export const VIEWPORT = { width: 1280, height: 800 };

const navigationKeys = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];
const editingKeys = new Set([
  'Enter',
  'Shift+Enter',
  'ControlOrMeta+Enter',
  'ControlOrMeta+Shift+Enter',
  'Tab',
  'Shift+Tab',
  'Backspace',
  'Delete',
  'Escape',
  'Space',
  ...navigationKeys,
  ...navigationKeys.map((key) => `Shift+${key}`),
  'ControlOrMeta+A',
  'ControlOrMeta+Z',
  'ControlOrMeta+Shift+Z',
  'ControlOrMeta+Y',
  ...['Backspace', 'Delete', ...navigationKeys].flatMap((key) => [
    `ControlOrMeta+${key}`,
    `ControlOrMeta+Shift+${key}`,
  ]),
  ...['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].flatMap((key) => [
    `Alt+${key}`,
    `Alt+Shift+${key}`,
  ]),
]);

export interface SelectorCandidate {
  kind: string;
  code: string;
  selector?: string;
  matches: number;
  unique: boolean;
  score: number;
  reason: string;
}
export interface Inspection {
  tag: string;
  text: string;
  frameUrl: string;
  candidates: SelectorCandidate[];
  note?: string;
}
export interface SelectorViewState {
  mode: 'inspect' | 'browse';
  address?: string;
  selectorScroll?: number;
}
export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'hover'; x: number; y: number }
  | { type: 'drag'; x: number; y: number; toX: number; toY: number }
  | { type: 'click'; x: number; y: number; clickCount?: 1 | 2 | 3 }
  | { type: 'scroll'; delta: number; x?: number; y?: number }
  | { type: 'type'; text: string; paste?: boolean }
  | { type: 'clipboard'; operation: 'copy' | 'cut' }
  | { type: 'key'; key: string }
  | { type: 'back' | 'forward' | 'reload' | 'refresh' | 'close' | 'devtools' }
  | { type: 'dialog'; accept: boolean; text?: string };
export interface BrowserReply {
  id: number;
  url?: string;
  screenshot?: string;
  inspection?: Inspection;
  error?: string;
  errorCode?: 'browser-missing' | 'playwright-missing' | 'navigation' | 'browser-launch' | 'action';
  errorTitle?: string;
  browserName?: string;
  retryable?: boolean;
  setupBusy?: boolean;
  dialog?: { type: string; message: string };
  uiState?: SelectorViewState;
  sessionBusy?: boolean;
  sessionAction?: BrowserAction['type'];
  devtoolsOpen?: boolean;
  clipboardText?: string;
  sessionClosed?: boolean;
}

/** Only harmless view preferences are retained; website input stays in the live browser. */
export function parseSelectorViewState(value: unknown): SelectorViewState | undefined {
  if (!value || typeof value !== 'object') return;
  const state = value as Record<string, unknown>;
  if (state.mode !== 'inspect' && state.mode !== 'browse') return;
  if (
    state.address !== undefined &&
    (typeof state.address !== 'string' || state.address.length > 8192)
  )
    return;
  if (
    state.selectorScroll !== undefined &&
    (typeof state.selectorScroll !== 'number' ||
      !Number.isFinite(state.selectorScroll) ||
      state.selectorScroll < 0 ||
      state.selectorScroll > 10000000)
  )
    return;
  return {
    mode: state.mode,
    ...(state.address !== undefined ? { address: state.address as string } : {}),
    ...(state.selectorScroll !== undefined
      ? { selectorScroll: state.selectorScroll as number }
      : {}),
  };
}

export function websiteUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a website URL.');
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Use an http:// or https:// website URL.');
  return url.href;
}

export function parseBrowserAction(value: unknown): BrowserAction | undefined {
  if (!value || typeof value !== 'object') return;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'navigate':
      return { type: 'navigate', url: websiteUrl(message.url) };
    case 'inspect':
    case 'hover':
    case 'drag':
    case 'click':
      if (
        typeof message.x === 'number' &&
        typeof message.y === 'number' &&
        Number.isFinite(message.x) &&
        Number.isFinite(message.y) &&
        message.x >= 0 &&
        message.x < VIEWPORT.width &&
        message.y >= 0 &&
        message.y < VIEWPORT.height
      ) {
        if (message.type === 'inspect' || message.type === 'hover')
          return { type: message.type, x: message.x, y: message.y };
        if (message.type === 'drag') {
          if (
            typeof message.toX !== 'number' ||
            typeof message.toY !== 'number' ||
            !Number.isFinite(message.toX) ||
            !Number.isFinite(message.toY) ||
            message.toX < 0 ||
            message.toX >= VIEWPORT.width ||
            message.toY < 0 ||
            message.toY >= VIEWPORT.height
          )
            return;
          return { type: 'drag', x: message.x, y: message.y, toX: message.toX, toY: message.toY };
        }
        if (message.clickCount !== undefined && ![1, 2, 3].includes(message.clickCount as number))
          return;
        return {
          type: 'click',
          x: message.x,
          y: message.y,
          ...(message.clickCount !== undefined
            ? { clickCount: message.clickCount as 1 | 2 | 3 }
            : {}),
        };
      }
      return;
    case 'scroll':
      if (typeof message.delta === 'number' && Number.isFinite(message.delta)) {
        const position =
          message.x === undefined && message.y === undefined
            ? undefined
            : parseBrowserAction({ type: 'inspect', x: message.x, y: message.y });
        if ((message.x !== undefined || message.y !== undefined) && !position) return;
        return {
          type: 'scroll',
          delta: Math.max(-1600, Math.min(1600, message.delta)),
          ...(position?.type === 'inspect' ? { x: position.x, y: position.y } : {}),
        };
      }
      return;
    case 'type':
      if (
        typeof message.text === 'string' &&
        message.text.length <= 10000 &&
        (message.paste === undefined || typeof message.paste === 'boolean')
      )
        return { type: 'type', text: message.text, ...(message.paste ? { paste: true } : {}) };
      return;
    case 'clipboard':
      if (message.operation === 'copy' || message.operation === 'cut')
        return { type: 'clipboard', operation: message.operation };
      return;
    case 'key':
      if (typeof message.key === 'string' && editingKeys.has(message.key))
        return { type: 'key', key: message.key };
      return;
    case 'dialog':
      if (
        typeof message.accept === 'boolean' &&
        (message.text === undefined ||
          (typeof message.text === 'string' && message.text.length <= 10000))
      )
        return { type: 'dialog', accept: message.accept, text: message.text as string | undefined };
      return;
    case 'back':
    case 'forward':
    case 'reload':
    case 'refresh':
    case 'close':
    case 'devtools':
      return { type: message.type };
  }
}
