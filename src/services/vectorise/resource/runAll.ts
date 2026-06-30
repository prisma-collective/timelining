import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import type { VectoriseStageResult } from '../shared/types';
import { pickResourceIdsByStatus } from './neo4j';
import { transcribeStage } from './transcribe';
import { vectoriseStage } from './stage';
import { RESOURCE_VECTORISE_BATCH_SIZE, type RunAllResourceVectorisationResult } from './types';

const DEFAULT_PICK_BATCH = 200;

export interface RunAllResourceVectorisationOptions {
  pickBatchSize?: number;
  onProgress?: (resourceId: string, stage: 'transcribe' | 'vectorise', result: VectoriseStageResult | string) => void;
}

export async function runAllResourceVectorisation(
  options: RunAllResourceVectorisationOptions = {}
): Promise<RunAllResourceVectorisationResult> {
  const pickBatchSize = options.pickBatchSize ?? DEFAULT_PICK_BATCH;
  const counts = { transcribed: 0, vectorised: 0, failed: 0, rounds: 0 };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping resource vectorise run.');
    return counts;
  }

  while (true) {
    const pendingIds = await pickResourceIdsByStatus('pending', pickBatchSize);
    if (pendingIds.length === 0) {
      break;
    }

    counts.rounds += 1;
    logger.info('Resource transcribe batch', { round: counts.rounds, count: pendingIds.length });

    for (const resourceId of pendingIds) {
      const result = await transcribeStage(resourceId);
      options.onProgress?.(resourceId, 'transcribe', result);
      if (result === 'transcribed') counts.transcribed += 1;
      else if (result === 'failed') counts.failed += 1;
    }
  }

  while (true) {
    const transcribedIds = await pickResourceIdsByStatus('transcribed', pickBatchSize);
    if (transcribedIds.length === 0) {
      break;
    }

    counts.rounds += 1;
    logger.info('Resource vectorise batch', { round: counts.rounds, count: transcribedIds.length });

    for (const resourceId of transcribedIds) {
      const result = await vectoriseStage(resourceId);
      options.onProgress?.(resourceId, 'vectorise', result);
      if (result === 'vectorised') counts.vectorised += 1;
      else if (result === 'failed') counts.failed += 1;
    }
  }

  return counts;
}

export async function runResourceVectoriseTick(): Promise<RunAllResourceVectorisationResult> {
  return runAllResourceVectorisation({ pickBatchSize: RESOURCE_VECTORISE_BATCH_SIZE });
}
