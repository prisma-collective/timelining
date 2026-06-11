import { INGEST_BACKLOG_QUEUE } from '@organising-config';
import { logger } from '../../lib/logger';
import { parseRedisJson, redisJsonToString } from '../../lib/redis-json';
import { redis } from '../../lib/redis';
import { TelegramMessage } from '../../lib/telegram';
import { pushIngestFailed, popIngestFailed } from '@/services/pipeline/failed-queue';
import { writeEntry } from './process';
import { isNeo4jAvailable } from '../../lib/db/neo4j';

const BATCH_SIZE = 10;
const EXECUTION_TIMEOUT = 8000;

export type IngestMode = 'chain' | 'retry' | 'batch';

export interface IngestResult {
  status: string;
  message?: string;
  processed_count?: number;
  remaining_count?: number;
  failed_count?: number;
}

export interface RunIngestOptions {
  origin?: string;
  limit?: number;
  mode?: IngestMode;
}

async function processMessage(
  messageData: TelegramMessage,
  raw: string,
  origin: string | undefined
): Promise<void> {
  const recordId = await writeEntry(messageData, origin);
  if (!recordId) {
    throw new Error('writeEntry returned no id');
  }
  logger.info('Wrote message metadata to db');
}

/**
 * Processes messages from the ingest backlog queue into Neo4j.
 */
export async function runIngest(options: RunIngestOptions = {}): Promise<IngestResult> {
  const mode = options.mode ?? 'batch';
  const limit = options.limit ?? (mode === 'chain' ? 1 : BATCH_SIZE);
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;
  let lastFailedMessage: number | undefined;

  const neo4jReady = await isNeo4jAvailable();

  if (!neo4jReady) {
    const remainingCount = await redis.llen(INGEST_BACKLOG_QUEUE);
    logger.warn(`Neo4j not available. Skipping ingest. ${remainingCount} messages queued.`);

    return {
      status: 'skipped',
      message: 'Neo4j not configured. Messages remain in queue for later processing.',
      processed_count: 0,
      remaining_count: remainingCount,
    };
  }

  try {
    for (let i = 0; i < limit; i++) {
      if (Date.now() - startTime > EXECUTION_TIMEOUT) {
        logger.info('Approaching execution timeout, stopping ingest batch');
        break;
      }

      let raw: string | null = null;
      let messageData: TelegramMessage;

      if (mode === 'retry') {
        const failedRecord = await popIngestFailed();
        if (failedRecord) {
          raw = failedRecord.raw;
          messageData = parseRedisJson<TelegramMessage>(failedRecord.raw);
        } else {
          const backlogMessage = await redis.lpop(INGEST_BACKLOG_QUEUE);
          if (!backlogMessage) {
            if (processedCount === 0 && failedCount === 0) {
              logger.info('No messages in ingest failed queue or backlog.');
            }
            break;
          }
          raw = redisJsonToString(backlogMessage);
          messageData = parseRedisJson<TelegramMessage>(backlogMessage);
        }
      } else {
        const message = await redis.lpop(INGEST_BACKLOG_QUEUE);
        if (!message) {
          logger.info('No message received from ingest backlog.');
          break;
        }
        raw = redisJsonToString(message);
        messageData = parseRedisJson<TelegramMessage>(message);
      }

      try {
        await processMessage(messageData, raw, options.origin);
        processedCount++;
        lastFailedMessage = undefined;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Unexpected error during ingest:', { error: err });
        failedCount++;

        const messageId = messageData.message?.message_id;
        if (lastFailedMessage === messageId) {
          logger.warn('Detected repeated failure on same message. Moving to failed queue.');
          await pushIngestFailed(raw, errorMessage, messageId);
          break;
        }

        lastFailedMessage = messageId;
        await pushIngestFailed(raw, errorMessage, messageId);
      }
    }

    const remainingCount = await redis.llen(INGEST_BACKLOG_QUEUE);

    logger.info('Ingest queue status:', {
      mode,
      remainingCount,
      currentProcessed: processedCount,
      failed: failedCount,
    });

    return {
      status: 'success',
      message: `Processed ${processedCount} messages, ${failedCount} failed`,
      processed_count: processedCount,
      failed_count: failedCount,
      remaining_count: remainingCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Ingest execution failed:', { error: errorMessage });

    return {
      status: 'error',
      message: errorMessage,
      processed_count: processedCount,
      failed_count: failedCount,
    };
  }
}
