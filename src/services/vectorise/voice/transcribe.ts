import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { MAX_VOICE_DURATION_SEC } from './types';
import {
  loadVoiceById,
  markDeferredLong,
  markTranscribed,
  recordStageFailure,
} from './neo4j';
import { afterTranscribeDispatch } from './afterTranscribe';

function getBotToken(): string {
  const token =
    process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development'
      ? process.env.TELEGRAM_BOT_TOKEN_DEV
      : process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error('Telegram bot token not configured');
  }
  return token;
}

async function getTelegramFilePath(fileId: string): Promise<string | null> {
  const botToken = getBotToken();
  const response = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
    params: { file_id: fileId },
    timeout: 5000,
  });

  if (response.data?.ok) {
    return response.data.result.file_path as string;
  }
  return null;
}

async function downloadTelegramFile(filePath: string): Promise<string> {
  const botToken = getBotToken();
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });

  const ext = path.extname(filePath) || '.oga';
  const localPath = path.join(os.tmpdir(), `voice-${Date.now()}${ext}`);
  await fs.promises.writeFile(localPath, response.data);
  return localPath;
}

async function transcribeAudioFile(localPath: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(localPath),
    language: 'en',
  });
  return transcription.text;
}

export type TranscribeStageResult = 'transcribed' | 'skipped_long' | 'failed' | 'not_found';

export async function transcribeStage(voiceId: string): Promise<TranscribeStageResult> {
  const voice = await loadVoiceById(voiceId);
  if (!voice) return 'not_found';

  if (voice.duration > MAX_VOICE_DURATION_SEC) {
    await markDeferredLong(voiceId);
    logger.info('Voice deferred (long duration)', { voiceId, duration: voice.duration });
    return 'skipped_long';
  }

  let localPath: string | undefined;

  try {
    const filePath = await getTelegramFilePath(voice.fileId);
    if (!filePath) {
      throw new Error(`Could not resolve Telegram file path for ${voice.fileId}`);
    }

    localPath = await downloadTelegramFile(filePath);
    const transcription = await transcribeAudioFile(localPath);

    if (!transcription.trim()) {
      throw new Error('Empty transcription returned');
    }

    await markTranscribed(voiceId, transcription);
    logger.info('Voice transcribed', { voiceId });

    await afterTranscribeDispatch(voiceId);

    return 'transcribed';
  } catch (error) {
    logger.error('Transcribe stage failed', { voiceId, error });
    await recordStageFailure(voiceId, 'transcribe');
    return 'failed';
  } finally {
    if (localPath) {
      await fs.promises.unlink(localPath).catch(() => undefined);
    }
  }
}
