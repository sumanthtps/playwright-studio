import { readBoundedFile } from './fileSecurity';
import type { RunRecord } from './resultStore';
import type { SpecResult, TestAttachment, TestAttempt, TestAnnotation } from './resultParser';

export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_HISTORY_RECORDS = 500;
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isArrayOf<T>(value: unknown, validate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(validate);
}
function optionalFields(
  value: JsonObject,
  keys: string[],
  validate: (item: unknown) => boolean,
): boolean {
  return keys.every((key) => value[key] === undefined || validate(value[key]));
}

function isAttachment(value: unknown): value is TestAttachment {
  return (
    isObject(value) &&
    isString(value.name) &&
    optionalFields(value, ['contentType', 'path', 'body'], isString)
  );
}
function isAnnotation(value: unknown): value is TestAnnotation {
  return (
    isObject(value) && isString(value.type) && optionalFields(value, ['description'], isString)
  );
}
function isStep(value: unknown): value is TestAttempt['steps'][number] {
  return (
    isObject(value) &&
    isString(value.title) &&
    isNonnegativeNumber(value.duration) &&
    optionalFields(value, ['error'], isString)
  );
}
function isAttempt(value: unknown): value is TestAttempt {
  return (
    isObject(value) &&
    isString(value.status) &&
    isNonnegativeNumber(value.retry) &&
    isNonnegativeNumber(value.duration) &&
    optionalFields(value, ['startTime', 'error', 'output'], isString) &&
    isArrayOf(value.attachments, isAttachment) &&
    isArrayOf(value.steps, isStep)
  );
}
function isSpec(value: unknown): value is SpecResult {
  if (!isObject(value) || !isString(value.title) || !isString(value.file)) return false;
  if (
    value.file.includes('\0') ||
    !isNonnegativeNumber(value.line) ||
    !Number.isInteger(value.line) ||
    value.line > 0x7ffffffe
  )
    return false;
  if (
    !isNonnegativeNumber(value.duration) ||
    !isString(value.status) ||
    !['passed', 'failed', 'timedOut', 'skipped', 'flaky'].includes(value.status)
  )
    return false;

  return (
    optionalFields(value, ['testId', 'projectName', 'error', 'traceFile', 'output'], isString) &&
    optionalFields(value, ['titlePath', 'tags'], (items) => isArrayOf(items, isString)) &&
    optionalFields(value, ['attachments'], (items) => isArrayOf(items, isAttachment)) &&
    optionalFields(value, ['annotations'], (items) => isArrayOf(items, isAnnotation)) &&
    optionalFields(value, ['attempts'], (items) => isArrayOf(items, isAttempt))
  );
}

function parseHistoryRecord(value: unknown): RunRecord | undefined {
  if (
    !isObject(value) ||
    !isString(value.id) ||
    !isString(value.rootDir) ||
    value.rootDir.includes('\0')
  )
    return;
  if (!isObject(value.summary) || !isArrayOf(value.specs, isSpec)) return;
  const summary = value.summary;
  if (
    !['passed', 'failed', 'skipped', 'flaky', 'duration'].every((key) =>
      isNonnegativeNumber(summary[key]),
    )
  )
    return;
  if (!isString(value.capturedAt) || !isString(summary.startTime)) return;
  const capturedAt = new Date(value.capturedAt);
  const startTime = new Date(summary.startTime);
  if (!Number.isFinite(capturedAt.getTime()) || !Number.isFinite(startTime.getTime())) return;
  if (!optionalFields(value, ['errors'], (items) => isArrayOf(items, isString))) return;
  if (
    value.evidence !== undefined &&
    (!isObject(value.evidence) ||
      !optionalFields(
        value.evidence,
        ['capturedAt', 'revision', 'workspaceRoot', 'fingerprint'],
        isString,
      ))
  )
    return;

  return {
    ...value,
    workspaceRoot: isString(value.workspaceRoot) ? value.workspaceRoot : value.rootDir,
    capturedAt,
    summary: { ...summary, startTime },
  } as RunRecord;
}

/** Persisted data is still input: a damaged record must not break activation. */
export function loadRunHistory(file: string): RunRecord[] {
  try {
    const raw: unknown = JSON.parse(readBoundedFile(file, MAX_HISTORY_BYTES).toString('utf8'));
    if (!Array.isArray(raw)) return [];
    const records: RunRecord[] = [];
    for (const value of raw.slice(0, MAX_HISTORY_RECORDS)) {
      const record = parseHistoryRecord(value);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

/** Bound total storage as well as record count; keep the newest records first. */
export function boundedHistory(
  records: readonly RunRecord[],
  perRoot: number,
): { records: RunRecord[]; json: string } {
  const limit = Number.isFinite(perRoot)
    ? Math.max(1, Math.min(MAX_HISTORY_RECORDS, Math.floor(perRoot)))
    : 50;
  const counts = new Map<string, number>(),
    kept: RunRecord[] = [],
    encoded: string[] = [];
  let bytes = 2;
  for (const record of records) {
    if (kept.length >= MAX_HISTORY_RECORDS) break;
    const count = counts.get(record.workspaceRoot) ?? 0;
    if (count >= limit) continue;
    const json = JSON.stringify(record),
      size = Buffer.byteLength(json) + (encoded.length ? 1 : 0);
    if (bytes + size > MAX_HISTORY_BYTES) continue;
    bytes += size;
    counts.set(record.workspaceRoot, count + 1);
    kept.push(record);
    encoded.push(json);
  }
  return { records: kept, json: `[${encoded.join(',')}]` };
}
