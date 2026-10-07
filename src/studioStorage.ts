import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getResultsBaseDir } from './resultsPath';

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function resolvedPath(file: string): string {
  let existing = path.resolve(file);
  const suffix: string[] = [];
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Studio storage location is unavailable.');
    // A dangling symlink must never be treated as a missing directory.
    try {
      if (fs.lstatSync(existing).isSymbolicLink())
        throw new Error('Studio storage contains an unresolved symlink.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...suffix);
}

/** Enumerate ordinary files only; never follow links while moving private workspace data. */
export function studioFiles(directory: string): { relative: string; content: Buffer }[] {
  const files: { relative: string; content: Buffer }[] = [];
  let count = 0,
    bytes = 0;
  const visit = (folder: string) => {
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        'Studio data contains a symlink or unsupported file. Move it to a regular local folder first.',
      );
    for (const name of fs.readdirSync(folder)) {
      if (++count > 5000) throw new Error('Studio data exceeds the 5,000-file migration limit.');
      const file = path.join(folder, name),
        info = fs.lstatSync(file);
      if (info.isDirectory() && !info.isSymbolicLink()) visit(file);
      else if (info.isFile() && !info.isSymbolicLink()) {
        bytes += info.size;
        if (info.size > 16 * 1024 * 1024 || bytes > 100 * 1024 * 1024)
          throw new Error('Studio data exceeds the local storage migration size limit.');
        const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const current = fs.fstatSync(fd);
          if (!current.isFile() || current.size !== info.size || current.ino !== info.ino)
            throw new Error('Studio data changed while it was being read. Try again.');
          const content = Buffer.alloc(current.size);
          let read = 0;
          while (read < content.length) {
            const length = fs.readSync(fd, content, read, content.length - read, read);
            if (!length) throw new Error('Studio data changed while it was being read. Try again.');
            read += length;
          }
          files.push({ relative: path.relative(directory, file), content });
        } finally {
          fs.closeSync(fd);
        }
      } else
        throw new Error(
          'Studio data contains a symlink or unsupported file. Move it to a regular local folder first.',
        );
    }
  };
  if (fs.existsSync(directory)) visit(directory);
  else {
    try {
      fs.lstatSync(directory);
      throw new Error('Studio data contains an unresolved symlink.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return files;
}

/** Local configs and helper scripts live outside the repository, without Git ignore changes. */
export function studioDirectory(root: string, storageRoot = getResultsBaseDir()): string {
  const project = resolvedPath(root);
  const storage = resolvedPath(storageRoot || getResultsBaseDir());
  if (within(project, storage))
    throw new Error('Studio storage must be outside the project folder.');
  const key = createHash('sha256').update(project).digest('hex').slice(0, 24);
  const directory = path.join(storage, 'studio-workspaces', key, '.playwright-studio');
  const actual = resolvedPath(directory);
  if (!within(storage, actual) || within(project, actual))
    throw new Error('Studio storage follows a link outside its managed location.');
  const legacy = path.join(project, '.playwright-studio');
  const files = studioFiles(legacy);
  if (!files.length && !fs.existsSync(legacy)) return directory;
  const existing = new Map(studioFiles(directory).map((file) => [file.relative, file.content]));
  // Check every conflict before removing any legacy file. Neither copy is overwritten.
  for (const file of files) {
    const prior = existing.get(file.relative);
    if (prior && !prior.equals(file.content))
      throw new Error(
        `Studio storage migration found conflicting copies of ${file.relative}. Both copies have been preserved. Resolve the conflict and reopen Studio.`,
      );
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const target = path.join(directory, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (!existing.has(file.relative))
      fs.writeFileSync(target, file.content, { flag: 'wx', mode: 0o600 });
  }
  const copied = new Map(studioFiles(directory).map((file) => [file.relative, file.content]));
  const current = studioFiles(legacy);
  if (
    current.length !== files.length ||
    current.some((file) => !copied.get(file.relative)?.equals(file.content))
  )
    throw new Error(
      'Studio data changed during migration. Both copies have been preserved; try again.',
    );
  for (const file of current) fs.unlinkSync(path.join(legacy, file.relative));
  const removeEmpty = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink())
        removeEmpty(path.join(folder, entry.name));
    }
    // rmdir deliberately refuses to delete anything added during migration.
    fs.rmdirSync(folder);
  };
  removeEmpty(legacy);
  return directory;
}

export function studioFile(
  root: string,
  relative: string,
  storageRoot = getResultsBaseDir(),
): string {
  const directory = studioDirectory(root, storageRoot);
  const file = path.resolve(directory, relative);
  if (!relative || !within(directory, file) || !within(resolvedPath(directory), resolvedPath(file)))
    throw new Error('Studio file escapes local storage.');
  return file;
}
