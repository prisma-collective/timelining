import {
  buildOrganisingResolveUrl,
  resolveRouteForTopic,
} from '@organising-config';
import { logger } from '@/lib/logger';

const DISPATCH_TIMEOUT_MS = 5000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export interface OrganisingResolveDispatchResult {
  dispatched: boolean;
  url?: string;
  error?: string;
}

export interface OrganisingResolveBatchResult {
  dispatched: number;
  failed: number;
  skipped: number;
}

export async function dispatchOrganisingResolve(
  entryId: string,
  topic: string
): Promise<OrganisingResolveDispatchResult> {
  const route = resolveRouteForTopic(topic);
  if (!route) {
    return { dispatched: false, error: 'no_resolve_route' };
  }

  const token = requireEnv('PRIVATE_API_TOKEN');
  const url = buildOrganisingResolveUrl(route.domain, route.path, entryId);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = `http_${response.status}`;
      logger.error('Organising resolve dispatch failed', { entryId, topic, url, error });
      return { dispatched: false, url, error };
    }

    logger.info('Organising resolve dispatched', { entryId, topic, url });
    return { dispatched: true, url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.error('Organising resolve dispatch failed', { entryId, topic, url, error: message });
    return { dispatched: false, url, error: message };
  }
}

export async function dispatchOrganisingResolves(
  entries: Array<{ entryId: string; topic: string }>
): Promise<OrganisingResolveBatchResult> {
  let dispatched = 0;
  let failed = 0;
  let skipped = 0;

  for (const { entryId, topic } of entries) {
    const result = await dispatchOrganisingResolve(entryId, topic);
    if (result.error === 'no_resolve_route') {
      skipped++;
      continue;
    }
    if (result.dispatched) {
      dispatched++;
    } else {
      failed++;
    }
  }

  logger.info('Organising resolve batch complete', { dispatched, failed, skipped });
  return { dispatched, failed, skipped };
}
