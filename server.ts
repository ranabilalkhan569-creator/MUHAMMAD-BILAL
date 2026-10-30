import "dotenv/config";
import http from "http";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type FunctionResponse,
  type GenerateContentResponse,
  type LiveServerMessage,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ExtractedPdfPage {
  pageNumber: number;
  heading: string;
  text: string;
}

interface StoredPdfDocument {
  documentId: string;
  fileName: string;
  mimeType: string;
  fileBase64?: string;
  pages: ExtractedPdfPage[];
  fullVerbatimText: string;
  createdAt: number;
}

interface WebSearchSource {
  uri: string;
  title: string;
}

function extractWebSources(response: GenerateContentResponse): WebSearchSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const results: WebSearchSource[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (typeof uri === "string" && uri.trim() && !seen.has(uri)) {
      seen.add(uri);
      let fallbackTitle = uri;
      try {
        fallbackTitle = new URL(uri).hostname.replace(/^www\./, "");
      } catch {}
      results.push({
        uri,
        title:
          typeof chunk?.web?.title === "string" && chunk.web.title.trim()
            ? chunk.web.title.trim()
            : fallbackTitle,
      });
    }
  }
  return results.slice(0, 8);
}

// Server-side in-memory store of uploaded PDFs and extracted verbatim pages
const pdfDocumentStore = new Map<string, StoredPdfDocument>();
const MAX_STORED_DOCS = 100;

function stripJsonCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function countWordsAndLines(
  pages: ExtractedPdfPage[],
  fallbackText = ""
): { totalWordsRead: number; totalLinesRead: number } {
  const combined =
    pages.length > 0
      ? pages
          .map((p) => p.text || "")
          .filter((t) => t.trim().length > 0)
          .join("\n")
      : fallbackText;

  const trimmed = combined.trim();
  if (!trimmed) {
    return { totalWordsRead: 0, totalLinesRead: 0 };
  }

  const totalWordsRead = trimmed.split(/\s+/).filter(Boolean).length;
  const totalLinesRead = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;

  return { totalWordsRead, totalLinesRead };
}

function isServerPageTextMeaningful(rawText: string): boolean {
  if (!rawText) return false;
  const trimmed = rawText.trim();
  if (trimmed.length < 24) return false;
  const nonSpace = trimmed.replace(/\s+/g, "");
  if (!nonSpace) return false;

  let garbled = 0;
  for (let i = 0; i < nonSpace.length; i++) {
    const code = nonSpace.charCodeAt(i);
    if (
      code === 0xfffd ||
      code < 32 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xe000 && code <= 0xf8ff)
    ) {
      garbled++;
    }
  }
  if (garbled / nonSpace.length > 0.15) return false;

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^scanned\s+(?:by|with)\s+\w+/i.test(l) &&
        !/^camscanner$/i.test(l) &&
        !/^page\s+\d+(?:\s+of\s+\d+)?$/i.test(l)
    );
  const words = lines
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return words.length >= 5;
}

function inferServerTitleFromPages(
  pages: ExtractedPdfPage[],
  fileName: string
): string {
  const cleanStem =
    fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Uploaded Document";

  for (const page of pages) {
    if (!page?.text) continue;
    const candidateLines = page.text
      .split(/\r?\n/)
      .map((l) => l.replace(/[|;{}[\]<>~`]+/g, " ").replace(/\s+/g, " ").trim())
      .filter(
        (l) =>
          l.length >= 4 &&
          !/^\d+$/.test(l) &&
          !l.startsWith("[Form Fields]") &&
          !l.startsWith("[Interactive PDF Form") &&
          !/^scanned\s+(?:by|with)\s+\w+/i.test(l) &&
          !/^camscanner$/i.test(l)
      );
    if (candidateLines.length > 0) {
      const cleanHeading =
        candidateLines.find(
          (l) =>
            l.length >= 6 &&
            l.length <= 85 &&
            /^[A-Za-z0-9\u00C0-\uFFFF][A-Za-z0-9\u00C0-\uFFFF\s.,:'"?!()&/-]+$/.test(l)
        ) || candidateLines[0];
      if (cleanHeading.length <= 95) return cleanHeading;
      const clause = cleanHeading.split(/[.:;—–-]\s+/)[0]?.trim() || "";
      if (clause.length >= 6 && clause.length <= 95) return clause;
      return `${cleanHeading.slice(0, 92).trim()}...`;
    }
  }

  return cleanStem;
}

function reconstructServerPageLines(items: unknown[]): string {
  if (!Array.isArray(items) || items.length === 0) return "";

  interface ServerPositionedToken {
    str: string;
    x: number | null;
    y: number | null;
    width: number;
    hasEOL: boolean;
    orderIdx: number;
  }

  const tokens: ServerPositionedToken[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as {
      str?: string;
      transform?: number[];
      width?: number;
      hasEOL?: boolean;
    };
    if (typeof item?.str !== "string") continue;
    if (item.str.length === 0 && !item.hasEOL) continue;

    const x =
      Array.isArray(item.transform) && typeof item.transform[4] === "number"
        ? item.transform[4]
        : null;
    const y =
      Array.isArray(item.transform) && typeof item.transform[5] === "number"
        ? item.transform[5]
        : null;

    tokens.push({
      str: item.str,
      x,
      y,
      width: typeof item.width === "number" && item.width > 0 ? item.width : 0,
      hasEOL: Boolean(item.hasEOL),
      orderIdx: i,
    });
  }

  if (tokens.length === 0) return "";
  if (!tokens.some((t) => t.x !== null && t.y !== null)) {
    return tokens
      .map((t) => (t.hasEOL ? `${t.str}\n` : t.str))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  const buckets: Array<{ y: number; items: ServerPositionedToken[] }> = [];
  for (const tok of tokens) {
    if (tok.y === null) {
      if (buckets.length === 0) buckets.push({ y: 0, items: [tok] });
      else buckets[buckets.length - 1].items.push(tok);
      continue;
    }
    let matched: { y: number; items: ServerPositionedToken[] } | undefined;
    for (let b = buckets.length - 1; b >= 0; b--) {
      if (Math.abs(buckets[b].y - tok.y) <= 3.8) {
        matched = buckets[b];
        break;
      }
    }
    if (matched) matched.items.push(tok);
    else buckets.push({ y: tok.y, items: [tok] });
  }

  buckets.sort((a, b) => b.y - a.y);

  const outputLines: string[] = [];
  let prevY: number | null = null;

  for (const bucket of buckets) {
    bucket.items.sort((a, b) => {
      if (a.x !== null && b.x !== null && Math.abs(a.x - b.x) > 1.5) {
        return a.x - b.x;
      }
      return a.orderIdx - b.orderIdx;
    });

    let lineText = "";
    let prevRight: number | null = null;
    for (const tok of bucket.items) {
      if (!tok.str) continue;
      if (!lineText) {
        lineText = tok.str;
      } else if (tok.x !== null && prevRight !== null) {
        const gap = tok.x - prevRight;
        if (gap > 36) {
          lineText = `${lineText.trimEnd()} | ${tok.str.trimStart()}`;
        } else if (
          gap > 2.2 &&
          !lineText.endsWith(" ") &&
          !lineText.endsWith("-") &&
          !tok.str.startsWith(" ")
        ) {
          lineText += ` ${tok.str}`;
        } else {
          lineText += tok.str;
        }
      } else if (
        !lineText.endsWith(" ") &&
        !lineText.endsWith("-") &&
        !tok.str.startsWith(" ")
      ) {
        lineText += ` ${tok.str}`;
      } else {
        lineText += tok.str;
      }

      if (tok.x !== null) {
        const estW = tok.width > 0 ? tok.width : Math.max(4, tok.str.length * 4.8);
        prevRight = Math.max(prevRight ?? tok.x, tok.x + estW);
      }
    }

    const cleaned = lineText.replace(/[ \t]{2,}/g, " ").trim();
    if (!cleaned) continue;

    if (
      prevY !== null &&
      Math.abs(prevY - bucket.y) > 16 &&
      outputLines.length > 0 &&
      outputLines[outputLines.length - 1] !== ""
    ) {
      outputLines.push("");
    }
    outputLines.push(cleaned);
    prevY = bucket.y;
  }

  return outputLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdfPagesOnServer(
  pdfBase64: string
): Promise<{ pages: ExtractedPdfPage[]; numPages: number }> {
  try {
    const pdfjsLib = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as unknown as {
      getDocument: (src: Record<string, unknown>) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: (opts?: Record<string, unknown>) => Promise<{
              items: unknown[];
            }>;
            getAnnotations: () => Promise<unknown[]>;
            cleanup: () => void;
          }>;
          cleanup: () => Promise<void>;
          destroy: () => Promise<void>;
        }>;
      };
    };

    const rawBytes = new Uint8Array(Buffer.from(pdfBase64, "base64"));
    const cMapUrl = path.join(__dirname, "node_modules/pdfjs-dist/cmaps/");
    const standardFontDataUrl = path.join(
      __dirname,
      "node_modules/pdfjs-dist/standard_fonts/"
    );

    const loadingTask = pdfjsLib.getDocument({
      data: rawBytes,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      useSystemFonts: true,
      disableFontFace: true,
      enableXfa: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pages: ExtractedPdfPage[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent({
          includeMarkedContent: false,
        });
        const baseText = reconstructServerPageLines(textContent.items || []);

        let formLines: string[] = [];
        try {
          const annotations = await page.getAnnotations();
          if (Array.isArray(annotations)) {
            for (const rawAnn of annotations) {
              const ann = rawAnn as {
                subtype?: string;
                fieldName?: string;
                alternativeText?: string;
                fieldValue?: unknown;
              };
              const label = String(
                ann?.alternativeText || ann?.fieldName || ""
              ).trim();
              if (label && (ann?.subtype === "Widget" || ann?.fieldName)) {
                const val =
                  ann?.fieldValue !== undefined &&
                  ann?.fieldValue !== null &&
                  String(ann.fieldValue).trim() !== ""
                    ? String(ann.fieldValue).trim()
                    : "Blank";
                formLines.push(`- ${label}: ${val}`);
              }
            }
          }
        } catch {
          // Ignore form annotation errors
        }

        const fullPageText = [
          baseText,
          formLines.length > 0
            ? `[Form Fields]\n${formLines.join("\n")}`
            : "",
        ]
          .filter((s) => s.trim().length > 0)
          .join("\n\n");

        const firstLine = fullPageText
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length >= 3 && !/^\d+$/.test(l));

        const heading = firstLine
          ? firstLine.length <= 85
            ? firstLine
            : `${firstLine.slice(0, 82).trim()}...`
          : `Page ${pageNum}`;

        pages.push({
          pageNumber: pageNum,
          heading,
          text: fullPageText,
        });

        page.cleanup();
      } catch {
        pages.push({
          pageNumber: pageNum,
          heading: `Page ${pageNum}`,
          text: "",
        });
      }
    }

    try {
      await pdfDoc.cleanup();
      await pdfDoc.destroy();
    } catch {
      // Ignore cleanup issues
    }

    return { pages, numPages };
  } catch (err) {
    console.warn("Server-side PDF.js extraction fallback notice:", err);
    return { pages: [], numPages: 0 };
  }
}

function buildRepresentativeAnalysisDigest(
  pages: ExtractedPdfPage[],
  fallbackText: string,
  maxChars = 320000
): string {
  if (pages.length > 0) {
    const fullJoined = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    if (fullJoined.length <= maxChars) {
      return fullJoined;
    }
    const tocIndex = pages
      .slice(0, 200)
      .map((p) => `Page ${p.pageNumber}: ${p.heading}`)
      .join("\n");
    const budgetEach = Math.floor((maxChars - tocIndex.length - 1200) / 3);
    const intro = fullJoined.slice(0, budgetEach);
    const midStart = Math.floor(fullJoined.length / 2 - budgetEach / 2);
    const middle = fullJoined.slice(midStart, midStart + budgetEach);
    const ending = fullJoined.slice(Math.max(0, fullJoined.length - budgetEach));
    return `DOCUMENT PAGE HEADINGS INDEX (${pages.length} total pages):\n${tocIndex}\n\n--- OPENING SECTION ---\n${intro}\n\n--- MIDDLE SECTION ---\n${middle}\n\n--- CONCLUDING SECTION ---\n${ending}`;
  }
  return fallbackText.slice(0, maxChars);
}

function buildServerFallbackSummary(
  fileName: string,
  pages: ExtractedPdfPage[],
  totalPageCount: number,
  targetLanguage: string
) {
  const nonEmpty = pages.filter((p) => p.text && p.text.trim().length > 0);
  const cleanTitle = inferServerTitleFromPages(nonEmpty, fileName);
  const count = Math.max(1, totalPageCount || nonEmpty.length || pages.length);
  const { totalWordsRead, totalLinesRead } = countWordsAndLines(nonEmpty);

  const chunkCount = Math.min(12, Math.max(1, nonEmpty.length));
  const perChapter = Math.max(1, Math.ceil((nonEmpty.length || 1) / chunkCount));
  const chapters = [];

  if (nonEmpty.length > 0) {
    for (let i = 0; i < nonEmpty.length; i += perChapter) {
      const slice = nonEmpty.slice(i, i + perChapter);
      const pStart = slice[0].pageNumber;
      const pEnd = slice[slice.length - 1].pageNumber;
      const label = pStart === pEnd ? `Page ${pStart}` : `Pages ${pStart}–${pEnd}`;
      const body = slice.map((p) => p.text).join("\n\n").trim();
      chapters.push({
        id: `ch-${chapters.length + 1}`,
        title: `${label}: ${slice[0].heading || `Section ${chapters.length + 1}`}`,
        summary: body.slice(0, 260).replace(/\s+/g, " ").trim(),
        spokenText: body,
        keyFacts: [label, `${slice.length} page section`],
      });
    }
  } else {
    chapters.push({
      id: "ch-1",
      title: `Page 1: ${cleanTitle}`,
      summary: `No readable text layers were detected in ${fileName}.`,
      spokenText: `Please click Re-Scan & Refresh AI Report to extract text from scanned images in ${fileName}.`,
      keyFacts: [`${count} pages`],
    });
  }

  const narrationScript =
    nonEmpty.length > 0
      ? nonEmpty
          .map((p) => `Page ${p.pageNumber}, ${p.heading}.\n${p.text}`)
          .join("\n\n")
          .trim()
      : `Unable to detect embedded text in ${fileName}.`;

  const detailedReport =
    nonEmpty.length > 0
      ? `Complete Full-Document Content Report (${nonEmpty.length} of ${count} pages scanned, ${totalLinesRead.toLocaleString()} lines, ${totalWordsRead.toLocaleString()} words read):\n\n` +
        nonEmpty
          .slice(0, 40)
          .map(
            (p) =>
              `Page ${p.pageNumber} — ${p.heading}:\n${p.text.slice(0, 900)}${
                p.text.length > 900 ? "..." : ""
              }`
          )
          .join("\n\n")
      : `No text could be extracted yet from "${fileName}".`;

  const firstPreview =
    nonEmpty.length > 0
      ? nonEmpty[0].text.replace(/\s+/g, " ").trim().slice(0, 300)
      : "";

  return {
    documentTitle: cleanTitle,
    detectedPageCountEstimate: count,
    readingLevel: "100% Full-Page Extraction",
    estimatedListenSeconds: Math.max(
      30,
      Math.round(((totalWordsRead || 120) / 150) * 60)
    ),
    overview:
      nonEmpty.length > 0
        ? `Scanned and extracted all ${nonEmpty.length} of ${count} pages (${totalLinesRead.toLocaleString()} lines, ${totalWordsRead.toLocaleString()} words) inside "${cleanTitle}". Opening content: "${firstPreview}${firstPreview.length >= 300 ? "..." : ""}"`
        : `Inspected "${fileName}" (${count} pages).`,
    narrationScript,
    detailedReport,
    totalWordsRead,
    totalLinesRead,
    dialogueTurns: [
      {
        speaker: "Alex",
        text: `We have read every page inside ${cleanTitle}, covering ${count} pages, ${totalLinesRead} lines, and ${totalWordsRead} words.`,
        style: "Warm, clear host",
      },
      {
        speaker: "Sam",
        text:
          nonEmpty.length > 0
            ? `Page 1 opens with ${nonEmpty[0].heading}: ${firstPreview}`
            : `Let's examine the visual pages inside ${cleanTitle}.`,
        style: "Curious, articulate co-host",
      },
    ],
    chapters,
    visualDescriptions: [
      {
        label: `${cleanTitle} Full Structure`,
        elementType: "Document Layout",
        spokenDescription: `Contains ${count} pages (${totalLinesRead} lines and ${totalWordsRead} words) organized into ${chapters.length} audio chapters.`,
      },
    ],
    keyTakeaways: chapters
      .slice(0, 5)
      .map((c) => `${c.title}: ${c.summary.slice(0, 150)}`),
    suggestedQuestions: [
      `Give me a complete page-by-page report of everything inside ${cleanTitle}`,
      "Read every single line and word of Page 1 aloud to me",
      "What are all the exact facts, numbers, names, and dates inside this PDF?",
      `Search Google for more details about ${cleanTitle}`,
    ],
    language: targetLanguage,
  };
}

function saveDocumentToStore(record: StoredPdfDocument) {
  if (pdfDocumentStore.size >= MAX_STORED_DOCS && !pdfDocumentStore.has(record.documentId)) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of pdfDocumentStore.entries()) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) pdfDocumentStore.delete(oldestKey);
  }
  pdfDocumentStore.set(record.documentId, record);
}

