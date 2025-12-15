import { Tool, Type } from '@google/genai';

export const TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "reportCorrection",
                description: "🚨 CRITICAL SILENT TOOL - MUST be called for EVERY grammar error! This is a SILENT background tool - DO NOT generate any additional response after calling it. Just call it and continue your conversation naturally. Report incorrect verb tense, subject-verb agreement errors, missing verbs, wrong word choice, or unnatural expressions. Examples: 'What does you mean' → 'What do you mean', 'I go yesterday' → 'I went yesterday', 'He don't like' → 'He doesn't like'. IMPORTANT: After calling this function, DO NOT acknowledge it verbally - it runs silently in the background.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        original: { type: Type.STRING, description: "The exact incorrect phrase the user said (e.g., 'What does you mean')" },
                        corrected: { type: Type.STRING, description: "The corrected version (e.g., 'What do you mean')" },
                        explanation: { type: Type.STRING, description: "Brief explanation (e.g., 'Use do not does with you - subject-verb agreement')" }
                    },
                    required: ["original", "corrected", "explanation"]
                }
            }
        ]
    }
];
