import { logger } from '@/lib/logger';
import type { DispatchTranscribeResult, TranscribeAccepted, TranscribeJob } from './types';

export async function dispatchTranscribeJob(job: TranscribeJob): Promise<DispatchTranscribeResult> {
  const serviceUrl = process.env.TRANSCRIBE_SERVICE_URL?.trim();
  const token = process.env.PRIVATE_API_TOKEN?.trim();

  if (!serviceUrl) {
    logger.warn('Transcribe dispatch skipped: TRANSCRIBE_SERVICE_URL not configured', {
      nodeId: job.nodeId,
      sourceKind: job.sourceKind,
    });
    return { dispatched: false, error: 'transcribe_service_not_configured' };
  }

  if (!token) {
    logger.warn('Transcribe dispatch skipped: PRIVATE_API_TOKEN not configured', {
      nodeId: job.nodeId,
      sourceKind: job.sourceKind,
    });
    return { dispatched: false, error: 'private_api_token_not_configured' };
  }

  const url = `${serviceUrl.replace(/\/$/, '')}/transcribe`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(15000),
    });

    if (response.status !== 202) {
      const text = await response.text().catch(() => '');
      logger.warn('Transcribe dispatch rejected', {
        nodeId: job.nodeId,
        sourceKind: job.sourceKind,
        status: response.status,
        body: text,
      });
      return { dispatched: false, error: `http_${response.status}` };
    }

    const body = (await response.json()) as TranscribeAccepted;
    if (body.status !== 'accepted') {
      return { dispatched: false, error: 'invalid_accept_response' };
    }

    logger.info('Transcribe job accepted', {
      nodeId: job.nodeId,
      sourceKind: job.sourceKind,
      jobId: body.jobId,
    });

    return { dispatched: true, jobId: body.jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.warn('Transcribe dispatch failed', {
      nodeId: job.nodeId,
      sourceKind: job.sourceKind,
      error: message,
    });
    return { dispatched: false, error: message };
  }
}
