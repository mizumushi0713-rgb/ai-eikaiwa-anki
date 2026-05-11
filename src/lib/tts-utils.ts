/**
 * Shared TTS utilities for generating Anki audio files via Gemini TTS.
 */
import { GoogleGenAI } from '@google/genai';

/** Convert raw PCM (16-bit signed LE, 24 kHz, mono) to WAV */
export function pcmToWav(pcmData: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

/**
 * Returns true if the text is primarily English.
 * Strips HTML tags and cloze markers before analysis.
 */
export function isEnglishText(text: string): boolean {
  if (!text || text.trim().length < 4) return false;
  const cleaned = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{c\d+::(.*?)\}\}/g, '$1');
  const cjk = (cleaned.match(/[\u3040-\u9fff\uff00-\uffef]/g) ?? []).length;
  const ascii = (cleaned.match(/[a-zA-Z]/g) ?? []).length;
  return ascii > cjk && ascii > 3;
}

/** Strip cloze markers and HTML tags to get plain text for TTS */
export function toTtsText(text: string): string {
  return text
    .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .trim();
}

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = 'Kore';
const CHUNK_SIZE = 5;

/**
 * Generate WAV audio for an array of texts in parallel batches.
 * Returns null for texts that fail or are not English.
 */
export async function generateAudioFiles(
  texts: string[],
  apiKey: string
): Promise<(Buffer | null)[]> {
  const ai = new GoogleGenAI({ apiKey });
  const results: (Buffer | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (text) => {
        const ttsText = toTtsText(text);
        if (!isEnglishText(ttsText)) return null;
        try {
          const response = await ai.models.generateContent({
            model: TTS_MODEL,
            contents: [{ parts: [{ text: ttsText }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
              },
            },
          });
          const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (!audioData) return null;
          return pcmToWav(Buffer.from(audioData, 'base64'));
        } catch {
          return null;
        }
      })
    );
    chunkResults.forEach((r, j) => { results[i + j] = r; });
  }

  return results;
}
