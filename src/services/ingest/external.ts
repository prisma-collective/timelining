import { INGEST_EXTERNAL_FAILED_QUEUE, INGEST_EXTERNAL_QUEUE } from '@organising-config';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { parseRedisJson, redisJsonToString } from '@/lib/redis-json';
import type { ExternalEntryEnvelope } from '@/services/external/envelope';
import { createExternalEntry } from '@/services/externalEntryService';
import { triggerResolve } from '@/services/resolve';

const BATCH_SIZE = 10;
const EXECUTION_TIMEOUT = 8000;

export interface ExternalIngestResult {
  status: 'success' | 'skipped';
  processed_count: number;
  failed_count: number;
  remaining_count: number;
}

/**
 * Drains the external entry queue into Neo4j. A new entry with text goes to its topic's resolver,
 * as a Telegram entry does; a resend is stored once and not resolved again.
 * An entry that fails to write moves to the external failed queue, with the error.
 */
export async function runExternalIngest(options: { limit?: number } = {}): Promise<ExternalIngestResult> {
  const limit = options.limit ?? BATCH_SIZE;
  const startTime = Date.now();

  if (!(await isNeo4jAvailable())) {
    const remaining = await redis.llen(INGEST_EXTERNAL_QUEUE);
    logger.warn(`Neo4j not available. Skipping external ingest. ${remaining} entries queued.`);
    return { status: 'skipped', processed_count: 0, failed_count: 0, remaining_count: remaining };
  }

  let processed = 0;
  let failed = 0;
  for (let i = 0; i < limit && Date.now() - startTime < EXECUTION_TIMEOUT; i++) {
    const item = await redis.rpop(INGEST_EXTERNAL_QUEUE);
    if (!item) break;

    const raw = redisJsonToString(item);
    try {
      const envelope = parseRedisJson<ExternalEntryEnvelope>(item);
      const { id, created } = await createExternalEntry(envelope);
      if (created && envelope.text) {
        await triggerResolve(id, envelope.topic, { source: 'text' });
      }
      processed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('External entry ingest failed', { error: message });
      await redis.lpush(INGEST_EXTERNAL_FAILED_QUEUE, JSON.stringify({ raw, error: message, failedAt: new Date().toISOString() }));
    }
  }

  return {
    status: 'success',
    processed_count: processed,
    failed_count: failed,
    remaining_count: await redis.llen(INGEST_EXTERNAL_QUEUE),
  };
}
