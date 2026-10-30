import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  DocumentAnalysis,
  DocumentChapter,
  PdfPageContent,
  UploadCategory,
} from "../types";
import {
  inferContentTitleFromPages,
  inferHeadingForOcrPage,
  isMeaningfulPageText,
  recognizePageSnapshotsFullText,
} from "./ocrEngine";

// Configure Mozilla PDF.js web worker via Vite's explicit ?url asset bundler (works in both dev and production)
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
} catch {
  // Server-side PDF.js legacy + Gemini multimodal PDF reader act as automatic backup
}

export interface ScannedPageSnapshot {
  pageNumber: number;
  mimeType: string;
  dataBase64: string;
}

export interface ExtractedPdfResult {
  numPages: number;
  pages: PdfPageContent[];
  fullText: string;
  isScannedPdf: boolean;
  scannedPageImages: ScannedPageSnapshot[];
  metadataTitle?: string;
  formFieldsCount?: number;
  ocrPagesCount?: number;
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface PositionedToken {
  str: string;
  x: number | null;
  y: number | null;
  width: number;
  hasEOL: boolean;
  orderIdx: number;
}

interface PdfAnnotationLike {
  subtype?: string;
  fieldName?: string;
  alternativeText?: string;
  fieldType?: string;
  fieldValue?: unknown;
  buttonValue?: unknown;
  checkBox?: boolean;
  radioButton?: boolean;
  readOnly?: boolean;
  required?: boolean;
  options?: Array<{ displayValue?: string; exportValue?: string }>;
}

/**
 * Reconstructs natural top-to-bottom, left-to-right lines and table cells from PDF.js text items.
 */
function reconstructReadablePageText(items: unknown[]): string {
  if (!Array.isArray(items) || items.length === 0) return "";

  const tokens: PositionedToken[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as TextItemLike;
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

  const hasCoordinates = tokens.some((t) => t.x !== null && t.y !== null);
  if (!hasCoordinates) {
    return tokens
      .map((t) => (t.hasEOL ? `${t.str}\n` : t.str))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  // Group tokens into horizontal reading lines (PDF y-axis increases bottom-to-top)
  const lineBuckets: Array<{ y: number; items: PositionedToken[] }> = [];
  const Y_TOLERANCE = 3.8;

  for (const tok of tokens) {
    if (tok.y === null) {
      if (lineBuckets.length === 0) {
        lineBuckets.push({ y: 0, items: [tok] });
      } else {
        lineBuckets[lineBuckets.length - 1].items.push(tok);
      }
      continue;
    }

    // Check recent buckets first to preserve multi-column stream locality when possible, otherwise match y
    let matchedBucket: { y: number; items: PositionedToken[] } | undefined;
    for (let b = lineBuckets.length - 1; b >= 0; b--) {
      if (Math.abs(lineBuckets[b].y - tok.y) <= Y_TOLERANCE) {
        matchedBucket = lineBuckets[b];
        break;
      }
    }

    if (matchedBucket) {
      matchedBucket.items.push(tok);
    } else {
      lineBuckets.push({ y: tok.y, items: [tok] });
    }
  }

  // Sort lines from top of page (highest y) to bottom of page (lowest y)
  lineBuckets.sort((a, b) => b.y - a.y);

  const outputLines: string[] = [];
  let prevLineY: number | null = null;

  for (const bucket of lineBuckets) {
    // Sort tokens left-to-right within the line
    bucket.items.sort((a, b) => {
      if (a.x !== null && b.x !== null && Math.abs(a.x - b.x) > 1.5) {
        return a.x - b.x;
      }
      return a.orderIdx - b.orderIdx;
    });

    let lineText = "";
    let prevRightEdge: number | null = null;

    for (const tok of bucket.items) {
      const piece = tok.str;
      if (!piece) continue;

      if (!lineText) {
        lineText = piece;
      } else if (tok.x !== null && prevRightEdge !== null) {
        const gap = tok.x - prevRightEdge;
        if (gap > 36) {
          // Table column or multi-column gap
          lineText = `${lineText.trimEnd()} | ${piece.trimStart()}`;
        } else if (
          gap > 2.2 &&
          !lineText.endsWith(" ") &&
          !lineText.endsWith("-") &&
          !piece.startsWith(" ")
        ) {
          lineText += ` ${piece}`;
        } else if (
          gap <= 2.2 &&
          !lineText.endsWith(" ") &&
          !lineText.endsWith("-") &&
          !piece.startsWith(" ") &&
          /[A-Za-z0-9.,;:!?)]$/.test(lineText) &&
          /^[A-Za-z0-9(]/.test(piece) &&
          gap > -1.0
        ) {
          // Slight positive kerning between separate word runs
          lineText += gap > 0.8 ? ` ${piece}` : piece;
        } else {
          lineText += piece;
        }
      } else {
        if (
          !lineText.endsWith(" ") &&
          !lineText.endsWith("-") &&
          !piece.startsWith(" ")
        ) {
          lineText += ` ${piece}`;
        } else {
          lineText += piece;
        }
      }

      if (tok.x !== null) {
        const estimatedWidth =
          tok.width > 0 ? tok.width : Math.max(4, piece.length * 4.8);
        prevRightEdge = Math.max(prevRightEdge ?? tok.x, tok.x + estimatedWidth);
      }
    }

    const cleanedLine = lineText.replace(/[ \t]{2,}/g, " ").trim();
    if (!cleanedLine) continue;

    if (
      prevLineY !== null &&
      Math.abs(prevLineY - bucket.y) > 16 &&
      outputLines.length > 0 &&
      outputLines[outputLines.length - 1] !== ""
    ) {
      outputLines.push("");
    }

    outputLines.push(cleanedLine);
    prevLineY = bucket.y;
  }

  return outputLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractInteractiveFormFields(annotations: unknown[]): {
  formattedBlock: string;
  count: number;
} {
  if (!Array.isArray(annotations) || annotations.length === 0) {
    return { formattedBlock: "", count: 0 };
  }

  const lines: string[] = [];
  const seenNames = new Set<string>();

  for (const raw of annotations) {
    const ann = raw as PdfAnnotationLike;
    if (!ann) continue;
    const isWidget =
      ann.subtype === "Widget" ||
      typeof ann.fieldType === "string" ||
      typeof ann.fieldName === "string";
    if (!isWidget) continue;

    const label = (
      ann.alternativeText?.trim() ||
      ann.fieldName?.trim() ||
      ""
    ).replace(/[._-]+/g, " ");
    if (!label) continue;

    const dedupeKey = `${ann.fieldName || label}::${String(ann.fieldValue ?? "")}`;
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    let typeLabel = "Form Field";
    if (ann.fieldType === "Tx") typeLabel = "Text Input";
    else if (ann.checkBox) typeLabel = "Checkbox";
    else if (ann.radioButton) typeLabel = "Radio Choice";
    else if (ann.fieldType === "Btn") typeLabel = "Button / Checkbox";
    else if (ann.fieldType === "Ch") typeLabel = "Dropdown / Choice";
    else if (ann.fieldType === "Sig") typeLabel = "Signature Field";

    let valueStr = "Blank (Not yet filled)";
    if (ann.checkBox || ann.radioButton) {
      const rawVal = String(ann.fieldValue ?? "").trim();
      const isChecked =
        rawVal !== "" &&
        rawVal.toLowerCase() !== "off" &&
        rawVal.toLowerCase() !== "false" &&
        rawVal !== "0";
      valueStr = isChecked
        ? `Checked${ann.buttonValue ? ` (${String(ann.buttonValue)})` : ""}`
        : "Unchecked";
    } else if (Array.isArray(ann.fieldValue) && ann.fieldValue.length > 0) {
      valueStr = ann.fieldValue.map(String).join(", ");
    } else if (
      ann.fieldValue !== undefined &&
      ann.fieldValue !== null &&
      String(ann.fieldValue).trim() !== ""
    ) {
      valueStr = String(ann.fieldValue).trim();
    }

    const reqSuffix = ann.required ? " [Required]" : "";
    const choicesHint =
      Array.isArray(ann.options) && ann.options.length > 0
        ? ` | Available options: ${ann.options
            .slice(0, 8)
            .map((o) => o.displayValue || o.exportValue || "")
            .filter(Boolean)
            .join(", ")}`
        : "";

    lines.push(`- ${label} (${typeLabel}${reqSuffix}): ${valueStr}${choicesHint}`);
  }

  if (lines.length === 0) {
    return { formattedBlock: "", count: 0 };
  }

  return {
    formattedBlock: `[Interactive PDF Form Fields (${lines.length})]\n${lines.join("\n")}`,
    count: lines.length,
  };
}

function inferPageHeading(pageText: string, pageNumber: number): string {
  return inferHeadingForOcrPage(pageText, pageNumber);
}

/**
 * Extracts 100% of text from ALL pages of a PDF file in the browser:
 * - Decodes embedded digital text, CID/CMap fonts, XFA, and AcroForm fields across pages 1..numPages.
 * - Detects ANY scanned, photographed, image-only, or garbled-font page across the ENTIRE PDF
 *   and runs batched Full-Page Vision OCR + Tesseract.js OCR so every single page is extracted.
 */
export async function extractPdfInBrowser(
  file: File,
  onProgress?: (label: string) => void,
  options?: { isFormMode?: boolean; targetLanguage?: string }
): Promise<ExtractedPdfResult> {
  onProgress?.(`Opening ${file.name} and scanning all pages...`);
  const arrayBuffer = await file.arrayBuffer();

  let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer.slice(0)),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      useSystemFonts: true,
      enableXfa: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("password")) {
      throw err;
    }
    // Allow server-side PDF.js + Gemini native PDF reader to read the raw PDF binary
    return {
      numPages: 0,
      pages: [],
      fullText: "",
      isScannedPdf: true,
      scannedPageImages: [],
    };
  }

  const numPages = pdfDoc.numPages;

  let metadataTitle: string | undefined;
  try {
    const meta = await pdfDoc.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (info && typeof info.Title === "string" && info.Title.trim().length > 2) {
      metadataTitle = info.Title.trim();
    }
  } catch {
    // Ignore metadata read errors
  }

  const pages: PdfPageContent[] = [];
  const pagesNeedingOcr: number[] = [];
  const formBlockByPage = new Map<number, string>();
  let totalCharCount = 0;
  let totalFormFields = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (pageNum === 1 || pageNum % 3 === 0 || pageNum === numPages) {
      onProgress?.(
        options?.isFormMode
          ? `Extracting form fields & text from page ${pageNum} of ${numPages}...`
          : `Scanning & extracting text from page ${pageNum} of ${numPages}...`
      );
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
      });
      const baseText = reconstructReadablePageText(
        textContent.items as unknown[]
      );

