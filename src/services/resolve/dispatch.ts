import { logger } from '@/lib/logger';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function getResolveAppBaseUrl(): string {
  const explicit = process.env.TIMELINING_APP_URL?.replace(/\/$/, '');
  if (explicit) return explicit;

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return 'http://localhost:3000';
}

export function dispatchEntryResolves(entryIds: string[]): number {
  const baseUrl = getResolveAppBaseUrl();
  const token = requireEnv('PRIVATE_API_TOKEN');
  const url = `${baseUrl}/api/story/resolve/entry`;

  for (const entryId of entryIds) {
    void fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entryId }),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Resolve dispatch failed', { entryId, error: message });
    });
  }

  logger.info('Dispatched entry resolves (fire-and-forget)', {
    dispatched: entryIds.length,
    entryIds,
    url,
  });

  return entryIds.length;
}
