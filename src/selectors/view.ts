/// <reference lib="dom" />
import { randomBytes } from 'crypto';
import { BrowserReply, Inspection, VIEWPORT } from './protocol';
import { selectorStyles } from './styles';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** Runs inside the isolated webview. Website content only enters through text nodes and images. */
function selectorClient(): void {
  const vscode = acquireVsCodeApi();
  const image = document.getElementById('website') as HTMLImageElement;
  const address = document.getElementById('address') as HTMLInputElement;
  const input = document.getElementById('input') as HTMLInputElement;
  const keyboard = document.getElementById('websiteInput') as HTMLTextAreaElement;
  const keyboardHint = document.getElementById('keyboardHint')!;
  const preview = document.getElementById('previewImage')!;
  const inspect = document.getElementById('inspect') as HTMLButtonElement;
  const browse = document.getElementById('browse') as HTMLButtonElement;
  const status = document.getElementById('status')!;
  const candidates = document.getElementById('candidates')!;
  const errorPanel = document.getElementById('errorPanel')!;
  const emptyPreview = document.getElementById('emptyPreview')!;
  const marker = document.getElementById('selectionMarker')!;
  let inspecting = true;
  let busy = false;
  let settingUp = false;
  let hasPage = false;
  let refreshPaused = false;
  let addressEdited = false;
  let activeAction = '';
  let composing = false;
  let compositionCommit = '';
  let inputPaused = false;
  let resumingSession = false;
  let stateReady = false;
  let lastViewState = '';
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingHover: { x: number; y: number } | undefined;
  let suppressClick = false;
  let gesture:
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        x: number;
        y: number;
        dragging: boolean;
      }
    | undefined;
  type ClientViewState = {
    mode: 'inspect' | 'browse';
    address?: string;
    selectorScroll: number;
  };
  type ClientAction = { type: string; [key: string]: unknown };
  type Reply = BrowserReply & {
    type?: string;
    index?: number;
    format?: string;
    errorCode?: string;
    errorTitle?: string;
    browserName?: string;
    retryable?: boolean;
    setupBusy?: boolean;
    sessionBusy?: boolean;
    sessionAction?: string;
    uiState?: ClientViewState;
    devtoolsOpen?: boolean;
    sessionClosed?: boolean;
  };
  const queued: ClientAction[] = [];
  function viewState(): ClientViewState {
    return {
      mode: inspecting ? 'inspect' : 'browse',
      ...(addressEdited ? { address: address.value } : {}),
      selectorScroll: candidates.scrollTop,
    };
  }

  function saveViewState(): void {
    if (!stateReady) return;
    const state = viewState();
    const serialized = JSON.stringify(state);
    if (serialized === lastViewState) return;
    lastViewState = serialized;
    vscode.postMessage({ type: 'viewState', state });
  }
  const modeHint = () => {
    if (inputPaused)
      return 'Typing paused: the browser is catching up. Some input was not sent. Wait, then click the field and check its value.';
    if (inspecting) return 'Click an element in the preview to find its selectors.';
    return document.activeElement === keyboard
      ? 'Keyboard connected to website. Type, paste or use Tab. Press Esc to return to the toolbar.'
      : 'Click a field in the website and type directly. Use Tab to move between fields.';
  };

  function updateKeyboardFocus(): void {
    const connected = document.activeElement === keyboard && !inspecting && hasPage;
    preview.classList.toggle('keyboard-connected', connected);
    keyboardHint.hidden = inspecting || !hasPage;
    keyboardHint.classList.toggle('connected', connected);
    keyboardHint.textContent = connected
      ? 'Keyboard connected · Esc returns to toolbar'
      : 'Click a field to type directly';
  }

  function releaseKeyboard(): void {
    if (document.activeElement === keyboard) keyboard.blur();
    keyboard.value = '';
    composing = false;
    compositionCommit = '';
    updateKeyboardFocus();
  }

  function focusKeyboard(): void {
    if (!hasPage || inspecting || settingUp) return;
    inputPaused = false;
    keyboard.focus({ preventScroll: true });
    updateKeyboardFocus();
    if (!busy && !refreshPaused) status.textContent = modeHint();
  }

  function updateControls(): void {
    inspect.setAttribute('aria-pressed', String(inspecting));
    browse.setAttribute('aria-pressed', String(!inspecting));
    image.classList.toggle('browsing', !inspecting);
    image.alt = inspecting
      ? 'Website preview. Click an element to inspect its selectors.'
      : 'Website preview. Click to interact with the website.';
    document.getElementById('typing')!.hidden = inspecting || !hasPage;
    document.getElementById('typingTools')!.hidden = inspecting || !hasPage;
    address.disabled = settingUp;
    (document.getElementById('openWebsite') as HTMLButtonElement).disabled = settingUp;
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.disabled = !hasPage || settingUp;
    });
    document
      .getElementById('activity')!
      .classList.toggle('working', busy && !['refresh', 'hover'].includes(activeAction));
    document.getElementById('browserState')!.textContent =
      busy && !['refresh', 'hover'].includes(activeAction)
        ? 'Working'
        : hasPage
          ? 'Connected'
          : 'Not connected';
    document
      .getElementById('previewArea')!
      .setAttribute('aria-busy', String(busy && !['refresh', 'hover'].includes(activeAction)));
    document.querySelectorAll<HTMLButtonElement>('[data-setup]').forEach((button) => {
      button.disabled = busy;
    });
    updateKeyboardFocus();
  }

  function clearInspection(): void {
    candidates.replaceChildren();
    const placeholder = document.createElement('div');
    placeholder.className = 'selector-placeholder';
    const title = document.createElement('strong');
    title.textContent = 'Pick an element';
    const description = document.createElement('p');
    description.textContent = 'Inspect an element to see its current selectors.';
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent =
      'Playwright locators, CSS and XPath are checked against the live page and ranked here.';
    placeholder.append(title, description, detail);
    candidates.append(placeholder);
    document.getElementById('selectorCount')!.textContent = '0';
    document.getElementById('selectedElement')!.hidden = true;
    marker.hidden = true;
  }

  function send(action: ClientAction): boolean {
    if (settingUp) return false;
    if (busy) {
      // A periodic refresh must not swallow user actions or change their order.
      if (action.type !== 'refresh') {
        const previous = queued[queued.length - 1];
        if (action.type === 'hover' && previous?.type === 'hover') {
          queued[queued.length - 1] = action;
        } else if (
          action.type === 'type' &&
          previous?.type === 'type' &&
          previous.paste === action.paste &&
          typeof previous.text === 'string' &&
          typeof action.text === 'string' &&
          previous.text.length + action.text.length <= 10_000
        ) {
          previous.text += action.text;
        } else if (queued.length < 1_000) queued.push(action);
        else {
          inputPaused = true;
          releaseKeyboard();
          status.textContent = modeHint();
          return false;
        }
      }
      return true;
    }
    busy = true;
    activeAction = action.type;
    if (!['refresh', 'hover'].includes(action.type)) {
      refreshPaused = false;
      errorPanel.hidden = true;
      status.textContent =
        action.type === 'navigate'
          ? 'Opening website…'
          : action.type === 'inspect'
            ? 'Checking selectors against the page…'
            : 'Updating website…';
      if (!hasPage && action.type === 'navigate') {
        emptyPreview.hidden = false;
        document.getElementById('emptyTitle')!.textContent = 'Opening your website';
        document.getElementById('emptyDescription')!.textContent =
          'Starting the browser and preparing a live preview…';
      }
    }
    if (
      !['refresh', 'hover', 'inspect', 'devtools'].includes(action.type) &&
      !(action.type === 'clipboard' && action.operation === 'copy')
    )
      clearInspection();
    updateControls();
    vscode.postMessage(action);
    return true;
  }

  function copyButton(index: number, format: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.type = 'button';
    button.textContent = label;
    button.dataset.index = String(index);
    button.dataset.format = format;
    button.dataset.label = label;
    button.addEventListener('click', () => vscode.postMessage({ type: 'copy', index, format }));
    return button;
  }

  function showInspection(result: Inspection): void {
    candidates.replaceChildren();
    document.getElementById('selectorCount')!.textContent = String(result.candidates.length);
    document.getElementById('selectedElement')!.hidden = false;
    document.getElementById('elementTag')!.textContent = `<${result.tag}>`;
    const elementText = document.getElementById('elementText')!;
    elementText.textContent = result.text || 'Selected element';
    elementText.title = result.text;
    if (result.note) {
      const note = document.createElement('p');
      note.className = 'inspection-note';
      note.textContent = result.note;
      candidates.append(note);
    }
    result.candidates.forEach((candidate, index) => {
      const card = document.createElement('section');
      const recommended = index === 0 && candidate.unique;
      card.className = `selector-card${recommended ? ' recommended' : ''}`;
      const top = document.createElement('div');
      top.className = 'candidate-top';
      const title = document.createElement('strong');
      title.textContent = `${recommended ? 'Recommended · ' : ''}${candidate.kind}`;
      const matches = document.createElement('span');
      matches.className = candidate.unique ? 'match unique' : 'match ambiguous';
      matches.textContent = candidate.unique ? 'Unique match' : `${candidate.matches} matches`;
      top.append(title, matches);
      const code = document.createElement('pre');
      code.textContent = candidate.code;
      const reason = document.createElement('p');
      reason.className = 'candidate-reason';
      reason.textContent = candidate.reason;
      const actions = document.createElement('div');
      actions.className = 'candidate-actions';
      actions.append(copyButton(index, 'playwright', 'Copy Playwright'));
      if (candidate.selector) {
        actions.append(
          copyButton(index, 'selector', candidate.kind === 'XPath' ? 'Copy XPath' : 'Copy CSS'),
        );
      }
      card.append(top, code, reason, actions);
      candidates.append(card);
    });
    if (!result.candidates.length) {
      const note = document.createElement('p');
      note.className = 'inspection-note';
      note.textContent =
        'The element changed before it could be inspected. Click it again to retry.';
      candidates.append(note);
    }
  }

  function showError(reply: Reply): void {
    const missingBrowser =
      reply.errorCode === 'browser-missing' ||
      /Executable doesn't exist|download new browsers/i.test(reply.error || '');
    const missingPlaywright = reply.errorCode === 'playwright-missing';
    const title =
      reply.errorTitle ||
      (missingBrowser
        ? 'Choose a browser to get started'
        : missingPlaywright
          ? 'Playwright is needed in this project'
          : 'Could not complete this action');
    let description = reply.error || 'Please try again.';
    if (missingBrowser)
      description =
        'The Playwright browser is not installed yet. Install Chromium or use Chrome or Edge already on this computer.';
    else if (missingPlaywright)
      description =
        'Open a project with Playwright installed. You can add it from the project terminal, then retry.';
    else if (description.length > 300)
      description =
        description
          .split('\n')
          .find((line) => line.trim())
          ?.slice(0, 300) || 'Please try again.';
    document.getElementById('errorTitle')!.textContent = title;
    document.getElementById('errorDescription')!.textContent = description;
    document.getElementById('browserRecovery')!.hidden = !missingBrowser;
    document.getElementById('playwrightRecovery')!.hidden = !missingPlaywright;
    document.getElementById('retry')!.hidden = missingBrowser || reply.retryable === false;
    document.getElementById('errorDetails')!.textContent = reply.error || '';
    const details = document.getElementById('details') as HTMLDetailsElement;
    details.hidden = !reply.error || description === reply.error;
    details.open = false;
    errorPanel.hidden = false;
    if (!hasPage) emptyPreview.hidden = true;
    status.textContent = missingBrowser || missingPlaywright ? title : description;
  }

  function setMode(value: boolean): void {
    inspecting = value;
    if (inspecting) {
      cancelPointerGesture();
      releaseKeyboard();
    }
    if (!refreshPaused && !busy)
      status.textContent = hasPage ? modeHint() : 'Enter a website URL to begin.';
    updateControls();
    saveViewState();
  }

  address.addEventListener('input', () => {
    addressEdited = true;
    saveViewState();
  });
  document.getElementById('navigation')!.addEventListener('submit', (event) => {
    event.preventDefault();
    addressEdited = false;
    address.blur();
    saveViewState();
    send({ type: 'navigate', url: address.value });
  });
  candidates.addEventListener('scroll', () => {
    if (scrollTimer !== undefined || !stateReady) return;
    saveViewState();
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      saveViewState();
    }, 100);
  });
  window.addEventListener('pagehide', saveViewState);
  inspect.addEventListener('click', () => setMode(true));
  browse.addEventListener('click', () => setMode(false));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => send({ type: button.dataset.action! }));
  });
  document.getElementById('devtools')!.addEventListener('mousedown', (event) => {
    if (document.activeElement === keyboard) event.preventDefault();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-setup]').forEach((button) => {
    button.addEventListener('click', () => {
      if (busy) return;
      if (button.dataset.setup === 'openGuide') {
        vscode.postMessage({ type: 'setup', action: 'openGuide' });
        return;
      }
      busy = true;
      settingUp = true;
      activeAction = 'setup';
      status.textContent =
        button.dataset.setup === 'installChromium'
          ? 'Installing Chromium. See the Playwright Studio output for progress…'
          : 'Preparing the browser…';
      updateControls();
      vscode.postMessage({ type: 'setup', action: button.dataset.setup });
    });
  });
  function websitePoint(event: MouseEvent): { x: number; y: number } {
    const bounds = image.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          image.naturalWidth - 0.01,
          ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          image.naturalHeight - 0.01,
          ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight,
        ),
      ),
    };
  }

  function cancelHover(): void {
    if (hoverTimer !== undefined) clearTimeout(hoverTimer);
    hoverTimer = undefined;
    pendingHover = undefined;
  }

  function cancelPointerGesture(): void {
    const current = gesture;
    gesture = undefined;
    preview.classList.remove('dragging');
    cancelHover();
    if (current && image.hasPointerCapture(current.pointerId))
      image.releasePointerCapture(current.pointerId);
  }

  image.addEventListener('pointerdown', (event) => {
    if (!hasPage || inspecting || settingUp || event.button !== 0) return;
    cancelHover();
    gesture = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      ...websitePoint(event),
      dragging: false,
    };
    image.setPointerCapture(event.pointerId);
  });
  image.addEventListener('pointermove', (event) => {
    if (!hasPage || inspecting || settingUp) return;
    if (gesture?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) > 4) {
        gesture.dragging = true;
        preview.classList.add('dragging');
      }
      return;
    }
    if (event.buttons !== 0) return;
    pendingHover = websitePoint(event);
    if (hoverTimer !== undefined) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      const point = pendingHover;
      pendingHover = undefined;
      if (point && hasPage && !inspecting && !gesture) send({ type: 'hover', ...point });
    }, 80);
  });
  image.addEventListener('pointerup', (event) => {
    if (gesture?.pointerId !== event.pointerId) return;
    const current = gesture;
    const end = websitePoint(event);
    cancelPointerGesture();
    if (!current.dragging || inspecting) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    focusKeyboard();
    send({ type: 'drag', x: current.x, y: current.y, toX: end.x, toY: end.y });
  });
  image.addEventListener('pointercancel', cancelPointerGesture);
  image.addEventListener('lostpointercapture', cancelPointerGesture);
  image.addEventListener('pointerleave', () => {
    if (!gesture) cancelHover();
  });
  image.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!hasPage) return;
    cancelHover();
    const bounds = image.getBoundingClientRect();
    if (inspecting) {
      marker.style.left = `${((event.clientX - bounds.left) / bounds.width) * 100}%`;
      marker.style.top = `${((event.clientY - bounds.top) / bounds.height) * 100}%`;
      marker.hidden = false;
    } else {
      // Keep the IME candidate window near the field that received the click.
      keyboard.style.left = `${event.clientX - bounds.left}px`;
      keyboard.style.top = `${Math.max(0, event.clientY - bounds.top - 16)}px`;
      focusKeyboard();
    }
    send({
      type: inspecting ? 'inspect' : 'click',
      ...websitePoint(event),
      ...(!inspecting ? { clickCount: Math.min(3, event.detail || 1) } : {}),
    });
  });
  image.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (hasPage) {
        send({
          type: 'scroll',
          delta: event.deltaY,
          ...websitePoint(event),
        });
      }
    },
    { passive: false },
  );
  image.addEventListener('focus', focusKeyboard);
  keyboard.addEventListener('focus', updateKeyboardFocus);
  keyboard.addEventListener('blur', () => {
    keyboard.value = '';
    composing = false;
    compositionCommit = '';
    updateKeyboardFocus();
    if (hasPage && !busy && !refreshPaused) status.textContent = modeHint();
  });
  const canType = () => hasPage && !inspecting && !settingUp && document.activeElement === keyboard;

  function sendText(text: string, paste = false): boolean {
    // IPC messages are bounded; adjacent text is combined while the browser is busy.
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 10_000, text.length);
      const lastCodeUnit = text.charCodeAt(end - 1);
      if (end < text.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end--;
      if (!send({ type: 'type', text: text.slice(offset, end), paste })) return false;
      offset = end;
    }
    return true;
  }

  keyboard.addEventListener('keydown', (event) => {
    if (!canType() || event.isComposing || composing || event.keyCode === 229) return;
    compositionCommit = '';
    if (event.key === 'Escape') {
      event.preventDefault();
      send({ type: 'key', key: 'Escape' });
      releaseKeyboard();
      browse.focus();
      return;
    }

    const navigation = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    const deletion = ['Backspace', 'Delete'];
    let key: string | undefined;
    const command = event.ctrlKey || event.metaKey;
    if (command && !event.altKey) {
      const letter = event.key.toLowerCase();
      if (!event.shiftKey && ['c', 'x'].includes(letter)) {
        event.preventDefault();
        send({ type: 'clipboard', operation: letter === 'c' ? 'copy' : 'cut' });
        return;
      }
      if (['a', 'z', 'y'].includes(letter) && (!event.shiftKey || letter === 'z')) {
        key = `ControlOrMeta+${event.shiftKey ? 'Shift+' : ''}${letter.toUpperCase()}`;
      } else if ([...navigation, ...deletion, 'Enter'].includes(event.key)) {
        key = `ControlOrMeta+${event.shiftKey ? 'Shift+' : ''}${event.key}`;
      }
      // Paste stays native so the paste event can read plain text from this user gesture.
    } else if (event.altKey && !command) {
      if (['ArrowLeft', 'ArrowRight', ...deletion].includes(event.key)) {
        key = `Alt+${event.shiftKey ? 'Shift+' : ''}${event.key}`;
      }
      // Option/dead keys and AltGr text are handled by the input/composition events.
    } else if (!command && !event.altKey) {
      if ([...navigation, 'PageUp', 'PageDown', 'Tab', 'Enter'].includes(event.key)) {
        key = `${event.shiftKey ? 'Shift+' : ''}${event.key}`;
      } else if (deletion.includes(event.key)) key = event.key;
      else if (event.key === ' ') key = 'Space';
    }
    if (key) {
      event.preventDefault();
      send({ type: 'key', key });
    }
  });
  keyboard.addEventListener('beforeinput', (event) => {
    if (!canType()) {
      event.preventDefault();
      keyboard.value = '';
      return;
    }
    if (composing || event.isComposing) return;
    const editingKeys: Record<string, string> = {
      deleteContentBackward: 'Backspace',
      deleteContentForward: 'Delete',
      deleteWordBackward: 'ControlOrMeta+Backspace',
      deleteWordForward: 'ControlOrMeta+Delete',
      insertLineBreak: 'Enter',
      insertParagraph: 'Enter',
      historyUndo: 'ControlOrMeta+Z',
      historyRedo: 'ControlOrMeta+Shift+Z',
    };
    const key = editingKeys[event.inputType];
    if (key) {
      event.preventDefault();
      send({ type: 'key', key });
    }
  });
  keyboard.addEventListener('input', (event) => {
    const inputEvent = event as InputEvent;
    if (composing || inputEvent.isComposing) return;
    const text = keyboard.value;
    keyboard.value = '';
    if (!canType() || !text) return;
    // Some input methods emit a final input after compositionend. Forward each commit once.
    if (compositionCommit === text) {
      compositionCommit = '';
      return;
    }
    compositionCommit = '';
    sendText(text);
  });
  keyboard.addEventListener('compositionstart', () => {
    if (!canType()) return;
    composing = true;
    compositionCommit = '';
    keyboard.value = '';
  });
  keyboard.addEventListener('compositionend', (event) => {
    composing = false;
    compositionCommit = event.data;
    const committed = event.data;
    setTimeout(() => {
      if (compositionCommit === committed) compositionCommit = '';
    }, 0);
    keyboard.value = '';
    if (canType() && event.data) sendText(event.data, true);
  });
  keyboard.addEventListener('paste', (event) => {
    event.preventDefault();
    if (!canType()) return;
    const text = event.clipboardData?.getData('text/plain') || '';
    keyboard.value = '';
    compositionCommit = '';
    if (text) sendText(text, true);
  });
  for (const operation of ['copy', 'cut'] as const) {
    keyboard.addEventListener(operation, (event) => {
      event.preventDefault();
      if (canType()) send({ type: 'clipboard', operation });
    });
  }
  document.getElementById('typing')!.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!hasPage || inspecting) return;
    if (sendText(input.value, true)) {
      input.value = '';
      focusKeyboard();
    }
  });
  document
    .getElementById('enter')!
    .addEventListener('click', () => send({ type: 'key', key: 'Enter' }));
  document
    .getElementById('selectAll')!
    .addEventListener('click', () => send({ type: 'key', key: 'ControlOrMeta+A' }));
  document.getElementById('accept')!.addEventListener('click', () =>
    send({
      type: 'dialog',
      accept: true,
      text: (document.getElementById('prompt') as HTMLInputElement).value,
    }),
  );
  document
    .getElementById('dismiss')!
    .addEventListener('click', () => send({ type: 'dialog', accept: false }));

  window.addEventListener('message', (event) => {
    const reply = event.data as Reply;
    if (!reply || typeof reply !== 'object') return;
    if (reply.type === 'copied') {
      const button = candidates.querySelector<HTMLButtonElement>(
        `button[data-index="${Number(reply.index)}"][data-format="${reply.format === 'selector' ? 'selector' : 'playwright'}"]`,
      );
      if (button) {
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = button.dataset.label || 'Copy';
        }, 1800);
      }
      document.getElementById('copyStatus')!.textContent = 'Selector copied to clipboard.';
      return;
    }
    const completedAction = activeAction;
    const completingSession = resumingSession && !reply.sessionBusy && !reply.setupBusy;
    resumingSession = !!reply.sessionBusy || (!!reply.setupBusy && !!reply.uiState);
    busy = !!reply.setupBusy || !!reply.sessionBusy;
    settingUp = !!reply.setupBusy;
    activeAction = reply.setupBusy
      ? 'setup'
      : reply.sessionBusy
        ? reply.sessionAction || 'refresh'
        : '';
    if (reply.sessionClosed) {
      hasPage = false;
      refreshPaused = false;
      addressEdited = false;
      address.value = '';
      input.value = '';
      queued.length = 0;
      image.hidden = true;
      image.removeAttribute('src');
      errorPanel.hidden = true;
      emptyPreview.hidden = false;
      document.getElementById('emptyTitle')!.textContent = 'Your website, ready to inspect';
      document.getElementById('emptyDescription')!.textContent =
        'Open a URL above. Select an element to compare locators verified against the live page.';
      document.getElementById('browserName')!.textContent = '';
      cancelPointerGesture();
      releaseKeyboard();
      clearInspection();
    }
    if (reply.url && !addressEdited && document.activeElement !== address)
      address.value = reply.url;
    if (reply.browserName) document.getElementById('browserName')!.textContent = reply.browserName;
    if (reply.screenshot && !reply.sessionClosed) {
      image.src = 'data:image/jpeg;base64,' + reply.screenshot;
      hasPage = true;
      image.hidden = false;
      emptyPreview.hidden = true;
    }
    if (reply.inspection) showInspection(reply.inspection);
    if (reply.uiState) {
      inspecting = reply.uiState.mode !== 'browse';
      addressEdited = typeof reply.uiState.address === 'string';
      if (addressEdited) address.value = reply.uiState.address!;
      else if (reply.url) address.value = reply.url;
      candidates.scrollTop = reply.uiState.selectorScroll || 0;
      stateReady = true;
      lastViewState = JSON.stringify(viewState());
    }
    document.getElementById('dialog')!.hidden = !reply.dialog;
    if (reply.dialog) document.getElementById('dialogMessage')!.textContent = reply.dialog.message;
    if (reply.error) {
      refreshPaused = true;
      showError(reply);
    } else if (reply.setupBusy) {
      status.textContent = 'Preparing the browser. See the Playwright Studio output for progress…';
    } else if (reply.sessionBusy) {
      status.textContent = 'Finishing the previous browser action…';
    } else if (!['refresh', 'hover'].includes(completedAction) || completingSession) {
      refreshPaused = false;
      errorPanel.hidden = true;
      status.textContent = reply.dialog
        ? 'This website is waiting for a dialog response.'
        : reply.devtoolsOpen
          ? 'Chrome DevTools opened for this website.'
          : hasPage
            ? modeHint()
            : 'Enter a website URL to begin.';
    }
    if (reply.error || reply.dialog) {
      queued.length = 0;
      cancelPointerGesture();
      releaseKeyboard();
    }
    updateControls();
    const next = !busy && queued.shift();
    if (next) send(next);
  });
  setInterval(() => {
    if (hasPage && !busy && !refreshPaused && !document.hidden) send({ type: 'refresh' });
  }, 1200);
  clearInspection();
  updateControls();
  address.focus();
  vscode.postMessage({ type: 'ready' });
}

