import {
  INGEST_FAILED_QUEUE,
  RESOLVE_FAILED_QUEUE,
  TRANSCRIBE_FAILED_QUEUE,
} from '@organising-config';
import { parseRedisJson, redisJsonToString } from '@/lib/redis-json';
import { redis } from '@/lib/redis';

export interface IngestFailedRecord {
  raw: string;
  failedAt: string;
  error: string;
  messageId?: number;
}

export interface TranscribeFailedRecord {
  voiceId: string;
  entryId?: string;
  failedAt: string;
  error: string;
}

export interface ResolveFailedRecord {
  entryId: string;
  topic: string;
  failedAt: string;
  error: string;
}

export async function pushIngestFailed(
  raw: string | Record<string, unknown>,
  error: string,
  messageId?: number
): Promise<void> {
  const record: IngestFailedRecord = {
    raw: redisJsonToString(raw),
    failedAt: new Date().toISOString(),
    error,
    ...(messageId != null ? { messageId } : {}),
  };
  await redis.lpush(INGEST_FAILED_QUEUE, JSON.stringify(record));
}

export async function popIngestFailed(): Promise<IngestFailedRecord | null> {
  const item = await redis.rpop(INGEST_FAILED_QUEUE);
  if (!item) {
    return null;
  }
  const record = parseRedisJson<IngestFailedRecord>(item);
  return {
    ...record,
    raw: redisJsonToString(record.raw),
  };
}

export async function countIngestFailed(): Promise<number> {
  return redis.llen(INGEST_FAILED_QUEUE);
}

export async function pushTranscribeFailed(
  voiceId: string,
  error: string,
  entryId?: string
): Promise<void> {
  const record: TranscribeFailedRecord = {
    voiceId,
    failedAt: new Date().toISOString(),
    error,
    ...(entryId ? { entryId } : {}),
  };
  await redis.lpush(TRANSCRIBE_FAILED_QUEUE, JSON.stringify(record));
}

export async function popTranscribeFailed(): Promise<TranscribeFailedRecord | null> {
  const item = await redis.rpop(TRANSCRIBE_FAILED_QUEUE);
  if (!item) {
    return null;
  }
  return parseRedisJson<TranscribeFailedRecord>(item);
}

export async function countTranscribeFailed(): Promise<number> {
  return redis.llen(TRANSCRIBE_FAILED_QUEUE);
}

export async function pushResolveFailed(
  entryId: string,
  topic: string,
  error: string
): Promise<void> {
  const record: ResolveFailedRecord = {
    entryId,
    topic,
    failedAt: new Date().toISOString(),
    error,
  };
  await redis.lpush(RESOLVE_FAILED_QUEUE, JSON.stringify(record));
}

export async function popResolveFailed(): Promise<ResolveFailedRecord | null> {
  const item = await redis.rpop(RESOLVE_FAILED_QUEUE);
  if (!item) {
    return null;
  }
  return parseRedisJson<ResolveFailedRecord>(item);
}

export async function countResolveFailed(): Promise<number> {
  return redis.llen(RESOLVE_FAILED_QUEUE);
}

export async function getFailedQueueCounts(): Promise<{
  ingest: number;
  transcribe: number;
  resolve: number;
}> {
  const [ingest, transcribe, resolve] = await Promise.all([
    countIngestFailed(),
    countTranscribeFailed(),
    countResolveFailed(),
  ]);
  return { ingest, transcribe, resolve };
}
