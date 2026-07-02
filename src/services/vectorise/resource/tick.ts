import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import type { ScheduleHint } from '../shared/types';
import { countOutstanding, countPipelineByStatus } from './neo4j';
import { runResourceVectoriseTick } from './runAll';
import type { ResourceVectoriseResult } from './types';

export async function buildResourceVectoriseResult(
  run: Awaited<ReturnType<typeof runResourceVectoriseTick>>
): Promise<ResourceVectoriseResult> {
  const { chunked, vectorised, failed } = run;
  const outstanding = await safeOutstandingCount();
  const pipeline = await safePipelineCounts();
  const schedule: ScheduleHint = outstanding > 0 ? '30s' : '15min';

  logger.info('Resource vectorise run complete', {
    chunked,
    vectorised,
    failed,
    outstanding,
    schedule,
  });

  return {
    status: 'success',
    schedule,
    chunked,
    vectorised,
    failed,
    outstanding,
    pipeline,
    hasMore: outstanding > 0,
  };
}

export async function runResourceVectoriseWithAvailabilityCheck(
  options: Parameters<typeof runResourceVectoriseTick>[0] = {}
) {
  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping resource vectorise run.');
    return {
      status: 'skipped' as const,
      message: 'Neo4j not configured.',
      chunked: 0,
      vectorised: 0,
      failed: 0,
    };
  }

  return runResourceVectoriseTick(options);
}

async function safePipelineCounts() {
  try {
    return await countPipelineByStatus();
  } catch {
    return { pending: 0, transcribed: 0, chunked: 0, vectorised: 0, failed: 0 };
  }
}

async function safeOutstandingCount() {
  try {
    return await countOutstanding();
  } catch {
    return 0;
  }
}
