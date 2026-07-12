import { NextRequest } from 'next/server';
import { generateApkg } from '@/lib/anki-generator';
import { generateAudioFiles } from '@/lib/tts-utils';
import type { GenerateApkgRequest } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as GenerateApkgRequest & { deckName?: string; withAudio?: boolean };
    const { cards, pattern, deckName, withAudio } = body;

    if (!cards || cards.length === 0) {
      return new Response('No cards provided', { status: 400 });
    }
    if (pattern !== 'en-to-ja' && pattern !== 'ja-to-en') {
      return new Response('Invalid pattern', { status: 400 });
    }

    // Generate audio for English texts if requested.
    // card.front is always the English phrase regardless of pattern,
    // so we pass an empty back — TTS will always pick front.
    let audioFiles: (Buffer | null)[] | undefined;
    if (withAudio && process.env.GOOGLE_API_KEY) {
      const { audio } = await generateAudioFiles(
        cards.map((c) => ({ front: c.front, back: '' })),
        process.env.GOOGLE_API_KEY,
        { audioSide: 'front' }
      );
      audioFiles = audio.map((r) => r?.frontWav ?? null);
    }

    const apkgBuffer = await generateApkg(cards, pattern, deckName, audioFiles);

    const resolvedName = deckName?.trim() || 'AI英会話';
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${resolvedName}_${date}.apkg`;

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
