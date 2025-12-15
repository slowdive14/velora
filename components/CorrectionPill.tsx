import React, { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import { Correction } from '../types';

interface CorrectionPillProps {
    correction: Correction;
    index: number;
    onOpen: () => void;
}

export const CorrectionPill: React.FC<CorrectionPillProps> = ({ correction, index, onOpen }) => {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        console.log(`✨ NEW Pill created: "${correction.original}" → "${correction.corrected}"`);
        // Auto-dismiss after 5 seconds (non-intrusive)
        const timer = setTimeout(() => {
            console.log(`⏰ Pill auto-dismissed after 5s`);
            setVisible(false);
        }, 5000);
        return () => {
            console.log(`🗑️ Pill cleanup`);
            clearTimeout(timer);
        };
    }, []); // Run once per mount (key ensures new mount for each correction)

    if (!visible) return null;

    return (
        <button
            onClick={onOpen}
            className="fixed top-24 md:top-20 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[9999] pointer-events-auto bg-violet-600/95 backdrop-blur-md border-2 border-violet-400/50 text-white px-4 py-4 rounded-xl shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-start gap-2 text-sm"
        >
            <div className="flex-1 flex items-start gap-2 min-w-0">
                <span className="opacity-80 line-through break-words">{correction.original}</span>
                <span className="opacity-50 flex-shrink-0">→</span>
                <span className="font-semibold break-words">{correction.corrected}</span>
            </div>
            <Play className="w-4 h-4 opacity-60 flex-shrink-0" />
        </button>
    );
};
