'use client';

import { Message } from '@/lib/types';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
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
        <span className="text-xs text-gray-400 mt-1">{time}</span>
      </div>
    </div>
  );
}
