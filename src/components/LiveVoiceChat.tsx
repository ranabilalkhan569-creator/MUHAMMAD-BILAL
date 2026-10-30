import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  FileUp,
  Globe,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Send,
  Trash2,
  Volume2,
} from "lucide-react";
import {
  DocumentAnalysis,
  LiveTranscriptTurn,
  VoicePersonaId,
  WebResearchSource,
} from "../types";
import { VOICE_PERSONAS } from "../data/sampleDocuments";
import { ALL_SUPPORTED_FILE_ACCEPT } from "../utils/fileExtractor";

interface LiveVoiceChatProps {
  analysis: DocumentAnalysis | null;
  selectedVoice: VoicePersonaId;
  onSelectVoice: (voice: VoicePersonaId) => void;
  onUploadFile?: (file: File) => void;
  onDeletePdf?: () => void;
  onLiveConnectionChange?: (connected: boolean) => void;
  isUploadingPdf?: boolean;
  autoConnectTrigger?: number;
  highContrastDark?: boolean;
}

type ConnectionState = "idle" | "connecting" | "connected" | "error";

function float32To16kHzPcmBase64(
  inputBuffer: Float32Array,
  inputSampleRate: number
): { base64: string; rms: number } {
  let sumSq = 0;
  for (let i = 0; i < inputBuffer.length; i++) {
    sumSq += inputBuffer[i] * inputBuffer[i];
  }
  const rms = Math.sqrt(sumSq / (inputBuffer.length || 1));

  const targetRate = 16000;
  let pcm16: Int16Array;

  if (inputSampleRate === targetRate) {
    pcm16 = new Int16Array(inputBuffer.length);
    for (let i = 0; i < inputBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, inputBuffer[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  } else {
    const ratio = inputSampleRate / targetRate;
    const outputLength = Math.max(1, Math.round(inputBuffer.length / ratio));
    pcm16 = new Int16Array(outputLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < outputLength) {
      const nextOffsetBuffer = Math.min(
        inputBuffer.length,
        Math.round((offsetResult + 1) * ratio)
      );
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
        accum += inputBuffer[i];
        count++;
      }
      const avg = count > 0 ? accum / count : 0;
      const clamped = Math.max(-1, Math.min(1, avg));
      pcm16[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), rms };
}

function decode24kHzPcmBase64(base64: string): {
  samples: Float32Array;
  rms: number;
} {
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const numSamples = byteLength / 2;
  const float32 = new Float32Array(numSamples);
  let sumSq = 0;
  for (let i = 0; i < numSamples; i++) {
    const int16 = view.getInt16(i * 2, true);
    const sample = int16 / 32768.0;
    float32[i] = sample;
    sumSq += sample * sample;
  }
  const rms = Math.sqrt(sumSq / (numSamples || 1));
  return { samples: float32, rms };
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export const LiveVoiceChat: React.FC<LiveVoiceChatProps> = ({
  analysis,
  selectedVoice,
  onSelectVoice,
  onUploadFile,
  onDeletePdf,
  onLiveConnectionChange,
  isUploadingPdf = false,
  autoConnectTrigger = 0,
  highContrastDark = false,
}) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptTurns, setTranscriptTurns] = useState<LiveTranscriptTurn[]>([]);
  const [quietTextInput, setQuietTextInput] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // PDF Reading & Web Research telemetry
  const [selectedPageToRead, setSelectedPageToRead] = useState<number>(1);
  const [focusedPdfPage, setFocusedPdfPage] = useState<number | null>(null);
  const [toolActivityLabel, setToolActivityLabel] = useState<string | null>(null);
  const [showPdfPagesDrawer, setShowPdfPagesDrawer] = useState<boolean>(false);

  // Refs to avoid stale closures inside audio/socket callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef<boolean>(false);
  const isReadyRef = useRef<boolean>(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoTriggerRef = useRef<number>(0);
  const syncedDocSignatureRef = useRef<string>("");
  const pendingWebResearchRef = useRef<{
    query: string;
    sources: WebResearchSource[];
  } | null>(null);

  const totalPages = analysis
    ? analysis.pages && analysis.pages.length > 0
      ? analysis.pages.length
      : analysis.detectedPageCountEstimate || 1
    : 0;

  useEffect(() => {
    onLiveConnectionChange?.(connectionState === "connected");
  }, [connectionState, onLiveConnectionChange]);

  useEffect(() => {
    setSelectedPageToRead(1);
    setFocusedPdfPage(null);
    if (!analysis) {
      setShowPdfPagesDrawer(false);
    }
  }, [analysis?.documentId, analysis?.fileName, analysis]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcriptTurns]);

  useEffect(() => {
    if (connectionState !== "connected") return;
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [connectionState]);

  const stopAllPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {}
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAssistantSpeaking(false);
  }, []);

  const cleanupSession = useCallback(() => {
    isReadyRef.current = false;
    stopAllPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    setAudioLevel(0);
    setIsAssistantSpeaking(false);
    setToolActivityLabel(null);
  }, [stopAllPlayback]);

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, [cleanupSession]);

  // Dynamically sync PDF additions or PDF deletions into an already-open Live Voice session
  const docSignature = analysis
    ? `${analysis.documentId || ""}::${analysis.fileName}::${analysis.documentTitle}`
    : "__NO_PDF__";

  useEffect(() => {
    if (
      connectionState === "connected" &&
      isReadyRef.current &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      syncedDocSignatureRef.current &&
      syncedDocSignatureRef.current !== docSignature
    ) {
      syncedDocSignatureRef.current = docSignature;
      stopAllPlayback();

      if (!analysis) {
        wsRef.current.send(
          JSON.stringify({
            type: "clear_document",
          })
        );
      } else {
        setFocusedPdfPage(1);
        wsRef.current.send(
          JSON.stringify({
            type: "update_document",
            documentContext: analysis,
            autoReadAloud: true,
          })
        );
      }
    }
  }, [analysis, connectionState, docSignature, stopAllPlayback]);

  const appendStreamingTranscript = useCallback(
    (role: "user" | "model", chunkText: string) => {
      if (!chunkText) return;
      const nowLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setTranscriptTurns((prev) => {
        const pendingWeb =
          role === "model" ? pendingWebResearchRef.current : null;
        if (role === "model" && pendingWeb) {
          pendingWebResearchRef.current = null;
        }

        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.isFinal) {
          const updated = [...prev];
          const mergedSources = pendingWeb?.sources?.length
            ? [
                ...(last.webSources || []),
                ...pendingWeb.sources.filter(
                  (s) => !(last.webSources || []).some((e) => e.uri === s.uri)
                ),
              ]
            : last.webSources;

          updated[updated.length - 1] = {
            ...last,
            text: last.text + chunkText,
            webSources: mergedSources,
            researchQuery: pendingWeb?.query || last.researchQuery,
          };
          return updated;
        }

        const finalizedPrev = prev.map((t, idx) =>
          idx === prev.length - 1 ? { ...t, isFinal: true } : t
        );

        return [
          ...finalizedPrev,
          {
            id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role,
            text: chunkText,
            isFinal: false,
            timestamp: nowLabel,
            webSources: pendingWeb?.sources,
            researchQuery: pendingWeb?.query,
          },
        ];
      });
    },
    []
  );

  const attachWebSourcesToTranscript = useCallback(
    (query: string, sources: WebResearchSource[]) => {
      setTranscriptTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "model" && !last.isFinal) {
          const updated = [...prev];
          const merged = [
            ...(last.webSources || []),
            ...sources.filter(
              (s) => !(last.webSources || []).some((e) => e.uri === s.uri)
            ),
          ];
          updated[updated.length - 1] = {
            ...last,
            webSources: merged,
            researchQuery: query,
          };
          return updated;
        }
        pendingWebResearchRef.current = { query, sources };
        return prev;
      });
    },
    []
  );

  const finalizeLatestTurn = useCallback(() => {
    setTranscriptTurns((prev) =>
      prev.map((t, idx) => (idx === prev.length - 1 ? { ...t, isFinal: true } : t))
    );
  }, []);

  const scheduleOutputAudioChunk = useCallback((base64Data: string) => {
    const outputCtx = outputAudioCtxRef.current;
    if (!outputCtx) return;

    if (outputCtx.state === "suspended") {
      outputCtx.resume().catch(() => {});
    }

    const { samples, rms } = decode24kHzPcmBase64(base64Data);
    if (samples.length === 0) return;

    setAudioLevel(Math.min(1, rms * 4.5));
    setIsAssistantSpeaking(true);

    const buffer = outputCtx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = outputCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputCtx.destination);

    const now = outputCtx.currentTime;
    const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsAssistantSpeaking(false);
        setAudioLevel(0);
      }
    };
  }, []);

  const startLiveSession = useCallback(
    async (
      initialMode: "greet" | "read_from_start" | "web_research" = "greet"
    ) => {
      if (connectionState === "connecting" || connectionState === "connected") {
        return;
      }

      cleanupSession();
      setErrorMessage(null);
      setElapsedSeconds(0);
      setIsMuted(false);
      isMutedRef.current = false;
      setConnectionState("connecting");

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error(
            "Microphone access is not available in this browser environment."
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = stream;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;

        const inputCtx = new AudioCtx({ sampleRate: 16000 });
        const outputCtx = new AudioCtx({ sampleRate: 24000 });
        await inputCtx.resume();
        await outputCtx.resume();

        inputAudioCtxRef.current = inputCtx;
        outputAudioCtxRef.current = outputCtx;

        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${wsProto}//${window.location.host}/api/live`);
        wsRef.current = ws;

        ws.onopen = () => {
          syncedDocSignatureRef.current = docSignature;
          ws.send(
            JSON.stringify({
              type: "init",
              voiceName: selectedVoice,
              documentContext: analysis,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "ready") {
              isReadyRef.current = true;
              setConnectionState("connected");

              const source = inputCtx.createMediaStreamSource(stream);
              const processor = inputCtx.createScriptProcessor(4096, 1, 1);
              const silentGain = inputCtx.createGain();
              silentGain.gain.value = 0;

              processor.onaudioprocess = (audioEvent) => {
                if (!isReadyRef.current || isMutedRef.current) return;
                const socket = wsRef.current;
                if (!socket || socket.readyState !== WebSocket.OPEN) return;

                const channelData = audioEvent.inputBuffer.getChannelData(0);
                const { base64, rms } = float32To16kHzPcmBase64(
                  channelData,
                  inputCtx.sampleRate
                );

                if (activeSourcesRef.current.size === 0) {
                  setAudioLevel(Math.min(1, rms * 6));
                }

                socket.send(JSON.stringify({ type: "audio", audio: base64 }));
              };

              source.connect(processor);
              processor.connect(silentGain);
              silentGain.connect(inputCtx.destination);
              processorRef.current = processor;

              if (analysis && initialMode === "read_from_start") {
                setFocusedPdfPage(1);
                ws.send(
                  JSON.stringify({
                    type: "text",
                    text: `First, confirm in one brief sentence what this PDF actually contains inside (${totalPages} pages${
                      analysis.totalWordsRead
                        ? `, ${analysis.totalWordsRead} words`
                        : ""
                    }), and then immediately start reading Page 1 aloud word-for-word and line-by-line without skipping any sentence. At the end of Page 1, ask if I want you to continue reading Page 2 word-for-word.`,
                  })
                );
              } else if (initialMode === "web_research") {
                const topicDesc = analysis
                  ? `"${analysis.documentTitle}"`
                  : "any topic I want to explore";
                ws.send(
                  JSON.stringify({
                    type: "text",
                    text: analysis
                      ? `Call searchGoogleWebResearch to gather internet details, background context, and current facts related to ${topicDesc}, then speak a clear summary of what you found on the web.`
                      : `Greet me warmly in two short sentences and let me know you are connected with live Google Search web research, or I can upload a PDF anytime for you to read aloud.`,
                  })
                );
              } else if (analysis) {
                ws.send(
                  JSON.stringify({
                    type: "text",
                    text: `Report back warmly in 3 to 4 spoken sentences proving you have read inside the entire PDF (${totalPages} pages${
                      analysis.totalLinesRead
                        ? `, ${analysis.totalLinesRead} lines`
                        : ""
                    }${
                      analysis.totalWordsRead
                        ? `, ${analysis.totalWordsRead} words`
                        : ""
                    }): state the actual subject, key facts, numbers, or headings inside the document (NEVER just repeat the file name!), and ask if I want you to read Page 1 word-for-word or give a page-by-page breakdown.`,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: "text",
                    text: `Greet me warmly in two short sentences: let me know I can upload a new PDF anytime for you to read every line and word aloud, or ask any spoken question right now and you will research it on Google.`,
                  })
                );
              }
              return;
            }

            if (msg.type === "pdf_page_focus" && typeof msg.pageNumber === "number") {
              setFocusedPdfPage(msg.pageNumber);
              setSelectedPageToRead(msg.pageNumber);
              setToolActivityLabel(`Reading PDF Page ${msg.pageNumber}`);
              return;
            }

            if (msg.type === "tool_activity" && typeof msg.label === "string") {
              setToolActivityLabel(msg.label);
              return;
            }

            if (msg.type === "web_research_results") {
              const sources: WebResearchSource[] = Array.isArray(msg.sources)
                ? msg.sources
                : [];
              const qStr = typeof msg.query === "string" ? msg.query : "";
              attachWebSourcesToTranscript(qStr, sources);
              setToolActivityLabel(
                `Found ${sources.length} web ${
                  sources.length === 1 ? "source" : "sources"
                } via Google Search`
              );
              return;
            }

            if (msg.type === "document_cleared") {
              setFocusedPdfPage(null);
              setToolActivityLabel("PDF removed — ready for new PDF or web search");
              return;
            }

            if (msg.type === "audio" && typeof msg.audio === "string") {
              scheduleOutputAudioChunk(msg.audio);
              return;
            }

            if (msg.type === "input_transcript" && typeof msg.text === "string") {
              appendStreamingTranscript("user", msg.text);
              return;
            }

            if (msg.type === "output_transcript" && typeof msg.text === "string") {
              appendStreamingTranscript("model", msg.text);
              return;
            }

            if (msg.type === "interrupted") {
              stopAllPlayback();
              finalizeLatestTurn();
              return;
            }

            if (msg.type === "turn_complete") {
              setToolActivityLabel(null);
              finalizeLatestTurn();
              return;
            }

            if (msg.type === "error") {
              setErrorMessage(
                msg.error || "Live voice connection encountered an error."
              );
              setConnectionState("error");
              cleanupSession();
              return;
            }

            if (msg.type === "session_closed") {
              setConnectionState("idle");
              cleanupSession();
            }
          } catch {}
        };

        ws.onerror = () => {
          setErrorMessage("Could not connect to the Live Voice WebSocket server.");
          setConnectionState("error");
          cleanupSession();
        };

        ws.onclose = () => {
          setConnectionState((prev) => (prev === "error" ? "error" : "idle"));
          cleanupSession();
        };
      } catch (err) {
        const raw =
          err instanceof Error ? err.message : "Microphone permission denied.";
        setErrorMessage(
          raw.includes("Permission") || raw.includes("NotAllowed")
            ? "Microphone permission was blocked. Please allow microphone access in your browser to use Live Voice Chat."
            : raw
        );
        setConnectionState("error");
        cleanupSession();
      }
    },
    [
      analysis,
      appendStreamingTranscript,
      attachWebSourcesToTranscript,
      cleanupSession,
      connectionState,
      docSignature,
      finalizeLatestTurn,
      scheduleOutputAudioChunk,
      selectedVoice,
      stopAllPlayback,
      totalPages,
    ]
  );

  useEffect(() => {
    if (
      autoConnectTrigger > 0 &&
      autoConnectTrigger !== lastAutoTriggerRef.current
    ) {
      lastAutoTriggerRef.current = autoConnectTrigger;
      startLiveSession("greet");
    }
  }, [autoConnectTrigger, startLiveSession]);

  const handleEndSession = () => {
    cleanupSession();
    setConnectionState("idle");
  };

  const handleSendCommandToLive = (promptText: string, displayLabel?: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    if (connectionState !== "connected" || !wsRef.current) {
      return;
    }

    stopAllPlayback();
    appendStreamingTranscript("user", displayLabel || trimmed);
    finalizeLatestTurn();
    wsRef.current.send(JSON.stringify({ type: "text", text: trimmed }));
    setQuietTextInput("");
  };

  const handleReadPageCommand = (pageNum: number) => {
    if (!analysis) return;
    setFocusedPdfPage(pageNum);
    const pageObj = analysis.pages?.find((p) => p.pageNumber === pageNum);
    const headingNote = pageObj?.heading ? ` (${pageObj.heading})` : "";
    handleSendCommandToLive(
      `Call getPdfPageContent for pageNumber ${pageNum} if needed, then read EVERY SINGLE LINE and EVERY SINGLE WORD of Page ${pageNum}${headingNote} aloud verbatim and clearly without skipping anything. When you finish reading Page ${pageNum}, ask if I want you to continue to Page ${
        pageNum + 1 <= totalPages ? pageNum + 1 : pageNum
      }.`,
      `Read Page ${pageNum}${headingNote} word-for-word`
    );
  };

  const handleWebResearchTopicCommand = () => {
    if (analysis) {
      handleSendCommandToLive(
        `Use searchGoogleWebResearch right now to search Google and conduct internet research regarding "${analysis.documentTitle}" (${analysis.overview}). Share key background facts, standards, or recent web developments related to this topic clearly aloud.`,
        `Search Google & research topic: "${analysis.documentTitle}"`
      );
    } else {
      handleSendCommandToLive(
        `Please ask me what topic I would like you to research on Google right now.`,
        `Start Google Web Research`
      );
    }
  };

  const statusText = isUploadingPdf
    ? "Scanning & extracting full-page text across all pages..."
    : connectionState === "connecting"
    ? "Connecting to Voice AI + Google Search..."
    : connectionState === "connected"
    ? toolActivityLabel
      ? toolActivityLabel
      : isAssistantSpeaking
      ? `${selectedVoice} Speaking — Interrupt anytime with your voice`
      : isMuted
      ? "Microphone Muted"
      : analysis
      ? "Listening — Ask about any page/line, say 'Read Page 1', or ask to search Google"
      : "Listening — Upload a PDF, JPG, or PNG or ask any question to search Google"
    : connectionState === "error"
    ? "Session Disconnected"
    : analysis
    ? `Full-Page Text Ready (${totalPages} ${totalPages === 1 ? "page" : "pages"}) · Google Search Enabled`
    : "No File Loaded · Upload PDF, JPG, or PNG to Read Aloud or Research on Google";

  const barMultipliers = [0.45, 0.85, 1.0, 0.75, 0.5];

  return (
    <div
      className={`flex flex-col h-[650px] transition-colors ${
        highContrastDark ? "bg-[#0B1120] text-slate-100" : "bg-white text-slate-900"
      }`}
    >
      {/* Hidden direct multi-format uploader inside Voice Chat */}
      {onUploadFile && (
        <input
          ref={localFileInputRef}
          type="file"
          accept={ALL_SUPPORTED_FILE_ACCEPT}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadFile(file);
            e.target.value = "";
          }}
          className="sr-only"
        />
      )}

      {/* Top Voice Session & PDF Document Management Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b ${
          highContrastDark
            ? "border-slate-800 bg-slate-900/80"
            : "border-slate-200 bg-slate-50/80"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs mb-1">
            <Radio
              className={`w-3.5 h-3.5 shrink-0 ${
                connectionState === "connected"
                  ? highContrastDark
                    ? "text-amber-300"
                    : "text-emerald-700"
                  : "text-slate-400"
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold">{statusText}</span>
            {connectionState === "connected" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatTimer(elapsedSeconds)}
                </span>
              </>
            )}
          </div>

          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${
              highContrastDark ? "text-slate-300" : "text-slate-600"
            }`}
          >
            {analysis ? (
              <>
                <span className="font-medium truncate max-w-[240px]">
                  {analysis.documentTitle}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {totalPages} {totalPages === 1 ? "page" : "pages"}
                  {analysis.totalLinesRead
                    ? ` · ${analysis.totalLinesRead.toLocaleString()} lines`
                    : ""}
                  {analysis.totalWordsRead
                    ? ` · ${analysis.totalWordsRead.toLocaleString()} words`
                    : ""}
                </span>
                {focusedPdfPage && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        highContrastDark ? "text-amber-300" : "text-blue-700"
                      }`}
                    >
                      Active Page {focusedPdfPage}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>No document active — Add PDF, JPG, or PNG to read aloud</span>
            )}
          </div>
        </div>

        {/* Add PDF + Delete PDF + PDF Pages + Voice Selector + Call Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onUploadFile && (
            <button
              type="button"
              onClick={() => localFileInputRef.current?.click()}
              disabled={isUploadingPdf}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                !analysis
                  ? "bg-blue-700 border-blue-700 text-white hover:bg-blue-800"
                  : highContrastDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700"
                  : "bg-white border-slate-200 text-slate-800 hover:bg-slate-100"
              }`}
            >
              {isUploadingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Scanning Pages...
                </>
              ) : (
                <>
                  <FileUp
                    className={`w-3.5 h-3.5 ${
                      !analysis
                        ? "text-white"
                        : highContrastDark
                        ? "text-blue-400"
                        : "text-blue-700"
                    }`}
                    aria-hidden="true"
                  />
                  {analysis ? "Add File (PDF/JPG/PNG)" : "Add PDF / Image"}
                </>
              )}
            </button>
          )}

          {analysis && onDeletePdf && (
            <button
              type="button"
              onClick={onDeletePdf}
              disabled={isUploadingPdf}
              aria-label={`Delete ${analysis.fileName}`}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                highContrastDark
                  ? "bg-slate-800 border-red-800/80 text-red-300 hover:bg-red-950/50"
                  : "bg-white border-red-200 text-red-700 hover:bg-red-50"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Delete PDF
            </button>
          )}

          {analysis && (
            <button
              type="button"
              onClick={() => setShowPdfPagesDrawer((v) => !v)}
              aria-expanded={showPdfPagesDrawer}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                showPdfPagesDrawer
                  ? highContrastDark
                    ? "bg-amber-400 text-slate-950 border-amber-400"
                    : "bg-slate-900 text-white border-slate-900"
                  : highContrastDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700"
                  : "bg-white border-slate-200 text-slate-800 hover:bg-slate-100"
              }`}
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              Pages ({totalPages})
            </button>
          )}

          {connectionState !== "connected" && connectionState !== "connecting" && (
            <select
              aria-label="Voice persona for live PDF voice chat"
              value={selectedVoice}
              onChange={(e) => onSelectVoice(e.target.value as VoicePersonaId)}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border min-h-[38px] ${
                highContrastDark
                  ? "bg-slate-900 border-slate-700 text-slate-100"
                  : "bg-white border-slate-200 text-slate-800"
              }`}
            >
              {VOICE_PERSONAS.map((v) => (
                <option key={v.id} value={v.id}>
                  Voice: {v.name}
                </option>
              ))}
            </select>
          )}

          {connectionState === "connected" ? (
            <>
              <button
                type="button"
                onClick={() => setIsMuted((m) => !m)}
                aria-pressed={isMuted}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  isMuted
                    ? highContrastDark
                      ? "bg-amber-400 border-amber-400 text-slate-950"
                      : "bg-amber-100 border-amber-300 text-amber-950"
                    : highContrastDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700"
                    : "bg-white border-slate-200 text-slate-800 hover:bg-slate-100"
                }`}
              >
                {isMuted ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
                    Unmute
                  </>
                ) : (
                  <>
                    <Mic
                      className={`w-3.5 h-3.5 ${
                        highContrastDark ? "text-blue-400" : "text-blue-700"
                      }`}
                      aria-hidden="true"
                    />
                    Mute
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleEndSession}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
              >
                <PhoneOff className="w-3.5 h-3.5" aria-hidden="true" />
                End Call
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => startLiveSession("greet")}
              disabled={connectionState === "connecting" || isUploadingPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
            >
              {connectionState === "connecting" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Connecting...
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  Start Voice Chat
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Interactive PDF Voice Reader + Google Web Research Action Bar when Connected */}
      {connectionState === "connected" && (
        <div
          className={`px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 ${
            highContrastDark
              ? "border-slate-800 bg-slate-900/40"
              : "border-slate-200 bg-blue-50/40"
          }`}
        >
          {analysis ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleReadPageCommand(1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                Read PDF Aloud
              </button>

              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Choose PDF page to read aloud"
                  value={selectedPageToRead}
                  onChange={(e) => {
                    const nextPage = Number(e.target.value);
                    setSelectedPageToRead(nextPage);
                    handleReadPageCommand(nextPage);
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border min-h-[34px] max-w-[190px] truncate ${
                    highContrastDark
                      ? "bg-slate-800 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                >
                  {Array.from({ length: totalPages }, (_, idx) => {
                    const pNum = idx + 1;
                    const heading = analysis.pages?.find(
                      (p) => p.pageNumber === pNum
                    )?.heading;
                    return (
                      <option key={pNum} value={pNum}>
                        Page {pNum}
                        {heading ? ` — ${heading.slice(0, 26)}` : ""}
                      </option>
                    );
                  })}
                </select>

                <button
                  type="button"
                  onClick={() => handleReadPageCommand(selectedPageToRead)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    highContrastDark
                      ? "border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  Read Page
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="opacity-80">
                No PDF active — upload a new PDF to read it aloud automatically.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleWebResearchTopicCommand}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                highContrastDark
                  ? "border-slate-700 bg-slate-800 text-sky-300 hover:bg-slate-700"
                  : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              {analysis ? "Research Topic on Google" : "Search Google by Voice"}
            </button>

            {analysis && (
              <button
                type="button"
                onClick={() =>
                  handleSendCommandToLive(
                    `Report back thoroughly on everything inside "${analysis.documentTitle}" page by page—mentioning exact headings, names, numbers, dates, and conclusions from inside the document—then ask which page I want read word-for-word.`,
                    "Give complete page-by-page report of PDF contents"
                  )
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                  highContrastDark
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                Full Content Report
              </button>
            )}
          </div>
        </div>
      )}

      {/* Collapsible Indexed PDF Pages Inspector */}
      {analysis && showPdfPagesDrawer && (
        <div
          className={`max-h-48 overflow-y-auto px-6 py-4 border-b space-y-3 ${
            highContrastDark
              ? "border-slate-800 bg-slate-900/90"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              Extracted PDF Text Known by Voice AI ({totalPages}{" "}
              {totalPages === 1 ? "page" : "pages"})
            </span>
            <button
              type="button"
              onClick={() => setShowPdfPagesDrawer(false)}
              className="text-xs underline opacity-80 whitespace-nowrap shrink-0"
            >
              Hide Pages
            </button>
          </div>
          {(analysis.pages && analysis.pages.length > 0
            ? analysis.pages
            : [{ pageNumber: 1, heading: analysis.documentTitle, text: analysis.narrationScript }]
          ).map((page) => {
            const isFocused = focusedPdfPage === page.pageNumber;
            return (
              <div
                key={page.pageNumber}
                className={`rounded-lg border p-3 text-xs ${
                  isFocused
                    ? highContrastDark
                      ? "border-amber-400 bg-slate-800"
                      : "border-blue-600 bg-white"
                    : highContrastDark
                    ? "border-slate-800 bg-slate-950/60"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold">
                    Page {page.pageNumber}: {page.heading}
                  </span>
                  {connectionState === "connected" && (
                    <button
                      type="button"
                      onClick={() => handleReadPageCommand(page.pageNumber)}
                      className={`text-xs font-semibold hover:underline whitespace-nowrap shrink-0 ${
                        highContrastDark ? "text-amber-300" : "text-blue-700"
                      }`}
                    >
                      Read This Page Aloud
                    </button>
                  )}
                </div>
                <p className="opacity-85 whitespace-pre-line leading-relaxed">
                  {page.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Scrollable Voice Conversation, Upload Dropzone & Live Captions Area */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Live PDF voice chat captions"
        className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
      >
        {errorMessage && (
          <div
            role="alert"
            className={`rounded-lg border px-4 py-3 text-xs ${
              highContrastDark
                ? "border-red-800 bg-red-950/60 text-red-200"
                : "border-red-300 bg-red-50 text-red-900"
            }`}
          >
            {errorMessage}
          </div>
        )}

        {/* Active Acoustic Meter Bar when connected */}
        {connectionState === "connected" && (
          <div
            className={`rounded-xl border px-5 py-4 flex items-center justify-between gap-4 ${
              highContrastDark
                ? "border-slate-800 bg-slate-900/60"
                : "border-slate-200 bg-slate-50/70"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  isAssistantSpeaking
                    ? "bg-blue-700 text-white"
                    : isMuted
                    ? highContrastDark
                      ? "bg-slate-800 text-slate-300"
                      : "bg-slate-200 text-slate-600"
                    : "bg-emerald-700 text-white"
                }`}
              >
                {isAssistantSpeaking ? (
                  <Volume2 className="w-5 h-5" aria-hidden="true" />
                ) : isMuted ? (
                  <MicOff className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <Mic className="w-5 h-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  {isAssistantSpeaking
                    ? analysis
                      ? `${selectedVoice} is speaking ("${analysis.documentTitle}")`
                      : `${selectedVoice} is speaking web research findings`
                    : isMuted
                    ? "Microphone is muted"
                    : analysis
                    ? `Ask about the PDF, say "Read Page 1", or say "Search Google"`
                    : `Upload a new PDF above or ask any question to search Google`}
                </p>
                <p
                  className={`text-xs ${
                    highContrastDark ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  {isAssistantSpeaking
                    ? "Interrupt anytime with your voice to ask a follow-up or request Google research"
                    : analysis
                    ? `Full PDF (${totalPages} ${
                        totalPages === 1 ? "page" : "pages"
                      }) + live Google Web Search active`
                    : "Live Google Web Search active — upload a PDF anytime to have it read aloud"}
                </p>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="flex items-center gap-1 h-8 px-2 shrink-0"
            >
              {barMultipliers.map((mult, idx) => {
                const scale =
                  isMuted && !isAssistantSpeaking
                    ? 0.2
                    : Math.max(0.2, Math.min(1, audioLevel * mult + 0.18));
                return (
                  <span
                    key={idx}
                    style={{ transform: `scaleY(${scale})` }}
                    className={`w-1.5 h-7 rounded-full origin-center transition-transform duration-100 ${
                      isAssistantSpeaking
                        ? highContrastDark
                          ? "bg-amber-300"
                          : "bg-blue-700"
                        : "bg-emerald-600"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Empty / Deleted PDF Dropzone or Pre-Session Launch State */}
        {!analysis && connectionState !== "connected" && transcriptTurns.length === 0 && (
          <div className="py-6 max-w-lg mx-auto text-center">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file && onUploadFile) onUploadFile(file);
              }}
              onClick={() => localFileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors mb-5 ${
                isDraggingOver
                  ? highContrastDark
                    ? "border-amber-400 bg-slate-800/70"
                    : "border-blue-600 bg-blue-50/60"
                  : highContrastDark
                  ? "border-slate-700 hover:border-amber-400 bg-slate-900/40"
                  : "border-slate-300 hover:border-blue-600 bg-slate-50/60"
              }`}
            >
              {isUploadingPdf ? (
                <div className="flex flex-col items-center">
                  <Loader2
                    className={`w-8 h-8 animate-spin mb-3 ${
                      highContrastDark ? "text-blue-400" : "text-blue-700"
                    }`}
                  />
                  <p className="text-sm font-semibold">
                    Reading your new PDF &amp; preparing voice narration...
                  </p>
                </div>
              ) : (
                <>
                  <FileUp
                    className={`w-8 h-8 mx-auto mb-3 ${
                      highContrastDark ? "text-blue-400" : "text-blue-700"
                    }`}
                    aria-hidden="true"
                  />
                  <h3 className="text-base font-bold mb-1.5">
                    Upload a New PDF for Voice Reading &amp; Web Research
                  </h3>
                  <p
                    className={`text-xs leading-relaxed mb-4 ${
                      highContrastDark ? "text-slate-300" : "text-slate-600"
                    }`}
                  >
                    Drop a PDF here or click to select. As soon as it uploads, Free PDF AI indexes every page, reads it aloud to you, and researches related details on Google.
                  </p>
                  <span className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 dark:bg-blue-600 rounded-lg whitespace-nowrap shrink-0">
                    <FileUp className="w-4 h-4" aria-hidden="true" />
                    Choose PDF &amp; Read Aloud
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => startLiveSession("web_research")}
              disabled={connectionState === "connecting" || isUploadingPdf}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                highContrastDark
                  ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-slate-100"
              }`}
            >
              <Globe
                className={`w-4 h-4 ${
                  highContrastDark ? "text-blue-400" : "text-blue-700"
                }`}
                aria-hidden="true"
              />
              Start Live Voice Google Search (Without PDF)
            </button>
          </div>
        )}

        {analysis && connectionState !== "connected" && transcriptTurns.length === 0 && (
          <div className="py-6 text-center max-w-lg mx-auto">
            <div
              className={`w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center ${
                highContrastDark
                  ? "bg-slate-800 text-amber-300"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              <BookOpen className="w-6 h-6" aria-hidden="true" />
            </div>
            <h3 className="text-base font-bold mb-2">
              Live PDF Voice Reader &amp; Google Web Research
            </h3>
            <p
              className={`text-sm leading-relaxed mb-6 ${
                highContrastDark ? "text-slate-300" : "text-slate-600"
              }`}
            >
              Your Voice AI has read all{" "}
              <span className="font-semibold">{totalPages}</span>{" "}
              {totalPages === 1 ? "page" : "pages"} of{" "}
              <span className="font-semibold">&ldquo;{analysis.documentTitle}&rdquo;</span>{" "}
              and is connected to live Google Search to gather internet details and research on your questions.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => startLiveSession("read_from_start")}
                disabled={connectionState === "connecting" || isUploadingPdf}
                className="inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
              >
                {connectionState === "connecting" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4" aria-hidden="true" />
                    Start &amp; Read PDF Aloud
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => startLiveSession("web_research")}
                disabled={connectionState === "connecting" || isUploadingPdf}
                className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                  highContrastDark
                    ? "border-slate-700 bg-slate-800 text-sky-300 hover:bg-slate-700"
                    : "border-blue-200 bg-blue-50/70 text-blue-800 hover:bg-blue-100"
                }`}
              >
                <Globe className="w-4 h-4" aria-hidden="true" />
                Start &amp; Research on Web
              </button>

              <button
                type="button"
                onClick={() => startLiveSession("greet")}
                disabled={connectionState === "connecting" || isUploadingPdf}
                className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                  highContrastDark
                    ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                    : "border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200"
                }`}
              >
                <Mic
                  className={`w-4 h-4 ${
                    highContrastDark ? "text-blue-400" : "text-blue-700"
                  }`}
                  aria-hidden="true"
                />
                Ask Questions
              </button>
            </div>
          </div>
        )}

        {/* Live Captions & Google Web Research Citations Thread */}
        {transcriptTurns.map((turn) => {
          const isUser = turn.role === "user";
          return (
            <div
              key={turn.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-2 text-xs opacity-70 mb-1">
                <span className="font-medium">
                  {isUser ? "You" : `${selectedVoice} (PDF + Web AI)`}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{turn.timestamp}</span>
              </div>
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  isUser
                    ? "bg-blue-700 text-white"
                    : highContrastDark
                    ? "bg-slate-800 text-slate-100 border border-slate-700"
                    : "bg-slate-100 text-slate-900 border border-slate-200/80"
                }`}
              >
                <p>{turn.text}</p>

                {!isUser && turn.webSources && turn.webSources.length > 0 && (
                  <div
                    className={`mt-3 pt-2.5 border-t text-xs ${
                      highContrastDark ? "border-slate-700" : "border-slate-200/90"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold mb-1.5 opacity-85">
                      <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Google Search Web Sources</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {turn.webSources.map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 underline font-medium truncate max-w-[240px] ${
                            highContrastDark
                              ? "text-amber-300 hover:text-amber-200"
                              : "text-blue-700 hover:text-blue-900"
                          }`}
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={transcriptEndRef} />
      </div>

      {/* Quiet-Environment Prompt Buttons & Text-to-Voice Input when Live Session is Active */}
      {connectionState === "connected" && (
        <div
          className={`border-t ${
            highContrastDark
              ? "border-slate-800 bg-slate-900/60"
              : "border-slate-200 bg-slate-50/60"
          }`}
        >
          <div className="px-6 py-2.5 flex items-center gap-2 overflow-x-auto border-b border-slate-200/60 dark:border-slate-800">
            <span className="text-xs font-medium opacity-70 whitespace-nowrap shrink-0">
              Quick Prompts:
            </span>
            <button
              type="button"
              onClick={handleWebResearchTopicCommand}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                highContrastDark
                  ? "bg-slate-800 border-slate-700 text-sky-300 hover:border-amber-300"
                  : "bg-white border-blue-200 text-blue-700 hover:border-blue-600"
              }`}
            >
              <Globe className="w-3 h-3" aria-hidden="true" />
              Search Google on this topic
            </button>

            {analysis?.suggestedQuestions?.slice(0, 2).map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendCommandToLive(q)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  highContrastDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:border-amber-300"
                    : "bg-white border-slate-200 text-slate-700 hover:border-blue-600 hover:text-blue-700"
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendCommandToLive(quietTextInput);
            }}
            className="p-4 flex items-center gap-3"
          >
            <label htmlFor="live-quiet-input" className="sr-only">
              Type a question, page command, or Google research topic for the Voice AI
            </label>
            <input
              id="live-quiet-input"
              type="text"
              value={quietTextInput}
              onChange={(e) => setQuietTextInput(e.target.value)}
              placeholder='Speak into mic, or type e.g. "Read Page 1" or "Search Google for recent updates on this topic"...'
              className={`flex-1 min-w-0 px-4 py-2.5 text-sm rounded-lg border ${
                highContrastDark
                  ? "bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-400"
                  : "bg-white border-slate-300 text-slate-900 placeholder:text-slate-500"
              }`}
            />
            <button
              type="submit"
              disabled={!quietTextInput.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
