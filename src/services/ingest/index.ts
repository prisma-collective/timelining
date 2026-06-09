import { INGEST_BACKLOG_QUEUE } from '@organising-config';
import { logger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { TelegramMessage } from '../../lib/telegram';
import { writeEntry } from './process';
import { isNeo4jAvailable } from '../../lib/db/neo4j';

const BATCH_SIZE = 10;
const EXECUTION_TIMEOUT = 8000;

export interface IngestResult {
  status: string;
  message?: string;
  processed_count?: number;
  remaining_count?: number;
}

/**
 * Processes messages from the ingest backlog queue into Neo4j.
 */
export async function runIngest(): Promise<IngestResult> {
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
    for (let i = 0; i < BATCH_SIZE; i++) {
      if (Date.now() - startTime > EXECUTION_TIMEOUT) {
        logger.info('Approaching execution timeout, stopping ingest batch');
        break;
      }

      const message = await redis.lpop(INGEST_BACKLOG_QUEUE);

      if (!message) {
        logger.info('No message received from ingest backlog.');
        break;
      }

      const messageData = message as TelegramMessage;

      try {
        const recordId = await writeEntry(messageData);

        if (recordId) {
          logger.info('Wrote message metadata to db');
          processedCount++;
          lastFailedMessage = undefined;
        } else {
          failedCount++;
          await redis.rpush(INGEST_BACKLOG_QUEUE, message);
        }
      } catch (err) {
        logger.error('Unexpected error during ingest:', { error: err });
        failedCount++;

        if (lastFailedMessage === messageData.message?.message_id) {
          logger.warn('Detected repeated failure on same message. Stopping ingest to avoid loop.');
          await redis.rpush(INGEST_BACKLOG_QUEUE, message);
          break;
        }

        lastFailedMessage = messageData.message?.message_id;
        await redis.rpush(INGEST_BACKLOG_QUEUE, message);
      }
    }

    const remainingCount = await redis.llen(INGEST_BACKLOG_QUEUE);

    logger.info('Ingest queue status:', {
      remainingCount,
      currentProcessed: processedCount,
      failed: failedCount,
    });

    return {
      status: 'success',
      message: `Processed ${processedCount} messages, ${failedCount} failed`,
      processed_count: processedCount,
      remaining_count: remainingCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Ingest execution failed:', { error: errorMessage });

    return {
      status: 'error',
      message: errorMessage,
      processed_count: processedCount,
    };
  }
}
