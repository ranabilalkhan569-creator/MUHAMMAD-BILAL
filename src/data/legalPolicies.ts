import { LegalPolicyId } from "../types";

export interface PolicyTableData {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface PolicySection {
  id: string;
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  table?: PolicyTableData;
}

export interface LegalPolicyDocument {
  id: LegalPolicyId;
  hash: string;
  shortLabel: string;
  title: string;
  subtitle: string;
  effectiveDate: string;
  lastUpdated: string;
  version: string;
  readingTime: string;
  plainLanguageSummary: string[];
  sections: PolicySection[];
}

export const LEGAL_CONTACT_EMAIL = "ranabilalkhan569@gmail.com";

export const LEGAL_POLICIES: Record<LegalPolicyId, LegalPolicyDocument> = {
  privacy: {
    id: "privacy",
    hash: "#privacy-policy",
    shortLabel: "Privacy Policy",
    title: "Privacy Policy",
    subtitle:
      "How Free PDF AI processes uploaded documents, optical character recognition (OCR), synthesized speech, and live voice conversations while protecting reader privacy.",
    effectiveDate: "October 28, 2026",
    lastUpdated: "October 28, 2026",
    version: "2.4",
    readingTime: "6 min read",
    plainLanguageSummary: [
      "Your uploaded PDFs, scanned images (JPG/PNG/WebP), PDF forms, Office files, and WhatsApp chat exports are processed strictly to extract text, describe visual charts, answer your questions, and read aloud to you.",
      "We do not sell your personal information, rent your contact details, or use your private documents to train public advertising profiles.",
      "Microphone audio during Live Voice Chat streams over encrypted connections only while you actively turn the microphone on, and stops immediately when you end or mute the session.",
      "You can clear locally cached reading preferences and uploaded workspace items from your browser at any time, or request data assistance directly via email.",
    ],
    sections: [
      {
        id: "privacy-scope",
        number: "01",
        title: "Scope & Commitment to Accessible Privacy",
        paragraphs: [
          "Free PDF AI (\"we,\" \"our,\" or \"us\") provides assistive document reading, multimodal figure description, optical character recognition (OCR), 24 kHz natural speech synthesis, and hands-free live voice interaction designed for blind, low-vision, dyslexic, and print-fatigued readers.",
          "Because readers frequently use Free PDF AI to read academic papers, clinical forms, municipal notices, financial statements, and personal correspondence, we engineer our architecture around data minimization, browser-first text extraction where supported, and ephemeral server-side session memory.",
        ],
      },
      {
        id: "privacy-data-collected",
        number: "02",
        title: "Information We Collect & Process",
        paragraphs: [
          "We only collect or process the minimum data necessary to deliver document narration, full-page OCR extraction, interactive Q&A, and billing or support communications when requested by you:",
        ],
        bullets: [
          "Uploaded Document Content: Files you select or drop into the studio—including PDFs, PDF forms (.xfdf, .fdf, .epub), images and handwritten notes (.jpg, .png, .webp, .bmp, .gif, .avif), and Office or WhatsApp exports (.docx, .doc, .rtf, .odt, .pptx, .xlsx, .csv, .txt, .zip)—up to 5 GB per file.",
          "Live Voice & Microphone Input: Real-time spoken audio captured only when you explicitly grant browser microphone permission and start a Live Voice Chat or push-to-speak dictation session.",
          "Document Questions & Search Queries: Text or spoken prompts you ask about an active document, including optional real-time web research queries when Google Search grounding is invoked.",
          "Accessibility & Interface Preferences: Local device settings such as Light/Dark high-contrast theme, typography scale, relaxed line spacing, playback speed, and preferred studio narrator persona.",
          "Support & Billing Correspondence: Your name, email address, transaction reference, and message content if you contact us regarding technical support, accessibility accommodations, or a billing refund.",
        ],
      },
      {
        id: "privacy-processing",
        number: "03",
        title: "How Document Extraction, OCR & AI Narration Work",
        paragraphs: [
          "When you open a document in Free PDF AI, initial structural parsing is performed directly inside your web browser whenever possible (using client-side PDF, archive, and document parsers). When full-page multimodal analysis, scanned-page Vision OCR, executive or plain-language adaptation, 24 kHz WAV speech generation, or interactive Q&A is requested, relevant page text or page snapshots are transmitted over HTTPS/TLS to our application server.",
          "Our backend uses the Google Gemini API and isolated server-side OCR workers (Tesseract) strictly to generate your requested verbatim transcripts, chapter summaries, visual chart descriptions, spoken audio streams, and grounded answers. Uploaded documents are never published publicly or shared with other users.",
        ],
      },
      {
        id: "privacy-retention",
        number: "04",
        title: "Data Retention & Ephemeral Memory Schedule",
        paragraphs: [
          "Free PDF AI avoids permanent cloud storage of your reading files by default. Active session context is held only in volatile memory so follow-up questions and chapter playback respond without re-uploading.",
        ],
        table: {
          caption: "Document, Audio, and Preference Retention Periods",
          headers: ["Data Category", "Storage Location", "Retention Window", "User Control"],
          rows: [
            [
              "Parsed PDF & OCR Page Context",
              "Volatile server RAM (capped at 100 active slots)",
              "Session-bound; evicted automatically on capacity rotation or server restart",
              "Close session or replace active document",
            ],
            [
              "Synthesized 24 kHz WAV Audio",
              "Browser Blob memory (URL.createObjectURL)",
              "Until tab closes or a new narration is generated",
              "Download locally or close browser tab",
            ],
            [
              "Live Voice Microphone Stream",
              "Encrypted WebSocket transit",
              "0 seconds persisted after turn completion",
              "Mute mic or click End Session anytime",
            ],
            [
              "Theme & Cookie Preferences",
              "Browser localStorage",
              "Up to 12 months",
              "Toggle in header, Cookie Policy, or clear site data",
            ],
            [
              "Billing & Refund Records",
              "Encrypted accounting records",
              "Up to 7 years (tax & statutory compliance)",
              "Request copy or redaction where legally permitted",
            ],
          ],
        },
      },
      {
        id: "privacy-sharing",
        number: "05",
        title: "Subprocessors & Third-Party Services",
        paragraphs: [
          "We do not sell, rent, or trade personal data or document contents. We rely only on essential infrastructure providers bound by confidentiality and data-protection commitments:",
        ],
        bullets: [
          "Cloud Hosting & Runtime Infrastructure: Google Cloud Run provides isolated container execution and TLS termination for encrypted web and WebSocket traffic.",
          "Multimodal AI & Speech Synthesis: Google Gemini API processes document text, scanned page snapshots, speech synthesis requests, and optional live search grounding.",
          "Payment & Billing Processors (where paid tiers apply): PCI-DSS Level 1 compliant payment gateways process card or digital wallet details directly; Free PDF AI never stores raw credit card numbers.",
        ],
      },
      {
        id: "privacy-security",
        number: "06",
        title: "Security Safeguards & Sensitive Documents",
        paragraphs: [
          "All communications between your browser and Free PDF AI use modern TLS encryption in transit. Server-side OCR temporary caches write only to isolated ephemeral container memory (/tmp) and do not persist across container lifecycles.",
          "Please exercise caution when uploading highly regulated records (such as unredacted government secrets or third-party medical files subject to specialized institutional BAA agreements) unless your organization has executed a dedicated enterprise agreement with us.",
        ],
      },
      {
        id: "privacy-rights",
        number: "07",
        title: "Your Privacy Rights (GDPR, UK GDPR, CCPA/CPRA & Global)",
        paragraphs: [
          "Depending on your jurisdiction, you have the right to request access to personal information we hold about you, request correction or deletion, object to or restrict certain processing, receive a portable copy of your data, and withdraw consent at any time without affecting prior lawful processing.",
          "Residents of California, the European Economic Area, the United Kingdom, and similar jurisdictions are never discriminated against for exercising privacy rights. Because we do not sell or share personal data for cross-context behavioral advertising, no separate opt-out of data sales is required.",
        ],
      },
      {
        id: "privacy-children",
        number: "08",
        title: "Children's Privacy",
        paragraphs: [
          "Free PDF AI is designed for general academic, professional, and assistive reading audiences. We do not knowingly collect personal information directly from children under the age of 13 (or the minimum digital consent age in your country) without verifiable parental or school educator authorization. If you believe a child has submitted personal data without appropriate consent, contact us and we will promptly delete it.",
        ],
      },
      {
        id: "privacy-contact",
        number: "09",
        title: "Policy Updates & Privacy Contact",
        paragraphs: [
          "When we make material updates to how Free PDF AI handles documents or personal information, we update the Effective Date and Version number at the top of this page.",
          `For privacy questions, accessibility data requests, or deletion inquiries, contact our Privacy & Accessibility Team at ${LEGAL_CONTACT_EMAIL}. We respond to verified requests within 24 to 48 business hours and fulfill formal statutory requests within 30 calendar days.`,
        ],
      },
    ],
  },

  terms: {
    id: "terms",
    hash: "#terms-and-conditions",
    shortLabel: "Terms & Conditions",
    title: "Terms and Conditions",
    subtitle:
      "The rules, intellectual property rights, accessibility commitments, and usage boundaries governing your access to Free PDF AI.",
    effectiveDate: "October 28, 2026",
    lastUpdated: "October 28, 2026",
    version: "2.4",
    readingTime: "7 min read",
    plainLanguageSummary: [
      "You retain 100% ownership of every PDF, photo, form, Word document, and WhatsApp file you upload, as well as the audio and transcripts generated from your own content.",
      "You must only upload documents that you own or have lawful permission to read and convert for personal, educational, accessibility, or authorized business use.",
      "AI-generated summaries, plain-language rewrites, OCR outputs, and spoken chart descriptions are assistive reading tools—not certified medical, legal, or financial advice.",
      "Abusive automation, reverse engineering, malicious uploads, or attempts to overload synthesis endpoints may result in rate-limiting or access suspension.",
    ],
    sections: [
      {
        id: "terms-acceptance",
        number: "01",
        title: "Acceptance of Terms",
        paragraphs: [
          "By accessing or using Free PDF AI, including our PDF Voice Studio, multi-format OCR extractor, studio voice audition gallery, Document Q&A chat, and Live Bidirectional Voice Chat (collectively, the \"Service\"), you agree to be bound by these Terms and Conditions and our Privacy Policy.",
          "If you are using the Service on behalf of a university, clinic, Disability Resource Center, agency, or company, you represent that you have authority to bind that organization to these Terms.",
        ],
      },
      {
        id: "terms-service",
        number: "02",
        title: "Description of the Assistive Reading Service",
        paragraphs: [
          "Free PDF AI converts electronic documents, scanned pages, handwritten notes, structured forms, and exported text archives (up to 5 GB per file) into verbatim full-page transcripts, structured chapter briefs, sixth-grade plain-language adaptations, two-host conversational dialogues, visual figure descriptions, downloadable 24 kHz WAV speech, and real-time voice conversations.",
          "We continually refine our OCR pipelines, language support, and voice synthesis models, and may add, improve, or retire specific models or experimental features to maintain reliability and accessibility compliance.",
        ],
      },
      {
        id: "terms-ownership",
        number: "03",
        title: "Your Documents & Intellectual Property Rights",
        paragraphs: [
          "You retain all right, title, and ownership in the documents, images, forms, and prompts you submit to Free PDF AI (\"User Content\"). Submitting a file does not transfer copyright ownership to us.",
          "You grant Free PDF AI a limited, non-exclusive, revocable, worldwide, royalty-free license solely to parse, run optical character recognition on, translate, summarize, and synthesize audio from your User Content at your direction during your active session.",
          "The Free PDF AI interface, software code, visual design, brand marks, and curated sample accessibility documents remain the intellectual property of Free PDF AI and its licensors.",
        ],
      },
      {
        id: "terms-acceptable-use",
        number: "04",
        title: "User Responsibilities & Acceptable Use",
        paragraphs: [
          "To keep Free PDF AI fast, safe, and available for assistive technology users worldwide, you agree not to misuse the Service. Specifically, you agree that you will not:",
        ],
        bullets: [
          "Upload files containing malware, exploit payloads, zip bombs, or corrupted binaries designed to disrupt browser or server memory.",
          "Convert or redistribute copyrighted books or proprietary materials in violation of applicable copyright laws, noting that lawful assistive reading under applicable disability exceptions (such as the Marrakesh Treaty or Section 121 Chafee Amendment where applicable) remains respected.",
          "Use synthesized studio voices (Kore, Charon, Zephyr, Fenrir, Puck) to impersonate real individuals without consent, fabricate deceptive political or financial recordings, or conduct automated robocalling.",
          "Bypass rate limits, scrape `/api/tts` or `/api/analyze-pdf` endpoints via unauthorized bots, or resell raw API access without written authorization.",
        ],
      },
      {
        id: "terms-ai-disclaimer",
        number: "05",
        title: "Assistive AI & OCR Accuracy Disclaimer",
        paragraphs: [
          "While Free PDF AI scans every page of uploaded PDFs and applies dual-engine Vision OCR and Tesseract recognition to recover text from scans and photographs, optical character recognition and large language model summarization can occasionally misread degraded handwriting, low-resolution stamps, complex mathematical notation, or dense tabular alignments.",
          "Outputs provided in Executive Summary, Plain-Language Mode, Two-Host Dialogue, Visual Figure Narration, and Live Voice Chat are provided strictly as reading and comprehension aids. They do not constitute licensed medical advice, clinical diagnosis, legal counsel, or certified financial auditing. Always verify critical dosages, deadlines, contract figures, and legal obligations against the original source document.",
        ],
      },
      {
        id: "terms-subscriptions",
        number: "06",
        title: "Free Access, Paid Plans & Billing Terms",
        paragraphs: [
          "Core browser extraction and assistive reading capabilities made available free of charge may be subject to fair-use concurrency, synthesis character limits, or daily request quotas to ensure equitable availability.",
          "Where optional Pro, Academic, or Institutional subscriptions or credit packs are offered, stated prices exclude applicable local taxes unless explicitly noted. Subscriptions renew at the selected billing interval (monthly or annual) unless canceled prior to the renewal date, and all paid transactions are covered by our Refund Policy.",
        ],
      },
      {
        id: "terms-liability",
        number: "07",
        title: "Warranties & Limitation of Liability",
        paragraphs: [
          "THE SERVICE IS PROVIDED ON AN \"AS IS\" AND \"AS AVAILABLE\" BASIS. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, FREE PDF AI DISCLAIMS ALL IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND UNINTERRUPTED ERROR-FREE OPERATION.",
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, FREE PDF AI AND ITS CREATORS SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE. OUR AGGREGATE LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL AMOUNT PAID BY YOU TO FREE PDF AI IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM OR (B) FIFTY U.S. DOLLARS ($50.00).",
        ],
      },
      {
        id: "terms-termination",
        number: "08",
        title: "Suspension, Termination & Changes",
        paragraphs: [
          "You may stop using Free PDF AI at any time. We reserve the right to throttle, suspend, or terminate access from IP addresses or accounts that violate Section 04 (Acceptable Use) or threaten platform stability.",
          "We may revise these Terms periodically to reflect new document formats, accessibility standards, or legal requirements. Continued use after an updated Effective Date constitutes acceptance of the revised Terms.",
        ],
      },
      {
        id: "terms-governing-law",
        number: "09",
        title: "Dispute Resolution & Contact Information",
        paragraphs: [
          "Before initiating formal legal proceedings, both parties agree to attempt good-faith informal resolution by sending a written description of the concern to our support address and allowing fifteen (15) business days to resolve the issue amicably. Mandatory consumer protection laws in your country of residence remain unaffected.",
          `Questions regarding these Terms and Conditions may be directed to ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
    ],
  },

  cookies: {
    id: "cookies",
    hash: "#cookie-policy",
    shortLabel: "Cookie Policy",
    title: "Cookie & Local Storage Policy",
    subtitle:
      "Transparent inventory of browser storage keys, accessibility state persistence, and zero-ad-tracking guarantees—plus live controls to manage your preferences.",
    effectiveDate: "October 28, 2026",
    lastUpdated: "October 28, 2026",
    version: "2.4",
    readingTime: "5 min read",
    plainLanguageSummary: [
      "Free PDF AI does NOT use third-party advertising cookies, cross-site behavioral trackers, or social media retargeting pixels.",
      "Instead of intrusive tracking cookies, we primarily use standard HTML5 browser localStorage and temporary in-tab memory to remember your Dark/Light high-contrast theme, font size, and cookie choices.",
      "You can customize or revoke non-essential storage preferences right on this page using the Interactive Storage Preferences panel below.",
    ],
    sections: [
      {
        id: "cookies-overview",
        number: "01",
        title: "What Cookies & Local Storage Technologies We Use",
        paragraphs: [
          "Cookies are small text files placed on your device by websites you visit. Modern assistive web applications like Free PDF AI also rely on HTML5 Web Storage (`window.localStorage`), temporary browser `Blob` object URLs, and volatile React session state so your accessibility customizations remain intact without sending tracking identifiers on every network request.",
          "We categorize browser storage strictly by function so you know exactly what lives on your device and why.",
        ],
      },
      {
        id: "cookies-inventory",
        number: "02",
        title: "Complete Storage & Cookie Inventory",
        paragraphs: [
          "Below is the exact technical inventory of keys and browser storage mechanisms used by Free PDF AI:",
        ],
        table: {
          caption: "Technical Inventory of Cookies, Local Storage Keys, and Browser Memory",
          headers: ["Key / Mechanism", "Type & Category", "Purpose", "Duration"],
          rows: [
            [
              "free-pdf-ai-cookie-preferences",
              "localStorage · Essential",
              "Stores your explicit consent selections from the Cookie & Storage Preferences manager on this page.",
              "12 months",
            ],
            [
              "free-pdf-ai-theme",
              "localStorage · Functional Accessibility",
              "Remembers whether you selected Light Mode or WCAG high-contrast Dark Mode across page reloads.",
              "12 months (or until toggled/cleared)",
            ],
            [
              "blob: audio/wav Object URLs",
              "In-Tab RAM · Essential",
              "Holds synthesized 24 kHz speech segments locally in browser memory for instant scrubbing and replay.",
              "Current browser tab only (revoked on close)",
            ],
            [
              "Workspace Session State",
              "In-Tab RAM · Essential",
              "Maintains active PDF page transcripts, font scale (base/large/xlarge), playback rate, and selected voice persona.",
              "Current browser tab only",
            ],
            [
              "Performance Diagnostics",
              "Ephemeral Client Metrics · Optional",
              "Helps measure local OCR completion latency and audio buffer reliability when enabled by the user.",
              "Session-only",
            ],
          ],
        },
      },
      {
        id: "cookies-zero-ads",
        number: "03",
        title: "Zero Cross-Site Advertising or Fingerprinting",
        paragraphs: [
          "Assistive reading tools frequently handle academic research, disability accommodations, and personal paperwork. Accordingly, Free PDF AI enforces a strict zero-ad-tech policy:",
        ],
        bullets: [
          "No third-party ad network cookies, real-time bidding beacons, or remarketing pixels.",
          "No canvas, WebGL, or audio-context device fingerprinting scripts.",
          "No sale or sharing of browsing history or uploaded file titles with data brokers.",
        ],
      },
      {
        id: "cookies-browser-controls",
        number: "04",
        title: "Managing Cookies in Your Browser & Assistive Tech",
        paragraphs: [
          "In addition to the interactive preference controls directly on this page, all major browsers (Chrome, Firefox, Safari, Microsoft Edge, Brave) let you inspect, block, or delete site data and `localStorage` entries through Settings > Privacy and Security > Site Settings.",
          "Note that if you block all site storage in strict private/incognito browsing, Free PDF AI will continue to read, OCR, and narrate your documents normally, though your Dark Mode preference will revert to your operating system's `prefers-color-scheme` default when you close the window.",
        ],
      },
      {
        id: "cookies-contact",
        number: "05",
        title: "Questions About Browser Storage",
        paragraphs: [
          `If you have questions regarding our Cookie & Local Storage Policy or require technical details for an institutional accessibility review (VPAT / HECVAT), please contact ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
    ],
  },

  refund: {
    id: "refund",
    hash: "#refund-policy",
    shortLabel: "Refund Policy",
    title: "Refund & Cancellation Policy",
    subtitle:
      "Clear, fair, no-runaround refund rules, 14-day satisfaction protection, duplicate-charge resolution, and step-by-step billing support.",
    effectiveDate: "October 28, 2026",
    lastUpdated: "October 28, 2026",
    version: "2.4",
    readingTime: "5 min read",
    plainLanguageSummary: [
      "Core Free PDF AI reading features are accessible without upfront payment; if you purchase any paid Pro, Academic, or Institutional plan or voice credit bundle, you are protected by a straightforward 14-day satisfaction refund window.",
      "Accidental duplicate charges, billing errors, or technical failures that prevent document processing are refunded 100% at any time.",
      "Subscriptions can be canceled anytime with zero cancellation penalties, and refunds return directly to your original payment method within 5 to 10 business days.",
    ],
    sections: [
      {
        id: "refund-overview",
        number: "01",
        title: "Our Fair & Accessible Billing Promise",
        paragraphs: [
          "Readers with print disabilities, students, researchers, and institutions rely on assistive software that genuinely fits their workflow. While Free PDF AI provides core PDF, image OCR, and AI voice capabilities free of charge, this Refund & Cancellation Policy governs any paid subscription tiers, extended synthesis credit packs, or institutional licenses purchased from Free PDF AI.",
          "We never hide cancellation controls behind dark patterns, phone-only queues, or multi-step retention mazes.",
        ],
      },
      {
        id: "refund-schedule",
        number: "02",
        title: "Refund Eligibility & Windows",
        paragraphs: [
          "Eligibility depends on purchase type and usage so legitimate readers are always protected against dissatisfaction or accidental renewals:",
        ],
        table: {
          caption: "Refund Windows and Eligibility by Plan Type",
          headers: ["Purchase Type", "Full Refund Window", "Condition / Usage Threshold", "Resolution"],
          rows: [
            [
              "First-Time Monthly Subscription",
              "14 calendar days from charge",
              "Standard evaluation use (under 25 hours of generated studio WAV audio)",
              "100% refund to original payment method",
            ],
            [
              "Annual Academic / Pro Plan",
              "14 calendar days from initial charge or annual renewal",
              "Requested within 14 days of billing date",
              "100% full refund (or pro-rata credit if requested later for accessibility hardship)",
            ],
            [
              "Prepaid Voice / OCR Credit Pack",
              "14 calendar days from purchase",
              "At least 80% of purchased credits remain unused",
              "100% full refund (or pro-rata refund of unused credits)",
            ],
            [
              "Duplicate Charge or Billing Error",
              "Unrestricted (anytime)",
              "Verified duplicate transaction or unauthorized renewal after cancellation",
              "Immediate 100% refund including any processor fee adjustments",
            ],
            [
              "Unresolved Technical Blocker",
              "30 calendar days from charge",
              "Reproducible defect preventing supported PDF/OCR/TTS use that our team cannot resolve within 72 hours",
              "100% full refund",
            ],
          ],
        },
      },
      {
        id: "refund-cancellation",
        number: "03",
        title: "Canceling Renewals",
        paragraphs: [
          "You may cancel an active monthly or annual subscription at any time prior to its next renewal timestamp. When you cancel without requesting an immediate refund, your plan remains active through the end of the paid billing cycle and will not auto-renew afterward.",
          "If you forgot to cancel an annual renewal and notify us within 14 calendar days of the renewal charge—without substantial post-renewal usage—we will honor a full renewal refund upon request.",
        ],
      },
      {
        id: "refund-exceptions",
        number: "04",
        title: "Non-Refundable Exceptions",
        paragraphs: [
          "To protect platform sustainability against automated abuse, refunds are generally not granted in the following narrow situations unless required by mandatory local consumer law:",
        ],
        bullets: [
          "Accounts suspended or terminated for willful violation of our Acceptable Use rules (such as automated API scraping, malware uploads, or fraudulent chargeback schemes).",
          "Prepaid synthesis or OCR credit packs where more than 50% of the credits have already been consumed prior to the refund request (absent a verified technical defect).",
          "Requests submitted more than 30 calendar days after the transaction date for monthly plans where the service operated normally.",
        ],
      },
      {
        id: "refund-statutory",
        number: "05",
        title: "EU, UK & Regional Statutory Consumer Rights",
        paragraphs: [
          "Nothing in this Refund Policy limits mandatory statutory withdrawal or consumer guarantee rights under European Union Directive 2011/83/EU, the UK Consumer Rights Act 2015, Australian Consumer Law, or equivalent local statutes. In fact, our 14-day satisfaction guarantee extends generous evaluation protection even after you begin testing digital speech synthesis.",
        ],
      },
      {
        id: "refund-how-to-request",
        number: "06",
        title: "How to Request a Refund & Processing Timeline",
        paragraphs: [
          `To request a refund or cancellation assistance, email ${LEGAL_CONTACT_EMAIL} with the subject line "Refund Request — Free PDF AI" and include:`,
        ],
        bullets: [
          "The email address used at checkout or associated with your workspace.",
          "The approximate date of purchase and receipt or transaction ID (if available).",
          "A brief one-line note on whether the request is a 14-day trial return, accidental renewal, duplicate charge, or technical issue (optional for 14-day satisfaction requests, but helpful for improving accessibility).",
        ],
      },
      {
        id: "refund-payout-speed",
        number: "07",
        title: "Approval & Bank Settlement Speed",
        paragraphs: [
          "Our billing support team reviews and confirms all eligible refund requests within 1 to 2 business days. Once approved, we immediately issue the reversal to our payment processor. Depending on your card-issuing bank or digital wallet provider, funds typically post back to your statement within 5 to 10 business days.",
        ],
      },
    ],
  },
};

export const LEGAL_POLICY_ORDER: LegalPolicyId[] = [
  "privacy",
  "terms",
  "cookies",
  "refund",
];

export function parsePolicyFromHash(hash: string): LegalPolicyId | null {
  const normalized = (hash || "").trim().toLowerCase();
  if (normalized === "#privacy-policy" || normalized === "#privacy") {
    return "privacy";
  }
  if (
    normalized === "#terms-and-conditions" ||
    normalized === "#terms" ||
    normalized === "#tos"
  ) {
    return "terms";
  }
  if (normalized === "#cookie-policy" || normalized === "#cookies") {
    return "cookies";
  }
  if (normalized === "#refund-policy" || normalized === "#refund") {
    return "refund";
  }
  return null;
}
