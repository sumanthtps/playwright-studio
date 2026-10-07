const ENV_NAME = 'PLAYWRIGHT_STUDIO_VIDEO';

function maskNonCode(source: string): string {
  const chars = source.split('');
  let state: 'code' | 'string' | 'line' | 'block' = 'code';
  let quote = '';
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (char === '\n') state = 'code';
      else chars[i] = ' ';
    } else if (state === 'block') {
      if (char !== '\n' && char !== '\r') chars[i] = ' ';
      if (char === '*' && next === '/') {
        chars[i + 1] = ' ';
        state = 'code';
        i++;
      }
    } else if (state === 'string') {
      if (char !== '\n' && char !== '\r') chars[i] = ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) state = 'code';
    } else if (char === '/' && next === '/') {
      chars[i] = chars[i + 1] = ' ';
      state = 'line';
      i++;
    } else if (char === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' ';
      state = 'block';
      i++;
    } else if (char === '"' || char === "'" || char === '`') {
      chars[i] = ' ';
      quote = char;
      state = 'string';
    }
  }
  return chars.join('');
}

function matchingBrace(code: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return undefined;
}

function configOpen(code: string): number | undefined {
  for (const pattern of [
    /\bdefineConfig\s*\(/g,
    /\bexport\s+default\s+/g,
    /\bmodule\.exports\s*=\s*/g,
  ]) {
    const match = pattern.exec(code);
    if (!match) continue;
    const open = code.indexOf('{', match.index + match[0].length);
    if (open >= 0) return open;
  }
  return undefined;
}

interface Property {
  start: number;
  valueStart: number;
  valueEnd: number;
}

function propertyInObject(
  source: string,
  code: string,
  open: number,
  close: number,
  name: string,
): Property | undefined {
  const propertyAt = (start: number, colon: number): Property => {
    let valueStart = colon + 1;
    while (valueStart < close && /\s/.test(source[valueStart])) valueStart++;
    let braces = 0,
      brackets = 0,
      parens = 0;
    let valueEnd = close;
    for (let j = valueStart; j < close; j++) {
      if (code[j] === '{') braces++;
      else if (code[j] === '}') {
        if (braces === 0) {
          valueEnd = j;
          break;
        }
        braces--;
      } else if (code[j] === '[') brackets++;
      else if (code[j] === ']') brackets--;
      else if (code[j] === '(') parens++;
      else if (code[j] === ')') parens--;
      else if (code[j] === ',' && braces === 0 && brackets === 0 && parens === 0) {
        valueEnd = j;
        break;
      }
    }
    while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1])) valueEnd--;
    return { start, valueStart, valueEnd };
  };
  let depth = 1;
  for (let i = open + 1; i < close;) {
    if (code[i] === '{') {
      depth++;
      i++;
      continue;
    }
    if (code[i] === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && (source[i] === '"' || source[i] === "'")) {
      const quote = source[i];
      const quotedStart = i;
      let before = quotedStart - 1;
      while (before > open && /\s/.test(source[before])) before--;
      const computed = source[before] === '[';
      const start = computed ? before : i;
      i++;
      let value = '';
      for (; i < close; i++) {
        if (source[i] === '\\' && i + 1 < close) {
          value += source[++i];
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        value += source[i];
      }
      if (value !== name) continue;
      while (i < close && /\s/.test(source[i])) i++;
      if (computed && source[i] === ']') {
        i++;
        while (i < close && /\s/.test(source[i])) i++;
      }
      if (source[i] === ':') return propertyAt(start, i);
      continue;
    }
    if (depth !== 1 || !/[A-Za-z_$]/.test(code[i])) {
      i++;
      continue;
    }
    const start = i++;
    while (i < close && /[\w$]/.test(code[i])) i++;
    if (source.slice(start, i) !== name) continue;
    while (i < close && /\s/.test(code[i])) i++;
    if (code[i] !== ':') continue;
    return propertyAt(start, i);
  }
  return undefined;
}

function lineIndent(source: string, offset: number): string {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  return /^\s*/.exec(source.slice(start, offset))?.[0] ?? '';
}

export interface VideoBridgeResult {
  text?: string;
  reason?: string;
  changed: boolean;
}

export function injectVideoEnvironmentBridge(
  source: string,
  typescript: boolean,
): VideoBridgeResult {
  const code = maskNonCode(source);
  if (code.includes(`process.env.${ENV_NAME}`)) return { text: source, changed: false };
  const open = configOpen(code);
  const close = open === undefined ? undefined : matchingBrace(code, open);
  if (open === undefined || close === undefined)
    return { changed: false, reason: 'The exported config object could not be located safely.' };
  const cast = typescript
    ? `(process.env.${ENV_NAME} as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | undefined)`
    : `process.env.${ENV_NAME}`;
  const use = propertyInObject(source, code, open, close, 'use');
  if (!use) {
    if (code.slice(open + 1, close).includes('...')) {
      return {
        changed: false,
        reason: 'The config spreads another object and has no explicit use block.',
      };
    }
    const indent = `${lineIndent(source, open)}  `;
    return {
      changed: true,
      text: `${source.slice(0, open + 1)}\n${indent}use: { video: ${cast} },${source.slice(open + 1)}`,
    };
  }
  if (code[use.valueStart] !== '{')
    return { changed: false, reason: 'The use setting is not a static object literal.' };
  const useClose = matchingBrace(code, use.valueStart);
  if (useClose === undefined || useClose > use.valueEnd)
    return { changed: false, reason: 'The use block could not be parsed safely.' };
  const video = propertyInObject(source, code, use.valueStart, useClose, 'video');
  if (video) {
    const original = source.slice(video.valueStart, video.valueEnd);
    const replacement = `${cast} ?? (${original})`;
    return {
      changed: true,
      text: source.slice(0, video.valueStart) + replacement + source.slice(video.valueEnd),
    };
  }
  const indent = `${lineIndent(source, use.valueStart)}  `;
  return {
    changed: true,
    text: `${source.slice(0, use.valueStart + 1)}\n${indent}video: ${cast},${source.slice(use.valueStart + 1)}`,
  };
}
