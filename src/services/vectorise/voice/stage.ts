import { logger } from '@/lib/logger';
import { chunkText } from '../shared/chunk';
import { embedTexts } from '../shared/embed';
import type { VectoriseStageResult } from '../shared/types';
import { loadVoiceById, markVectorised, recordStageFailure } from './neo4j';
import type { VoiceChunkInput } from './types';

export async function vectoriseStage(voiceId: string): Promise<VectoriseStageResult> {
  const voice = await loadVoiceById(voiceId);
  if (!voice) return 'not_found';

  if (!voice.transcription?.trim()) {
    logger.warn('Voice missing transcription, skipping vectorise', { voiceId });
    return 'skipped';
  }

  try {
    const chunks = await chunkText(voice.transcription);
    if (chunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    const embeddings = await embedTexts(chunks);
    const chunkInputs: VoiceChunkInput[] = chunks.map((chunk_text, i) => ({
      chunk_text,
      embedding: embeddings[i],
    }));

    await markVectorised(voiceId, chunkInputs);
    logger.info('Voice vectorised', { voiceId, chunkCount: chunks.length });
    return 'vectorised';
  } catch (error) {
    logger.error('Vectorise stage failed', { voiceId, error });
    await recordStageFailure(voiceId, 'vectorise');
    return 'failed';
  }
}
