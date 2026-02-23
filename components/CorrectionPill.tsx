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
    const [dismissing, setDismissing] = useState(false);

    useEffect(() => {
        console.log(`NEW Pill: "${correction.original}" -> "${correction.corrected}"`);
        const timer = setTimeout(() => {
            setDismissing(true);
            // Wait for exit animation before removing from DOM
            setTimeout(() => setVisible(false), 250);
        }, 7000);
        return () => clearTimeout(timer);
    }, []);

    if (!visible) return null;

    return (
        <button
            onClick={onOpen}
            className={`fixed top-24 md:top-20 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-[9999] pointer-events-auto bg-violet-600/95 backdrop-blur-sm border-2 border-violet-400/50 text-white px-4 py-3 rounded-xl shadow-lg active:scale-95 transition-transform duration-150 flex items-center gap-3 text-sm ${dismissing ? 'animate-pill-out' : 'animate-pill-in'}`}
        >
            <div className="flex-1 min-w-0">
                <div className="opacity-70 line-through truncate text-xs">
                    {correction.original}
                </div>
                <div className="font-semibold truncate text-sm mt-0.5">
                    {correction.corrected}
                </div>
            </div>
            <Play className="w-4 h-4 opacity-60 flex-shrink-0" />
        </button>
    );
};
