import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Mail,
  Printer,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_POLICIES,
  LEGAL_POLICY_ORDER,
} from "../data/legalPolicies";
import { CookiePreferences, LegalPolicyId } from "../types";

export const COOKIE_PREFS_STORAGE_KEY = "free-pdf-ai-cookie-preferences";
const THEME_STORAGE_KEY = "free-pdf-ai-theme";

interface LegalPoliciesViewProps {
  activePolicy: LegalPolicyId;
  onSelectPolicy: (policy: LegalPolicyId) => void;
  onBackToStudio: () => void;
  isDarkMode: boolean;
}

function loadStoredCookiePreferences(): CookiePreferences {
  if (typeof window === "undefined") {
    return {
      essential: true,
      functionalAccessibility: true,
      performanceDiagnostics: false,
      updatedAt: "October 28, 2026",
    };
  }
  try {
    const raw = window.localStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
      return {
        essential: true,
        functionalAccessibility:
          typeof parsed.functionalAccessibility === "boolean"
            ? parsed.functionalAccessibility
            : true,
        performanceDiagnostics:
          typeof parsed.performanceDiagnostics === "boolean"
            ? parsed.performanceDiagnostics
            : false,
        updatedAt:
          typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
            ? parsed.updatedAt
            : "October 28, 2026",
      };
    }
  } catch {
    // Fall back to privacy-preserving defaults if storage is restricted
  }
  return {
    essential: true,
    functionalAccessibility: true,
    performanceDiagnostics: false,
    updatedAt: "Default (Privacy-First)",
  };
}

