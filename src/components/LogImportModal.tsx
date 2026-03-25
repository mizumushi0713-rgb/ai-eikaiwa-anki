'use client';

import { useState } from 'react';
import type { AnkiCard, AIProvider } from '@/lib/types';

interface Props {
  provider: AIProvider;
  onCardsExtracted: (cards: AnkiCard[]) => void;
  onClose: () => void;
}

export default function LogImportModal({ provider, onCardsExtracted, onClose }: Props) {
  const [logText, setLogText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState('');

  const handleExtract = async () => {
    const trimmed = logText.trim();
    if (!trimmed) {
      setError('会話ログを貼り付けてください。');
      return;
    }
    if (trimmed.length < 50) {
      setError('会話ログが短すぎます。');
      return;
    }

    setIsExtracting(true);
    setError('');

    try {
      const res = await fetch('/api/extract-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawLog: trimmed, provider }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.cards || data.cards.length === 0) {
        setError('カードを抽出できませんでした。会話ログの内容を確認してください。');
        return;
      }

      onCardsExtracted(data.cards);
    } catch (err) {
      console.error(err);
      setError('抽出に失敗しました。もう一度お試しください。');
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-lg text-gray-900">会話ログからカード作成</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Gemini Liveなどの会話ログを貼り付けてAnkiカードを生成
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

        {/* Textarea */}
        <div className="flex-1 overflow-y-auto p-4">
          <textarea
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder={`Gemini Liveなどの会話ログをここに貼り付けてください。

例：
あなたのプロンプト
I play drinking party.
That sounds like fun! You can say "I'm going to a drinking party" to sound more natural...`}
            className="w-full h-64 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-2">
            {logText.length > 0 ? `${logText.length}文字` : 'Geminiアプリで会話を開き、全選択→コピーしてください'}
          </p>
        </div>

        {/* Footer */}
        {error && (
          <p className="text-red-500 text-xs px-4 pt-2">{error}</p>
        )}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleExtract}
            disabled={isExtracting || !logText.trim()}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isExtracting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                抽出中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                カードを抽出
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
