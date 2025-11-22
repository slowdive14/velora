import React, { useEffect, useRef } from 'react';
import { Message } from '../types';

interface TranscriptViewProps {
  messages: Message[];
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ messages }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div 
      ref={containerRef}
      className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6 overflow-y-auto flex flex-col gap-2 pointer-events-none"
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm backdrop-blur-md shadow-sm ${
              msg.role === 'user'
                ? 'bg-white/10 text-white/90 rounded-br-none'
                : 'bg-blue-500/80 text-white rounded-bl-none font-medium border border-blue-400/30'
            }`}
          >
            {msg.role === 'ai' && <span className="text-xs opacity-70 block mb-1">Gemini Host</span>}
            {msg.text}
          </div>
        </div>
      ))}
    </div>
  );
};
