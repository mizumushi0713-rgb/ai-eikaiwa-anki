import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { ExtractCardsRequest, ExtractCardsResponse } from '@/lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const EXTRACTION_PROMPT = `あなたは英語学習カード作成の専門家です。
提供された会話を分析し、ユーザーがAnkiで学ぶべき項目を抽出してください。

"cards" 配列を持つJSONオブジェクトを返してください。各カードは以下の3フィールドを含めてください：
- "front": 英単語・フレーズ・表現（簡潔に）
- "meaning": 日本語訳のみ（1行、例文は含めない）
- "detail": 例文と解説を含む学習メモ。例文は英語の後に必ず日本語訳を括弧で添える。解説は日本語で2〜3文

抽出対象：
- ユーザーが知らない可能性のある中〜上級語彙
- イディオムや自然な定型表現
- 訂正された表現や改善提案された言い方
- 覚える価値のある文法パターン

除外：基本的すぎる単語、固有名詞、明らかに既知の語。
目標：5〜10枚の高品質カード。

必ずJSONのみを返してください（マークダウンのコードブロック不要）。
形式例：
{"cards":[{"front":"come up with","meaning":"〜を思いつく・考え出す","detail":"例文: \\"I came up with a great idea this morning.\\"（今朝、素晴らしいアイデアを思いついた。）\\n\\nアイデアや解決策を「頭の中から生み出す」ニュアンス。thinkより創造的な響き。"}]}`;

const LOG_EXTRACTION_PROMPT = `あなたは英語学習カード作成の専門家です。
以下はユーザーがAI（Gemini Liveなど）と英会話練習をした際の会話ログです。

【重要】このログには以下が含まれます：
- ユーザーの発話（文法ミスや不自然な表現を含む）
- AIの応答（正しい英語表現）
- AIによる文法修正や表現のアドバイス

【抽出ルール】
1. ユーザーの間違った表現はカードにしない
2. AIが教えた正しい表現・修正後の表現をカードにする
3. AIが提案したフィラー、つなぎ表現、ぼかし表現なども抽出する
4. ユーザーの誤文→正しい文のペアがある場合、正しい方をカードにし、detailに「誤: ○○ → 正: ○○」の形で修正ポイントを明記する
5. 会話の中でAIが使った自然な英語表現も、学習価値があれば抽出する

"cards" 配列を持つJSONオブジェクトを返してください。各カードは以下の3フィールドを含めてください：
- "front": 正しい英語の表現・フレーズ（簡潔に）
- "meaning": 日本語訳のみ（1行、例文は含めない）
- "detail": 例文と解説を含む学習メモ。例文は英語の後に必ず日本語訳を括弧で添える。修正ポイントがあれば「誤: ○○ → 正: ○○」も含める。解説は日本語で2〜3文

除外：基本的すぎる単語、固有名詞、明らかに既知の語、ログ中の余分なUI要素やURL。
目標：5〜15枚の高品質カード。

必ずJSONのみを返してください（マークダウンのコードブロック不要）。
形式例：
{"cards":[{"front":"I'm going to a drinking party","meaning":"飲み会に行く","detail":"例文: \\"I'm going to a drinking party with my friends this Friday.\\"（今週の金曜に友達と飲み会に行きます。）\\n\\n誤: I play drinking party → 正: I'm going to a drinking party\\n\\"play\\"は遊ぶ・競技する意味なので、飲み会には使えない。\\"go to\\"を使う。"}]}`;

const MAX_CONVERSATION_CHARS = 6000;
const MAX_LOG_CHARS = 10000;

function parseCards(rawText: string): ExtractCardsResponse {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

async function extractWithClaude(conversationText: string, isLog: boolean): Promise<ExtractCardsResponse> {
  const systemPrompt = isLog ? LOG_EXTRACTION_PROMPT : EXTRACTION_PROMPT;
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt,
    max_tokens: 4096,
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

async function extractWithGemini(conversationText: string, isLog: boolean): Promise<ExtractCardsResponse> {
  const systemPrompt = isLog ? LOG_EXTRACTION_PROMPT : EXTRACTION_PROMPT;
  let lastError: unknown;
  for (const modelId of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
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
    const body = await req.json() as ExtractCardsRequest & { provider?: string; rawLog?: string };
    const { messages, provider = 'gemini', rawLog } = body;

    let conversationText: string;
    let isLog = false;

    if (rawLog) {
      // External conversation log (e.g. Gemini Live)
      isLog = true;
      conversationText = rawLog.length > MAX_LOG_CHARS
        ? rawLog.slice(0, MAX_LOG_CHARS)
        : rawLog;
    } else {
      if (!messages || messages.length < 2) {
        return Response.json({ error: '会話が短すぎてカードを抽出できません。' }, { status: 400 });
      }

      const recentMessages = messages.slice(-20);
      conversationText = recentMessages
        .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
        .join('\n\n');

      if (conversationText.length > MAX_CONVERSATION_CHARS) {
        conversationText = conversationText.slice(-MAX_CONVERSATION_CHARS);
      }
    }

    let parsed: ExtractCardsResponse;
    try {
      parsed = provider === 'gemini'
        ? await extractWithGemini(conversationText, isLog)
        : await extractWithClaude(conversationText, isLog);
    } catch {
      return Response.json({ error: 'カードデータの解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(parsed);
  } catch (error) {
    console.error('[/api/extract-cards]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