export function selectorHtml(): string {
  const nonce = randomBytes(18).toString('hex');
  const icon = (content: string) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
  const pointer = icon('<path d="m5 3 14 10-7 1-3 7-4-18Z"/>');
  const globe = icon(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  );
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${selectorStyles}
</style></head><body><div class="app">
<header class="page-heading"><span class="brand-icon">${pointer}</span><div><h1>Selector Intelligence</h1><p>Find reliable locators by inspecting your website.</p></div></header>
<main class="workspace"><section class="browser-panel" aria-label="Website browser">
<div class="browser-toolbar"><form id="navigation"><div class="navigation-buttons"><button type="button" class="icon-button" data-action="back" aria-label="Back" title="Back">${icon('<path d="m14 6-6 6 6 6"/>')}</button><button type="button" class="icon-button" data-action="forward" aria-label="Forward" title="Forward">${icon('<path d="m10 6 6 6-6 6"/>')}</button><button type="button" class="icon-button" data-action="reload" aria-label="Reload" title="Reload">${icon('<path d="M20 7v5h-5M19.5 12A7.5 7.5 0 1 1 17 6"/>')}</button></div><label for="address" class="sr-only">Website</label><div class="address-field">${globe}<input id="address" type="url" placeholder="https://example.com or http://localhost:3000" required spellcheck="false" autocomplete="off"></div><button id="openWebsite" class="primary">Open website</button></form></div>
<div class="preview-toolbar"><div class="segmented" role="group" aria-label="Preview mode"><button id="inspect" aria-pressed="true">${pointer}Inspect</button><button id="browse" aria-pressed="false">${globe}Browse</button></div><span id="keyboardHint" class="keyboard-hint" hidden>Click a field to type directly</span><span class="browser-meta"><span id="activity" aria-hidden="true"></span><span id="browserState">Not connected</span></span><button id="devtools" type="button" class="icon-button" data-action="devtools" aria-label="Open Chrome DevTools" title="Open Chrome DevTools for this website" disabled>${icon('<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-5 3 2-16"/>')}</button></div>
<div id="previewArea" aria-busy="false">
<div id="errorPanel" role="alert" hidden><div class="error-heading">${icon('<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>')}<h2 id="errorTitle"></h2></div><p id="errorDescription"></p><div id="browserRecovery" class="recovery-actions" hidden><button class="primary" data-setup="installChromium">Install Chromium</button><button data-setup="useChrome">Use Chrome</button><button data-setup="useEdge">Use Edge</button></div><div id="playwrightRecovery" hidden><pre>npm install --save-dev @playwright/test</pre><div><button data-setup="openGuide">Open setup guide</button></div></div><button id="retry" data-setup="retry">Try again</button><details id="details"><summary>Technical details</summary><pre id="errorDetails"></pre></details></div>
<div id="dialog" role="region" aria-label="Website dialog" hidden><h2>Website dialog</h2><p id="dialogMessage"></p><div class="dialog-actions"><input id="prompt" aria-label="Dialog response"><button id="accept" class="primary">Accept dialog</button><button id="dismiss">Dismiss dialog</button></div></div>
<div id="emptyPreview" class="empty-preview"><div class="preview-illustration" aria-hidden="true"><div class="illustration-toolbar"><i></i><i></i><i></i></div><div class="illustration-content"><span></span><span></span><span></span>${pointer}</div></div><h2 id="emptyTitle">Your website, ready to inspect</h2><p id="emptyDescription">Open a URL above. Select an element to compare locators verified against the live page.</p><div class="preview-steps"><span><b>1</b>Open a website</span><span><b>2</b>Inspect an element</span><span><b>3</b>Copy a locator</span></div></div>
<div id="previewImage" class="preview-image"><img id="website" width="${VIEWPORT.width}" height="${VIEWPORT.height}" alt="Website preview. Click an element to inspect its selectors." tabindex="0" draggable="false" hidden><textarea id="websiteInput" aria-label="Website keyboard input" aria-describedby="keyboardHint" tabindex="-1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><span id="selectionMarker" aria-hidden="true" hidden></span></div>
</div>
<details id="typingTools" hidden><summary>Text entry tools</summary><form id="typing" hidden><label for="input">Insert text into the field selected in the website</label><input id="input" type="password" maxlength="10000" autocomplete="off" placeholder="Text to enter (hidden for privacy)"><button class="primary">Insert text</button><button type="button" id="selectAll">Select all</button><button type="button" id="enter">Enter</button></form></details>
<div class="status-bar"><p id="status" role="status">Enter a website URL to begin.</p><span id="browserName"></span></div>
</section>
<aside class="selector-panel" aria-label="Ranked selectors"><div class="selector-heading"><h2>Selectors</h2><span id="selectorCount" aria-label="Selector count">0</span></div><div id="selectedElement" hidden><code id="elementTag"></code><span id="elementText"></span></div><div id="candidates"></div><p class="selector-footer">Unique matches rank first. Prefer locators that stay stable as your page changes.</p><span id="copyStatus" role="status" class="sr-only"></span></aside>
</main></div><script nonce="${nonce}">(${selectorClient.toString()})();</script></body></html>`;
}
