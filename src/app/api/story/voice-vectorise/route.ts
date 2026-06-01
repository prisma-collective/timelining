import { queueInternalContinuation } from '@/lib/internal-continuation';
import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import {
  buildVoiceVectoriseResult,
  runTranscribeTick,
  runVectoriseTick,
} from '@/services/vectorise';
import { NextRequest, NextResponse } from 'next/server';

async function handleVoiceVectorise(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  const isChained = request.headers.get('x-voice-vectorise-chain') === '1';
  logger.info('Voice vectorise triggered.', { method: request.method, isChained });

  try {
    const [transcribe, vectorise] = await Promise.all([
      runTranscribeTick(),
      runVectoriseTick(),
    ]);

    const result = await buildVoiceVectoriseResult(transcribe, vectorise);
    let retriggered = false;
    if (result.hasMore) {
      retriggered = true;
      queueInternalContinuation({
        request,
        path: '/api/story/voice-vectorise',
        chainHeader: 'x-voice-vectorise-chain',
      });
    }

    logger.info('Voice vectorise result', { result });

    return NextResponse.json(
      { status: 'Voice vectorise executed', result: { ...result, retriggered } },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error occurred' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleVoiceVectorise(request);
}

export async function POST(request: NextRequest) {
  return handleVoiceVectorise(request);
}
