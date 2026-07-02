import { after } from 'next/server';
import { dispatchInternalRoute } from '@/lib/internal-dispatch';
import { dispatchTranscribeJob } from '@/lib/transcribe/dispatch';
import { triggerResolve } from '@/services/resolve';
import { forwardToOrganisingWebhook } from '@/services/webhook/organisingRoute';
import type { PipelineAction } from './routing';

export async function executePipelineAction(action: PipelineAction): Promise<void> {
  switch (action.kind) {
    case 'forward-webhook':
      await forwardToOrganisingWebhook(action.domain, action.path, action.payload);
      break;
    case 'dispatch-ingest':
      after(() =>
        dispatchInternalRoute(
          action.origin,
          '/api/story/ingest?limit=1&mode=chain',
          { chain: true }
        )
      );
      break;
    case 'trigger-resolve':
      await triggerResolve(action.entryId, action.topic, { source: 'text' });
      break;
    case 'dispatch-transcribe':
      after(() =>
        dispatchInternalRoute(
          action.origin,
          `/api/story/voice-vectorise?voiceId=${encodeURIComponent(action.voiceId)}&mode=chain`,
          { chain: true }
        )
      );
      break;
    case 'dispatch-transcribe-service':
      await dispatchTranscribeJob({
        sourceKind: 'telegram_voice',
        nodeId: action.voiceId,
        telegramFileId: action.telegramFileId,
      });
      break;
    case 'none':
      break;
  }
}

export async function executePipelineActions(actions: PipelineAction[]): Promise<void> {
  for (const action of actions) {
    await executePipelineAction(action);
  }
}
