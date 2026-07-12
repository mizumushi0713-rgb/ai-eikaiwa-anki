'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { DeckCard, DeckFormat, CardStyle } from '@/lib/types';
import CropModal from './CropModal';
import {
  loadPatterns,
  savePattern,
  deletePattern,
  findPattern,
  type FavoritePattern,
} from '@/lib/favoritePatterns';

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
  const [inputMode, setInputMode] = useState<'file' | 'script' | 'log'>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [scriptUrl, setScriptUrl] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [isFetchingTranscript, setIsFetchingTranscript] = useState(false);
  const [logText, setLogText] = useState('');
  const [logType, setLogType] = useState<'chat' | 'gemini_live'>('gemini_live');
  const [format, setFormat] = useState<DeckFormat>('auto');
  const [customInstruction, setCustomInstruction] = useState('');
  const [instructionHistory, setInstructionHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [withAudio, setWithAudio] = useState(false);
  const [audioSide, setAudioSide] = useState<'auto' | 'front' | 'back' | 'both'>('auto');
  const [refiningCardId, setRefiningCardId] = useState<string | null>(null);
  const [isQualityChecking, setIsQualityChecking] = useState(false);
  const [qualityMessage, setQualityMessage] = useState('');
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [fixApkgFile, setFixApkgFile] = useState<File | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixMessage, setFixMessage] = useState('');
  const [fixError, setFixError] = useState('');
  const fixInputRef = useRef<HTMLInputElement>(null);
  const [cardStyle, setCardStyle] = useState<Required<CardStyle>>(DEFAULT_CARD_STYLE);
  const [showStyle, setShowStyle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Crop queue: images waiting to be cropped before being added to files[]
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const pendingFilesRef = useRef<File[]>([]); // non-image files that skip crop

  // Favorite patterns (instruction → sample cards) for stable repeat generation
  const [patterns, setPatterns] = useState<FavoritePattern[]>([]);
  const [showPatterns, setShowPatterns] = useState(false);
  const [patternSaved, setPatternSaved] = useState(false);

  // Load instruction history + favorite patterns from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('deckbuilder_instruction_history');
      if (saved) setInstructionHistory(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    setPatterns(loadPatterns());
  }, []);

  // Pattern matched against the current instruction (for the indicator)
  const matchedPattern = customInstruction.trim()
    ? findPattern(customInstruction)
    : null;

  const handleSavePattern = () => {
    const instr = customInstruction.trim();
    if (!instr || cards.length === 0) return;
    const samples = cards.slice(0, 3).map((c) => ({
      front: c.front,
      back: c.back,
      type: c.type,
    }));
    savePattern(instr, samples);
    setPatterns(loadPatterns());
    setPatternSaved(true);
    setTimeout(() => setPatternSaved(false), 2500);
  };

  const handleDeletePattern = (id: string) => {
    deletePattern(id);
    setPatterns(loadPatterns());
  };

  const saveInstructionToHistory = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInstructionHistory((prev) => {
      const deduped = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 15);
      try { localStorage.setItem('deckbuilder_instruction_history', JSON.stringify(deduped)); } catch { /* ignore */ }
      return deduped;
    });
  };

  const deleteHistoryItem = (idx: number) => {
    setInstructionHistory((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      try { localStorage.setItem('deckbuilder_instruction_history', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const updateStyle = <K extends keyof CardStyle>(key: K, value: Required<CardStyle>[K]) => {
    setCardStyle((prev) => ({ ...prev, [key]: value }));
  };

  const VALID_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const [isCompressing, setIsCompressing] = useState(false);

  /** Add files that have already been through crop (and will be compressed). */
  const addFilesAfterCrop = async (accepted: File[], rejected: string[]) => {
    if (rejected.length > 0) setError(`追加できなかったファイル: ${rejected.join(', ')}`);
    if (accepted.length === 0) return;

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

  const addFiles = (newFiles: File[]) => {
    const images: File[] = [];
    const nonImages: File[] = [];
    const rejected: string[] = [];

    for (const f of newFiles) {
      if (!VALID_TYPES.includes(f.type)) { rejected.push(`${f.name}（非対応形式）`); continue; }
      if (f.size > MAX_INPUT_FILE_SIZE) { rejected.push(`${f.name}（${(f.size / 1024 / 1024).toFixed(0)}MB超）`); continue; }
      if (f.type.startsWith('image/')) images.push(f);
      else nonImages.push(f);
    }

    if (rejected.length > 0) setError(`追加できなかったファイル: ${rejected.join(', ')}`);

    // PDFs skip crop and go straight through
    if (nonImages.length > 0) void addFilesAfterCrop(nonImages, []);

    // Images go into the crop queue; pendingFilesRef carries rejected info for later
    if (images.length > 0) {
      pendingFilesRef.current = []; // reset any leftover
      setCropQueue(images);
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

  const handleFetchTranscript = async () => {
    if (!scriptUrl.trim() || isFetchingTranscript) return;
    setIsFetchingTranscript(true);
    setError('');
    try {
      const res = await fetch('/api/fetch-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scriptUrl.trim() }),
      });
      const data = await res.json() as { text?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'エラー');
      setScriptText(data.text ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '字幕の取得に失敗しました。');
    } finally {
      setIsFetchingTranscript(false);
    }
  };

  const handleAnalyzeTranscript = async () => {
    if (!scriptText.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setError('');
    setCards([]);
    if (customInstruction.trim()) saveInstructionToHistory(customInstruction);
    try {
      const res = await fetch('/api/analyze-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText,
          format,
          customInstruction: customInstruction.trim() || undefined,
          examples: matchedPattern?.samples,
        }),
      });
      const data = await res.json() as { cards?: DeckCard[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'エラー');
      setCards(data.cards ?? []);
      if (!deckName && scriptUrl.trim()) setDeckName('英語スクリプト');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'カードの生成に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeLog = async () => {
    if (!logText.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setError('');
    setCards([]);
    if (customInstruction.trim()) saveInstructionToHistory(customInstruction);
    try {
      const res = await fetch('/api/analyze-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: logText,
          logType,
          format,
          customInstruction: customInstruction.trim() || undefined,
          examples: matchedPattern?.samples,
        }),
      });
      const data = await res.json() as { cards?: DeckCard[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'エラー');
      setCards(data.cards ?? []);
      if (!deckName) setDeckName(logType === 'gemini_live' ? 'Gemini Live 会話' : 'AI会話ログ');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'カードの生成に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (files.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    setError('');
    if (customInstruction.trim()) saveInstructionToHistory(customInstruction);

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
          examples: matchedPattern?.samples,
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

  const handleRefineCard = async (card: DeckCard, action: string) => {
    if (refiningCardId) return;
    setRefiningCardId(card.id);
    setError('');
    try {
      const res = await fetch('/api/refine-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card, action }),
      });
      const data = await res.json() as { cards?: DeckCard[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'エラー');
      // Replace the original card with the refined card(s)
      setCards((prev) => {
        const idx = prev.findIndex((c) => c.id === card.id);
        if (idx === -1) return prev;
        return [...prev.slice(0, idx), ...(data.cards ?? []), ...prev.slice(idx + 1)];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'カードの改善に失敗しました。');
    } finally {
      setRefiningCardId(null);
    }
  };

  const handleFixApkg = async () => {
    if (!fixApkgFile || isFixing) return;
    setIsFixing(true);
    setFixMessage('');
    setFixError('');
    try {
      const formData = new FormData();
      formData.append('file', fixApkgFile);
      const res = await fetch('/api/fix-apkg', { method: 'POST', body: formData });
      if (res.headers.get('Content-Type')?.includes('application/json')) {
        const data = await res.json() as { error?: string; debug?: { noteCount: number; clozeCount: number; sampleFlds: string } };
        if (data.error) {
          const dbg = data.debug;
          const debugMsg = dbg ? ` [診断: ノート数=${dbg.noteCount}, cloze含む=${dbg.clozeCount}, サンプル="${dbg.sampleFlds}"]` : '';
          setFixError(data.error + debugMsg);
          return;
        }
      }
      if (!res.ok) { setFixError('修正に失敗しました。'); return; }
      const fixedCount = res.headers.get('X-Fixed-Count') ?? '?';
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch = disposition.match(/filename\*=UTF-8''(.+)/);
      const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : fixApkgFile.name.replace('.apkg', '_fixed.apkg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setFixMessage(`${fixedCount}枚のカードを修正しました。ダウンロードを確認してください。`);
      setFixApkgFile(null);
      if (fixInputRef.current) fixInputRef.current.value = '';
    } catch {
      setFixError('エラーが発生しました。');
    } finally {
      setIsFixing(false);
    }
  };

  const handleQualityCheck = async () => {
    if (cards.length === 0 || isQualityChecking) return;
    setIsQualityChecking(true);
    setQualityMessage('');
    setError('');
    try {
      const res = await fetch('/api/quality-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards }),
      });
      const data = await res.json() as { cards?: DeckCard[]; removed?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'エラー');
      setCards(data.cards ?? []);
      const removed = data.removed ?? 0;
      setQualityMessage(
        removed > 0
          ? `品質チェック完了：${removed}枚を整理しました（重複除去・内容補完）`
          : '品質チェック完了：問題は見つかりませんでした'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '品質チェックに失敗しました。');
    } finally {
      setIsQualityChecking(false);
    }
  };

  const handleExport = () => {
    if (cards.length === 0 || isExporting) return;
    setIsExporting(true);
    setError('');

    if (withAudio) {
      // Use fetch for audio export so we can show a loading spinner
      // (audio generation takes 10-30s depending on card count)
      const payload = { cards, deckName: deckName || '学習デッキ', cardStyle, withAudio: true, audioSide };
      fetch('/api/generate-deck-apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const date = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `${deckName || '学習デッキ'}_${date}.apkg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        })
        .catch((err) => {
          console.error(err);
          setError('.apkgの生成に失敗しました。もう一度お試しください。');
        })
        .finally(() => setIsExporting(false));
      return;
    }

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

  // Crop modal handlers
  const handleCropConfirm = (cropped: File) => {
    void addFilesAfterCrop([cropped], []);
    setCropQueue((q) => q.slice(1));
  };
  const handleCropSkip = () => {
    const original = cropQueue[0];
    if (original) void addFilesAfterCrop([original], []);
    setCropQueue((q) => q.slice(1));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Crop Modal — shown for the first image in the queue */}
      {cropQueue.length > 0 && (
        <CropModal
          file={cropQueue[0]}
          onConfirm={handleCropConfirm}
          onSkip={handleCropSkip}
        />
      )}
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
        {/* Input Mode Tabs */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
          {([
            { mode: 'file',   icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12', label: 'PDF・画像' },
            { mode: 'script', icon: 'M15 10l4.553-2.069A1 1 0 0121 8.867V15.1a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z', label: '動画' },
            { mode: 'log',    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', label: '会話ログ' },
          ] as { mode: 'file' | 'script' | 'log'; icon: string; label: string }[]).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => { setInputMode(mode); setCards([]); setError(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                inputMode === mode
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* Script Mode: URL + text input */}
        {inputMode === 'script' && (
          <div className="space-y-3">
            {/* YouTube URL input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                YouTube URL
                <span className="text-gray-400 font-normal ml-1">（任意）</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={scriptUrl}
                  onChange={(e) => setScriptUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleFetchTranscript}
                  disabled={!scriptUrl.trim() || isFetchingTranscript}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 flex-shrink-0"
                >
                  {isFetchingTranscript ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  )}
                  字幕取得
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">TED・英語動画のYouTube URLを貼るとAI字幕を自動取得します</p>
            </div>

            {/* Transcript text area */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                スクリプト / トランスクリプト
              </label>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="英語スクリプトをここに貼り付けてください。YouTubeのURL取得ボタンで自動入力することもできます。"
                rows={8}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
              {scriptText && (
                <p className="text-xs text-gray-400 mt-1">{scriptText.length.toLocaleString()}文字</p>
              )}
            </div>
          </div>
        )}

        {/* Log Mode: conversation log paste */}
        {inputMode === 'log' && (
          <div className="space-y-3">
            {/* Log type selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ログの種類</label>
              <div className="flex gap-2">
                {([
                  { value: 'gemini_live', label: 'Gemini Live', desc: 'Gemini Liveの会話ログ' },
                  { value: 'chat',        label: 'AIチャット',  desc: 'このアプリのチャットログ' },
                ] as { value: 'chat' | 'gemini_live'; label: string; desc: string }[]).map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => setLogType(value)}
                    title={desc}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${
                      logType === value
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {logType === 'gemini_live'
                  ? 'Gemini Liveの画面からコピーしたテキストを貼り付けてください。AIの修正や提案を中心に抽出します。'
                  : 'このアプリのチャット画面でやり取りしたログを貼り付けてください。'}
              </p>
            </div>

            {/* Log text area */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">会話ログ</label>
              <textarea
                value={logText}
                onChange={(e) => setLogText(e.target.value)}
                placeholder={logType === 'gemini_live'
                  ? 'Gemini Liveの会話ログをここに貼り付けてください...'
                  : 'AIチャットの会話ログをここに貼り付けてください...'}
                rows={10}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
              {logText && (
                <p className="text-xs text-gray-400 mt-1">{logText.length.toLocaleString()}文字</p>
              )}
            </div>
          </div>
        )}

        {/* File Upload Zone + file list — only in file mode */}
        {inputMode === 'file' && (
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
        )}

        {/* Selected files list — only in file mode */}
        {inputMode === 'file' && files.length > 0 && (
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
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">
              AIへの追加指示 <span className="text-gray-400 font-normal">（任意）</span>
            </label>
            {instructionHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                履歴 ({instructionHistory.length})
              </button>
            )}
          </div>

          {/* History list */}
          {showHistory && instructionHistory.length > 0 && (
            <ul className="mb-2 bg-white border border-indigo-100 rounded-xl divide-y divide-gray-100 shadow-sm max-h-56 overflow-y-auto">
              {instructionHistory.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { setCustomInstruction(item); setShowHistory(false); }}
                    className="flex-1 text-left text-xs text-gray-700 hover:text-indigo-700 leading-relaxed whitespace-pre-wrap line-clamp-3"
                  >
                    {item}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteHistoryItem(idx)}
                    className="text-gray-300 hover:text-red-400 flex-shrink-0 mt-0.5"
                    title="削除"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="例：重要語を赤字で強調して&#10;例：なるべく文章を残して文脈の中で問題を出して&#10;例：第3章の動詞だけ抽出して"
            rows={3}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            HTMLタグ（&lt;span style=&quot;color:red&quot;&gt;...&lt;/span&gt;など）も使えます · カード生成時に自動保存
          </p>

          {/* Pattern-matched indicator */}
          {matchedPattern && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span>👍</span>
              <span className="flex-1">
                この指示には<b>お手本{matchedPattern.samples.length}枚</b>が保存されています。次の生成に自動で適用されます。
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <p className="text-sm text-red-600 flex-1">{error}</p>
            <button
              onClick={() => {
                setError('');
                if (inputMode === 'script') handleAnalyzeTranscript();
                else if (inputMode === 'log') handleAnalyzeLog();
                else handleAnalyze();
              }}
              className="text-xs text-red-600 border border-red-300 rounded-lg px-2 py-1 hover:bg-red-100 flex-shrink-0 font-medium"
            >
              再試行
            </button>
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={
            inputMode === 'script' ? handleAnalyzeTranscript
            : inputMode === 'log'  ? handleAnalyzeLog
            : handleAnalyze
          }
          disabled={
            isAnalyzing || isCompressing ||
            (inputMode === 'file'   ? files.length === 0
            : inputMode === 'script' ? !scriptText.trim()
            : !logText.trim())
          }
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
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-800 text-sm">
                {cards.length}枚のカード
              </h2>
              <div className="flex items-center gap-2">
                {customInstruction.trim() && (
                  <button
                    onClick={handleSavePattern}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                    title="この指示と生成結果をお手本として保存。次回以降、同じ指示で安定生成"
                  >
                    👍 お手本保存
                  </button>
                )}
                <button
                  onClick={handleQualityCheck}
                  disabled={isQualityChecking}
                  className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1 disabled:opacity-50"
                  title="重複除去・内容補完・品質チェック"
                >
                  {isQualityChecking ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                  品質チェック
                </button>
                <button
                  onClick={addCard}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  追加
                </button>
              </div>
            </div>

            {qualityMessage && (
              <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 mb-3">
                {qualityMessage}
              </p>
            )}

            {patternSaved && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
                ✓ お手本として保存しました。次回同じ指示で生成すると自動で適用されます。
              </p>
            )}

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

                  {/* Per-card AI refine actions */}
                  <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-1.5">
                    {refiningCardId === card.id ? (
                      <span className="text-xs text-indigo-500 flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        AI改善中...
                      </span>
                    ) : (
                      <>
                        {[
                          { action: 'simplify', label: 'シンプルに' },
                          { action: 'elaborate', label: '詳しく' },
                          { action: 'example', label: '例文を追加' },
                          { action: 'split', label: '分割' },
                        ].map(({ action, label }) => (
                          <button
                            key={action}
                            onClick={() => handleRefineCard(card, action)}
                            disabled={!!refiningCardId}
                            className="text-xs px-2 py-0.5 rounded-full border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 transition-colors"
                          >
                            ✨ {label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Audio option + Export Button */}
            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withAudio}
                  onChange={(e) => setWithAudio(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-emerald-600 flex-shrink-0"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">AI音声を付ける</span>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Gemini音声を埋め込みます。カード数により生成に時間がかかります（目安：10枚で約20秒）
                  </p>
                </div>
              </label>

              {withAudio && (
                <div className="ml-7">
                  <p className="text-xs font-medium text-gray-600 mb-1.5">音声を付ける面</p>
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 text-xs">
                    {([
                      { value: 'auto',  label: '自動',  desc: '各カードで英語の面を検出' },
                      { value: 'front', label: '表面',  desc: '常に表面をTTS' },
                      { value: 'back',  label: '裏面',  desc: '常に裏面をTTS' },
                      { value: 'both',  label: '両面',  desc: '表面と裏面の両方をTTS（時間・APIコスト2倍）' },
                    ] as { value: typeof audioSide; label: string; desc: string }[]).map(({ value, label, desc }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAudioSide(value)}
                        title={desc}
                        className={`flex-1 py-1.5 font-medium transition-colors ${
                          audioSide === value
                            ? 'bg-white text-emerald-700 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {audioSide === 'auto'  && '各カードで英語の面（front/back）を自動判定して音声を付けます'}
                    {audioSide === 'front' && 'すべてのカードの表面に音声を付けます'}
                    {audioSide === 'back'  && 'すべてのカードの裏面に音声を付けます'}
                    {audioSide === 'both'  && '表面と裏面の両方に音声を付けます（生成時間・APIコストが2倍）'}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={handleExport}
              disabled={isExporting || cards.length === 0}
              className="w-full mt-3 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {withAudio ? 'AI音声を生成中...' : '生成中...'}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {withAudio ? 'AI音声付きでエクスポート (.apkg)' : 'Ankiデッキをエクスポート (.apkg)'}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Saved favorite patterns management */}
      <div className="max-w-lg mx-auto px-4 pb-3">
        <details
          className="bg-white rounded-2xl border border-gray-200 shadow-sm"
          open={showPatterns}
          onToggle={(e) => setShowPatterns((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-5 py-4 cursor-pointer text-sm font-medium text-gray-700 flex items-center gap-2 select-none list-none">
            <span className="text-emerald-500">👍</span>
            保存済みのお手本パターン
            <span className="ml-auto text-xs text-gray-400 font-normal">{patterns.length}件</span>
          </summary>
          <div className="px-5 pb-5 pt-2 space-y-3">
            <p className="text-xs text-gray-500">
              ここに保存された「追加指示 + お手本カード」は、同じ指示でカード生成するときに自動でAIへ渡され、
              出力フォーマットが安定します。
            </p>
            {patterns.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                まだ保存されたパターンはありません。カード生成後に「👍 お手本保存」を押すと追加されます。
              </p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {patterns.map((p) => (
                  <li key={p.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs text-gray-700 whitespace-pre-wrap flex-1 leading-relaxed">
                        <span className="font-semibold text-emerald-700">指示：</span>
                        {p.instruction}
                      </p>
                      <button
                        onClick={() => handleDeletePattern(p.id)}
                        className="text-gray-300 hover:text-red-500 flex-shrink-0"
                        title="このパターンを削除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                      </button>
                    </div>
                    <details>
                      <summary className="text-xs text-indigo-600 cursor-pointer hover:text-indigo-700">
                        お手本カード {p.samples.length}枚を表示
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {p.samples.map((s, i) => (
                          <li key={i} className="text-xs bg-white rounded-lg border border-gray-200 px-2 py-1.5">
                            <div className="text-gray-500">
                              <span className="font-mono text-[10px] bg-gray-100 px-1 rounded mr-1">{s.type}</span>
                              <span className="font-semibold">front:</span> {s.front}
                            </div>
                            <div className="text-gray-500"><span className="font-semibold">back:</span> {s.back}</div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>

      {/* Fix existing .apkg section */}
      <div className="max-w-lg mx-auto px-4 pb-10">
        <details className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <summary className="px-5 py-4 cursor-pointer text-sm font-medium text-gray-700 flex items-center gap-2 select-none list-none">
            <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            既存デッキのcloze修正（c2以降→c1に変換）
          </summary>
          <div className="px-5 pb-5 pt-2 space-y-3">
            <p className="text-xs text-gray-500">
              過去に作成した .apkg ファイルに含まれる <code className="bg-gray-100 px-1 rounded">{'{{c2::}}'}</code> 以降の穴埋めを
              すべて <code className="bg-gray-100 px-1 rounded">{'{{c1::}}'}</code> に変換して再ダウンロードできます。
            </p>

            <label className="block">
              <span className="text-xs font-medium text-gray-600 mb-1 block">.apkg ファイルを選択</span>
              <input
                ref={fixInputRef}
                type="file"
                accept=".apkg"
                onChange={(e) => {
                  setFixApkgFile(e.target.files?.[0] ?? null);
                  setFixMessage('');
                  setFixError('');
                }}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
              />
            </label>

            {fixApkgFile && (
              <p className="text-xs text-gray-500">選択中: {fixApkgFile.name}</p>
            )}

            {fixError && (
              <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                {fixError}
              </p>
            )}
            {fixMessage && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                ✓ {fixMessage}
              </p>
            )}

            <button
              onClick={handleFixApkg}
              disabled={!fixApkgFile || isFixing}
              className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {isFixing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  処理中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  修正してダウンロード
                </>
              )}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
