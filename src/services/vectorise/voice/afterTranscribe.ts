import { logger } from '@/lib/logger';
import { dispatchOrganisingResolve } from '@/services/webhook/dispatchOrganisingResolve';
import { loadEntryTopicForVoice } from './neo4j';

export async function afterTranscribeDispatch(voiceId: string): Promise<void> {
  const entryRef = await loadEntryTopicForVoice(voiceId);
  if (!entryRef?.topic) {
    return;
  }

  const result = await dispatchOrganisingResolve(entryRef.entryId, entryRef.topic);
  if (!result.dispatched && result.error !== 'no_resolve_route') {
    logger.warn('Post-transcribe resolve dispatch failed; cron backstop will retry', {
      voiceId,
      entryId: entryRef.entryId,
      topic: entryRef.topic,
      error: result.error,
    });
  }
}
