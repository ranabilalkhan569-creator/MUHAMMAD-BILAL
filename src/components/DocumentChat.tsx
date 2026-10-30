import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileUp,
  Globe,
  Loader2,
  Mic,
  Radio,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { ChatMessage, DocumentAnalysis, VoicePersonaId } from "../types";
import { ALL_SUPPORTED_FILE_ACCEPT } from "../utils/fileExtractor";

interface DocumentChatProps {
  analysis: DocumentAnalysis | null;
  selectedVoice: VoicePersonaId;
  onSwitchToLiveVoice?: () => void;
  onUploadFile?: (file: File) => void;
  onDeletePdf?: () => void;
  isUploadingPdf?: boolean;
}

export const DocumentChat: React.FC<DocumentChatProps> = ({
  analysis,
  selectedVoice,
  onSwitchToLiveVoice,
  onUploadFile,
  onDeletePdf,
  isUploadingPdf = false,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [synthesizingMsgId, setSynthesizingMsgId] = useState<string | null>(null);

  // Push-to-speak dictation state (gemini-3.5-transcribe)
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [isTranscribingMic, setIsTranscribingMic] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (replyAudioRef.current) {
      replyAudioRef.current.pause();
      setSpeakingMessageId(null);
    }

    const buildInitialReportText = (doc: DocumentAnalysis): string => {
      const pageCount = doc.pages?.length || doc.detectedPageCountEstimate || 1;
      const wordsCount =
        doc.totalWordsRead ||
        (doc.pages || [])
          .map((p) => p.text)
          .join(" ")
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
      const linesCount =
        doc.totalLinesRead ||
        (doc.pages || [])
          .map((p) => p.text)
          .join("\n")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean).length;

      const statsLine = `AI Full-Page Deep Read Complete — Extracted ${pageCount} ${
        pageCount === 1 ? "page" : "pages"
      }${linesCount ? `, ${linesCount.toLocaleString()} lines` : ""}${
        wordsCount ? `, and ${wordsCount.toLocaleString()} words` : ""
      } from inside "${doc.fileName}" (${doc.documentTitle}).`;

      if (doc.detailedReport && doc.detailedReport.trim().length > 40) {
        return `${statsLine}\n\n${doc.detailedReport.trim()}\n\nAsk me about any specific line, page, figure, or clause inside your document, or ask me to read any section aloud.`;
      }

      const takeawaysBlock =
        doc.keyTakeaways && doc.keyTakeaways.length > 0
          ? `\n\nKey Findings Inside Document:\n${doc.keyTakeaways
              .map((t, i) => `${i + 1}. ${t}`)
              .join("\n")}`
          : "";

      return `${statsLine}\n\nSummary of Contents Inside Document:\n${doc.overview}${takeawaysBlock}`;
    };

    setMessages([
      {
        id: `welcome-${analysis?.fileName || "empty"}`,
        role: "model",
        text: analysis
          ? buildInitialReportText(analysis)
          : `No document is currently loaded. Upload any PDF, JPG, or PNG file anytime to scan and extract every page, line, and word, or ask me any spoken or typed question right now and I will search Google and read the research to you.`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setErrorMsg(null);
  }, [
    analysis?.documentTitle,
    analysis?.fileName,
    analysis?.detectedPageCountEstimate,
    analysis?.detailedReport,
    analysis?.totalWordsRead,
    analysis?.totalLinesRead,
    analysis,
  ]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, isSending]);

  useEffect(() => {
    return () => {
      if (replyAudioRef.current) {
        replyAudioRef.current.pause();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const speakMessage = useCallback(
    async (msg: ChatMessage) => {
      if (speakingMessageId === msg.id && replyAudioRef.current) {
        replyAudioRef.current.pause();
        setSpeakingMessageId(null);
        return;
      }

      if (replyAudioRef.current) {
        replyAudioRef.current.pause();
      }

      setSynthesizingMsgId(msg.id);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: msg.text.slice(0, 5800),
            voiceName: selectedVoice,
            mode: "single",
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.audioBase64) {
          throw new Error(data.error || "Could not synthesize voice reply.");
        }

        const binary = atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        replyAudioRef.current = audio;
        setSpeakingMessageId(msg.id);
        audio.onended = () => {
          setSpeakingMessageId(null);
          URL.revokeObjectURL(url);
        };
        await audio.play();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not read reply aloud.");
      } finally {
        setSynthesizingMsgId(null);
      }
    },
    [selectedVoice, speakingMessageId]
  );

  const sendQuestion = useCallback(
    async (questionText: string, forceSpeakReply = false, forceWeb = false) => {
      const trimmed = questionText.trim();
      if (!trimmed || isSending) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      const priorHistory = messages.filter((m) => !m.id.startsWith("welcome-"));
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsSending(true);
      setErrorMsg(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: priorHistory.map((m) => ({ role: m.role, text: m.text })),
            message: trimmed,
            documentContext: analysis,
            useWebSearch: forceWeb || useWebSearch,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to reach the assistant.");
        }

        const botMsg: ChatMessage = {
          id: `model-${Date.now()}`,
          role: "model",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          modelUsed: data.modelUsed,
          webSources: Array.isArray(data.webSources) ? data.webSources : [],
        };
        setMessages((prev) => [...prev, botMsg]);

        if (autoSpeakReplies || forceSpeakReply) {
          speakMessage(botMsg);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to send message.");
      } finally {
        setIsSending(false);
      }
    },
    [analysis, autoSpeakReplies, isSending, messages, speakMessage, useWebSearch]
  );

  const handleToggleVoiceDictation = async () => {
    if (isRecordingMic && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingMic(false);
      return;
    }

    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = (recorder.mimeType || "audio/webm").split(";")[0];
        const audioBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (audioBlob.size < 200) return;

        setIsTranscribingMic(true);
        try {
          const base64Audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = String(reader.result || "");
              const comma = res.indexOf(",");
              resolve(comma >= 0 ? res.slice(comma + 1) : res);
            };
            reader.onerror = () =>
              reject(new Error("Could not process recorded audio."));
            reader.readAsDataURL(audioBlob);
          });

          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioBase64: base64Audio,
              mimeType,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Could not transcribe voice input.");
          }

          const spokenQuestion = String(data.transcript || "").trim();
          if (spokenQuestion) {
            await sendQuestion(spokenQuestion, true);
          } else {
            setErrorMsg(
              "No speech detected. Try speaking closer to your microphone."
            );
          }
        } catch (err) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Failed to transcribe voice message."
          );
        } finally {
          setIsTranscribingMic(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingMic(true);
    } catch {
      setErrorMsg(
        "Microphone access was blocked. Allow microphone permission to dictate spoken questions."
      );
    }
  };

  const handleResetChat = () => {
    if (replyAudioRef.current) {
      replyAudioRef.current.pause();
      setSpeakingMessageId(null);
    }
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: "model",
        text: analysis
          ? `Conversation cleared. Ask about "${analysis.documentTitle}" or ask me to search Google for web research on this topic.`
          : `Conversation cleared. Upload a PDF or ask any question to search Google.`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setErrorMsg(null);
  };

  return (
    <div className="flex flex-col h-[600px] bg-white dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 transition-colors duration-150">
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

      {/* Assistant Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            AI Full-Document Content Report &amp; Google Research Q&amp;A
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {analysis
              ? `${analysis.documentTitle} · ${
                  analysis.totalLinesRead
                    ? `${analysis.totalLinesRead.toLocaleString()} lines · `
                    : ""
                }${
                  analysis.totalWordsRead
                    ? `${analysis.totalWordsRead.toLocaleString()} words extracted · `
                    : ""
                }All pages indexed`
              : "No file active · Upload PDF, JPG, or PNG or search Google"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onUploadFile && (
            <button
              type="button"
              onClick={() => localFileInputRef.current?.click()}
              disabled={isUploadingPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
            >
              {isUploadingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400" aria-hidden="true" />
              ) : (
                <FileUp className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              )}
              {analysis ? "Add File (PDF/JPG/PNG)" : "Add PDF / Image"}
            </button>
          )}

          {analysis && onDeletePdf && (
            <button
              type="button"
              onClick={onDeletePdf}
              disabled={isUploadingPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-200 dark:text-red-300 dark:bg-slate-800 dark:hover:bg-red-950/50 dark:border-red-800/80 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Delete PDF
            </button>
          )}

          <button
            type="button"
            onClick={() => setUseWebSearch((v) => !v)}
            aria-pressed={useWebSearch}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
              useWebSearch
                ? "bg-blue-700 text-white border-blue-700 dark:bg-blue-600 dark:border-blue-500"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            Google Search {useWebSearch ? "On" : "Off"}
          </button>

          <button
            type="button"
            onClick={() => setAutoSpeakReplies((v) => !v)}
            aria-pressed={autoSpeakReplies}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
              autoSpeakReplies
                ? "bg-slate-900 text-white border-slate-900 dark:bg-amber-400 dark:text-slate-950 dark:border-amber-400 font-semibold"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            Auto-Read
          </button>

          {onSwitchToLiveVoice && (
            <button
              type="button"
              onClick={onSwitchToLiveVoice}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 dark:text-blue-300 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 dark:border-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
            >
              <Radio className="w-3.5 h-3.5" aria-hidden="true" />
              Live Voice
            </button>
          )}

          <button
            type="button"
            onClick={handleResetChat}
            aria-label="Clear conversation history"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 dark:text-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      {/* Scrollable Multi-Turn Conversation Thread */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Document and web research conversation history"
        className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-white dark:bg-[#0B1120]"
      >
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isSpeakingThis = speakingMessageId === msg.id;
          const isLoadingSpeech = synthesizingMsgId === msg.id;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {isUser ? "You" : "Free PDF AI Assistant"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{msg.timestamp}</span>
              </div>

              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  isUser
                    ? "bg-blue-700 dark:bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-900 border border-slate-200/80 dark:bg-slate-800/90 dark:text-slate-100 dark:border-slate-700"
                }`}
              >
                <p className="whitespace-pre-line">{msg.text}</p>

                {!isUser && msg.webSources && msg.webSources.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200/90 dark:border-slate-700 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                      <Globe className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
                      <span>Google Search Web Sources</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {msg.webSources.map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 dark:text-amber-300 dark:hover:text-amber-200 underline font-medium truncate max-w-[240px]"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {!isUser && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => speakMessage(msg)}
                      disabled={isLoadingSpeech}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 dark:text-amber-300 dark:hover:text-amber-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      {isLoadingSpeech ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          Synthesizing...
                        </>
                      ) : isSpeakingThis ? (
                        <>
                          <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                          Stop Reading
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Read Aloud ({selectedVoice})
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isTranscribingMic && (
          <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300 py-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>Transcribing your spoken question...</span>
          </div>
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>
              {useWebSearch
                ? "Checking PDF pages & researching Google web sources..."
                : "Checking PDF chapters and tables..."}
            </span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 px-4 py-3 text-xs"
          >
            {errorMsg}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Suggested Starter Prompts + Google Research Prompt */}
      <div className="px-6 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
          Try:
        </span>
        {analysis && (
          <button
            type="button"
            onClick={() =>
              sendQuestion(
                `Read every single page, every single line, and every single word inside "${analysis.fileName}" and give me a complete page-by-page report of all headings, facts, numbers, dates, and conclusions.`,
                false,
                false
              )
            }
            disabled={isSending || isRecordingMic}
            className="px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 dark:text-amber-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Full Page-by-Page Report
          </button>
        )}

        {analysis && (
          <button
            type="button"
            onClick={() =>
              sendQuestion(
                `Search Google and conduct internet research regarding "${analysis.documentTitle}"—provide background context, standards, and recent web updates related to this topic.`,
                false,
                true
              )
            }
            disabled={isSending || isRecordingMic}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 hover:border-blue-600 dark:text-sky-300 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-sky-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-3 h-3" aria-hidden="true" />
            Research this topic on Google
          </button>
        )}

        {(analysis?.suggestedQuestions || []).slice(0, 2).map((q, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => sendQuestion(q)}
            disabled={isSending || isRecordingMic}
            className="px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-200 hover:border-blue-600 hover:text-blue-700 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-amber-300 dark:hover:text-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Voice Dictation + Text Message Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion(input);
        }}
        className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] flex items-center gap-2.5"
      >
        <button
          type="button"
          onClick={handleToggleVoiceDictation}
          disabled={isSending || isTranscribingMic}
          aria-label={
            isRecordingMic
              ? "Stop recording and send spoken question"
              : "Record a spoken question with microphone"
          }
          className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[42px] ${
            isRecordingMic
              ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
              : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700"
          }`}
        >
          {isRecordingMic ? (
            <>
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              Send Voice
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              Speak
            </>
          )}
        </button>

        <label htmlFor="doc-chat-input" className="sr-only">
          Ask a question about your PDF or search Google
        </label>
        <input
          id="doc-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isRecordingMic}
          placeholder={
            isRecordingMic
              ? "Listening to your question... click Send Voice when done"
              : "Ask about your PDF or ask to search Google for web research..."
          }
          className="flex-1 min-w-0 px-4 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:bg-slate-900 disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={!input.trim() || isSending || isRecordingMic}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          Ask
        </button>
      </form>
    </div>
  );
};
