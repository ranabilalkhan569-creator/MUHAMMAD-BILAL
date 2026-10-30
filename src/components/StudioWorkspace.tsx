import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Eye,
  FileText,
  FileUp,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  PenTool,
  Play,
  Sparkles,
  Sun,
  Trash2,
  Type as TypeIcon,
  Volume2,
} from "lucide-react";
import {
  DocumentAnalysis,
  PdfPageContent,
  ReaderSettings,
  SummaryMode,
  UploadCategory,
  VoicePersonaId,
  WorkspaceTab,
} from "../types";
import { SAMPLE_DOCUMENTS, VOICE_PERSONAS } from "../data/sampleDocuments";
import { buildLocalFallbackAnalysis } from "../utils/pdfExtractor";
import {
  ALL_SUPPORTED_FILE_ACCEPT,
  FORMAT_ACCEPT_MAP,
  MAX_UPLOAD_FILE_BYTES,
  extractAnyFileInBrowser,
  formatFileSize,
} from "../utils/fileExtractor";
import {
  inferContentTitleFromPages,
  isMeaningfulPageText,
} from "../utils/ocrEngine";
import { AudioPlayerBar } from "./AudioPlayerBar";
import { DocumentChat } from "./DocumentChat";
import { LiveVoiceChat } from "./LiveVoiceChat";
import { ResilientImage } from "./ResilientImage";

interface StudioWorkspaceProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  externalVoiceSelection?: VoicePersonaId | null;
  externalVoiceChatLaunch?: number;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
}

interface StoredUploadedLibraryItem {
  id: string;
  analysis: DocumentAnalysis;
  rawText: string;
  mimeType: string;
  fileBase64?: string | null;
}

interface QueuedSpeechSegment {
  text: string;
  label: string;
  voiceId: VoicePersonaId;
  voiceStyle: string;
}

const LANGUAGES = [
  "English",
  "Urdu",
  "Hindi",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Japanese",
];

function getCategoryLabel(cat?: UploadCategory): string {
  if (cat === "image") return "JPG/PNG";
  if (cat === "written_photo") return "Written OCR";
  if (cat === "pdf_form") return "PDF Form";
  if (cat === "docs_whatsapp") return "Docs / WhatsApp";
  return "PDF";
}

function base64WavToObjectUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

