import { logger } from '@/lib/logger';
import { loadResourceById, markTranscribed, recordStageFailure } from './neo4j';
import { fetchYoutubeTranscript } from './youtube';

export type ResourceTranscribeStageResult = 'transcribed' | 'failed' | 'not_found';

export async function transcribeStage(resourceId: string): Promise<ResourceTranscribeStageResult> {
  const resource = await loadResourceById(resourceId);
  if (!resource) return 'not_found';

  try {
    const result = await fetchYoutubeTranscript(resource.youtubeVideoId);
    if (!result.text.trim()) {
      throw new Error('Empty transcription returned');
    }

    await markTranscribed(resourceId, result.text);
    logger.info('Resource transcribed', {
      resourceId,
      source: result.source,
      videoId: resource.youtubeVideoId,
    });
    return 'transcribed';
  } catch (error) {
    logger.error('Resource transcribe stage failed', { resourceId, error });
    await recordStageFailure(resourceId, 'transcribe');
    return 'failed';
  }
}
