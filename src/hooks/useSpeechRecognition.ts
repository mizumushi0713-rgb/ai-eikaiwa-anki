'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type SpeechLang = 'en-US' | 'ja-JP';

interface UseSpeechRecognitionReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  error: string;
  startRecording: (lang: SpeechLang) => void;
  stopRecording: () => void;
  onTranscript: (cb: (text: string) => void) => void;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const callbackRef = useRef<((text: string) => void) | null>(null);
  const langRef = useRef<SpeechLang>('en-US');

  useEffect(() => {
    setIsSupported(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  const onTranscript = useCallback((cb: (text: string) => void) => {
    callbackRef.current = cb;
  }, []);

  const sendToTranscribe = useCallback(async (blob: Blob, lang: SpeechLang) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('lang', lang);

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.text && callbackRef.current) {
        callbackRef.current(data.text);
      }
    } catch (err) {
      console.error('Transcribe error:', err);
      setError('文字起こしに失敗しました。もう一度お試しください。');
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async (lang: SpeechLang) => {
    setError('');
    langRef.current = lang;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          sendToTranscribe(blob, langRef.current);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setError('マイクへのアクセスが拒否されました。ブラウザの設定で許可してください。');
      } else {
        setError('マイクの起動に失敗しました。');
      }
    }
  }, [sendToTranscribe]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    isTranscribing,
    isSupported,
    error,
    startRecording,
    stopRecording,
    onTranscript,
  };
}
