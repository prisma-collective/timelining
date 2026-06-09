import type { ScheduleHint } from '@/services/vectorise/shared/types';

export interface ResolveStatusCounts {
  unset: number;
  pending: number;
  attempted: number;
  successful: number;
  failed: number;
}

export interface ResolveEntriesTickResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  attempted: number;
  dispatched: number;
  failed: number;
  skipped: number;
  entryIds: string[];
}

export interface ResolveEntriesResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  attempted: number;
  dispatched: number;
  failed: number;
  skipped: number;
  outstanding: number;
  resolved: number;
  attemptedInFlight: number;
  hasMore: boolean;
  counts: ResolveStatusCounts;
}
