import { ORGANISING_CONFIG } from '@organising-config';
import { logger } from '@/lib/logger';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

/** Fire-and-forget enrolment resolve to the organising enrol app. */
export function dispatchEnrolmentResolve(entryId: string): void {
  const domain = ORGANISING_CONFIG.enrol.domain;
  const token = requireEnv('PRIVATE_API_TOKEN');
  const url = `https://${domain}/api/webhook/resolve?entryId=${encodeURIComponent(entryId)}`;

  void fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.error('Enrolment resolve dispatch failed', { entryId, error: message });
  });

  logger.info('Dispatched enrolment resolve (fire-and-forget)', { entryId, url });
}
