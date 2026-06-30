import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { logger } from '@/lib/logger';
import { transcribeAudioFile } from '../shared/whisper';

const execFileAsync = promisify(execFile);

export type YoutubeTranscriptSource = 'captions' | 'whisper';

export interface YoutubeTranscriptResult {
  text: string;
  source: YoutubeTranscriptSource;
}

const YOUTUBE_ELIGIBLE_WHERE = `
  r.sourceKind = 'youtube'
  AND r.youtubeVideoId IS NOT NULL
`;

async function fetchTimedTextCaptions(videoId: string): Promise<string | null> {
  const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  if (!xml.includes('<text')) {
    return null;
  }

  const segments = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((match) =>
      match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim()
    )
    .filter(Boolean);

  const text = segments.join(' ').trim();
  return text || null;
}

async function fetchYoutubeApiCaptions(videoId: string): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const listUrl = new URL('https://www.googleapis.com/youtube/v3/captions');
  listUrl.searchParams.set('part', 'snippet');
  listUrl.searchParams.set('videoId', videoId);
  listUrl.searchParams.set('key', apiKey);

  const listResponse = await fetch(listUrl, { signal: AbortSignal.timeout(10000) });
  if (!listResponse.ok) {
    logger.warn('YouTube captions.list failed', { videoId, status: listResponse.status });
    return null;
  }

  const listBody = (await listResponse.json()) as {
    items?: Array<{ id: string; snippet?: { trackKind?: string; language?: string } }>;
  };

  const captionId = listBody.items?.find((item) => item.snippet?.language === 'en')?.id
    ?? listBody.items?.[0]?.id;

  if (!captionId) {
    return null;
  }

  const accessToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return null;
  }

  const downloadUrl = `https://www.googleapis.com/youtube/v3/captions/${captionId}?tfmt=srt`;
  const downloadResponse = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!downloadResponse.ok) {
    logger.warn('YouTube captions.download failed', { videoId, status: downloadResponse.status });
    return null;
  }

  const srt = await downloadResponse.text();
  const text = srt
    .split('\n')
    .filter((line) => line.trim() && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
    .join(' ')
    .trim();

  return text || null;
}

async function downloadAudioWithYtDlp(videoId: string): Promise<string> {
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'resource-yt-'));
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
      { timeout: 120000 }
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

export async function fetchYoutubeTranscript(videoId: string): Promise<YoutubeTranscriptResult> {
  const apiCaptions = await fetchYoutubeApiCaptions(videoId);
  if (apiCaptions?.trim()) {
    return { text: apiCaptions, source: 'captions' };
  }

  const timedText = await fetchTimedTextCaptions(videoId);
  if (timedText?.trim()) {
    return { text: timedText, source: 'captions' };
  }

  let localPath: string | undefined;
  try {
    localPath = await downloadAudioWithYtDlp(videoId);
    const text = await transcribeAudioFile(localPath);
    if (!text.trim()) {
      throw new Error('Empty transcription returned');
    }
    return { text, source: 'whisper' };
  } finally {
    if (localPath) {
      const dir = path.dirname(localPath);
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export { YOUTUBE_ELIGIBLE_WHERE };
