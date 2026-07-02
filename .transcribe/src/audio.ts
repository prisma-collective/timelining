import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import OpenAI from 'openai';

const execFileAsync = promisify(execFile);

export async function transcribeAudioFile(localPath: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(localPath),
    language: 'en',
  });
  return transcription.text;
}

export async function downloadYoutubeAudio(videoId: string): Promise<string> {
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'transcribe-yt-'));
  const outputTemplate = path.join(outputDir, `${videoId}.%(ext)s`);

  try {
    await execFileAsync(
      'yt-dlp',
      [
        '-f',
        'bestaudio/best',
        '--extract-audio',
        '--audio-format',
        'mp3',
        '-o',
        outputTemplate,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 300000 }
    );
  } catch (error) {
    await fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const files = await fs.promises.readdir(outputDir);
  const audioFile = files.find((file) => file.startsWith(videoId));
  if (!audioFile) {
    await fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('yt-dlp produced no audio file');
  }

  return path.join(outputDir, audioFile);
}

export async function removePath(localPath: string): Promise<void> {
  const dir = path.dirname(localPath);
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(async () => {
    await fs.promises.unlink(localPath).catch(() => undefined);
  });
}

export async function checkYtDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
