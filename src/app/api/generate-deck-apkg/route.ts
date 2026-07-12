import { NextRequest } from 'next/server';
import { generateApkgFromDeckCards } from '@/lib/deck-generator';
import { generateAudioFiles, type AudioSide } from '@/lib/tts-utils';
import type { DeckCard, CardStyle } from '@/lib/types';

type Payload = {
  cards: DeckCard[];
  deckName?: string;
  cardStyle?: CardStyle;
  withAudio?: boolean;
  audioSide?: AudioSide;
};

export async function POST(req: NextRequest) {
  try {
    // Accept either JSON (fetch path) or form-urlencoded with `payload`
    // (form.submit() path used for reliable mobile downloads).
    const contentType = req.headers.get('content-type') || '';
    let cards: DeckCard[] = [];
    let deckName = '学習デッキ';
    let cardStyle: CardStyle | undefined;
    let withAudio = false;
    let audioSide: AudioSide = 'auto';

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const raw = form.get('payload');
      if (typeof raw !== 'string') {
        return new Response('Missing payload', { status: 400 });
      }
      const parsed = JSON.parse(raw) as Payload;
      cards = parsed.cards;
      if (parsed.deckName) deckName = parsed.deckName;
      cardStyle = parsed.cardStyle;
      withAudio = parsed.withAudio ?? false;
      if (parsed.audioSide) audioSide = parsed.audioSide;
    } else {
      const body = await req.json() as Payload;
      cards = body.cards;
      if (body.deckName) deckName = body.deckName;
      cardStyle = body.cardStyle;
      withAudio = body.withAudio ?? false;
      if (body.audioSide) audioSide = body.audioSide;
    }

    if (!cards || cards.length === 0) {
      return new Response('No cards provided', { status: 400 });
    }

    // Generate Gemini TTS audio using the user-selected side mode.
    let audioResult: Awaited<ReturnType<typeof generateAudioFiles>> | undefined;
    if (withAudio && process.env.GOOGLE_API_KEY) {
      audioResult = await generateAudioFiles(
        cards.map((c) => ({ front: c.front, back: c.back })),
        process.env.GOOGLE_API_KEY,
        { audioSide }
      );
    }

    const apkgBuffer = await generateApkgFromDeckCards(cards, deckName, cardStyle, audioResult?.audio);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${deckName}_${date}.apkg`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(apkgBuffer.length),
      'Cache-Control': 'no-cache',
    };
    if (audioResult) {
      // Expose CORS-safelisted-ish headers so the browser fetch layer can read them
      headers['Access-Control-Expose-Headers'] = 'X-Audio-Stats';
      headers['X-Audio-Stats'] = encodeURIComponent(JSON.stringify(audioResult.stats));
    }

    return new Response(new Uint8Array(apkgBuffer), { headers });
  } catch (error) {
    console.error('[/api/generate-deck-apkg]', error);
    return new Response('Failed to generate .apkg file', { status: 500 });
  }
}
