import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { EXTERNAL_ENTRY_SOURCES, type ExternalEntrySource } from '@/lib/db/models/entry';

/**
 * One secret per source, so a leaked GitHub secret can't create entries for another source.
 * EXTERNAL_ENTRY_TOKENS="github=<secret>,enrol=<secret>"
 */
export function parseSourceTokens(raw: string | undefined): Map<ExternalEntrySource, string> {
  const tokens = new Map<ExternalEntrySource, string>();
  for (const pair of (raw ?? '').split(',')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const source = pair.slice(0, at).trim();
    const token = pair.slice(at + 1).trim();
    if (token && (EXTERNAL_ENTRY_SOURCES as readonly string[]).includes(source)) {
      tokens.set(source as ExternalEntrySource, token);
    }
  }
  return tokens;
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The source the request's Bearer token belongs to, or the error response to return. */
export function sourceForRequest(
  request: NextRequest
): { source: ExternalEntrySource } | { response: NextResponse } {
  const tokens = parseSourceTokens(process.env.EXTERNAL_ENTRY_TOKENS);
  if (tokens.size === 0) {
    logger.warn('External entry rejected: EXTERNAL_ENTRY_TOKENS not configured');
    return { response: NextResponse.json({ error: 'External entries are not configured' }, { status: 503 }) };
  }

  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  for (const [source, expected] of tokens) {
    if (token && sameToken(token, expected)) return { source };
  }

  logger.warn('External entry rejected: unknown token', { hasAuthHeader: !!header });
  return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}
