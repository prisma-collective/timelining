import type { ResourceProcessingStatus } from '@/lib/db/models/resource';
import type { ScheduleHint } from '../shared/types';

export const RESOURCE_VECTORISE_BATCH_SIZE = 10;

export interface ResourcePipelineCounts {
  pending: number;
  transcribed: number;
  vectorised: number;
  failed: number;
}

export interface ResourceTranscribeTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  transcribed: number;
  failed: number;
}

export interface ResourceVectoriseTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  vectorised: number;
  failed: number;
}

export interface ResourceVectoriseResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  transcribed: number;
  vectorised: number;
  failed: number;
  outstanding: number;
  pipeline: ResourcePipelineCounts;
  hasMore: boolean;
}

export interface RunAllResourceVectorisationResult {
  transcribed: number;
  vectorised: number;
  failed: number;
  rounds: number;
}

export interface PickResourcesOptions {
  status: ResourceProcessingStatus;
  limit: number;
}
