import Tesseract from "tesseract.js";
import { PdfPageContent, UploadCategory } from "../types";

export interface OcrPageImageInput {
  pageNumber: number;
  mimeType: string;
  dataBase64: string;
}

const WATERMARK_NOISE_PATTERNS = [
  /^scanned\s+(?:by|with)\s+\w+/i,
  /^camscanner$/i,
  /^adobe\s+scan$/i,
  /^tapscanner$/i,
  /^page\s+\d+(?:\s+of\s+\d+)?$/i,
  /^www\.[a-z0-9.-]+\.[a-z]{2,}$/i,
];

const GENERIC_METADATA_TITLES = [
  /^untitled/i,
  /^document\d*$/i,
  /^microsoft\s+word\s*-/i,
  /^camscanner/i,
  /^scan[_\s-]*\d*/i,
  /^img[_\s-]*\d+/i,
  /^screenshot[_\s-]*\d*/i,
  /^whatsapp\s+image/i,
  /^image\d*$/i,
];

/**
 * Determines whether extracted text on a page represents genuine readable document content
 * rather than an empty layer, a scanner watermark, or garbled CID/font glyphs.
 */
export function isMeaningfulPageText(rawText: string): boolean {
  if (!rawText) return false;
  const trimmed = rawText.trim();
  if (trimmed.length < 24) return false;

  // Check for high ratio of replacement (\uFFFD) or control characters from unmapped PDF fonts
  const nonSpaceChars = trimmed.replace(/\s+/g, "");
  if (nonSpaceChars.length === 0) return false;

  let garbledCount = 0;
  let readableCharCount = 0;
  for (let i = 0; i < nonSpaceChars.length; i++) {
    const code = nonSpaceChars.charCodeAt(i);
    if (
      code === 0xfffd ||
      code < 32 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xe000 && code <= 0xf8ff) // Private Use Area glyphs often emitted by broken custom PDF fonts
    ) {
      garbledCount++;
    } else if (
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      code >= 0x00c0 // Extended Latin, Urdu/Arabic, Devanagari/Hindi, CJK, etc.
    ) {
      readableCharCount++;
    }
  }

  if (garbledCount / nonSpaceChars.length > 0.15) {
    return false;
  }
  if (readableCharCount / nonSpaceChars.length < 0.4) {
    return false;
  }

  // Strip common single-line scanner watermarks before counting real words
  const meaningfulLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !WATERMARK_NOISE_PATTERNS.some((rx) => rx.test(line))
    );

  const cleanedText = meaningfulLines.join(" ").trim();
  const words = cleanedText.split(/\s+/).filter((w) => w.length >= 2);
  return words.length >= 5;
}

/**
 * Infers a true human-meaningful title from the extracted text inside the document
 * rather than parroting raw filenames like "IMG_2049.JPG" or "scan_001.pdf".
 */
