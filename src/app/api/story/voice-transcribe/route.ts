import { logger } from '@/lib/logger';
import { runTranscribeTick } from '@/services/vectorise';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET() {
  logger.info('Voice transcribe tick triggered.');

  try {
    const result = await runTranscribeTick();
    logger.info('Voice transcribe result', { result });

    return NextResponse.json(
      { status: 'Transcribe tick executed', result },
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
