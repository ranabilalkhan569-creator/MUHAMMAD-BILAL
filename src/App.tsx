/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import {
  FileUp,
  Loader2,
  Mic,
  Moon,
  Play,
  Square,
  Sun,
  Volume2,
} from "lucide-react";
import regeneratedHeroImg from "./assets/images/regenerated_image_1793125336321.jpg";
import bentoAudioCraftImg from "./assets/images/bento_audio_craft_1792947693088.jpg";
import avatarLeadImg from "./assets/images/avatar_accessibility_lead_1792947693194.jpg";
import {
  COOKIE_PREFS_STORAGE_KEY,
  LegalPoliciesView,
} from "./components/LegalPoliciesView";
import { ResilientImage } from "./components/ResilientImage";
import { StudioWorkspace } from "./components/StudioWorkspace";
import {
  LEGAL_POLICIES,
  LEGAL_POLICY_ORDER,
  parsePolicyFromHash,
} from "./data/legalPolicies";
import { VOICE_PERSONAS } from "./data/sampleDocuments";
import { LegalPolicyId, VoicePersona, VoicePersonaId } from "./types";

const THEME_STORAGE_KEY = "free-pdf-ai-theme";

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "dark") return true;
      if (saved === "light") return false;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return document.documentElement.classList.contains("dark");
    }
  });
  const [themeAnnouncement, setThemeAnnouncement] = useState<string>("");

  const [auditioningVoice, setAuditioningVoice] = useState<VoicePersonaId | null>(null);
  const [loadingVoiceSample, setLoadingVoiceSample] = useState<VoicePersonaId | null>(null);
  const [selectedStudioVoice, setSelectedStudioVoice] = useState<VoicePersonaId | null>(null);
  const [voiceChatLaunchCount, setVoiceChatLaunchCount] = useState<number>(0);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [activePolicy, setActivePolicy] = useState<LegalPolicyId | null>(() => {
    if (typeof window === "undefined") return null;
    return parsePolicyFromHash(window.location.hash);
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      const matchedPolicy = parsePolicyFromHash(window.location.hash);
      setActivePolicy(matchedPolicy);
      if (matchedPolicy) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = (event: MediaQueryListEvent) => {
      try {
        const explicitSaved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (!explicitSaved) {
          setIsDarkMode(event.matches);
        }
      } catch {
        setIsDarkMode(event.matches);
      }
    };
    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, []);

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      try {
        const rawPrefs = window.localStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
        const allowFunctional = rawPrefs
          ? (JSON.parse(rawPrefs) as { functionalAccessibility?: boolean })
              .functionalAccessibility !== false
          : true;
        if (allowFunctional) {
          window.localStorage.setItem(
            THEME_STORAGE_KEY,
            next ? "dark" : "light"
          );
        }
      } catch {
        // Ignore storage write errors in restricted contexts
      }
      setThemeAnnouncement(
        next
          ? "Dark mode theme enabled with high-contrast focus indicators."
          : "Light mode theme enabled."
      );
      return next;
    });
  };

  const handleOpenPolicy = (
    policyId: LegalPolicyId,
    event?: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (event) {
      event.preventDefault();
    }
    const targetHash = LEGAL_POLICIES[policyId].hash;
    setActivePolicy(policyId);
    try {
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, "", targetHash);
      }
    } catch {
      // Ignore history errors in sandboxed frames
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navigateToHomeSection = (
    sectionId: string,
    event?: React.MouseEvent<HTMLAnchorElement>
  ) => {
    if (activePolicy) {
      if (event) {
        event.preventDefault();
      }
      setActivePolicy(null);
      try {
        const hashValue = sectionId === "top" ? "" : `#${sectionId}`;
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${hashValue}`
        );
      } catch {
        // Ignore history errors in sandboxed frames
      }
      window.requestAnimationFrame(() => {
        if (sectionId === "top") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          document
            .getElementById(sectionId)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  };

  const triggerUploadInStudio = () => {
    if (activePolicy) {
      setActivePolicy(null);
      try {
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${window.location.search}#studio`
        );
      } catch {
        // Ignore history errors
      }
    }
    window.requestAnimationFrame(() => {
      const studioSection = document.getElementById("studio");
      if (studioSection) {
        studioSection.scrollIntoView({ behavior: "smooth" });
      }
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 250);
    });
  };

  const triggerLiveVoiceInStudio = () => {
    setVoiceChatLaunchCount((c) => c + 1);
    if (activePolicy) {
      setActivePolicy(null);
    }
    window.requestAnimationFrame(() => {
      const studioSection = document.getElementById("studio");
      if (studioSection) {
        studioSection.scrollIntoView({ behavior: "smooth" });
      }
    });
  };

  const handleAuditionVoice = async (persona: VoicePersona) => {
    if (auditioningVoice === persona.id && voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
      setAuditioningVoice(null);
      return;
    }

    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
      setAuditioningVoice(null);
    }

    setLoadingVoiceSample(persona.id);
    setVoicePreviewError(null);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: persona.sampleLine,
          voiceName: persona.id,
          voiceStyle: persona.stylePrompt,
          mode: "single",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.audioBase64) {
        throw new Error(data.error || "Could not synthesize voice audition.");
      }

      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      voicePreviewAudioRef.current = audio;
      setAuditioningVoice(persona.id);
      audio.onended = () => {
        setAuditioningVoice(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (err) {
      setVoicePreviewError(
        err instanceof Error ? err.message : "Unable to play voice sample."
      );
    } finally {
      setLoadingVoiceSample(null);
    }
  };

  const handleUseVoiceInStudio = (voiceId: VoicePersonaId) => {
    setSelectedStudioVoice(voiceId);
    const studioSection = document.getElementById("studio");
    if (studioSection) {
      studioSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div
      id="top"
      className="min-h-screen flex flex-col bg-[#FAFAFA] text-slate-900 dark:bg-[#0B1120] dark:text-slate-100 transition-colors duration-150"
    >
      {/* Screen-reader live region for global theme announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {themeAnnouncement}
      </div>

      {/* Skip-to-content keyboard accessibility link */}
      <a
        href={activePolicy ? "#legal-policy-heading" : "#studio"}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white dark:focus:bg-amber-400 dark:focus:text-slate-950 focus:rounded-lg focus:text-sm focus:font-semibold print:hidden"
      >
        {activePolicy
          ? `Skip directly to ${LEGAL_POLICIES[activePolicy].title}`
          : "Skip directly to PDF Voice Studio"}
      </a>

      {/* Accessible Top Navigation Bar with Global Dark Mode Toggle */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0F172A]/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 transition-colors duration-150 print:hidden">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Brand wordmark & tagline */}
          <a
            href="#top"
            onClick={(e) => navigateToHomeSection("top", e)}
            className="flex flex-col justify-center whitespace-nowrap shrink-0 rounded-md"
          >
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
              Free PDF AI
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
              Read PDFs. Listen with AI. Ask Anything.
            </span>
          </a>

          {/* Zone 2: 4 clean single-line navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            <a
              href="#studio"
              onClick={(e) => navigateToHomeSection("studio", e)}
              className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded-sm"
            >
              Studio
            </a>
            <a
              href="#capabilities"
              onClick={(e) => navigateToHomeSection("capabilities", e)}
              className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded-sm"
            >
              Capabilities
            </a>
            <a
              href="#voices"
              onClick={(e) => navigateToHomeSection("voices", e)}
              className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded-sm"
            >
              Voices
            </a>
            <a
              href="#impact"
              onClick={(e) => navigateToHomeSection("impact", e)}
              className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded-sm"
            >
              Impact
            </a>
          </nav>

          {/* Zone 3: Theme Toggle + Primary CTA Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleDarkMode}
              aria-pressed={isDarkMode}
              aria-label={
                isDarkMode
                  ? "Switch to light mode theme"
                  : "Switch to dark mode theme"
              }
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-300 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700 shrink-0" aria-hidden="true" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={triggerUploadInStudio}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              Upload PDF
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {activePolicy && (
          <LegalPoliciesView
            activePolicy={activePolicy}
            onSelectPolicy={(policyId) => handleOpenPolicy(policyId)}
            onBackToStudio={() => navigateToHomeSection("studio")}
            isDarkMode={isDarkMode}
          />
        )}

        <div
          className={activePolicy ? "hidden" : undefined}
          aria-hidden={activePolicy ? "true" : undefined}
        >
        {/* SECTION 1: EDITORIAL HERO */}
        <section className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] transition-colors duration-150">
          <div className="max-w-[1280px] mx-auto px-6 py-14 lg:py-20">
            <div className="grid grid-cols-1 min-[560px]:grid-cols-12 gap-8 lg:gap-12 items-center">
              <div className="min-[560px]:col-span-6 flex flex-col justify-center">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mb-4">
                  <span className="whitespace-nowrap">WCAG 2.2 AA Accessible</span>
                  <span aria-hidden="true">·</span>
                  <span className="whitespace-nowrap">Live Bidirectional Voice Chat</span>
                  <span aria-hidden="true">·</span>
                  <span className="whitespace-nowrap">24 kHz Natural Speech</span>
                </div>

                <h1 className="text-[clamp(2rem,3.8vw,3.5rem)] font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-[1.1] text-balance mb-5">
                  Read PDFs. Listen with AI. Ask Anything.
                </h1>

                <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl mb-8">
                  Built for blind, low-vision, dyslexic, and print-fatigued readers. Free PDF AI converts multi-column documents, clinical forms, and data tables into calm human-cadence narration—and lets you talk hands-free with your PDF and search Google in real time.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={triggerUploadInStudio}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <FileUp className="w-4 h-4" aria-hidden="true" />
                    Convert a PDF Document
                  </button>

                  <button
                    type="button"
                    onClick={triggerLiveVoiceInStudio}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-transparent dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <Mic className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    Start Live Voice Chat
                  </button>
                </div>
              </div>

              <div className="min-[560px]:col-span-6 flex items-center">
                <div className="w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <ResilientImage
                    src={regeneratedHeroImg}
                    alt="Students wearing headphones in a sunlit library reading books with an AI voice assistant"
                    className="w-full h-auto block"
                    fallbackLabel="Free PDF Reader — Read Books with AI Voice"
                  />
                </div>
              </div>
            </div>

            {/* Full-width Quantitative Accessibility Outcomes Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 mt-12 border-t border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
                  3.4x faster
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Literature triage speed on multi-column research PDFs vs. linear OCR readers
                </p>
              </div>
              <div>
                <div className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
                  -50.4% fatigue
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Reduction in NASA-TLX cognitive and visual strain during 8-week graduate study
                </p>
              </div>
              <div>
                <div className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
                  7 languages
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Instant plain-language adaptation and culturally natural spoken audio export
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: INTERACTIVE PDF VOICE STUDIO + LIVE VOICE CHAT */}
        <StudioWorkspace
          fileInputRef={fileInputRef}
          externalVoiceSelection={selectedStudioVoice}
          externalVoiceChatLaunch={voiceChatLaunchCount}
          isDarkMode={isDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
        />

        {/* SECTION 3: ASYMMETRIC CAPABILITIES BENTO GRID */}
        <section
          id="capabilities"
          aria-labelledby="capabilities-heading"
          className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] py-16 lg:py-20 transition-colors duration-150"
        >
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="max-w-2xl mb-12">
              <h2
                id="capabilities-heading"
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance"
              >
                Designed around how the human ear processes complex documents.
              </h2>
              <p className="text-base text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                Standard screen readers read running page headers, raw URLs, and unformatted table coordinates verbatim. Free PDF AI restructures every PDF for effortless auditory comprehension.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Marquee Col-Span-2 Card */}
              <div className="lg:col-span-2 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-[#FAFAFA] dark:bg-[#0B1120] grid grid-cols-1 md:grid-cols-12">
                <div className="md:col-span-7 p-7 flex flex-col justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
                      01. Multimodal Layout &amp; Visual Figure Narration
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                      Instead of skipping embedded bar charts, medical diagrams, or multi-column financial tables, Free PDF AI inspects every page visually and composes clear spoken walkthroughs of trends, rows, and callout boxes.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <span>Multi-column PDFs</span>
                    <span aria-hidden="true">·</span>
                    <span>Scanned Notices</span>
                    <span aria-hidden="true">·</span>
                    <span>Spoken Chart Alt-Text</span>
                  </div>
                </div>
                <div className="md:col-span-5 min-h-[220px] bg-slate-100 dark:bg-slate-900">
                  <ResilientImage
                    src={bentoAudioCraftImg}
                    alt="Precision brushed-aluminum headphones resting beside an open printed research paper with acoustic charts on a warm travertine desk"
                    className="w-full h-full object-cover"
                    fallbackLabel="Studio-grade acoustic synthesis from printed charts"
                  />
                </div>
              </div>

              {/* Card 02 */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-7 bg-[#FAFAFA] dark:bg-[#0B1120] flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
                    02. Plain-Language Cognitive Mode
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Convert dense legal clauses, municipal policies, or clinical consent forms into sixth-grade plain language with short active sentences and inline definitions for dyslexic and print-fatigued readers.
                  </p>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
                  Grade 6 readability · Jargon-free active prose
                </div>
              </div>

              {/* Card 03 */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-7 bg-[#FAFAFA] dark:bg-[#0B1120] flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
                    03. Two-Host Conversational Briefs
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Switch any document into a natural two-speaker dialogue between Alex and Sam. Conversational turn-taking prevents listener drift during long study sessions and boosts seven-day recall.
                  </p>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
                  Dual-voice synthesis · Downloadable 24 kHz WAV
                </div>
              </div>

              {/* Card 04 (Col-Span-2) */}
              <div className="lg:col-span-2 border border-slate-200 dark:border-slate-800 rounded-xl p-7 bg-[#FAFAFA] dark:bg-[#0B1120] flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
                    04. Hands-Free Live Voice Chat &amp; Spoken Captions
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                    Converse naturally with your uploaded PDF in real time. Speak questions aloud, interrupt anytime to ask follow-ups, or use push-to-speak microphone dictation with live input and output captions.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
                  <span>Real-time Gemini Live audio</span>
                  <span aria-hidden="true">·</span>
                  <span>Barge-in interruption</span>
                  <span aria-hidden="true">·</span>
                  <span>Live streaming captions</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: NATURAL VOICE PERSONA GALLERY */}
        <section
          id="voices"
          aria-labelledby="voices-heading"
          className="border-t border-slate-200 dark:border-slate-800 bg-[#FAFAFA] dark:bg-[#0B1120] py-16 lg:py-20 transition-colors duration-150"
        >
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="grid grid-cols-1 min-[560px]:grid-cols-12 gap-6 lg:gap-10 items-center mb-10">
              <div className="min-[560px]:col-span-7 max-w-xl">
                <h2
                  id="voices-heading"
                  className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance"
                >
                  Audition natural studio voices built for extended listening.
                </h2>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                  Preview each voice persona live via Gemini Text-to-Speech, then apply your preferred narrator to both summaries and Live Voice Chat.
                </p>
              </div>

              <div className="min-[560px]:col-span-5 flex items-center min-[560px]:justify-end">
                <div className="w-full max-w-[380px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <ResilientImage
                    src="/assets/aistudio/images__14__e7f59be3.jpg"
                    alt="Speaker wearing studio headphones beside a broadcast microphone in an acoustic recording room"
                    className="w-full h-auto block object-cover"
                    fallbackLabel="Natural studio voice recording session"
                  />
                </div>
              </div>
            </div>

            {voicePreviewError && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 px-4 py-3 text-xs"
              >
                {voicePreviewError}
              </div>
            )}

            <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
              {VOICE_PERSONAS.map((persona) => {
                const isPlaying = auditioningVoice === persona.id;
                const isLoading = loadingVoiceSample === persona.id;

                return (
                  <div
                    key={persona.id}
                    className="p-5 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="min-w-0 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                          {persona.name}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">
                          {persona.timbre}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                        Recommended for: {persona.bestFor}
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                        &ldquo;{persona.sampleLine}&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAuditionVoice(persona)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            Synthesizing...
                          </>
                        ) : isPlaying ? (
                          <>
                            <Square className="w-3 h-3 fill-current text-blue-700 dark:text-amber-300" aria-hidden="true" />
                            Stop Sample
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current text-blue-700 dark:text-blue-400" aria-hidden="true" />
                            Audition Voice
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleUseVoiceInStudio(persona.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 dark:text-amber-300 dark:border-slate-700 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                      >
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Select in Studio
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 5: PROOF OF ACCESSIBILITY IMPACT */}
        <section
          id="impact"
          aria-labelledby="impact-heading"
          className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] py-16 lg:py-20 transition-colors duration-150"
        >
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-4">
                <div className="w-fit rounded-none overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                  <ResilientImage
                    src={avatarLeadImg}
                    alt="Studio portrait of Dr. Elena Rostova, Director of Inclusive Media Research"
                    className="w-[241px] h-[353px] rounded-none object-cover"
                    fallbackLabel="Dr. Elena Rostova, Inclusive Media Research"
                  />
                </div>
              </div>

              <div className="lg:col-span-8">
                <h2 id="impact-heading" className="sr-only">
                  Researcher Impact Testimonial
                </h2>
                <blockquote className="text-xl sm:text-2xl font-medium text-slate-900 dark:text-slate-100 leading-relaxed text-balance mb-6">
                  &ldquo;Before Free PDF AI, our low-vision and dyslexic doctoral fellows spent hours battling broken PDF column order and silent data charts. Switching to prosodic chaptered audio summaries and spoken figure descriptions cut weekly reading fatigue in half and lifted seven-day seminar recall from 54% to 83%.&rdquo;
                </blockquote>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-8">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Dr. Rana Rajput
                  </span>
                </div>

                <button
                  type="button"
                  onClick={triggerUploadInStudio}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                >
                  <FileUp className="w-4 h-4" aria-hidden="true" />
                  Upload Your First PDF
                </button>
              </div>
            </div>
          </div>
        </section>
        </div>
      </main>

      {/* QUIET ACCESSIBLE FOOTER */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-[#FAFAFA] dark:bg-[#0B1120] py-10 transition-colors duration-150 print:hidden">
        <div className="max-w-[1280px] mx-auto px-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Free PDF AI
              </span>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                Read PDFs. Listen with AI. Ask Anything.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Keyboard shortcuts when outside text inputs: Space to Play/Pause · J to Rewind 15s · L to Advance 15s
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-400">
              <a
                href="#studio"
                onClick={(e) => navigateToHomeSection("studio", e)}
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap rounded-sm"
              >
                Voice Studio
              </a>
              <a
                href="#capabilities"
                onClick={(e) => navigateToHomeSection("capabilities", e)}
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap rounded-sm"
              >
                Capabilities
              </a>
              <a
                href="#voices"
                onClick={(e) => navigateToHomeSection("voices", e)}
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap rounded-sm"
              >
                Voice Personas
              </a>
              <a
                href="#impact"
                onClick={(e) => navigateToHomeSection("impact", e)}
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap rounded-sm"
              >
                Accessibility Impact
              </a>
              <button
                type="button"
                onClick={handleToggleDarkMode}
                aria-pressed={isDarkMode}
                className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 dark:text-amber-300 dark:hover:text-amber-200 font-semibold transition-colors whitespace-nowrap rounded-sm"
              >
                {isDarkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                    Switch to Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                    Switch to Dark Mode
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dedicated Legal Policies & Copyright Strip */}
          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
              &copy; {new Date().getFullYear()} Free PDF AI. All rights reserved.
            </span>

            <nav
              aria-label="Legal and compliance policies"
              className="flex flex-wrap items-center gap-x-6 gap-y-2 font-medium text-slate-600 dark:text-slate-300"
            >
              {LEGAL_POLICY_ORDER.map((policyId) => {
                const policyDoc = LEGAL_POLICIES[policyId];
                const isCurrent = activePolicy === policyId;
                return (
                  <a
                    key={policyId}
                    href={policyDoc.hash}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={(e) => handleOpenPolicy(policyId, e)}
                    className={`transition-colors whitespace-nowrap rounded-sm hover:underline underline-offset-4 ${
                      isCurrent
                        ? "font-bold text-blue-700 dark:text-amber-300"
                        : "hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {policyDoc.id === "terms"
                      ? "Terms and Conditions"
                      : policyDoc.shortLabel}
                  </a>
                );
              })}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
