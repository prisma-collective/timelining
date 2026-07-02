import type { ResourceProcessingStatus } from '@/lib/db/models/resource';
import type { ScheduleHint } from '../shared/types';

export const RESOURCE_VECTORISE_BATCH_SIZE = 1;

export interface ResourceUnvectorisedChunk {
  id: string;
  chunk_text: string;
  chunk_index: number;
}

export interface ResourcePipelineCounts {
  pending: number;
  transcribed: number;
  chunked: number;
  vectorised: number;
  failed: number;
}

export interface ResourceVectoriseTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  chunked: number;
  vectorised: number;
  failed: number;
  chainResourceId?: string;
}

export interface ResourceVectoriseResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  chunked: number;
  vectorised: number;
  failed: number;
  outstanding: number;
  pipeline: ResourcePipelineCounts;
  hasMore: boolean;
}

export interface ResourceStageRunResult {
  resourceId: string;
  stage: 'chunk' | 'embed';
  result: string;
}

export interface PickResourcesOptions {
  status: ResourceProcessingStatus;
  limit: number;
}
