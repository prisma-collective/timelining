import type { TranscriptionCallback, TranscribeJob } from './types.js';
import { downloadYoutubeAudio, removePath, transcribeAudioFile } from './audio.js';

function getTelegramBotToken(): string {
  const token =
    process.env.NODE_ENV === 'development'
      ? process.env.TELEGRAM_BOT_TOKEN_DEV ?? process.env.TELEGRAM_BOT_TOKEN
      : process.env.TELEGRAM_BOT_TOKEN;

  if (!token?.trim()) {
    throw new Error('Telegram bot token not configured');
  }
  return token.trim();
}

async function getTelegramFilePath(fileId: string): Promise<string> {
  const botToken = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Telegram getFile failed with status ${response.status}`);
  }

  const body = (await response.json()) as { ok?: boolean; result?: { file_path?: string } };
  if (!body.ok || !body.result?.file_path) {
    throw new Error('Telegram getFile returned no file path');
  }

  return body.result.file_path;
}

async function downloadTelegramVoice(filePath: string): Promise<string> {
  const botToken = getTelegramBotToken();
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });

  if (!response.ok) {
    throw new Error(`Telegram file download failed with status ${response.status}`);
  }

  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const ext = path.extname(filePath) || '.oga';
  const localPath = path.join(os.tmpdir(), `voice-${Date.now()}${ext}`);
  await fs.promises.writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  return localPath;
}

function callbackUrlForJob(job: TranscribeJob): string {
  if (job.sourceKind === 'youtube') {
    const base = process.env.ENACT_BASE_URL?.replace(/\/$/, '');
    if (!base) {
      throw new Error('ENACT_BASE_URL not configured');
    }
    return `${base}/api/webhook/transcription/resource`;
  }

  const base = process.env.TIMELINING_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('TIMELINING_BASE_URL not configured');
  }
  return `${base}/api/story/transcription/voice`;
}

function callbackTokenForJob(job: TranscribeJob): string {
  if (job.sourceKind === 'youtube') {
    const token = process.env.ENACT_PRIVATE_API_TOKEN ?? process.env.PRIVATE_API_TOKEN;
    if (!token?.trim()) {
      throw new Error('ENACT_PRIVATE_API_TOKEN not configured');
    }
    return token.trim();
  }

  const token = process.env.TIMELINING_PRIVATE_API_TOKEN ?? process.env.PRIVATE_API_TOKEN;
  if (!token?.trim()) {
    throw new Error('TIMELINING_PRIVATE_API_TOKEN not configured');
  }
  return token.trim();
}

export async function postTranscriptionCallback(
  job: TranscribeJob,
  payload: TranscriptionCallback
): Promise<void> {
  const url = callbackUrlForJob(job);
  const token = callbackTokenForJob(job);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Callback failed (${response.status}): ${text}`);
  }
}

export async function runTranscribeJob(job: TranscribeJob, jobId: string): Promise<void> {
  let localPath: string | undefined;

  try {
    if (job.sourceKind === 'youtube') {
      localPath = await downloadYoutubeAudio(job.youtubeVideoId);
    } else {
      const filePath = await getTelegramFilePath(job.telegramFileId);
      localPath = await downloadTelegramVoice(filePath);
    }

    const transcription = (await transcribeAudioFile(localPath)).trim();
    if (!transcription) {
      throw new Error('Empty transcription returned');
    }

    await postTranscriptionCallback(job, {
      jobId,
      sourceKind: job.sourceKind,
      nodeId: job.nodeId,
      status: 'completed',
      transcription,
      transcriptSource: 'whisper',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await postTranscriptionCallback(job, {
      jobId,
      sourceKind: job.sourceKind,
      nodeId: job.nodeId,
      status: 'failed',
      transcriptSource: 'whisper',
      error: message,
    }).catch(() => undefined);
  } finally {
    if (localPath) {
      await removePath(localPath).catch(() => undefined);
    }
  }
}
