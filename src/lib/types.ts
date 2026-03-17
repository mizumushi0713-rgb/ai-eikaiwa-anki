// ─── Chat ───────────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
}

// ─── Anki Cards ─────────────────────────────────────────────────────────────

export interface AnkiCard {
  /** English word / phrase */
  front: string;
  /** Japanese translation + example sentence + etymology / nuance */
  back: string;
}

/** Which side shows first in Anki */
export type ExportPattern = 'en-to-ja' | 'ja-to-en';

// ─── AI Provider ─────────────────────────────────────────────────────────────

export type AIProvider = 'claude' | 'gemini';

// ─── API payloads ────────────────────────────────────────────────────────────

export interface ChatRequest {
  messages: { role: Role; content: string }[];
  provider?: AIProvider;
}

export interface ExtractCardsRequest {
  messages: { role: Role; content: string }[];
}

export interface ExtractCardsResponse {
  cards: AnkiCard[];
}

export interface GenerateApkgRequest {
  cards: AnkiCard[];
  pattern: ExportPattern;
}
