import { logger } from '@/lib/logger';
import { runWorker } from '@/services/worker';
import { NextResponse } from 'next/server'

export async function GET() {
  logger.info('Cron job triggered.');

  try {
    const result = await runWorker(); // assuming it returns a status or object
    logger.info('Worker result', { result });

    // Return 200 even when Neo4j is unavailable
    return NextResponse.json({ status: 'Worker executed', result }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      // TypeScript now knows 'error' is an instance of Error
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    } else {
      // If it's not an instance of Error, we handle it in a generic way
      return NextResponse.json(
        { error: 'Unknown error occurred' },
        { status: 500 }
      );
    }
  }
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