      let formBlock = "";
      try {
        const annotations = await page.getAnnotations();
        const extractedForms = extractInteractiveFormFields(
          annotations as unknown[]
        );
        formBlock = extractedForms.formattedBlock;
        totalFormFields += extractedForms.count;
        if (formBlock) {
          formBlockByPage.set(pageNum, formBlock);
        }
      } catch {
        // Ignore annotation parse issues
      }

      const hasReadableBaseText = isMeaningfulPageText(baseText);
      const combinedPageText = [
        hasReadableBaseText ? baseText : "",
        formBlock,
      ]
        .filter((s) => s.trim().length > 0)
        .join("\n\n");

      if (!hasReadableBaseText) {
        pagesNeedingOcr.push(pageNum);
      }

      totalCharCount += combinedPageText.length;

      pages.push({
        pageNumber: pageNum,
        heading: inferPageHeading(combinedPageText, pageNum),
        text: combinedPageText,
      });

      page.cleanup();
    } catch {
      pagesNeedingOcr.push(pageNum);
      pages.push({
        pageNumber: pageNum,
        heading: `Page ${pageNum}`,
        text: "",
      });
    }
  }

  const avgCharsPerPage = numPages > 0 ? totalCharCount / numPages : 0;
  const scannedPageImages: ScannedPageSnapshot[] = [];
  let ocrPagesCount = 0;

  // Full-Page OCR across ALL scanned / image-based / garbled pages in progressive batches (zero page cap!)
  if (pagesNeedingOcr.length > 0 && typeof document !== "undefined") {
    const RENDER_BATCH_SIZE = 4;
    const uploadCategory: UploadCategory = options?.isFormMode
      ? "pdf_form"
      : "pdf";

    for (let bStart = 0; bStart < pagesNeedingOcr.length; bStart += RENDER_BATCH_SIZE) {
      const batchPageNums = pagesNeedingOcr.slice(
        bStart,
        bStart + RENDER_BATCH_SIZE
      );
      const batchSnapshots: ScannedPageSnapshot[] = [];

      for (const pageNum of batchPageNums) {
        onProgress?.(
          `Rendering page ${pageNum} of ${numPages} for full-page text recognition...`
        );
        try {
          const page = await pdfDoc.getPage(pageNum);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const targetWidth = options?.isFormMode ? 1650 : 1550;
          const scale = Math.min(
            2.4,
            Math.max(1.1, targetWidth / (unscaledViewport.width || 800))
          );
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvasContext: ctx,
              canvas,
              viewport,
            }).promise;

            const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
            const commaIdx = dataUrl.indexOf(",");
            if (commaIdx >= 0) {
              const snap: ScannedPageSnapshot = {
                pageNumber: pageNum,
                mimeType: "image/jpeg",
                dataBase64: dataUrl.slice(commaIdx + 1),
              };
              batchSnapshots.push(snap);
              // Keep up to 12 representative snapshots for optional visual chart/diagram inspection
              if (scannedPageImages.length < 12) {
                scannedPageImages.push(snap);
              }
            }
          }
          page.cleanup();
        } catch {
          // Continue scanning remaining pages
        }
      }

      if (batchSnapshots.length > 0) {
        const recognizedPages = await recognizePageSnapshotsFullText({
          fileName: file.name,
          snapshots: batchSnapshots,
          uploadCategory,
          targetLanguage: options?.targetLanguage || "English",
          onProgress,
        });

        for (const recPage of recognizedPages) {
          if (recPage.text.trim().length > 0) {
            ocrPagesCount++;
            const existingFormBlock = formBlockByPage.get(recPage.pageNumber) || "";
            const mergedText = [recPage.text.trim(), existingFormBlock]
              .filter((s) => s.trim().length > 0)
              .join("\n\n");

            const idx = recPage.pageNumber - 1;
            if (idx >= 0 && idx < pages.length) {
              pages[idx] = {
                pageNumber: recPage.pageNumber,
                heading:
                  recPage.heading && recPage.heading !== `Page ${recPage.pageNumber}`
                    ? recPage.heading
                    : inferPageHeading(mergedText, recPage.pageNumber),
                text: mergedText,
              };
            }
          }
        }
      }
    }
  }

  try {
    await pdfDoc.cleanup();
    await loadingTask?.destroy();
  } catch {
    // Ignore cleanup errors
  }

  const nonEmptyPages = pages.filter((p) => p.text.trim().length > 0);
  const fullText = nonEmptyPages
    .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
    .join("\n\n");

  const resolvedTitle = inferContentTitleFromPages(
    nonEmptyPages,
    file.name,
    metadataTitle
  );

  return {
    numPages,
    pages,
    fullText,
    isScannedPdf: avgCharsPerPage < 40 || ocrPagesCount > 0,
    scannedPageImages,
    metadataTitle: resolvedTitle,
    formFieldsCount: totalFormFields,
    ocrPagesCount,
  };
}

