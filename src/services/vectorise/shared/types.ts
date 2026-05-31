export const EXECUTION_TIMEOUT_MS = 8000;
export const VECTORISE_BATCH_SIZE = 3;

export type VectoriseStageResult = 'vectorised' | 'failed' | 'not_found' | 'skipped';

export type ScheduleHint = '30s' | '15min';
