import { logger } from '@/lib/logger';
import {
  buildVoiceVectoriseResult,
} from '@/services/vectorise';
import type { TranscribeTickResult, VectoriseTickResult } from '@/services/vectorise/types';
import { NextResponse } from 'next/server';

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

async function fetchTickResult<T>(
  url: string,
  stage: 'transcribe' | 'vectorise'
): Promise<{ ok: boolean; tick: T; error?: string }> {
  try {
    const response = await fetch(url);
    const body = await response.json();

    if (!response.ok) {
      const error =
        typeof body.error === 'string' ? body.error : `${stage} tick returned ${response.status}`;
      return { ok: false, tick: defaultTickResult(stage) as T, error };
    }

    return { ok: true, tick: body.result as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { ok: false, tick: defaultTickResult(stage) as T, error: message };
  }
}

function defaultTickResult(stage: 'transcribe' | 'vectorise'): TranscribeTickResult | VectoriseTickResult {
  if (stage === 'transcribe') {
    return { status: 'error', transcribed: 0, skipped_long: 0, failed: 0 };
  }
  return { status: 'error', vectorised: 0, failed: 0 };
}

export async function GET() {
  logger.info('Voice vectorise cron triggered.');

  try {
    const baseUrl = getBaseUrl();
    const [transcribeFetch, vectoriseFetch] = await Promise.all([
      fetchTickResult<TranscribeTickResult>(`${baseUrl}/api/story/voice-transcribe`, 'transcribe'),
      fetchTickResult<VectoriseTickResult>(
        `${baseUrl}/api/story/voice-chunk-vectorise`,
        'vectorise'
      ),
    ]);

    const transcribe: TranscribeTickResult = transcribeFetch.ok
      ? transcribeFetch.tick
      : { ...transcribeFetch.tick, status: 'error', message: transcribeFetch.error };

    const vectorise: VectoriseTickResult = vectoriseFetch.ok
      ? vectoriseFetch.tick
      : { ...vectoriseFetch.tick, status: 'error', message: vectoriseFetch.error };

    const result = await buildVoiceVectoriseResult(transcribe, vectorise);
    logger.info('Voice vectorise result', { result });

    return NextResponse.json(
      { status: 'Voice vectorise executed', result },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error occurred' }, { status: 500 });
  }
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
