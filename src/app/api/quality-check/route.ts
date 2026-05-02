import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { cards: DeckCard[] };
    const { cards } = body;

    if (!cards || cards.length === 0) {
      return Response.json({ error: 'カードが必要です' }, { status: 400 });
    }

    const cardList = cards.map((c, i) =>
      `[${i}] front: ${c.front} | back: ${c.back} | type: ${c.type}`
    ).join('\n');

    const prompt = `以下のAnkiカード一覧の品質チェックを行ってください。

${cardList}

以下のすべての問題を修正してください：
1. 裏面が空またはほぼ空のカード → 適切な内容を補完
2. 重複・類似カード → 最も良い1枚に統合
3. 表面が長すぎて問いとして不明確 → 簡潔な問いに修正
4. 裏面が「表面の繰り返し」になっているカード → 解説や例を加える
5. cloze カードで {{c1::...}} フォーマットが崩れているもの → 修正

以下のJSON形式のみで返してください（コードブロック不要）：
{"cards":[{"front":"表面テキスト","back":"裏面テキスト","tags":["タグ"],"type":"basic"}]}

ルール：
- type は "basic" または "cloze" のみ
- 元のカードより枚数が減っても構わない（重複排除のため）
- 品質に問題がないカードはそのまま保持
- JSONのみを返す`;

    let lastError: unknown;

    for (const modelId of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const raw = result.response.text()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const parsed = JSON.parse(raw) as { cards: Omit<DeckCard, 'id'>[] };
        const checked: DeckCard[] = (parsed.cards || []).map((c, i) => ({
          id: `card-qc-${i}-${Date.now()}`,
          front: String(c.front || ''),
          back: String(c.back || ''),
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
          type: c.type === 'cloze' ? 'cloze' : 'basic',
        }));
        const removed = cards.length - checked.length;
        return Response.json({ cards: checked, removed });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        lastError = err;
        if (!is429) break;
      }
    }

    console.error('[quality-check] All models failed:', lastError);
    return Response.json({ error: '品質チェックに失敗しました。もう一度お試しください。' }, { status: 500 });
  } catch (error) {
    console.error('[quality-check]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