export const LegalPoliciesView: React.FC<LegalPoliciesViewProps> = ({
  activePolicy,
  onSelectPolicy,
  onBackToStudio,
  isDarkMode,
}) => {
  const policy = LEGAL_POLICIES[activePolicy];
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const tabRefs = useRef<Record<LegalPolicyId, HTMLButtonElement | null>>({
    privacy: null,
    terms: null,
    cookies: null,
    refund: null,
  });

  const [liveStatus, setLiveStatus] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedRefundTemplate, setCopiedRefundTemplate] =
    useState<boolean>(false);

  const [cookiePrefs, setCookiePrefs] = useState<CookiePreferences>(() =>
    loadStoredCookiePreferences()
  );
  const [cookieSavedFeedback, setCookieSavedFeedback] =
    useState<boolean>(false);

  useEffect(() => {
    setCopiedLink(false);
    setCopiedRefundTemplate(false);
    setLiveStatus(`Viewing ${policy.title}.`);
  }, [activePolicy, policy.title]);

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % LEGAL_POLICY_ORDER.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + LEGAL_POLICY_ORDER.length) %
        LEGAL_POLICY_ORDER.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = LEGAL_POLICY_ORDER.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const targetId = LEGAL_POLICY_ORDER[nextIndex];
      onSelectPolicy(targetId);
      tabRefs.current[targetId]?.focus();
    }
  };

  const handleJumpToSection = (sectionId: string, sectionTitle: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus({ preventScroll: true });
      setLiveStatus(`Jumped to section: ${sectionTitle}`);
    }
  };

  const handleCopyPolicyLink = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}${policy.hash}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setLiveStatus(`Copied direct link to ${policy.title}.`);
      window.setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setLiveStatus("Unable to copy link automatically in this browser.");
    }
  };

  const handlePrintPolicy = () => {
    window.print();
  };

  const persistCookiePreferences = (
    nextPrefs: CookiePreferences,
    announcement: string
  ) => {
    setCookiePrefs(nextPrefs);
    try {
      window.localStorage.setItem(
        COOKIE_PREFS_STORAGE_KEY,
        JSON.stringify(nextPrefs)
      );
      if (!nextPrefs.functionalAccessibility) {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          THEME_STORAGE_KEY,
          isDarkMode ? "dark" : "light"
        );
      }
    } catch {
      // Ignore restricted iframe storage errors
    }
    setCookieSavedFeedback(true);
    setLiveStatus(announcement);
    window.setTimeout(() => setCookieSavedFeedback(false), 3000);
  };

  const handleSaveCookieChoices = () => {
    const timestamp = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    persistCookiePreferences(
      {
        ...cookiePrefs,
        essential: true,
        updatedAt: timestamp,
      },
      "Cookie and local storage preferences saved."
    );
  };

  const handleEssentialOnlyCookies = () => {
    const timestamp = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    persistCookiePreferences(
      {
        essential: true,
        functionalAccessibility: false,
        performanceDiagnostics: false,
        updatedAt: timestamp,
      },
      "Strict essential-only storage enabled. Optional local storage keys cleared."
    );
  };

  const handleCopyRefundEmailTemplate = async () => {
    const template = [
      `To: ${LEGAL_CONTACT_EMAIL}`,
      "Subject: Refund Request — Free PDF AI",
      "",
      "Hello Free PDF AI Billing Support,",
      "",
      "I would like to request a refund under your Refund Policy.",
      "- Checkout / Account Email: [Enter your email]",
      "- Purchase Date: [Enter date]",
      "- Transaction / Receipt ID: [Enter ID if available]",
      "- Reason: [14-day satisfaction window / Accidental renewal / Duplicate charge / Technical issue]",
      "",
      "Thank you.",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(template);
      setCopiedRefundTemplate(true);
      setLiveStatus("Copied refund request email template to clipboard.");
      window.setTimeout(() => setCopiedRefundTemplate(false), 2800);
    } catch {
      setLiveStatus("Could not copy template automatically.");
    }
  };

  return (
    <section
      aria-labelledby="legal-policy-heading"
      className="bg-[#FAFAFA] dark:bg-[#0B1120] transition-colors duration-150"
    >
      {/* Screen-reader live region */}
      <div className="sr-only" role="status" aria-live="polite">
        {liveStatus}
      </div>

      {/* Top Legal Header & Interactive Policy Tab Switcher */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] transition-colors duration-150">
        <div className="max-w-[1280px] mx-auto px-6 py-8 lg:py-12">
          {/* Action Row: Back to Studio + Utility Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8 print:hidden">
            <button
              type="button"
              onClick={onBackToStudio}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Back to PDF Voice Studio</span>
            </button>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyPolicyLink}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                {copiedLink ? (
                  <>
                    <Check
                      className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span>Direct Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Copy Direct Link</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handlePrintPolicy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Printer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Print / Save PDF</span>
              </button>
            </div>
          </div>

          {/* Interactive 4-Policy Tab Switcher */}
          <div
            role="tablist"
            aria-label="Legal and compliance policies"
            className="flex items-center gap-2 overflow-x-auto pb-2 mb-8 border-b border-slate-200 dark:border-slate-800 print:hidden"
          >
            {LEGAL_POLICY_ORDER.map((policyId, idx) => {
              const item = LEGAL_POLICIES[policyId];
              const isSelected = activePolicy === policyId;
              return (
                <button
                  key={policyId}
                  ref={(el) => {
                    tabRefs.current[policyId] = el;
                  }}
                  id={`legal-tab-${policyId}`}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  aria-controls={`legal-panel-${policyId}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelectPolicy(policyId)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  className={`px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px] ${
                    isSelected
                      ? "bg-blue-700 text-white dark:bg-blue-600 dark:text-white"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800"
                  }`}
                >
                  {item.shortLabel}
                </button>
              );
            })}
          </div>

          {/* Unboxed Clean Editorial Metadata Line */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mb-3 font-mono tabular-nums">
            <span>Effective Date: {policy.effectiveDate}</span>
            <span aria-hidden="true">·</span>
            <span>Last Updated: {policy.lastUpdated}</span>
            <span aria-hidden="true">·</span>
            <span>Version {policy.version}</span>
            <span aria-hidden="true">·</span>
            <span>{policy.readingTime}</span>
          </div>

          <h1
            id="legal-policy-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-[clamp(1.875rem,3.4vw,3rem)] font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-[1.12] text-balance mb-4 outline-none"
          >
            {policy.title}
          </h1>

          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
            {policy.subtitle}
          </p>
        </div>
      </div>

      {/* Main 2-Column Editorial Policy Content */}
      <div
        id={`legal-panel-${activePolicy}`}
        role="tabpanel"
        aria-labelledby={`legal-tab-${activePolicy}`}
        className="max-w-[1280px] mx-auto px-6 py-12 lg:py-16"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Left Sticky Table of Contents & Contact Column */}
          <aside
            aria-label="Policy table of contents and legal contact"
            className="lg:col-span-4 lg:sticky lg:top-24 space-y-6 print:hidden"
          >
            <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3.5">
                On This Page
              </h2>
              <nav aria-label={`${policy.title} sections`}>
                <ol className="space-y-1">
                  {policy.sections.map((sec) => (
                    <li key={sec.id}>
                      <button
                        type="button"
                        onClick={() => handleJumpToSection(sec.id, sec.title)}
                        className="w-full text-left px-2.5 py-2 rounded-md text-xs sm:text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/80 transition-colors flex items-baseline gap-2.5"
                      >
                        <span className="font-mono tabular-nums text-xs font-semibold text-blue-700 dark:text-amber-300 shrink-0">
                          {sec.number}.
                        </span>
                        <span className="leading-snug">{sec.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>

            <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                Legal, Privacy &amp; Billing Support
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                Need an accessible format, GDPR/CCPA data inquiry, or 14-day
                refund assistance? Reach our team directly.
              </p>
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(
                  `${policy.title} Inquiry — Free PDF AI`
                )}`}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-blue-700 dark:text-amber-300 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors break-all min-h-[40px]"
              >
                <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{LEGAL_CONTACT_EMAIL}</span>
              </a>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 font-mono tabular-nums">
                Response time: 24–48 business hours
              </p>
            </div>
          </aside>

          {/* Right Main Clauses Column */}
          <div className="lg:col-span-8 space-y-10">
            {/* Plain-Language Summary Card (All-around hairline border, NO border-l-4) */}
            <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7">
              <div className="flex items-center gap-2.5 mb-3">
                <ShieldCheck
                  className="w-5 h-5 text-blue-700 dark:text-amber-300 shrink-0"
                  aria-hidden="true"
                />
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  Plain-Language Summary
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Designed for quick cognitive scanning before reading the full
                legal clauses below:
              </p>
              <ul className="space-y-2.5 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {policy.plainLanguageSummary.map((point, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <span
                      className="font-mono tabular-nums text-xs font-bold text-blue-700 dark:text-amber-300 mt-0.5 shrink-0"
                      aria-hidden="true"
                    >
                      0{index + 1}
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Interactive Cookie & Storage Preferences Manager (Cookie Policy tab only) */}
            {activePolicy === "cookies" && (
              <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7 print:hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                    Interactive Cookie &amp; Local Storage Controls
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    Saved state: {cookiePrefs.updatedAt}
                  </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                  Customize which browser storage categories Free PDF AI may store
                  on this device. Changes apply immediately and are saved locally.
                </p>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-b border-slate-200 dark:border-slate-800">
                  {/* Row 1: Essential */}
                  <div className="py-4 flex items-start justify-between gap-6">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Essential Session &amp; Audio Memory
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        Required for active PDF page parsing, temporary 24 kHz WAV
                        playback blobs, and remembering your privacy choices on
                        this page.
                      </p>
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 pt-0.5">
                      Always Active
                    </span>
                  </div>

                  {/* Row 2: Functional Accessibility */}
                  <div className="py-4 flex items-start justify-between gap-6">
                    <div>
                      <label
                        htmlFor="toggle-functional-storage"
                        className="text-sm font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                      >
                        Functional Accessibility Preferences (
                        <code className="font-mono text-xs">
                          free-pdf-ai-theme
                        </code>
                        )
                      </label>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        Remembers your chosen Light Mode or high-contrast Dark Mode
                        theme across browser restarts.
                      </p>
                    </div>
                    <button
                      id="toggle-functional-storage"
                      type="button"
                      role="switch"
                      aria-checked={cookiePrefs.functionalAccessibility}
                      onClick={() =>
                        setCookiePrefs((prev) => ({
                          ...prev,
                          functionalAccessibility: !prev.functionalAccessibility,
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ${
                        cookiePrefs.functionalAccessibility
                          ? "bg-blue-700 dark:bg-blue-500"
                          : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span className="sr-only">
                        Enable functional accessibility local storage
                      </span>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-150 ${
                          cookiePrefs.functionalAccessibility
                            ? "translate-x-5"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Row 3: Performance Diagnostics */}
                  <div className="py-4 flex items-start justify-between gap-6">
                    <div>
                      <label
                        htmlFor="toggle-diagnostics-storage"
                        className="text-sm font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                      >
                        Anonymous OCR &amp; Audio Buffer Diagnostics
                      </label>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        Optional session-only timing metrics to detect stalled PDF
                        page scans or TTS synthesis timeouts. Never includes
                        document text.
                      </p>
                    </div>
                    <button
                      id="toggle-diagnostics-storage"
                      type="button"
                      role="switch"
                      aria-checked={cookiePrefs.performanceDiagnostics}
                      onClick={() =>
                        setCookiePrefs((prev) => ({
                          ...prev,
                          performanceDiagnostics: !prev.performanceDiagnostics,
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ${
                        cookiePrefs.performanceDiagnostics
                          ? "bg-blue-700 dark:bg-blue-500"
                          : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span className="sr-only">
                        Enable anonymous OCR and audio buffer diagnostics
                      </span>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-150 ${
                          cookiePrefs.performanceDiagnostics
                            ? "translate-x-5"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleSaveCookieChoices}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Save Storage Preferences</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleEssentialOnlyCookies}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                    >
                      <RotateCcw
                        className="w-3.5 h-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Use Essential Only</span>
                    </button>
                  </div>

                  {cookieSavedFeedback && (
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      Preferences updated on this browser.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Quick Refund Request Helper (Refund Policy tab only) */}
            {activePolicy === "refund" && (
              <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7 print:hidden">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
                  Quick Refund &amp; Cancellation Request Helper
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
                  Need to submit a 14-day satisfaction refund, cancel an upcoming
                  renewal, or report a duplicate charge? Open a pre-addressed
                  email or copy our structured refund template below.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(
                      "Refund Request — Free PDF AI"
                    )}&body=${encodeURIComponent(
                      "Hello Free PDF AI Billing Support,\n\nI would like to request a refund under your Refund Policy.\n- Checkout Email: \n- Purchase Date: \n- Transaction / Receipt ID: \n- Reason: \n\nThank you."
                    )}`}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Email Billing Support</span>
                  </a>

                  <button
                    type="button"
                    onClick={handleCopyRefundEmailTemplate}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    {copiedRefundTemplate ? (
                      <>
                        <Check
                          className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Refund Template Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Copy Refund Template</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Numbered Policy Clauses */}
            <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
              {policy.sections.map((section) => (
                <article
                  key={section.id}
                  id={section.id}
                  tabIndex={-1}
                  className="p-6 sm:p-8 scroll-mt-24 outline-none"
                >
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-50 mb-4 flex items-baseline gap-2.5">
                    <span className="font-mono tabular-nums text-sm sm:text-base font-bold text-blue-700 dark:text-amber-300 shrink-0">
                      {section.number}.
                    </span>
                    <span>{section.title}</span>
                  </h2>

                  <div className="space-y-4 text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed">
                    {section.paragraphs.map((paragraph, pIdx) => (
                      <p key={pIdx}>{paragraph}</p>
                    ))}

                    {section.bullets && section.bullets.length > 0 && (
                      <ul className="list-disc pl-5 space-y-2.5 pt-1 text-slate-700 dark:text-slate-300">
                        {section.bullets.map((bullet, bIdx) => (
                          <li key={bIdx} className="leading-relaxed">
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    )}

                    {section.table && (
                      <div className="pt-3 overflow-x-auto">
                        <table className="w-full text-left border-collapse border border-slate-200 dark:border-slate-800 text-xs sm:text-sm">
                          <caption className="sr-only">
                            {section.table.caption}
                          </caption>
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
                              {section.table.headers.map((header, hIdx) => (
                                <th
                                  key={hIdx}
                                  scope="col"
                                  className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 tabular-nums">
                            {section.table.rows.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={`px-4 py-3.5 align-top leading-relaxed ${
                                      cIdx === 0
                                        ? "font-semibold text-slate-900 dark:text-slate-100"
                                        : "text-slate-600 dark:text-slate-300"
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {/* Bottom Cross-Policy Navigation Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 print:hidden">
              <button
                type="button"
                onClick={onBackToStudio}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 dark:text-slate-100 dark:bg-[#0F172A] dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Return to PDF Voice Studio</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {LEGAL_POLICY_ORDER.filter((id) => id !== activePolicy).map(
                  (id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectPolicy(id)}
                      className="px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:text-amber-300 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                    >
                      {LEGAL_POLICIES[id].shortLabel}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
