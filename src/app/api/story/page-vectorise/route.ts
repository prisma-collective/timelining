import { queueInternalContinuation } from '@/lib/internal-continuation';
import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import { buildPageVectoriseResult, runPageVectoriseTick } from '@/services/vectorise';
import { NextRequest, NextResponse } from 'next/server';

async function handlePageVectorise(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  const isChained = request.headers.get('x-page-vectorise-chain') === '1';
  logger.info('Page vectorise triggered.', { method: request.method, isChained });

  try {
    const tick = await runPageVectoriseTick();
    const result = await buildPageVectoriseResult(tick);
    let retriggered = false;
    if (result.hasMore) {
      retriggered = true;
      queueInternalContinuation({
        request,
        path: '/api/story/page-vectorise',
        chainHeader: 'x-page-vectorise-chain',
      });
    }

    logger.info('Page vectorise result', { result });

    return NextResponse.json(
      { status: 'Page vectorise executed', result: { ...result, retriggered } },
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
  return handlePageVectorise(request);
}

export async function POST(request: NextRequest) {
  return handlePageVectorise(request);
}
