import type { LogDrainEntry, LogDrainProcessResult } from '@/lib/db/models/page';
import { logger } from '@/lib/logger';
import { recordDocsPageView } from './pageService';

const LOCALE_PREFIX = /^(en|es|pt)(\/|$)/;

const SKIP_PREFIXES = ['_next/', 'api/', 'favicon', 'robots.txt', 'sitemap'];

/** Map a request path to a docs content slug, or null if not a docs page path. */
export function pathToSlug(path: string): string | null {
  let normalized = path.trim();
  if (!normalized) {
    return null;
  }

  try {
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    return null;
  }

  normalized = normalized.replace(/\?.*$/, '').replace(/#.*$/, '');
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.replace(/\/$/, '');

  const lower = normalized.toLowerCase();
  for (const prefix of SKIP_PREFIXES) {
    if (lower.startsWith(prefix) || lower === prefix.replace(/\/$/, '')) {
      return null;
    }
  }

  if (!LOCALE_PREFIX.test(normalized)) {
    return null;
  }

  // Require content path after locale (e.g. en/concepts/foo, not bare en)
  if (normalized.split('/').length < 2) {
    return null;
  }

  return normalized;
}

function extractPath(entry: LogDrainEntry): string | null {
  if (typeof entry.path === 'string' && entry.path) {
    return entry.path;
  }

  if (typeof entry.url === 'string' && entry.url) {
    return entry.url;
  }

  if (typeof entry.message === 'string') {
    const pathMatch = entry.message.match(
      /(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/[^\s"']+)/
    );
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    const quotedPath = entry.message.match(/"(\/(?:en|es|pt)[^"]*)"/);
    if (quotedPath?.[1]) {
      return quotedPath[1];
    }
  }

  return null;
}

function extractTimestamp(entry: LogDrainEntry): string {
  if (typeof entry.timestamp === 'string' && entry.timestamp) {
    return entry.timestamp;
  }
  return new Date().toISOString();
}

export async function processLogDrain(
  body: unknown
): Promise<LogDrainProcessResult> {
  if (!Array.isArray(body)) {
    throw new Error('Invalid log format: expected JSON array');
  }

  const result: LogDrainProcessResult = {
    processed: 0,
    recorded: 0,
    skipped: 0,
  };

  for (const item of body) {
    if (!item || typeof item !== 'object') {
      result.skipped += 1;
      continue;
    }

    const entry = item as LogDrainEntry;
    const rawPath = extractPath(entry);
    if (!rawPath) {
      result.skipped += 1;
      continue;
    }

    const slug = pathToSlug(rawPath);
    if (!slug) {
      result.skipped += 1;
      continue;
    }

    result.processed += 1;

    const recorded = await recordDocsPageView({
      slug,
      timestamp: extractTimestamp(entry),
    });

    if (recorded) {
      result.recorded += 1;
    } else {
      result.skipped += 1;
    }
  }

  logger.info('Log drain processed', result);
  return result;
}