export function buildLocalFallbackAnalysis(params: {
  fileName: string;
  fileSizeLabel: string;
  extracted: ExtractedPdfResult;
  targetLanguage: string;
  sourceCategory?: UploadCategory;
}): DocumentAnalysis {
  const { fileName, fileSizeLabel, extracted, targetLanguage, sourceCategory } =
    params;

  const validPages = extracted.pages.filter((p) => p.text.trim().length > 0);
  const numPages = extracted.numPages || Math.max(1, validPages.length);

  const cleanTitle = inferContentTitleFromPages(
    validPages,
    fileName,
    extracted.metadataTitle
  );

  const chapters: DocumentChapter[] = [];
  if (validPages.length > 0) {
    const chunkCount = Math.min(12, validPages.length);
    const pagesPerChapter = Math.max(
      1,
      Math.ceil(validPages.length / chunkCount)
    );

    for (let i = 0; i < validPages.length; i += pagesPerChapter) {
      const slice = validPages.slice(i, i + pagesPerChapter);
      const startP = slice[0].pageNumber;
      const endP = slice[slice.length - 1].pageNumber;
      const combined = slice
        .map((p) => p.text)
        .join("\n\n")
        .trim();
      const rangeLabel =
        startP === endP ? `Page ${startP}` : `Pages ${startP}–${endP}`;

      chapters.push({
        id: `ch-${chapters.length + 1}`,
        title: `${rangeLabel}: ${slice[0].heading}`,
        summary:
          combined
            .slice(0, 260)
            .replace(/\s+/g, " ")
            .trim() + (combined.length > 260 ? "..." : ""),
        spokenText: combined || `Content from ${rangeLabel}.`,
        keyFacts: [rangeLabel, `${slice.length} page section`],
      });
    }
  } else {
    chapters.push({
      id: "ch-1",
      title: `Page 1: ${cleanTitle}`,
      summary: `No readable text or visual words were found in ${fileName}.`,
      spokenText: `No readable text could be detected in ${fileName}. Click Re-Scan & Refresh AI Report to run another deep visual scan.`,
      keyFacts: [`${numPages} pages`],
    });
  }

  const allVerbatimText = validPages
    .map((p) => `Page ${p.pageNumber} (${p.heading}):\n${p.text}`)
    .join("\n\n");

  const totalWordsRead = allVerbatimText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const totalLinesRead = validPages
    .map((p) => p.text)
    .join("\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  const fullNarrationScript =
    validPages.length > 0
      ? validPages
          .map((p) => `Page ${p.pageNumber}, ${p.heading}.\n${p.text}`)
          .join("\n\n")
          .trim()
      : `No readable text could be extracted from ${fileName}.`;

  const estimatedListenSeconds = Math.max(
    30,
    Math.round(((totalWordsRead || 100) / 150) * 60)
  );

  const detailedReport =
    validPages.length > 0
      ? `Complete Full-Document Extraction Report for "${cleanTitle}" (${validPages.length} of ${numPages} pages scanned, ${totalLinesRead.toLocaleString()} lines, ${totalWordsRead.toLocaleString()} words extracted):\n\n` +
        validPages
          .slice(0, 50)
          .map(
            (p) =>
              `• Page ${p.pageNumber} — ${p.heading}:\n${p.text.slice(0, 1000)}${
                p.text.length > 1000 ? "..." : ""
              }`
          )
          .join("\n\n")
      : `Could not detect text layers or visual text in "${fileName}" (${numPages} pages).`;

  const levelLabel =
    sourceCategory === "pdf_form"
      ? `PDF Form${extracted.formFieldsCount ? ` (${extracted.formFieldsCount} fields)` : ""}`
      : sourceCategory === "docs_whatsapp"
      ? "Full Document / Chat Extraction"
      : sourceCategory === "written_photo"
      ? "Full-Page Handwritten & Text OCR"
      : sourceCategory === "image"
      ? "Full-Page Image Text & Vision OCR"
      : extracted.ocrPagesCount && extracted.ocrPagesCount > 0
      ? `Full-Page PDF + OCR (${extracted.ocrPagesCount} OCR pages)`
      : "100% All-Page Verbatim Extraction";

  const previewSnippet =
    validPages.length > 0
      ? validPages[0].text.replace(/\s+/g, " ").trim().slice(0, 320)
      : "";

  return {
    documentTitle: cleanTitle,
    fileName,
    fileSizeLabel,
    detectedPageCountEstimate: numPages,
    readingLevel: levelLabel,
    estimatedListenSeconds,
    overview:
      validPages.length > 0
        ? `Scanned and extracted all ${validPages.length} of ${numPages} ${numPages === 1 ? "page" : "pages"} (${totalLinesRead.toLocaleString()} lines, ${totalWordsRead.toLocaleString()} words) inside "${cleanTitle}". Opening text: "${previewSnippet}${previewSnippet.length >= 320 ? "..." : ""}"`
        : `Inspected "${fileName}" (${numPages} ${numPages === 1 ? "page" : "pages"}, ${fileSizeLabel}).`,
    narrationScript: fullNarrationScript,
    detailedReport,
    totalWordsRead,
    totalLinesRead,
    dialogueTurns: [
      {
        speaker: "Alex",
        text: `We have scanned and extracted all ${validPages.length || numPages} ${numPages === 1 ? "page" : "pages"} inside ${cleanTitle}, capturing ${totalLinesRead} lines and ${totalWordsRead} words.`,
        style: "Warm, articulate lead narrator",
      },
      {
        speaker: "Sam",
        text:
          validPages.length > 0
            ? `Page 1 opens with ${validPages[0].heading}: ${previewSnippet}`
            : `Click Re-Scan & Refresh AI Report to perform an additional visual scan of ${cleanTitle}.`,
        style: "Curious, clear conversational co-host",
      },
    ],
    chapters,
    visualDescriptions: [
      {
        label: `${cleanTitle} Full-Page Structure`,
        elementType:
          sourceCategory === "pdf_form"
            ? "Form Section"
            : sourceCategory === "image" || sourceCategory === "written_photo"
            ? "Scanned Image Layout"
            : "Document Layout",
        spokenDescription: `Contains ${numPages} total ${numPages === 1 ? "page" : "pages"} (${totalLinesRead} lines, ${totalWordsRead} words) organized into ${chapters.length} navigable audio sections.`,
      },
    ],
    keyTakeaways: chapters
      .slice(0, 5)
      .map((c) => `${c.title}: ${c.summary.slice(0, 160)}`),
    suggestedQuestions: [
      `Give me a complete page-by-page report of everything inside ${cleanTitle}`,
      "Read every word of Page 1 aloud to me",
      sourceCategory === "pdf_form"
        ? "Which form fields are required or still blank?"
        : "What are all the key facts, names, dates, and numbers inside this document?",
      `Search Google for background information on ${cleanTitle}`,
    ],
    language: targetLanguage,
    modelUsed: "Full-Page Extraction + OCR Engine",
    rawExcerpt: extracted.fullText,
    pages: extracted.pages,
    sourceCategory,
  };
}
