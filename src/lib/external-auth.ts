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

/**
 * Checks the request's Bearer token against this source's token. Returns the error
 * response, or null when the token is the source's own. A token for another source
 * is refused: each route takes entries for one source only.
 */
export function authorizeSource(request: NextRequest, source: ExternalEntrySource): NextResponse | null {
  const expected = parseSourceTokens(process.env.EXTERNAL_ENTRY_TOKENS).get(source);
  if (!expected) {
    logger.warn('Entry rejected: no token configured for this source', { source });
    return NextResponse.json({ error: `Entries from ${source} are not configured` }, { status: 503 });
  }

  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token && sameToken(token, expected)) return null;

  logger.warn('Entry rejected: wrong token', { source, hasAuthHeader: !!header });
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
