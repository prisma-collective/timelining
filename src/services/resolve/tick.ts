import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { parseNonNegativeEnvInt } from '@/lib/internal-continuation';
import { dispatchOrganisingResolves } from '@/services/webhook/dispatchOrganisingResolve';
import type { ScheduleHint } from '@/services/vectorise/shared/types';
import { hasTimeRemaining } from '@/services/vectorise/shared/tickUtils';
import {
  countEntriesPendingResolve,
  countResolveStatusByStatus,
  pickEntriesPendingResolve,
} from './neo4j';
import type { ResolveEntriesResult, ResolveEntriesTickResult } from './types';

const DEFAULT_RESOLVE_BATCH_SIZE = 5;

function getResolveBatchSize(): number {
  return parseNonNegativeEnvInt('RESOLVE_BATCH_SIZE', DEFAULT_RESOLVE_BATCH_SIZE) || DEFAULT_RESOLVE_BATCH_SIZE;
}

export async function runResolveEntriesTick(): Promise<ResolveEntriesTickResult> {
  const entryIds: string[] = [];
  let attempted = 0;
  let dispatched = 0;
  let failed = 0;
  let skipped = 0;

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping resolve tick.');
    return {
      status: 'skipped',
      message: 'Neo4j not configured.',
      attempted: 0,
      dispatched: 0,
      failed: 0,
      skipped: 0,
      entryIds: [],
    };
  }

  try {
    const batchSize = getResolveBatchSize();
    const candidates = await pickEntriesPendingResolve(batchSize);

    if (candidates.length === 0) {
      logger.info('Resolve tick: no pending entries');
      return {
        status: 'success',
        attempted: 0,
        dispatched: 0,
        failed: 0,
        skipped: 0,
        entryIds: [],
      };
    }

    const startTime = Date.now();
    const toDispatch: Array<{ entryId: string; topic: string }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      if (!hasTimeRemaining(startTime, 500)) {
        skipped += candidates.length - i;
        logger.info('Resolve tick stopping early due to time budget', {
          attempted,
          skipped,
          totalCandidates: candidates.length,
        });
        break;
      }

      attempted++;
      entryIds.push(candidate.entryId);
      toDispatch.push(candidate);
    }

    const batchResult = await dispatchOrganisingResolves(toDispatch);
    dispatched = batchResult.dispatched;
    failed = batchResult.failed;
    skipped += batchResult.skipped;

    logger.info('Resolve tick complete', { attempted, dispatched, failed, skipped, entryIds });
    return { status: 'success', attempted, dispatched, failed, skipped, entryIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Resolve tick failed', { error: message });
    return {
      status: 'error',
      message,
      attempted,
      dispatched,
      failed,
      skipped,
      entryIds,
    };
  }
}

export async function buildResolveEntriesResult(
  tick: ResolveEntriesTickResult
): Promise<ResolveEntriesResult> {
  const emptyCounts = { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0 };

  if (tick.status === 'skipped') {
    return {
      status: 'skipped',
      message: tick.message,
      schedule: '15min',
      attempted: tick.attempted,
      dispatched: tick.dispatched,
      failed: tick.failed,
      skipped: tick.skipped,
      outstanding: 0,
      resolved: 0,
      attemptedInFlight: 0,
      hasMore: false,
      counts: emptyCounts,
    };
  }

  const [outstanding, counts] = await Promise.all([
    safeOutstandingCount(),
    safeStatusCounts(),
  ]);

  const schedule: ScheduleHint = outstanding > 0 ? '30s' : '15min';

  if (tick.status === 'error') {
    return {
      status: 'error',
      message: tick.message ?? 'Resolve tick failed',
      schedule,
      attempted: tick.attempted,
      dispatched: tick.dispatched,
      failed: counts.failed,
      skipped: tick.skipped,
      outstanding,
      resolved: counts.successful,
      attemptedInFlight: counts.attempted,
      hasMore: outstanding > 0,
      counts,
    };
  }

  logger.info('Resolve result built', {
    attempted: tick.attempted,
    dispatched: tick.dispatched,
    failed: tick.failed,
    outstanding,
    counts,
  });

  return {
    status: 'success',
    schedule,
    attempted: tick.attempted,
    dispatched: tick.dispatched,
    failed: counts.failed,
    skipped: tick.skipped,
    outstanding,
    resolved: counts.successful,
    attemptedInFlight: counts.attempted,
    hasMore: outstanding > 0,
    counts,
  };
}

async function safeOutstandingCount(): Promise<number> {
  try {
    return await countEntriesPendingResolve();
  } catch {
    return 0;
  }
}

async function safeStatusCounts() {
  try {
    return await countResolveStatusByStatus();
  } catch {
    return { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0 };
  }
}
