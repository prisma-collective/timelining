import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { chunkStage } from './chunk';
import { embedStage } from './stage';
import { pickResourceIdsByStatus } from './neo4j';
import type { ResourceVectoriseTickResult } from './types';

export interface RunResourceVectoriseTickOptions {
  resourceId?: string;
  stage?: 'chunk' | 'embed' | 'auto';
}

export async function runResourceVectoriseTick(
  options: RunResourceVectoriseTickOptions = {}
): Promise<ResourceVectoriseTickResult> {
  const counts = { chunked: 0, vectorised: 0, failed: 0, chainResourceId: undefined as string | undefined };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping resource vectorise tick.');
    return { status: 'skipped', message: 'Neo4j not configured.', ...counts };
  }

  try {
    if (options.resourceId && options.stage === 'chunk') {
      const result = await chunkStage(options.resourceId);
      if (result === 'chunked') counts.chunked += 1;
      if (result === 'failed') counts.failed += 1;
      return { status: 'success', ...counts };
    }

    if (options.resourceId && options.stage === 'embed') {
      const result = await embedStage(options.resourceId, { startTime: Date.now() });
      if (result === 'vectorised') counts.vectorised += 1;
      if (result === 'partial') {
        counts.chainResourceId = options.resourceId;
      }
      if (result === 'failed') counts.failed += 1;
      return { status: 'success', ...counts };
    }

    const transcribedIds = await pickResourceIdsByStatus('transcribed', 1);
    if (transcribedIds.length > 0) {
      const resourceId = transcribedIds[0];
      const chunkResult = await chunkStage(resourceId);
      if (chunkResult === 'chunked') {
        counts.chunked += 1;
        counts.chainResourceId = resourceId;
      } else if (chunkResult === 'failed') {
        counts.failed += 1;
      }
      return { status: 'success', ...counts };
    }

    const chunkedIds = await pickResourceIdsByStatus('chunked', 1);
    if (chunkedIds.length > 0) {
      const resourceId = chunkedIds[0];
      const embedResult = await embedStage(resourceId, { startTime: Date.now() });
      if (embedResult === 'vectorised') counts.vectorised += 1;
      if (embedResult === 'partial') counts.chainResourceId = resourceId;
      if (embedResult === 'failed') counts.failed += 1;
      return { status: 'success', ...counts };
    }

    return { status: 'success', ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Resource vectorise tick failed', { error: message });
    return { status: 'error', message, ...counts };
  }
}
