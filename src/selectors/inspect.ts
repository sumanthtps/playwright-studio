/// <reference lib="dom" />
import type { ElementHandle, Frame, Locator, Page } from 'playwright';
import type { Inspection, SelectorCandidate } from './protocol';

/** Runs in the inspected document, including an open shadow root. */
function describeElement(element: Element) {
  const limit = (value: string | null | undefined) => (value ?? '').trim().slice(0, 200);
  const attribute = (name: string) => limit(element.getAttribute(name));
  const pathParts: string[] = [];
  let current: Element | null = element;
  let shadow = false;
  while (current && pathParts.length < 40) {
    const parent: Element | null = current.parentElement;
    const siblings: Element[] = parent
      ? Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
      : [];
    const part =
      CSS.escape(current.localName) +
      (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '');
    pathParts.unshift(part);
    if (!parent && current.getRootNode() instanceof ShadowRoot) {
      shadow = true;
      pathParts.unshift('>>>');
      current = (current.getRootNode() as ShadowRoot).host;
    } else current = parent;
  }
  const cssPath = pathParts.join(' > ').replace(/ > >>> > /g, ' ');
  const xpathParts: string[] = [];
  current = element;
  while (current && xpathParts.length < 40) {
    const tag = current.localName;
    const siblings: Element[] = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.localName === tag)
      : [];
    xpathParts.unshift(
      `*[local-name()=${JSON.stringify(tag)}][${Math.max(1, siblings.indexOf(current) + 1)}]`,
    );
    current = current.parentElement;
  }
  const input = element as HTMLInputElement;
  return {
    tag: element.localName,
    text: limit((element as HTMLElement).innerText ?? element.textContent),
    testId: attribute('data-testid'),
    id: attribute('id'),
    name: attribute('name'),
    label: limit(input.labels?.[0]?.textContent) || attribute('aria-label'),
    placeholder: attribute('placeholder'),
    alt: attribute('alt'),
    title: attribute('title'),
    role: attribute('role'),
    cssId: attribute('id') ? `#${CSS.escape(element.id)}` : '',
    cssPath,
    xpath: shadow ? '' : '/' + xpathParts.join('/'),
    shadow,
  };
}

