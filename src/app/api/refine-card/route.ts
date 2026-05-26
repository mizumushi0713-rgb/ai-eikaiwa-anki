import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { DeckCard } from '@/lib/types';
import { GEMINI_MODELS } from '@/lib/models';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

const QUICK_ACTIONS: Record<string, string> = {
  simplify: '表現をよりシンプルで分かりやすくしてください。',
  elaborate: '裏面の解説をより詳しく充実させてください。',
  example: '裏面に具体的な例文や使用例を追加してください。',
  split: 'このカードの内容が複雑な場合は2〜3枚に分割してください。',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      card: DeckCard;
      action?: string;    // preset action key
      instruction?: string; // custom instruction text
    };

    const { card, action, instruction } = body;

    if (!card) {
      return Response.json({ error: 'カードデータが必要です' }, { status: 400 });
    }

    const directive = action
      ? (QUICK_ACTIONS[action] ?? instruction ?? 'カードをより良くしてください。')
      : (instruction ?? 'カードをより良くしてください。');

    const prompt = `以下のAnkiフラッシュカードを改善してください。

【現在のカード】
表面 (front): ${card.front}
裏面 (back): ${card.back}
タイプ: ${card.type}
タグ: ${card.tags.join(', ') || 'なし'}

【改善指示】
${directive}

以下のJSON形式のみで返してください（コードブロック不要）：
{"cards":[{"front":"表面テキスト","back":"裏面テキスト","tags":["タグ"],"type":"${card.type}"}]}

ルール：
- type は元のカードと同じ "${card.type}" を使用
- cloze の場合は front に {{c1::重要語}} の形式のみ使用（{{c2::}} 以降は使用禁止。複数穴埋めもすべて {{c1::}} で統一）
- 改善後は1〜3枚で返す（分割が必要な場合のみ複数）
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
        const refined: DeckCard[] = (parsed.cards || []).map((c, i) => ({
          id: `${card.id}-refined-${i}-${Date.now()}`,
          front: String(c.front || ''),
          back: String(c.back || ''),
          tags: Array.isArray(c.tags) ? c.tags.map(String) : card.tags,
          type: c.type === 'cloze' ? 'cloze' : 'basic',
        }));
        return Response.json({ cards: refined });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        lastError = err;
        if (!is429) break;
      }
    }

    console.error('[refine-card] All models failed:', lastError);
    return Response.json({ error: '改善に失敗しました。もう一度お試しください。' }, { status: 500 });
  } catch (error) {
    console.error('[refine-card]', error);
    return Response.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
