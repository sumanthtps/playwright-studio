import * as fs from 'fs';
import { inflateRawSync } from 'zlib';
import { readBoundedFile } from '../fileSecurity';
export interface TraceSummary {
  requests: {
    url: string;
    method: string;
    status: number;
  }[];
  errors: string[];
  failedActions: string[];
  note?: string;
}
/** Read a bounded subset of a ZIP in memory. No archive paths are extracted. */
export function traceSummary(file: string): TraceSummary {
  const result: TraceSummary = { requests: [], errors: [], failedActions: [] };
  try {
    if (fs.statSync(file).size > 64 * 1024 * 1024)
      return { ...result, note: 'Trace exceeds the 64 MB analysis limit; open Trace Viewer.' };
    const zip = readBoundedFile(file, 64 * 1024 * 1024);
    let end = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
      if (zip.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0) throw new Error('ZIP directory not found');
    const count = zip.readUInt16LE(end + 10);
    if (count > 4000) throw new Error('Too many archive entries');
    let cursor = zip.readUInt32LE(end + 16),
      expanded = 0;
    for (let entry = 0; entry < count; entry++) {
      if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
      const flags = zip.readUInt16LE(cursor + 8),
        method = zip.readUInt16LE(cursor + 10),
        compressed = zip.readUInt32LE(cursor + 20),
        size = zip.readUInt32LE(cursor + 24);
      const nameLength = zip.readUInt16LE(cursor + 28),
        extraLength = zip.readUInt16LE(cursor + 30),
        commentLength = zip.readUInt16LE(cursor + 32),
        offset = zip.readUInt32LE(cursor + 42);
      const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      cursor += 46 + nameLength + extraLength + commentLength;
      if (!/\.(trace|network)$/.test(name)) continue;
      if (flags & 1 || ![0, 8].includes(method))
        throw new Error('Unsupported trace archive encoding');
      expanded += size;
      if (expanded > 16 * 1024 * 1024) throw new Error('Trace event data exceeds 16 MB');
      if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP entry');
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + compressed);
      const body =
        method === 8 ? inflateRawSync(data, { maxOutputLength: Math.max(1, size) }) : data;
      if (body.length !== size) throw new Error('Trace entry size mismatch');
      for (const line of body.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const resource = event.snapshot ?? event;
          if (resource.request?.url && Number.isFinite(resource.response?.status))
            result.requests.push({
              url: resource.request.url,
              method: resource.request.method ?? 'GET',
              status: resource.response.status,
            });
          if (event.type === 'after' && event.error)
            result.failedActions.push(String(event.error.message ?? event.error));
          if (event.type === 'event' && event.method === 'pageError')
            result.errors.push(String(event.params?.error?.message ?? 'Page error'));
          if (event.type === 'console' && event.messageType === 'error')
            result.errors.push(String(event.text ?? 'Console error'));
        } catch {
          /* Version-specific or incomplete records are not interpreted. */
        }
      }
    }
    if (!result.requests.length && !result.failedActions.length && !result.errors.length)
      result.note = 'No supported network/error events found. Inspect the trace manually.';
  } catch (error) {
    result.note = `Trace analysis unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return result;
}