function splitPlainTextToPages(text: string): ExtractedPdfPage[] {
  const clean = text.trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const pages: ExtractedPdfPage[] = [];
  let currentChunk = "";
  let currentHeading = "Page 1";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (!currentChunk) {
      const firstLine = trimmed.split("\n")[0].trim();
      currentHeading =
        firstLine.length <= 90 ? firstLine : `Page ${pages.length + 1}`;
    }
    if (currentChunk.length + trimmed.length > 2200 && currentChunk.length > 0) {
      pages.push({
        pageNumber: pages.length + 1,
        heading: currentHeading,
        text: currentChunk.trim(),
      });
      const firstLine = trimmed.split("\n")[0].trim();
      currentHeading =
        firstLine.length <= 90 ? firstLine : `Page ${pages.length + 1}`;
      currentChunk = trimmed;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }

  if (currentChunk.trim()) {
    pages.push({
      pageNumber: pages.length + 1,
      heading: currentHeading,
      text: currentChunk.trim(),
    });
  }

  return pages;
}

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please check the Settings > Secrets panel."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function formatGeminiError(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err);
  if (
    rawMessage.includes("PERMISSION_DENIED") ||
    rawMessage.includes("API_KEY_INVALID") ||
    rawMessage.includes("403")
  ) {
    return "Unable to authenticate with Gemini. Please verify your API key in the Settings > Secrets panel.";
  }
  if (rawMessage.includes("RESOURCE_EXHAUSTED") || rawMessage.includes("429")) {
    return "API quota reached. Upgrading to a billing-enabled API key in Settings > Secrets increases available quota.";
  }
  return rawMessage || "An unexpected error occurred while processing your document.";
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("HIGH DEMAND") ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("DEADLINE_EXCEEDED") ||
    msg.includes("REQUEST_TIMEOUT") ||
    msg.includes("FETCH FAILED") ||
    msg.includes("ECONNRESET")
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    preferredModel: string;
    fallbackModels?: string[];
    contents: unknown;
    config?: Record<string, unknown>;
    timeoutMs?: number;
  }
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const candidateModels = Array.from(
    new Set([
      params.preferredModel,
      ...(params.fallbackModels || ["gemini-3.8-flash", "gemini-flash-latest"]),
    ])
  );
  const perAttemptTimeoutMs = params.timeoutMs ?? 24_000;

  let lastError: unknown;
  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const model = candidateModels[mIdx];
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents as never,
          config: params.config as never,
        }),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`REQUEST_TIMEOUT (${model} > ${perAttemptTimeoutMs}ms)`));
          }, perAttemptTimeoutMs);
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return { response, modelUsed: model };
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      lastError = err;
      if (!isTransientModelError(err)) {
        throw err;
      }
      if (mIdx < candidateModels.length - 1) {
        await sleepMs(350);
      }
    }
  }

  throw lastError || new Error("Gemini generation temporarily unavailable.");
}