function roleFromSnapshot(snapshot: string): { role: string; name?: string } | undefined {
  const match = /^- ([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?(?:\s|:|$)/.exec(snapshot);
  if (!match || ['text', 'generic', 'fragment'].includes(match[1])) return;
  let name: string | undefined;
  if (match[2]) {
    try {
      name = JSON.parse(match[2]);
    } catch {
      return;
    }
  }
  return { role: match[1], name };
}

export async function inspectElement(
  frame: Frame,
  element: ElementHandle<Element>,
  prefix = 'page',
): Promise<Inspection> {
  const details = await element.evaluate(describeElement);
  const candidates: SelectorCandidate[] = [];
  const seen = new Set<string>();
  const quoted = JSON.stringify;
  const add = async (
    kind: string,
    code: string,
    locator: Locator,
    score: number,
    reason: string,
    selector?: string,
  ) => {
    if (seen.has(code)) return;
    seen.add(code);
    try {
      const match = await locator.evaluateAll(
        (elements, selected) => ({
          count: elements.length,
          selected: elements.some((element) => element === selected),
        }),
        element,
      );
      if (!match.selected) return;
      candidates.push({
        kind,
        code: `${prefix}.${code}`,
        selector,
        matches: match.count,
        unique: match.count === 1,
        score,
        reason,
      });
    } catch {
      /* Unsupported or detached candidates are not suggested. */
    }
  };
  const fallback = frame.locator(details.cssPath);
  let role: ReturnType<typeof roleFromSnapshot>;
  if ((await fallback.count()) === 1) {
    try {
      role = roleFromSnapshot(await fallback.ariaSnapshot({ timeout: 2000 }));
    } catch {
      /* Older Playwright versions still get other candidates. */
    }
  }
  if (role) {
    const options = role.name ? { name: role.name, exact: true } : {};
    await add(
      'Playwright role',
      `getByRole(${quoted(role.role)}${role.name ? `, { name: ${quoted(role.name)}, exact: true }` : ''})`,
      frame.getByRole(role.role as Parameters<Frame['getByRole']>[0], options),
      role.name ? 100 : 65,
      'Uses the accessible role and name exposed to users.',
    );
  }
  if (details.testId)
    await add(
      'Playwright test ID',
      `getByTestId(${quoted(details.testId)})`,
      frame.getByTestId(details.testId),
      95,
      'Explicit data-testid contract.',
    );
  for (const [kind, method, value, score, reason] of [
    ['Playwright label', 'getByLabel', details.label, 90, 'Uses the form field label.'],
    [
      'Playwright placeholder',
      'getByPlaceholder',
      details.placeholder,
      80,
      'Uses the input placeholder.',
    ],
    ['Playwright alt text', 'getByAltText', details.alt, 85, 'Uses alternative text.'],
    ['Playwright title', 'getByTitle', details.title, 75, 'Uses the title attribute.'],
    [
      'Playwright text',
      'getByText',
      details.text,
      70,
      'Uses exact visible text; translations may change it.',
    ],
  ] as const) {
    if (value)
      await add(
        kind,
        `${method}(${quoted(value)}, { exact: true })`,
        frame[method](value, { exact: true }),
        score,
        reason,
      );
  }
  if (details.cssId)
    await add(
      'CSS ID',
      `locator(${quoted(details.cssId)})`,
      frame.locator(details.cssId),
      /\d{4}|[a-f0-9]{8}/i.test(details.id) ? 35 : 60,
      'Prefer an ID only if the application keeps it stable.',
      details.cssId,
    );
  for (const [name, value] of [
    ['data-testid', details.testId],
    ['name', details.name],
    ['aria-label', details.label],
  ] as const) {
    if (!value) continue;
    const selector = `${details.tag}[${name}=${quoted(value)}]`;
    await add(
      'CSS attribute',
      `locator(${quoted(selector)})`,
      frame.locator(selector),
      50,
      'Matches a named attribute; confirm that it is stable.',
      selector,
    );
  }
  await add(
    'CSS path',
    `locator(${quoted(details.cssPath)})`,
    fallback,
    10,
    'Structural fallback; DOM changes can break it.',
    details.cssPath,
  );
  if (details.xpath)
    await add(
      'XPath',
      `locator(${quoted('xpath=' + details.xpath)})`,
      frame.locator('xpath=' + details.xpath),
      5,
      'Structural fallback; XPath does not pierce shadow roots.',
      details.xpath,
    );
  candidates.sort((a, b) => Number(b.unique) - Number(a.unique) || b.score - a.score);
  return {
    tag: details.tag,
    text: details.text,
    frameUrl: frame.url(),
    candidates,
    note: details.shadow
      ? 'Inside an open shadow root. Playwright locators pierce it; standard XPath cannot.'
      : undefined,
  };
}

export async function inspectPoint(page: Page, x: number, y: number): Promise<Inspection> {
  let frame = page.mainFrame();
  let prefix = 'page';
  for (let depth = 0; depth < 10; depth++) {
    const handle = await frame.evaluateHandle(
      ({ x, y }) => {
        let element = document.elementFromPoint(x, y);
        while (element?.shadowRoot) {
          const inner = element.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === element) break;
          element = inner;
        }
        return element;
      },
      { x, y },
    );
    const element = handle.asElement() as ElementHandle<Element> | null;
    if (!element) {
      await handle.dispose();
      throw new Error('No element at this point.');
    }
    try {
      const childFrame = await element.contentFrame();
      if (!childFrame) return await inspectElement(frame, element, prefix);
      const details = await element.evaluate(describeElement);
      const frameSelector = details.cssId || details.cssPath;
      prefix += `.frameLocator(${JSON.stringify(frameSelector)})`;
      const offset = await element.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + node.clientLeft, y: rect.top + node.clientTop };
      });
      x -= offset.x;
      y -= offset.y;
      frame = childFrame;
    } finally {
      await handle.dispose();
    }
  }
  throw new Error('Frame nesting exceeds the inspection limit.');
}
