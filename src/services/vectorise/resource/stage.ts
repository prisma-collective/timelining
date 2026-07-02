import { logger } from '@/lib/logger';
import { parseNonNegativeEnvInt } from '@/lib/internal-continuation';
import { embedTexts } from '../shared/embed';
import { hasTimeRemaining } from '../shared/tickUtils';
import {
  countUnvectorisedChunks,
  loadResourceById,
  markChunksVectorised,
  markResourceVectorisedIfComplete,
  pickUnvectorisedChunks,
  recordStageFailure,
} from './neo4j';

const DEFAULT_RESOURCE_CHUNK_EMBED_BATCH_SIZE = 20;
const DEFAULT_RESOURCE_EMBED_STAGE_RESERVE_MS = 3000;

function getEmbedBatchSize(): number {
  return parseNonNegativeEnvInt(
    'RESOURCE_CHUNK_EMBED_BATCH_SIZE',
    DEFAULT_RESOURCE_CHUNK_EMBED_BATCH_SIZE
  );
}

function getEmbedStageReserveMs(): number {
  return parseNonNegativeEnvInt(
    'RESOURCE_EMBED_STAGE_RESERVE_MS',
    DEFAULT_RESOURCE_EMBED_STAGE_RESERVE_MS
  );
}

export type EmbedStageResult = 'vectorised' | 'partial' | 'failed' | 'not_found' | 'skipped';

export interface EmbedStageOptions {
  startTime?: number;
}

export async function embedStage(
  resourceId: string,
  options: EmbedStageOptions = {}
): Promise<EmbedStageResult> {
  const resource = await loadResourceById(resourceId);
  if (!resource) return 'not_found';

  if (resource.processingStatus !== 'chunked') {
    logger.warn('Resource not ready for embed stage', {
      resourceId,
      status: resource.processingStatus,
    });
    return 'skipped';
  }

  const startTime = options.startTime ?? Date.now();
  const batchSize = getEmbedBatchSize();
  const stageReserveMs = getEmbedStageReserveMs();
  let processedInInvocation = 0;

  try {
    while (hasTimeRemaining(startTime, stageReserveMs)) {
      const remainingBudget = batchSize - processedInInvocation;
      if (remainingBudget <= 0) {
        break;
      }

      const chunks = await pickUnvectorisedChunks(resourceId, remainingBudget);
      if (chunks.length === 0) {
        const completed = await markResourceVectorisedIfComplete(resourceId);
        if (completed) {
          logger.info('Resource vectorised', { resourceId });
          return 'vectorised';
        }
        return 'skipped';
      }

      const texts = chunks.map((chunk) => chunk.chunk_text);
      const embeddings = await embedTexts(texts);
      await markChunksVectorised(
        chunks.map((chunk) => chunk.id),
        embeddings
      );
      processedInInvocation += chunks.length;
    }

    const remaining = await countUnvectorisedChunks(resourceId);
    if (remaining === 0) {
      const completed = await markResourceVectorisedIfComplete(resourceId);
      if (completed) {
        logger.info('Resource vectorised', { resourceId });
        return 'vectorised';
      }
    }

    if (remaining > 0) {
      logger.info('Resource embed batch partial', { resourceId, remaining });
      return 'partial';
    }

    return 'vectorised';
  } catch (error) {
    logger.error('Resource embed stage failed', { resourceId, error });
    await recordStageFailure(resourceId, 'vectorise');
    return 'failed';
  }
}
