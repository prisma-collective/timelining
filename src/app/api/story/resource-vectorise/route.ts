import { after } from 'next/server';
import { logger } from '@/lib/logger';
import { originFromRequest } from '@/lib/internal-dispatch';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import {
  buildResourceEmbedChainPath,
  chainResourceVectorise,
} from '@/services/vectorise/resource/chain';
import { chunkStage } from '@/services/vectorise/resource/chunk';
import { embedStage } from '@/services/vectorise/resource/stage';
import {
  buildResourceVectoriseResult,
  runResourceVectoriseWithAvailabilityCheck,
} from '@/services/vectorise/resource';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

async function handleResourceVectorise(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  const resourceId = request.nextUrl.searchParams.get('resourceId');
  const stageParam = request.nextUrl.searchParams.get('stage');
  const stage =
    stageParam === 'chunk' || stageParam === 'embed' ? stageParam : undefined;
  const origin = originFromRequest(request);

  logger.info('Resource vectorise triggered.', {
    method: request.method,
    resourceId,
    stage,
  });

  try {
    if (resourceId && stage === 'chunk') {
      const result = await chunkStage(resourceId);
      if (result === 'chunked') {
        after(() => chainResourceVectorise(origin, buildResourceEmbedChainPath(resourceId)));
      }
      return NextResponse.json(
        { status: 'Resource chunk executed', result: { resourceId, stage: result } },
        { status: 200 }
      );
    }

    if (resourceId && stage === 'embed') {
      const embedResult = await embedStage(resourceId, { startTime: Date.now() });
      if (embedResult === 'partial') {
        after(() => chainResourceVectorise(origin, buildResourceEmbedChainPath(resourceId)));
      }
      return NextResponse.json(
        { status: 'Resource embed executed', result: { resourceId, stage: embedResult } },
        { status: 200 }
      );
    }

    const run = await runResourceVectoriseWithAvailabilityCheck({
      resourceId: resourceId ?? undefined,
      stage: stage ?? 'auto',
    });

    if ('status' in run && run.status === 'skipped') {
      return NextResponse.json(
        {
          status: 'Resource vectorise executed',
          result: {
            status: 'skipped',
            message: run.message,
            schedule: '15min',
            chunked: 0,
            vectorised: 0,
            failed: 0,
            outstanding: 0,
            pipeline: { pending: 0, transcribed: 0, chunked: 0, vectorised: 0, failed: 0 },
            hasMore: false,
          },
        },
        { status: 200 }
      );
    }

    if (run.chainResourceId) {
      after(() =>
        chainResourceVectorise(origin, buildResourceEmbedChainPath(run.chainResourceId!))
      );
    }

    const result = await buildResourceVectoriseResult(run);

    return NextResponse.json({ status: 'Resource vectorise executed', result }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error occurred' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleResourceVectorise(request);
}

export async function POST(request: NextRequest) {
  return handleResourceVectorise(request);
}
