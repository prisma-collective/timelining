import { logger } from '@/lib/logger';
import type { NextRequest } from 'next/server';

export function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function parseNonNegativeEnvInt(envName: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envName] ?? '', 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

interface QueueInternalContinuationOptions {
  request: NextRequest;
  path: string;
  chainHeader: string;
  chainDepthHeader?: string;
  query?: Record<string, string | number | undefined>;
}

export function queueInternalContinuation({
  request,
  path,
  chainHeader,
  chainDepthHeader = 'x-chain-depth',
  query,
}: QueueInternalContinuationOptions): void {
  const token = process.env.PRIVATE_API_TOKEN;
  if (!token) {
    logger.warn('Internal continuation skipped: PRIVATE_API_TOKEN is not configured', { path });
    return;
  }

  const continuationUrl = new URL(path, request.nextUrl.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null) {
      continuationUrl.searchParams.set(key, String(value));
    }
  }

  const currentDepth = Number.parseInt(request.headers.get(chainDepthHeader) ?? '0', 10);
  const nextDepth = Number.isFinite(currentDepth) && currentDepth >= 0 ? currentDepth + 1 : 1;

  void fetch(continuationUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      [chainHeader]: '1',
      [chainDepthHeader]: String(nextDepth),
    },
    cache: 'no-store',
  })
    .then((response) => {
      if (!response.ok) {
        logger.warn('Internal continuation trigger failed', {
          path,
          url: continuationUrl.toString(),
          status: response.status,
          chainDepth: nextDepth,
        });
        return;
      }

      logger.info('Internal continuation trigger accepted', {
        path,
        url: continuationUrl.toString(),
        status: response.status,
        chainDepth: nextDepth,
      });
    })
    .catch((error) => {
      logger.warn('Internal continuation trigger threw', {
        path,
        url: continuationUrl.toString(),
        error: error instanceof Error ? error.message : String(error),
        chainDepth: nextDepth,
      });
    });
}
