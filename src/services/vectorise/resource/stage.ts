import { logger } from '@/lib/logger';
import { vectoriseText } from '../shared/vectoriseText';
import type { VectoriseStageResult } from '../shared/types';
import { loadResourceById, markVectorised, recordStageFailure } from './neo4j';

export async function vectoriseStage(resourceId: string): Promise<VectoriseStageResult> {
  const resource = await loadResourceById(resourceId);
  if (!resource) return 'not_found';

  if (!resource.transcription?.trim()) {
    logger.warn('Resource missing transcription, skipping vectorise', { resourceId });
    return 'skipped';
  }

  try {
    const chunkInputs = await vectoriseText(resource.transcription);
    await markVectorised(resourceId, chunkInputs);
    logger.info('Resource vectorised', { resourceId, chunkCount: chunkInputs.length });
    return 'vectorised';
  } catch (error) {
    logger.error('Resource vectorise stage failed', { resourceId, error });
    await recordStageFailure(resourceId, 'vectorise');
    return 'failed';
  }
}
