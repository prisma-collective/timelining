import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Telegram sends the secret_token given to setWebhook in the
 * `X-Telegram-Bot-Api-Secret-Token` header of every update. Without this
 * check, anyone with the webhook URL could post forged updates: queue
 * entries, and forwards to enrol and the other organising apps.
 *
 * Fails closed: with TELEGRAM_WEBHOOK_SECRET unset, every update is refused.
 */
export function verifyTelegramWebhook(request: NextRequest): NextResponse | null {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    logger.warn('Webhook refused: TELEGRAM_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET not configured' }, { status: 500 });
  }
  const given = Buffer.from(request.headers.get('x-telegram-bot-api-secret-token') ?? '');
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    logger.warn('Webhook refused: wrong or missing secret token');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/** Telegram accepts 1-256 characters: A-Z, a-z, 0-9, _ and -. */
export function isValidSecretToken(secret: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(secret);
}
