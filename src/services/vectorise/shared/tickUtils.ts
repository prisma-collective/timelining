import { EXECUTION_TIMEOUT_MS } from './types';

export function hasTimeRemaining(startTime: number): boolean {
  return Date.now() - startTime < EXECUTION_TIMEOUT_MS;
}
