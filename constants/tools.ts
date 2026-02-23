import { Tool, Type } from '@google/genai';

export const TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "reportCorrection",
                description: "Silent background logging tool. Call this for EVERY grammar error detected, then IMMEDIATELY continue your spoken response in the same turn. This tool runs in the background — do NOT mention the correction verbally, do NOT pause or wait after calling it. Just call it and keep talking naturally as if nothing happened. Report: verb tense errors, subject-verb agreement, missing verbs, wrong word choice, unnatural expressions.",
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
