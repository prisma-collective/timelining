import { logger } from '@/lib/logger';
import {
  buildVoiceVectoriseResult,
  runTranscribeTick,
  runVectoriseTick,
} from '@/services/vectorise';
import { NextResponse } from 'next/server';

export async function GET() {
  logger.info('Voice vectorise cron triggered.');

  try {
    const [transcribe, vectorise] = await Promise.all([
      runTranscribeTick(),
      runVectoriseTick(),
    ]);

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