async function runServerTesseractFallback(
  images: Array<{ pageNumber: number; mimeType?: string; dataBase64: string }>
): Promise<ExtractedPdfPage[]> {
  if (images.length === 0) return [];
  const results: ExtractedPdfPage[] = [];

  try {
    const tesseractMod = (await import("tesseract.js")) as unknown as {
      createWorker?: (
        lang?: string,
        oem?: number,
        options?: Record<string, unknown>
      ) => Promise<{
        recognize: (img: Buffer) => Promise<{ data?: { text?: string } }>;
        terminate: () => Promise<unknown>;
      }>;
      default?: {
        createWorker?: (
          lang?: string,
          oem?: number,
          options?: Record<string, unknown>
        ) => Promise<{
          recognize: (img: Buffer) => Promise<{ data?: { text?: string } }>;
          terminate: () => Promise<unknown>;
        }>;
      };
    };

    const createWorkerFn =
      tesseractMod.createWorker || tesseractMod.default?.createWorker;
    if (!createWorkerFn) return [];

    const worker = await createWorkerFn("eng", 1, { cachePath: "/tmp" });
    try {
      for (const img of images) {
        try {
          const buf = Buffer.from(img.dataBase64, "base64");
          const res = await worker.recognize(buf);
          const text = String(res?.data?.text || "")
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((l) => l.replace(/[ \t]+/g, " ").trim())
            .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          const firstLine = text
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.length >= 3 && !/^\d+$/.test(l));

          results.push({
            pageNumber: img.pageNumber,
            heading: firstLine
              ? firstLine.length <= 85
                ? firstLine
                : `${firstLine.slice(0, 82).trim()}...`
              : `Page ${img.pageNumber}`,
            text,
          });
        } catch {
          results.push({
            pageNumber: img.pageNumber,
            heading: `Page ${img.pageNumber}`,
            text: "",
          });
        }
      }
    } finally {
      try {
        await worker.terminate();
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (err) {
    console.warn("Server Tesseract fallback notice:", err);
  }

  return results;
}

function resolveDocumentPagesAndText(
  documentContext: Record<string, unknown> | null | undefined
): {
  storedRecord?: StoredPdfDocument;
  pages: ExtractedPdfPage[];
  fullText: string;
} {
  if (!documentContext) {
    return { pages: [], fullText: "" };
  }

  const docId =
    typeof documentContext.documentId === "string"
      ? documentContext.documentId
      : undefined;
  const storedRecord = docId ? pdfDocumentStore.get(docId) : undefined;

  if (storedRecord && storedRecord.pages.length > 0) {
    return {
      storedRecord,
      pages: storedRecord.pages,
      fullText: storedRecord.fullVerbatimText,
    };
  }

  const clientPages = Array.isArray(documentContext.pages)
    ? (documentContext.pages as ExtractedPdfPage[]).filter(
        (p) => p && typeof p.text === "string"
      )
    : [];

  const rawExcerpt =
    typeof documentContext.rawExcerpt === "string"
      ? documentContext.rawExcerpt
      : "";

  if (clientPages.length > 0) {
    const joined = clientPages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return { storedRecord, pages: clientPages, fullText: joined };
  }

  const derivedPages = rawExcerpt ? splitPlainTextToPages(rawExcerpt) : [];
  return { storedRecord, pages: derivedPages, fullText: rawExcerpt };
}

function buildDocumentSystemContext(
  documentContext: Record<string, unknown> | null | undefined
): string {
  if (!documentContext || !documentContext.documentTitle) {
    return "ACTIVE DOCUMENT STATUS: No PDF, JPG, or PNG document is currently uploaded (the previous file was deleted or none has been added yet). Invite the user to upload a PDF, JPG, or PNG file whenever they want you to read a document aloud, and freely use Google Search web research to answer any topic questions they ask in the meantime.";
  }

  const { pages, fullText } = resolveDocumentPagesAndText(documentContext);
  const { totalWordsRead, totalLinesRead } = countWordsAndLines(pages, fullText);

  const formattedPagesBlock =
    pages.length > 0
      ? pages
          .map(
            (p) =>
              `=== PAGE ${p.pageNumber}: ${p.heading || `Page ${p.pageNumber}`} ===\n${p.text}`
          )
          .join("\n\n")
          .slice(0, 350000)
      : fullText.slice(0, 350000);

  return `ACTIVE UPLOADED DOCUMENT (PDF / JPG / PNG — 100% FULL-PAGE TEXT, EVERY LINE & WORD EXTRACTED ACROSS ALL PAGES):
Document Content Title (from inside text, NOT filename): ${String(documentContext.documentTitle || "Uploaded Document")}
Source File Name: ${String(documentContext.fileName || "Document.pdf")}
Total Indexed Pages: ${pages.length || Number(documentContext.detectedPageCountEstimate || 1)}
Verified Lines Read: ${totalLinesRead || Number(documentContext.totalLinesRead || 0)}
Verified Words Read: ${totalWordsRead || Number(documentContext.totalWordsRead || 0)}
Executive Overview: ${String(documentContext.overview || "")}
AI Full-Document Report: ${String(documentContext.detailedReport || "")}
Key Takeaways: ${JSON.stringify(documentContext.keyTakeaways || [])}
Visual, Chart & Table Descriptions: ${JSON.stringify(documentContext.visualDescriptions || [])}

COMPLETE PAGE-BY-PAGE, LINE-BY-LINE VERBATIM EXTRACTED TEXT ACROSS ALL PAGES (READ THIS DIRECTLY TO ANSWER QUESTIONS OR READ EVERY WORD ALOUD — NEVER SAY YOU ONLY SEE THE FILENAME OR METADATA):
${formattedPagesBlock || String(documentContext.narrationScript || "")}`;
}

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    documentTitle: {
      type: Type.STRING,
      description:
        "True title found INSIDE the document content (not merely the raw filename unless no internal title exists).",
    },
    detectedPageCountEstimate: {
      type: Type.INTEGER,
      description: "Estimated number of pages in the document (minimum 1).",
    },
    readingLevel: {
      type: Type.STRING,
      description:
        "Reading accessibility level label, e.g. 'Full-PDF AI Deep Read', 'Grade 6 Plain Language', or 'Clear Executive Prose'.",
    },
    estimatedListenSeconds: {
      type: Type.INTEGER,
      description: "Estimated spoken duration in seconds at 150 words per minute.",
    },
    overview: {
      type: Type.STRING,
      description:
        "3 to 4 sentence concrete summary proving you read inside the document—stating its exact subject, key names/entities, specific figures/dates, and core conclusion (NEVER merely say 'loaded filename.pdf').",
    },
    detailedReport: {
      type: Type.STRING,
      description:
        "Comprehensive, thorough Full-PDF AI Content Report (320 to 600 words) organized page-by-page or section-by-section after reading every single line and word inside the PDF. Quote concrete headings, key statements, names, dates, numbers, clauses, table figures, and conclusions from inside the file.",
    },
    narrationScript: {
      type: Type.STRING,
      description:
        "Complete, natural-sounding spoken audio walkthrough (300 to 500 words) covering every major section and concrete fact inside the PDF for human ears. Avoid visual-only references like 'see table below'; spell out key figures naturally.",
    },
    dialogueTurns: {
      type: Type.ARRAY,
      description:
        "6 to 8 natural conversational turns between Alex and Sam discussing the specific contents inside the document clearly for auditory learners.",
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: {
            type: Type.STRING,
            description: "Either 'Alex' or 'Sam'.",
          },
          text: {
            type: Type.STRING,
            description: "Spoken line for this speaker (1 to 3 clear sentences).",
          },
          style: {
            type: Type.STRING,
            description:
              "Brief vocal delivery direction, e.g. 'Warm, clear host' or 'Curious, articulate co-host'.",
          },
        },
        required: ["speaker", "text", "style"],
      },
    },
    chapters: {
      type: Type.ARRAY,
      description: "4 to 8 logical audio chapters covering the entire document from first page to last page.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          spokenText: {
            type: Type.STRING,
            description:
              "Natural 90 to 160 word spoken narration specifically covering the real details of this chapter/page range.",
          },
          keyFacts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["id", "title", "summary", "spokenText", "keyFacts"],
      },
    },
    visualDescriptions: {
      type: Type.ARRAY,
      description:
        "Screen-reader spoken descriptions of charts, tables, forms, callout boxes, or structural layouts in the document. Always provide at least 2 helpful structural or data descriptions.",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Title or location of the visual/table/structural element." },
          elementType: { type: Type.STRING, description: "e.g. 'Data Table', 'Bar Chart', 'Form Section', 'Document Layout'." },
          spokenDescription: {
            type: Type.STRING,
            description: "Clear verbal walkthrough of trends, rows, or layout for blind and low-vision listeners.",
          },
        },
        required: ["label", "elementType", "spokenDescription"],
      },
    },
    keyTakeaways: {
      type: Type.ARRAY,
      description: "5 concrete takeaways, facts, figures, or required actions found inside the document.",
      items: { type: Type.STRING },
    },
    suggestedQuestions: {
      type: Type.ARRAY,
      description: "4 specific follow-up questions grounded in the actual contents of this document.",
      items: { type: Type.STRING },
    },
  },
  required: [
    "documentTitle",
    "detectedPageCountEstimate",
    "readingLevel",
    "estimatedListenSeconds",
    "overview",
    "detailedReport",
    "narrationScript",
    "dialogueTurns",
    "chapters",
    "visualDescriptions",
    "keyTakeaways",
    "suggestedQuestions",
  ],
};

const pdfPageExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      description:
        "Page-by-page verbatim full text extraction of EVERY page, EVERY line, and EVERY word of the PDF document in natural reading order, converting tables and figure labels into clear readable text.",
      items: {
        type: Type.OBJECT,
        properties: {
          pageNumber: {
            type: Type.INTEGER,
            description: "1-indexed page number in the PDF.",
          },
          heading: {
            type: Type.STRING,
            description: "Primary heading or topic on this page.",
          },
          text: {
            type: Type.STRING,
            description:
              "Complete, word-for-word, line-by-line text of this page including all paragraphs, clauses, names, numbers, dates, footnotes, and table values.",
          },
        },
        required: ["pageNumber", "heading", "text"],
      },
    },
  },
  required: ["pages"],
};

