import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard, DeckFormat } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

const FORMAT_INSTRUCTIONS: Record<DeckFormat, string> = {
  auto: 'ログの性質に合わせて最適な形式を自動判断してください。一問一答、穴埋めなど混在可。',
  basic: 'front に英語フレーズ・表現、back に日本語訳と解説・例文を配置。type は "basic" のみ。',
  cloze: '重要な単語・表現を {{c1::語}} の形式で穴埋め。複数穴埋めもすべて {{c1::}} のみ使用（{{c2::}} 以降禁止）。back には日本語訳・解説。type は "cloze" のみ。',
  dialogue: '会話の発話ペアを front（問いかけ）/ back（応答）に配置。type は "basic"。',
  detailed: 'back には日本語訳に加え、類似表現・使い方・修正ポイントなど詳しい解説も含める。type は "basic"。',
};

function buildPrompt(
  text: string,
  logType: 'chat' | 'gemini_live',
  format: DeckFormat,
  customInstruction?: string,
): string {
  const intro = logType === 'gemini_live'
    ? `以下はユーザーがGemini Liveと英会話練習した会話ログです。
【ログの特徴】
- ユーザーの発話（文法ミスや不自然な表現を含む場合あり）
- AIの応答（正しい英語表現・フィードバック）
- AIによる文法修正・表現アドバイス

【抽出ルール】
1. ユーザーの誤った表現はカードにしない
2. AIが教えた正しい表現・修正後の表現を優先的にカードにする
3. 誤文→正文のペアがある場合、back に「誤: ○○ → 正: ○○」の形で修正ポイントを明記
4. AIが使った自然な英語表現も学習価値があれば抽出
5. フィラー・つなぎ表現・ぼかし表現なども抽出対象`
    : `以下はAIとのチャット会話ログです。会話の中で登場した英語表現・語彙・フレーズを学習カードとして抽出してください。
【抽出対象】
- 中〜上級レベルの語彙・イディオム・定型表現
- 訂正された表現や改善提案された言い方
- 覚える価値のある文法パターン
【除外】基本的すぎる単語、固有名詞、明らかに既知の語`;

  const formatInstruction = FORMAT_INSTRUCTIONS[format];

  const customSection = customInstruction?.trim()
    ? `\n\n【ユーザーからの追加指示（最優先で従うこと）】\n${customInstruction.trim()}\n※HTMLタグ（<b>...</b>、<span style="color:red">...</span> 等）も front/back に使用可`
    : '';

  return `あなたは英語学習Ankiカード作成の専門家です。

${intro}

【ログ本文】
${text.slice(0, 10000)}

【カード形式の指示】
${formatInstruction}${customSection}

【共通ルール】
- back には必ず日本語訳を含める
- 例文がある場合は英語の後に日本語訳を括弧で添える
- tags は会話のトピックや単元（1〜2個）
- 目標：5〜20枚の高品質カード

以下のJSON形式のみで返してください（コードブロック不要）：
{"cards":[{"front":"英語表現","back":"日本語訳と解説","tags":["タグ"],"type":"basic"}]}

ルール：
- type は "basic" または "cloze" のみ
- cloze の場合 front に {{c1::重要語}} の形式を使用（{{c2::}} 以降は使用禁止）
- JSONのみを返す`;
}

function parseCards(rawText: string): DeckCard[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { cards: Omit<DeckCard, 'id'>[] };
  return (parsed.cards ?? []).map((c, i) => ({
    id: `log-card-${i}-${Date.now()}`,
    front: String(c.front ?? ''),
    back: String(c.back ?? ''),
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    type: c.type === 'cloze' ? 'cloze' : 'basic',
  }));
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

    const prompt = buildPrompt(text, logType, format, customInstruction);
    let lastError: unknown;

    for (const modelId of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const cards = parseCards(result.response.text());
        if (cards.length === 0) throw new Error('カードが生成されませんでした');
        return Response.json({ cards });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        lastError = err;
        if (!is429) break;
      }
    }

    console.error('[analyze-log] All models failed:', lastError);
    return Response.json({ error: 'カードの生成に失敗しました。もう一度お試しください。' }, { status: 500 });
  } catch (error) {
    console.error('[analyze-log]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
