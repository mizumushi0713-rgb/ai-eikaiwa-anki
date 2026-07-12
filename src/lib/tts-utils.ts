/**
 * Shared TTS utilities for generating Anki audio files via Gemini TTS.
 */
import { GoogleGenAI } from '@google/genai';
import { GEMINI_TTS_MODEL } from '@/lib/models';

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

/** Strip cloze markers and HTML tags to get plain text for TTS */
export function toTtsText(text: string): string {
  return text
    .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .trim();
}

/**
 * Score how "English-like" the text is (fraction of ASCII letters over all
 * meaningful characters). Returns 0..1. Higher = more English.
 */
export function englishScore(text: string): number {
  if (!text) return 0;
  const cleaned = toTtsText(text);
  if (cleaned.length < 3) return 0;
  const cjk    = (cleaned.match(/[぀-鿿＀-￯]/g) ?? []).length;
  const ascii  = (cleaned.match(/[a-zA-Z]/g) ?? []).length;
  const total  = cjk + ascii;
  if (total === 0) return 0;
  return ascii / total;
}

/** True if text looks primarily English (enough letters and > Japanese chars). */
export function isEnglishText(text: string): boolean {
  const cleaned = toTtsText(text);
  const ascii = (cleaned.match(/[a-zA-Z]/g) ?? []).length;
  return ascii >= 4 && englishScore(text) >= 0.5;
}

export interface AudioResult {
  frontWav: Buffer | null;
  backWav: Buffer | null;
}

export type AudioSide = 'auto' | 'front' | 'back' | 'both';

const TTS_VOICE = 'Kore';
const CHUNK_SIZE = 3;
const MAX_RETRIES = 3;
const MAX_TTS_TEXT_LENGTH = 500; // TTS is unreliable on very long strings

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncateForTts(text: string): string {
  if (text.length <= MAX_TTS_TEXT_LENGTH) return text;
  // Try to break at a sentence boundary
  const cut = text.slice(0, MAX_TTS_TEXT_LENGTH);
  const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return lastPeriod > MAX_TTS_TEXT_LENGTH * 0.5 ? cut.slice(0, lastPeriod + 1) : cut;
}

/** Single TTS call with retry on any error. */
async function ttsOnce(
  ai: GoogleGenAI,
  rawText: string,
): Promise<{ wav: Buffer | null; lastError?: string }> {
  const text = truncateForTts(rawText);
  let lastErr: unknown;
  let lastErrMsg = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_TTS_MODEL,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
          },
        },
      });
      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) throw new Error('empty audio payload');
      return { wav: pcmToWav(Buffer.from(audioData, 'base64')) };
    } catch (err) {
      lastErr = err;
      lastErrMsg = err instanceof Error ? err.message : String(err);
      const isQuota = /429|quota|RESOURCE_EXHAUSTED|rate/i.test(lastErrMsg);
      if (attempt < MAX_RETRIES) {
        // Longer backoff for quota errors so the per-minute window can reset.
        const base = isQuota ? 5000 : 1500;
        const wait = base * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[tts] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${isQuota ? 'quota' : 'other'}): ${lastErrMsg.slice(0, 120)} — retrying in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
  }
  console.warn(`[tts] gave up after ${MAX_RETRIES + 1} attempts: ${lastErrMsg.slice(0, 200)}`);
  return { wav: null, lastError: lastErrMsg.slice(0, 200) };
}

/**
 * Decide which side(s) of a card to TTS given the user's mode.
 * - 'auto'  : pick whichever side is English (or neither if both look non-English)
 * - 'front' : always front (skip if front is empty)
 * - 'back'  : always back  (skip if back is empty)
 * - 'both'  : both sides (skip each side independently if empty)
 */
