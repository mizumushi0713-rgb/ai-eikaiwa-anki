'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import AnkiExportModal from './AnkiExportModal';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { Message, AnkiCard, AIProvider } from '@/lib/types';

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

const WELCOME = 'こんにちは！英語学習サポートAIです。英語の質問、日常会話、翻訳など、なんでもお気軽にどうぞ😊';

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    { id: generateId(), role: 'assistant', content: WELCOME, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ankiCards, setAnkiCards] = useState<AnkiCard[] | null>(null);
  const [provider, setProvider] = useState<AIProvider>('gemini');

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    transcript,
    isListening,
    isSupported: speechInputSupported,
    error: speechError,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      resetTranscript();
    }
  }, [transcript, resetTranscript]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: Message = {
        id: generateId(), role: 'user', content: trimmed, timestamp: new Date(),
      };
      const aiMsgId = generateId();
      const aiMsg: Message = {
        id: aiMsgId, role: 'assistant', content: '', timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setInput('');
      setIsLoading(true);

      try {
        const history = [...messages, userMsg].map((m) => ({
          role: m.role, content: m.content,
        }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, provider }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => m.id === aiMsgId ? { ...m, content: fullText } : m)
          );
        }
      } catch (err) {
        console.error(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: '⚠ エラーが発生しました。もう一度お試しください。' }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, provider]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleExtractAnki = async () => {
    if (messages.length < 2 || isExtracting) return;
    setIsExtracting(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/extract-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, provider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnkiCards(data.cards || []);
    } catch (err) {
      console.error(err);
      alert('カードの抽出に失敗しました。もう一度お試しください。');
    } finally {
      setIsExtracting(false);
    }
  };

  const clearChat = () => {
    if (!confirm('会話履歴をクリアしますか？')) return;
    setMessages([
      { id: generateId(), role: 'assistant', content: WELCOME, timestamp: new Date() },
    ]);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-tight">AI英会話</h1>
            <p className="text-xs text-gray-400 leading-tight">English Learning Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Provider toggle */}
          <div className="flex items-center bg-gray-100 rounded-full p-0.5 text-xs font-semibold">
            <button
              onClick={() => setProvider('gemini')}
              className={`px-3 py-1 rounded-full transition-colors ${
                provider === 'gemini'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Gemini
            </button>
            <button
              onClick={() => setProvider('claude')}
              className={`px-3 py-1 rounded-full transition-colors ${
                provider === 'claude'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Claude
            </button>
          </div>

          {/* Anki export */}
          <button
            onClick={handleExtractAnki}
            disabled={isExtracting || messages.length < 2}
            title="この会話からAnkiデッキを作成"
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
          >
            {isExtracting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            Anki
          </button>

          {/* Clear */}
          <button
            onClick={clearChat}
            title="会話をクリア"
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Messages ── */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center mr-2 flex-shrink-0">
              <span className="text-sm">AI</span>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* ── Input Bar ── */}
      <footer className="bg-white border-t border-gray-200 px-4 py-3 safe-area-pb">
        {speechError && (
          <p className="text-xs text-red-500 mb-2 px-1">{speechError}</p>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {speechInputSupported && (
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              title={isListening ? '録音停止' : '英語を音声入力'}
              className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? '聞き取り中...' : 'メッセージを入力... (Enterで送信)'}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-h-32"
            style={{ lineHeight: '1.5' }}
            disabled={isListening}
          />

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
        <p className="text-center text-xs text-gray-300 mt-2">
          Shift+Enter で改行 · Enterで送信
        </p>
      </footer>

      {ankiCards && (
        <AnkiExportModal cards={ankiCards} onClose={() => setAnkiCards(null)} />
      )}
    </div>
  );
}
