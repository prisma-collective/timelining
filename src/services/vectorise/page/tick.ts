import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { VECTORISE_BATCH_SIZE } from '../shared/types';
import type { ScheduleHint } from '../shared/types';
import { hasTimeRemaining } from '../shared/tickUtils';
import { countPagesNeedingVectorisation, pickPagesNeedingVectorisation } from './neo4j';
import { vectorisePageStage } from './stage';
import type { PageVectoriseResult, PageVectoriseTickResult } from './types';

export async function runPageVectoriseTick(): Promise<PageVectoriseTickResult> {
  const counts = { vectorised: 0, failed: 0 };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping page vectorise tick.');
    return { status: 'skipped', message: 'Neo4j not configured.', ...counts };
  }

  try {
    const slugs = await pickPagesNeedingVectorisation(VECTORISE_BATCH_SIZE);
    if (slugs.length === 0) {
      return { status: 'success', ...counts };
    }

    const startTime = Date.now();
    for (const slug of slugs) {
      if (!hasTimeRemaining(startTime)) break;

      const result = await vectorisePageStage(slug);
      if (result === 'vectorised') counts.vectorised++;
      if (result === 'failed') counts.failed++;
    }

    logger.info('Page vectorise tick complete', counts);
    return { status: 'success', ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Page vectorise tick failed', { error: message });
    return { status: 'error', message, ...counts };
  }
}

export async function buildPageVectoriseResult(
  tick: PageVectoriseTickResult
): Promise<PageVectoriseResult> {
  const { vectorised, failed } = tick;

  if (tick.status === 'skipped') {
    return {
      status: 'skipped',
      message: tick.message,
      schedule: '15min',
      vectorised,
      failed,
      outstanding: 0,
    };
  }

  const outstanding = await safeOutstandingCount();
  const schedule: ScheduleHint = outstanding > 0 ? '30s' : '15min';

  if (tick.status === 'error') {
    return {
      status: 'error',
      message: tick.message ?? 'Page vectorise tick failed',
      schedule,
      vectorised,
      failed,
      outstanding,
    };
  }

  logger.info('Page vectorise result built', {
    vectorised,
    failed,
    outstanding,
    schedule,
  });

  return {
    status: 'success',
    schedule,
    vectorised,
    failed,
    outstanding,
  };
}

async function safeOutstandingCount(): Promise<number> {
  try {
    return await countPagesNeedingVectorisation();
  } catch {
    return 0;
  }
}
