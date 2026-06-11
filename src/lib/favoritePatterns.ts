/**
 * Favorite "instruction → cards" patterns.
 *
 * When the user gives a 👍 to a generation, we save the custom instruction
 * together with a few sample cards as an exemplar. Next time the same (or
 * a normalized-match) instruction is used, those samples are injected into
 * the AI prompt as a few-shot example so the output stays consistent.
 *
 * Storage: localStorage (per-browser).
 */

const STORAGE_KEY = 'deckbuilder_favorite_patterns';
const MAX_PATTERNS = 30;

export interface PatternSample {
  front: string;
  back: string;
  type: 'basic' | 'cloze';
}

export interface FavoritePattern {
  id: string;
  instruction: string; // original text (shown to user)
  key: string;         // normalized text (used for matching)
  samples: PatternSample[];
  createdAt: number;
}

/** Normalize an instruction for matching (case + whitespace insensitive). */
export function normalizeInstruction(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function loadPatterns(): FavoritePattern[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FavoritePattern[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(patterns: FavoritePattern[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
  } catch {
    /* quota exceeded or storage disabled — silent fail */
  }
}

/** Save a new pattern (replaces existing one with same normalized key). */
export function savePattern(
  instruction: string,
  samples: PatternSample[],
): FavoritePattern {
  const key = normalizeInstruction(instruction);
  const next: FavoritePattern = {
    id: `pat-${Date.now()}`,
    instruction: instruction.trim(),
    key,
    samples,
    createdAt: Date.now(),
  };
  const existing = loadPatterns().filter((p) => p.key !== key);
  const all = [next, ...existing].slice(0, MAX_PATTERNS);
  persist(all);
  return next;
}

export function deletePattern(id: string) {
  const remaining = loadPatterns().filter((p) => p.id !== id);
  persist(remaining);
}

/** Find a saved pattern matching the given instruction (normalized). */
export function findPattern(instruction: string): FavoritePattern | null {
  const key = normalizeInstruction(instruction);
  if (!key) return null;
  return loadPatterns().find((p) => p.key === key) ?? null;
}