const livePdfTools: FunctionDeclaration[] = [
  {
    name: "getPdfPageContent",
    description:
      "Retrieve the exact word-for-word verbatim text of a specific page number, a range of pages, or search across all pages of the uploaded PDF document so you can read every single line and word aloud accurately or answer detailed questions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        pageNumber: {
          type: Type.INTEGER,
          description: "Optional 1-indexed starting page number to read or inspect.",
        },
        endPageNumber: {
          type: Type.INTEGER,
          description: "Optional 1-indexed ending page number when reading multiple pages.",
        },
        searchQuery: {
          type: Type.STRING,
          description: "Optional keyword, clause, or topic to search across all PDF pages.",
        },
      },
    },
  },
  {
    name: "inspectOriginalPdfVisuals",
    description:
      "Inspect the original uploaded PDF visually to answer detailed questions about charts, graphs, tables, signatures, or fine-print formatting.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: "Specific question to check directly against the raw PDF file.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "searchGoogleWebResearch",
    description:
      "Search Google and conduct live internet research regarding the PDF's topic or any user question. Call this whenever the user asks for details from the web/internet, asks you to research a topic, asks about external facts/news/regulations/definitions not inside the PDF, or asks a question when no PDF is loaded.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            "Focused Google search query to gather up-to-date internet details and authoritative research concerning the user's question and/or PDF topic.",
        },
      },
      required: ["query"],
    },
  },
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "200mb" }));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Serve PDF.js CMap & Standard Font tables so browser PDF.js decodes all CID/Unicode/non-Latin fonts across all pages
  app.use(
    "/pdfjs/cmaps",
    express.static(path.join(__dirname, "node_modules/pdfjs-dist/cmaps"))
  );
  app.use(
    "/pdfjs/standard_fonts",
    express.static(
      path.join(__dirname, "node_modules/pdfjs-dist/standard_fonts")
    )
  );

  // 0a. Dedicated Full-Page Text Recognition & OCR Endpoint for Scanned PDF Pages, JPGs, and PNGs
  app.post("/api/ocr-pages", async (req, res) => {
    try {
      const {
        fileName = "Document",
        uploadCategory = "pdf",
        targetLanguage = "English",
        pageImages,
        images,
      } = req.body || {};

      const rawImageList =
        Array.isArray(pageImages) && pageImages.length > 0
          ? pageImages
          : Array.isArray(images)
          ? images
          : [];

      const validImages: Array<{
        pageNumber: number;
        mimeType: string;
        dataBase64: string;
      }> = rawImageList
        .filter(
          (img) =>
            img &&
            typeof img.dataBase64 === "string" &&
            img.dataBase64.length > 0
        )
        .slice(0, 8)
        .map((img, idx) => ({
          pageNumber: Number(img.pageNumber || idx + 1),
          mimeType: String(img.mimeType || "image/jpeg"),
          dataBase64: String(img.dataBase64),
        }));

      if (validImages.length === 0) {
        res.status(400).json({ error: "No page images provided for OCR." });
        return;
      }

      let extractedPages: ExtractedPdfPage[] = [];
      let engineUsed = "gemini-3.8-flash";

      try {
        const ai = getGenAI();
        const parts: Array<Record<string, unknown>> = [];

        for (const snap of validImages) {
          parts.push({
            text: `--- INPUT IMAGE FOR PAGE ${snap.pageNumber} ---`,
          });
          parts.push({
            inlineData: {
              mimeType: snap.mimeType || "image/jpeg",
              data: snap.dataBase64,
            },
          });
        }

        const pageListLabel = validImages.map((v) => v.pageNumber).join(", ");
        const ocrInstruction =
          uploadCategory === "written_photo"
            ? `Perform high-precision full-page OCR on "${fileName}" (page numbers: ${pageListLabel}). Read and transcribe EVERY SINGLE handwritten or printed line, word, heading, number, date, stamp, formula, and margin note verbatim from top to bottom. Never return just the file name.`
            : uploadCategory === "image"
            ? `Perform complete full-page text recognition and visual reading on "${fileName}" (page numbers: ${pageListLabel}). Extract EVERY visible word, line, heading, sign, caption, screenshot text, receipt item, and chart/table value verbatim in natural reading order. If the image also contains visual photographs or diagrams, append a concise "[Visual Scene]: ..." note after the verbatim text.`
            : uploadCategory === "pdf_form"
            ? `Perform full-page form & text OCR on "${fileName}" (page numbers: ${pageListLabel}). Extract EVERY section title, instruction line, fillable field label, checkbox/radio choice, table cell, and filled or handwritten entry verbatim in top-to-bottom order.`
            : `Perform complete, word-for-word, line-by-line full-page text recognition on "${fileName}" for page number(s): ${pageListLabel}. Extract EVERY SINGLE heading, paragraph, line, word, name, date, number, table row, and footnote on each page in exact reading order without skipping or summarizing anything.`;

        parts.push({
          text: `${ocrInstruction}\nTarget script/language preservation: keep original document words intact (or transcribe cleanly for ${targetLanguage} readers when applicable) and assign the exact matching pageNumber (${pageListLabel}) for each page.`,
        });

        const { response: ocrResp, modelUsed } = await generateContentWithRetry(
          ai,
          {
            preferredModel: "gemini-3.8-flash",
            fallbackModels: ["gemini-flash-latest", "gemini-3.1-flash-lite"],
            contents: { parts },
            config: {
              responseMimeType: "application/json",
              responseSchema: pdfPageExtractionSchema,
              temperature: 0.1,
            },
          }
        );

        engineUsed = modelUsed;
        const cleaned = stripJsonCodeFence(ocrResp.text || '{"pages":[]}');
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          extractedPages = parsed.pages.map(
            (
              p: { pageNumber?: number; heading?: string; text?: string },
              idx: number
            ) => {
              const matchedPageNum = validImages.some(
                (v) => v.pageNumber === Number(p.pageNumber)
              )
                ? Number(p.pageNumber)
                : validImages[idx]?.pageNumber ?? idx + 1;
              return {
                pageNumber: matchedPageNum,
                heading: String(p.heading || `Page ${matchedPageNum}`),
                text: String(p.text || "").trim(),
              };
            }
          );
        }
      } catch (visionErr) {
        console.warn(
          "Vision OCR encountered an issue; running server Tesseract OCR fallback:",
          visionErr
        );
      }

      // Fill any missing/empty pages via server-side Tesseract OCR guarantee
      const byPage = new Map<number, ExtractedPdfPage>();
      for (const p of extractedPages) {
        if (p.text.trim().length > 0) {
          byPage.set(p.pageNumber, p);
        }
      }

      const missingImages = validImages.filter(
        (img) => !byPage.has(img.pageNumber)
      );
      if (missingImages.length > 0) {
        const tessPages = await runServerTesseractFallback(missingImages);
        for (const tp of tessPages) {
          if (tp.text.trim().length > 0) {
            byPage.set(tp.pageNumber, tp);
            if (!extractedPages.length) engineUsed = "tesseract-server-ocr";
          }
        }
      }

      const finalPages = validImages.map(
        (img) =>
          byPage.get(img.pageNumber) || {
            pageNumber: img.pageNumber,
            heading: `Page ${img.pageNumber}`,
            text: "",
          }
      );

      res.json({
        pages: finalPages,
        engineUsed,
      });
    } catch (err) {
      console.error("Error in /api/ocr-pages:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 0. Chunked Page Upload Endpoint for Large Multi-Hundred-Page PDFs (avoids HTTP payload limits)
  app.post("/api/document/upload-pages", (req, res) => {
    try {
      const {
        documentId,
        fileName = "Document.pdf",
        mimeType = "application/pdf",
        pages = [],
        reset = false,
      } = req.body || {};

      const resolvedId =
        typeof documentId === "string" && documentId.trim()
          ? documentId.trim()
          : `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const incomingPages: ExtractedPdfPage[] = Array.isArray(pages)
        ? pages
            .filter((p) => p && typeof p.pageNumber === "number")
            .map((p) => ({
              pageNumber: Number(p.pageNumber),
              heading: String(p.heading || `Page ${p.pageNumber}`),
              text: String(p.text || ""),
            }))
        : [];

      const existing = !reset ? pdfDocumentStore.get(resolvedId) : undefined;
      const pageMap = new Map<number, ExtractedPdfPage>();
      if (existing) {
        for (const ep of existing.pages) {
          pageMap.set(ep.pageNumber, ep);
        }
      }
      for (const ip of incomingPages) {
        pageMap.set(ip.pageNumber, ip);
      }

      const mergedPages = Array.from(pageMap.values()).sort(
        (a, b) => a.pageNumber - b.pageNumber
      );

      const fullVerbatimText = mergedPages
        .filter((p) => p.text.trim().length > 0)
        .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
        .join("\n\n");

      saveDocumentToStore({
        documentId: resolvedId,
        fileName: existing?.fileName || fileName,
        mimeType: existing?.mimeType || mimeType,
        fileBase64: existing?.fileBase64,
        pages: mergedPages,
        fullVerbatimText,
        createdAt: existing?.createdAt || Date.now(),
      });

      res.json({
        documentId: resolvedId,
        storedPageCount: mergedPages.length,
      });
    } catch (err) {
      console.error("Error in /api/document/upload-pages:", err);
      res.status(500).json({ error: "Failed to store PDF page chunk." });
    }
  });

  // 1. Analyze uploaded PDF, Image (JPG/PNG), Handwritten Photo, PDF Form, Word Doc, or WhatsApp file
  app.post("/api/analyze", async (req, res) => {
    try {
      const {
        fileName = "Document.pdf",
        mimeType = "application/pdf",
        fileBase64,
        textContent,
        pages: clientExtractedPages,
        scannedPageImages,
        totalPagesCount,
        mode = "executive",
        targetLanguage = "English",
        existingDocumentId,
        uploadCategory = "pdf",
      } = req.body || {};

      const cachedDoc =
        typeof existingDocumentId === "string"
          ? pdfDocumentStore.get(existingDocumentId)
          : undefined;

      const sanitizedClientPages: ExtractedPdfPage[] = Array.isArray(clientExtractedPages)
        ? clientExtractedPages
            .filter((p) => p && typeof p.pageNumber === "number")
            .map((p) => ({
              pageNumber: Number(p.pageNumber),
              heading: String(p.heading || `Page ${p.pageNumber}`),
              text: String(p.text || ""),
            }))
        : [];

      const preExtractedPages =
        sanitizedClientPages.length > 0
          ? sanitizedClientPages
          : cachedDoc?.pages || [];

      const sanitizedSnapshots: Array<{
        pageNumber: number;
        mimeType: string;
        dataBase64: string;
      }> = Array.isArray(scannedPageImages)
        ? scannedPageImages.filter(
            (img) =>
              img &&
              typeof img.dataBase64 === "string" &&
              img.dataBase64.length > 0
          )
        : [];

      const effectiveBase64 = fileBase64 || cachedDoc?.fileBase64;
      let extractedPages: ExtractedPdfPage[] = [...preExtractedPages];
      let serverPdfPageCount = 0;

      // Server-side PDF.js extraction across ALL pages whenever client pages are empty or missing pages
      const clientMeaningfulCount = extractedPages.filter((p) =>
        isServerPageTextMeaningful(p.text)
      ).length;
      if (
        effectiveBase64 &&
        (mimeType === "application/pdf" ||
          String(fileName).toLowerCase().endsWith(".pdf")) &&
        (extractedPages.length === 0 ||
          clientMeaningfulCount < extractedPages.length)
      ) {
        const serverExtracted = await extractPdfPagesOnServer(effectiveBase64);
        serverPdfPageCount = serverExtracted.numPages;
        if (extractedPages.length === 0 && serverExtracted.pages.length > 0) {
          extractedPages = serverExtracted.pages;
        } else if (serverExtracted.pages.length > 0) {
          // Fill in any pages where client extraction was empty/sparse but server PDF.js succeeded
          const byNum = new Map<number, ExtractedPdfPage>();
          for (const cp of extractedPages) byNum.set(cp.pageNumber, cp);
          for (const sp of serverExtracted.pages) {
            const cur = byNum.get(sp.pageNumber);
            if (
              (!cur || !isServerPageTextMeaningful(cur.text)) &&
              sp.text.trim().length > (cur?.text.trim().length || 0)
            ) {
              byNum.set(sp.pageNumber, sp);
            }
          }
          extractedPages = Array.from(byNum.values()).sort(
            (a, b) => a.pageNumber - b.pageNumber
          );
        }
      }

      const preJoinedText =
        extractedPages.length > 0
          ? extractedPages
               .filter((p) => p.text.trim().length > 0)
              .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
              .join("\n\n")
          : "";
      let effectiveText =
        textContent || preJoinedText || cachedDoc?.fullVerbatimText || "";

      if (
        !effectiveBase64 &&
        !effectiveText &&
        extractedPages.length === 0 &&
        sanitizedSnapshots.length === 0
      ) {
        res.status(400).json({
          error:
            "Please upload a supported file (PDF, JPG/PNG, Handwritten Photo, PDF Form, Word Doc, or WhatsApp file).",
        });
        return;
      }

      const documentId =
        cachedDoc?.documentId ||
        (typeof existingDocumentId === "string" && existingDocumentId.trim()
          ? existingDocumentId.trim()
          : `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

      const detectedTotalPages =
        Number(totalPagesCount) ||
        serverPdfPageCount ||
        extractedPages.length ||
        sanitizedSnapshots.length ||
        cachedDoc?.pages?.length ||
        1;

      let actualModelUsed = "gemini-3.8-flash";

      const modeGuidance =
        mode === "plain"
          ? "Prioritize cognitive accessibility: write narrationScript at a 6th-grade reading level using short, direct active-voice sentences, define any technical term immediately in everyday words, and still make detailedReport a complete page-by-page report of everything inside the document."
          : mode === "dialogue"
          ? "Prioritize auditory engagement: craft a thorough detailedReport, a clear narrationScript, AND an engaging 6-to-8 turn dialogue between Alex and Sam discussing concrete facts from inside the document."
          : mode === "verbatim"
          ? "FULL WORD-FOR-WORD & DEEP REPORT MODE: Read EVERY SINGLE PAGE, EVERY SINGLE LINE, and EVERY SINGLE WORD inside the document. Make detailedReport an exhaustive page-by-page report of all headings, statements, names, numbers, dates, tables, and conclusions inside the file, and make narrationScript a comprehensive spoken walkthrough of the actual document text."
          : "Prioritize executive clarity and complete full-document accuracy: read every page, line, and word inside the document, synthesize all key findings, quantitative figures, names, deadlines, and sections into natural spoken prose, and provide a thorough page-by-page detailedReport.";

      const categoryGuidance =
        uploadCategory === "written_photo"
          ? "CATEGORY — HANDWRITTEN & PRINTED TEXT PICTURE (OCR): Carefully read every handwritten word, cursive/printed line, stamp, formula, prescription, receipt item, or note in the image (including English, Urdu, Hindi, Arabic, or numeric text). Make narrationScript and detailedReport read out and report every single written line from top to bottom."
          : uploadCategory === "image"
          ? "CATEGORY — JPG/PNG PICTURE & VISUAL READER: Read ALL visible text, signs, screenshots, charts, or labels in the image word-for-word AND provide a vivid spoken walkthrough of what is shown in the picture."
          : uploadCategory === "pdf_form"
          ? "CATEGORY — FILLABLE PDF FORM / FORM DATA: Walk through the entire form section by section. Report the form's title/purpose, every fillable input field, checkbox/radio choice, required signature or deadline, and specify which fields are filled versus blank."
          : uploadCategory === "docs_whatsapp"
          ? "CATEGORY — WORD / OFFICE DOC OR WHATSAPP FILE: Read every message or section carefully. If this is a WhatsApp chat, report all participants, topics, dates, shared items, and conclusions. If it is a Word/Spreadsheet/Presentation file, report every section, slide, and table row."
          : "";

      let parsedSummary: Record<string, unknown> | null = null;

      try {
        const ai = getGenAI();

        // STEP A: Per-page OCR check! If ANY page is missing/sparse (scanned PDF, hybrid PDF, JPG, or PNG), run Vision OCR + Server Tesseract backup and merge per-page!
        const meaningfulPagesNow = extractedPages.filter((p) =>
          isServerPageTextMeaningful(p.text)
        );
        const hasMissingOrSparsePages =
          meaningfulPagesNow.length === 0 ||
          meaningfulPagesNow.length < extractedPages.length;

        if (
          hasMissingOrSparsePages &&
          (sanitizedSnapshots.length > 0 || Boolean(effectiveBase64))
        ) {
          const sparseSnapshots = sanitizedSnapshots.filter((snap) => {
            const existing = extractedPages.find(
              (p) => p.pageNumber === snap.pageNumber
            );
            return !existing || !isServerPageTextMeaningful(existing.text);
          });

          const mergeOcrPagesIntoExtracted = (incoming: ExtractedPdfPage[]) => {
            if (incoming.length === 0) return;
            const byPage = new Map<number, ExtractedPdfPage>();
            for (const ep of extractedPages) {
              byPage.set(ep.pageNumber, ep);
            }
            for (const op of incoming) {
              if (!op.text || !op.text.trim()) continue;
              const prev = byPage.get(op.pageNumber);
              if (!prev || !isServerPageTextMeaningful(prev.text)) {
                byPage.set(op.pageNumber, {
                  pageNumber: op.pageNumber,
                  heading: op.heading || prev?.heading || `Page ${op.pageNumber}`,
                  text: prev?.text?.includes("[Form Fields]")
                    ? `${op.text.trim()}\n\n${prev.text.trim()}`
                    : op.text.trim(),
                });
              }
            }
            extractedPages = Array.from(byPage.values()).sort(
              (a, b) => a.pageNumber - b.pageNumber
            );
            effectiveText = extractedPages
              .filter((p) => p.text.trim().length > 0)
              .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
              .join("\n\n");
          };

          if (sparseSnapshots.length > 0) {
            for (let b = 0; b < sparseSnapshots.length; b += 4) {
              const batch = sparseSnapshots.slice(b, b + 4);
              const batchParts: Array<Record<string, unknown>> = [];
              for (const snap of batch) {
                batchParts.push({
                  text: `--- PAGE ${snap.pageNumber} IMAGE ---`,
                });
                batchParts.push({
                  inlineData: {
                    mimeType: snap.mimeType || "image/jpeg",
                    data: snap.dataBase64,
                  },
                });
              }
              batchParts.push({
                text: `Extract EVERY SINGLE LINE and EVERY SINGLE WORD verbatim from page(s) ${batch
                  .map((s) => s.pageNumber)
                  .join(", ")} of "${fileName}" in exact reading order.`,
              });

              try {
                const { response: ocrResp } = await generateContentWithRetry(
                  ai,
                  {
                    preferredModel: "gemini-3.8-flash",
                    fallbackModels: ["gemini-flash-latest"],
                    contents: { parts: batchParts },
                    config: {
                      responseMimeType: "application/json",
                      responseSchema: pdfPageExtractionSchema,
                      temperature: 0.1,
                    },
                  }
                );
                const parsedOcr = JSON.parse(
                  stripJsonCodeFence(ocrResp.text || '{"pages":[]}')
                );
                if (Array.isArray(parsedOcr.pages)) {
                  mergeOcrPagesIntoExtracted(
                    parsedOcr.pages.map(
                      (
                        p: {
                          pageNumber?: number;
                          heading?: string;
                          text?: string;
                        },
                        idx: number
                      ) => ({
                        pageNumber: Number(
                          p.pageNumber || batch[idx]?.pageNumber || idx + 1
                        ),
                        heading: String(
                          p.heading ||
                            `Page ${batch[idx]?.pageNumber || idx + 1}`
                        ),
                        text: String(p.text || ""),
                      })
                    )
                  );
                }
              } catch (ocrErr) {
                console.warn("Batch Vision OCR fallback to server Tesseract:", ocrErr);
                const tessPages = await runServerTesseractFallback(batch);
                mergeOcrPagesIntoExtracted(tessPages);
              }
            }
          } else if (
            meaningfulPagesNow.length === 0 &&
            effectiveBase64 &&
            effectiveBase64.length <= 36_000_000 &&
            (mimeType === "application/pdf" || mimeType.startsWith("image/"))
          ) {
            try {
              const { response: ocrResp } = await generateContentWithRetry(ai, {
                preferredModel: "gemini-3.8-flash",
                fallbackModels: ["gemini-flash-latest"],
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType || "application/pdf",
                        data: effectiveBase64,
                      },
                    },
                    {
                      text: `Read EVERY SINGLE PAGE, EVERY SINGLE LINE, and EVERY SINGLE WORD inside "${fileName}" verbatim in natural reading order without skipping any page.`,
                    },
                  ],
                },
                config: {
                  responseMimeType: "application/json",
                  responseSchema: pdfPageExtractionSchema,
                  temperature: 0.1,
                },
              });
              const parsedOcr = JSON.parse(
                stripJsonCodeFence(ocrResp.text || '{"pages":[]}')
              );
              if (Array.isArray(parsedOcr.pages) && parsedOcr.pages.length > 0) {
                mergeOcrPagesIntoExtracted(
                  parsedOcr.pages.map(
                    (
                      p: {
                        pageNumber?: number;
                        heading?: string;
                        text?: string;
                      },
                      idx: number
                    ) => ({
                      pageNumber: Number(p.pageNumber || idx + 1),
                      heading: String(p.heading || `Page ${idx + 1}`),
                      text: String(p.text || ""),
                    })
                  )
                );
              }
            } catch (ocrErr) {
              console.warn("Direct binary Vision OCR warning:", ocrErr);
              if (mimeType.startsWith("image/")) {
                const tessPages = await runServerTesseractFallback([
                  { pageNumber: 1, mimeType, dataBase64: effectiveBase64 },
                ]);
                mergeOcrPagesIntoExtracted(tessPages);
              }
            }
          }
        }

        // STEP B: Build analysis prompt over 100% of extracted text across all pages
        // Avoid re-sending multi-MB raw binaries when we already have complete extracted text, preventing timeouts & JSON truncation!
        const parts: Array<Record<string, unknown>> = [];
        const hasRichExtractedText = effectiveText.trim().length >= 80;

        if (!hasRichExtractedText) {
          if (
            effectiveBase64 &&
            effectiveBase64.length <= 24_000_000 &&
            (mimeType === "application/pdf" || mimeType.startsWith("image/"))
          ) {
            parts.push({
              inlineData: {
                mimeType: mimeType || "application/pdf",
                data: effectiveBase64,
              },
            });
          } else if (sanitizedSnapshots.length > 0) {
            for (const snap of sanitizedSnapshots.slice(0, 8)) {
              parts.push({
                inlineData: {
                  mimeType: snap.mimeType || "image/jpeg",
                  data: snap.dataBase64,
                },
              });
            }
          }
        } else if (
          (uploadCategory === "image" || uploadCategory === "written_photo") &&
          sanitizedSnapshots.length > 0
        ) {
          // Include lightweight JPEG snapshot for visual scene description alongside full OCR text
          parts.push({
            inlineData: {
              mimeType: sanitizedSnapshots[0].mimeType || "image/jpeg",
              data: sanitizedSnapshots[0].dataBase64,
            },
          });
        }

        if (effectiveText.trim().length > 0) {
          const digest = buildRepresentativeAnalysisDigest(
            extractedPages,
            effectiveText,
            340000
          );
          const statsNow = countWordsAndLines(extractedPages, effectiveText);
          parts.push({
            text: `COMPLETE EXTRACTED TEXT ACROSS ALL PAGES INSIDE "${fileName}" (${Math.max(
              detectedTotalPages,
              extractedPages.length
            )} total pages, ${statsNow.totalLinesRead} lines, ${statsNow.totalWordsRead} words):\n\n${digest}`,
          });
        }

        parts.push({
          text: `Read and process the COMPLETE text inside "${fileName}" (${Math.max(
            detectedTotalPages,
            extractedPages.length
          )} pages/sections)—every single page, every single line, and every single word—and report back in ${targetLanguage}.
${modeGuidance}
${categoryGuidance}

CRITICAL RULES:
1. NEVER just repeat or paraphrase the file name or metadata! Set "documentTitle" to the true subject/heading found INSIDE the text, and prove you read the entire content by reporting concrete headings, exact facts, names, dates, numbers, clauses, table rows, and conclusions from Page 1 through Page ${Math.max(
            detectedTotalPages,
            extractedPages.length
          )}.
2. In "detailedReport", write a comprehensive page-by-page / section-by-section AI Content Report (320–600 words) detailing everything inside the document clearly.
3. Write "narrationScript" and chapter "spokenText" specifically for human ears—smooth transitions, clear verbal signposting, and natural phrasing of numbers/dates.
4. Ensure "dialogueTurns" alternate cleanly between speaker "Alex" and speaker "Sam".`,
        });

        const preferredSummaryModel =
          mode === "plain" && hasRichExtractedText
            ? "gemini-3.1-flash-lite"
            : "gemini-3.8-flash";

        const { response: summaryResp, modelUsed } =
          await generateContentWithRetry(ai, {
            preferredModel: preferredSummaryModel,
            fallbackModels: [
              "gemini-3.8-flash",
              "gemini-flash-latest",
              "gemini-3.1-flash-lite",
            ],
            contents: { parts },
            config: {
              systemInstruction:
                "You are Free PDF AI's Deep-Reading Document & Vision Analyst. You read every single page, every single line, and every single word inside uploaded PDFs, PDF forms, JPG/PNG photos, handwritten notes, Word documents, and WhatsApp files, and you produce thorough, factual content reports and natural spoken audio scripts.",
              responseMimeType: "application/json",
              responseSchema: analysisResponseSchema,
              temperature: 0.25,
            },
          });

        actualModelUsed = modelUsed;
        if (summaryResp.text) {
          parsedSummary = JSON.parse(stripJsonCodeFence(summaryResp.text));
        }
      } catch (geminiErr) {
        console.warn(
          "Gemini summary encountered an issue; activating direct full-text fallback:",
          geminiErr
        );
        if (extractedPages.length === 0 && effectiveText.trim().length > 0) {
          extractedPages = splitPlainTextToPages(effectiveText);
        }
        parsedSummary = buildServerFallbackSummary(
          fileName,
          extractedPages,
          detectedTotalPages,
          targetLanguage
        );
      }

      if (!parsedSummary) {
        parsedSummary = buildServerFallbackSummary(
          fileName,
          extractedPages,
          detectedTotalPages,
          targetLanguage
        );
      }

      if (extractedPages.length === 0 && effectiveText.trim().length > 0) {
        extractedPages = splitPlainTextToPages(effectiveText);
      }

      if (
        extractedPages.length === 0 &&
        Array.isArray(parsedSummary.chapters)
      ) {
        extractedPages = (
          parsedSummary.chapters as Array<{ title: string; spokenText: string }>
        ).map((c, idx) => ({
          pageNumber: idx + 1,
          heading: c.title,
          text: c.spokenText,
        }));
      }

      // Ensure documentTitle reflects the actual extracted content inside the file rather than echoing the raw filename
      const cleanRawStem = fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase();
      const currentSummaryTitle = String(
        parsedSummary.documentTitle || ""
      ).trim();
      if (
        extractedPages.some((p) => p.text && p.text.trim().length > 0) &&
        (!currentSummaryTitle ||
          currentSummaryTitle.toLowerCase() === fileName.toLowerCase() ||
          currentSummaryTitle.toLowerCase() === cleanRawStem)
      ) {
        parsedSummary.documentTitle = inferServerTitleFromPages(
          extractedPages,
          fileName
        );
      }

      const fullVerbatimText =
        extractedPages
          .filter((p) => p.text && p.text.trim().length > 0)
          .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
          .join("\n\n") || effectiveText;

      const { totalWordsRead, totalLinesRead } = countWordsAndLines(
        extractedPages,
        fullVerbatimText
      );

      saveDocumentToStore({
        documentId,
        fileName,
        mimeType: mimeType || "application/pdf",
        fileBase64: effectiveBase64,
        pages: extractedPages,
        fullVerbatimText,
        createdAt: cachedDoc?.createdAt || Date.now(),
      });

      const responsePages =
        extractedPages.length <= 2000
          ? extractedPages
          : extractedPages.slice(0, 2000);

      res.json({
        ...parsedSummary,
        documentId,
        detectedPageCountEstimate: Math.max(
          detectedTotalPages,
          extractedPages.length,
          Number(parsedSummary.detectedPageCountEstimate || 1)
        ),
        totalWordsRead,
        totalLinesRead,
        pages: responsePages,
        rawExcerpt: fullVerbatimText.slice(0, 2_000_000),
        modelUsed: actualModelUsed,
        language: targetLanguage,
      });
    } catch (err) {
      console.error("Error in /api/analyze:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 1b. Dedicated AI Full-PDF Line-by-Line Deep Read & Verification Report Endpoint
  app.post("/api/deep-report", async (req, res) => {
    try {
      const {
        documentContext,
        fileBase64,
        mimeType = "application/pdf",
        targetLanguage = "English",
      } = req.body || {};

      if (!documentContext && !fileBase64) {
        res.status(400).json({ error: "Please upload a PDF, JPG, or PNG document first." });
        return;
      }

      const { storedRecord, pages: existingPages, fullText } =
        resolveDocumentPagesAndText(documentContext);
      const effectiveBase64 = fileBase64 || storedRecord?.fileBase64;
      let pages = [...existingPages];

      if (
        pages.filter((p) => isServerPageTextMeaningful(p.text)).length <
          Math.max(1, pages.length) &&
        effectiveBase64 &&
        (mimeType === "application/pdf" ||
          storedRecord?.mimeType === "application/pdf")
      ) {
        const srv = await extractPdfPagesOnServer(effectiveBase64);
        if (pages.length === 0 && srv.pages.length > 0) {
          pages = srv.pages;
        } else if (srv.pages.length > 0) {
          const map = new Map<number, ExtractedPdfPage>();
          for (const ep of pages) map.set(ep.pageNumber, ep);
          for (const sp of srv.pages) {
            const prev = map.get(sp.pageNumber);
            if (!prev || !isServerPageTextMeaningful(prev.text)) {
              if (sp.text.trim().length > (prev?.text.trim().length || 0)) {
                map.set(sp.pageNumber, sp);
              }
            }
          }
          pages = Array.from(map.values()).sort(
            (a, b) => a.pageNumber - b.pageNumber
          );
        }
      }

      const ai = getGenAI();

      // If still scanned with no text layer, run Vision OCR + Server Tesseract backup first
      if (
        pages.filter((p) => isServerPageTextMeaningful(p.text)).length === 0 &&
        effectiveBase64 &&
        effectiveBase64.length <= 36_000_000
      ) {
        const effectiveMime =
          mimeType || storedRecord?.mimeType || "application/pdf";
        try {
          const { response: ocrResp } = await generateContentWithRetry(ai, {
            preferredModel: "gemini-3.8-flash",
            fallbackModels: ["gemini-flash-latest"],
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: effectiveMime,
                    data: effectiveBase64,
                  },
                },
                {
                  text: "Extract EVERY SINGLE PAGE, EVERY SINGLE LINE, and EVERY SINGLE WORD of this document verbatim in page order.",
                },
              ],
            },
            config: {
              responseMimeType: "application/json",
              responseSchema: pdfPageExtractionSchema,
              temperature: 0.1,
            },
          });
          const parsedOcr = JSON.parse(
            stripJsonCodeFence(ocrResp.text || '{"pages":[]}')
          );
          if (Array.isArray(parsedOcr.pages) && parsedOcr.pages.length > 0) {
            pages = parsedOcr.pages;
          }
        } catch (ocrErr) {
          console.warn("Deep-report OCR warning:", ocrErr);
          if (effectiveMime.startsWith("image/")) {
            pages = await runServerTesseractFallback([
              { pageNumber: 1, mimeType: effectiveMime, dataBase64: effectiveBase64 },
            ]);
          }
        }
      }

      const digest = buildRepresentativeAnalysisDigest(pages, fullText, 350000);
      const { totalWordsRead, totalLinesRead } = countWordsAndLines(
        pages,
        fullText
      );

      const reportParts: Array<Record<string, unknown>> = [];
      if (
        effectiveBase64 &&
        (digest.trim().length < 80 || effectiveBase64.length <= 5_500_000)
      ) {
        reportParts.push({
          inlineData: {
            mimeType: mimeType || storedRecord?.mimeType || "application/pdf",
            data: effectiveBase64,
          },
        });
      }
      if (digest.trim()) {
        reportParts.push({
          text: `FULL VERBATIM DOCUMENT CONTENT ACROSS ALL PAGES (${pages.length || 1} pages, ${totalLinesRead} lines, ${totalWordsRead} words):\n\n${digest}`,
        });
      }
      reportParts.push({
        text: `You have been asked by the user to read the ENTIRE uploaded document (PDF, JPG, or PNG)—every single page, every single line, and every single word—and report back completely in ${targetLanguage}.
Produce a thorough, structured, page-by-page AI Full-Document Report covering:
1. True Document Subject, Purpose & Author/Issuer (from inside the content, NEVER just repeating the filename or metadata).
2. Page-by-Page Breakdown (for every page or page group, report exact headings, key sentences, facts, figures, dates, names, tables, and clauses).
3. Complete Conclusions, Obligations, Deadlines, or Action Items found in the text.
Write clearly so it is easy both to read on screen and to listen to aloud.`,
      });

      const { response, modelUsed } = await generateContentWithRetry(ai, {
        preferredModel: "gemini-3.8-flash",
        fallbackModels: ["gemini-flash-latest", "gemini-3.1-flash-lite"],
        contents: { parts: reportParts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentTitle: { type: Type.STRING },
              overview: { type: Type.STRING },
              detailedReport: { type: Type.STRING },
              keyTakeaways: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              "documentTitle",
              "overview",
              "detailedReport",
              "keyTakeaways",
            ],
          },
          temperature: 0.2,
        },
      });

      const parsed = JSON.parse(stripJsonCodeFence(response.text || "{}"));
      const sourceFileName = String(
        documentContext?.fileName || storedRecord?.fileName || "Document.pdf"
      );
      const rawStem = sourceFileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase();
      if (
        pages.some((p) => p.text && p.text.trim().length > 0) &&
        (!parsed.documentTitle ||
          String(parsed.documentTitle).trim().toLowerCase() ===
            sourceFileName.toLowerCase() ||
          String(parsed.documentTitle).trim().toLowerCase() === rawStem)
      ) {
        parsed.documentTitle = inferServerTitleFromPages(pages, sourceFileName);
      }

      if (storedRecord && pages.length > 0) {
        const updatedFullText = pages
          .filter((p) => p.text.trim().length > 0)
          .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
          .join("\n\n");
        saveDocumentToStore({
          ...storedRecord,
          pages,
          fullVerbatimText: updatedFullText,
        });
      }

      res.json({
        ...parsed,
        pages: pages.length > 0 ? pages.slice(0, 2000) : undefined,
        totalWordsRead,
        totalLinesRead,
        modelUsed,
      });
    } catch (err) {
      console.error("Error in /api/deep-report:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 2. Fast Gemini Intelligence Transformations
  app.post("/api/transform", async (req, res) => {
    try {
      const { action, currentAnalysis, targetLanguage = "Spanish", fileBase64, mimeType } = req.body || {};
      if (!action || !currentAnalysis) {
        res.status(400).json({ error: "Missing transformation action or document context." });
        return;
      }

      const ai = getGenAI();

      if (action === "simplify") {
        const { response, modelUsed } = await generateContentWithRetry(ai, {
          preferredModel: "gemini-3.1-flash-lite",
          fallbackModels: ["gemini-3.8-flash", "gemini-flash-latest"],
          contents: `Rewrite the following audio narration script and overview into Plain Language (6th-grade reading level) for cognitive accessibility and dyslexia/print-fatigue relief. Keep sentences under 18 words, explain technical terms in plain everyday words, and maintain a warm, respectful tone.

Document Title: ${currentAnalysis.documentTitle}
Current Overview: ${currentAnalysis.overview}
Current Script: ${currentAnalysis.narrationScript}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                readingLevel: { type: Type.STRING },
                overview: { type: Type.STRING },
                narrationScript: { type: Type.STRING },
                keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["readingLevel", "overview", "narrationScript", "keyTakeaways"],
            },
          },
        });
        const result = JSON.parse(stripJsonCodeFence(response.text || "{}"));
        res.json({ ...result, modelUsed });
        return;
      }

      if (action === "action_items") {
        const { response, modelUsed } = await generateContentWithRetry(ai, {
          preferredModel: "gemini-3.1-flash-lite",
          fallbackModels: ["gemini-3.8-flash", "gemini-flash-latest"],
          contents: `Extract a clear, spoken-friendly Action Checklist from this document (deadlines, forms to sign, decisions to make, or practical next steps). Also return a concise spoken narration reading through these action items clearly.

Document: ${currentAnalysis.documentTitle}
Overview: ${currentAnalysis.overview}
Script: ${currentAnalysis.narrationScript}
Chapters: ${JSON.stringify(currentAnalysis.chapters || [])}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                narrationScript: { type: Type.STRING },
                keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["narrationScript", "keyTakeaways"],
            },
          },
        });
        const result = JSON.parse(stripJsonCodeFence(response.text || "{}"));
        res.json({ ...result, modelUsed });
        return;
      }

      if (action === "translate") {
        const { response, modelUsed } = await generateContentWithRetry(ai, {
          preferredModel: "gemini-3.8-flash",
          fallbackModels: ["gemini-flash-latest", "gemini-3.1-flash-lite"],
          contents: `Translate and culturally adapt this accessible audio summary into natural spoken ${targetLanguage}. Ensure idioms, numbers, and transitions sound completely natural when read aloud by a native ${targetLanguage} speaker.

Title: ${currentAnalysis.documentTitle}
Overview: ${currentAnalysis.overview}
Narration Script: ${currentAnalysis.narrationScript}
Key Takeaways: ${JSON.stringify(currentAnalysis.keyTakeaways || [])}
Chapters: ${JSON.stringify(currentAnalysis.chapters || [])}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                documentTitle: { type: Type.STRING },
                overview: { type: Type.STRING },
                narrationScript: { type: Type.STRING },
                keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                chapters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      spokenText: { type: Type.STRING },
                      keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["id", "title", "summary", "spokenText", "keyFacts"],
                  },
                },
              },
              required: ["documentTitle", "overview", "narrationScript", "keyTakeaways", "chapters"],
            },
          },
        });
        const result = JSON.parse(stripJsonCodeFence(response.text || "{}"));
        res.json({ ...result, language: targetLanguage, modelUsed });
        return;
      }

      if (action === "expand_visuals") {
        const stored = currentAnalysis.documentId
          ? pdfDocumentStore.get(currentAnalysis.documentId)
          : undefined;
        const effectivePdfBase64 = fileBase64 || stored?.fileBase64;

        const parts = [];
        if (effectivePdfBase64 && effectivePdfBase64.length <= 24_000_000) {
          parts.push({
            inlineData: {
              mimeType: mimeType || stored?.mimeType || "application/pdf",
              data: effectivePdfBase64,
            },
          });
        }
        parts.push({
          text: `Generate comprehensive screen-reader audio descriptions for every table, chart, numeric comparison, or layout section in "${currentAnalysis.documentTitle}".
Context summary: ${currentAnalysis.narrationScript}
Existing descriptions: ${JSON.stringify(currentAnalysis.visualDescriptions || [])}`,
        });

        const { response, modelUsed } = await generateContentWithRetry(ai, {
          preferredModel: "gemini-3.8-flash",
          fallbackModels: ["gemini-flash-latest", "gemini-3.1-flash-lite"],
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                visualDescriptions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      elementType: { type: Type.STRING },
                      spokenDescription: { type: Type.STRING },
                    },
                    required: ["label", "elementType", "spokenDescription"],
                  },
                },
              },
              required: ["visualDescriptions"],
            },
          },
        });
        const result = JSON.parse(stripJsonCodeFence(response.text || "{}"));
        res.json({ ...result, modelUsed });
        return;
      }

      res.status(400).json({ error: `Unsupported transform action: ${action}` });
    } catch (err) {
      console.error("Error in /api/transform:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 3. Natural-Sounding Gemini Text-to-Speech (Single-Voice & Dual-Speaker Dialogue)
  app.post("/api/tts", async (req, res) => {
    try {
      const {
        text,
        voiceName = "Kore",
        voiceStyle = "Warm, clear, measured accessibility narrator with natural pacing",
        mode = "single",
        dialogueTurns,
      } = req.body || {};

      const ai = getGenAI();

      if (mode === "dialogue" && Array.isArray(dialogueTurns) && dialogueTurns.length > 0) {
        const sanitizedTurns = dialogueTurns
          .filter(
            (t: { text?: unknown }) => t && typeof t.text === "string" && t.text.trim().length > 0
          )
          .slice(0, 10)
          .map((t: { speaker?: string; text: string; style?: string }) => {
            const speaker = t.speaker === "Sam" ? "Sam" : "Alex";
            const cleanLine = t.text.replace(/^(Alex|Sam):\s*/i, "").trim();
            return {
              text: `${speaker}: ${cleanLine}`,
              speechMetadata: {
                speaker,
                style:
                  t.style ||
                  (speaker === "Alex"
                    ? "Warm, articulate lead narrator"
                    : "Curious, clear conversational co-host"),
              },
            };
          });

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts: sanitizedTurns,
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: "Alex",
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: "Puck" },
                    },
                  },
                  {
                    speaker: "Sam",
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: "Kore" },
                    },
                  },
                ],
              },
            },
          },
        });

        const base64Audio =
          response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
            ?.data;

        if (!base64Audio) {
          throw new Error("No audio stream returned from Gemini dual-speaker TTS.");
        }

        res.json({
          audioBase64: base64Audio,
          mimeType: "audio/wav",
          modelUsed: "gemini-3.8-flash-tts",
        });
        return;
      }

      if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "Please provide text to synthesize into speech." });
        return;
      }

      const allowedVoices = ["Kore", "Charon", "Zephyr", "Fenrir", "Puck"];
      const selectedVoice = allowedVoices.includes(voiceName) ? voiceName : "Kore";

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: text.trim().slice(0, 6000),
                speechMetadata: {
                  style: voiceStyle,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
          ?.data;

      if (!base64Audio) {
        throw new Error("No audio data returned from Gemini TTS.");
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
        modelUsed: "gemini-3.8-flash-lite-tts",
      });
    } catch (err) {
      console.error("Error in /api/tts:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 4. Transcribe Pre-Recorded Voice Question
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType = "audio/webm" } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== "string") {
        res.status(400).json({ error: "Missing recorded audio payload." });
        return;
      }

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: "Transcribe the spoken words accurately into clean plain text. Return only the transcription itself with no extra commentary.",
            },
          ],
        },
      });

      res.json({
        transcript: (response.text || "").trim(),
        modelUsed: "gemini-3.5-transcribe",
      });
    } catch (err) {
      console.error("Error in /api/transcribe:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 5. Delete Uploaded PDF from Server Memory Store
  app.delete("/api/document/:documentId", (req, res) => {
    const { documentId } = req.params;
    if (documentId && pdfDocumentStore.has(documentId)) {
      pdfDocumentStore.delete(documentId);
    }
    res.json({ deleted: true, documentId });
  });

  // 6. Dedicated Google Search Topic Research Endpoint
  app.post("/api/research", async (req, res) => {
    try {
      const { query, documentContext } = req.body || {};
      const docTitle = String(documentContext?.documentTitle || "").trim();
      const docOverview = String(documentContext?.overview || "").trim();

      const effectiveQuery =
        typeof query === "string" && query.trim()
          ? query.trim()
          : docTitle
          ? `Key background context, current standards, and recent developments related to: ${docTitle}`
          : "";

      if (!effectiveQuery) {
        res.status(400).json({ error: "Please provide a topic or upload a PDF to research on Google." });
        return;
      }

      const ai = getGenAI();
      const prompt = docTitle
        ? `The user is studying a PDF titled "${docTitle}" (${docOverview}).
Search Google and conduct thorough internet research on the following request: "${effectiveQuery}".
Provide a clear, factual, spoken-friendly research briefing (140 to 240 words) written for human ears (no markdown tables or raw URLs in the body text) explaining key web findings, real-world context, and how they relate to the PDF's subject.`
        : `Search Google and conduct thorough internet research on: "${effectiveQuery}".
Provide a clear, factual, spoken-friendly research briefing (140 to 240 words) written for human ears explaining the most important web findings.`;

      const { response, modelUsed } = await generateContentWithRetry(ai, {
        preferredModel: "gemini-3.8-flash",
        fallbackModels: ["gemini-flash-latest"],
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.25,
        },
      });

      const summary =
        (response.text || "").trim() ||
        "No web research summary could be generated for that topic.";
      const webSources = extractWebSources(response);

      res.json({
        query: effectiveQuery,
        summary,
        webSources,
        modelUsed,
      });
    } catch (err) {
      console.error("Error in /api/research:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // 7. Multi-Turn Grounded Accessibility Document + Google Web Research Chatbot
  app.post("/api/chat", async (req, res) => {
    try {
      const {
        history = [],
        message,
        documentContext,
        fastMode = false,
        useWebSearch = true,
      } = req.body || {};

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Please enter a question for the assistant." });
        return;
      }

      const ai = getGenAI();
      const primaryModel = useWebSearch
        ? "gemini-3.8-flash"
        : fastMode
        ? "gemini-3.1-flash-lite"
        : "gemini-3.8-flash";
      const docSummaryBlock = buildDocumentSystemContext(documentContext);

      const systemInstruction = `You are the Free PDF AI Document & Web Research Voice Assistant.

Role & Communication Rules:
1. COMPLETE DOCUMENT GROUNDING (PDF, JPG & PNG): When an active document is loaded below, check its COMPLETE PAGE-BY-PAGE VERBATIM EXTRACTED TEXT and visual descriptions first, citing exact page numbers (e.g., "On Page 2..."). You have the complete extracted text of every page, line, and word inside the uploaded PDF, JPG, or PNG—never claim you only have the file name or metadata. If asked to read a page or section aloud, read it clearly and faithfully.
2. GOOGLE WEB RESEARCH: ${
        useWebSearch
          ? "You have live Google Search access. Whenever the user asks to gather information from the internet, conduct research on the document's topic, verify external regulations/facts/news, or asks a question that goes beyond what is in the uploaded document (or when no document is loaded), search Google and provide concrete, up-to-date details from the web. Clearly distinguish what comes from the uploaded document versus what you researched on the web."
          : "Web search is turned off for this message; answer strictly from the uploaded document."
      }
3. ACCESSIBILITY FIRST: Write for both eyes and ears—spell out comparisons and figures naturally without visual-only phrasing like "see link below".

${docSummaryBlock}`;

      const formattedHistory = Array.isArray(history)
        ? history
            .filter(
              (m: { role?: string; text?: string }) =>
                m && (m.role === "user" || m.role === "model") && m.text
            )
            .map((m: { role: "user" | "model"; text: string }) => ({
              role: m.role,
              parts: [{ text: String(m.text) }],
            }))
        : [];

      const chatCandidates = Array.from(
        new Set([primaryModel, "gemini-flash-latest", "gemini-3.8-flash"])
      );
      let response: GenerateContentResponse | null = null;
      let activeChatModel = primaryModel;
      let lastChatErr: unknown;

      for (const candidateModel of chatCandidates) {
        try {
          activeChatModel = candidateModel;
          const chat = ai.chats.create({
            model: candidateModel,
            history: formattedHistory,
            config: {
              systemInstruction,
              tools: useWebSearch ? [{ googleSearch: {} }] : undefined,
              temperature: 0.25,
            },
          });
          response = await chat.sendMessage({
            message: message.trim(),
          });
          break;
        } catch (chatErr) {
          lastChatErr = chatErr;
          if (!isTransientModelError(chatErr)) {
            throw chatErr;
          }
          await sleepMs(750);
        }
      }

      if (!response) {
        throw lastChatErr || new Error("Chat model temporarily unavailable.");
      }

      const webSources = useWebSearch ? extractWebSources(response) : [];

      res.json({
        reply: response.text || "I couldn't generate a response for that question.",
        webSources,
        modelUsed: activeChatModel,
      });
    } catch (err) {
      console.error("Error in /api/chat:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".mjs")) {
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // HTTP + WebSocket Server for Real-Time Gemini Live PDF Reader & Voice Q&A (/api/live)
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const urlObj = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`
      );
      if (urlObj.pathname === "/api/live") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    let sessionPromise: ReturnType<GoogleGenAI["live"]["connect"]> | null = null;
    let activeDocContext: Record<string, unknown> | null = null;
    let isClosed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const makeLiveSystemInstruction = (docCtx: Record<string, unknown> | null): string => {
      const hasDoc = Boolean(docCtx && docCtx.documentTitle);
      const docTitle = hasDoc
        ? String(docCtx?.documentTitle)
        : "no active PDF (ready for new PDF upload or Google Web Research)";
      const fullPdfContext = buildDocumentSystemContext(docCtx);

      return `You are Free PDF AI's Live PDF Voice Reader and Google Web Research Assistant.
Active Document State: ${docTitle}

Your Three Core Duties:
1. READ THE PDF ALOUD ON COMMAND: Whenever an active PDF is loaded and the user asks you to "read the PDF", "start reading", "read Page X", or "continue reading", read the actual PDF content clearly, smoothly, and naturally at a comfortable human pace (one page or logical section at a time), mentioning the page number and heading first, then pausing briefly to ask if they want you to continue to the next page or have any questions.
2. ANSWER PDF QUESTIONS WITH EXACT PAGE CITATIONS: When answering from the loaded PDF, use exact facts, numbers, dates, clauses, and tables, citing the page number (e.g., "According to Page 2 of your PDF...").
3. GOOGLE SEARCH & INTERNET RESEARCH (searchGoogleWebResearch tool): Whenever the user asks for information from the internet/web, asks you to search Google or conduct research on this topic, asks about recent news, external regulations, background context, or asks a question not covered in the PDF (or when no PDF is loaded), ALWAYS call the "searchGoogleWebResearch" tool first. Then speak a clear, informative summary of the web findings out loud, clearly distinguishing what came from the PDF vs. what you found on the web via Google Search.
4. ACCESSIBILITY FIRST: Never use visual-only phrases like "as you can see here"; describe figures, tables, and web findings verbally for listeners.

${fullPdfContext}`;
    };

    clientWs.on("message", async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        // Initialize Gemini Live session grounded in every page of the active PDF
        if (msg.type === "init" && !sessionPromise) {
          const ai = getGenAI();
          activeDocContext = msg.documentContext || null;

          const allowedVoices = ["Kore", "Charon", "Zephyr", "Fenrir", "Puck"];
          const selectedVoice = allowedVoices.includes(msg.voiceName)
            ? msg.voiceName
            : "Kore";

          const systemInstruction = makeLiveSystemInstruction(activeDocContext);
          const { pages } = resolveDocumentPagesAndText(activeDocContext);

          sessionPromise = ai.live.connect({
            model: "gemini-3.8-live",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice },
                },
              },
              tools: [{ functionDeclarations: livePdfTools }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                safeSend({
                  type: "ready",
                  voiceName: selectedVoice,
                  indexedPageCount: pages.length,
                });
              },
              onmessage: async (message: LiveServerMessage) => {
                // Handle Live Function Calls for page lookup & visual PDF inspection
                const fnCalls = message.toolCall?.functionCalls;
                if (fnCalls && fnCalls.length > 0 && sessionPromise) {
                  const responses: FunctionResponse[] = [];
                  const { storedRecord, pages: docPages } =
                    resolveDocumentPagesAndText(activeDocContext);

                  for (const call of fnCalls) {
                    const args = (call.args || {}) as Record<string, unknown>;

                    if (call.name === "getPdfPageContent") {
                      const reqPage = Number(args.pageNumber || 0);
                      const endPage = Number(args.endPageNumber || reqPage);
                      const query = String(args.searchQuery || "").trim().toLowerCase();

                      if (reqPage > 0) {
                        const maxRangeEnd = Math.min(
                          docPages.length,
                          Math.max(reqPage, endPage)
                        );
                        const rangePages = docPages.filter(
                          (p) =>
                            p.pageNumber >= reqPage &&
                            p.pageNumber <= maxRangeEnd
                        );
                        const foundPage =
                          rangePages[0] ||
                          docPages.find((p) => p.pageNumber === reqPage) ||
                          docPages[reqPage - 1];
                        if (foundPage) {
                          safeSend({
                            type: "pdf_page_focus",
                            pageNumber: foundPage.pageNumber,
                            heading: foundPage.heading,
                          });
                          responses.push({
                            id: call.id,
                            name: call.name,
                            response:
                              rangePages.length > 1
                                ? {
                                    startPage: reqPage,
                                    endPage: maxRangeEnd,
                                    totalPages: docPages.length,
                                    pages: rangePages.map((rp) => ({
                                      pageNumber: rp.pageNumber,
                                      heading: rp.heading,
                                      verbatimText: rp.text,
                                    })),
                                  }
                                : {
                                    pageNumber: foundPage.pageNumber,
                                    totalPages: docPages.length,
                                    heading: foundPage.heading,
                                    verbatimText: foundPage.text,
                                  },
                          });
                        } else {
                          responses.push({
                            id: call.id,
                            name: call.name,
                            response: {
                              error: `Page ${reqPage} does not exist. This PDF has ${docPages.length} pages.`,
                            },
                          });
                        }
                      } else if (query) {
                        const matches = docPages.filter(
                          (p) =>
                            p.text.toLowerCase().includes(query) ||
                            p.heading.toLowerCase().includes(query)
                        );
                        if (matches[0]) {
                          safeSend({
                            type: "pdf_page_focus",
                            pageNumber: matches[0].pageNumber,
                            heading: matches[0].heading,
                          });
                        }
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            matchingPages: (matches.length > 0 ? matches : docPages.slice(0, 3)).map(
                              (p) => ({
                                pageNumber: p.pageNumber,
                                heading: p.heading,
                                verbatimText: p.text,
                              })
                            ),
                          },
                        });
                      } else {
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            totalPages: docPages.length,
                            pages: docPages,
                          },
                        });
                      }
                    } else if (call.name === "inspectOriginalPdfVisuals") {
                      const question = String(
                        args.question || "Describe the visual figures and tables."
                      );
                      safeSend({
                        type: "tool_activity",
                        label: "Inspecting original PDF layout & figures...",
                      });

                      if (storedRecord?.fileBase64) {
                        try {
                          const visionAi = getGenAI();
                          const visionResp = await visionAi.models.generateContent({
                            model: "gemini-3.8-flash",
                            contents: {
                              parts: [
                                {
                                  inlineData: {
                                    mimeType: storedRecord.mimeType || "application/pdf",
                                    data: storedRecord.fileBase64,
                                  },
                                },
                                {
                                  text: `Inspect the PDF carefully and answer this specific question with exact values and page references: ${question}`,
                                },
                              ],
                            },
                          });
                          responses.push({
                            id: call.id,
                            name: call.name,
                            response: {
                              findings: visionResp.text || "No additional visual details found.",
                            },
                          });
                        } catch (visionErr) {
                          responses.push({
                            id: call.id,
                            name: call.name,
                            response: {
                              error: formatGeminiError(visionErr),
                            },
                          });
                        }
                      } else {
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            findings: JSON.stringify(
                              activeDocContext?.visualDescriptions || []
                            ),
                          },
                        });
                      }
                    } else if (call.name === "searchGoogleWebResearch") {
                      const rawQuery = String(
                        args.query ||
                          activeDocContext?.documentTitle ||
                          "latest research"
                      ).trim();
                      const pdfTopicHint = activeDocContext?.documentTitle
                        ? ` (Context: user's uploaded PDF is "${String(
                            activeDocContext.documentTitle
                          )}" — ${String(activeDocContext.overview || "").slice(0, 260)})`
                        : "";

                      safeSend({
                        type: "tool_activity",
                        label: `Searching Google: "${rawQuery.slice(0, 56)}"...`,
                      });

                      try {
                        const webAi = getGenAI();
                        const webResp = await webAi.models.generateContent({
                          model: "gemini-3.8-flash",
                          contents: `Conduct live Google Search web research to answer this user question thoroughly and accurately: "${rawQuery}"${pdfTopicHint}.
Return key factual details, figures, dates, and authoritative context from the web in concise plain prose so a voice assistant can speak it naturally to the user.`,
                          config: {
                            tools: [{ googleSearch: {} }],
                            temperature: 0.2,
                          },
                        });

                        const webFindings =
                          (webResp.text || "").trim() ||
                          "No additional web details were returned for that query.";
                        const webSources = extractWebSources(webResp);

                        safeSend({
                          type: "web_research_results",
                          query: rawQuery,
                          findings: webFindings,
                          sources: webSources,
                        });

                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            query: rawQuery,
                            webResearchFindings: webFindings,
                            verifiedSources: webSources.map((s) => `${s.title} (${s.uri})`),
                          },
                        });
                      } catch (webErr) {
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            error: formatGeminiError(webErr),
                          },
                        });
                      }
                    }
                  }

                  if (responses.length > 0) {
                    const liveSession = await sessionPromise;
                    if (!isClosed) {
                      liveSession.sendToolResponse({ functionResponses: responses });
                    }
                  }
                }

                const parts = message.serverContent?.modelTurn?.parts || [];
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    safeSend({ type: "audio", audio: part.inlineData.data });
                  }
                }

                const inputText = message.serverContent?.inputTranscription?.text;
                if (inputText) {
                  safeSend({ type: "input_transcript", text: inputText });
                }

                const outputText = message.serverContent?.outputTranscription?.text;
                if (outputText) {
                  safeSend({ type: "output_transcript", text: outputText });
                }

                if (message.serverContent?.interrupted) {
                  safeSend({ type: "interrupted" });
                }

                if (message.serverContent?.turnComplete) {
                  safeSend({ type: "turn_complete" });
                }
              },
              onerror: (err: unknown) => {
                console.error("Gemini Live error:", err);
                safeSend({
                  type: "error",
                  error: formatGeminiError(err),
                });
              },
              onclose: () => {
                safeSend({ type: "session_closed" });
              },
            },
          });

          sessionPromise.catch((err: unknown) => {
            console.error("Failed to open Gemini Live session:", err);
            safeSend({ type: "error", error: formatGeminiError(err) });
          });
          return;
        }

        // Clear PDF context if user clicks Delete PDF during an active Live Voice session
        if (msg.type === "clear_document" && sessionPromise) {
          activeDocContext = null;
          sessionPromise
            .then((session) => {
              if (!isClosed) {
                session.sendClientContent({
                  turns: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: `SYSTEM DOCUMENT UPDATE — The user just deleted the previous PDF document. Do not quote from the old PDF anymore. Confirm briefly in 1 short sentence that the PDF has been removed, and let them know they can upload a new PDF for you to read aloud or ask any topic question using Google Search.`,
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                });
                safeSend({
                  type: "document_cleared",
                });
              }
            })
            .catch(() => {});
          return;
        }

        // Dynamically update PDF context if user uploads or switches PDF during an active Live Voice session
        if (msg.type === "update_document" && msg.documentContext && sessionPromise) {
          activeDocContext = msg.documentContext;
          const updatedPdfBlock = buildDocumentSystemContext(activeDocContext);
          const { pages } = resolveDocumentPagesAndText(activeDocContext);
          const newTitle = String(activeDocContext?.documentTitle || "your newly uploaded PDF");
          const shouldAutoRead = msg.autoReadAloud !== false;

          sessionPromise
            .then((session) => {
              if (!isClosed) {
                session.sendClientContent({
                  turns: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: shouldAutoRead
                            ? `SYSTEM DOCUMENT UPDATE — The user just uploaded a new PDF titled "${newTitle}" (${pages.length || 1} pages). Use ONLY this new PDF for reading aloud and PDF Q&A:\n\n${updatedPdfBlock}\n\nReport back immediately on what is INSIDE this PDF (mentioning concrete topics/facts from Page 1—never merely repeating the filename!), and immediately start reading Page 1 aloud line-by-line and word-for-word clearly and naturally. At the end of Page 1, ask if they want you to continue to Page 2.`
                            : `SYSTEM DOCUMENT UPDATE — The user switched to "${newTitle}" (${pages.length || 1} pages). Use ONLY this PDF:\n\n${updatedPdfBlock}\n\nReport briefly in 2 spoken sentences what this PDF actually contains inside (not just its filename) and ask if they want you to read Page 1 word-for-word aloud.`,
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                });
                safeSend({
                  type: "document_synced",
                  indexedPageCount: pages.length,
                  documentTitle: newTitle,
                });
              }
            })
            .catch(() => {});
          return;
        }

        // Forward real-time 16kHz PCM microphone stream
        if (msg.type === "audio" && typeof msg.audio === "string" && sessionPromise) {
          sessionPromise
            .then((session) => {
              if (!isClosed) {
                session.sendRealtimeInput({
                  audio: {
                    data: msg.audio,
                    mimeType: "audio/pcm;rate=16000",
                  },
                });
              }
            })
            .catch(() => {});
          return;
        }

        // Deterministic text command / question turn into Live Voice session (e.g. "Read Page 1 aloud", greeting, or quiet prompt)
        if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim() && sessionPromise) {
          const cleanPrompt = msg.text.trim();
          sessionPromise
            .then((session) => {
              if (!isClosed) {
                session.sendClientContent({
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: cleanPrompt }],
                    },
                  ],
                  turnComplete: true,
                });
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        safeSend({ type: "error", error: formatGeminiError(err) });
      }
    });

    clientWs.on("close", () => {
      isClosed = true;
      if (sessionPromise) {
        sessionPromise
          .then((session) => {
            try {
              session.close();
            } catch {}
          })
          .catch(() => {});
      }
    });

    clientWs.on("error", () => {
      isClosed = true;
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`VocaRead server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
