import React from 'react';
import { Play, AlertCircle } from 'lucide-react';
import { Correction, ConnectionStatus } from '../types';
import { diffWords } from '../utils/diffUtils';

interface PracticeModeProps {
    currentPractice: Correction;
    onClose: () => void;
    onReprompt: () => void;
    connectionStatus: ConnectionStatus;
}

export const PracticeMode: React.FC<PracticeModeProps> = ({
    currentPractice,
    onClose,
    onReprompt,
    connectionStatus
}) => {
    return (
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-3 animate-fadeIn">
            <div className="max-w-6xl w-full bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl flex flex-col gap-3 p-4 max-h-[92vh] overflow-y-auto">

                {/* Mic Muted Indicator - Compact for landscape */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse flex-shrink-0" />
                    <span className="text-blue-300 text-xs font-semibold">
                        🎤 Practice Mode - Mic Muted
                    </span>
                </div>

                {/* Comparison Area - Side by side for landscape */}
                <div className="grid grid-cols-2 gap-4 items-start flex-1">

                    {/* 2. User Speech (Left Grey Bubble) */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">You Said</span>
                        <div className="bg-[#27272a] rounded-2xl rounded-tl-none p-4 relative">
                            <p className="text-base text-gray-300 leading-relaxed font-medium">
                                {diffWords(currentPractice.original, currentPractice.corrected).map((part, i) => {
                                    if (part.type === 'removed') {
                                        return (
                                            <span key={i} className="text-red-400 bg-red-500/10 px-1 rounded mx-0.5 line-through decoration-red-400/50 decoration-2">
                                                {part.value}
                                            </span>
                                        );
                                    }
                                    if (part.type === 'equal') {
                                        return <span key={i}>{part.value} </span>;
                                    }
                                    return null;
                                })}
                            </p>
                        </div>
                    </div>

                    {/* 3. AI Correction (Right Green Bubble) */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-green-500 uppercase tracking-wider ml-1">Correct Version - Practice!</span>
                        <div className="bg-green-900/20 border border-green-500/30 rounded-2xl rounded-tr-none p-4 relative shadow-[0_0_30px_-10px_rgba(34,197,94,0.2)]">
                            <p className="text-lg text-green-100 leading-relaxed font-bold">
                                {diffWords(currentPractice.original, currentPractice.corrected).map((part, i) => {
                                    if (part.type === 'added') {
                                        return (
                                            <span key={i} className="text-green-300 font-bold bg-green-500/20 px-1 rounded mx-0.5">
                                                {part.value}
                                            </span>
                                        );
                                    }
                                    if (part.type === 'equal') {
                                        return <span key={i}>{part.value} </span>;
                                    }
                                    return null;
                                })}
                            </p>
                            <p className="text-green-400/80 text-xs mt-3 font-medium">
                                💡 Say this 3 times
                            </p>
                            <p className="text-violet-400/60 text-xs mt-1.5">
                                {currentPractice.explanation}
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons - Horizontal for landscape */}
                    <div className="col-span-2 flex gap-3 pt-3 border-t border-white/5">
                        <button
                            onClick={onClose}
                            className="flex-1 px-6 py-3 rounded-xl bg-white text-black font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2"
                        >
                            <Play className="w-4 h-4 fill-current" />
                            Continue Speaking
                        </button>
                        <button
                            onClick={onReprompt}
                            disabled={connectionStatus !== 'connected'}
                            className="flex-1 px-6 py-3 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 active:bg-violet-600/40 border border-violet-500/30 text-violet-200 font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <AlertCircle className="w-4 h-4" />
                            Ask AI More
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
