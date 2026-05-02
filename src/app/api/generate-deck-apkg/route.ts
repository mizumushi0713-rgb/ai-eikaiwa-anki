import { NextRequest } from 'next/server';
import { generateApkgFromDeckCards } from '@/lib/deck-generator';
import type { DeckCard } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    // Accept either JSON (fetch path) or form-urlencoded with `payload`
    // (form.submit() path used for reliable mobile downloads).
    const contentType = req.headers.get('content-type') || '';
    let cards: DeckCard[] = [];
    let deckName = '学習デッキ';

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const raw = form.get('payload');
      if (typeof raw !== 'string') {
        return new Response('Missing payload', { status: 400 });
      }
      const parsed = JSON.parse(raw) as { cards: DeckCard[]; deckName?: string };
      cards = parsed.cards;
      if (parsed.deckName) deckName = parsed.deckName;
    } else {
      const body = await req.json() as { cards: DeckCard[]; deckName?: string };
      cards = body.cards;
      if (body.deckName) deckName = body.deckName;
    }

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
