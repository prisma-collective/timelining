import { logger } from '@/lib/logger';
import { vectoriseText } from '../shared/vectoriseText';
import type { VectoriseStageResult } from '../shared/types';
import { loadVoiceById, markVectorised, recordStageFailure } from './neo4j';

export async function vectoriseStage(voiceId: string): Promise<VectoriseStageResult> {
  const voice = await loadVoiceById(voiceId);
  if (!voice) return 'not_found';

  if (!voice.transcription?.trim()) {
    logger.warn('Voice missing transcription, skipping vectorise', { voiceId });
    return 'skipped';
  }

  try {
    const chunkInputs = await vectoriseText(voice.transcription);
    await markVectorised(voiceId, chunkInputs);
    logger.info('Voice vectorised', { voiceId, chunkCount: chunkInputs.length });
    return 'vectorised';
  } catch (error) {
    logger.error('Vectorise stage failed', { voiceId, error });
    await recordStageFailure(voiceId, 'vectorise');
    return 'failed';
  }
}