export function inferContentTitleFromPages(
  pages: PdfPageContent[],
  fallbackFileName: string,
  metadataTitle?: string
): string {
  const cleanFileStem = fallbackFileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();

  if (
    metadataTitle &&
    metadataTitle.trim().length >= 4 &&
    !GENERIC_METADATA_TITLES.some((rx) => rx.test(metadataTitle.trim())) &&
    metadataTitle.trim().toLowerCase() !== fallbackFileName.toLowerCase()
  ) {
    return metadataTitle.trim().slice(0, 110);
  }

  for (const page of pages) {
    if (!page?.text) continue;
    const candidateLines = page.text
      .split(/\r?\n/)
      .map((l) => l.replace(/[|;{}[\]<>~`]+/g, " ").replace(/\s+/g, " ").trim())
      .filter(
        (l) =>
          l.length >= 4 &&
          !/^\d+$/.test(l) &&
          !l.startsWith("[Interactive PDF Form") &&
          !l.startsWith("[Form Fields]") &&
          !WATERMARK_NOISE_PATTERNS.some((rx) => rx.test(l))
      );

    if (candidateLines.length > 0) {
      const cleanLine =
        candidateLines.find(
          (l) =>
            l.length >= 6 &&
            l.length <= 85 &&
            /^[A-Za-z0-9\u00C0-\uFFFF][A-Za-z0-9\u00C0-\uFFFF\s.,:'"?!()&/-]+$/.test(l)
        ) || candidateLines[0];
      if (cleanLine.length <= 95) {
        return cleanLine;
      }
      const firstClause = cleanLine.split(/[.:;—–-]\s+/)[0]?.trim() || "";
      if (firstClause.length >= 6 && firstClause.length <= 95) {
        return firstClause;
      }
      return `${cleanLine.slice(0, 92).trim()}...`;
    }
  }

  return cleanFileStem || "Uploaded Document";
}

export function inferHeadingForOcrPage(
  pageText: string,
  pageNumber: number
): string {
  if (!pageText) return `Page ${pageNumber}`;
  const firstLine = pageText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length >= 3 &&
        !/^\d+$/.test(l) &&
        !WATERMARK_NOISE_PATTERNS.some((rx) => rx.test(l))
    );
  if (!firstLine) return `Page ${pageNumber}`;
  return firstLine.length <= 85
    ? firstLine
    : `${firstLine.slice(0, 82).trim()}...`;
}

const TESSERACT_LANG_MAP: Record<string, string> = {
  English: "eng",
  Urdu: "urd+eng",
  Hindi: "hin+eng",
  Spanish: "spa+eng",
  French: "fra+eng",
  German: "deu+eng",
  Portuguese: "por+eng",
  Japanese: "jpn+eng",
};

/**
 * Local WebAssembly Tesseract.js OCR fallback so JPG, PNG, and scanned PDF pages
 * still extract full-page text even if cloud Vision OCR is temporarily busy or offline.
 */
export async function recognizeImagesWithBrowserTesseract(
  snapshots: OcrPageImageInput[],
  targetLanguage = "English",
  onProgress?: (label: string) => void
): Promise<PdfPageContent[]> {
  if (snapshots.length === 0) return [];
  const langCode = TESSERACT_LANG_MAP[targetLanguage] || "eng";
  const results: PdfPageContent[] = [];

  let worker: Tesseract.Worker | null = null;
  try {
    worker = await Tesseract.createWorker(langCode);
  } catch {
    try {
      worker = await Tesseract.createWorker("eng");
    } catch {
      worker = null;
    }
  }

  try {
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      onProgress?.(
        `Running full-page local OCR on page ${snap.pageNumber} (${i + 1} of ${snapshots.length})...`
      );
      const dataUrl = `data:${snap.mimeType || "image/jpeg"};base64,${snap.dataBase64}`;
      try {
        const res = worker
          ? await worker.recognize(dataUrl)
          : await Tesseract.recognize(dataUrl, "eng");
        const cleanText = (res?.data?.text || "")
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((line) => line.replace(/[ \t]+/g, " ").trim())
          .filter(
            (line, idx, arr) => line !== "" || (idx > 0 && arr[idx - 1] !== "")
          )
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        results.push({
          pageNumber: snap.pageNumber,
          heading: inferHeadingForOcrPage(cleanText, snap.pageNumber),
          text: cleanText,
        });
      } catch {
        results.push({
          pageNumber: snap.pageNumber,
          heading: `Page ${snap.pageNumber}`,
          text: "",
        });
      }
    }
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Ignore worker termination cleanup errors
      }
    }
  }

  return results;
}

/**
 * Full-page text recognition pipeline for scanned PDF pages, JPGs, and PNGs:
 * 1. Sends progressive batches of high-resolution page snapshots to `/api/ocr-pages`
 *    (Gemini Multimodal Vision OCR with server-side multi-model retry + server Tesseract backup).
 * 2. Automatically falls back to in-browser Tesseract.js WebAssembly OCR for any page
 *    that still lacks extracted text.
 */
export async function recognizePageSnapshotsFullText(params: {
  fileName: string;
  snapshots: OcrPageImageInput[];
  uploadCategory?: UploadCategory;
  targetLanguage?: string;
  onProgress?: (label: string) => void;
}): Promise<PdfPageContent[]> {
  const {
    fileName,
    snapshots,
    uploadCategory = "pdf",
    targetLanguage = "English",
    onProgress,
  } = params;

  if (snapshots.length === 0) return [];

  const BATCH_SIZE = 4;
  const recognizedByPage = new Map<number, PdfPageContent>();

  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const firstP = batch[0].pageNumber;
    const lastP = batch[batch.length - 1].pageNumber;
    const rangeLabel =
      batch.length === 1 ? `page ${firstP}` : `pages ${firstP}–${lastP}`;

    onProgress?.(
      snapshots.length === 1 &&
        (uploadCategory === "image" || uploadCategory === "written_photo")
        ? `AI Vision scanning & extracting complete text from ${fileName}...`
        : `AI Full-Page OCR scanning ${rangeLabel} (${Math.min(
            snapshots.length,
            i + BATCH_SIZE
          )} of ${snapshots.length} scanned pages)...`
    );

    try {
      const response = await fetch("/api/ocr-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          uploadCategory,
          targetLanguage,
          pageImages: batch,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          pages?: Array<{
            pageNumber?: number;
            heading?: string;
            text?: string;
          }>;
        };

        if (Array.isArray(data.pages)) {
          data.pages.forEach((p, idx) => {
            const fallbackPageNum =
              batch[idx]?.pageNumber ?? Number(p.pageNumber || idx + 1);
            const resolvedPageNum = batch.some(
              (b) => b.pageNumber === Number(p.pageNumber)
            )
              ? Number(p.pageNumber)
              : fallbackPageNum;
            const text = String(p.text || "").trim();
            if (text.length > 0) {
              recognizedByPage.set(resolvedPageNum, {
                pageNumber: resolvedPageNum,
                heading:
                  String(p.heading || "").trim() ||
                  inferHeadingForOcrPage(text, resolvedPageNum),
                text,
              });
            }
          });
        }
      }
    } catch {
      // Browser Tesseract fallback below will handle any unrecognized pages in this batch
    }
  }

  const missingSnapshots = snapshots.filter((snap) => {
    const existing = recognizedByPage.get(snap.pageNumber);
    return !existing || existing.text.trim().length === 0;
  });

  if (missingSnapshots.length > 0) {
    const localOcrPages = await recognizeImagesWithBrowserTesseract(
      missingSnapshots,
      targetLanguage,
      onProgress
    );
    for (const lp of localOcrPages) {
      if (lp.text.trim().length > 0) {
        recognizedByPage.set(lp.pageNumber, lp);
      }
    }
  }

  return snapshots.map((snap) => {
    const found = recognizedByPage.get(snap.pageNumber);
    return (
      found || {
        pageNumber: snap.pageNumber,
        heading: `Page ${snap.pageNumber}`,
        text: "",
      }
    );
  });
}
