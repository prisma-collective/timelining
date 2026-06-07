import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import { buildResolveEntriesResult, runResolveEntriesTick } from '@/services/resolve';
import { NextRequest, NextResponse } from 'next/server';

async function handleResolve(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  logger.info('Resolve entries triggered.', { method: request.method });

  try {
    const tick = await runResolveEntriesTick();
    const result = await buildResolveEntriesResult(tick);

    logger.info('Resolve entries result', { result });

    return NextResponse.json(
      { status: 'Resolve tick executed', result },
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
  return handleResolve(request);
}

export async function POST(request: NextRequest) {
  return handleResolve(request);
}
