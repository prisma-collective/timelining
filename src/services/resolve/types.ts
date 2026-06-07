import type { ResolveStatus } from '@/lib/db/models/entry';
import type { ScheduleHint } from '@/services/vectorise/shared/types';

export type ResolveHandlerName = 'enrolment' | 'deciding';

export interface ResolveContext {
  entryId: string;
  topic: string;
  handler: ResolveHandlerName;
  participantHandle: string;
  transcription?: string;
  textContent?: string;
}

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
  skipped: number;
  entryIds: string[];
}

export interface ResolveEntriesResult {
  status: 'success' | 'skipped' | 'error';
  message?: string;
  schedule: ScheduleHint;
  attempted: number;
  dispatched: number;
  skipped: number;
  outstanding: number;
  resolved: number;
  failed: number;
  attemptedInFlight: number;
  hasMore: boolean;
  counts: ResolveStatusCounts;
}

export interface EntryResolveResult {
  entryId: string;
  handler?: ResolveHandlerName;
  resolveStatus: ResolveStatus;
}

export type EntrySourceKind = 'voice' | 'text';

export interface SchemaResolveResult {
  schemaChannel: string;
  schemaCommitSha: string;
  schemaContent: string;
  extractedFields: Record<string, unknown>;
  sourceText: string;
  sourceKind: EntrySourceKind;
}