function sidesToTts(
  card: { front: string; back: string },
  mode: AudioSide,
): { front: boolean; back: boolean } {
  const hasFront = toTtsText(card.front).length >= 2;
  const hasBack  = toTtsText(card.back).length  >= 2;
  if (mode === 'front') return { front: hasFront, back: false };
  if (mode === 'back')  return { front: false,    back: hasBack };
  if (mode === 'both')  return { front: hasFront, back: hasBack };
  // auto
  const fEng = hasFront && isEnglishText(card.front);
  const bEng = hasBack  && isEnglishText(card.back);
  if (!fEng && !bEng) return { front: false, back: false };
  const fScore = englishScore(card.front);
  const bScore = englishScore(card.back);
  const pickFront = fEng && (!bEng || fScore >= bScore);
  return { front: pickFront, back: !pickFront };
}

export interface AudioStats {
  mode: AudioSide;
  totalCards: number;
  totalClips: number;    // clips generated successfully
  failedClips: number;   // clips that failed after all retries
  skippedCards: number;  // cards where no side was requested/eligible
  sampleErrors: string[]; // up to 3 distinct error messages for diagnosis
}

/**
 * Generate WAV audio for an array of cards. Returns `{frontWav, backWav}`
 * per card, either of which may be null (skipped or failed).
 */
export async function generateAudioFiles(
  cards: { front: string; back: string }[],
  apiKey: string,
  options: { audioSide?: AudioSide } = {},
): Promise<{ audio: (AudioResult | null)[]; stats: AudioStats }> {
  const mode: AudioSide = options.audioSide ?? 'auto';
  const ai = new GoogleGenAI({ apiKey });
  const results: (AudioResult | null)[] = new Array(cards.length).fill(null);
  let ok = 0;
  let failed = 0;
  const errorSamples = new Set<string>();

  // Flatten into a list of {cardIdx, side, text} tasks so we can parallelize
  // across sides too, not just cards.
  type Task = { cardIdx: number; side: 'front' | 'back'; text: string };
  const tasks: Task[] = [];
  for (let idx = 0; idx < cards.length; idx++) {
    const card = cards[idx];
    const sides = sidesToTts(card, mode);
    if (sides.front) tasks.push({ cardIdx: idx, side: 'front', text: toTtsText(card.front) });
    if (sides.back)  tasks.push({ cardIdx: idx, side: 'back',  text: toTtsText(card.back)  });
  }

  let sawQuotaError = false;
  for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
    const chunk = tasks.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (t) => ({ task: t, ...(await ttsOnce(ai, t.text)) })),
    );
    for (const { task, wav, lastError } of chunkResults) {
      if (!wav) {
        failed++;
        if (lastError) {
          if (/429|quota|RESOURCE_EXHAUSTED|rate/i.test(lastError)) sawQuotaError = true;
          if (errorSamples.size < 3) errorSamples.add(lastError);
        }
        continue;
      }
      const existing = results[task.cardIdx] ?? { frontWav: null, backWav: null };
      if (task.side === 'front') existing.frontWav = wav;
      else                       existing.backWav  = wav;
      results[task.cardIdx] = existing;
      ok++;
    }
    // If we already hit quota this batch, breathe before the next batch to
    // give the per-minute window a chance to reset.
    if (sawQuotaError && i + CHUNK_SIZE < tasks.length) {
      await sleep(4000);
      sawQuotaError = false;
    }
  }

  // Count cards where every requested side was skipped (no candidate text)
  let skippedCards = 0;
  for (let idx = 0; idx < cards.length; idx++) {
    const card = cards[idx];
    const sides = sidesToTts(card, mode);
    if (!sides.front && !sides.back) skippedCards++;
  }

  const stats: AudioStats = {
    mode,
    totalCards: cards.length,
    totalClips: ok,
    failedClips: failed,
    skippedCards,
    sampleErrors: Array.from(errorSamples),
  };
  console.log(`[tts] mode=${mode} cards=${cards.length} clips=${ok} skipped_cards=${skippedCards} failed=${failed}`);
  if (stats.sampleErrors.length > 0) {
    console.log(`[tts] sample errors: ${stats.sampleErrors.map((e) => e.slice(0, 100)).join(' | ')}`);
  }
  return { audio: results, stats };
}
