import { NextRequest } from 'next/server';
import { generateApkg } from '@/lib/anki-generator';
import type { GenerateApkgRequest } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body: GenerateApkgRequest = await req.json();
    const { cards, pattern } = body;

    if (!cards || cards.length === 0) {
      return new Response('No cards provided', { status: 400 });
    }
    if (pattern !== 'en-to-ja' && pattern !== 'ja-to-en') {
      return new Response('Invalid pattern', { status: 400 });
    }

    const apkgBuffer = await generateApkg(cards, pattern);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `AI英会話_${date}.apkg`;

    return new Response(new Uint8Array(apkgBuffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(apkgBuffer.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[/api/generate-apkg]', error);
    return new Response('Failed to generate .apkg file', { status: 500 });
  }
}
