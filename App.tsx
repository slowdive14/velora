import React, { useState, useRef, useEffect } from 'react';
import { Video, Play, Download, Settings2, AlertCircle, Camera, CameraOff, FileText, Key, Smartphone } from 'lucide-react';
import { LiveService } from './services/liveService';
import { Message, ConnectionStatus, Correction } from './types';
import { blobToBase64, downsampleTo16k } from './utils/audioUtils';
import { diffWords } from './utils/diffUtils';

// --- Audio Worklet Code (Blob) ---
// We buffer ~4096 samples (approx 250ms at 16kHz).
// Larger chunks reduce network overhead and prevent "Network Error" disconnects.
const PCM_PROCESSOR_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.index = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.index++] = channel[i];
        // When buffer is full, flush to main thread
        if (this.index >= this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

// --- Components ---

const CorrectionPill: React.FC<{ correction: Correction; index: number; onOpen: () => void }> = ({ correction, index, onOpen }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={onOpen}
      className="fixed right-6 z-50 pointer-events-auto bg-black/70 backdrop-blur-xl border border-violet-500/30 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 hover:scale-105 transition-all group animate-slide-in"
      style={{
        bottom: `${96 + index * 80}px`,
        animation: 'slideInRight 0.3s ease-out'
      }}
    >
      {/* Original (strikethrough) */}
      <span className="text-red-300 line-through text-sm opacity-70 font-medium">
        {correction.original}
      </span>

      {/* Arrow */}
      <span className="text-gray-500 text-xs">→</span>

      {/* Corrected */}
      <span className="text-green-400 font-bold text-sm">
        {correction.corrected}
      </span>

      {/* Practice Icon */}
      <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center ml-2 group-hover:bg-violet-500 transition-colors">
        <Play className="w-3 h-3" />
      </div>
    </button>
  );
};

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('gemini_api_key') || process.env.API_KEY || "";
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const liveServiceRef = useRef<LiveService | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const aiAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const playbackDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const renderLoopRef = useRef<number | null>(null);

  // Subtitle State
  const currentSubtitleRef = useRef<string>("");
  // Stores completed user sentences for the current turn so they don't vanish
  const committedUserTranscriptRef = useRef<string>("");
  // Stores the latest provisional text to prevent empty final packets from wiping the screen
  const lastIntermediateUserTextRef = useRef<string>("");

  // Transcript History for Download
  const transcriptHistoryRef = useRef<{ role: 'user' | 'ai'; text: string }[]>([]);
  const aiTranscriptBufferRef = useRef<string>("");

  const currentRoleRef = useRef<'user' | 'ai' | null>(null);
  const subtitleTimeoutRef = useRef<number | null>(null);


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
      if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      liveServiceRef.current?.disconnect();
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
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
  };

  const exitPracticeMode = () => {
    setIsPracticeMode(false);
    setCurrentPractice(null);
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

    // Animated Wave
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)'; // Red-400
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(248, 113, 113, 0.5)';
    ctx.shadowBlur = 10;

    const amplitude = 50;

    // Draw multiple lines for a "thick" wave effect
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

    ctx.restore();

    // "REC" Indicator Text
    ctx.save();
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillStyle = '#f87171';
    ctx.textAlign = 'right';
    ctx.fillText("● RECORDING IN PROGRESS", width - 40, 50);
    ctx.restore();
  };

  const drawSubtitle = (ctx: CanvasRenderingContext2D, text: string, width: number, height: number) => {
    if (!text || text.trim() === "") return;

    // Config
    const fontSize = 40;
    const lineHeight = 56;
    const maxTextWidth = width * 0.8; // Wider text area

    ctx.font = `500 ${fontSize}px Inter, sans-serif`; // Clean, modern sans-serif
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap logic
    const words = text.trim().split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const w = ctx.measureText(currentLine + " " + word).width;
      if (w < maxTextWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    // Position: Centered vertically
    const totalHeight = lines.length * lineHeight;
    const startY = (height - totalHeight) / 2;

    // Draw Text with subtle shadow
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + (i * lineHeight));
    });

    // Reset shadow
    ctx.shadowColor = 'transparent';
  };

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
          // 2. Draw Subtitle Overlay
          if (currentSubtitleRef.current) {
            drawSubtitle(ctx, currentSubtitleRef.current, canvas.width, canvas.height);
          }
        }
      }
      renderLoopRef.current = requestAnimationFrame(loop);
    };
    loop(performance.now());
  };

  // --- Audio & Live Service Setup ---

  const setupAudioContext = async () => {
    // Native 16kHz context prevents resampling artifacts and improves connection stability
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    await ctx.resume();

    // Load AudioWorklet
    const blob = new Blob([PCM_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);

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
    currentSubtitleRef.current = "";
    committedUserTranscriptRef.current = "";
    lastIntermediateUserTextRef.current = "";
    currentRoleRef.current = null;
    transcriptHistoryRef.current = []; // Reset history
    aiTranscriptBufferRef.current = "";

    // Ensure we close any existing context
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 1. Setup Audio Pipeline
    const ctx = await setupAudioContext();
    audioContextRef.current = ctx;
    aiAudioDestinationRef.current = ctx.createMediaStreamDestination();

    // Create a destination for playback (speakers/earphones)
    // We route this to an HTML <audio> element to ensure mobile browsers respect system audio routing (Bluetooth/Headset)
    playbackDestinationRef.current = ctx.createMediaStreamDestination();
    if (playbackAudioRef.current) {
      playbackAudioRef.current.srcObject = playbackDestinationRef.current.stream;
      playbackAudioRef.current.play().catch(e => console.error("Playback failed", e));
    }

    nextStartTimeRef.current = 0;

    // 2. Connect to Gemini
    liveServiceRef.current = new LiveService({
      apiKey: apiKey,
      onAudioData: (buffer) => {
        // Play AI Audio
        if (!audioContextRef.current) return;
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;

        // Connect to Playback Destination (which goes to <audio> element)
        if (playbackDestinationRef.current) {
          source.connect(playbackDestinationRef.current);
        }

        // Connect to Recording Stream
        if (aiAudioDestinationRef.current) {
          source.connect(aiAudioDestinationRef.current);
        }

        const now = audioContextRef.current.currentTime;
        const start = Math.max(nextStartTimeRef.current, now);
        source.start(start);
        nextStartTimeRef.current = start + buffer.duration;
      },
      onTranscript: (text, isUser, isFinal) => {
        // Clear previous timeout to prevent clearing text while typing
        if (subtitleTimeoutRef.current) {
          clearTimeout(subtitleTimeoutRef.current);
          subtitleTimeoutRef.current = null;
        }

        const role = isUser ? 'user' : 'ai';

        // If role changed, reset text and history
        if (currentRoleRef.current !== role) {
          currentSubtitleRef.current = "";
          committedUserTranscriptRef.current = "";
          lastIntermediateUserTextRef.current = "";
          currentRoleRef.current = role;
        }

        if (isUser) {
          // User Transcript Logic:
          // The API provides the current turn transcript. 
          // CAUTION: The API often sends an EMPTY packet with isFinal=true when speech pauses.
          // We must use 'lastIntermediateUserTextRef' to survive this empty packet.

          if (text && text.trim() !== "") {
            // We have actual text, save it as the latest valid intermediate
            lastIntermediateUserTextRef.current = text;
          }

          if (isFinal) {
            // Turn finished. Commit what we have.
            // Fallback to lastIntermediate if the final packet is empty.
            const textToCommit = (text && text.trim() !== "") ? text : lastIntermediateUserTextRef.current;

            if (textToCommit) {
              committedUserTranscriptRef.current += (committedUserTranscriptRef.current ? " " : "") + textToCommit;
              currentSubtitleRef.current = committedUserTranscriptRef.current;

              // Add to history
              transcriptHistoryRef.current.push({ role: 'user', text: textToCommit });
            }
            // Reset intermediate for the next turn
            lastIntermediateUserTextRef.current = "";
          } else {
            // Streaming: Show committed + current provisional
            // Use text if available, otherwise show what we last saw (prevents flicker)
            const currentStream = (text && text.trim() !== "") ? text : lastIntermediateUserTextRef.current;
            const prefix = committedUserTranscriptRef.current ? committedUserTranscriptRef.current + " " : "";
            currentSubtitleRef.current = prefix + currentStream;
          }
        } else {
          // AI Transcript Logic:
          // AI streams delta tokens. We must buffer them to detect JSON that spans multiple chunks.
          // Pattern: {"original":"...","correction":"...","explanation":"..."}

          // 1. Append new chunk to the raw buffer (used for JSON detection)
          aiTranscriptBufferRef.current += text;

          // 2. Check if we have a complete JSON object in the buffer
          // We look for the pattern { ... "original" ... }
          const jsonPattern = /\{[\s\S]*?"original"[\s\S]*?"correction"[\s\S]*?"explanation"[\s\S]*?\}/;
          const match = aiTranscriptBufferRef.current.match(jsonPattern);

          if (match) {
            const jsonStr = match[0];
            try {
              const correctionData = JSON.parse(jsonStr);
              console.log("Parsed correction:", correctionData);

              if (correctionData.original && correctionData.correction && correctionData.explanation) {
                const newCorrection: Correction = {
                  original: correctionData.original,
                  corrected: correctionData.correction,
                  explanation: correctionData.explanation,
                  timestamp: Date.now(),
                  // Use the cleaned buffer (without JSON) as context
                  aiContext: aiTranscriptBufferRef.current.replace(jsonStr, '').trim()
                };

                // Add to corrections list
                correctionsRef.current = [...correctionsRef.current, newCorrection];
                setCorrections(prev => [...prev, newCorrection]);

                // Remove JSON from the buffer so it doesn't get parsed again
                // AND remove it from the display text
                aiTranscriptBufferRef.current = aiTranscriptBufferRef.current.replace(jsonStr, '').trim();

                // Also clean up the current subtitle if the JSON leaked into it
                // (This is tricky because currentSubtitleRef is cumulative, but we can try to clean it)
                currentSubtitleRef.current = currentSubtitleRef.current.replace(jsonStr, '').trim();
              }
            } catch (e) {
              // JSON might be incomplete, wait for more chunks
              // console.log("Waiting for more JSON chunks...");
            }
          }

          // 3. Update display text
          // We only want to show text that is NOT part of a JSON object.
          // Simple heuristic: If it looks like we are building a JSON object, don't show it yet.
          // However, for responsiveness, we usually show everything. 
          // A better approach for the USER is: Show everything, but if we detect JSON later, remove it (retroactively).
          // Since we already cleaned `currentSubtitleRef` above, we just need to append the NEW text here,
          // BUT we should be careful not to re-append the JSON part if we just removed it.

          // Strategy: Re-build currentSubtitle from the cleaned buffer
          // This ensures that once JSON is removed from buffer, it's gone from screen.
          // But we need to be careful about "committed" vs "streaming" text if we were separating them.
          // Here, AI text is just one long stream.

          currentSubtitleRef.current = aiTranscriptBufferRef.current;
        }

        if (isFinal && !isUser) {
          // Only auto-clear AI text after a delay
          subtitleTimeoutRef.current = window.setTimeout(() => {
            if (currentRoleRef.current === role && role === 'ai') {
              currentSubtitleRef.current = "";
            }
          }, 5000);

          // Add to history
          if (aiTranscriptBufferRef.current.trim()) {
            transcriptHistoryRef.current.push({ role: 'ai', text: aiTranscriptBufferRef.current });
            aiTranscriptBufferRef.current = "";
          }
        }
      },
      onClose: () => {
        setStatus('disconnected');
      },
      onError: () => {
        setStatus('error');
      }
    }, ctx);

    await liveServiceRef.current.connect(studyMaterial);
    setStatus('connected');

    // 3. Use AudioWorklet to capture mic
    const source = ctx.createMediaStreamSource(streamRef.current);

    // High-Pass Filter to remove low-frequency rumble/handling noise (common on mobile)
    const highPassFilter = ctx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 100; // Cut off below 100Hz

    const worklet = new AudioWorkletNode(ctx, 'pcm-processor');

    worklet.port.onmessage = (event) => {
      let inputData = event.data as Float32Array;

      // CRITICAL: Mobile browsers (iOS) often ignore sampleRate: 16000.
      // We must downsample manually if the context is running at a different rate (e.g. 44.1k/48k).
      if (ctx.sampleRate !== 16000) {
        inputData = downsampleTo16k(inputData, ctx.sampleRate);
      }

      liveServiceRef.current?.sendAudioChunk(inputData);
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

    // 4. Start Video Transmission
    startVideoTransmission();
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

    currentSubtitleRef.current = "";
    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);

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

  const downloadTranscript = () => {
    if (transcriptHistoryRef.current.length === 0) {
      alert("No transcript available.");
      return;
    }

    let mdContent = "# Conversation Transcript\n\n";
    if (studyMaterial.trim()) {
      mdContent += `## Study Material\n\n${studyMaterial}\n\n---\n\n`;
    }

    transcriptHistoryRef.current.forEach(entry => {
      const role = entry.role === 'user' ? '**User**' : '**AI**';
      mdContent += `${role}: ${entry.text}\n\n`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString()}.md`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      <header className="absolute top-6 left-6 md:left-10 z-20 flex items-center gap-3">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-2 rounded-lg">
          <Video className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Velora</h1>
          <p className="text-xs text-gray-400">AI-Powered Podcast Host</p>
        </div>
      </header>

      <main className="relative w-full max-w-5xl aspect-video bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-neutral-800">

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute opacity-0 pointer-events-none"
        />

        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain bg-black ${recordedUrl ? 'hidden' : 'block'}`}
        />

        {recordedUrl && (
          <video
            src={recordedUrl}
            controls
            className="w-full h-full object-contain bg-black absolute inset-0"
          />
        )}

        {!recordedUrl && (
          <>
            <div className="absolute top-6 right-6 flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2 text-xs font-medium border ${status === 'connected'
                ? 'bg-green-500/20 border-green-500/30 text-green-400'
                : status === 'connecting'
                  ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                  : 'bg-neutral-800/50 border-neutral-700 text-gray-400'
                }`}>
                <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-400 animate-pulse' : status === 'connecting' ? 'bg-yellow-400' : 'bg-gray-400'}`} />
                {status === 'connected' ? 'AI HOST ACTIVE' : status === 'connecting' ? 'CONNECTING...' : status === 'error' ? 'ERROR' : 'AI READY'}
              </div>

              {isRecording && (
                <div className="px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30 backdrop-blur-md flex items-center gap-2 text-xs font-medium text-red-400 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  REC
                </div>
              )}
            </div>
          </>
        )}

        {!isRecording && !recordedUrl && status !== 'connected' && status !== 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-6">

            <p className="text-gray-300 text-center max-w-md mb-6 text-sm">
              Paste a transcript or article below to practice specific content, or leave empty for a casual chat.
            </p>

            <textarea
              value={studyMaterial}
              onChange={(e) => setStudyMaterial(e.target.value)}
              placeholder="Paste your study material here (optional)..."
              className="w-full max-w-lg h-32 bg-neutral-800/80 border border-neutral-700 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6 resize-none text-sm"
            />

            <button
              onClick={startRecording}
              className="group relative flex items-center gap-3 bg-gradient-to-r from-violet-600 to-cyan-600 text-white px-8 py-4 rounded-full font-semibold text-lg hover:scale-105 transition-all duration-300 shadow-[0_0_40px_-10px_rgba(139,92,246,0.5)] hover:shadow-[0_0_60px_-10px_rgba(139,92,246,0.7)]"
            >
              <div className="absolute inset-0 rounded-full bg-white/20 group-hover:opacity-100 opacity-0 transition-opacity duration-300" />
              <Play className="w-5 h-5 fill-white" />
              {studyMaterial.trim() ? "Start Tutor Session" : "Start Podcast Chat"}
            </button>
            <p className="mt-6 text-xs text-gray-500 font-mono">POWERED BY GEMINI</p>
          </div>
        )}
      </main>

      <div className="mt-8 flex items-center justify-center gap-6">
        {!recordedUrl ? (
          <>
            <button
              onClick={toggleCamera}
              className="w-12 h-12 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center transition-colors border border-neutral-700"
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
                <span className="text-xs font-medium text-red-400 group-hover:text-red-300 transition-colors tracking-wider">STOP SESSION</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setRecordedUrl(null);
                initializeStream();
              }}
              className="px-6 py-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md text-white font-medium transition-all flex items-center gap-2 hover:border-white/20"
            >
              <Settings2 className="w-4 h-4 text-gray-300" />
              New Recording
            </button>
            <button
              onClick={downloadVideo}
              className="px-6 py-3 rounded-full bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 backdrop-blur-md text-violet-200 font-medium transition-all flex items-center gap-2 hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)]"
            >
              <Download className="w-4 h-4" />
              Download MP4
            </button>
            <button
              onClick={downloadTranscript}
              className="px-6 py-3 rounded-full bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 backdrop-blur-md text-cyan-200 font-medium transition-all flex items-center gap-2 hover:shadow-[0_0_20px_-5px_rgba(8,145,178,0.3)]"
            >
              <FileText className="w-4 h-4" />
              Download Transcript
            </button>
          </>
        )}
      </div>

      {/* Hidden Audio Element for Mobile Routing */}
      <audio ref={playbackAudioRef} hidden playsInline />

      {/* Correction Pills - Show last 3 corrections */}
      {!isPracticeMode && corrections.slice(-3).map((correction, idx) => (
        <CorrectionPill
          key={`${correction.timestamp}-${idx}`}
          correction={correction}
          index={idx}
          onOpen={() => enterPracticeMode(correction)}
        />
      ))}

      {/* Practice Mode Overlay */}
      {isPracticeMode && currentPractice && (
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4 animate-fadeIn">
          <div className="max-w-5xl w-full bg-[#09090b] border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col gap-8 max-h-[90vh] overflow-y-auto">

            {/* 1. Topic Initiation (Top) */}
            <div className="text-center space-y-2">
              <span className="text-xs font-bold text-violet-400 tracking-widest uppercase">Current Topic</span>
              <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight">
                "Do you think AI will solve more problems than it creates?"
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
                  {/* Listening Indicator (Visual only for now) */}
                  <div className="absolute bottom-4 right-6 flex items-center gap-2 opacity-50">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-400 font-medium">Recorded</span>
                  </div>
                </div>
              </div>

              {/* 4. AI Correction (Right Blue Bubble) */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider ml-1">Try Saying This</span>
                <div className="bg-[#1e3a8a] rounded-3xl rounded-tr-none p-6 shadow-[0_0_40px_-10px_rgba(30,58,138,0.5)] relative overflow-hidden">
                  {/* Shine Effect */}
                  <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                  <p className="text-xl text-white leading-relaxed font-medium relative z-10">
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
                </div>
              </div>
            </div>

            {/* 5. Contextual Feedback (Tip Section) */}
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-6 flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                <span className="text-violet-300 font-bold text-sm">TIP</span>
              </div>
              <div className="space-y-1">
                <p className="text-violet-200 text-lg font-medium">
                  {currentPractice.explanation}
                </p>
                <p className="text-violet-400/60 text-sm">
                  Improved phrasing and word choice for clarity and flow.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 mt-auto pt-4 border-t border-white/5">
              <button
                onClick={exitPracticeMode}
                className="flex-1 px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all"
              >
                Close
              </button>
              <button
                onClick={exitPracticeMode}
                className="flex-1 px-8 py-4 rounded-xl bg-white text-black font-bold hover:scale-[1.02] transition-all shadow-xl flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                Practice Speaking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portrait Mode Warning Overlay */}
      <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center md:hidden portrait:flex hidden">
        <div className="w-20 h-20 rounded-full bg-violet-500/20 flex items-center justify-center mb-6 animate-pulse">
          <Smartphone className="w-10 h-10 text-violet-400 rotate-90" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Rotate Your Device</h2>
        <p className="text-gray-400">
          Velora is designed for landscape mode. <br />
          Please rotate your phone for the best experience.
        </p>
      </div>

      {!hasApiKey && showApiKeyModal && (
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
            </form>

            <p className="text-xs text-center text-gray-500 mt-6">
              Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">Get one here</a>
            </p>
          </div>
        </div>
      )}

      {!hasApiKey && !showApiKeyModal && (
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
      )}
      {/* Version Indicator */}
      <div className="fixed bottom-2 right-2 text-[10px] text-white/20 pointer-events-none z-50">
        v2.0 (Diff UI)
      </div>
    </div>
  );
}