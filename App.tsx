import React, { useState, useRef, useEffect } from 'react';
import { Video, Play, Download, Settings2, AlertCircle, Camera, CameraOff, FileText, Key, Copy } from 'lucide-react';
import { LiveService } from './services/liveService';
import { Message, ConnectionStatus, Correction } from './types';
import { blobToBase64, downsampleTo16k } from './utils/audioUtils';
import { diffWords } from './utils/diffUtils';

// --- Audio Worklet Code (Blob) ---
// Moved to public/pcm-processor.js to run on audio thread and avoid main thread blocking


// --- Components ---

import { CorrectionPill } from './components/CorrectionPill';
import { PracticeMode } from './components/PracticeMode';

// --- Components ---

// Pre-compiled regex patterns for transcript sanitization (performance optimization)
const CTRL_CHAR_REGEX = /<ctrl\d+>/g;
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F-\x9F]/g;

export default function App() {
    // Detect mobile device
    const [isMobile] = useState(() => {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    });

    const [apiKey, setApiKey] = useState<string>(() => {
        return localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || "";
    });
    const [hasApiKey, setHasApiKey] = useState(!!apiKey);
    const [showApiKeyModal, setShowApiKeyModal] = useState(!apiKey);
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [isRecording, setIsRecording] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(false); // Default to Camera OFF
    const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
    const [studyMaterial, setStudyMaterial] = useState(""); // New State for user material
    const [corrections, setCorrections] = useState<Correction[]>([]);
    const [isPracticeMode, setIsPracticeMode] = useState(false);
    const [currentPractice, setCurrentPractice] = useState<Correction | null>(null);
    const isCameraOnRef = useRef(false);
    const isRecordingRef = useRef(false);
    const correctionsRef = useRef<Correction[]>([]);
    const isPracticeModeRef = useRef(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const liveServiceRef = useRef<LiveService | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const aiAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const renderLoopRef = useRef<number | null>(null);

    // Subtitle State - Show recent 4 turns
    type SubtitleTurn = { role: 'user' | 'ai'; text: string; id: number };
    const [recentTurns, setRecentTurns] = useState<SubtitleTurn[]>([]);
    const recentTurnsRef = useRef<SubtitleTurn[]>([]);
    const turnIdCounter = useRef<number>(0);

    // Transcript History for Download
    const transcriptHistoryRef = useRef<{ role: 'user' | 'ai'; text: string }[]>([]);
    const userTranscriptBufferRef = useRef<string>("");
    const aiTranscriptBufferRef = useRef<string>("");

    const lastRoleRef = useRef<'user' | 'ai' | null>(null);
    const transcriptTurnCountRef = useRef<number>(-1); // Track turn index for corrections
    const turnStartTimeRef = useRef<number>(0); // Track turn latency for performance monitoring

    // Timer State
    const [elapsedTime, setElapsedTime] = useState("00:00");
    const sessionStartTimeRef = useRef<number>(0);

    const videoIntervalRef = useRef<number | null>(null);

    // Blob Animation State
    const blobsRef = useRef<{ x: number; y: number; vx: number; vy: number; r: number; color: string }[]>([]);
    const initializedBlobsRef = useRef(false);

    // --- Initialization ---

    const initializeStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
            });

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current?.play().catch(console.error);

                    // Default Camera State: OFF (Logic handled by render loop)
                    // We keep tracks ENABLED to ensure readyState is good.

                    setIsCameraOn(false);
                    isCameraOnRef.current = false;

                    startRenderLoop();
                };
            }
        } catch (err) {
            console.error("Error accessing media devices:", err);
            alert("Could not access camera or microphone. Please check permissions.");
        }
    };

    useEffect(() => {
        if (apiKey) {
            setHasApiKey(true);
            setShowApiKeyModal(false);
        } else {
            setHasApiKey(false);
            setShowApiKeyModal(true);
        }
    }, [apiKey]);

    useEffect(() => {
        initializeStream();
        return () => {
            if (renderLoopRef.current) cancelAnimationFrame(renderLoopRef.current);
            if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            // Clean up subtitle state
            userTranscriptBufferRef.current = "";
            aiTranscriptBufferRef.current = "";
            recentTurnsRef.current = [];
            setRecentTurns([]);
            streamRef.current?.getTracks().forEach(track => track.stop());
            liveServiceRef.current?.disconnect();
            audioContextRef.current?.close();
        };
    }, []);

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    useEffect(() => {
        isPracticeModeRef.current = isPracticeMode;
    }, [isPracticeMode]);

    // Timer Effect
    useEffect(() => {
        let interval: number;
        if (isRecording) {
            sessionStartTimeRef.current = Date.now();
            interval = window.setInterval(() => {
                const now = Date.now();
                const diff = Math.floor((now - sessionStartTimeRef.current) / 1000);
                const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
                const seconds = (diff % 60).toString().padStart(2, '0');
                setElapsedTime(`${minutes}:${seconds}`);
            }, 1000);
        } else {
            setElapsedTime("00:00");
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const toggleCamera = () => {
        if (streamRef.current) {
            const videoTrack = streamRef.current.getVideoTracks()[0];
            if (videoTrack) {
                setIsCameraOn(prev => {
                    const newState = !prev;
                    videoTrack.enabled = newState;
                    isCameraOnRef.current = newState;

                    if (newState && videoRef.current) {
                        videoRef.current.play().catch(console.error);
                    }

                    return newState;
                });
            }
        }
    };

    // --- Practice Mode Functions ---

    const enterPracticeMode = (correction: Correction) => {
        setIsPracticeMode(true);
        setCurrentPractice(correction);

        // NOTE: We don't suspend audioContext here because it would stop the microphone AudioWorklet too!
        // Instead, we check isPracticeModeRef in onAudioData to skip playing AI audio during practice.
    };

    const exitPracticeMode = () => {
        setIsPracticeMode(false);
        setCurrentPractice(null);

        // CRITICAL: Reset audio schedule to skip any buffered audio from before practice mode
        if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
        }
    };

    // Generate contextual re-prompt to continue conversation
    const generateContextualReprompt = async () => {
        console.log("Ask AI More clicked");
        if (!currentPractice) {
            alert("Error: No current practice context");
            return;
        }
        const context = currentPractice.aiContext || "the topic we were discussing";
        const prompt = `Let's continue with ${context}. Can you explain more about why "${currentPractice.corrected}" is better than "${currentPractice.original}"? After explaining, please continue the roleplay naturally.`;

        if (liveServiceRef.current) {
            try {
                await liveServiceRef.current.sendTextMessage(prompt);
                console.log("Message sent successfully");
            } catch (e) {
                alert("Failed to send message: " + e);
                console.error(e);
            }
        } else {
            alert("Error: LiveService not connected");
        }

        exitPracticeMode();
    };

    // --- Canvas Rendering Logic ---

    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
        // Initialize Blobs if needed
        if (!initializedBlobsRef.current) {
            blobsRef.current = [
                { x: width * 0.3, y: height * 0.3, vx: 0.2, vy: 0.3, r: 300, color: '#4c1d95' }, // Violet
                { x: width * 0.7, y: height * 0.7, vx: -0.3, vy: -0.2, r: 350, color: '#1e3a8a' }, // Blue
                { x: width * 0.5, y: height * 0.5, vx: 0.2, vy: -0.2, r: 250, color: '#0891b2' }, // Cyan
            ];
            initializedBlobsRef.current = true;
        }

        // Clear with dark base
        ctx.fillStyle = '#020617'; // Slate-950
        ctx.fillRect(0, 0, width, height);

        // Update and Draw Blobs
        ctx.globalCompositeOperation = 'screen'; // Blend mode for "glow"

        blobsRef.current.forEach(blob => {
            // Move
            blob.x += blob.vx;
            blob.y += blob.vy;

            // Bounce
            if (blob.x < 0 || blob.x > width) blob.vx *= -1;
            if (blob.y < 0 || blob.y > height) blob.vy *= -1;

            // Draw Gradient Orb
            const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
            gradient.addColorStop(0, blob.color);
            gradient.addColorStop(1, 'transparent');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalCompositeOperation = 'source-over'; // Reset blend mode

        // Subtle Noise/Grain (Optional, keeping it simple for performance)
    };

    const drawAudioWave = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
        ctx.save();
        ctx.translate(0, height / 2);

        // Get Real Audio Data if available
        let dataArray: Uint8Array | null = null;
        if (analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteTimeDomainData(dataArray);
        }

        // Animated Wave
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)'; // Red-400
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(248, 113, 113, 0.5)';
        ctx.shadowBlur = 10;

        const sliceWidth = width * 1.0 / (dataArray ? dataArray.length : 100);
        let x = 0;

        if (dataArray) {
            // Draw Real Audio Wave
            for (let i = 0; i < dataArray.length; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * 50 - 50; // Scale amplitude

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);

                x += sliceWidth;
            }
        } else {
            // Fallback: Simulated Wave
            const amplitude = 50;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.globalAlpha = 1 - (i * 0.3);
                for (let x = 0; x < width; x += 5) {
                    const y = Math.sin(x * 0.01 + time * 0.003 + i) *
                        Math.sin(x * 0.003 + time * 0.001) * // Envelope
                        amplitude;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }

        if (dataArray) ctx.stroke();

        ctx.restore();

        // "REC" Indicator Text
        ctx.save();
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.fillStyle = '#f87171';
        ctx.textAlign = 'right';
        ctx.fillText("● RECORDING", width - 40, 50);
        ctx.restore();
    };

    // REMOVED drawSubtitle function - Moved to HTML overlay

    const startRenderLoop = () => {
        const loop = async (time: number) => {
            if (videoRef.current && canvasRef.current) {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    if (video.readyState >= 1 && canvas.width !== video.videoWidth) {
                        // Set canvas size once video metadata is loaded
                        if (video.videoWidth > 0) {
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                        } else {
                            // Fallback dimensions if video not ready
                            canvas.width = 1280;
                            canvas.height = 720;
                        }
                    } else if (canvas.width === 0) {
                        // Fallback if video never loads (e.g. permission denied but not caught)
                        canvas.width = 1280;
                        canvas.height = 720;
                    }

                    // 1. Draw Background (Camera Video or Gradient)
                    if (isCameraOnRef.current && video.readyState >= 2) {
                        ctx.save();
                        ctx.translate(canvas.width, 0);
                        ctx.scale(-1, 1);
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        ctx.restore();
                    } else {
                        drawBackground(ctx, canvas.width, canvas.height, time);

                        // Draw Recording Animation if Camera is OFF and Recording is ON
                        if (isRecordingRef.current) {
                            drawAudioWave(ctx, canvas.width, canvas.height, time);
                        }
                    }
                    // Subtitle drawing removed - handled by HTML overlay
                }
            }
            renderLoopRef.current = requestAnimationFrame(loop);
        };
        renderLoopRef.current = requestAnimationFrame(loop);
    };

    // --- Audio & Live Service Setup ---

    const setupAudioContext = async () => {
        // Use native hardware sample rate (usually 48kHz) to avoid browser resampling
        // The AudioWorklet will downsample to 16kHz for Gemini API
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
            latencyHint: 'interactive',
            // No sampleRate specified - use hardware native rate for best quality
        });
        await ctx.resume();

        console.log(`🎵 AudioContext created: ${ctx.sampleRate}Hz (native) → 16kHz (Gemini)`);

        // Load AudioWorklet from public folder
        // Use import.meta.env.BASE_URL to respect Vite's base path configuration
        const workletPath = `${import.meta.env.BASE_URL}pcm-processor.js`;
        try {
            console.log(`🎧 Loading AudioWorklet from: ${workletPath}`);
            await ctx.audioWorklet.addModule(workletPath);
            console.log('✅ AudioWorklet loaded successfully');
        } catch (e) {
            console.error("❌ Failed to load audio worklet:", e);
            throw e;
        }

        // Create Analyser Node for Visualization
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        return ctx;
    };

    const startSession = async () => {
        if (!hasApiKey) {
            alert("API Key not found in environment.");
            return;
        }
        if (!streamRef.current) {
            await initializeStream();
        }
        if (!streamRef.current) return;

        // CRITICAL: Clean up any existing session before starting a new one
        if (liveServiceRef.current) {
            liveServiceRef.current.disconnect();
            liveServiceRef.current = null;
        }

        setStatus('connecting');
        transcriptHistoryRef.current = []; // Reset history
        userTranscriptBufferRef.current = "";
        aiTranscriptBufferRef.current = "";
        lastRoleRef.current = null;
        recentTurnsRef.current = [];
        setRecentTurns([]);
        turnIdCounter.current = 0;

        // Ensure we close any existing context
        if (audioContextRef.current) {
            await audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // 1. Setup Audio Pipeline
        const ctx = await setupAudioContext();
        audioContextRef.current = ctx;
        aiAudioDestinationRef.current = ctx.createMediaStreamDestination();

        // CRITICAL: For proper Bluetooth/headset routing on mobile, connect directly to ctx.destination
        // The system automatically routes ctx.destination to the active audio output device (speaker/Bluetooth/headset)
        console.log("🔊 Audio routing: Using AudioContext.destination for system-level Bluetooth support");

        nextStartTimeRef.current = 0;

        // 2. Connect to Gemini
        liveServiceRef.current = new LiveService({
            apiKey: apiKey,
            onAudioData: (buffer) => {
                // Play AI Audio (skip during practice mode to avoid interference)
                if (!audioContextRef.current) return;

                // CRITICAL: Skip playing AI audio during practice mode
                // This allows the microphone to keep working while preventing audio playback
                if (isPracticeModeRef.current) {
                    console.log('[PRACTICE MODE] Skipping AI audio playback');
                    return;
                }

                const source = audioContextRef.current.createBufferSource();
                source.buffer = buffer;

                // CRITICAL: Connect directly to AudioContext.destination for proper system audio routing
                // This ensures Bluetooth/headset routing works correctly on mobile
                source.connect(audioContextRef.current.destination);

                // Also connect to Recording Stream (for video recording)
                if (aiAudioDestinationRef.current) {
                    source.connect(aiAudioDestinationRef.current);
                }

                const now = audioContextRef.current.currentTime;
                const start = Math.max(nextStartTimeRef.current, now);
                source.start(start);
                nextStartTimeRef.current = start + buffer.duration;
            },
            onTranscript: (text, isUser, isFinal) => {
                const currentRole = isUser ? 'user' : 'ai';

                // CRITICAL: Skip AI transcripts during practice mode to prevent display issues
                if (isPracticeModeRef.current && !isUser) {
                    console.log('[PRACTICE MODE] Skipping AI transcript:', text);
                    return;
                }

                // CRITICAL: Detect role change - finalize previous turn
                if (lastRoleRef.current && lastRoleRef.current !== currentRole) {
                    // Role changed! Finalize the previous role's turn
                    if (lastRoleRef.current === 'user') {
                        // User turn ended, AI started speaking
                        // Log turn latency for performance monitoring
                        if (turnStartTimeRef.current > 0) {
                            const turnDuration = performance.now() - turnStartTimeRef.current;
                            console.log(`⚡ Turn latency: ${turnDuration.toFixed(0)}ms`);
                        }
                        if (userTranscriptBufferRef.current.trim()) {
                            transcriptHistoryRef.current.push({ role: 'user', text: userTranscriptBufferRef.current });
                            transcriptTurnCountRef.current = transcriptHistoryRef.current.length - 1;

                            // Remove streaming turn before adding finalized turn
                            const completedTurns = recentTurnsRef.current.filter(t => t.id !== -1);
                            const newTurns = [...completedTurns, {
                                role: 'user' as const,
                                text: userTranscriptBufferRef.current,
                                id: turnIdCounter.current++
                            }].slice(-4);
                            recentTurnsRef.current = newTurns;
                            setRecentTurns(newTurns);

                            userTranscriptBufferRef.current = ""; // Clear buffer
                        }
                    } else {
                        // AI turn ended, User started speaking
                        if (aiTranscriptBufferRef.current.trim()) {
                            transcriptHistoryRef.current.push({ role: 'ai', text: aiTranscriptBufferRef.current });
                            transcriptTurnCountRef.current = transcriptHistoryRef.current.length - 1;

                            // Remove streaming turn before adding finalized turn
                            const completedTurns = recentTurnsRef.current.filter(t => t.id !== -1);
                            const newTurns = [...completedTurns, {
                                role: 'ai' as const,
                                text: aiTranscriptBufferRef.current,
                                id: turnIdCounter.current++
                            }].slice(-4);
                            recentTurnsRef.current = newTurns;
                            setRecentTurns(newTurns);

                            aiTranscriptBufferRef.current = ""; // Clear buffer
                        }
                    }
                }

                // Update last role
                lastRoleRef.current = currentRole;

                // Accumulate text in buffer (with sanitization)
                if (text && text.trim() !== "") {
                    // CRITICAL: Filter out control characters and HTML-like tags
                    // DO NOT trim() individual chunks - it removes spaces between words!
                    const sanitizedText = text
                        .replace(CTRL_CHAR_REGEX, '') // Remove <ctrl46> etc (pre-compiled regex)
                        .replace(CONTROL_CHAR_REGEX, ''); // Remove control characters (pre-compiled regex)

                    if (sanitizedText) {
                        if (isUser) {
                            // Track turn start time for latency monitoring
                            if (userTranscriptBufferRef.current === "") {
                                turnStartTimeRef.current = performance.now();
                            }
                            userTranscriptBufferRef.current += sanitizedText;
                        } else {
                            aiTranscriptBufferRef.current += sanitizedText;
                        }

                        let textToDisplay = isUser ? userTranscriptBufferRef.current : aiTranscriptBufferRef.current;
                        let completedTurns = recentTurnsRef.current.filter(t => t.id !== -1);

                        // Check for merge opportunity (fix for fragmented AI speech)
                        const lastTurn = completedTurns[completedTurns.length - 1];
                        if (lastTurn && lastTurn.role === currentRole) {
                            const bufferStart = textToDisplay.trim().charAt(0);
                            // If starts with lowercase, it's likely a continuation
                            if (bufferStart && bufferStart === bufferStart.toLowerCase() && bufferStart !== bufferStart.toUpperCase()) {
                                // Merge visually
                                textToDisplay = lastTurn.text + " " + textToDisplay;
                                // Remove the last finalized turn since we are merging it into the streaming turn
                                completedTurns = completedTurns.slice(0, -1);
                            }
                        }

                        // Update streaming turn in display
                        const currentStreamingTurn: SubtitleTurn = {
                            role: currentRole,
                            text: textToDisplay,
                            id: -1 // Special ID for streaming
                        };

                        // Remove existing streaming turn before adding new one
                        const newTurns = [...completedTurns, currentStreamingTurn].slice(-4);
                        recentTurnsRef.current = newTurns;
                        setRecentTurns(newTurns);
                    }
                }
            },
            onCorrection: (correction: Correction) => {
                // CRITICAL: Tool call means AI turn is complete. Finalize it now!
                if (aiTranscriptBufferRef.current.trim()) {
                    // Add context from AI speech
                    const text = aiTranscriptBufferRef.current.trim();
                    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
                    const recentContext = sentences.slice(-2).join(' ').trim();
                    correction.aiContext = recentContext || text;

                    // Check if AI turn was already finalized by role change
                    // If the last entry in history matches current buffer, it was already added
                    const lastEntry = transcriptHistoryRef.current[transcriptHistoryRef.current.length - 1];
                    const alreadyFinalized = lastEntry &&
                                             lastEntry.role === 'ai' &&
                                             lastEntry.text === aiTranscriptBufferRef.current;

                    if (!alreadyFinalized) {
                        // Finalize AI turn (first time)
                        transcriptHistoryRef.current.push({ role: 'ai', text: aiTranscriptBufferRef.current });
                        transcriptTurnCountRef.current = transcriptHistoryRef.current.length - 1;
                    } else {
                        // Turn already finalized, use existing index
                        transcriptTurnCountRef.current = transcriptHistoryRef.current.length - 1;
                    }

                    // Associate correction with the last USER turn (the error was in user's speech)
                    // Find the last user turn in the transcript history
                    let lastUserTurnIndex = -1;
                    for (let i = transcriptHistoryRef.current.length - 1; i >= 0; i--) {
                        if (transcriptHistoryRef.current[i].role === 'user') {
                            lastUserTurnIndex = i;
                            break;
                        }
                    }
                    correction.turnIndex = lastUserTurnIndex;

                    // Only update display if not already finalized
                    if (!alreadyFinalized) {
                        // Remove streaming turn before adding finalized turn
                        const completedTurns = recentTurnsRef.current.filter(t => t.id !== -1);
                        const newTurns = [...completedTurns, {
                            role: 'ai' as const,
                            text: aiTranscriptBufferRef.current,
                            id: turnIdCounter.current++
                        }].slice(-4);
                        recentTurnsRef.current = newTurns;
                        setRecentTurns(newTurns);
                    }

                    aiTranscriptBufferRef.current = ""; // Clear buffer
                    lastRoleRef.current = null; // Reset so next AI text starts fresh turn
                }

                // Add to corrections list (keep only last 10 to prevent memory bloat)
                const newCorrections = [...correctionsRef.current, correction].slice(-10);
                correctionsRef.current = newCorrections;
                setCorrections(newCorrections);
                console.log(`📝 Correction added! Total: ${newCorrections.length}`, correction);

                // User can click the pill to review
                // Pill auto-dismisses after 5 seconds
            },
            onClose: () => {
                setStatus('disconnected');
            },
            onError: () => {
                setStatus('error');
            },
            onReconnecting: () => {
                setStatus('connecting'); // Show "CONNECTING..." during reconnection
            }
        }, ctx);

        await liveServiceRef.current.connect(studyMaterial);
        setStatus('connected');

        // 3. Use AudioWorklet to capture mic
        const source = ctx.createMediaStreamSource(streamRef.current);

        // Connect to Analyser for Visualization
        if (analyserRef.current) {
            source.connect(analyserRef.current);
        }

        // High-Pass Filter to remove low-frequency rumble/handling noise (common on mobile)
        // CRITICAL: Use 50Hz instead of 100Hz to preserve male voice frequencies (85-180Hz)
        const highPassFilter = ctx.createBiquadFilter();
        highPassFilter.type = 'highpass';
        highPassFilter.frequency.value = 50; // Cut off below 50Hz (was 100Hz - too aggressive)

        const worklet = new AudioWorkletNode(ctx, 'pcm-processor');

        worklet.port.onmessage = (event) => {
            const inputData = event.data as Float32Array;

            // Downsampling is now handled inside the AudioWorklet (pcm-processor.js)
            // This prevents main thread blocking and UI jitter

            // MUTE during Practice Mode - let user practice speaking without AI responding
            if (!isPracticeModeRef.current) {
                liveServiceRef.current?.sendAudioChunk(inputData);
            }
        };

        // Connect Graph: Source -> HPF -> Worklet
        source.connect(highPassFilter);
        highPassFilter.connect(worklet);

        // Keep worklet alive
        const muteNode = ctx.createGain();
        muteNode.gain.value = 0;
        worklet.connect(muteNode);
        muteNode.connect(ctx.destination);

        workletNodeRef.current = worklet;

        // 4. Video Transmission - Disabled for better performance
        // startVideoTransmission();
    };

    const startVideoTransmission = () => {
        if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

        videoIntervalRef.current = window.setInterval(async () => {
            // Only send video frames if camera is ON
            if (!liveServiceRef.current || !canvasRef.current || !isCameraOn) return;

            const video = videoRef.current;
            if (video && video.readyState === 4) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = video.videoWidth * 0.25;
                tempCanvas.height = video.videoHeight * 0.25;
                const ctx = tempCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
                    tempCanvas.toBlob(async (blob) => {
                        if (blob) {
                            const base64 = await blobToBase64(blob);
                            liveServiceRef.current?.sendVideoFrame(base64);
                        }
                    }, 'image/jpeg', 0.6);
                }
            }
        }, 1000);
    };

    // --- Recording Logic ---

    const startRecording = async () => {
        if (!streamRef.current) await initializeStream();
        await startSession();

        // Wait for session
        if (!audioContextRef.current || !canvasRef.current) {
            console.error("Failed to initialize session");
            return;
        }

        // Ensure aiAudioDestination is ready (it is created in startSession)
        if (!aiAudioDestinationRef.current) return;

        chunksRef.current = [];

        const canvasStream = canvasRef.current.captureStream(30);
        const canvasVideoTrack = canvasStream.getVideoTracks()[0];

        // Mix user mic and AI audio
        const ctx = audioContextRef.current;
        const mixedDest = ctx.createMediaStreamDestination();

        // Add mic to recording
        const userSource = ctx.createMediaStreamSource(streamRef.current!);
        userSource.connect(mixedDest);

        // Add AI to recording
        const aiSource = ctx.createMediaStreamSource(aiAudioDestinationRef.current.stream);
        aiSource.connect(mixedDest);

        const combinedStream = new MediaStream([
            canvasVideoTrack,
            mixedDest.stream.getAudioTracks()[0]
        ]);

        let mimeType = 'video/webm;codecs=vp9,opus';
        if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
        }

        const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 2500000 });
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: mimeType });
            const url = URL.createObjectURL(blob);
            setRecordedUrl(url);
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
        // Ensure we disconnect even if not recording but connected
        liveServiceRef.current?.disconnect();
        setStatus('disconnected');

        // Clean up subtitle state
        userTranscriptBufferRef.current = "";
        aiTranscriptBufferRef.current = "";
        lastRoleRef.current = null;
        recentTurnsRef.current = [];
        setRecentTurns([]);
        turnIdCounter.current = 0;

        if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

        // Cleanup AudioContext to release hardware
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    };

    const downloadVideo = () => {
        if (!recordedUrl) return;
        const a = document.createElement('a');
        a.href = recordedUrl;
        a.download = `gemini-cast-${new Date().toISOString()}.mp4`;
        a.click();
    };

    const copyTranscript = async () => {
        if (transcriptHistoryRef.current.length === 0) {
            alert("No transcript to copy.");
            return;
        }

        let mdContent = "# Conversation Transcript\n\n";
        if (studyMaterial.trim()) {
            mdContent += `## Study Material\n\n${studyMaterial}\n\n---\n\n`;
        }

        transcriptHistoryRef.current.forEach((entry, index) => {
            const role = entry.role === 'user' ? '**User**' : '**AI**';
            mdContent += `${role}: ${entry.text}\n\n`;

            // Insert corrections that belong to this turn (corrections are for user's speech)
            if (entry.role === 'user') {
                const correctionsForThisTurn = correctionsRef.current.filter(
                    c => c.turnIndex === index
                );

                correctionsForThisTurn.forEach(correction => {
                    mdContent += `  → *Correction: "${correction.original}" → "${correction.corrected}"*\n\n`;
                });
            }
        });

        try {
            await navigator.clipboard.writeText(mdContent);
            alert("Transcript copied to clipboard!");
        } catch (err) {
            console.error('Failed to copy:', err);
            alert("Failed to copy transcript.");
        }
    };

    return (
        <div className="h-[100dvh] w-full bg-neutral-950 text-white flex flex-col items-center justify-center overflow-hidden font-sans relative">
            <header className="absolute top-6 left-6 md:left-10 z-20 flex items-center gap-3 pointer-events-none">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-2 rounded-lg pointer-events-auto">
                    <Video className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-xl font-bold tracking-tight drop-shadow-md">Velora</h1>
                    <p className="text-xs text-gray-300 drop-shadow-md">AI-Powered Podcast Host</p>
                </div>
            </header>

            {/* Main Video Container - Full Screen on Mobile */}
            <main className="relative w-full h-full md:max-w-5xl md:h-auto md:aspect-video bg-neutral-900 md:rounded-3xl overflow-hidden shadow-2xl border-0 md:border border-neutral-800">

                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute opacity-0 pointer-events-none"
                />

                <canvas
                    ref={canvasRef}
                    className={`w-full h-full object-cover md:object-contain bg-black ${recordedUrl ? 'hidden' : 'block'}`}
                />

                {recordedUrl && (
                    <video
                        src={recordedUrl}
                        controls
                        className="w-full h-full object-contain bg-black absolute inset-0 z-10"
                    />
                )}

                {!recordedUrl && (
                    <>
                        {/* AI Status Indicator - Top Right */}
                        <div className="absolute top-6 right-6 z-20">
                            <div className={`px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2 text-xs font-medium border ${status === 'connected'
                                ? 'bg-green-500/20 border-green-500/30 text-green-400'
                                : status === 'connecting'
                                    ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                                    : 'bg-neutral-800/50 border-neutral-700 text-gray-400'
                                }`}>
                                <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-400 animate-pulse' : status === 'connecting' ? 'bg-yellow-400' : 'bg-gray-400'}`} />
                                {status === 'connected' ? 'AI HOST ACTIVE' : status === 'connecting' ? 'CONNECTING...' : status === 'error' ? 'ERROR' : 'AI READY'}
                            </div>
                        </div>

                        {/* Recording Timer - Bottom Right */}
                        {isRecording && (
                            <div className="absolute bottom-20 right-6 z-40">
                                <div className="px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2 text-xs font-medium border bg-red-500/20 border-red-500/30 text-red-400">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    REC {elapsedTime}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* HTML Subtitle Overlay - Positioned absolutely within the video container */}
                {/* Fixed: Top constraint increased to top-32 to strictly avoid status bar overlap */}
                <div className="absolute top-32 bottom-0 left-0 right-0 pointer-events-none p-6 flex flex-col justify-end z-30 pb-32 md:pb-24">
                    {recentTurns.map((turn) => (
                        <div
                            key={turn.id}
                            className={`mb-4 max-w-[85%] md:max-w-[60%] p-4 rounded-2xl backdrop-blur-md shadow-lg transition-all duration-500 animate-slide-up ${turn.role === 'user'
                                ? 'self-start bg-slate-900/90 text-white rounded-bl-none border border-slate-700/50'
                                : 'self-end bg-blue-900/90 text-white rounded-br-none border border-blue-700/50'
                                }`}
                        >
                            <div className={`text-xs font-bold mb-1 ${turn.role === 'user' ? 'text-slate-400' : 'text-blue-300'}`}>
                                {turn.role === 'user' ? 'YOU' : 'AI'}
                            </div>
                            <div className="text-sm md:text-base leading-relaxed break-words">
                                {turn.text}
                            </div>
                        </div>
                    ))}
                </div>

                {!isRecording && !recordedUrl && status !== 'connected' && status !== 'connecting' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-6 z-30">

                        <div className="text-center max-w-lg mb-6">
                            <p className="text-gray-300 text-base mb-3">
                                🎯 <strong>학습 자료 모드</strong> 또는 <strong>자유 대화</strong> 중 선택하세요
                            </p>
                            <p className="text-gray-400 text-sm">
                                <strong>학습 자료 모드</strong>: 자료를 안 읽어도 OK! AI가 학습을 도와주고, 그 내용을 영어로 말하게 도와드립니다.<br />
                                <strong>자유 대화</strong>: 비워두면 일상적인 영어 대화를 나눕니다.
                            </p>
                        </div>

                        <textarea
                            value={studyMaterial}
                            onChange={(e) => setStudyMaterial(e.target.value)}
                            placeholder="여기에 학습 자료를 붙여넣으세요 (선택사항)&#10;예: 뉴스 기사, 논문 요약, 읽고 있는 책 내용 등..."
                            className="w-full max-w-lg h-40 bg-neutral-800/80 border border-neutral-700 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 mb-6 resize-none text-sm"
                        />

                        <button
                            onClick={startRecording}
                            className="group relative flex items-center gap-3 bg-gradient-to-r from-violet-600 to-cyan-600 text-white px-8 py-4 rounded-full font-semibold text-lg hover:scale-105 transition-all duration-300 shadow-[0_0_40px_-10px_rgba(139,92,246,0.5)] hover:shadow-[0_0_60px_-10px_rgba(139,92,246,0.7)]"
                        >
                            <div className="absolute inset-0 rounded-full bg-white/20 group-hover:opacity-100 opacity-0 transition-opacity duration-300" />
                            <Play className="w-5 h-5 fill-white" />
                            {studyMaterial.trim() ? "학습 자료로 시작하기" : "자유 대화 시작하기"}
                        </button>
                        <p className="mt-6 text-xs text-gray-500 font-mono">POWERED BY GEMINI 2.5 FLASH</p>
                    </div>
                )}

                {/* Controls Overlay - Positioned at bottom center over the video */}
                <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-6 z-40 pointer-events-none">
                    {!recordedUrl ? (
                        <div className="pointer-events-auto flex items-center gap-6">
                            <button
                                onClick={toggleCamera}
                                className="w-12 h-12 rounded-full bg-neutral-900/80 hover:bg-neutral-800 backdrop-blur-md flex items-center justify-center transition-colors border border-white/10"
                                title={isCameraOn ? "Turn Camera Off" : "Turn Camera On"}
                            >
                                {isCameraOn ? (
                                    <Camera className="w-5 h-5 text-white" />
                                ) : (
                                    <CameraOff className="w-5 h-5 text-red-400" />
                                )}
                            </button>

                            {isRecording ? (
                                <button
                                    onClick={stopRecording}
                                    className="flex flex-col items-center gap-2 group"
                                >
                                    <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/50 backdrop-blur-md flex items-center justify-center transition-all shadow-[0_0_30px_-5px_rgba(239,68,68,0.4)] group-hover:shadow-[0_0_50px_-5px_rgba(239,68,68,0.6)] group-hover:scale-110">
                                        <div className="w-6 h-6 bg-red-500 rounded-sm shadow-inner" />
                                    </div>
                                    <span className="text-xs font-medium text-red-400 group-hover:text-red-300 transition-colors tracking-wider drop-shadow-md">STOP</span>
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <div className="pointer-events-auto flex items-center gap-4">
                            <button
                                onClick={() => {
                                    setRecordedUrl(null);
                                    initializeStream();
                                }}
                                className="px-6 py-3 rounded-full bg-black/50 hover:bg-black/70 border border-white/10 backdrop-blur-md text-white font-medium transition-all flex items-center gap-2"
                            >
                                <Settings2 className="w-4 h-4 text-gray-300" />
                                New
                            </button>
                            <button
                                onClick={downloadVideo}
                                className="px-6 py-3 rounded-full bg-violet-600/80 hover:bg-violet-600/90 border border-violet-500/30 backdrop-blur-md text-violet-200 font-medium transition-all flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                MP4
                            </button>
                            <button
                                onClick={copyTranscript}
                                className="px-6 py-3 rounded-full bg-cyan-600/80 hover:bg-cyan-600/90 border border-cyan-500/30 backdrop-blur-md text-cyan-200 font-medium transition-all flex items-center gap-2"
                            >
                                <Copy className="w-4 h-4" />
                                Copy
                            </button>
                        </div>
                    )}
                </div>
            </main>

            {/* Practice Mode Overlay */}
            {
                isPracticeMode && currentPractice && (
                    <PracticeMode
                        currentPractice={currentPractice}
                        onClose={exitPracticeMode}
                        onReprompt={generateContextualReprompt}
                        connectionStatus={status}
                    />
                )
            }

            {/* Correction Pill - Show ONLY the latest one, non-intrusive */}
            {corrections.length > 0 && (
                <CorrectionPill
                    key={corrections[corrections.length - 1].timestamp}
                    correction={corrections[corrections.length - 1]}
                    index={0}
                    onOpen={() => enterPracticeMode(corrections[corrections.length - 1])}
                />
            )}

            {
                !hasApiKey && showApiKeyModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
                            {/* Glow Effect */}
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-600 to-cyan-600" />

                            <div className="flex flex-col items-center gap-4 mb-6">
                                <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
                                    <Key className="w-6 h-6 text-violet-400" />
                                </div>
                                <div className="text-center">
                                    <h2 className="text-xl font-bold text-white">Enter API Key</h2>
                                    <p className="text-sm text-gray-400 mt-1">
                                        To use Velora, you need a Google Gemini API Key.
                                        It will be saved locally in your browser.
                                    </p>
                                </div>
                            </div>

                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const formData = new FormData(e.currentTarget);
                                    const key = formData.get('apiKey') as string;
                                    if (key.trim()) {
                                        localStorage.setItem('gemini_api_key', key.trim());
                                        setApiKey(key.trim());
                                    }
                                }}
                                className="flex flex-col gap-4"
                            >
                                <input
                                    name="apiKey"
                                    type="password"
                                    placeholder="AIzaSy..."
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-600 transition-all"
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-gray-200 transition-colors"
                                >
                                    Save & Continue
                                </button>

                                {import.meta.env.VITE_GEMINI_API_KEY && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            localStorage.removeItem('gemini_api_key');
                                            const envKey = import.meta.env.VITE_GEMINI_API_KEY || "";
                                            setApiKey(envKey);
                                            setHasApiKey(!!envKey);
                                            setShowApiKeyModal(false);
                                        }}
                                        className="w-full bg-neutral-800 text-white font-medium py-3 rounded-lg hover:bg-neutral-700 transition-colors text-sm"
                                    >
                                        Use Environment API Key
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => {
                                        localStorage.removeItem('gemini_api_key');
                                        setApiKey("");
                                        setHasApiKey(false);
                                        alert("Saved API key cleared. Please enter a new one or refresh the page to use environment key.");
                                    }}
                                    className="w-full text-red-400 font-medium py-2 rounded-lg hover:bg-red-950/50 transition-colors text-sm"
                                >
                                    Clear Saved Key
                                </button>
                            </form>

                            <p className="text-xs text-center text-gray-500 mt-6">
                                Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">Get one here</a>
                            </p>
                        </div>
                    </div>
                )
            }

            {
                !hasApiKey && !showApiKeyModal && (
                    <div className="fixed bottom-4 right-4 bg-red-900/90 border border-red-700 p-4 rounded-xl shadow-xl max-w-sm backdrop-blur-md cursor-pointer" onClick={() => setShowApiKeyModal(true)}>
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-200 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-red-100 text-sm">Missing API Key</h3>
                                <p className="text-xs text-red-200/70 mt-1">
                                    Click here to enter your Gemini API Key.
                                </p>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
