import { after, NextRequest, NextResponse } from 'next/server';
import { INGEST_EXTERNAL_QUEUE } from '@organising-config';
import { authorizeSource } from '@/lib/external-auth';
import { dispatchInternalRoute, originFromRequest } from '@/lib/internal-dispatch';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import type { ExternalEntrySource } from '@/lib/db/models/entry';
import { parseExternalEnvelope } from '@/services/external/envelope';

/**
 * Takes one entry from a source other than Telegram (D13). Each source has its own
 * route, like Telegram's /api/story/webhook, and they all end here: same envelope,
 * same queue, same worker (/api/entries/ingest), so every entry is stored and
 * deduplicated the same way.
 */
export async function receiveEntry(request: NextRequest, source: ExternalEntrySource) {
  const authError = authorizeSource(request, source);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = parseExternalEnvelope(body, source);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await redis.lpush(INGEST_EXTERNAL_QUEUE, JSON.stringify(parsed.envelope));
  logger.info('Entry queued', {
    source: parsed.envelope.source,
    externalId: parsed.envelope.externalId,
    topic: parsed.envelope.topic,
  });

  const origin = originFromRequest(request);
  after(() => dispatchInternalRoute(origin, '/api/entries/ingest?limit=1', { chain: true }));

  return NextResponse.json({ status: 'queued' }, { status: 202 });
}
