import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
});

export async function chunkVoiceTranscription(transcription: string): Promise<string[]> {
  return splitter.splitText(transcription);
}
