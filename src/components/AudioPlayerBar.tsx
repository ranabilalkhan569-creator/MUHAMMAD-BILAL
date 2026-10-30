import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";

interface AudioPlayerBarProps {
  audioUrl: string | null;
  browserSpeechText?: string | null;
  browserSpeechTrigger?: number;
  activeLabel: string;
  voiceLabel: string;
  isSynthesizing: boolean;
  onGenerateAndPlay: () => void;
  onProgressRatioChange?: (ratio: number, isPlaying: boolean) => void;
  onTrackEnded?: () => void;
  queuePositionLabel?: string | null;
  canSkipPrevPart?: boolean;
  canSkipNextPart?: boolean;
  onPrevPart?: () => void;
  onNextPart?: () => void;
  transcriptDownloadText: string;
  documentFileName: string;
}

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  audioUrl,
  browserSpeechText = null,
  browserSpeechTrigger = 0,
  activeLabel,
  voiceLabel,
  isSynthesizing,
  onGenerateAndPlay,
  onProgressRatioChange,
  onTrackEnded,
  queuePositionLabel = null,
  canSkipPrevPart = false,
  canSkipNextPart = false,
  onPrevPart,
  onNextPart,
  transcriptDownloadText,
  documentFileName,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTrackEndedRef = useRef<(() => void) | undefined>(onTrackEnded);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBrowserSpeaking, setIsBrowserSpeaking] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  useEffect(() => {
    onTrackEndedRef.current = onTrackEnded;
  }, [onTrackEnded]);

  // Stop browser speech helper
  const cancelBrowserSpeech = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsBrowserSpeaking(false);
  };

  useEffect(() => {
    return () => {
      cancelBrowserSpeech();
    };
  }, []);

  // Auto-play newly synthesized Gemini WAV audio URL
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(0);
    setDuration(0);

    if (audioUrl) {
      cancelBrowserSpeech();
      audio.src = audioUrl;
      audio.playbackRate = playbackRate;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      audio.removeAttribute("src");
      setIsPlaying(false);
    }
  }, [audioUrl]);

  // Browser SpeechSynthesis fallback player when triggered
  useEffect(() => {
    if (
      browserSpeechTrigger <= 0 ||
      !browserSpeechText ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }
    window.speechSynthesis.cancel();

    const textToSpeak = browserSpeechText.trim();
    if (!textToSpeak) return;

    const words = textToSpeak.split(/\s+/).filter(Boolean).length;
    const estDuration = Math.max(5, Math.round((words / 155) * 60));
    setDuration(estDuration);
    setCurrentTime(0);

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = playbackRate;
    utterance.onstart = () => {
      setIsBrowserSpeaking(true);
      setIsPlaying(true);
    };
    utterance.onboundary = (ev) => {
      if (typeof ev.charIndex === "number" && textToSpeak.length > 0) {
        const ratio = Math.min(1, ev.charIndex / textToSpeak.length);
        setCurrentTime(ratio * estDuration);
      }
    };
    utterance.onend = () => {
      setIsBrowserSpeaking(false);
      setIsPlaying(false);
      setCurrentTime(estDuration);
      onTrackEndedRef.current?.();
    };
    utterance.onerror = () => {
      setIsBrowserSpeaking(false);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  }, [browserSpeechTrigger, browserSpeechText]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (onProgressRatioChange) {
      const ratio =
        duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
      onProgressRatioChange(ratio, isPlaying);
    }
  }, [currentTime, duration, isPlaying, onProgressRatioChange]);

  // Accessible keyboard shortcuts (Space = Play/Pause, J = -15s, L = +15s) when not focused inside form inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        tag === "button" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "j" && audioUrl) {
        e.preventDefault();
        skipBy(-15);
      } else if (e.key.toLowerCase() === "l" && audioUrl) {
        e.preventDefault();
        skipBy(15);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const togglePlay = () => {
    if (isSynthesizing) return;

    if (
      !audioUrl &&
      isBrowserSpeaking &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlaying(true);
      } else if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        setIsPlaying(false);
      } else {
        onGenerateAndPlay();
      }
      return;
    }

    if (!audioUrl) {
      onGenerateAndPlay();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const skipBy = (deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const next = Math.min(
      audio.duration || duration || 0,
      Math.max(0, audio.currentTime + deltaSeconds)
    );
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    const audio = audioRef.current;
    if (audio && audioUrl) {
      audio.currentTime = next;
    }
    setCurrentTime(next);
  };

  const handleDownloadTranscript = () => {
    const cleanBase =
      documentFileName.replace(/\.[^/.]+$/, "") || "free_pdf_ai_summary";
    const blob = new Blob([transcriptDownloadText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cleanBase}_accessible_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const cleanWavName =
    (documentFileName.replace(/\.[^/.]+$/, "") || "free_pdf_ai_audio") +
    "_summary.wav";

  return (
    <div
      role="region"
      aria-label="Accessible Audio Summary Player"
      className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 transition-colors duration-150"
    >
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          setIsPlaying(false);
          onTrackEndedRef.current?.();
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {/* Top row: Track metadata & export actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mb-1">
            <Volume2
              className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">{voiceLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              {isBrowserSpeaking && !audioUrl
                ? "Instant Device Voice"
                : "24 kHz Studio WAV"}
            </span>
            {queuePositionLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-amber-300 whitespace-nowrap">
                  {queuePositionLabel}
                </span>
              </>
            )}
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-md">
            {activeLabel}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {audioUrl ? (
            <a
              href={audioUrl}
              download={cleanWavName}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download WAV
            </a>
          ) : (
            <button
              type="button"
              onClick={onGenerateAndPlay}
              disabled={isSynthesizing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {isSynthesizing ? (
                <>
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Synthesizing Voice...
                </>
              ) : (
                <>
                  <Play
                    className="w-3.5 h-3.5 fill-current"
                    aria-hidden="true"
                  />
                  Synthesize Audio
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadTranscript}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            Save Transcript
          </button>
        </div>
      </div>

      {/* Transport controls + Scrubber + Speed */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-1.5 shrink-0">
          {(canSkipPrevPart || canSkipNextPart) && onPrevPart && (
            <button
              type="button"
              onClick={onPrevPart}
              disabled={!canSkipPrevPart || isSynthesizing}
              aria-label="Previous reading section"
              title="Previous section"
              className="inline-flex items-center justify-center w-9 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors shrink-0"
            >
              <SkipBack className="w-4 h-4" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => skipBy(-15)}
            disabled={!audioUrl || isSynthesizing}
            aria-label="Rewind 15 seconds"
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={isSynthesizing}
            aria-label={
              isSynthesizing
                ? "Synthesizing natural voice audio"
                : isPlaying
                ? "Pause audio summary"
                : audioUrl || isBrowserSpeaking
                ? "Play audio summary"
                : "Generate and play audio summary"
            }
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-60 transition-colors shrink-0"
          >
            {isSynthesizing ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 fill-current" aria-hidden="true" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => skipBy(15)}
            disabled={!audioUrl || isSynthesizing}
            aria-label="Forward 15 seconds"
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
          </button>

          {(canSkipPrevPart || canSkipNextPart) && onNextPart && (
            <button
              type="button"
              onClick={onNextPart}
              disabled={!canSkipNextPart || isSynthesizing}
              aria-label="Next reading section"
              title="Next section"
              className="inline-flex items-center justify-center w-9 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors shrink-0"
            >
              <SkipForward className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Scrub bar & tabular timestamps */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300 shrink-0">
            {formatSeconds(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.1}
            value={audioUrl || isBrowserSpeaking ? currentTime : 0}
            disabled={!audioUrl}
            onChange={handleScrub}
            aria-label="Seek audio position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatSeconds(currentTime)} of ${formatSeconds(duration)}`}
            className="audio-scrubber w-full disabled:opacity-40"
          />
          <span className="font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300 shrink-0">
            {(audioUrl || isBrowserSpeaking) && duration > 0
              ? formatSeconds(duration)
              : "--:--"}
          </span>
        </div>

        {/* Playback Rate Segmented Control */}
        <div
          role="group"
          aria-label="Playback speed"
          className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg shrink-0"
        >
          {PLAYBACK_RATES.map((rate) => {
            const active = playbackRate === rate;
            return (
              <button
                key={rate}
                type="button"
                onClick={() => setPlaybackRate(rate)}
                aria-pressed={active}
                className={`px-2 py-1 text-xs font-mono tabular-nums rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                  active
                    ? "bg-white text-slate-900 dark:bg-slate-700 dark:text-white font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                {rate}x
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
