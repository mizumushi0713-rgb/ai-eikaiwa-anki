/**
 * Central model configuration — override via Vercel environment variables
 * without needing to redeploy code.
 *
 * Vercel dashboard: Settings → Environment Variables
 * ─────────────────────────────────────────────────────────────────────────────
 * GEMINI_MODEL_PRIMARY   default: gemini-2.5-flash
 * GEMINI_MODEL_FALLBACK1 default: gemini-2.5-flash-lite
 * GEMINI_MODEL_FALLBACK2 default: gemini-3.1-flash-lite-preview
 * CLAUDE_CHAT_MODEL      default: claude-sonnet-4-6
 * CLAUDE_MODEL           default: claude-haiku-4-5-20251001
 * GEMINI_TTS_MODEL       default: gemini-2.5-flash-preview-tts
 * GEMINI_STT_MODEL       default: gemini-2.5-flash
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Gemini text-generation models in priority order (best quality → fallback). */
export const GEMINI_MODELS: string[] = [
  process.env.GEMINI_MODEL_PRIMARY   ?? 'gemini-2.5-flash',
  process.env.GEMINI_MODEL_FALLBACK1 ?? 'gemini-2.5-flash-lite',
  process.env.GEMINI_MODEL_FALLBACK2 ?? 'gemini-3.1-flash-lite-preview',
].filter(Boolean);

/** Claude model used for the chat / conversation feature. */
export const CLAUDE_CHAT_MODEL = process.env.CLAUDE_CHAT_MODEL ?? 'claude-sonnet-4-6';

/** Claude model used for card extraction from conversation logs. */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';

/** Gemini model used for text-to-speech (TTS). */
export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';

/** Gemini model used for speech-to-text (STT / transcription). */
export const GEMINI_STT_MODEL = process.env.GEMINI_STT_MODEL ?? 'gemini-2.5-flash';
