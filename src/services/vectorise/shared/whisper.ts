import fs from 'fs';
import OpenAI from 'openai';

export async function transcribeAudioFile(localPath: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(localPath),
    language: 'en',
  });
  return transcription.text;
}
