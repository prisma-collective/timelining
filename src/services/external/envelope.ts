import { channelSpecForTopic } from '@organising-config';
import type { ExternalEntrySource } from '@/lib/db/models/entry';

/**
 * An entry that doesn't come from Telegram (D13 in prisma-collective/at-tap).
 * The sender maps its own data onto this shape; timelining stores it as an Entry.
 */
export interface ExternalEntryEnvelope {
  source: ExternalEntrySource;
  /** The sender's own id for this event. (source, externalId) is unique: a resend never duplicates. */
  externalId: string;
  /** The organising channel it belongs to, e.g. '_botDecidir'. Picks the resolver. */
  topic: string;
  /** When it happened at the source, ISO 8601. */
  occurredAt: string;
  /** Where it came from at the source, e.g. 'prisma-collective/at-tap'. */
  sourceRef: string;
  /** Who did it at the source, e.g. a GitHub login. Stored as '<source>:<handle>'. */
  participant: { handle: string };
  text?: string;
  /** Structured data for the resolver, kept as JSON on the entry. */
  data?: Record<string, unknown>;
}

export type EnvelopeResult = { ok: true; envelope: ExternalEntryEnvelope } | { ok: false; error: string };

const MAX_TEXT = 10_000;
const MAX_DATA_BYTES = 16_384;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/** Checks a request body against the envelope. `source` is the one the caller's token belongs to. */
export function parseExternalEnvelope(body: unknown, source: ExternalEntrySource): EnvelopeResult {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be a JSON object' };

  if (body.source !== source) return { ok: false, error: `source must be '${source}' for this token` };
  if (!boundedString(body.externalId, 200)) return { ok: false, error: 'externalId must be a string of 1-200 characters' };
  if (!boundedString(body.topic, 100) || !channelSpecForTopic(body.topic)) {
    return { ok: false, error: 'topic must be a known organising channel' };
  }
  if (typeof body.occurredAt !== 'string' || Number.isNaN(Date.parse(body.occurredAt))) {
    return { ok: false, error: 'occurredAt must be an ISO 8601 date' };
  }
  if (!boundedString(body.sourceRef, 200)) return { ok: false, error: 'sourceRef must be a string of 1-200 characters' };
  if (!isPlainObject(body.participant) || !boundedString(body.participant.handle, 100)) {
    return { ok: false, error: 'participant.handle must be a string of 1-100 characters' };
  }
  if (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > MAX_TEXT)) {
    return { ok: false, error: `text must be a string of at most ${MAX_TEXT} characters` };
  }
  if (body.data !== undefined) {
    if (!isPlainObject(body.data)) return { ok: false, error: 'data must be a JSON object' };
    if (Buffer.byteLength(JSON.stringify(body.data)) > MAX_DATA_BYTES) {
      return { ok: false, error: `data must be at most ${MAX_DATA_BYTES} bytes as JSON` };
    }
  }

  return {
    ok: true,
    envelope: {
      source,
      externalId: body.externalId,
      topic: body.topic,
      occurredAt: new Date(body.occurredAt).toISOString(),
      sourceRef: body.sourceRef,
      participant: { handle: body.participant.handle },
      ...(body.text !== undefined && body.text.trim() ? { text: body.text } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
    },
  };
}
