import { NextRequest } from 'next/server';
import { generateApkgFromDeckCards } from '@/lib/deck-generator';
import type { DeckCard } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { cards: DeckCard[]; deckName: string };
    const { cards, deckName = '学習デッキ' } = body;

    if (!cards || cards.length === 0) {
      return new Response('No cards provided', { status: 400 });
    }

    const apkgBuffer = await generateApkgFromDeckCards(cards, deckName);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${deckName}_${date}.apkg`;

    return new Response(new Uint8Array(apkgBuffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(apkgBuffer.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[/api/generate-deck-apkg]', error);
    return new Response('Failed to generate .apkg file', { status: 500 });
  }
}
