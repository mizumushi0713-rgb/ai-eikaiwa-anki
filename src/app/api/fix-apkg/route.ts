import { NextRequest } from 'next/server';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return Response.json({ error: 'ファイルが必要です' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Anki2 uses collection.anki21 (newer) or collection.anki2 (older)
    const dbEntry = zip.file('collection.anki21') ?? zip.file('collection.anki2');
    if (!dbEntry) {
      return Response.json({ error: '有効な .apkg ファイルではありません' }, { status: 400 });
    }
    const dbFileName = zip.file('collection.anki21') ? 'collection.anki21' : 'collection.anki2';

    const dbBuffer = await dbEntry.async('arraybuffer');

    const wasmPath = path.join(process.cwd(), 'public', 'sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    const SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer });
    const db = new SQL.Database(new Uint8Array(dbBuffer));

    // Fetch all notes and fix in JavaScript (avoids potential LIKE quoting issues with {{)
    const result = db.exec('SELECT id, flds FROM notes');
    let fixedCount = 0;
    let noteCount = 0;
    let clozeCount = 0;
    let sampleFlds = '';

    if (result.length > 0) {
      noteCount = result[0].values.length;
      for (const row of result[0].values) {
        const id = row[0] as number;
        const flds = String(row[1] ?? '');
        if (flds.includes('{{c')) {
          clozeCount++;
          if (!sampleFlds) sampleFlds = flds.slice(0, 150);
        }
        // Replace {{c2::...{{c9:: (single digit) and {{c10:: and above with {{c1::
        const newFlds = flds.replace(/\{\{c([2-9]|\d{2,})::/g, '{{c1::');
        if (newFlds !== flds) {
          db.run('UPDATE notes SET flds = ? WHERE id = ?', [newFlds, id]);
          // Remove extra card rows (ord > 0) for this note — they're now unreachable
          db.run('DELETE FROM cards WHERE nid = ? AND ord > 0', [id]);
          fixedCount++;
        }
      }
    }

    if (fixedCount === 0) {
      db.close();
      return Response.json({
        error: '修正が必要なカードは見つかりませんでした（すでにc1のみのデッキです）',
        debug: { noteCount, clozeCount, sampleFlds },
      }, { status: 200 });
    }

    const exported = new Uint8Array(db.export());
    db.close();

    zip.file(dbFileName, exported);
    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const originalName = file.name.replace(/\.apkg$/i, '');
    const filename = `${originalName}_fixed.apkg`;

    return new Response(new Uint8Array(outBuffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Fixed-Count': String(fixedCount),
      },
    });
  } catch (error) {
    console.error('[fix-apkg]', error);
    return Response.json({ error: 'ファイルの処理に失敗しました。' }, { status: 500 });
  }
}
