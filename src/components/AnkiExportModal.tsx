'use client';

import { useState } from 'react';
import type { AnkiCard, ExportPattern } from '@/lib/types';

interface Props {
  cards: AnkiCard[];
  onClose: () => void;
}

export default function AnkiExportModal({ cards, onClose }: Props) {
  const [pattern, setPattern] = useState<ExportPattern>('en-to-ja');
  const [isDownloading, setIsDownloading] = useState(false);
  const [editedCards, setEditedCards] = useState<AnkiCard[]>(cards);
  const [error, setError] = useState('');

  const handleRemoveCard = (index: number) => {
    setEditedCards((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDownload = async () => {
    if (editedCards.length === 0) {
      setError('カードがありません。');
      return;
    }
    setIsDownloading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: editedCards, pattern }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `AI英会話_${date}.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error(err);
      setError('.apkgの生成に失敗しました。もう一度お試しください。');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-lg text-gray-900">Ankiデッキ作成</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {editedCards.length}枚のカードが抽出されました
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Pattern selection */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-2">カードの向き</p>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pattern"
                value="en-to-ja"
                checked={pattern === 'en-to-ja'}
                onChange={() => setPattern('en-to-ja')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">
                <span className="font-medium">英語</span>
                <span className="text-gray-400 mx-1">→</span>
                日本語
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pattern"
                value="ja-to-en"
                checked={pattern === 'ja-to-en'}
                onChange={() => setPattern('ja-to-en')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">
                <span className="font-medium">日本語</span>
                <span className="text-gray-400 mx-1">→</span>
                英語
              </span>
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            ※ AnkiのTTS機能で英語が自動読み上げされます
          </p>
        </div>

        {/* Card list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {editedCards.map((card, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-xl p-3 relative group"
            >
              <button
                onClick={() => handleRemoveCard(i)}
                className="absolute top-2 right-2 text-gray-300 hover:text-red-400 transition-colors"
                title="このカードを削除"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <p className="font-semibold text-indigo-700 text-sm pr-6">{card.front}</p>
              <p className="text-xs text-gray-700 mt-1">{card.meaning}</p>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                {card.detail}
              </p>
            </div>
          ))}
          {editedCards.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              カードがありません
            </p>
          )}
        </div>

        {/* Footer */}
        {error && (
          <p className="text-red-500 text-xs px-4 pt-2">{error}</p>
        )}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleDownload}
            disabled={isDownloading || editedCards.length === 0}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isDownloading ? (
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                .apkgをダウンロード
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
