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
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4 animate-fadeIn">
            <div className="max-w-5xl w-full bg-[#09090b] border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col gap-8 max-h-[90vh] overflow-y-auto">

                {/* Mic Muted for Practice Indicator */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <div className="flex-1">
                        <span className="text-blue-300 text-sm font-semibold block">
                            🎤 Practice Mode Active - Mic Muted
                        </span>
                        <span className="text-blue-200/60 text-xs">
                            You can now practice saying the correct sentence out loud without AI responding
                        </span>
                    </div>
                </div>

                {/* 1. Topic Initiation (Top) */}
                <div className="text-center space-y-2">
                    <span className="text-xs font-bold text-violet-400 tracking-widest uppercase">Current Topic</span>
                    <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight">
                        "{currentPractice.aiContext || "Conversation Practice"}"
                    </h2>
                </div>

                {/* Comparison Area */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

                    {/* 2. User Speech (Left Grey Bubble) */}
                    <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">You Said</span>
                        <div className="bg-[#27272a] rounded-3xl rounded-tl-none p-6 relative group">
                            <p className="text-xl text-gray-300 leading-relaxed font-medium">
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
                            <div className="absolute -right-2 -top-2 bg-red-500/20 text-red-400 text-xs font-bold px-2 py-1 rounded-full border border-red-500/30 opacity-0 group-hover:opacity-100 transition-opacity">
                                Original
                            </div>
                        </div>
                    </div>

                    {/* 3. AI Correction (Right Green Bubble) */}
                    <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold text-green-500 uppercase tracking-wider ml-1">Correct Version - Practice This!</span>
                        <div className="bg-green-900/20 border border-green-500/30 rounded-3xl rounded-tr-none p-6 relative group shadow-[0_0_30px_-10px_rgba(34,197,94,0.2)]">
                            <p className="text-2xl text-green-100 leading-relaxed font-bold">
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
                            <p className="text-green-400/80 text-sm mt-4 font-medium">
                                💡 Try saying this sentence out loud 3 times
                            </p>
                            <p className="text-violet-400/60 text-xs mt-2">
                                {currentPractice.explanation}
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="col-span-1 md:col-span-2 flex gap-4 mt-4 pt-4 border-t border-white/5">
                        <button
                            onClick={onClose}
                            className="flex-1 px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all"
                        >
                            Close
                        </button>
                        <button
                            onClick={onReprompt}
                            disabled={connectionStatus !== 'connected'}
                            className="flex-1 px-8 py-4 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-200 font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <AlertCircle className="w-4 h-4" />
                            Ask AI More
                        </button>
                        <button
                            onClick={onClose}
                            className="flex-1 px-8 py-4 rounded-xl bg-white text-black font-bold hover:scale-[1.02] transition-all shadow-xl flex items-center justify-center gap-2"
                        >
                            <Play className="w-4 h-4 fill-current" />
                            Practice Speaking
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
