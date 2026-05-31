import { logger } from '@/lib/logger';
import { buildPageVectoriseResult, runPageVectoriseTick } from '@/services/vectorise';
import { NextResponse } from 'next/server';

export async function GET() {
  logger.info('Page vectorise cron triggered.');

  try {
    const tick = await runPageVectoriseTick();
    const result = await buildPageVectoriseResult(tick);
    logger.info('Page vectorise result', { result });

    return NextResponse.json(
      { status: 'Page vectorise executed', result },
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
