import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export function insideDirectory(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Report contents must never grant access to additional filesystem roots. */
export function readableFileInRoots(file: string, roots: readonly string[]): string | undefined {
  if (!path.isAbsolute(file) || file.includes('\0')) return undefined;
  try {
    const real = fs.realpathSync(file);
    if (!fs.statSync(real).isFile()) return undefined;
    return roots.some((root) => {
      try {
        return insideDirectory(fs.realpathSync(root), real);
      } catch {
        return false;
      }
    })
      ? real
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reject devices/FIFOs and bound allocation before reading an imported file. */
export function readBoundedFile(file: string, maxBytes: number): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid file size limit.');
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Only regular files can be imported.');
    if (stat.size > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte size limit.`);
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > stat.size) throw new Error('File changed while reading; try again.');
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

/** Replace the directory entry, never a symlink/hardlink target. */
export function atomicWriteFile(file: string, contents: string): void {
  const temporary = path.join(path.dirname(file), `.playwright-studio-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Config edits must not follow pre-planted temporary files or linked targets. */
export function replaceReviewedFile(file: string, original: string, replacement: string): void {
  const resolved = readableFileInRoots(file, [path.dirname(file)]);
  if (!resolved)
    throw new Error('Configuration resolves outside its directory or is not a regular file.');
  if (readBoundedFile(resolved, 4 * 1024 * 1024).toString('utf8') !== original) {
    throw new Error('Configuration changed since review. Retry the setup action.');
  }
  const temporary = path.join(path.dirname(resolved), `.playwright-studio-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, replacement, {
      flag: 'wx',
      mode: fs.statSync(resolved).mode & 0o777,
    });
    fs.renameSync(temporary, resolved);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
