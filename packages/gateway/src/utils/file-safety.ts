import { isAbsolute, relative, resolve, sep } from 'node:path';

export function getLeafName(value: string, fallback = 'unknown'): string {
  return value.replace(/\\/g, '/').split('/').pop() || fallback;
}

export function sanitizeFilenameSegment(
  value: unknown,
  options: { fallback?: string; lowerCase?: boolean; maxLength?: number } = {}
): string {
  const { fallback = 'file', lowerCase = false, maxLength = 80 } = options;
  const input = String(value ?? '');
  const normalized = lowerCase ? input.toLowerCase() : input;
  const sanitized = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, maxLength);

  return sanitized || fallback;
}

export function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const rel = relative(resolve(baseDir), resolve(targetPath));
  return rel === '' || (!!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function normalizeArchiveEntryPath(entryName: string): string | null {
  const unified = entryName.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:($|\/)/.test(unified)) {
    return null;
  }

  const normalized = unified.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    return null;
  }

  return normalized;
}

export function attachmentDisposition(filename: string): string {
  const safeFilename = sanitizeFilenameSegment(getLeafName(filename), {
    fallback: 'download',
    maxLength: 120,
  });
  return `attachment; filename="${safeFilename}"`;
}
