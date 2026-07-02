import { logger } from '@/lib/logger';
import { chunkText } from '../shared/chunk';
import {
  loadResourceById,
  markChunked,
  recordStageFailure,
} from './neo4j';

export type ChunkStageResult = 'chunked' | 'failed' | 'not_found' | 'skipped';

export async function chunkStage(resourceId: string): Promise<ChunkStageResult> {
  const resource = await loadResourceById(resourceId);
  if (!resource) return 'not_found';

  if (resource.processingStatus !== 'transcribed') {
    logger.warn('Resource not ready for chunk stage', {
      resourceId,
      status: resource.processingStatus,
    });
    return 'skipped';
  }

  if (!resource.transcription?.trim()) {
    logger.warn('Resource missing transcription, skipping chunk', { resourceId });
    return 'skipped';
  }

  try {
    const chunks = await chunkText(resource.transcription);
    if (chunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    await markChunked(resourceId, chunks);
    logger.info('Resource chunked', { resourceId, chunkCount: chunks.length });
    return 'chunked';
  } catch (error) {
    logger.error('Resource chunk stage failed', { resourceId, error });
    await recordStageFailure(resourceId, 'chunk');
    return 'failed';
  }
}
