import { after, NextRequest, NextResponse } from 'next/server';
import { INGEST_EXTERNAL_QUEUE } from '@organising-config';
import { sourceForRequest } from '@/lib/external-auth';
import { dispatchInternalRoute, originFromRequest } from '@/lib/internal-dispatch';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { parseExternalEnvelope } from '@/services/external/envelope';

/**
 * Entries that don't come from Telegram (D13). The caller's token picks its source.
 * The entry is queued and written by /api/entries/external/ingest, like Telegram messages are.
 */
export async function POST(request: NextRequest) {
  const auth = sourceForRequest(request);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = parseExternalEnvelope(body, auth.source);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await redis.lpush(INGEST_EXTERNAL_QUEUE, JSON.stringify(parsed.envelope));
  logger.info('External entry queued', {
    source: parsed.envelope.source,
    externalId: parsed.envelope.externalId,
    topic: parsed.envelope.topic,
  });

  const origin = originFromRequest(request);
  after(() => dispatchInternalRoute(origin, '/api/entries/external/ingest?limit=1', { chain: true }));

  return NextResponse.json({ status: 'queued' }, { status: 202 });
}
