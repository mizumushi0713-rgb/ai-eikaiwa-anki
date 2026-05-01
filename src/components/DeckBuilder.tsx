'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import type { DeckCard, DeckFormat } from '@/lib/types';

const FORMAT_OPTIONS: { value: DeckFormat; label: string; desc: string }[] = [
  { value: 'auto', label: 'おまかせ', desc: 'AIが最適な形式を自動判断' },
  { value: 'basic', label: 'ベーシック（一問一答）', desc: '表面に問い・用語、裏面に答え・定義' },
  { value: 'cloze', label: '穴埋め（Cloze）', desc: '重要語を空欄にする穴埋め形式' },
  { value: 'dialogue', label: '対話応答', desc: '会話文から問答形式のカードを生成' },
  { value: 'detailed', label: '解説付き', desc: '裏面に答えと詳しい解説を含む' },
];

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB

export default function DeckBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<DeckFormat>('auto');
  const [customInstruction, setCustomInstruction] = useState('');
  const [deckName, setDeckName] = useState('');
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(f.type)) {
      setError('PDF、JPG、PNG、WebPファイルのみ対応しています。');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`ファイルサイズが大きすぎます（最大3MB）。現在: ${(f.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    setFile(f);
    setError('');
    if (!deckName) setDeckName(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleAnalyze = async () => {
    if (!file || isAnalyzing) return;
    setIsAnalyzing(true);
    setError('');

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/analyze-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData: base64,
          mimeType: file.type,
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

  const handleExport = async () => {
    if (cards.length === 0 || isExporting) return;
    setIsExporting(true);
    setError('');

    try {
      const res = await fetch('/api/generate-deck-apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards, deckName: deckName || '学習デッキ' }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deckName || '学習デッキ'}_${new Date().toISOString().slice(0, 10)}.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('エクスポートに失敗しました。もう一度お試しください。');
    } finally {
      setIsExporting(false);
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
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-indigo-400 bg-indigo-50'
              : file
              ? 'border-green-300 bg-green-50'
              : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {file ? (
            <div>
              <svg className="w-8 h-8 text-green-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium text-green-700 text-sm">{file.name}</p>
              <p className="text-xs text-gray-400 mt-1">
                {(file.size / 1024).toFixed(0)} KB · タップして変更
              </p>
            </div>
          ) : (
            <div>
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-gray-600">PDFまたは画像をアップロード</p>
              <p className="text-xs text-gray-400 mt-1">PDF / JPG / PNG / WebP · 最大3MB</p>
            </div>
          )}
        </div>

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
          disabled={!file || isAnalyzing}
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
