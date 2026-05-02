'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import type { DeckCard, DeckFormat, CardStyle } from '@/lib/types';

const FORMAT_OPTIONS: { value: DeckFormat; label: string; desc: string }[] = [
  { value: 'auto', label: 'おまかせ', desc: 'AIが最適な形式を自動判断' },
  { value: 'basic', label: 'ベーシック（一問一答）', desc: '表面に問い・用語、裏面に答え・定義' },
  { value: 'cloze', label: '穴埋め（Cloze）', desc: '重要語を空欄にする穴埋め形式' },
  { value: 'dialogue', label: '対話応答', desc: '会話文から問答形式のカードを生成' },
  { value: 'detailed', label: '解説付き', desc: '裏面に答えと詳しい解説を含む' },
];

const MAX_INPUT_FILE_SIZE = 15 * 1024 * 1024; // 15MB per file BEFORE compression
const MAX_TOTAL_SIZE = 3 * 1024 * 1024; // 3MB combined AFTER compression (Vercel hobby request body ~4.5MB; base64 inflates ~33%)
const IMAGE_MAX_DIMENSION = 1600; // px
const IMAGE_JPEG_QUALITY = 0.82;

/**
 * Compress a user-supplied image by downscaling and re-encoding as JPEG.
 * Returns the original file unchanged if it's not an image or compression
 * doesn't reduce the size.
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  let { width, height } = img;
  const longest = Math.max(width, height);
  if (longest > IMAGE_MAX_DIMENSION) {
    const scale = IMAGE_MAX_DIMENSION / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      IMAGE_JPEG_QUALITY
    );
  });

  if (blob.size >= file.size) return file;
  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}

const DEFAULT_CARD_STYLE: Required<CardStyle> = {
  frontColor: '#1a1a2e',
  frontColorDark: '#ffffff',
  frontFontSize: 22,
  backColor: '#333333',
  backColorDark: '#e8e8e8',
  backFontSize: 16,
  backBold: false,
};

export default function DeckBuilder() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<DeckFormat>('auto');
  const [customInstruction, setCustomInstruction] = useState('');
  const [deckName, setDeckName] = useState('');
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [cardStyle, setCardStyle] = useState<Required<CardStyle>>(DEFAULT_CARD_STYLE);
  const [showStyle, setShowStyle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateStyle = <K extends keyof CardStyle>(key: K, value: Required<CardStyle>[K]) => {
    setCardStyle((prev) => ({ ...prev, [key]: value }));
  };

  const VALID_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const [isCompressing, setIsCompressing] = useState(false);

  const addFiles = async (newFiles: File[]) => {
    // Pre-filter format / size before compression
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of newFiles) {
      if (!VALID_TYPES.includes(f.type)) {
        rejected.push(`${f.name}（非対応形式）`);
        continue;
      }
      if (f.size > MAX_INPUT_FILE_SIZE) {
        rejected.push(`${f.name}（${(f.size / 1024 / 1024).toFixed(0)}MB超）`);
        continue;
      }
      accepted.push(f);
    }
    if (rejected.length > 0) {
      setError(`追加できなかったファイル: ${rejected.join(', ')}`);
    }
    if (accepted.length === 0) return;

    // Compress images in parallel
    setIsCompressing(true);
    let compressed: File[];
    try {
      compressed = await Promise.all(accepted.map(compressImage));
    } finally {
      setIsCompressing(false);
    }

    setFiles((prev) => {
      const combined = [...prev, ...compressed];
      const total = combined.reduce((sum, f) => sum + f.size, 0);
      if (total > MAX_TOTAL_SIZE) {
        setError(
          `合計サイズが大きすぎます（上限 ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)}MB）。` +
          `ファイルを減らすか、PDFのサイズを小さくしてください。`
        );
        return prev;
      }
      if (rejected.length === 0) setError('');
      return combined;
    });

    if (!deckName && compressed.length > 0) {
      setDeckName(compressed[0].name.replace(/\.[^.]+$/, ''));
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) void addFiles(dropped);
  };

  const handleAnalyze = async () => {
    if (files.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    setError('');

    try {
      const fileList = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ fileData: string; mimeType: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve({ fileData: result.split(',')[1], mimeType: file.type });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );

      const res = await fetch('/api/analyze-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: fileList,
          format,
          customInstruction: customInstruction.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `エラーが発生しました (HTTP ${res.status})`);
      }

      const data = await res.json();
      setCards(data.cards || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'カードの生成に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateCard = (id: string, field: 'front' | 'back', value: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const deleteCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const addCard = () => {
    setCards((prev) => [
      ...prev,
      { id: `card-new-${Date.now()}`, front: '', back: '', tags: [], type: 'basic' },
    ]);
  };

  const handleExport = () => {
    if (cards.length === 0 || isExporting) return;
    setIsExporting(true);
    setError('');

    // Native form POST submission triggers a real browser download with the
    // server-supplied filename (Content-Disposition). This is the only reliable
    // path on mobile Safari/Chrome where blob URL + a.download is unreliable.
    try {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/generate-deck-apkg';
      form.enctype = 'application/x-www-form-urlencoded';
      form.style.display = 'none';

      const payload = document.createElement('input');
      payload.type = 'hidden';
      payload.name = 'payload';
      payload.value = JSON.stringify({ cards, deckName: deckName || '学習デッキ', cardStyle });
      form.appendChild(payload);

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch {
      setError('エクスポートに失敗しました。もう一度お試しください。');
    } finally {
      // Slight delay to let the browser pick up the response.
      setTimeout(() => setIsExporting(false), 1500);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10 shadow-sm">
        <Link
          href="/"
          className="text-gray-400 hover:text-gray-600 p-1 -ml-1 rounded-full"
          title="チャットに戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="font-bold text-gray-900 text-sm leading-tight">Deck Builder</h1>
          <p className="text-xs text-gray-400 leading-tight">PDF・画像からAnkiデッキを作成</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* File Upload Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-indigo-400 bg-indigo-50'
              : files.length > 0
              ? 'border-green-300 bg-green-50'
              : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length > 0) void addFiles(selected);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          {isCompressing ? (
            <div>
              <svg className="w-7 h-7 text-indigo-400 mx-auto mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <p className="text-sm text-indigo-600">画像を圧縮中...</p>
            </div>
          ) : files.length > 0 ? (
            <div>
              <svg className="w-7 h-7 text-green-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-green-700">
                {files.length}個のファイルを選択中
                <span className="text-gray-400 font-normal ml-1">
                  ({(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)}KB / {(MAX_TOTAL_SIZE / 1024).toFixed(0)}KB)
                </span>
              </p>
              <p className="text-xs text-gray-400 mt-1">タップしてさらに追加</p>
            </div>
          ) : (
            <div>
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-gray-600">PDFまたは画像をアップロード</p>
              <p className="text-xs text-gray-400 mt-1">複数選択可 · PDF / JPG / PNG / WebP · 画像は自動圧縮</p>
            </div>
          )}
        </div>

        {/* Selected files list */}
        {files.length > 0 && (
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 -mt-2">
            {files.map((f, idx) => (
              <li key={`${f.name}-${idx}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate text-gray-700">{f.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {(f.size / 1024).toFixed(0)}KB
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                  className="text-gray-300 hover:text-red-400 flex-shrink-0 ml-2"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Deck Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">デッキ名</label>
          <input
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder="例：英検2級単語、TOEIC文法"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Format Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">カード形式</label>
          <div className="space-y-2">
            {FORMAT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  format === opt.value
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={opt.value}
                  checked={format === opt.value}
                  onChange={() => setFormat(opt.value)}
                  className="text-indigo-600 flex-shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Card Style */}
        <div>
          <button
            type="button"
            onClick={() => setShowStyle((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 mb-2"
          >
            <span>カードスタイル <span className="text-gray-400 font-normal">（任意）</span></span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${showStyle ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showStyle && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
              {/* Preview */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-white p-3" style={{ color: cardStyle.frontColor }}>
                  <div
                    className="text-center mb-2"
                    style={{ fontSize: `${cardStyle.frontFontSize}px`, fontWeight: 'bold', color: cardStyle.frontColor }}
                  >
                    表面プレビュー
                  </div>
                  <hr className="my-2 border-gray-200" />
                  <div
                    style={{
                      fontSize: `${cardStyle.backFontSize}px`,
                      color: cardStyle.backColor,
                      fontWeight: cardStyle.backBold ? 'bold' : 'normal',
                    }}
                  >
                    裏面プレビュー：これは裏面の表示サンプルです。
                  </div>
                </div>
                <div className="p-3" style={{ background: '#1a1a1a' }}>
                  <div
                    className="text-center mb-2"
                    style={{
                      fontSize: `${cardStyle.frontFontSize}px`,
                      fontWeight: 'bold',
                      color: cardStyle.frontColorDark,
                    }}
                  >
                    表面プレビュー（ダーク）
                  </div>
                  <hr className="my-2 border-gray-700" />
                  <div
                    style={{
                      fontSize: `${cardStyle.backFontSize}px`,
                      color: cardStyle.backColorDark,
                      fontWeight: cardStyle.backBold ? 'bold' : 'normal',
                    }}
                  >
                    裏面プレビュー：ダークモードでの見え方
                  </div>
                </div>
              </div>

              {/* Front controls */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">表面 文字色（ライト）</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cardStyle.frontColor}
                      onChange={(e) => updateStyle('frontColor', e.target.value)}
                      className="w-9 h-9 rounded border border-gray-300 cursor-pointer flex-shrink-0"
                    />
                    <input
                      type="text"
                      value={cardStyle.frontColor}
                      onChange={(e) => updateStyle('frontColor', e.target.value)}
                      className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">表面 文字色（ダーク）</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cardStyle.frontColorDark}
                      onChange={(e) => updateStyle('frontColorDark', e.target.value)}
                      className="w-9 h-9 rounded border border-gray-300 cursor-pointer flex-shrink-0"
                    />
                    <input
                      type="text"
                      value={cardStyle.frontColorDark}
                      onChange={(e) => updateStyle('frontColorDark', e.target.value)}
                      className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  表面 文字サイズ：<span className="font-mono text-gray-700">{cardStyle.frontFontSize}px</span>
                </label>
                <input
                  type="range"
                  min={14}
                  max={40}
                  step={1}
                  value={cardStyle.frontFontSize}
                  onChange={(e) => updateStyle('frontFontSize', Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* Back controls */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">裏面 文字色（ライト）</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cardStyle.backColor}
                      onChange={(e) => updateStyle('backColor', e.target.value)}
                      className="w-9 h-9 rounded border border-gray-300 cursor-pointer flex-shrink-0"
                    />
                    <input
                      type="text"
                      value={cardStyle.backColor}
                      onChange={(e) => updateStyle('backColor', e.target.value)}
                      className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">裏面 文字色（ダーク）</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cardStyle.backColorDark}
                      onChange={(e) => updateStyle('backColorDark', e.target.value)}
                      className="w-9 h-9 rounded border border-gray-300 cursor-pointer flex-shrink-0"
                    />
                    <input
                      type="text"
                      value={cardStyle.backColorDark}
                      onChange={(e) => updateStyle('backColorDark', e.target.value)}
                      className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  裏面 文字サイズ：<span className="font-mono text-gray-700">{cardStyle.backFontSize}px</span>
                </label>
                <input
                  type="range"
                  min={12}
                  max={32}
                  step={1}
                  value={cardStyle.backFontSize}
                  onChange={(e) => updateStyle('backFontSize', Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={cardStyle.backBold}
                  onChange={(e) => updateStyle('backBold', e.target.checked)}
                  className="accent-indigo-600"
                />
                裏面を太字にする
              </label>

              <button
                type="button"
                onClick={() => setCardStyle(DEFAULT_CARD_STYLE)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                既定値に戻す
              </button>
            </div>
          )}
        </div>

        {/* Custom Instruction */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            AIへの追加指示 <span className="text-gray-400 font-normal">（任意）</span>
          </label>
          <textarea
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="例：重要語を赤字で強調して&#10;例：なるべく文章を残して文脈の中で問題を出して&#10;例：第3章の動詞だけ抽出して"
            rows={3}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            HTMLタグ（&lt;span style=&quot;color:red&quot;&gt;...&lt;/span&gt;など）も使えます
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        {/* Generate Button */}
        <button
          onClick={handleAnalyze}
          disabled={files.length === 0 || isAnalyzing || isCompressing}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {isAnalyzing ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              AIがカードを生成中...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              カードを生成
            </>
          )}
        </button>

        {/* Generated Cards */}
        {cards.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 text-sm">
                {cards.length}枚のカードが生成されました
              </h2>
              <button
                onClick={addCard}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                カードを追加
              </button>
            </div>

            <div className="space-y-3">
              {cards.map((card, idx) => (
                <div key={card.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        card.type === 'cloze'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {card.type === 'cloze' ? '穴埋め' : 'ベーシック'}
                      </span>
                      {card.tags.length > 0 && (
                        <span className="text-xs text-gray-400">{card.tags.join(' ')}</span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteCard(card.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors"
                      title="このカードを削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <label className="text-xs font-semibold text-indigo-600 mb-0.5 block">
                        {card.type === 'cloze' ? 'テキスト（穴埋め）' : '表面'}
                      </label>
                      <textarea
                        value={card.front}
                        onChange={(e) => updateCard(card.id, 'front', e.target.value)}
                        rows={card.type === 'cloze' ? 3 : 2}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-0.5 block">
                        {card.type === 'cloze' ? '補足（Extra）' : '裏面'}
                      </label>
                      <textarea
                        value={card.back}
                        onChange={(e) => updateCard(card.id, 'back', e.target.value)}
                        rows={3}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Export Button */}
            <button
              onClick={handleExport}
              disabled={isExporting || cards.length === 0}
              className="w-full mt-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Ankiデッキをエクスポート (.apkg)
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
