import type { VoiceProcessingStatus } from '@/lib/db/models/entry';
import type { ScheduleHint } from '../shared/types';

export const MAX_VOICE_DURATION_SEC = 180;
export const MAX_RETRIES = 3;

export interface VoiceChunkInput {
  chunk_text: string;
  embedding: number[];
}

export interface VoicePipelineCounts {
  pending: number;
  transcribed: number;
  vectorised: number;
  failed: number;
  deferred_long: number;
}

export interface TranscribeTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  transcribed: number;
  skipped_long: number;
  failed: number;
}

export interface VectoriseTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  vectorised: number;
  failed: number;
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
  hasMore: boolean;
}

export interface PickVoicesOptions {
  status: VoiceProcessingStatus;
  limit: number;
}
