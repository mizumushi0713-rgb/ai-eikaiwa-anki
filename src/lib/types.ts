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
  /** Japanese translation (meaning only, no examples) */
  meaning: string;
  /** Example sentence + usage notes / nuance */
  detail: string;
}

/** Which side shows first in Anki */
export type ExportPattern = 'en-to-ja' | 'ja-to-en';

// ─── Deck Builder ────────────────────────────────────────────────────────────

export interface DeckCard {
  id: string;
  front: string;
  back: string;
  tags: string[];
  type: 'basic' | 'cloze';
}

export type DeckFormat = 'auto' | 'basic' | 'cloze' | 'dialogue' | 'detailed';

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