function readFileAsBase64IfUnderLimit(
  file: File,
  maxBytes = 25 * 1024 * 1024
): Promise<string | null> {
  if (file.size > maxBytes) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = res.indexOf(",");
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res || null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function buildFullPdfVerbatimText(
  doc: DocumentAnalysis | null,
  fromPageNumber = 1
): string {
  if (!doc) return "";
  const validPages = (doc.pages || []).filter(
    (p) =>
      p &&
      typeof p.text === "string" &&
      p.text.trim().length > 0 &&
      p.pageNumber >= fromPageNumber
  );

  if (validPages.length > 0) {
    return validPages
      .map((p) => {
        const headingClean = p.heading?.trim();
        const prefix =
          headingClean && !p.text.trim().startsWith(headingClean)
            ? `Page ${p.pageNumber}: ${headingClean}.\n`
            : `Page ${p.pageNumber}.\n`;
        return `${prefix}${p.text.trim()}`;
      })
      .join("\n\n");
  }

  return (doc.rawExcerpt || doc.narrationScript || "").trim();
}

function splitLongTextIntoSpeechSegments(
  rawText: string,
  baseTitle: string,
  maxChunkChars = 2700
): Array<{ text: string; label: string }> {
  const clean = rawText.trim();
  if (!clean) return [];
  if (clean.length <= maxChunkChars) {
    return [{ text: clean, label: baseTitle }];
  }

  const rawBlocks = clean.split(/\n+/);
  const rawChunks: string[] = [];
  let current = "";

  const pushOversizedBlock = (block: string) => {
    const sentences = splitIntoSentences(block);
    for (const sentence of sentences) {
      if (sentence.length > maxChunkChars) {
        for (let i = 0; i < sentence.length; i += maxChunkChars) {
          const piece = sentence.slice(i, i + maxChunkChars).trim();
          if (piece) rawChunks.push(piece);
        }
      } else if (
        current.length + sentence.length + 1 > maxChunkChars &&
        current.trim()
      ) {
        rawChunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
  };

  for (const block of rawBlocks) {
    const line = block.trim();
    if (!line) continue;

    if (line.length > maxChunkChars) {
      if (current.trim()) {
        rawChunks.push(current.trim());
        current = "";
      }
      pushOversizedBlock(line);
      continue;
    }

    if (current.length + line.length + 2 > maxChunkChars && current.trim()) {
      rawChunks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current.trim()) {
    rawChunks.push(current.trim());
  }

  const total = rawChunks.length;
  return rawChunks.map((chunk, idx) => ({
    text: chunk,
    label:
      total > 1
        ? `${baseTitle} (Part ${idx + 1} of ${total})`
        : baseTitle,
  }));
}

async function safeParseJson<T = Record<string, unknown>>(
  response: Response
): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Server response error (${response.status}). Retrying with local PDF engine...`
    );
  }
}

async function uploadPagesInChunks(params: {
  fileName: string;
  mimeType: string;
  pages: PdfPageContent[];
  onProgress?: (msg: string) => void;
}): Promise<string | undefined> {
  const { fileName, mimeType, pages, onProgress } = params;
  if (pages.length === 0) return undefined;

  let assignedDocId: string | undefined;
  const BATCH_SIZE = 35;

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    onProgress?.(
      `Indexing pages ${i + 1}–${Math.min(pages.length, i + BATCH_SIZE)} of ${pages.length}...`
    );

    const res = await fetch("/api/document/upload-pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: assignedDocId,
        fileName,
        mimeType,
        pages: batch,
        reset: i === 0,
      }),
    });

    if (res.ok) {
      const data = await safeParseJson<{ documentId?: string }>(res);
      if (data.documentId) {
        assignedDocId = data.documentId;
      }
    }
  }

  return assignedDocId;
}

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  fileInputRef,
  externalVoiceSelection,
  externalVoiceChatLaunch = 0,
  isDarkMode = false,
  onToggleDarkMode,
}) => {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const writtenPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfFormInputRef = useRef<HTMLInputElement | null>(null);
  const docsWhatsappInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedSampleId, setSelectedSampleId] = useState<string>(
    SAMPLE_DOCUMENTS[0].id
  );
  const [uploadedLibrary, setUploadedLibrary] = useState<
    StoredUploadedLibraryItem[]
  >([]);
  const [activeUploadedId, setActiveUploadedId] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(
    SAMPLE_DOCUMENTS[0].initialAnalysis
  );
  const [uploadedPdfBase64, setUploadedPdfBase64] = useState<string | null>(
    null
  );
  const [uploadedMimeType, setUploadedMimeType] =
    useState<string>("application/pdf");
  const [uploadedRawText, setUploadedRawText] = useState<string>(
    SAMPLE_DOCUMENTS[0].rawText
  );

  const [summaryMode, setSummaryMode] = useState<SummaryMode>(
    SummaryMode.VERBATIM
  );
  const [selectedVoice, setSelectedVoice] = useState<VoicePersonaId>("Kore");
  const [targetLanguage, setTargetLanguage] = useState<string>("English");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(WorkspaceTab.SCRIPT);
  const [liveAutoConnectCount, setLiveAutoConnectCount] = useState<number>(0);
  const [isLiveVoiceConnected, setIsLiveVoiceConnected] =
    useState<boolean>(false);
  const [visiblePageLimit, setVisiblePageLimit] = useState<number>(15);

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeStepLabel, setAnalyzeStepLabel] = useState<string>("");
  const [isTransforming, setIsTransforming] = useState<string | null>(null);
  const [isGeneratingDeepReport, setIsGeneratingDeepReport] =
    useState<boolean>(false);
  const [isResearchingWeb, setIsResearchingWeb] = useState<boolean>(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>("");

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [browserSpeechText, setBrowserSpeechText] = useState<string | null>(
    null
  );
  const [browserSpeechTrigger, setBrowserSpeechTrigger] = useState<number>(0);
  const [activeAudioTitle, setActiveAudioTitle] = useState<string>(
    `${SAMPLE_DOCUMENTS[0].initialAnalysis.documentTitle} — Full Word-for-Word`
  );
  const [progressRatio, setProgressRatio] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  // Multi-part continuous queue state so 100% of every page, line & word plays seamlessly without truncation
  const speechQueueRef = useRef<QueuedSpeechSegment[]>([]);
  const queueIndexRef = useRef<number>(0);
  const queueSessionTokenRef = useRef<number>(0);
  const prefetchedWavRef = useRef<Map<string, Promise<string | null>>>(
    new Map()
  );
  const [queuePosition, setQueuePosition] = useState<{
    index: number;
    total: number;
  } | null>(null);

  const [readerSettings, setReaderSettings] = useState<ReaderSettings>({
    fontScale: "base",
    relaxedSpacing: false,
    highContrastDark: false,
  });

  const currentVoiceObj = useMemo(
    () =>
      VOICE_PERSONAS.find((v) => v.id === selectedVoice) || VOICE_PERSONAS[0],
    [selectedVoice]
  );

  const clearAudioUrl = useCallback(() => {
    queueSessionTokenRef.current += 1;
    speechQueueRef.current = [];
    queueIndexRef.current = 0;
    prefetchedWavRef.current.clear();
    setQueuePosition(null);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setBrowserSpeechText(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setProgressRatio(0);
    setIsAudioPlaying(false);
  }, []);

  useEffect(() => {
    if (externalVoiceSelection) {
      setSelectedVoice(externalVoiceSelection);
      clearAudioUrl();
    }
  }, [clearAudioUrl, externalVoiceSelection]);

  useEffect(() => {
    if (externalVoiceChatLaunch > 0) {
      setActiveTab(WorkspaceTab.VOICE_CHAT);
      setLiveAutoConnectCount((c) => c + 1);
    }
  }, [externalVoiceChatLaunch]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleLiveConnectionChange = useCallback(
    (connected: boolean) => {
      setIsLiveVoiceConnected(connected);
      if (connected) {
        clearAudioUrl();
      }
    },
    [clearAudioUrl]
  );

  const launchHandsFreeVoiceChat = () => {
    clearAudioUrl();
    setActiveTab(WorkspaceTab.VOICE_CHAT);
    setLiveAutoConnectCount((c) => c + 1);
  };

  const fetchSingleSegmentWavBase64 = useCallback(
    (segment: QueuedSpeechSegment, sessionToken: number): Promise<string | null> => {
      const cacheKey = `${sessionToken}::${segment.voiceId}::${segment.label}::${segment.text.slice(0, 64)}::${segment.text.length}`;
      const existing = prefetchedWavRef.current.get(cacheKey);
      if (existing) return existing;

      const reqPromise = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          text: segment.text,
          voiceName: segment.voiceId,
          voiceStyle: segment.voiceStyle,
        }),
      })
        .then(async (res) => {
          const data = await safeParseJson<{
            audioBase64?: string;
            error?: string;
          }>(res);
          if (!res.ok || !data.audioBase64) {
            return null;
          }
          return data.audioBase64;
        })
        .catch(() => null);

      prefetchedWavRef.current.set(cacheKey, reqPromise);
      return reqPromise;
    },
    []
  );

  const playQueuedSegmentAtIndex = useCallback(
    async (targetIdx: number, sessionToken: number) => {
      const queue = speechQueueRef.current;
      if (
        sessionToken !== queueSessionTokenRef.current ||
        targetIdx < 0 ||
        targetIdx >= queue.length
      ) {
        return;
      }

      const segment = queue[targetIdx];
      queueIndexRef.current = targetIdx;
      setQueuePosition(
        queue.length > 1
          ? { index: targetIdx + 1, total: queue.length }
          : null
      );

      setIsSynthesizing(true);
      setErrorBanner(null);
      setStatusAnnouncement(
        queue.length > 1
          ? `Synthesizing part ${targetIdx + 1} of ${queue.length}...`
          : "Synthesizing natural voice audio..."
      );

      // Prefetch the next segment in the background so multi-page reading transitions seamlessly
      if (targetIdx + 1 < queue.length) {
        void fetchSingleSegmentWavBase64(queue[targetIdx + 1], sessionToken);
      }

      try {
        const audioBase64 = await fetchSingleSegmentWavBase64(
          segment,
          sessionToken
        );

        if (sessionToken !== queueSessionTokenRef.current) return;

        if (!audioBase64) {
          throw new Error("Voice synthesis unavailable.");
        }

        const nextUrl = base64WavToObjectUrl(audioBase64);
        setBrowserSpeechText(null);
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
        setActiveAudioTitle(segment.label);
        setStatusAnnouncement(`Playing ${segment.label}`);
      } catch (err) {
        if (sessionToken !== queueSessionTokenRef.current) return;

        if (
          segment.text.trim() &&
          typeof window !== "undefined" &&
          "speechSynthesis" in window
        ) {
          setAudioUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setActiveAudioTitle(segment.label);
          setBrowserSpeechText(segment.text);
          setBrowserSpeechTrigger((c) => c + 1);
          setStatusAnnouncement("Playing PDF aloud using instant device voice.");
        } else {
          setErrorBanner(
            err instanceof Error ? err.message : "Could not synthesize audio."
          );
        }
      } finally {
        if (sessionToken === queueSessionTokenRef.current) {
          setIsSynthesizing(false);
        }
      }
    },
    [fetchSingleSegmentWavBase64]
  );

  const handleAudioTrackEnded = useCallback(() => {
    const queue = speechQueueRef.current;
    const nextIdx = queueIndexRef.current + 1;
    if (queue.length > 1 && nextIdx < queue.length) {
      void playQueuedSegmentAtIndex(nextIdx, queueSessionTokenRef.current);
    }
  }, [playQueuedSegmentAtIndex]);

  const handleSkipQueuePart = useCallback(
    (delta: number) => {
      const queue = speechQueueRef.current;
      const nextIdx = queueIndexRef.current + delta;
      if (nextIdx >= 0 && nextIdx < queue.length) {
        void playQueuedSegmentAtIndex(nextIdx, queueSessionTokenRef.current);
      }
    },
    [playQueuedSegmentAtIndex]
  );

  const synthesizeSpeech = useCallback(
    async (options: {
      customText?: string;
      customLabel?: string;
      forceDialogue?: boolean;
      overrideAnalysis?: DocumentAnalysis;
      overrideVoice?: VoicePersonaId;
      overrideMode?: SummaryMode;
    }) => {
      const targetDoc = options.overrideAnalysis || analysis;
      if (!targetDoc && !options.customText) {
        return;
      }

      const activeMode = options.overrideMode || summaryMode;
      const voiceId = options.overrideVoice || selectedVoice;
      const voiceMeta =
        VOICE_PERSONAS.find((v) => v.id === voiceId) || VOICE_PERSONAS[0];
      const useDialogue =
        options.forceDialogue ??
        (!options.customText &&
          activeMode === SummaryMode.DIALOGUE &&
          Boolean(targetDoc?.dialogueTurns?.length));

      if (useDialogue && targetDoc?.dialogueTurns?.length) {
        queueSessionTokenRef.current += 1;
        const sessionToken = queueSessionTokenRef.current;
        speechQueueRef.current = [];
        queueIndexRef.current = 0;
        setQueuePosition(null);

        const resolvedTrackTitle =
          options.customLabel ||
          `${targetDoc.documentTitle} — Two-Host Dialogue`;

        setIsSynthesizing(true);
        setErrorBanner(null);
        setStatusAnnouncement("Synthesizing two-host dialogue audio...");

        try {
          const response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "dialogue",
              dialogueTurns: targetDoc.dialogueTurns,
            }),
          });
          const data = await safeParseJson<{
            audioBase64?: string;
            error?: string;
          }>(response);

          if (sessionToken !== queueSessionTokenRef.current) return;
          if (!response.ok || !data.audioBase64) {
            throw new Error(data.error || "Voice synthesis unavailable.");
          }

          const nextUrl = base64WavToObjectUrl(data.audioBase64);
          setBrowserSpeechText(null);
          setAudioUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return nextUrl;
          });
          setActiveAudioTitle(resolvedTrackTitle);
          setStatusAnnouncement("Two-host dialogue ready and playing.");
        } catch (err) {
          const fallbackDialogue = targetDoc.dialogueTurns
            .map((t) => `${t.speaker}: ${t.text}`)
            .join(" ");
          if (
            fallbackDialogue.trim() &&
            typeof window !== "undefined" &&
            "speechSynthesis" in window
          ) {
            setAudioUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
            setActiveAudioTitle(resolvedTrackTitle);
            setBrowserSpeechText(fallbackDialogue);
            setBrowserSpeechTrigger((c) => c + 1);
          } else {
            setErrorBanner(
              err instanceof Error ? err.message : "Could not synthesize audio."
            );
          }
        } finally {
          if (sessionToken === queueSessionTokenRef.current) {
            setIsSynthesizing(false);
          }
        }
        return;
      }

      const isFullVerbatimRequest =
        !options.customText && activeMode === SummaryMode.VERBATIM;

      const spokenSourceText = options.customText
        ? options.customText
        : isFullVerbatimRequest
        ? buildFullPdfVerbatimText(targetDoc || null)
        : targetDoc?.narrationScript || buildFullPdfVerbatimText(targetDoc || null);

      const resolvedTrackTitle =
        options.customLabel ||
        (isFullVerbatimRequest
          ? `${targetDoc?.documentTitle || "Document"} — Full Word-for-Word PDF`
          : `${targetDoc?.documentTitle || "Document"} — AI Audio Summary`);

      const segments = splitLongTextIntoSpeechSegments(
        spokenSourceText,
        resolvedTrackTitle,
        2700
      );

      if (segments.length === 0) return;

      queueSessionTokenRef.current += 1;
      const sessionToken = queueSessionTokenRef.current;
      prefetchedWavRef.current.clear();
      speechQueueRef.current = segments.map((seg) => ({
        text: seg.text,
        label: seg.label,
        voiceId,
        voiceStyle: voiceMeta.stylePrompt,
      }));
      queueIndexRef.current = 0;

      await playQueuedSegmentAtIndex(0, sessionToken);
    },
    [analysis, playQueuedSegmentAtIndex, selectedVoice, summaryMode]
  );

  const handleReadEntirePdfWordForWord = useCallback(
    async (fromPage = 1, docOverride?: DocumentAnalysis) => {
      const targetDoc = docOverride || analysis;
      if (!targetDoc) return;
      const fullVerbatim = buildFullPdfVerbatimText(targetDoc, fromPage);
      if (!fullVerbatim.trim()) return;

      const totalPagesCount =
        targetDoc.pages?.length || targetDoc.detectedPageCountEstimate || 1;
      const titleLabel =
        fromPage > 1
          ? `${targetDoc.documentTitle} — Word-for-Word (Pages ${fromPage}–${totalPagesCount})`
          : `${targetDoc.documentTitle} — Entire PDF Word-for-Word (All ${totalPagesCount} Pages)`;

      await synthesizeSpeech({
        customText: fullVerbatim,
        customLabel: titleLabel,
        forceDialogue: false,
        overrideAnalysis: targetDoc,
      });
    },
    [analysis, synthesizeSpeech]
  );

  const handleSelectUploadedItem = (item: StoredUploadedLibraryItem) => {
    clearAudioUrl();
    setSelectedSampleId("");
    setActiveUploadedId(item.id);
    setUploadedPdfBase64(item.fileBase64 || null);
    setUploadedMimeType(item.mimeType);
    setUploadedRawText(item.rawText);
    setAnalysis(item.analysis);
    setVisiblePageLimit(15);
    setActiveAudioTitle(
      `${item.analysis.documentTitle} — Full Word-for-Word`
    );
    setErrorBanner(null);
    setStatusAnnouncement(`Switched to uploaded PDF: ${item.analysis.fileName}`);
  };

  const handleRemoveUploadedItem = useCallback(
    (targetId: string) => {
      const targetItem = uploadedLibrary.find((u) => u.id === targetId);
      if (targetItem?.analysis.documentId) {
        fetch(
          `/api/document/${encodeURIComponent(targetItem.analysis.documentId)}`,
          {
            method: "DELETE",
          }
        ).catch(() => {});
      }

      const remaining = uploadedLibrary.filter((u) => u.id !== targetId);
      setUploadedLibrary(remaining);

      if (activeUploadedId === targetId) {
        clearAudioUrl();
        if (remaining.length > 0) {
          const next = remaining[0];
          setActiveUploadedId(next.id);
          setAnalysis(next.analysis);
          setUploadedRawText(next.rawText);
          setUploadedMimeType(next.mimeType);
          setUploadedPdfBase64(next.fileBase64 || null);
          setActiveAudioTitle(
            `${next.analysis.documentTitle} — Full Word-for-Word`
          );
        } else {
          setActiveUploadedId(null);
          setSelectedSampleId("");
          setUploadedPdfBase64(null);
          setUploadedRawText("");
          setAnalysis(null);
          setActiveAudioTitle(
            "No PDF Loaded — Upload a New PDF to Read Aloud"
          );
        }
      }
    },
    [activeUploadedId, clearAudioUrl, uploadedLibrary]
  );

  const handleDeletePdf = useCallback(() => {
    if (activeUploadedId) {
      handleRemoveUploadedItem(activeUploadedId);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    clearAudioUrl();
    if (analysis?.documentId) {
      fetch(`/api/document/${encodeURIComponent(analysis.documentId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    setSelectedSampleId("");
    setActiveUploadedId(null);
    setUploadedPdfBase64(null);
    setUploadedRawText("");
    setAnalysis(null);
    setActiveAudioTitle("No PDF Loaded — Upload a New PDF to Read Aloud");
    setErrorBanner(null);
    setStatusAnnouncement(
      "PDF deleted. Upload a new PDF anytime to have Free PDF AI read it aloud."
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [
    activeUploadedId,
    analysis?.documentId,
    clearAudioUrl,
    fileInputRef,
    handleRemoveUploadedItem,
  ]);

  const handleSelectSample = (sampleId: string) => {
    const found = SAMPLE_DOCUMENTS.find((s) => s.id === sampleId);
    if (!found) return;
    clearAudioUrl();
    setSelectedSampleId(sampleId);
    setActiveUploadedId(null);
    setUploadedPdfBase64(null);
    setUploadedRawText(found.rawText);
    setTargetLanguage("English");
    setVisiblePageLimit(15);
    setAnalysis({
      ...found.initialAnalysis,
      rawExcerpt: found.rawText,
    });
    setActiveAudioTitle(
      `${found.initialAnalysis.documentTitle} — Full Word-for-Word`
    );
    setErrorBanner(null);
    setStatusAnnouncement(`Loaded sample document: ${found.title}`);
  };

  const processSingleUploadedFile = async (
    file: File,
    autoPlayAfterLoad: boolean,
    preferredCategory: UploadCategory = "pdf"
  ): Promise<DocumentAnalysis | null> => {
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setErrorBanner(
        `"${file.name}" exceeds the 5 GB per-file limit. Please select a file under 5 GB.`
      );
      return null;
    }

    clearAudioUrl();
    setSelectedSampleId("");
    setIsAnalyzing(true);
    setErrorBanner(null);
    setVisiblePageLimit(10);
    const fileSizeLabel = formatFileSize(file.size);
    setAnalyzeStepLabel(`Opening ${file.name} (${fileSizeLabel})...`);
    setStatusAnnouncement(`Processing ${file.name}`);

    try {
      const [extractionResult, rawFileBase64] = await Promise.all([
        extractAnyFileInBrowser(
          file,
          preferredCategory,
          (step) => setAnalyzeStepLabel(step),
          targetLanguage
        ),
        readFileAsBase64IfUnderLimit(file),
      ]);

      const { extracted, resolvedCategory, effectiveMimeType } =
        extractionResult;

      let serverDocId: string | undefined;
      const serializedPagesLength = JSON.stringify(extracted.pages).length;

      // Stream large multi-page extractions in compact chunks first
      if (serializedPagesLength > 450_000) {
        serverDocId = await uploadPagesInChunks({
          fileName: file.name,
          mimeType: effectiveMimeType,
          pages: extracted.pages,
          onProgress: (step) => setAnalyzeStepLabel(step),
        });
      }

      setAnalyzeStepLabel(
        resolvedCategory === "written_photo"
          ? `AI Deep-Reading every handwritten & printed word in ${file.name}...`
          : resolvedCategory === "image"
          ? `AI Full-Page OCR reading every word & visual detail inside ${file.name}...`
          : resolvedCategory === "pdf_form"
          ? `AI reading every form field, page & line inside ${file.name}...`
          : resolvedCategory === "docs_whatsapp"
          ? `AI reading every line & message inside ${file.name}...`
          : `AI Deep-Reading every page, line & word inside ${file.name} (all ${
              extracted.numPages || extracted.pages.length || 1
            } pages)...`
      );

      let nextAnalysis: DocumentAnalysis;

      const clientMeaningfulCount = extracted.pages.filter((p) =>
        isMeaningfulPageText(p.text)
      ).length;
      const allClientPagesHaveFullText =
        extracted.pages.length > 0 &&
        clientMeaningfulCount >= Math.max(1, extracted.numPages);

      const shouldSendBinaryInline =
        Boolean(rawFileBase64) &&
        (!allClientPagesHaveFullText || file.size <= 4 * 1024 * 1024);

      const snapshotsForAnalyze = allClientPagesHaveFullText
        ? resolvedCategory === "image" || resolvedCategory === "written_photo"
          ? extracted.scannedPageImages.slice(0, 1)
          : undefined
        : extracted.scannedPageImages.length > 0
        ? extracted.scannedPageImages
        : undefined;

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: effectiveMimeType,
            fileBase64: shouldSendBinaryInline
              ? rawFileBase64 || undefined
              : undefined,
            pages: serverDocId ? undefined : extracted.pages,
            scannedPageImages: snapshotsForAnalyze,
            totalPagesCount: extracted.numPages,
            existingDocumentId: serverDocId,
            mode: summaryMode,
            targetLanguage,
            uploadCategory: resolvedCategory,
          }),
        });

        const data = await safeParseJson<DocumentAnalysis & { error?: string }>(
          response
        );

        if (!response.ok) {
          throw new Error(data.error || "Server analysis error.");
        }

        // Merge client and server pages on a per-page basis so no page ever loses extracted or OCR text
        const pageMap = new Map<number, PdfPageContent>();
        for (const cp of extracted.pages) {
          pageMap.set(cp.pageNumber, cp);
        }
        for (const sp of data.pages || []) {
          const prev = pageMap.get(sp.pageNumber);
          if (!prev) {
            pageMap.set(sp.pageNumber, sp);
          } else {
            const prevMeaningful = isMeaningfulPageText(prev.text);
            const spMeaningful = isMeaningfulPageText(sp.text);
            if (
              (!prevMeaningful && spMeaningful) ||
              (spMeaningful && sp.text.trim().length > prev.text.trim().length)
            ) {
              pageMap.set(sp.pageNumber, sp);
            }
          }
        }
        const mergedPages = Array.from(pageMap.values()).sort(
          (a, b) => a.pageNumber - b.pageNumber
        );

        const mergedRawExcerpt =
          mergedPages
            .filter((p) => p.text && p.text.trim().length > 0)
            .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
            .join("\n\n") ||
          extracted.fullText ||
          data.rawExcerpt ||
          "";

        const computedWords =
          mergedRawExcerpt.trim().split(/\s+/).filter(Boolean).length ||
          data.totalWordsRead ||
          0;
        const computedLines =
          mergedPages
            .map((p) => p.text)
            .join("\n")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean).length ||
          data.totalLinesRead ||
          0;

        const cleanRawStem = file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[_-]+/g, " ")
          .trim()
          .toLowerCase();
        const serverTitle = String(data.documentTitle || "").trim();
        const resolvedTitle =
          mergedPages.some((p) => p.text && p.text.trim().length > 0) &&
          (!serverTitle ||
            serverTitle.toLowerCase() === file.name.toLowerCase() ||
            serverTitle.toLowerCase() === cleanRawStem)
            ? inferContentTitleFromPages(
                mergedPages,
                file.name,
                extracted.metadataTitle
              )
            : serverTitle ||
              inferContentTitleFromPages(
                mergedPages,
                file.name,
                extracted.metadataTitle
              );

        nextAnalysis = {
          ...data,
          documentTitle: resolvedTitle,
          fileName: file.name,
          fileSizeLabel,
          detectedPageCountEstimate: Math.max(
            mergedPages.length,
            extracted.numPages,
            data.detectedPageCountEstimate || 1
          ),
          totalWordsRead: computedWords,
          totalLinesRead: computedLines,
          pages: mergedPages,
          rawExcerpt: mergedRawExcerpt,
          sourceCategory: resolvedCategory,
        };
      } catch (apiErr) {
        console.warn(
          "Using local extraction fallback so file still loads:",
          apiErr
        );
        const fallback = buildLocalFallbackAnalysis({
          fileName: file.name,
          fileSizeLabel,
          extracted,
          targetLanguage,
          sourceCategory: resolvedCategory,
        });
        nextAnalysis = {
          ...fallback,
          documentId: serverDocId,
          sourceCategory: resolvedCategory,
        };
      }

      const libId =
        nextAnalysis.documentId ||
        `local_doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const resolvedRawText =
        nextAnalysis.rawExcerpt ||
        extracted.fullText ||
        nextAnalysis.narrationScript;

      const libItem: StoredUploadedLibraryItem = {
        id: libId,
        analysis: nextAnalysis,
        rawText: resolvedRawText,
        mimeType: effectiveMimeType,
        fileBase64: rawFileBase64,
      };

      setUploadedLibrary((prev) => [
        libItem,
        ...prev.filter((item) => item.id !== libId),
      ]);
      setActiveUploadedId(libId);
      setUploadedPdfBase64(rawFileBase64);
      setUploadedMimeType(effectiveMimeType);
      setUploadedRawText(resolvedRawText);
      setVisiblePageLimit(15);
      setAnalysis(nextAnalysis);
      setActiveAudioTitle(
        `${nextAnalysis.documentTitle} — Full Word-for-Word`
      );

      if (
        activeTab !== WorkspaceTab.VOICE_CHAT &&
        activeTab !== WorkspaceTab.CHAT
      ) {
        setActiveTab(WorkspaceTab.SCRIPT);
      }

      if (autoPlayAfterLoad && !isLiveVoiceConnected) {
        setAnalyzeStepLabel("Starting word-for-word AI voice narration...");
        await synthesizeSpeech({
          overrideAnalysis: nextAnalysis,
          forceDialogue: summaryMode === SummaryMode.DIALOGUE,
        });
      }

      return nextAnalysis;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not read uploaded file.";
      if (msg.toLowerCase().includes("password")) {
        setErrorBanner(
          `"${file.name}" is password-protected. Please unlock the file and upload again.`
        );
      } else {
        setErrorBanner(`Could not load "${file.name}": ${msg}`);
      }
      return null;
    } finally {
      setIsAnalyzing(false);
      setAnalyzeStepLabel("");
    }
  };

  const processUploadedFile = async (
    file: File,
    preferredCategory: UploadCategory = "pdf"
  ) => {
    await processSingleUploadedFile(file, true, preferredCategory);
  };

  const processMultipleUploadedFiles = async (
    files: File[],
    preferredCategory: UploadCategory = "pdf"
  ) => {
    if (files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const isLast = i === files.length - 1;
      await processSingleUploadedFile(files[i], isLast, preferredCategory);
    }
  };

  const handleModeSwitch = async (nextMode: SummaryMode) => {
    if (nextMode === summaryMode) return;
    setSummaryMode(nextMode);
    clearAudioUrl();

    if (!analysis) return;

    if (
      uploadedPdfBase64 ||
      (nextMode === SummaryMode.PLAIN &&
        !analysis.readingLevel.toLowerCase().includes("6"))
    ) {
      setIsTransforming("mode");
      setErrorBanner(null);
      try {
        if (nextMode === SummaryMode.PLAIN && !uploadedPdfBase64) {
          const res = await fetch("/api/transform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "simplify",
              currentAnalysis: analysis,
            }),
          });
          const data = await safeParseJson<{
            readingLevel?: string;
            overview?: string;
            narrationScript?: string;
            keyTakeaways?: string[];
            modelUsed?: string;
          }>(res);
          if (res.ok) {
            setAnalysis((prev) =>
              prev
                ? {
                    ...prev,
                    readingLevel:
                      data.readingLevel || "Grade 6 Plain Language",
                    overview: data.overview || prev.overview,
                    narrationScript:
                      data.narrationScript || prev.narrationScript,
                    keyTakeaways: data.keyTakeaways || prev.keyTakeaways,
                    modelUsed: data.modelUsed || prev.modelUsed,
                  }
                : null
            );
          }
        } else if (uploadedPdfBase64 || uploadedRawText || analysis.documentId) {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: analysis.fileName,
              mimeType: uploadedMimeType,
              fileBase64: uploadedPdfBase64 || undefined,
              textContent:
                !uploadedPdfBase64 && !analysis.documentId
                  ? uploadedRawText
                  : undefined,
              mode: nextMode,
              targetLanguage,
              existingDocumentId: analysis.documentId,
            }),
          });
          const data = await safeParseJson<DocumentAnalysis>(res);
          if (res.ok) {
            setAnalysis((prev) =>
              prev
                ? {
                    ...prev,
                    ...data,
                    pages: prev.pages?.length ? prev.pages : data.pages,
                    rawExcerpt: prev.rawExcerpt || data.rawExcerpt,
                    webResearch: prev.webResearch,
                  }
                : null
            );
          }
        }
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Could not switch summary mode."
        );
      } finally {
        setIsTransforming(null);
      }
    }
  };

  const handleRunTransform = async (
    action: "simplify" | "action_items" | "translate" | "expand_visuals",
    langOverride?: string
  ) => {
    if (!analysis) return;
    setIsTransforming(action);
    setErrorBanner(null);
    clearAudioUrl();

    try {
      const response = await fetch("/api/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          currentAnalysis: analysis,
          targetLanguage: langOverride || targetLanguage,
          fileBase64: uploadedPdfBase64 || undefined,
          mimeType: uploadedMimeType,
        }),
      });
      const data = await safeParseJson<Partial<DocumentAnalysis> & { error?: string }>(
        response
      );
      if (!response.ok) {
        throw new Error(data.error || "Transformation failed.");
      }

      setAnalysis((prev) => (prev ? { ...prev, ...data } : null));

      if (action === "expand_visuals") {
        setActiveTab(WorkspaceTab.VISUALS);
      } else {
        setActiveTab(WorkspaceTab.SCRIPT);
      }
      setStatusAnnouncement(`Updated document via ${action} intelligence tool.`);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Could not complete AI adaptation."
      );
    } finally {
      setIsTransforming(null);
    }
  };

  const handleRunWebResearch = async () => {
    if (!analysis) return;
    setIsResearchingWeb(true);
    setErrorBanner(null);
    clearAudioUrl();
    setStatusAnnouncement("Searching Google for topic research...");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentContext: analysis,
        }),
      });
      const data = await safeParseJson<{
        query?: string;
        summary?: string;
        webSources?: Array<{ uri: string; title: string }>;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || "Google web research failed.");
      }

      const brief = {
        query: data.query || analysis.documentTitle,
        summary: data.summary || "",
        sources: Array.isArray(data.webSources) ? data.webSources : [],
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setAnalysis((prev) => (prev ? { ...prev, webResearch: brief } : null));
      setActiveTab(WorkspaceTab.SCRIPT);

      if (!isLiveVoiceConnected && brief.summary) {
        await synthesizeSpeech({
          customText: brief.summary,
          customLabel: `Google Web Research — ${analysis.documentTitle}`,
          forceDialogue: false,
        });
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Failed to research topic on Google."
      );
    } finally {
      setIsResearchingWeb(false);
    }
  };

  const handleRunDeepAiReport = async (readReportAloud = false) => {
    if (!analysis) return;
    setIsGeneratingDeepReport(true);
    setErrorBanner(null);
    setStatusAnnouncement(
      "AI Deep-Reading every single page, line, and word inside the PDF..."
    );

    try {
      const res = await fetch("/api/deep-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentContext: analysis,
          fileBase64: uploadedPdfBase64 || undefined,
          mimeType: uploadedMimeType,
          targetLanguage,
        }),
      });
      const data = await safeParseJson<{
        documentTitle?: string;
        overview?: string;
        detailedReport?: string;
        keyTakeaways?: string[];
        pages?: PdfPageContent[];
        totalWordsRead?: number;
        totalLinesRead?: number;
        modelUsed?: string;
        error?: string;
      }>(res);

      if (!res.ok) {
        throw new Error(data.error || "Could not generate AI full-PDF report.");
      }

      setAnalysis((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          documentTitle: data.documentTitle || prev.documentTitle,
          overview: data.overview || prev.overview,
          detailedReport: data.detailedReport || prev.detailedReport,
          keyTakeaways: data.keyTakeaways || prev.keyTakeaways,
          pages:
            data.pages && data.pages.length > 0 ? data.pages : prev.pages,
          totalWordsRead: data.totalWordsRead || prev.totalWordsRead,
          totalLinesRead: data.totalLinesRead || prev.totalLinesRead,
          modelUsed: data.modelUsed || prev.modelUsed,
        };
      });

      setActiveTab(WorkspaceTab.SCRIPT);
      setStatusAnnouncement(
        "Complete AI Full-PDF Report generated from every page, line, and word."
      );

      if (readReportAloud && data.detailedReport && !isLiveVoiceConnected) {
        await synthesizeSpeech({
          customText: data.detailedReport,
          customLabel: `Complete AI Content Report — ${
            data.documentTitle || analysis.documentTitle
          }`,
          forceDialogue: false,
        });
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Could not complete AI full-PDF deep scan."
      );
    } finally {
      setIsGeneratingDeepReport(false);
    }
  };

  const fullVerbatimScriptText = useMemo(
    () => buildFullPdfVerbatimText(analysis),
    [analysis]
  );

  const displayedScriptBody = useMemo(() => {
    if (!analysis) return "";
    if (summaryMode === SummaryMode.VERBATIM) {
      return fullVerbatimScriptText || analysis.narrationScript || "";
    }
    return analysis.narrationScript || fullVerbatimScriptText || "";
  }, [analysis, fullVerbatimScriptText, summaryMode]);

  const scriptSentences = useMemo(
    () => splitIntoSentences(displayedScriptBody),
    [displayedScriptBody]
  );

  const activeSentenceIndex = useMemo(() => {
    if (!isAudioPlaying || scriptSentences.length === 0) return -1;
    const totalChars =
      scriptSentences.reduce((sum, s) => sum + s.length, 0) || 1;
    const targetChar = progressRatio * totalChars;
    let cumulative = 0;
    for (let i = 0; i < scriptSentences.length; i++) {
      cumulative += scriptSentences[i].length;
      if (targetChar <= cumulative) return i;
    }
    return scriptSentences.length - 1;
  }, [isAudioPlaying, progressRatio, scriptSentences]);

  const nonEmptyExtractedPages = useMemo(
    () =>
      (analysis?.pages || []).filter((p) => p.text && p.text.trim().length > 0),
    [analysis?.pages]
  );

  const verifiedStats = useMemo(() => {
    if (!analysis) return { pages: 0, lines: 0, words: 0 };
    const pagesCount =
      nonEmptyExtractedPages.length || analysis.detectedPageCountEstimate || 1;
    const wordsCount =
      analysis.totalWordsRead ||
      fullVerbatimScriptText.trim().split(/\s+/).filter(Boolean).length;
    const linesCount =
      analysis.totalLinesRead ||
      nonEmptyExtractedPages
        .map((p) => p.text)
        .join("\n")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean).length;
    return { pages: pagesCount, lines: linesCount, words: wordsCount };
  }, [analysis, fullVerbatimScriptText, nonEmptyExtractedPages]);

  const transcriptExportString = useMemo(() => {
    if (!analysis) {
      return "FREE PDF AI — ACCESSIBLE AUDIO SUMMARY\nNo PDF document is currently loaded.";
    }
    const chapterBlock = (analysis.chapters || [])
      .map((c) => `${c.title}\n${c.spokenText}`)
      .join("\n\n");
    const visualsBlock = (analysis.visualDescriptions || [])
      .map((v) => `[${v.elementType}] ${v.label}: ${v.spokenDescription}`)
      .join("\n\n");
    const pagesVerbatimBlock = nonEmptyExtractedPages
      .map((p) => `=== PAGE ${p.pageNumber}: ${p.heading} ===\n${p.text}`)
      .join("\n\n");
    const reportBlock = analysis.detailedReport
      ? `\nAI COMPLETE FULL-PDF CONTENT REPORT\n${analysis.detailedReport}\n`
      : "";
    const webBlock = analysis.webResearch
      ? `\nGOOGLE WEB RESEARCH BRIEFING\n${analysis.webResearch.summary}\nSources:\n${analysis.webResearch.sources
          .map((s) => `- ${s.title}: ${s.uri}`)
          .join("\n")}\n`
      : "";

    return `FREE PDF AI — COMPLETE FULL-PDF AI REPORT & VERBATIM TRANSCRIPT
