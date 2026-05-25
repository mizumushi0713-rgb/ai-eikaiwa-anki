import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard, DeckFormat } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

// Chunk settings — keep each chunk well within Gemini's input limit
// while staying under Vercel's 60 s function timeout when processed sequentially.
const CHUNK_SIZE    = 9000;  // chars per chunk
const CHUNK_OVERLAP = 400;   // overlap to avoid cutting mid-expression

const FORMAT_INSTRUCTIONS: Record<DeckFormat, string> = {
  auto:     'ログの性質に合わせて最適な形式を自動判断してください。一問一答、穴埋めなど混在可。',
  basic:    'front に英語フレーズ・表現、back に日本語訳と解説・例文を配置。type は "basic" のみ。',
  cloze:    '重要な単語・表現を {{c1::語}} の形式で穴埋め。複数穴埋めもすべて {{c1::}} のみ使用（{{c2::}} 以降禁止）。back には日本語訳・解説。type は "cloze" のみ。',
  dialogue: '会話の発話ペアを front（問いかけ）/ back（応答）に配置。type は "basic"。',
  detailed: 'back には日本語訳に加え、類似表現・使い方・修正ポイントなど詳しい解説も含める。type は "basic"。',
};

/** Split text into overlapping chunks so no content is skipped. */
function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Simple deduplication: discard cards whose front text is too similar
 * to one already in the list (based on first 30 normalised chars).
 */
function deduplicateCards(cards: DeckCard[]): DeckCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = card.front
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .slice(0, 30);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** System instruction: expert persona + custom directive in the high-priority channel. */
function buildSystemInstruction(
  logType: 'chat' | 'gemini_live',
  customInstruction?: string,
): string {
  const logRules = logType === 'gemini_live'
    ? `【ログ種別：Gemini Live 英会話練習】
抽出ルール：
1. ユーザーの誤った表現はカードにしない
2. AIが教えた正しい表現・修正後の表現を優先的にカードにする
3. 誤文→正文のペアは back に「誤: ○○ → 正: ○○」の形で明記する
4. AIが使った自然な英語表現も学習価値があれば抽出する
5. フィラー・つなぎ表現・ぼかし表現なども抽出対象`
    : `【ログ種別：AIチャット会話ログ】
抽出対象：中〜上級の語彙・イディオム・定型表現・訂正された表現・文法パターン
除外：基本的すぎる単語、固有名詞、明らかに既知の語`;

  const base = `あなたは英語学習Ankiカード作成の専門家です。
出力はJSONのみとし、前後に説明文・コードブロックは一切付けないでください。
HTMLタグ（<span style="color:red">...</span>、<b>...</b> など）を front/back に使って装飾しても構いません。

${logRules}`;

  if (!customInstruction?.trim()) return base;
  return `${base}

【ユーザーからの追加指示 — 絶対に守ること】
${customInstruction.trim()}
上記の追加指示はすべてのカードに必ず適用し、一切省略・無視しないでください。`;
}

function buildPrompt(
  chunk: string,
  logType: 'chat' | 'gemini_live',
  format: DeckFormat,
  chunkLabel: string,
  targetCards: number,
  hasCustomInstruction: boolean,
): string {
  const intro = logType === 'gemini_live'
    ? `Gemini Live 会話ログ${chunkLabel}から、学習価値の高い英語表現をAnkiカードとして抽出してください。`
    : `AIチャット会話ログ${chunkLabel}から、学習価値の高い英語表現をAnkiカードとして抽出してください。`;

  // Default language rule: only applied when there is NO custom instruction.
  // If the user specified front/back language themselves, this line would conflict.
  const defaultLangRule = hasCustomInstruction
    ? ''
    : '- back には必ず日本語訳を含める\n- 例文がある場合は英語の後に日本語訳を括弧で添える\n';

  // JSON schema example: neutral when custom instruction governs layout
  const jsonExample = hasCustomInstruction
    ? '{"cards":[{"front":"表面テキスト","back":"裏面テキスト","tags":["タグ"],"type":"basic"}]}'
    : '{"cards":[{"front":"英語表現","back":"日本語訳と解説","tags":["タグ"],"type":"basic"}]}';

  return `${intro}

【ログ本文】
${chunk}

【カード形式の指示】
${FORMAT_INSTRUCTIONS[format]}

【共通ルール】
${defaultLangRule}- tags は会話のトピックや単元（1〜2個）
- このブロックから ${targetCards} 枚程度の高品質カードを抽出する（重要な表現を見逃さないこと）

以下のJSON形式のみで返してください（コードブロック不要）：
${jsonExample}

ルール：
- type は "basic" または "cloze" のみ
- cloze の場合 front に {{c1::重要語}} の形式を使用（{{c2::}} 以降は使用禁止）
- JSONのみを返す`;
}

function parseCards(rawText: string, chunkIndex: number): DeckCard[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { cards: Omit<DeckCard, 'id'>[] };
  return (parsed.cards ?? []).map((c, i) => ({
    id: `log-c${chunkIndex}-${i}-${Date.now()}`,
    front: String(c.front ?? ''),
    back:  String(c.back  ?? ''),
    tags:  Array.isArray(c.tags) ? c.tags.map(String) : [],
    type:  c.type === 'cloze' ? 'cloze' : 'basic',
  }));
}

/** Call Gemini with fallback across models. */
async function callGemini(prompt: string, systemInstruction: string): Promise<string> {
  let lastError: unknown;
  for (const modelId of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId, systemInstruction });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
      lastError = err;
      if (!is429) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      text: string;
      logType?: 'chat' | 'gemini_live';
      format?: DeckFormat;
      customInstruction?: string;
    };

    const { text, logType = 'chat', format = 'auto', customInstruction } = body;

    if (!text?.trim()) {
      return Response.json({ error: 'ログテキストが必要です' }, { status: 400 });
    }

    const chunks = splitIntoChunks(text.trim());
    const totalChunks = chunks.length;
    const targetPerChunk = totalChunks === 1 ? 20 : 12;

    const hasCustomInstruction = !!customInstruction?.trim();
    const systemInstruction = buildSystemInstruction(logType, customInstruction);
    const allCards: DeckCard[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkLabel = totalChunks > 1 ? `（${i + 1}/${totalChunks}ブロック目）` : '';
      const prompt = buildPrompt(chunks[i], logType, format, chunkLabel, targetPerChunk, hasCustomInstruction);
      try {
        const raw = await callGemini(prompt, systemInstruction);
        const cards = parseCards(raw, i);
        allCards.push(...cards);
      } catch (err) {
        // Log failure but continue with remaining chunks
        console.error(`[analyze-log] chunk ${i + 1}/${totalChunks} failed:`, err);
      }
    }

    if (allCards.length === 0) {
      return Response.json({ error: 'カードが生成されませんでした。もう一度お試しください。' }, { status: 500 });
    }

    const cards = deduplicateCards(allCards);
    return Response.json({ cards, chunks: totalChunks });
  } catch (error) {
    console.error('[analyze-log]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
