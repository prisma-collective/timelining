import { EXECUTION_TIMEOUT_MS } from './types';

export function hasTimeRemaining(startTime: number, reserveMs = 0): boolean {
  const effectiveTimeout = Math.max(0, EXECUTION_TIMEOUT_MS - reserveMs);
  return Date.now() - startTime < effectiveTimeout;
}
