# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gemini Cast is an AI-powered English fluency practice app that enables users to record video logs while receiving real-time corrections and feedback from Google's Gemini AI. The app acts as a conversational podcast co-host that provides implicit recasting (natural corrections embedded in conversation) and explicit correction tracking.

## Development Commands
- PWA support with landscape orientation lock
- Offline support via Service Worker
- Custom app icons (192x192, 512x512)

**Setup:**
```bash
npm install
```

**Development:**
```bash
npm run dev        # Start dev server on localhost:3000
```

**Build:**
```bash
npm run build      # Production build
npm run preview    # Preview production build
```

## Environment Configuration

- API key is set in `.env.local` as `GEMINI_API_KEY`
- Falls back to `process.env.API_KEY` (injected via Vite config)
- Users can also enter API key via in-app modal (stored in localStorage as `gemini_api_key`)

## Architecture

### Core Components

**App.tsx** - Main application component that orchestrates:
- Media stream management (audio/video)
- Gemini Live API connection lifecycle
- Real-time transcription display (subtitles overlay)
- Audio worklet processing for PCM audio capture
- Correction pill notifications
- Practice mode for reviewing corrections
- Video recording with MediaRecorder

**services/liveService.ts** - Gemini Live API wrapper:
- Manages WebSocket connection to Gemini 2.5 Flash with native audio preview
- Handles bidirectional audio streaming (16kHz PCM input, 24kHz PCM output)
- Processes tool calls for the `reportCorrection` function
- Manages transcription events (both input and output)
- Supports two modes: conversational coach and focused study material tutor

### Audio Pipeline

1. **Input**: User's microphone → MediaStream
2. **Processing**: AudioWorkletProcessor (`PCMProcessor`) buffers 4096 samples (~250ms at 16kHz)
3. **Downsampling**: `downsampleTo16k()` converts from native sample rate to 16kHz
4. **Encoding**: `float32ToInt16PCM()` converts to Little Endian Int16 PCM
5. **Transmission**: Base64-encoded PCM sent via `sendAudioChunk()`
6. **Playback**: Gemini's audio response decoded and queued using Web Audio API

### Critical Audio Details

- Input audio MUST be 16kHz PCM (Little Endian byte order)
- Output audio is 24kHz PCM from Gemini
- Larger buffer size (4096 samples) prevents "Network Error" disconnects from too many small packets
- AudioWorklet is used instead of ScriptProcessor for performance

### Correction System

The app implements a "Shadow Corrector" pattern:
- Gemini detects grammar, vocabulary, pronunciation, or unnatural phrasing
- Calls `reportCorrection` tool with original/corrected/explanation
- Correction appears as a timed notification pill (8 second timeout)
- User can click to enter practice mode and hear more context
- Corrections include `aiContext` field populated from the transcript buffer

### Practice Mode & "Ask AI More"

When a user clicks a correction pill, the app enters **Practice Mode**:
- **State**: `isPracticeMode` becomes true.
- **Audio Routing**: Microphone input is still sent to Gemini (to keep connection alive), but AI audio output is **blocked** in `onAudioData` to prevent interference.
- **"Ask AI More" Feature**:
  - Allows user to request a detailed explanation for the specific correction.
  - Sends a text prompt: *"Let's continue with [context]. Can you explain more about why [corrected] is better than [original]?..."*
  - seamlessly transitions back to roleplay after the explanation.

### Transcript Management

**Real-time Subtitles:**
- Provisional (streaming) user text displayed until turn is complete
- Committed transcript prevents empty final packets from clearing subtitles
- Separate buffers for user (`committedUserTranscriptRef`) and AI (`aiTranscriptBufferRef`)

**Download Format:**
- Transcript history stored in `transcriptHistoryRef`
- Exportable as formatted text file with role labels

### Video Features

- Camera can be toggled on/off (default: off)
- When camera is on and connected to Gemini, frames captured at 1 FPS via canvas
- Frames encoded as JPEG base64 and sent via `sendVideoFrame()`
- MediaRecorder captures both video and AI audio responses for download
- AI audio is merged into recording via `MediaStreamAudioDestinationNode`

### State Management

The app uses extensive refs to maintain state across async operations:
- `isCameraOnRef`, `isRecordingRef`, `isPracticeModeRef` for sync access in callbacks
- `correctionsRef` for tracking correction history
- `liveServiceRef` for service instance access
- Render loop managed via `renderLoopRef` for blob animations and video capture

## TypeScript Configuration

- Uses path alias `@/*` mapping to root directory
- JSX mode: `react-jsx` (automatic runtime)
- Target: ES2022 with experimental decorators
- Module resolution: bundler mode (Vite)

## Conversation Modes

### Free Conversation Mode (Default)

When no study material is provided:
- AI acts as a warm, engaging conversation partner
- **Primary goal**: Make the user speak as much as possible
- Asks follow-up questions to keep conversation flowing
- Only corrects clear grammar/vocabulary mistakes (not style preferences)
- Keeps responses short (1-2 sentences) to maximize user speaking time
- Uses "Shadow Corrector" approach:
  - Verbally uses correct form naturally (Implicit Recasting)
  - Silently calls `reportCorrection` tool
  - Never explicitly says "you made a mistake"

### Study Material Mode

When user provides study material text:
- **First**: AI asks if the user has read the material yet

- **If YES (already read)**:
  - AI asks open-ended questions about the content
  - Encourages the user to speak as much as possible
  - Focuses on elaboration and personal connections
  - Keeps responses short (1-2 sentences) to maximize user speaking time

- **If NO (haven't read yet)**:
  - AI offers learning options:
    - "Would you like me to summarize the key points?"
    - "Should we walk through it section by section?"
    - "Or would you prefer to read it first?"
  - **If user wants help learning**:
    - AI breaks down material into chunks
    - Explains concepts clearly (2-3 sentences per concept)
    - After each explanation: "Can you explain this back to me in your own words?"
    - Encourages paraphrasing and speaking
  - **If user wants to read first**:
    - AI waits and lets them know to signal when ready

- **Correction approach**: Only corrects clear grammar/vocabulary mistakes
- **Goal**: 70% user speaking, 30% AI speaking
- **Dual purpose**: Learn the material AND practice English speaking

## Common Issues

**Connection Errors:**
- Check buffer size isn't too small (currently 4096 samples)
- Verify 16kHz sample rate for input audio
- Ensure Little Endian byte order in PCM conversion

**Subtitle Display:**
- Provisional text should not be cleared on empty final packets
- Use `lastIntermediateUserTextRef` to preserve last known text

**Camera Not Working:**
- Video track must remain enabled for `readyState` checks
- Camera on/off is handled in render loop, not by disabling tracks
