export enum SummaryMode {
  VERBATIM = "verbatim",
  EXECUTIVE = "executive",
  PLAIN = "plain",
  DIALOGUE = "dialogue",
}

export enum WorkspaceTab {
  SCRIPT = "script",
  VISUALS = "visuals",
  VOICE_CHAT = "voice_chat",
  CHAT = "chat",
}

export type VoicePersonaId = "Kore" | "Charon" | "Zephyr" | "Fenrir" | "Puck";

export interface VoicePersona {
  id: VoicePersonaId;
  name: string;
  timbre: string;
  bestFor: string;
  sampleLine: string;
  stylePrompt: string;
}

export interface DialogueTurn {
  speaker: "Alex" | "Sam";
  text: string;
  style: string;
}

export interface DocumentChapter {
  id: string;
  title: string;
  summary: string;
  spokenText: string;
  keyFacts: string[];
}

export interface VisualDescription {
  label: string;
  elementType: string;
  spokenDescription: string;
}

export interface PdfPageContent {
  pageNumber: number;
  heading: string;
  text: string;
}

export interface WebResearchSource {
  uri: string;
  title: string;
}

export interface WebResearchBrief {
  query: string;
  summary: string;
  sources: WebResearchSource[];
  timestamp: string;
}

export type UploadCategory =
  | "pdf"
  | "image"
  | "written_photo"
  | "pdf_form"
  | "docs_whatsapp";

export interface DocumentAnalysis {
  documentId?: string;
  documentTitle: string;
  fileName: string;
  fileSizeLabel: string;
  detectedPageCountEstimate: number;
  readingLevel: string;
  estimatedListenSeconds: number;
  overview: string;
  narrationScript: string;
  dialogueTurns: DialogueTurn[];
  chapters: DocumentChapter[];
  visualDescriptions: VisualDescription[];
  keyTakeaways: string[];
  suggestedQuestions: string[];
  language: string;
  modelUsed: string;
  rawExcerpt?: string;
  pages?: PdfPageContent[];
  webResearch?: WebResearchBrief;
  sourceCategory?: UploadCategory;
  detailedReport?: string;
  totalWordsRead?: number;
  totalLinesRead?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  modelUsed?: string;
  webSources?: WebResearchSource[];
}

export interface LiveTranscriptTurn {
  id: string;
  role: "user" | "model";
  text: string;
  isFinal: boolean;
  timestamp: string;
  webSources?: WebResearchSource[];
  researchQuery?: string;
}

export interface ReaderSettings {
  fontScale: "base" | "large" | "xlarge";
  relaxedSpacing: boolean;
  highContrastDark: boolean;
}

export interface SampleDocumentPreset {
  id: string;
  title: string;
  category: string;
  fileName: string;
  fileSizeLabel: string;
  pages: number;
  rawText: string;
  initialAnalysis: DocumentAnalysis;
}

export type LegalPolicyId = "privacy" | "terms" | "cookies" | "refund";

export interface CookiePreferences {
  essential: true;
  functionalAccessibility: boolean;
  performanceDiagnostics: boolean;
  updatedAt: string;
}

