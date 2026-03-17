import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const lang = (formData.get('lang') as string) || 'en-US';

    if (!audioFile) {
      return Response.json({ error: '音声データがありません' }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    const langLabel = lang.startsWith('ja') ? '日本語' : '英語';
    const prompt = `この音声を正確に${langLabel}で文字起こししてください。文字起こし結果のテキストのみを返してください。余計な説明や前置きは不要です。音声が聞き取れない場合は空文字を返してください。`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: audioFile.type || 'audio/webm',
          data: base64Audio,
        },
      },
    ]);

    const text = result.response.text().trim();
    return Response.json({ text });
  } catch (error) {
    console.error('[/api/transcribe]', error);
    return Response.json({ error: '文字起こしに失敗しました' }, { status: 500 });
  }
}
