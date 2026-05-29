import { logger } from '@/lib/logger';
import { chunkVoiceTranscription } from './chunk';
import { embedTexts } from './embed';
import { loadVoiceById, markVectorised, recordStageFailure } from './neo4j';

export type VectoriseStageResult = 'vectorised' | 'failed' | 'not_found' | 'skipped';

export async function vectoriseStage(voiceId: string): Promise<VectoriseStageResult> {
  const voice = await loadVoiceById(voiceId);
  if (!voice) return 'not_found';

  if (!voice.transcription?.trim()) {
    logger.warn('Voice missing transcription, skipping vectorise', { voiceId });
    return 'skipped';
  }

  try {
    const chunks = await chunkVoiceTranscription(voice.transcription);
    if (chunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    const embeddings = await embedTexts(chunks);
    await markVectorised(voiceId, chunks, embeddings);
    logger.info('Voice vectorised', { voiceId, chunkCount: chunks.length });
    return 'vectorised';
  } catch (error) {
    logger.error('Vectorise stage failed', { voiceId, error });
    await recordStageFailure(voiceId, 'vectorise');
    return 'failed';
  }
}
