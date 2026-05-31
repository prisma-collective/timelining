import type { ScheduleHint } from '../shared/types';

export interface PageChunkInput {
  id: string;
  content: string;
  embedding: number[];
  chunk_index: number;
  token_count: number;
}

export interface PageVectoriseTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  vectorised: number;
  failed: number;
}

export interface PageVectoriseResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  vectorised: number;
  failed: number;
  outstanding: number;
}
