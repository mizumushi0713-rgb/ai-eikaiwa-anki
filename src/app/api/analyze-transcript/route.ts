import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard, DeckFormat } from '@/lib/types';
import { GEMINI_MODELS } from '@/lib/models';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const FORMAT_INSTRUCTIONS: Record<DeckFormat, string> = {
  auto:     '英語学習に最も適した形式を自動判断してください。重要フレーズの一問一答、穴埋め、語彙カードなどを混在させても構いません。',
  basic:    'front に英語フレーズ・表現、back に日本語訳と解説を配置してください。type は "basic" のみ。',
  cloze:    '重要な単語・表現を {{c1::語}} の形式で穴埋めにしてください。複数の穴埋めがある場合もすべて {{c1::}} のみ使用（{{c2::}} 以降は禁止）。type は "cloze" のみ。back には日本語訳や補足解説を入れてください。',
  dialogue: '会話文は片方の発話を front に、応答を back に配置。type は "basic" を使用。',
  detailed: '裏面（back）には日本語訳に加え、類似表現・文脈・使い方の解説も詳しく含めてください。type は "basic" を使用。',
};

type Example = { front: string; back: string; type: string };

function formatExamples(examples?: Example[]): string {
  if (!examples || examples.length === 0) return '';
  const list = examples
    .map((e, i) => `[例${i + 1}] type=${e.type}\n  front: ${e.front}\n  back:  ${e.back}`)
    .join('\n');
  return `

【お手本 — 過去に高評価されたカードのフォーマット】
以下のサンプルカードと同じスタイル・構造・言語配置・装飾レベルで生成してください。
${list}`;
}

function buildSystemInstruction(customInstruction?: string, examples?: Example[]): string {
  const base = `あなたは英語学習用Ankiフラッシュカード作成の専門家です。
出力はJSONのみとし、前後に説明文・コードブロックは一切付けないでください。
HTMLタグ（<span style="color:red">...</span>、<b>...</b> など）を front/back に使って装飾しても構いません。`;
  let result = base;
  if (customInstruction?.trim()) {
    result += `

【ユーザーからの追加指示 — 絶対に守ること】
${customInstruction.trim()}
上記の追加指示はすべてのカードに必ず適用し、一切省略・無視しないでください。`;
  }
  result += formatExamples(examples);
  return result;
}

function buildPrompt(text: string, format: DeckFormat, hasCustomInstruction: boolean): string {
  const defaultLangRule = hasCustomInstruction
    ? ''
    : '- back には必ず日本語訳を含める\n';
  const jsonExample = hasCustomInstruction
    ? '{"cards":[{"front":"表面テキスト","back":"裏面テキスト","tags":["タグ"],"type":"basic"}]}'
    : '{"cards":[{"front":"英語テキスト","back":"日本語訳と解説","tags":["タグ"],"type":"basic"}]}';

  return `以下の英語スクリプト（動画字幕やトランスクリプト）を分析し、英語学習に役立つカードを生成してください。

【スクリプト】
${text.slice(0, 8000)}

【カード形式の指示】
${FORMAT_INSTRUCTIONS[format]}

【重要な方針】
- 日常会話・プレゼン・講演で実際に使われる自然な英語表現を優先的に抽出
- 文脈の中で意味が分かる形でカードを作る（文章ごと残してclozeにするのも良い）
- 初・中級者が覚えると役立つ語彙・フレーズに絞る
- front の英語テキストはスクリプトから直接引用するか、自然に短縮したもの
${defaultLangRule}
以下のJSON形式のみで返してください（コードブロック不要）：
${jsonExample}

ルール：
- type は "basic" または "cloze" のみ
- cloze の場合、front に {{c1::重要語}} の形式を必ず使用（{{c2::}} 以降は使用禁止）
- tags は動画のトピック（1〜2個）
- 目標：15〜25枚の高品質カード
- JSONのみを返す`;
}

function parseCards(rawText: string): DeckCard[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { cards: Omit<DeckCard, 'id'>[] };
  return (parsed.cards ?? []).map((c, i) => ({
    id: `transcript-card-${i}-${Date.now()}`,
    front: String(c.front ?? ''),
    back:  String(c.back  ?? ''),
    tags:  Array.isArray(c.tags) ? c.tags.map(String) : [],
    type:  c.type === 'cloze' ? 'cloze' : 'basic',
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      text: string;
      format?: DeckFormat;
      customInstruction?: string;
      examples?: Example[];
    };

    const { text, format = 'auto', customInstruction, examples } = body;
    if (!text?.trim()) {
      return Response.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const hasCustomInstruction = !!customInstruction?.trim();
    const systemInstruction = buildSystemInstruction(customInstruction, examples);
    const prompt = buildPrompt(text, format, hasCustomInstruction);
    let lastError: unknown;

    for (const modelId of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId, systemInstruction });
        const result = await model.generateContent(prompt);
        const cards = parseCards(result.response.text());
        if (cards.length === 0) throw new Error('生成されたカードが0件でした');
        return Response.json({ cards });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        lastError = err;
        if (!is429) break;
      }
    }

    console.error('[analyze-transcript] All models failed:', lastError);
    return Response.json({ error: 'カードの生成に失敗しました。もう一度お試しください。' }, { status: 500 });
  } catch (error) {
    console.error('[analyze-transcript]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
