import type { IncomingMessage } from 'http';
import type { TranscribeJob } from './types.js';

export function getBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

export function verifyAuth(request: IncomingMessage): boolean {
  const expected = process.env.PRIVATE_API_TOKEN?.trim();
  if (!expected) {
    return false;
  }
  const token = getBearerToken(request);
  return token === expected;
}

export function parseTranscribeJob(body: unknown): TranscribeJob | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  const sourceKind = record.sourceKind;
  const nodeId = record.nodeId;

  if (typeof nodeId !== 'string' || !nodeId.trim()) {
    return null;
  }

  if (sourceKind === 'youtube') {
    const youtubeVideoId = record.youtubeVideoId;
    if (typeof youtubeVideoId !== 'string' || !youtubeVideoId.trim()) {
      return null;
    }
    return { sourceKind, nodeId, youtubeVideoId };
  }

  if (sourceKind === 'telegram_voice') {
    const telegramFileId = record.telegramFileId;
    if (typeof telegramFileId !== 'string' || !telegramFileId.trim()) {
      return null;
    }
    return { sourceKind, nodeId, telegramFileId };
  }

  return null;
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as unknown;
}
