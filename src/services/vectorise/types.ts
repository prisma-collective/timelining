import type { VoiceProcessingStatus } from '@/lib/db/models/entry';

export const EXECUTION_TIMEOUT_MS = 8000;
export const MAX_VOICE_DURATION_SEC = 180;
export const VECTORISE_BATCH_SIZE = 3;
export const MAX_RETRIES = 3;

export type ScheduleHint = '30s' | '15min';

export interface VoicePipelineCounts {
  pending: number;
  transcribed: number;
  vectorised: number;
  failed: number;
  deferred_long: number;
}

export interface VoiceVectoriseResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  transcribed: number;
  vectorised: number;
  skipped_long: number;
  failed: number;
  outstanding: number;
  pipeline: VoicePipelineCounts;
}

export interface PickVoicesOptions {
  status: VoiceProcessingStatus;
  limit: number;
}
