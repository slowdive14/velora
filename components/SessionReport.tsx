import React from 'react';
import { Clock, CheckCircle, Copy, RotateCcw, X, MessageSquare, Award } from 'lucide-react';
import { Correction } from '../types';

interface SessionReportProps {
  duration: string;
  turnCount: number;
  corrections: Correction[];
  onClose: () => void;
  onCopyTranscript: () => void;
}

export function SessionReport({ duration, turnCount, corrections, onClose, onCopyTranscript }: SessionReportProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-center relative shrink-0">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="flex justify-center mb-3">
            <div className="bg-white/20 p-3 rounded-full backdrop-blur-sm">
              <Award className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Session Complete</h2>
          <p className="text-indigo-100 text-sm">Great job practicing today!</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-px bg-neutral-800 shrink-0">
          <div className="bg-neutral-900 p-6 flex flex-col items-center justify-center">
            <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium uppercase tracking-wider mb-2">
              <Clock className="w-4 h-4" /> Duration
            </div>
            <div className="text-2xl font-mono font-bold text-white">{duration}</div>
          </div>
          <div className="bg-neutral-900 p-6 flex flex-col items-center justify-center">
            <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium uppercase tracking-wider mb-2">
              <MessageSquare className="w-4 h-4" /> Turns
            </div>
            <div className="text-2xl font-mono font-bold text-white">{turnCount}</div>
          </div>
        </div>

        {/* Corrections Review */}
        <div className="flex-1 overflow-y-auto p-6 bg-neutral-950/50">
          <h3 className="text-sm font-semibold text-neutral-400 mb-4 uppercase tracking-wider flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Key Takeaways ({corrections.length})
          </h3>
          
          {corrections.length === 0 ? (
            <div className="text-center py-8 text-neutral-500 text-sm">
              No corrections recorded. Perfect speaking flow! 🎉
            </div>
          ) : (
            <div className="space-y-4">
              {corrections.map((correction, idx) => (
                <div key={idx} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm">
                  {correction.turnText && (
                    <div className="mb-3 pb-3 border-b border-neutral-800">
                      <span className="text-neutral-500 text-xs font-medium">Context</span>
                      <p className="text-neutral-400 text-xs mt-1 line-clamp-2 italic">
                        "{correction.turnText}"
                      </p>
                    </div>
                  )}
                  <div className="flex items-start gap-3 mb-2 opacity-60">
                    <span className="bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 mt-0.5">Original</span>
                    <span className="line-through text-neutral-300">{correction.original}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 mt-0.5">Better</span>
                    <span className="text-green-300 font-medium">{correction.corrected}</span>
                  </div>
                  {correction.explanation && (
                    <p className="mt-3 text-xs text-neutral-500 pl-2 border-l-2 border-neutral-800 italic">
                      {correction.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-neutral-900 border-t border-neutral-800 flex flex-col gap-3 shrink-0">
          <button
            onClick={onCopyTranscript}
            className="w-full py-3.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors border border-neutral-700"
          >
            <Copy className="w-4 h-4" /> Copy Full Transcript
          </button>
          <button
            onClick={onClose}
            className="w-full py-3.5 bg-white text-black rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Start New Session
          </button>
        </div>

      </div>
    </div>
  );
}
