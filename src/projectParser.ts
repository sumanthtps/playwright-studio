function skipString(content: string, start: number): number {
  const quote = content[start];
  for (let i = start + 1; i < content.length; i++) {
    if (content[i] === '\\') i++;
    else if (content[i] === quote) return i + 1;
  }
  return content.length;
}

function skipTrivia(content: string, start: number): number {
  let i = start;
  while (i < content.length) {
    if (/\s/.test(content[i])) i++;
    else if (content.startsWith('//', i)) {
      const end = content.indexOf('\n', i + 2);
      i = end < 0 ? content.length : end + 1;
    } else if (content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      i = end < 0 ? content.length : end + 2;
    } else break;
  }
  return i;
}

function maskStringsAndComments(content: string): string {
  const output = [...content];
  for (let i = 0; i < content.length;) {
    let end: number | undefined;
    if (content.startsWith('//', i)) {
      const newline = content.indexOf('\n', i + 2);
      end = newline < 0 ? content.length : newline;
    } else if (content.startsWith('/*', i)) {
      const commentEnd = content.indexOf('*/', i + 2);
      end = commentEnd < 0 ? content.length : commentEnd + 2;
    } else if (/['"`]/.test(content[i])) {
      end = skipString(content, i);
    }
    if (end === undefined) {
      i++;
      continue;
    }
    for (let j = i; j < end; j++) {
      if (content[j] !== '\n' && content[j] !== '\r') output[j] = ' ';
    }
    i = end;
  }
  return output.join('');
}

function configBounds(content: string): { open: number; close: number; depth: number } | undefined {
  const code = maskStringsAndComments(content);
  for (const pattern of [
    /\bdefineConfig\s*\(/g,
    /\bexport\s+default\s+/g,
    /\bmodule\.exports\s*=\s*/g,
  ]) {
    const match = pattern.exec(code);
    if (!match) continue;
    const open = code.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    let nested = 0;
    let close = content.length;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') nested++;
      else if (code[i] === '}' && --nested === 0) {
        close = i;
        break;
      }
    }
    let depth = 0;
    for (let i = 0; i <= open; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
    }
    return { open, close, depth };
  }
  return undefined;
}

function projectsArrayStart(content: string): number | undefined {
  const candidates: Array<{ start: number; depth: number; property: number }> = [];
  let depth = 0;
  for (let i = 0; i < content.length;) {
    if (content.startsWith('//', i)) {
      const end = content.indexOf('\n', i + 2);
      i = end < 0 ? content.length : end + 1;
    } else if (content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      i = end < 0 ? content.length : end + 2;
    } else if (/['"`]/.test(content[i])) {
      const end = skipString(content, i);
      if (decodeString(content, i, end) === 'projects') {
        const colon = skipTrivia(content, end);
        const value = content[colon] === ':' ? skipTrivia(content, colon + 1) : colon;
        if (content[colon] === ':' && content[value] === '[') {
          candidates.push({ start: value, depth, property: i });
        }
      }
      i = end;
    } else if (content[i] === '{') {
      depth++;
      i++;
    } else if (content[i] === '}') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (/[A-Za-z_$]/.test(content[i])) {
      const start = i++;
      while (i < content.length && /[\w$]/.test(content[i])) i++;
      if (content.slice(start, i) !== 'projects') continue;
      const colon = skipTrivia(content, i);
      if (content[colon] !== ':') continue;
      const value = skipTrivia(content, colon + 1);
      if (content[value] === '[') candidates.push({ start: value, depth, property: start });
    } else {
      i++;
    }
  }
  const bounds = configBounds(content);
  if (bounds) {
    return candidates.find(candidate =>
      candidate.depth === bounds.depth &&
      candidate.property > bounds.open &&
      candidate.property < bounds.close
    )?.start;
  }
  return candidates.sort((left, right) => left.depth - right.depth)[0]?.start;
}

function decodeString(content: string, start: number, end: number): string {
  return content
    .slice(start + 1, end - 1)
    .replace(/\\(['"`\\])/g, '$1');
}

export function extractProjectNames(content: string): string[] {
  const arrayStart = projectsArrayStart(content);
  if (arrayStart === undefined) return [];
  const names: string[] = [];
  let objectDepth = 0;

  for (let i = arrayStart + 1; i < content.length;) {
    if (content.startsWith('//', i)) {
      const end = content.indexOf('\n', i + 2);
      i = end < 0 ? content.length : end + 1;
      continue;
    }
    if (content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      i = end < 0 ? content.length : end + 2;
      continue;
    }
    if (/['"`]/.test(content[i])) {
      const propertyEnd = skipString(content, i);
      if (objectDepth === 1 && decodeString(content, i, propertyEnd) === 'name') {
        const colon = skipTrivia(content, propertyEnd);
        const value = content[colon] === ':' ? skipTrivia(content, colon + 1) : colon;
        if (content[colon] === ':' && /['"`]/.test(content[value])) {
          const valueEnd = skipString(content, value);
          const name = decodeString(content, value, valueEnd);
          if (name && !names.includes(name)) names.push(name);
          i = valueEnd;
          continue;
        }
      }
      i = propertyEnd;
      continue;
    }
    if (content[i] === '[' && objectDepth === 0) {
      // A nested top-level array is not a project object.
      i++;
      continue;
    }
    if (content[i] === ']' && objectDepth === 0) break;
    if (content[i] === '{') {
      objectDepth++;
      i++;
      continue;
    }
    if (content[i] === '}') {
      objectDepth = Math.max(0, objectDepth - 1);
      i++;
      continue;
    }
    if (objectDepth === 1 && /[A-Za-z_$]/.test(content[i])) {
      const identifierStart = i++;
      while (i < content.length && /[\w$]/.test(content[i])) i++;
      if (content.slice(identifierStart, i) !== 'name') continue;
      const colon = skipTrivia(content, i);
      if (content[colon] !== ':') continue;
      const value = skipTrivia(content, colon + 1);
      if (!/['"`]/.test(content[value])) continue;
      const end = skipString(content, value);
      const name = decodeString(content, value, end);
      if (name && !names.includes(name)) names.push(name);
      i = end;
      continue;
    }
    i++;
  }

  return names;
}

/**
 * Returns true only when every top-level project entry is an object with a
 * statically readable, unique string name. Mixed arrays such as
 * `[{ name: 'chromium' }, ...mobileProjects]` must be resolved through the
 * Playwright CLI or the picker would silently omit projects.
 */
export function isProjectListStaticallyComplete(content: string): boolean {
  const arrayStart = projectsArrayStart(content);
  if (arrayStart === undefined) return false;
  const code = maskStringsAndComments(content);
  let arrayDepth = 1;
  let objectDepth = 0;
  let parenDepth = 0;
  let entryStart = arrayStart + 1;
  let objectEntries = 0;
  let complete = true;

  const inspectEntry = (end: number) => {
    const entry = code.slice(entryStart, end).trim();
    if (!entry) return;
    if (!entry.startsWith('{')) complete = false;
    else objectEntries++;
  };

  for (let i = arrayStart + 1; i < code.length; i++) {
    const char = code[i];
    if (char === '[') arrayDepth++;
    else if (char === ']') {
      if (arrayDepth === 1 && objectDepth === 0 && parenDepth === 0) {
        inspectEntry(i);
        break;
      }
      arrayDepth = Math.max(1, arrayDepth - 1);
    } else if (char === '{') objectDepth++;
    else if (char === '}') objectDepth = Math.max(0, objectDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (
      char === ',' && arrayDepth === 1 && objectDepth === 0 && parenDepth === 0
    ) {
      inspectEntry(i);
      entryStart = i + 1;
    }
  }

  const names = extractProjectNames(content);
  return complete && objectEntries > 0 && names.length === objectEntries;
}

export function extractProjectNamesFromListReport(output: string): string[] {
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < output.length; index++) {
    const char = output[index];
    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const report = JSON.parse(output.slice(start, index + 1)) as {
          config?: { projects?: Array<{ name?: unknown }> };
        };
        const names = [...new Set(
          (report.config?.projects ?? [])
            .map(project => project.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0)
        )];
        if (names.length > 0) return names;
      } catch {
        // Ignore non-JSON log objects and keep scanning for the reporter payload.
      }
      start = -1;
    }
  }
  return [];
}
