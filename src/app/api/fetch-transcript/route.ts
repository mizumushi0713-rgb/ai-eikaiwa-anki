import { YoutubeTranscript } from 'youtube-transcript';
import { NextRequest } from 'next/server';

/** Extract a YouTube video ID from various URL forms */
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    // https://www.youtube.com/watch?v=XXXX
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // https://www.youtube.com/shorts/XXXX
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] ?? null;
    }
    // https://youtu.be/XXXX
    if (u.hostname === 'youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] ?? null;
    }
  } catch {
    // Allow bare video IDs (11 chars)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url: string };
    if (!url) return Response.json({ error: 'URLが必要です' }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return Response.json({ error: '有効なYouTube URLを入力してください' }, { status: 400 });

    // Try English transcript first, then fall back to any available language
    let segments;
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    }

    if (!segments || segments.length === 0) {
      return Response.json({ error: 'この動画には字幕がありません' }, { status: 404 });
    }

    // Join segments into readable text with basic sentence grouping
    const text = segments
      .map((s) => s.text.replace(/\n/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return Response.json({ text, segmentCount: segments.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[fetch-transcript]', msg);
    if (msg.includes('Could not get') || msg.includes('No transcript')) {
      return Response.json({ error: '字幕を取得できませんでした。字幕なし動画か、取得が制限されている可能性があります。' }, { status: 404 });
    }
    return Response.json({ error: '字幕の取得に失敗しました。もう一度お試しください。' }, { status: 500 });
  }
}
