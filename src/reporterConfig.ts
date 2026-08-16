interface ReporterProperty {
  valueStart: number;
}

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
    if (/\s/.test(content[i])) {
      i++;
    } else if (content.startsWith('//', i)) {
      i = content.indexOf('\n', i + 2);
      if (i < 0) return content.length;
    } else if (content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      if (end < 0) return content.length;
      i = end + 2;
    } else {
      break;
    }
  }
  return i;
}

function findReporterProperty(content: string): ReporterProperty | undefined {
  const candidates: Array<ReporterProperty & { depth: number }> = [];
  let depth = 0;

  for (let i = 0; i < content.length;) {
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
      i = skipString(content, i);
      continue;
    }
    if (content[i] === '{') {
      depth++;
      i++;
      continue;
    }
    if (content[i] === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(content[i])) {
      const start = i++;
      while (i < content.length && /[\w$]/.test(content[i])) i++;
      if (content.slice(start, i) !== 'reporter') continue;
      const colon = skipTrivia(content, i);
      if (content[colon] !== ':') continue;
      candidates.push({ valueStart: skipTrivia(content, colon + 1), depth });
      continue;
    }
    i++;
  }

  const configOpen = configObjectOpen(content);
  if (configOpen !== undefined) {
    const code = maskStringsAndComments(content.slice(0, configOpen + 1));
    const configClose = matchingBracket(content, configOpen) ?? content.length;
    let configDepth = 0;
    for (const char of code) {
      if (char === '{') configDepth++;
      else if (char === '}') configDepth--;
    }
    return candidates.find(candidate =>
      candidate.depth === configDepth &&
      candidate.valueStart > configOpen &&
      candidate.valueStart < configClose
    );
  }
  return candidates.sort((left, right) => left.depth - right.depth)[0];
}

function matchingBracket(content: string, start: number): number | undefined {
  const opening = content[start];
  const closing = opening === '[' ? ']' : opening === '{' ? '}' : undefined;
  if (!closing) return undefined;
  let depth = 0;
  for (let i = start; i < content.length;) {
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
      i = skipString(content, i);
      continue;
    }
    if (content[i] === opening) depth++;
    if (content[i] === closing && --depth === 0) return i;
    i++;
  }
  return undefined;
}

function reporterValueEnd(content: string, start: number): number | undefined {
  if (/['"`]/.test(content[start])) return skipString(content, start);
  if (content[start] === '[') {
    const end = matchingBracket(content, start);
    return end === undefined ? undefined : end + 1;
  }
  return undefined;
}

function reporterNames(content: string, start: number, end: number): string[] {
  if (/['"`]/.test(content[start])) {
    return [content.slice(start + 1, end - 1).replace(/\\(['"`\\])/g, '$1')];
  }

  const values: string[] = [];
  let arrayDepth = 0;
  let tupleNeedsName = false;
  for (let i = start; i < end;) {
    if (content.startsWith('//', i)) {
      const commentEnd = content.indexOf('\n', i + 2);
      i = commentEnd < 0 ? end : commentEnd + 1;
    } else if (content.startsWith('/*', i)) {
      const commentEnd = content.indexOf('*/', i + 2);
      i = commentEnd < 0 ? end : commentEnd + 2;
    } else if (/['"`]/.test(content[i])) {
      const tokenEnd = skipString(content, i);
      const raw = content.slice(i + 1, Math.max(i + 1, tokenEnd - 1));
      if (arrayDepth === 1 || (arrayDepth === 2 && tupleNeedsName)) {
        values.push(raw.replace(/\\(['"`\\])/g, '$1'));
      }
      tupleNeedsName = false;
      i = tokenEnd;
    } else if (content[i] === '[') {
      if (arrayDepth === 1) tupleNeedsName = true;
      arrayDepth++;
      i++;
    } else if (content[i] === ']') {
      arrayDepth = Math.max(0, arrayDepth - 1);
      tupleNeedsName = false;
      i++;
    } else {
      if (arrayDepth === 2 && !/[\s,]/.test(content[i])) tupleNeedsName = false;
      i++;
    }
  }
  return values;
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

function configObjectOpen(content: string): number | undefined {
  const code = maskStringsAndComments(content);
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

function propertyIndent(content: string, position: number): string {
  const lineStart = content.lastIndexOf('\n', position) + 1;
  return /^\s*/.exec(content.slice(lineStart, position))?.[0] ?? '';
}

export function hasJsonReporterText(content: string): boolean {
  const property = findReporterProperty(content);
  if (!property) return false;
  const end = reporterValueEnd(content, property.valueStart);
  if (end === undefined) return false;
  return reporterNames(content, property.valueStart, end).includes('json');
}

export function injectJsonReporterText(content: string): string | null {
  if (hasJsonReporterText(content)) return content;
  const property = findReporterProperty(content);

  if (!property) {
    const open = configObjectOpen(content);
    if (open === undefined) return null;
    const indent = `${propertyIndent(content, open)}  `;
    return `${content.slice(0, open + 1)}\n${indent}reporter: [['json']],${content.slice(open + 1)}`;
  }

  const start = property.valueStart;
  if (content[start] === '[') {
    const indent = `${propertyIndent(content, start)}  `;
    return `${content.slice(0, start + 1)}\n${indent}['json'],${content.slice(start + 1)}`;
  }

  if (/['"`]/.test(content[start])) {
    const end = reporterValueEnd(content, start);
    if (end === undefined) return null;
    const literal = content.slice(start, end);
    return `${content.slice(0, start)}[[${literal}], ['json']]${content.slice(end)}`;
  }

  return null;
}
