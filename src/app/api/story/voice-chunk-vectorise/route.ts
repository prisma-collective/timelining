import { logger } from '@/lib/logger';
import { runVectoriseTick } from '@/services/vectorise';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function GET() {
  logger.info('Voice chunk-vectorise tick triggered.');

  try {
    const result = await runVectoriseTick();
    logger.info('Voice chunk-vectorise result', { result });

    return NextResponse.json(
      { status: 'Vectorise tick executed', result },
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
