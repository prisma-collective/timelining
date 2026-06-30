import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
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

  logger.info('Resource vectorise triggered.', { method: request.method });

  try {
    const run = await runResourceVectoriseWithAvailabilityCheck();
    const result =
      'status' in run && run.status === 'skipped'
        ? {
            status: 'skipped' as const,
            message: run.message,
            schedule: '15min' as const,
            transcribed: 0,
            vectorised: 0,
            failed: 0,
            outstanding: 0,
            pipeline: { pending: 0, transcribed: 0, vectorised: 0, failed: 0 },
            hasMore: false,
          }
        : await buildResourceVectoriseResult(run);

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
