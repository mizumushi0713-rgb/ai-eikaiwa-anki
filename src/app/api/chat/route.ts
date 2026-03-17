import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import type { ChatRequest } from '@/lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

// 品質順・RPD順に並べたフォールバックリスト
// 429（枠切れ）が出たら自動的に次のモデルへ
const GEMINI_MODELS = [
  'gemini-2.5-flash',           // 最高品質 (20 RPD)
  'gemini-2.5-flash-lite',      // 軽量版   (20 RPD)
  'gemini-3.1-flash-lite-preview', // 最大枠 (500 RPD)
];

const SYSTEM_PROMPT = `あなたは日本語で話す、親切で熱心な英語学習サポートAIです。

【基本的な振る舞い】
- 返答は基本的に**日本語**で行ってください。
- ユーザーが日常の出来事・英語の質問・翻訳依頼・その他どんな話題を持ちかけてきても、温かく自然に対応してください。
- 返答は簡潔にまとめてください（通常3〜6文程度）。長い説明が必要な場合はその限りではありません。

【英語サポートの方法】
- ユーザーが英語を使ってきた場合、その英語に文法ミスや不自然な表現があれば、日本語で優しく解説しながら自然な言い方を教えてください。訂正は ✎ マークを使って示してください。例：「✎ "I am agree" より "I agree" が自然です。"agree" は状態動詞なので be動詞は不要なんです。」
- 会話の中で役立つ英単語・フレーズが出てきたら、積極的に英語表現も交えて教えてください。
- ユーザーから英訳・和訳を求められた場合は、訳文とあわせてニュアンスや使い方の補足も日本語で添えてください。

【目標】
ユーザーが楽しみながら自然に英語力を伸ばせるよう、日本語で丁寧にサポートすることがあなたの役割です。`;

// ── Claude (Anthropic) streaming ─────────────────────────────────────────────
async function streamClaude(
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<ReadableStream> {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT,
    max_tokens: 1024,
    messages,
  });

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// ── Gemini (Google) streaming with model fallback ─────────────────────────────
async function streamGemini(
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<ReadableStream> {
  // Gemini requires the first message to be 'user', so drop leading assistant messages
  const trimmed = messages.slice(0, -1);
  const firstUserIdx = trimmed.findIndex((m) => m.role === 'user');
  const history = (firstUserIdx === -1 ? [] : trimmed.slice(firstUserIdx)).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1].content;

  let lastError: unknown;

  for (const modelId of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: SYSTEM_PROMPT,
      });
      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(lastMessage);

      console.log(`[Gemini] using model: ${modelId}`);

      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) controller.enqueue(new TextEncoder().encode(text));
            }
          } finally {
            controller.close();
          }
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
      console.warn(`[Gemini] ${modelId} failed (${is429 ? 'quota' : 'error'}), trying next...`);
      lastError = err;
      if (!is429) break; // 429以外のエラーはフォールバックしない
    }
  }

  // 全モデル失敗 → エラーをスロー
  throw lastError;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ChatRequest & { provider?: string };
    const { messages, provider = 'claude' } = body;

    if (!messages || messages.length === 0) {
      return new Response('No messages provided', { status: 400 });
    }

    const stream =
      provider === 'gemini'
        ? await streamGemini(messages)
        : await streamClaude(messages);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[/api/chat]', error);
    return new Response('Internal server error', { status: 500 });
  }
}
