'use client';

import { Message } from '@/lib/types';

interface Props {
  message: Message;
  onTTS?: () => void;
  isPlaying?: boolean;
}

export default function MessageBubble({ message, onTTS, isPlaying }: Props) {
  const isUser = message.role === 'user';

  const time = message.timestamp.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Render text with correction highlights (✎ ... )
  const renderContent = (text: string) => {
    const parts = text.split(/(✎[^✎]*?\))/g);
    return parts.map((part, i) => {
      if (part.startsWith('✎')) {
        return (
          <span
            key={i}
            className="inline-block bg-amber-50 border border-amber-200 text-amber-800 rounded px-1 text-sm my-0.5"
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center mr-2 mt-1">
          <span className="text-sm">AI</span>
        </div>
      )}

      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100'
          }`}
        >
          {renderContent(message.content)}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-400">{time}</span>
          {onTTS && (
            <button
              onClick={onTTS}
              title={isPlaying ? '停止' : '読み上げ'}
              className={`p-1 rounded-full transition-colors ${
                isPlaying
                  ? 'text-indigo-600 bg-indigo-50'
                  : 'text-gray-400 hover:text-indigo-500 hover:bg-gray-100'
              }`}
            >
              {isPlaying ? (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
