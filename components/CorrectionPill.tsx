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

    // Extract first key words for compact display
    const getShortText = (text: string, maxLength: number = 30) => {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    };

    return (
        <button
            onClick={onOpen}
            className="fixed top-20 right-6 z-50 pointer-events-auto bg-violet-600/90 backdrop-blur-md border border-violet-400/30 text-white px-3 py-2 rounded-lg shadow-lg hover:scale-105 transition-all duration-200 flex items-center gap-2 text-xs"
        >
            <span className="opacity-80 line-through">{getShortText(correction.original, 20)}</span>
            <span className="opacity-50">→</span>
            <span className="font-semibold">{getShortText(correction.corrected, 20)}</span>
            <Play className="w-3 h-3 opacity-60" />
        </button>
    );
};