Document: ${analysis.documentTitle}
Source File: ${analysis.fileName} (${verifiedStats.pages} pages · ${verifiedStats.lines} lines · ${verifiedStats.words} words)
Reading Level: ${analysis.readingLevel}
Language: ${analysis.language}

OVERVIEW
${analysis.overview}
${reportBlock}
FULL SPOKEN NARRATION SCRIPT
${analysis.narrationScript}

KEY TAKEAWAYS
${(analysis.keyTakeaways || []).map((k, idx) => `${idx + 1}. ${k}`).join("\n")}

CHAPTER BREAKDOWN
${chapterBlock}

COMPLETE PAGE-BY-PAGE VERBATIM TEXT (EVERY LINE & WORD)
${pagesVerbatimBlock}

VISUAL & TABLE DESCRIPTIONS FOR SCREEN READERS
${visualsBlock}
${webBlock}`;
  }, [analysis, nonEmptyExtractedPages, verifiedStats]);

  const fontSizeClass =
    readerSettings.fontScale === "xlarge"
      ? "text-[21px]"
      : readerSettings.fontScale === "large"
      ? "text-[18.5px]"
      : "text-[16px]";

  const lineHeightClass = readerSettings.relaxedSpacing
    ? "leading-[1.95] tracking-[0.012em]"
    : "leading-[1.7]";

  const effectiveDarkReader = Boolean(
    isDarkMode || readerSettings.highContrastDark
  );

  return (
    <section
      id="studio"
      aria-labelledby="studio-heading"
      className="max-w-[1280px] mx-auto px-6 py-12"
    >
      <div className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement}
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2
            id="studio-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50"
          >
            Accessible AI Document Voice Studio
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            AI reads every single page, every single line, and every single word inside your PDF, Form, Photo, Doc &amp; WhatsApp file—and reports back in full.
          </p>
        </div>

        {/* Sample Document Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            Sample PDFs:
          </span>
          {SAMPLE_DOCUMENTS.map((sample) => {
            const isSelected = Boolean(
              analysis && selectedSampleId === sample.id && !activeUploadedId
            );
            return (
              <button
                key={sample.id}
                type="button"
                onClick={() => handleSelectSample(sample.id)}
                aria-pressed={isSelected}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                  isSelected
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-amber-400 dark:text-slate-950 dark:border-amber-400 font-semibold"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 dark:bg-[#0F172A] dark:text-slate-200 dark:border-slate-700 dark:hover:border-slate-500"
                }`}
              >
                {sample.category}
              </button>
            );
          })}
        </div>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 px-5 py-3.5 text-sm flex items-center justify-between gap-4"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs font-semibold underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main 12-Column Single-Elevation Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5 cols): Multi-Format File Manager (5 GB Dropzone + Add PDF + 4 Format Buttons), Summary Mode, Voice Persona & Google Research Tools */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 transition-colors duration-150">
          {/* 1. High-Capacity Multi-Format Dropzone (Up to 5 GB) + Add PDF + 4 Dedicated Format Buttons */}
          <div className="p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Files &amp; Documents (
                {uploadedLibrary.length > 0
                  ? `${uploadedLibrary.length} Added`
                  : "Active"}
                )
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 border border-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 dark:border-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[36px] disabled:opacity-50"
                >
                  <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
                  Add PDF
                </button>

                {analysis && (
                  <button
                    type="button"
                    onClick={handleDeletePdf}
                    disabled={isAnalyzing}
                    aria-label={`Delete active file ${analysis.fileName}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-200 dark:text-red-300 dark:bg-slate-800 dark:hover:bg-red-950/50 dark:border-red-800/80 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[36px] disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* 4 Dedicated Multi-Format Upload Buttons right alongside Add PDF */}
            <div
              role="group"
              aria-label="Additional file format upload options"
              className="grid grid-cols-2 gap-2 mb-3.5"
            >
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isAnalyzing}
                className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:hover:text-amber-300 dark:hover:border-amber-400 dark:border-slate-700 rounded-lg transition-colors min-h-[40px] disabled:opacity-50"
              >
                <ImageIcon
                  className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">JPG / PNG Photo</span>
              </button>

              <button
                type="button"
                onClick={() => writtenPhotoInputRef.current?.click()}
                disabled={isAnalyzing}
                className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:hover:text-amber-300 dark:hover:border-amber-400 dark:border-slate-700 rounded-lg transition-colors min-h-[40px] disabled:opacity-50"
              >
                <PenTool
                  className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">Written Photo (OCR)</span>
              </button>

              <button
                type="button"
                onClick={() => pdfFormInputRef.current?.click()}
                disabled={isAnalyzing}
                className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:hover:text-amber-300 dark:hover:border-amber-400 dark:border-slate-700 rounded-lg transition-colors min-h-[40px] disabled:opacity-50"
              >
                <ClipboardList
                  className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">PDF Forms (XFDF/FDF)</span>
              </button>

              <button
                type="button"
                onClick={() => docsWhatsappInputRef.current?.click()}
                disabled={isAnalyzing}
                className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:hover:text-amber-300 dark:hover:border-amber-400 dark:border-slate-700 rounded-lg transition-colors min-h-[40px] disabled:opacity-50"
              >
                <MessageCircle
                  className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">Docs &amp; WhatsApp</span>
              </button>
            </div>

            {/* Hidden Secondary File Inputs for 4 Dedicated Format Buttons */}
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept={FORMAT_ACCEPT_MAP.image}
              onChange={(e) => {
                const selectedFiles = e.target.files
                  ? Array.from(e.target.files)
                  : [];
                if (selectedFiles.length > 0) {
                  processMultipleUploadedFiles(selectedFiles, "image");
                }
                e.target.value = "";
              }}
              className="sr-only"
            />

            <input
              ref={writtenPhotoInputRef}
              type="file"
              multiple
              accept={FORMAT_ACCEPT_MAP.written_photo}
              onChange={(e) => {
                const selectedFiles = e.target.files
                  ? Array.from(e.target.files)
                  : [];
                if (selectedFiles.length > 0) {
                  processMultipleUploadedFiles(selectedFiles, "written_photo");
                }
                e.target.value = "";
              }}
              className="sr-only"
            />

            <input
              ref={pdfFormInputRef}
              type="file"
              multiple
              accept={FORMAT_ACCEPT_MAP.pdf_form}
              onChange={(e) => {
                const selectedFiles = e.target.files
                  ? Array.from(e.target.files)
                  : [];
                if (selectedFiles.length > 0) {
                  processMultipleUploadedFiles(selectedFiles, "pdf_form");
                }
                e.target.value = "";
              }}
              className="sr-only"
            />

            <input
              ref={docsWhatsappInputRef}
              type="file"
              multiple
              accept={FORMAT_ACCEPT_MAP.docs_whatsapp}
              onChange={(e) => {
                const selectedFiles = e.target.files
                  ? Array.from(e.target.files)
                  : [];
                if (selectedFiles.length > 0) {
                  processMultipleUploadedFiles(selectedFiles, "docs_whatsapp");
                }
                e.target.value = "";
              }}
              className="sr-only"
            />

            <label
              htmlFor="pdf-upload-input"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const droppedFiles = e.dataTransfer.files
                  ? Array.from(e.dataTransfer.files)
                  : [];
                if (droppedFiles.length > 0) {
                  processMultipleUploadedFiles(droppedFiles, "pdf");
                }
              }}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700 dark:focus-within:outline-amber-400 ${
                isDragging
                  ? "border-blue-700 bg-blue-50/60 dark:border-amber-400 dark:bg-slate-800/80"
                  : !analysis
                  ? "border-blue-400 bg-blue-50/30 hover:border-blue-600 dark:border-blue-500/70 dark:bg-slate-800/40 dark:hover:border-amber-400"
                  : "border-slate-300 hover:border-blue-600 hover:bg-slate-50/70 dark:border-slate-700 dark:hover:border-amber-400 dark:hover:bg-slate-800/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALL_SUPPORTED_FILE_ACCEPT}
                onChange={(e) => {
                  const selectedFiles = e.target.files
                    ? Array.from(e.target.files)
                    : [];
                  if (selectedFiles.length > 0) {
                    processMultipleUploadedFiles(selectedFiles, "pdf");
                  }
                  e.target.value = "";
                }}
                className="sr-only"
                id="pdf-upload-input"
              />
              {isAnalyzing ? (
                <div className="py-2 flex flex-col items-center">
                  <Loader2
                    className="w-7 h-7 text-blue-700 dark:text-blue-400 animate-spin mb-2.5"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {analyzeStepLabel || "Reading file..."}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Extracting text, forms, or handwriting for natural voice playback
                  </span>
                </div>
              ) : (
                <>
                  <FileUp
                    className="w-7 h-7 text-blue-700 dark:text-blue-400 mb-2.5"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {analysis
                      ? "Drop any file here or click to add more (Up to 5 GB)"
                      : "Drop PDF, JPG/PNG, Written Photo, Docs or WhatsApp file here"}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Up to 5 GB per file · PDF &amp; Forms · JPG/PNG · Handwritten OCR · Word Docs &amp; WhatsApp (.txt / .zip)
                  </span>
                </>
              )}
            </label>

            {/* Uploaded Files Switcher List */}
            {uploadedLibrary.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Your Uploaded Files ({uploadedLibrary.length})
                </div>
                <div className="space-y-1.5 max-h-[168px] overflow-y-auto pr-1">
                  {uploadedLibrary.map((item) => {
                    const isCurrent = activeUploadedId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                          isCurrent
                            ? "border-blue-600 bg-blue-50/70 text-slate-900 dark:border-amber-400 dark:bg-slate-800 dark:text-slate-100"
                            : "border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectUploadedItem(item)}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left"
                        >
                          <FileText
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isCurrent
                                ? "text-blue-700 dark:text-amber-300"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="font-semibold truncate">
                            {item.analysis.fileName}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            · {getCategoryLabel(item.analysis.sourceCategory)}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums shrink-0">
                            · {item.analysis.detectedPageCountEstimate}p
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveUploadedItem(item.id)}
                          aria-label={`Remove ${item.analysis.fileName}`}
                          className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unboxed Clean Document Metadata with Verified Lines & Words Read */}
            {analysis ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                  {analysis.fileName}
                </span>
                <span aria-hidden="true">·</span>
                <span>{getCategoryLabel(analysis.sourceCategory)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {verifiedStats.pages}{" "}
                  {verifiedStats.pages === 1 ? "page" : "pages"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-semibold text-blue-800 dark:text-amber-300">
                  {verifiedStats.lines.toLocaleString()} lines ·{" "}
                  {verifiedStats.words.toLocaleString()} words read
                </span>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                No file currently loaded. Choose{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">
                  Add PDF
                </strong>{" "}
                or any format button above (up to 5 GB per file) to listen right away.
              </p>
            )}
          </div>

          {/* 2. Audio Reading Format Selector (Defaults to Full Word-for-Word) */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                AI Reading &amp; Report Mode
              </span>
              {isTransforming === "mode" && (
                <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400">
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    aria-hidden="true"
                  />
                  Adapting...
                </span>
              )}
            </div>

            <div
              role="group"
              aria-label="Audio reading format"
              className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg"
            >
              <button
                type="button"
                onClick={() => handleModeSwitch(SummaryMode.VERBATIM)}
                aria-pressed={summaryMode === SummaryMode.VERBATIM}
                className={`px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  summaryMode === SummaryMode.VERBATIM
                    ? "bg-white text-blue-800 dark:bg-slate-700 dark:text-amber-300 shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Full Word-for-Word
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch(SummaryMode.EXECUTIVE)}
                aria-pressed={summaryMode === SummaryMode.EXECUTIVE}
                className={`px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  summaryMode === SummaryMode.EXECUTIVE
                    ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Executive Brief
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch(SummaryMode.PLAIN)}
                aria-pressed={summaryMode === SummaryMode.PLAIN}
                className={`px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  summaryMode === SummaryMode.PLAIN
                    ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Plain Language
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch(SummaryMode.DIALOGUE)}
                aria-pressed={summaryMode === SummaryMode.DIALOGUE}
                className={`px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  summaryMode === SummaryMode.DIALOGUE
                    ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                2-Host Dialogue
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2.5">
              {summaryMode === SummaryMode.VERBATIM
                ? "Reads 100% of every page, every single line, and every single word inside your PDF continuously from start to finish."
                : summaryMode === SummaryMode.DIALOGUE
                ? "Conversational two-speaker walkthrough (Alex & Sam) designed to sustain auditory focus."
                : summaryMode === SummaryMode.PLAIN
                ? "Short sentences and everyday vocabulary tailored for cognitive accessibility and dyslexia relief."
                : "Structured single-narrator synthesis covering core findings, deadlines, and quantitative figures."}
            </p>
          </div>

          {/* 3. Natural Voice Persona Selector + Full-PDF Word-for-Word & AI Report Controls */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {summaryMode === SummaryMode.DIALOGUE
                  ? "Dual-Host Voices (Alex: Puck · Sam: Kore)"
                  : "AI Narrator & Live Chat Voice"}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {currentVoiceObj.timbre}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Select narrator voice"
              className="grid grid-cols-5 gap-1.5"
            >
              {VOICE_PERSONAS.map((voice) => {
                const active = selectedVoice === voice.id;
                return (
                  <button
                    key={voice.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setSelectedVoice(voice.id);
                      if (summaryMode !== SummaryMode.DIALOGUE) {
                        clearAudioUrl();
                      }
                    }}
                    className={`px-2 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                      active
                        ? "border-blue-700 bg-blue-50 text-blue-800 dark:border-amber-400 dark:bg-slate-800 dark:text-amber-300"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    {voice.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2.5">
              <button
                type="button"
                onClick={() =>
                  analysis
                    ? summaryMode === SummaryMode.VERBATIM
                      ? handleReadEntirePdfWordForWord(1)
                      : synthesizeSpeech({
                          forceDialogue: summaryMode === SummaryMode.DIALOGUE,
                        })
                    : fileInputRef.current?.click()
                }
                disabled={isSynthesizing || isAnalyzing}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
              >
                {isSynthesizing ? (
                  <>
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    Synthesizing Natural AI Speech...
                  </>
                ) : !analysis ? (
                  <>
                    <FileUp className="w-4 h-4" aria-hidden="true" />
                    Upload PDF &amp; Read Every Word Aloud
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4" aria-hidden="true" />
                    {summaryMode === SummaryMode.VERBATIM
                      ? `Read Entire PDF Word-for-Word (${selectedVoice})`
                      : summaryMode === SummaryMode.DIALOGUE
                      ? "Read PDF Summary (2-Host Dialogue)"
                      : `Read AI Summary Aloud with ${selectedVoice}`}
                  </>
                )}
              </button>

              {analysis && (
                <button
                  type="button"
                  onClick={() => handleRunDeepAiReport(true)}
                  disabled={
                    isGeneratingDeepReport || isSynthesizing || isAnalyzing
                  }
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 dark:text-amber-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-60"
                >
                  {isGeneratingDeepReport ? (
                    <>
                      <Loader2
                        className="w-4 h-4 animate-spin text-blue-700 dark:text-amber-300"
                        aria-hidden="true"
                      />
                      AI Reading Every Line &amp; Building Report...
                    </>
                  ) : (
                    <>
                      <Sparkles
                        className="w-4 h-4 text-blue-700 dark:text-amber-300"
                        aria-hidden="true"
                      />
                      AI Deep-Read Entire PDF &amp; Speak Full Report
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={launchHandsFreeVoiceChat}
                disabled={isAnalyzing}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
              >
                <Mic className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                Live AI Voice Chat &amp; Google Research
              </button>
            </div>
          </div>

          {/* 4. Gemini Accessibility & Google Web Research Toolkit */}
          <div className="p-6">
            <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Document &amp; Google Web Intelligence
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
              <button
                type="button"
                onClick={handleRunWebResearch}
                disabled={
                  !analysis ||
                  isResearchingWeb ||
                  Boolean(isTransforming) ||
                  isAnalyzing
                }
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-blue-800 bg-blue-50/80 hover:bg-blue-100 border border-blue-200 dark:text-sky-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-50"
              >
                {isResearchingWeb ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-sky-300"
                    aria-hidden="true"
                  />
                ) : (
                  <Globe
                    className="w-3.5 h-3.5 text-blue-700 dark:text-sky-300"
                    aria-hidden="true"
                  />
                )}
                Research Topic on Google &amp; Read Aloud
              </button>

              <button
                type="button"
                onClick={() => handleRunTransform("simplify")}
                disabled={!analysis || Boolean(isTransforming) || isAnalyzing}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-50"
              >
                {isTransforming === "simplify" ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles
                    className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                )}
                Simplify Jargon
              </button>

              <button
                type="button"
                onClick={() => handleRunTransform("action_items")}
                disabled={!analysis || Boolean(isTransforming) || isAnalyzing}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-50"
              >
                {isTransforming === "action_items" ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                ) : (
                  <ListChecks
                    className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                )}
                Extract Action Steps
              </button>

              <button
                type="button"
                onClick={() => handleRunTransform("expand_visuals")}
                disabled={!analysis || Boolean(isTransforming) || isAnalyzing}
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:text-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-50"
              >
                {isTransforming === "expand_visuals" ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Eye
                    className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                )}
                Describe All Charts &amp; Tables for Screen Readers
              </button>
            </div>

            {/* Multilingual Audio Translation */}
            <div className="flex items-center gap-2 pt-2">
              <Globe
                className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0"
                aria-hidden="true"
              />
              <label
                htmlFor="audio-language-select"
                className="text-xs text-slate-600 dark:text-slate-300 shrink-0"
              >
                Translate script:
              </label>
              <select
                id="audio-language-select"
                value={targetLanguage}
                onChange={(e) => {
                  const nextLang = e.target.value;
                  setTargetLanguage(nextLang);
                  if (analysis) {
                    handleRunTransform("translate", nextLang);
                  }
                }}
                disabled={!analysis || Boolean(isTransforming) || isAnalyzing}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 min-h-[36px] disabled:opacity-50"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (7 cols): Accessible Audio Player + Synchronized Reader / Visual Alt-Text / Live Voice / Text Q&A + Library Banner Below */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden transition-colors duration-150">
            <AudioPlayerBar
              audioUrl={audioUrl}
              browserSpeechText={browserSpeechText}
              browserSpeechTrigger={browserSpeechTrigger}
              activeLabel={activeAudioTitle}
              voiceLabel={
                summaryMode === SummaryMode.DIALOGUE
                  ? "Alex (Puck) & Sam (Kore) · Dual-Speaker"
                  : `${currentVoiceObj.name} · ${currentVoiceObj.timbre}`
              }
              isSynthesizing={isSynthesizing}
              onGenerateAndPlay={() =>
                analysis
                  ? summaryMode === SummaryMode.VERBATIM
                    ? handleReadEntirePdfWordForWord(1)
                    : synthesizeSpeech({
                        forceDialogue: summaryMode === SummaryMode.DIALOGUE,
                      })
                  : fileInputRef.current?.click()
              }
              onProgressRatioChange={(ratio, playing) => {
                setProgressRatio(ratio);
                setIsAudioPlaying(playing);
              }}
              onTrackEnded={handleAudioTrackEnded}
              queuePositionLabel={
                queuePosition
                  ? `Continuous Reading: Part ${queuePosition.index} of ${queuePosition.total}`
                  : null
              }
              canSkipPrevPart={Boolean(queuePosition && queuePosition.index > 1)}
              canSkipNextPart={Boolean(
                queuePosition && queuePosition.index < queuePosition.total
              )}
              onPrevPart={() => handleSkipQueuePart(-1)}
              onNextPart={() => handleSkipQueuePart(1)}
              transcriptDownloadText={transcriptExportString}
              documentFileName={analysis?.fileName || "free_pdf_ai_audio"}
            />

            {/* Workspace View Navigation Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80">
              <div
                role="tablist"
                aria-label="Document workspace views"
                className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === WorkspaceTab.SCRIPT}
                  onClick={() => setActiveTab(WorkspaceTab.SCRIPT)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === WorkspaceTab.SCRIPT
                      ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  Script &amp; Pages ({analysis?.detectedPageCountEstimate || 0})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === WorkspaceTab.VISUALS}
                  onClick={() => setActiveTab(WorkspaceTab.VISUALS)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === WorkspaceTab.VISUALS
                      ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  Visuals ({analysis?.visualDescriptions?.length || 0})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === WorkspaceTab.VOICE_CHAT}
                  onClick={() => setActiveTab(WorkspaceTab.VOICE_CHAT)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === WorkspaceTab.VOICE_CHAT
                      ? "bg-white text-blue-700 dark:bg-slate-700 dark:text-amber-300 shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  Voice Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === WorkspaceTab.CHAT}
                  onClick={() => setActiveTab(WorkspaceTab.CHAT)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === WorkspaceTab.CHAT
                      ? "bg-white text-blue-700 dark:bg-slate-700 dark:text-amber-300 shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  Text &amp; Web Q&amp;A
                </button>
              </div>

              {/* Low-Vision, Dyslexia & Theme Controls */}
              <div className="flex flex-wrap items-center gap-2">
                {activeTab !== WorkspaceTab.VOICE_CHAT &&
                  activeTab !== WorkspaceTab.CHAT && (
                    <>
                      <div
                        role="group"
                        aria-label="Transcript text size"
                        className="flex items-center gap-0.5 p-0.5 border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 rounded-lg"
                      >
                        <TypeIcon
                          className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 shrink-0"
                          aria-hidden="true"
                        />
                        {(["base", "large", "xlarge"] as const).map(
                          (scale, idx) => (
                            <button
                              key={scale}
                              type="button"
                              onClick={() =>
                                setReaderSettings((s) => ({
                                  ...s,
                                  fontScale: scale,
                                }))
                              }
                              aria-pressed={readerSettings.fontScale === scale}
                              aria-label={`Font size ${scale}`}
                              className={`px-2 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                                readerSettings.fontScale === scale
                                  ? "bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950"
                                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                              }`}
                            >
                              {idx === 0 ? "100%" : idx === 1 ? "115%" : "130%"}
                            </button>
                          )
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setReaderSettings((s) => ({
                            ...s,
                            relaxedSpacing: !s.relaxedSpacing,
                          }))
                        }
                        aria-pressed={readerSettings.relaxedSpacing}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                          readerSettings.relaxedSpacing
                            ? "bg-slate-900 text-white border-slate-900 dark:bg-amber-400 dark:text-slate-950 dark:border-amber-400 font-semibold"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
                        }`}
                      >
                        Wide Spacing
                      </button>
                    </>
                  )}

                {activeTab !== WorkspaceTab.CHAT && (
                  <button
                    type="button"
                    onClick={() =>
                      setReaderSettings((s) => ({
                        ...s,
                        highContrastDark: !s.highContrastDark,
                      }))
                    }
                    aria-pressed={readerSettings.highContrastDark}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                      readerSettings.highContrastDark
                        ? "bg-amber-400 text-slate-950 border-amber-500 font-semibold"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
                    }`}
                  >
                    High Contrast
                  </button>
                )}

                {onToggleDarkMode && (
                  <button
                    type="button"
                    onClick={onToggleDarkMode}
                    aria-pressed={isDarkMode}
                    aria-label={
                      isDarkMode
                        ? "Switch application to light mode"
                        : "Switch application to dark mode"
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-300 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
                  >
                    {isDarkMode ? (
                      <>
                        <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                        Light
                      </>
                    ) : (
                      <>
                        <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                        Dark
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* TAB 1: AUDIO SCRIPT, CHAPTERS, DIRECT PDF PAGES & GOOGLE WEB RESEARCH */}
            {activeTab === WorkspaceTab.SCRIPT && (
              <div
                className={`p-6 sm:p-8 transition-colors duration-150 ${
                  readerSettings.highContrastDark
                    ? "bg-[#050811] text-slate-50 tracking-[0.012em]"
                    : isDarkMode
                    ? "bg-[#0B1120] text-slate-100 tracking-[0.01em]"
                    : "bg-white text-slate-900"
                }`}
              >
                {!analysis ? (
                  <div className="py-14 text-center max-w-md mx-auto">
                    <FileUp
                      className={`w-10 h-10 mx-auto mb-3 ${
                        effectiveDarkReader ? "text-amber-300" : "text-blue-700"
                      }`}
                      aria-hidden="true"
                    />
                    <h3 className="text-lg font-bold mb-2">
                      Upload Any File (Up to 5 GB) to Read Aloud
                    </h3>
                    <p
                      className={`text-sm mb-6 leading-relaxed ${
                        effectiveDarkReader ? "text-slate-300" : "text-slate-600"
                      }`}
                    >
                      Select one or multiple PDF files. Free PDF AI extracts every page locally with PDF.js, reads it out loud in natural speech, and lets you research related topics via Google Search.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isAnalyzing}
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                      >
                        <FileUp className="w-4 h-4" aria-hidden="true" />
                        Add PDF &amp; Read Aloud
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab(WorkspaceTab.VOICE_CHAT)}
                        className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                          effectiveDarkReader
                            ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                            : "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200"
                        }`}
                      >
                        <Mic
                          className={`w-4 h-4 ${
                            effectiveDarkReader
                              ? "text-amber-300"
                              : "text-blue-700"
                          }`}
                          aria-hidden="true"
                        />
                        Open Voice Chat
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`pb-6 border-b ${
                        effectiveDarkReader
                          ? "border-slate-800"
                          : "border-slate-200/80"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs opacity-90">
                          <span>{analysis.language}</span>
                          <span aria-hidden="true">·</span>
                          <span>{analysis.readingLevel}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums font-semibold">
                            {verifiedStats.pages}{" "}
                            {verifiedStats.pages === 1 ? "page" : "pages"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-mono tabular-nums font-semibold ${
                              effectiveDarkReader
                                ? "text-amber-300"
                                : "text-blue-700"
                            }`}
                          >
                            {verifiedStats.lines.toLocaleString()} lines ·{" "}
                            {verifiedStats.words.toLocaleString()} words read
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            ~
                            {Math.max(
                              1,
                              Math.round((verifiedStats.words || 150) / 150)
                            )}{" "}
                            min full read
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isAnalyzing}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                              effectiveDarkReader
                                ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                                : "border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <FileUp
                              className={`w-3.5 h-3.5 ${
                                effectiveDarkReader
                                  ? "text-blue-400"
                                  : "text-blue-700"
                              }`}
                              aria-hidden="true"
                            />
                            Add PDF
                          </button>
                          <button
                            type="button"
                            onClick={handleDeletePdf}
                            disabled={isAnalyzing}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                              effectiveDarkReader
                                ? "border-red-800/80 text-red-300 hover:bg-red-950/40"
                                : "border-red-200 text-red-700 hover:bg-red-50"
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Delete PDF
                          </button>
                        </div>
                      </div>

                      <h3 className="text-xl sm:text-2xl font-bold tracking-tight mb-3 text-balance">
                        {analysis.documentTitle}
                      </h3>
                      <p
                        className={`text-sm ${
                          effectiveDarkReader ? "text-slate-300" : "text-slate-600"
                        } leading-relaxed`}
                      >
                        {analysis.overview}
                      </p>
                    </div>

                    {/* AI COMPLETE FULL-PDF CONTENT REPORT (PROVES EVERY PAGE, LINE & WORD INSIDE WAS READ) */}
                    <div
                      className={`py-6 border-b ${
                        effectiveDarkReader
                          ? "border-slate-800"
                          : "border-slate-200/80"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Sparkles
                              className={`w-4 h-4 shrink-0 ${
                                effectiveDarkReader
                                  ? "text-amber-300"
                                  : "text-blue-700"
                              }`}
                              aria-hidden="true"
                            />
                            <h4 className="text-sm font-bold">
                              AI Full-Document Content Report (All Pages, Lines &amp; Words Extracted)
                            </h4>
                          </div>
                          <p
                            className={`text-xs mt-0.5 ${
                              effectiveDarkReader
                                ? "text-slate-400"
                                : "text-slate-500"
                            }`}
                          >
                            Full-page text extracted inside &ldquo;{analysis.fileName}&rdquo; ({getCategoryLabel(analysis.sourceCategory)}):{" "}
                            <span className="font-mono tabular-nums font-semibold">
                              {verifiedStats.pages} {verifiedStats.pages === 1 ? "page" : "pages"} ·{" "}
                              {verifiedStats.lines.toLocaleString()} lines ·{" "}
                              {verifiedStats.words.toLocaleString()} words
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleReadEntirePdfWordForWord(1)}
                            disabled={isSynthesizing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px] disabled:opacity-60"
                          >
                            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                            Read Entire PDF Word-for-Word
                          </button>

                          {analysis.detailedReport && (
                            <button
                              type="button"
                              onClick={() =>
                                synthesizeSpeech({
                                  customText: analysis.detailedReport!,
                                  customLabel: `Complete AI Content Report — ${analysis.documentTitle}`,
                                  forceDialogue: false,
                                })
                              }
                              disabled={isSynthesizing}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                                effectiveDarkReader
                                  ? "border-slate-700 text-amber-300 hover:bg-slate-800"
                                  : "border-blue-200 text-blue-800 bg-blue-50/70 hover:bg-blue-100"
                              }`}
                            >
                              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Listen to Report
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRunDeepAiReport(false)}
                            disabled={isGeneratingDeepReport}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                              effectiveDarkReader
                                ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                                : "border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {isGeneratingDeepReport ? (
                              <>
                                <Loader2
                                  className="w-3.5 h-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                                Scanning All Lines...
                              </>
                            ) : (
                              <>
                                <Sparkles
                                  className={`w-3.5 h-3.5 ${
                                    effectiveDarkReader
                                      ? "text-amber-300"
                                      : "text-blue-700"
                                  }`}
                                  aria-hidden="true"
                                />
                                Re-Scan &amp; Refresh AI Report
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div
                        className={`rounded-xl border p-4 sm:p-5 ${
                          effectiveDarkReader
                            ? "border-slate-800 bg-slate-900/70"
                            : "border-slate-200 bg-slate-50/70"
                        }`}
                      >
                        <p
                          className={`${fontSizeClass} ${lineHeightClass} whitespace-pre-line`}
                        >
                          {analysis.detailedReport || analysis.overview}
                        </p>
                      </div>
                    </div>

                    {/* Google Web Research Briefing Section (when generated) */}
                    {analysis.webResearch && (
                      <div
                        className={`py-6 border-b ${
                          effectiveDarkReader
                            ? "border-slate-800"
                            : "border-slate-200/80"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <Globe
                              className={`w-4 h-4 shrink-0 ${
                                effectiveDarkReader
                                  ? "text-amber-300"
                                  : "text-blue-700"
                              }`}
                              aria-hidden="true"
                            />
                            <h4 className="text-sm font-semibold">
                              Google Search Web Research Briefing
                            </h4>
                            <span className="text-xs opacity-70 font-mono tabular-nums">
                              · {analysis.webResearch.timestamp}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              synthesizeSpeech({
                                customText: analysis.webResearch!.summary,
                                customLabel: `Google Web Research — ${analysis.documentTitle}`,
                                forceDialogue: false,
                              })
                            }
                            disabled={isSynthesizing}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              effectiveDarkReader
                                ? "text-amber-300 hover:text-amber-200"
                                : "text-blue-700 hover:text-blue-900"
                            }`}
                          >
                            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Read Web Research Aloud
                          </button>
                        </div>

                        <p
                          className={`${fontSizeClass} ${lineHeightClass} max-w-[68ch] whitespace-pre-line mb-3`}
                        >
                          {analysis.webResearch.summary}
                        </p>

                        {analysis.webResearch.sources.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs pt-1">
                            <span className="font-semibold opacity-80">
                              Web Sources:
                            </span>
                            {analysis.webResearch.sources.map((src, idx) => (
                              <a
                                key={idx}
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-1 underline font-medium truncate max-w-[240px] ${
                                  effectiveDarkReader
                                    ? "text-amber-300 hover:text-amber-200"
                                    : "text-blue-700 hover:text-blue-900"
                                }`}
                              >
                                <span className="truncate">{src.title}</span>
                                <ExternalLink
                                  className="w-3 h-3 shrink-0"
                                  aria-hidden="true"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      className={`py-6 border-b ${
                        effectiveDarkReader
                          ? "border-slate-800"
                          : "border-slate-200/80"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-4">
                        <h4 className="text-sm font-semibold">
                          {summaryMode === SummaryMode.DIALOGUE
                            ? "Two-Host Conversational Script"
                            : summaryMode === SummaryMode.VERBATIM
                            ? `Complete Word-for-Word PDF Text (${verifiedStats.lines.toLocaleString()} Lines · ${verifiedStats.words.toLocaleString()} Words)`
                            : "Natural AI Narration Transcript"}
                        </h4>
                        <button
                          type="button"
                          onClick={() =>
                            summaryMode === SummaryMode.VERBATIM
                              ? handleReadEntirePdfWordForWord(1)
                              : synthesizeSpeech({
                                  forceDialogue:
                                    summaryMode === SummaryMode.DIALOGUE,
                                })
                          }
                          disabled={isSynthesizing}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            effectiveDarkReader
                              ? "text-amber-300 hover:text-amber-200"
                              : "text-blue-700 hover:text-blue-900"
                          }`}
                        >
                          <Play
                            className="w-3.5 h-3.5 fill-current"
                            aria-hidden="true"
                          />
                          {summaryMode === SummaryMode.VERBATIM
                            ? "Read Every Word Aloud"
                            : "Narrate Full Script"}
                        </button>
                      </div>

                      {summaryMode === SummaryMode.DIALOGUE &&
                      analysis.dialogueTurns?.length > 0 ? (
                        <div className="space-y-4">
                          {analysis.dialogueTurns.map((turn, idx) => (
                            <div key={idx} className="space-y-1">
                              <span
                                className={`text-xs font-semibold ${
                                  turn.speaker === "Alex"
                                    ? effectiveDarkReader
                                      ? "text-amber-300"
                                      : "text-blue-700"
                                    : effectiveDarkReader
                                    ? "text-sky-300"
                                    : "text-slate-700"
                                }`}
                              >
                                {turn.speaker}
                              </span>
                              <p
                                className={`${fontSizeClass} ${lineHeightClass} max-w-[68ch]`}
                              >
                                {turn.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : summaryMode === SummaryMode.VERBATIM ? (
                        <div
                          className={`${fontSizeClass} ${lineHeightClass} max-w-[72ch] whitespace-pre-line max-h-[420px] overflow-y-auto pr-2`}
                        >
                          {displayedScriptBody}
                        </div>
                      ) : (
                        <p
                          className={`${fontSizeClass} ${lineHeightClass} max-w-[68ch]`}
                        >
                          {scriptSentences.map((sentence, idx) => {
                            const highlighted = idx === activeSentenceIndex;
                            return (
                              <span
                                key={idx}
                                className={
                                  highlighted
                                    ? effectiveDarkReader
                                      ? "bg-amber-400 text-slate-950 rounded px-1 font-medium"
                                      : "bg-blue-100 text-slate-950 rounded px-1"
                                    : ""
                                }
                              >
                                {sentence}{" "}
                              </span>
                            );
                          })}
                        </p>
                      )}
                    </div>

                    {analysis.keyTakeaways?.length > 0 && (
                      <div
                        className={`py-6 border-b ${
                          effectiveDarkReader
                            ? "border-slate-800"
                            : "border-slate-200/80"
                        }`}
                      >
                        <h4 className="text-sm font-semibold mb-3">
                          Essential Takeaways &amp; Concrete Facts Inside PDF
                        </h4>
                        <ul className="space-y-2.5">
                          {analysis.keyTakeaways.map((point, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2.5 text-sm leading-relaxed"
                            >
                              <CheckCircle2
                                className={`w-4 h-4 mt-0.5 shrink-0 ${
                                  effectiveDarkReader
                                    ? "text-amber-300"
                                    : "text-blue-700"
                                }`}
                                aria-hidden="true"
                              />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div
                      className={`py-6 border-b ${
                        effectiveDarkReader
                          ? "border-slate-800"
                          : "border-slate-200/80"
                      }`}
                    >
                      <h4 className="text-sm font-semibold mb-4">
                        Chapter-by-Chapter Audio Navigation
                      </h4>
                      <div
                        className={`divide-y ${
                          effectiveDarkReader
                            ? "divide-slate-800"
                            : "divide-slate-200/80"
                        }`}
                      >
                        {(analysis.chapters || []).map((chapter) => (
                          <div
                            key={chapter.id}
                            className="py-4 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
                              <h5 className="text-sm font-semibold">
                                {chapter.title}
                              </h5>
                              <button
                                type="button"
                                onClick={() =>
                                  synthesizeSpeech({
                                    customText: chapter.spokenText,
                                    customLabel: `${analysis.documentTitle} — ${chapter.title}`,
                                    forceDialogue: false,
                                  })
                                }
                                disabled={isSynthesizing}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                                  effectiveDarkReader
                                    ? "border-slate-700 text-amber-300 hover:bg-slate-800"
                                    : "border-slate-200 text-slate-800 hover:bg-slate-50"
                                }`}
                              >
                                <Volume2
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                />
                                Listen to Chapter
                              </button>
                            </div>
                            <p
                              className={`text-sm mb-2 ${
                                effectiveDarkReader
                                  ? "text-slate-300"
                                  : "text-slate-600"
                              }`}
                            >
                              {chapter.summary}
                            </p>
                            {chapter.keyFacts?.length > 0 && (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-80">
                                {chapter.keyFacts.map((fact, fIdx) => (
                                  <React.Fragment key={fIdx}>
                                    {fIdx > 0 && <span aria-hidden="true">·</span>}
                                    <span>{fact}</span>
                                  </React.Fragment>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Direct Page-by-Page Verbatim Voicer Section — Every Page, Line & Word Unclamped */}
                    {nonEmptyExtractedPages.length > 0 && (
                      <div className="pt-6">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <div>
                            <h4 className="text-sm font-semibold">
                              Full-Page Extracted Text — Every Page, Line &amp; Word (
                              {nonEmptyExtractedPages.length}{" "}
                              {nonEmptyExtractedPages.length === 1
                                ? "Page"
                                : "Pages"}
                              )
                            </h4>
                            <p
                              className={`text-xs mt-0.5 ${
                                effectiveDarkReader
                                  ? "text-slate-400"
                                  : "text-slate-500"
                              }`}
                            >
                              Every recognized line and word across all pages of your PDF, JPG, or PNG is shown in full below and ready for word-for-word narration.
                            </p>
                          </div>
                        </div>

                        <div
                          className={`divide-y ${
                            effectiveDarkReader
                              ? "divide-slate-800"
                              : "divide-slate-200/80"
                          }`}
                        >
                          {nonEmptyExtractedPages
                            .slice(0, visiblePageLimit)
                            .map((page) => {
                              const pageWords = page.text
                                .trim()
                                .split(/\s+/)
                                .filter(Boolean).length;
                              const pageLines = page.text
                                .split(/\r?\n/)
                                .map((l) => l.trim())
                                .filter(Boolean).length;

                              return (
                                <div
                                  key={page.pageNumber}
                                  className="py-4 first:pt-0 last:pb-0"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <div>
                                      <span className="text-xs font-semibold">
                                        Page {page.pageNumber} · {page.heading}
                                      </span>
                                      <span className="ml-2 text-xs font-mono tabular-nums opacity-75">
                                        ({pageLines} lines · {pageWords} words)
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          synthesizeSpeech({
                                            customText: `Page ${page.pageNumber}. ${page.text}`,
                                            customLabel: `${analysis.documentTitle} — Page ${page.pageNumber} Word-for-Word`,
                                            forceDialogue: false,
                                          })
                                        }
                                        disabled={isSynthesizing}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                                          effectiveDarkReader
                                            ? "border-slate-700 text-amber-300 hover:bg-slate-800"
                                            : "border-blue-200 text-blue-800 bg-blue-50/60 hover:bg-blue-100"
                                        }`}
                                      >
                                        <Volume2
                                          className="w-3.5 h-3.5"
                                          aria-hidden="true"
                                        />
                                        Listen to Page {page.pageNumber}
                                      </button>

                                      {nonEmptyExtractedPages.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleReadEntirePdfWordForWord(
                                              page.pageNumber
                                            )
                                          }
                                          disabled={isSynthesizing}
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                                            effectiveDarkReader
                                              ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                                              : "border-slate-200 text-slate-700 hover:bg-slate-50"
                                          }`}
                                        >
                                          Read Page {page.pageNumber} → End
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <p
                                    className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                                      effectiveDarkReader
                                        ? "text-slate-200"
                                        : "text-slate-700"
                                    }`}
                                  >
                                    {page.text}
                                  </p>
                                </div>
                              );
                            })}
                        </div>

                        {nonEmptyExtractedPages.length > visiblePageLimit && (
                          <div className="mt-4 flex flex-wrap items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setVisiblePageLimit((prev) => prev + 30)
                              }
                              className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                                effectiveDarkReader
                                  ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              Show Next 30 Pages (
                              {nonEmptyExtractedPages.length - visiblePageLimit}{" "}
                              remaining)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setVisiblePageLimit(nonEmptyExtractedPages.length)
                              }
                              className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                                effectiveDarkReader
                                  ? "border-amber-400/50 text-amber-300 hover:bg-slate-800"
                                  : "border-blue-200 text-blue-800 bg-blue-50/70 hover:bg-blue-100"
                              }`}
                            >
                              Show All {nonEmptyExtractedPages.length} Pages
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB 2: SCREEN-READER VISUAL & TABLE DESCRIPTIONS */}
            {activeTab === WorkspaceTab.VISUALS && (
              <div
                className={`p-6 sm:p-8 transition-colors duration-150 ${
                  readerSettings.highContrastDark
                    ? "bg-[#050811] text-slate-50"
                    : isDarkMode
                    ? "bg-[#0B1120] text-slate-100"
                    : "bg-white text-slate-900"
                }`}
              >
                {!analysis ? (
                  <div className="py-12 text-center">
                    <p className="text-sm opacity-85 mb-4">
                      No PDF is currently loaded. Upload a PDF to extract and narrate charts, tables, and visual layouts.
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <FileUp className="w-4 h-4" aria-hidden="true" />
                      Add PDF
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      className={`flex flex-wrap items-center justify-between gap-4 pb-5 border-b ${
                        effectiveDarkReader
                          ? "border-slate-800"
                          : "border-slate-200/80"
                      }`}
                    >
                      <div>
                        <h3 className="text-lg font-bold">
                          Spoken Chart, Table &amp; Layout Descriptions
                        </h3>
                        <p
                          className={`text-xs mt-1 ${
                            effectiveDarkReader
                              ? "text-slate-300"
                              : "text-slate-600"
                          }`}
                        >
                          Non-visual verbal walkthroughs of embedded figures, financial rows, and physical diagrams.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRunTransform("expand_visuals")}
                        disabled={Boolean(isTransforming)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                      >
                        {isTransforming === "expand_visuals" ? (
                          <Loader2
                            className="w-3.5 h-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        Deep-Scan Figures
                      </button>
                    </div>

                    {analysis.visualDescriptions &&
                    analysis.visualDescriptions.length > 0 ? (
                      <div
                        className={`divide-y pt-2 ${
                          effectiveDarkReader
                            ? "divide-slate-800"
                            : "divide-slate-200/80"
                        }`}
                      >
                        {analysis.visualDescriptions.map((vis, idx) => (
                          <div key={idx} className="py-5 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                              <div>
                                <div className="text-xs opacity-75 mb-0.5">
                                  {vis.elementType}
                                </div>
                                <h4 className="text-sm font-semibold">
                                  {vis.label}
                                </h4>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  synthesizeSpeech({
                                    customText: `${vis.label}. ${vis.spokenDescription}`,
                                    customLabel: `Visual Description — ${vis.label}`,
                                    forceDialogue: false,
                                  })
                                }
                                disabled={isSynthesizing}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                                  effectiveDarkReader
                                    ? "border-slate-700 text-amber-300 hover:bg-slate-800"
                                    : "border-slate-200 text-slate-800 hover:bg-slate-50"
                                }`}
                              >
                                <Volume2
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                />
                                Narrate Figure
                              </button>
                            </div>
                            <p
                              className={`${fontSizeClass} ${lineHeightClass} max-w-[68ch]`}
                            >
                              {vis.spokenDescription}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center">
                        <p className="text-sm opacity-85 mb-4">
                          No visual figures have been extracted yet for this document.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRunTransform("expand_visuals")}
                          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 dark:bg-blue-600 rounded-lg"
                        >
                          Generate Structural &amp; Table Descriptions
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB 3: HANDS-FREE REAL-TIME GEMINI LIVE VOICE CHAT + GOOGLE WEB RESEARCH */}
            {activeTab === WorkspaceTab.VOICE_CHAT && (
              <LiveVoiceChat
                analysis={analysis}
                selectedVoice={selectedVoice}
                onSelectVoice={setSelectedVoice}
                onUploadFile={processUploadedFile}
                onDeletePdf={handleDeletePdf}
                onLiveConnectionChange={handleLiveConnectionChange}
                isUploadingPdf={isAnalyzing}
                autoConnectTrigger={liveAutoConnectCount}
                highContrastDark={effectiveDarkReader}
              />
            )}

            {/* TAB 4: MULTI-TURN GROUNDED DOCUMENT + GOOGLE SEARCH Q&A */}
            {activeTab === WorkspaceTab.CHAT && (
              <DocumentChat
                analysis={analysis}
                selectedVoice={selectedVoice}
                onSwitchToLiveVoice={launchHandsFreeVoiceChat}
                onUploadFile={processUploadedFile}
                onDeletePdf={handleDeletePdf}
                isUploadingPdf={isAnalyzing}
              />
            )}
          </div>

          {/* Visual Library Banner Below Voice Room & Chat */}
          <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <ResilientImage
              src="/assets/aistudio/AI-Powered_Reading_in_a_Vibrant_Library_0c67f1ac.png"
              alt="Students wearing headphones in a sunlit library reading books with an AI voice assistant"
              className="w-full h-auto block"
              fallbackLabel="Free PDF Reader — Read Books with AI Voice"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
