import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard, DeckFormat } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

function buildPrompt(format: DeckFormat, customInstruction?: string): string {
  const formatInstructions: Record<DeckFormat, string> = {
    auto: '教材の性質に最も適した形式を自動判断してください。一問一答、穴埋め、対話形式などを混在させても構いません。',
    basic: '表面（front）に用語・問い、裏面（back）に答え・定義を配置してください。type は "basic" のみ使用。',
    cloze: '重要な用語や概念を {{c1::用語}} の形式で穴埋めにしてください。type は "cloze" のみ使用。back には補足解説を入れてください。',
    dialogue: '会話文や問答がある場合は片方の発話を front に、応答を back に配置してください。type は "basic" を使用。',
    detailed: '裏面（back）には答えだけでなく、教材内の関連解説・文脈も詳しく含めてください。type は "basic" を使用。',
  };

  const customSection = customInstruction?.trim()
    ? `\n\n【ユーザーからの追加指示（最優先で従うこと）】\n${customInstruction.trim()}\n` +
      `※HTMLタグ（<span style="color:red">...</span> や <b>...</b> など）を front/back に含めて装飾しても構いません。`
    : '';

  return `あなたはAnkiフラッシュカード作成の専門家です。
提供された教材（PDF・画像）を分析し、学習に役立つカードを生成してください。

【カード形式の指示】
${formatInstructions[format]}${customSection}

以下のJSON形式のみで返してください（コードブロック不要）：
{"cards":[{"front":"表面テキスト","back":"裏面テキスト","tags":["タグ1"],"type":"basic"}]}

ルール：
- type は "basic" または "cloze" のみ
- cloze の場合、front に {{c1::重要語}} の形式を必ず使用
- tags は教材のカテゴリや単元名（1〜2個）
- 日本語教材なら日本語で、英語教材なら英語メインでカードを作成
- 目標：10〜20枚の高品質カード
- JSONのみを返す（前後に説明文不要）`;
}

function parseCards(rawText: string): DeckCard[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return (parsed.cards || []).map((c: Omit<DeckCard, 'id'>, i: number) => ({
    id: `card-${i}-${Date.now()}`,
    front: String(c.front || ''),
    back: String(c.back || ''),
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    type: c.type === 'cloze' ? 'cloze' : 'basic',
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      fileData: string;
      mimeType: string;
      format: DeckFormat;
      customInstruction?: string;
    };

    const { fileData, mimeType, format = 'auto', customInstruction } = body;

    if (!fileData || !mimeType) {
      return Response.json({ error: 'ファイルデータが必要です' }, { status: 400 });
    }

    const prompt = buildPrompt(format, customInstruction);
    let lastError: unknown;

    for (const modelId of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent([
          { inlineData: { mimeType, data: fileData } },
          prompt,
        ]);

        const rawText = result.response.text();
        const cards = parseCards(rawText);
        console.log(`[analyze-file] model: ${modelId}, cards: ${cards.length}`);
        return Response.json({ cards });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 =
          msg.includes('429') ||
          msg.includes('quota') ||
          msg.includes('RESOURCE_EXHAUSTED');
        lastError = err;
        console.warn(`[analyze-file] ${modelId} failed: ${msg.slice(0, 100)}`);
        if (!is429) break;
      }
    }

    console.error('[analyze-file] All models failed:', lastError);
    return Response.json(
      { error: 'カードの生成に失敗しました。ファイルサイズや形式を確認してもう一度お試しください。' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[analyze-file]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
