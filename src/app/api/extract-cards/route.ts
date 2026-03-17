import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { ExtractCardsRequest, ExtractCardsResponse } from '@/lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const EXTRACTION_PROMPT = `あなたは英語学習カード作成の専門家です。
提供された会話を分析し、ユーザーがAnkiで学ぶべき項目を抽出してください。

"cards" 配列を持つJSONオブジェクトを返してください。各カードは以下を含めてください：
- "front": 英単語・フレーズ・表現（簡潔に）
- "back": 以下を含む日本語の学習メモ
  1. 日本語訳（最初の行）
  2. 会話中の例文または自然な例文
  3. 語源・ニュアンス・使い方のコツ（2〜3文）

抽出対象：
- ユーザーが知らない可能性のある中〜上級語彙
- イディオムや自然な定型表現
- 訂正された表現や改善提案された言い方
- 覚える価値のある文法パターン

除外：基本的すぎる単語、固有名詞、明らかに既知の語。
目標：5〜10枚の高品質カード。

必ずJSONのみを返してください（マークダウンのコードブロック不要）。
形式例：
{"cards":[{"front":"come up with","back":"〜を思いつく・考え出す\n\n例文: \"I came up with a great idea this morning.\"\n\n使い方: アイデアや解決策を「頭の中から生み出す」ニュアンス。"}]}`;

function parseCards(rawText: string): ExtractCardsResponse {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

async function extractWithClaude(conversationText: string): Promise<ExtractCardsResponse> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: EXTRACTION_PROMPT,
    max_tokens: 2048,
    messages: [{ role: 'user', content: `以下の会話からAnkiカードを抽出してください：\n\n${conversationText}` }],
  });
  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  return parseCards(rawText);
}

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

async function extractWithGemini(conversationText: string): Promise<ExtractCardsResponse> {
  let lastError: unknown;
  for (const modelId of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: EXTRACTION_PROMPT,
      });
      const result = await model.generateContent(
        `以下の会話からAnkiカードを抽出してください：\n\n${conversationText}`
      );
      console.log(`[Gemini extract] using model: ${modelId}`);
      return parseCards(result.response.text());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
      console.warn(`[Gemini extract] ${modelId} failed, trying next...`);
      lastError = err;
      if (!is429) break;
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ExtractCardsRequest & { provider?: string };
    const { messages, provider = 'claude' } = body;

    if (!messages || messages.length < 2) {
      return Response.json({ error: '会話が短すぎてカードを抽出できません。' }, { status: 400 });
    }

    const recentMessages = messages.slice(-20);
    const conversationText = recentMessages
      .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
      .join('\n\n');

    let parsed: ExtractCardsResponse;
    try {
      parsed = provider === 'gemini'
        ? await extractWithGemini(conversationText)
        : await extractWithClaude(conversationText);
    } catch {
      return Response.json({ error: 'カードデータの解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(parsed);
  } catch (error) {
    console.error('[/api/extract-cards]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
