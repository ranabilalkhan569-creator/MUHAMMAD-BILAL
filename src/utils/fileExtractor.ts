import JSZip from "jszip";
import * as mammoth from "mammoth/mammoth.browser";
import { PdfPageContent, UploadCategory } from "../types";
import {
  ExtractedPdfResult,
  ScannedPageSnapshot,
  extractPdfInBrowser,
} from "./pdfExtractor";
import {
  inferContentTitleFromPages,
  recognizePageSnapshotsFullText,
} from "./ocrEngine";

export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per file

export const FORMAT_ACCEPT_MAP: Record<UploadCategory, string> = {
  pdf: ".pdf,application/pdf",
  image:
    ".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif,image/jpeg,image/png,image/webp,image/bmp,image/gif,image/*",
  written_photo:
    ".jpg,.jpeg,.png,.webp,.bmp,image/jpeg,image/png,image/webp,image/*",
  pdf_form:
    ".pdf,.xfdf,.fdf,.epub,application/pdf,application/vnd.adobe.xfdf,application/vnd.fdf,application/epub+zip",
  docs_whatsapp:
    ".docx,.doc,.rtf,.odt,.pptx,.xlsx,.csv,.tsv,.txt,.zip,.md,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/rtf,application/vnd.oasis.opendocument.text,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/zip",
};

export const ALL_SUPPORTED_FILE_ACCEPT = [
  FORMAT_ACCEPT_MAP.pdf,
  FORMAT_ACCEPT_MAP.image,
  FORMAT_ACCEPT_MAP.pdf_form,
  FORMAT_ACCEPT_MAP.docs_whatsapp,
].join(",");

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : "";
}

export function detectUploadCategory(
  file: File,
  preferred?: UploadCategory
): UploadCategory {
  const ext = getExtension(file.name);
  const mime = (file.type || "").toLowerCase();

  // Respect explicit button mode when file matches image or PDF form families
  if (preferred === "written_photo") {
    if (
      mime.startsWith("image/") ||
      [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"].includes(ext)
    ) {
      return "written_photo";
    }
  }

  if (preferred === "pdf_form") {
    if (
      mime === "application/pdf" ||
      [".pdf", ".xfdf", ".fdf", ".epub"].includes(ext)
    ) {
      return "pdf_form";
    }
  }

  if (
    mime.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"].includes(ext)
  ) {
    // Check filename hints for handwritten / notes / receipt / scan
    const lowerName = file.name.toLowerCase();
    if (
      lowerName.includes("note") ||
      lowerName.includes("handwrit") ||
      lowerName.includes("written") ||
      lowerName.includes("page") ||
      lowerName.includes("scan") ||
      lowerName.includes("receipt") ||
      lowerName.includes("letter")
    ) {
      return "written_photo";
    }
    return preferred === "written_photo" ? "written_photo" : "image";
  }

  if ([".xfdf", ".fdf", ".epub"].includes(ext)) {
    return "pdf_form";
  }

  if (mime === "application/pdf" || ext === ".pdf") {
    const lowerName = file.name.toLowerCase();
    if (
      preferred === "pdf_form" ||
      lowerName.includes("form") ||
      lowerName.includes("application") ||
      lowerName.includes("intake")
    ) {
      return "pdf_form";
    }
    return "pdf";
  }

  if (
    [
      ".docx",
      ".doc",
      ".rtf",
      ".odt",
      ".pptx",
      ".xlsx",
      ".csv",
      ".tsv",
      ".txt",
      ".zip",
      ".md",
      ".html",
      ".htm",
    ].includes(ext) ||
    mime.includes("word") ||
    mime.includes("officedocument") ||
    mime.includes("opendocument") ||
    mime.includes("zip") ||
    mime.startsWith("text/")
  ) {
    return "docs_whatsapp";
  }

  return preferred || "pdf";
}

function splitLongTextIntoPages(
  rawText: string,
  defaultHeadingPrefix = "Section"
): PdfPageContent[] {
  const cleaned = rawText.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const blocks = cleaned.split(/\n{2,}/);
  const pages: PdfPageContent[] = [];
  let current = "";
  let heading = `${defaultHeadingPrefix} 1`;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (!current) {
      const firstLine = trimmed.split("\n")[0].trim();
      heading =
        firstLine.length >= 3 && firstLine.length <= 85
          ? firstLine
          : `${defaultHeadingPrefix} ${pages.length + 1}`;
    }

    if (current.length + trimmed.length > 2200 && current.length > 0) {
      pages.push({
        pageNumber: pages.length + 1,
        heading,
        text: current.trim(),
      });
      const firstLine = trimmed.split("\n")[0].trim();
      heading =
        firstLine.length >= 3 && firstLine.length <= 85
          ? firstLine
          : `${defaultHeadingPrefix} ${pages.length + 1}`;
      current = trimmed;
    } else {
      current += (current ? "\n\n" : "") + trimmed;
    }
  }

  if (current.trim()) {
    pages.push({
      pageNumber: pages.length + 1,
      heading,
      text: current.trim(),
    });
  }

  return pages;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function stripXmlTagsToParagraphs(
  xml: string,
  paragraphTagRegex = /<\/(?:w:p|text:p|text:h|a:p|p|div|li|tr|h[1-6])>/gi
): string {
  const withBreaks = xml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<w:tab\s*\/?>/gi, "\t")
    .replace(paragraphTagRegex, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, "");

  return decodeXmlEntities(withBreaks)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, idx, arr) => line !== "" || (idx > 0 && arr[idx - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function renderImageBlobToSnapshot(
  blob: Blob,
  pageNumber: number,
  maxDimension: number,
  jpegQuality: number
): Promise<ScannedPageSnapshot> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image file."));
      el.src = objectUrl;
    });

    const origW = img.naturalWidth || img.width || 1200;
    const origH = img.naturalHeight || img.height || 1200;
    const largestSide = Math.max(origW, origH);
    const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;

    const targetW = Math.max(1, Math.round(origW * scale));
    const targetH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Browser canvas unavailable for image reading.");
    }

    // Fill crisp white background so transparent PNGs / handwritten ink render with high contrast
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    const commaIdx = dataUrl.indexOf(",");
    const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

    return {
      pageNumber,
      mimeType: "image/jpeg",
      dataBase64,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function parseWhatsAppTextIfApplicable(rawText: string, fileName: string): {
  isWhatsApp: boolean;
  formattedText: string;
  titleHint?: string;
} {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  // Match standard WhatsApp export patterns:
  // [12/05/2025, 10:32:15 AM] Ali: Salam...
  // 12/05/2025, 10:32 am - Ali: Salam...
  const waLineRegex =
    /^(?:\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\]?\s*(?:-\s*)?)([^:]{1,45}):\s*(.+)$/;

  let matchCount = 0;
  const participants = new Set<string>();
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/\u200e|\u200f/g, "").trim();
    if (!trimmed) continue;
    const match = trimmed.match(waLineRegex);
    if (match) {
      matchCount++;
      const sender = match[1].trim();
      const message = match[2].trim();
      if (
        !sender.toLowerCase().includes("messages and calls are end-to-end") &&
        sender.length <= 40
      ) {
        participants.add(sender);
      }
      cleanedLines.push(`${sender}: ${message}`);
    } else {
      cleanedLines.push(trimmed);
    }
  }

  const lowerFile = fileName.toLowerCase();
  const isWhatsApp =
    matchCount >= 2 ||
    lowerFile.includes("whatsapp") ||
    lowerFile === "_chat.txt";

  if (!isWhatsApp) {
    return { isWhatsApp: false, formattedText: rawText };
  }

  const participantList = Array.from(participants).slice(0, 12);
  const header = [
    `WhatsApp Chat Export: ${fileName}`,
    participantList.length > 0
      ? `Participants (${participantList.length}): ${participantList.join(", ")}`
      : "",
    `Total Parsed Messages: ${matchCount || cleanedLines.length}`,
    "--- Conversation Transcript ---",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    isWhatsApp: true,
    formattedText: `${header}\n\n${cleanedLines.join("\n\n")}`,
    titleHint:
      participantList.length > 0
        ? `WhatsApp Chat — ${participantList.slice(0, 3).join(", ")}`
        : `WhatsApp Chat — ${fileName.replace(/\.[^/.]+$/, "")}`,
  };
}

function parseXfdfForm(xmlText: string, fileName: string): PdfPageContent[] {
  const fieldRegex =
    /<field\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/field>/gi;
  const lines: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(xmlText)) !== null) {
    const fieldName = decodeXmlEntities(match[1]).replace(/[._-]+/g, " ");
    const inner = match[2];
    const valMatch = inner.match(/<value[^>]*>([\s\S]*?)<\/value>/i);
    const val = valMatch
      ? stripXmlTagsToParagraphs(valMatch[1]).trim()
      : "";
    lines.push(`- ${fieldName}: ${val || "Blank (Not filled)"}`);
  }

  const body =
    lines.length > 0
      ? `Adobe XFDF PDF Form Data (${fileName})\nTotal Form Fields: ${lines.length}\n\n${lines.join("\n")}`
      : stripXmlTagsToParagraphs(xmlText) || `XFDF Form File: ${fileName}`;

  return splitLongTextIntoPages(body, "Form Section");
}

function parseFdfForm(rawText: string, fileName: string): PdfPageContent[] {
  const pairRegex = /\/T\s*\(([^)]*)\)[\s\S]{0,180}?\/V\s*(?:\(([^)]*)\)|\/([^\s/>]+))/g;
  const lines: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pairRegex.exec(rawText)) !== null) {
    const name = match[1].replace(/\\([()\\])/g, "$1").trim();
    const val = (match[2] ?? match[3] ?? "").replace(/\\([()\\])/g, "$1").trim();
    if (name) {
      lines.push(`- ${name}: ${val || "Blank"}`);
    }
  }

  const body =
    lines.length > 0
      ? `Adobe FDF PDF Form Data (${fileName})\nTotal Form Fields: ${lines.length}\n\n${lines.join("\n")}`
      : `FDF Form File (${fileName})\n\n${rawText
          .replace(/[^\x20-\x7E\n\r\t]/g, " ")
          .replace(/\s{3,}/g, "\n")
          .slice(0, 25000)}`;

  return splitLongTextIntoPages(body, "Form Section");
}

function stripRtfToPlainText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\line/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const n = Number(code);
      return String.fromCharCode(n < 0 ? n + 65536 : n);
    })
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/gi, "")
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReadableStringsFromLegacyDoc(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const asciiChunks: string[] = [];
  let current = "";

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
      current += String.fromCharCode(b);
    } else {
      if (current.trim().length >= 16) {
        asciiChunks.push(current.trim());
      }
      current = "";
    }
  }
  if (current.trim().length >= 16) {
    asciiChunks.push(current.trim());
  }

  // Also check UTF-16LE runs (used by Word .doc Unicode streams)
  const utf16Chunks: string[] = [];
  let uCurrent = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (
      (code >= 32 && code <= 126) ||
      (code >= 0x0600 && code <= 0x06ff) || // Urdu / Arabic script
      (code >= 0x0900 && code <= 0x097f) || // Hindi / Devanagari script
      code === 10 ||
      code === 13
    ) {
      uCurrent += String.fromCharCode(code);
    } else {
      if (uCurrent.trim().length >= 14) {
        utf16Chunks.push(uCurrent.trim());
      }
      uCurrent = "";
    }
  }
  if (uCurrent.trim().length >= 14) {
    utf16Chunks.push(uCurrent.trim());
  }

  const combined = [...utf16Chunks, ...asciiChunks]
    .filter(
      (line) =>
        !line.includes("Microsoft Office Word") &&
        !line.includes("Normal.dotm") &&
        !line.includes("Root Entry") &&
        !line.startsWith("HYPERLINK")
    )
    .join("\n\n");

  return combined.slice(0, 200000).trim();
}

function formatCsvToReadableText(csvText: string, fileName: string): string {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "";

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const splitRow = (row: string) =>
    row
      .split(delimiter)
      .map((cell) => cell.replace(/^"|"$/g, "").trim());

  const headers = splitRow(lines[0]);
  const formattedRows: string[] = [
    `Spreadsheet Data (${fileName}) — Columns: ${headers.join(", ")}`,
  ];

  const maxRows = Math.min(lines.length, 600);
  for (let r = 1; r < maxRows; r++) {
    const cells = splitRow(lines[r]);
    const pairs = cells
      .map((val, idx) =>
        val ? `${headers[idx] || `Column ${idx + 1}`}: ${val}` : ""
      )
      .filter(Boolean);
    if (pairs.length > 0) {
      formattedRows.push(`Row ${r}: ${pairs.join(" | ")}`);
    }
  }

  return formattedRows.join("\n");
}

async function extractDocxArrayBuffer(
  buffer: ArrayBuffer
): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    if (result?.value && result.value.trim().length > 0) {
      return result.value.trim();
    }
  } catch {
    // Fallback to direct JSZip XML extraction below
  }

  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) return "";
  return stripXmlTagsToParagraphs(docXml);
}

async function extractPptxSlides(buffer: ArrayBuffer): Promise<PdfPageContent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });

  const pages: PdfPageContent[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i])?.async("string");
    if (!xml) continue;
    const text = stripXmlTagsToParagraphs(xml);
    const firstLine = text.split("\n").find((l) => l.trim().length > 2);
    pages.push({
      pageNumber: i + 1,
      heading: firstLine
        ? `Slide ${i + 1}: ${firstLine.slice(0, 70)}`
        : `Slide ${i + 1}`,
      text: text || `(Visual Slide ${i + 1})`,
    });
  }
  return pages;
}

async function extractXlsxSheets(buffer: ArrayBuffer): Promise<PdfPageContent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsXml = await zip
    .file("xl/sharedStrings.xml")
    ?.async("string");
  const sharedStrings: string[] = [];

  if (sharedStringsXml) {
    const siRegex = /<si[\s\S]*?<\/si>/gi;
    let m: RegExpExecArray | null;
    while ((m = siRegex.exec(sharedStringsXml)) !== null) {
      sharedStrings.push(stripXmlTagsToParagraphs(m[0]).replace(/\n+/g, " "));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();

  const pages: PdfPageContent[] = [];
  for (let s = 0; s < sheetFiles.length; s++) {
    const xml = await zip.file(sheetFiles[s])?.async("string");
    if (!xml) continue;
    const rows: string[] = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rowMatch: RegExpExecArray | null;
    let rowCount = 0;

    while ((rowMatch = rowRegex.exec(xml)) !== null && rowCount < 350) {
      const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
      const rowValues: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const attrs = cellMatch[1];
        const inner = cellMatch[2];
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/i);
        const inlineMatch = inner.match(/<is>([\s\S]*?)<\/is>/i);
        if (/\bt=["']s["']/i.test(attrs) && vMatch) {
          const idx = Number(vMatch[1].trim());
          rowValues.push(sharedStrings[idx] ?? vMatch[1]);
        } else if (inlineMatch) {
          rowValues.push(stripXmlTagsToParagraphs(inlineMatch[1]));
        } else if (vMatch) {
          rowValues.push(decodeXmlEntities(vMatch[1].trim()));
        }
      }
      const cleanVals = rowValues.map((v) => v.trim()).filter(Boolean);
      if (cleanVals.length > 0) {
        rowCount++;
        rows.push(`Row ${rowCount}: ${cleanVals.join(" | ")}`);
      }
    }

    if (rows.length > 0) {
      pages.push({
        pageNumber: pages.length + 1,
        heading: `Spreadsheet Sheet ${s + 1}`,
        text: rows.join("\n"),
      });
    }
  }

  return pages;
}

async function extractEpubArchive(buffer: ArrayBuffer): Promise<PdfPageContent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const htmlFiles = Object.keys(zip.files)
    .filter(
      (name) =>
        /\.(?:xhtml|html|htm)$/i.test(name) &&
        !name.toLowerCase().includes("toc") &&
        !name.toLowerCase().includes("nav")
    )
    .sort();

  const pages: PdfPageContent[] = [];
  for (const pathName of htmlFiles.slice(0, 120)) {
    const html = await zip.file(pathName)?.async("string");
    if (!html) continue;
    const text = stripXmlTagsToParagraphs(html);
    if (text.trim().length < 20) continue;
    const firstLine = text.split("\n").find((l) => l.trim().length > 2);
    pages.push({
      pageNumber: pages.length + 1,
      heading: firstLine
        ? firstLine.slice(0, 80)
        : `Chapter ${pages.length + 1}`,
      text,
    });
  }
  return pages;
}

async function extractZipOrWhatsAppArchive(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ExtractedPdfResult> {
  onProgress?.(`Unpacking archive ${file.name} (WhatsApp / Docs bundle)...`);
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(zip.files).filter((k) => !zip.files[k].dir);

  const pages: PdfPageContent[] = [];
  const scannedPageImages: ScannedPageSnapshot[] = [];
  let titleHint: string | undefined;

  // 1. Prioritize WhatsApp chat .txt files & text/doc attachments
  const sortedEntries = [...entryNames].sort((a, b) => {
    const aChat = a.toLowerCase().includes("chat") || a.endsWith(".txt") ? 0 : 1;
    const bChat = b.toLowerCase().includes("chat") || b.endsWith(".txt") ? 0 : 1;
    return aChat - bChat;
  });

  for (const entryName of sortedEntries) {
    const ext = getExtension(entryName);
    const entry = zip.files[entryName];
    const shortName = entryName.split("/").pop() || entryName;

    if ([".txt", ".md", ".csv"].includes(ext)) {
      const rawTxt = await entry.async("string");
      const wa = parseWhatsAppTextIfApplicable(rawTxt, shortName);
      if (wa.titleHint && !titleHint) titleHint = wa.titleHint;
      const subPages = splitLongTextIntoPages(
        wa.formattedText,
        wa.isWhatsApp ? "WhatsApp Chat Part" : shortName
      );
      for (const sp of subPages) {
        pages.push({
          pageNumber: pages.length + 1,
          heading: sp.heading,
          text: sp.text,
        });
      }
    } else if (ext === ".docx") {
      onProgress?.(`Reading attached Word Doc ${shortName}...`);
      const ab = await entry.async("arraybuffer");
      const docxText = await extractDocxArrayBuffer(ab);
      const subPages = splitLongTextIntoPages(docxText, shortName);
      for (const sp of subPages) {
        pages.push({
          pageNumber: pages.length + 1,
          heading: `${shortName} — ${sp.heading}`,
          text: sp.text,
        });
      }
    } else if (ext === ".pdf") {
      onProgress?.(`Reading attached PDF ${shortName}...`);
      const blob = await entry.async("blob");
      const innerPdfFile = new File([blob], shortName, {
        type: "application/pdf",
      });
      const pdfRes = await extractPdfInBrowser(innerPdfFile, onProgress);
      for (const p of pdfRes.pages) {
        pages.push({
          pageNumber: pages.length + 1,
          heading: `${shortName} — ${p.heading}`,
          text: p.text,
        });
      }
      for (const snap of pdfRes.scannedPageImages) {
        if (scannedPageImages.length < 10) {
          scannedPageImages.push({
            ...snap,
            pageNumber: scannedPageImages.length + 1,
          });
        }
      }
    } else if (
      [".jpg", ".jpeg", ".png", ".webp"].includes(ext) &&
      scannedPageImages.length < 20
    ) {
      onProgress?.(`Scanning attached image ${shortName} for full-page text...`);
      try {
        const imgBlob = await entry.async("blob");
        const snap = await renderImageBlobToSnapshot(
          imgBlob,
          scannedPageImages.length + 1,
          1850,
          0.86
        );
        const ocrRes = await recognizePageSnapshotsFullText({
          fileName: shortName,
          snapshots: [snap],
          uploadCategory: "image",
          onProgress,
        });
        for (const op of ocrRes) {
          if (op.text.trim().length > 0) {
            pages.push({
              pageNumber: pages.length + 1,
              heading: `${shortName} — ${op.heading}`,
              text: op.text,
            });
          }
        }
        scannedPageImages.push(snap);
      } catch {
        // Ignore unreadable thumbnail inside zip
      }
    }
  }

  const fullText = pages
    .filter((p) => p.text.trim().length > 0)
    .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
    .join("\n\n");

  return {
    numPages: Math.max(1, pages.length || scannedPageImages.length),
    pages,
    fullText,
    isScannedPdf: scannedPageImages.length > 0,
    scannedPageImages,
    metadataTitle:
      titleHint || inferContentTitleFromPages(pages, file.name),
  };
}

export async function extractAnyFileInBrowser(
  file: File,
  category: UploadCategory,
  onProgress?: (label: string) => void,
  targetLanguage = "English"
): Promise<{
  extracted: ExtractedPdfResult;
  resolvedCategory: UploadCategory;
  effectiveMimeType: string;
}> {
  const resolvedCategory = detectUploadCategory(file, category);
  const ext = getExtension(file.name);
  const mime = (file.type || "").toLowerCase();

  // 1. Standard PDF or Fillable PDF Form (.pdf) — Full all-page extraction + OCR
  if (mime === "application/pdf" || ext === ".pdf") {
    const extracted = await extractPdfInBrowser(file, onProgress, {
      isFormMode: resolvedCategory === "pdf_form",
      targetLanguage,
    });
    const finalCat: UploadCategory =
      resolvedCategory === "pdf_form" || (extracted.formFieldsCount ?? 0) > 0
        ? "pdf_form"
        : "pdf";
    return {
      extracted,
      resolvedCategory: finalCat,
      effectiveMimeType: "application/pdf",
    };
  }

  // 2. PDF Form Variants (.xfdf, .fdf, .epub)
  if (ext === ".xfdf") {
    onProgress?.(`Reading XFDF PDF Form fields from ${file.name}...`);
    const xmlText = await file.text();
    const pages = parseXfdfForm(xmlText, file.name);
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "pdf_form",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".fdf") {
    onProgress?.(`Reading Adobe FDF Form fields from ${file.name}...`);
    const rawText = await file.text();
    const pages = parseFdfForm(rawText, file.name);
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "pdf_form",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".epub") {
    onProgress?.(`Extracting chapters from EPUB ${file.name}...`);
    const buffer = await file.arrayBuffer();
    const pages = await extractEpubArchive(buffer);
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "pdf_form",
      effectiveMimeType: "text/plain",
    };
  }

  // 3. JPG / PNG / Pictures & Written/Handwritten Text Pictures (Full-Page OCR)
  if (
    resolvedCategory === "image" ||
    resolvedCategory === "written_photo" ||
    mime.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"].includes(ext)
  ) {
    const isWrittenMode = resolvedCategory === "written_photo";
    onProgress?.(
      isWrittenMode
        ? `Preparing high-resolution Handwritten & Text OCR scan for ${file.name}...`
        : `Scanning ${file.name} (JPG/PNG) for full-page text recognition & extraction...`
    );

    const snapshot = await renderImageBlobToSnapshot(
      file,
      1,
      isWrittenMode ? 2200 : 1900,
      isWrittenMode ? 0.9 : 0.88
    );

    const recognizedPages = await recognizePageSnapshotsFullText({
      fileName: file.name,
      snapshots: [snapshot],
      uploadCategory: isWrittenMode ? "written_photo" : "image",
      targetLanguage,
      onProgress,
    });

    const nonEmpty = recognizedPages.filter((p) => p.text.trim().length > 0);
    const fullText = nonEmpty
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    const inferredTitle = inferContentTitleFromPages(nonEmpty, file.name);

    return {
      extracted: {
        numPages: Math.max(1, nonEmpty.length),
        pages: nonEmpty.length > 0 ? nonEmpty : recognizedPages,
        fullText,
        isScannedPdf: true,
        scannedPageImages: [snapshot],
        metadataTitle: inferredTitle,
        ocrPagesCount: nonEmpty.length,
      },
      resolvedCategory: isWrittenMode ? "written_photo" : "image",
      effectiveMimeType: "image/jpeg",
    };
  }

  // 4. WhatsApp .zip or Document .zip Archive
  if (ext === ".zip" || mime.includes("zip")) {
    const zipResult = await extractZipOrWhatsAppArchive(file, onProgress);
    return {
      extracted: zipResult,
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  // 5. Microsoft Word (.docx, .doc) & OpenDocument (.odt) & RTF (.rtf)
  if (ext === ".docx" || mime.includes("wordprocessingml")) {
    onProgress?.(`Extracting Word Document (${file.name})...`);
    const buffer = await file.arrayBuffer();
    const text = await extractDocxArrayBuffer(buffer);
    const pages = splitLongTextIntoPages(text, "Document Page");
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".odt" || mime.includes("opendocument.text")) {
    onProgress?.(`Extracting OpenDocument (${file.name})...`);
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const contentXml = (await zip.file("content.xml")?.async("string")) || "";
    const text = stripXmlTagsToParagraphs(contentXml);
    const pages = splitLongTextIntoPages(text, "Document Page");
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".pptx" || mime.includes("presentationml")) {
    onProgress?.(`Extracting PowerPoint Slides (${file.name})...`);
    const buffer = await file.arrayBuffer();
    const pages = await extractPptxSlides(buffer);
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".xlsx" || mime.includes("spreadsheetml")) {
    onProgress?.(`Extracting Excel Spreadsheet (${file.name})...`);
    const buffer = await file.arrayBuffer();
    const pages = await extractXlsxSheets(buffer);
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".rtf" || mime.includes("rtf")) {
    onProgress?.(`Reading Rich Text Document (${file.name})...`);
    const rawRtf = await file.text();
    const text = stripRtfToPlainText(rawRtf);
    const pages = splitLongTextIntoPages(text, "Document Page");
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".doc" || mime === "application/msword") {
    onProgress?.(`Extracting legacy Word Document (${file.name})...`);
    const buffer = await file.arrayBuffer();
    const text = extractReadableStringsFromLegacyDoc(buffer);
    const pages = splitLongTextIntoPages(
      text || `Word Document: ${file.name}`,
      "Document Page"
    );
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  if (ext === ".csv" || ext === ".tsv" || mime === "text/csv") {
    onProgress?.(`Reading Spreadsheet Table (${file.name})...`);
    const rawCsv = await file.text();
    const text = formatCsvToReadableText(rawCsv, file.name);
    const pages = splitLongTextIntoPages(text, "Table Section");
    const fullText = pages
      .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
      .join("\n\n");
    return {
      extracted: {
        numPages: Math.max(1, pages.length),
        pages,
        fullText,
        isScannedPdf: false,
        scannedPageImages: [],
      },
      resolvedCategory: "docs_whatsapp",
      effectiveMimeType: "text/plain",
    };
  }

  // 6. Plain Text, WhatsApp .txt Chat Exports, HTML, or Markdown
  onProgress?.(`Reading ${file.name}...`);
  const rawText = await file.text();
  const maybeHtmlCleaned =
    ext === ".html" || ext === ".htm"
      ? stripXmlTagsToParagraphs(rawText)
      : rawText;
  const waCheck = parseWhatsAppTextIfApplicable(maybeHtmlCleaned, file.name);
  const pages = splitLongTextIntoPages(
    waCheck.formattedText,
    waCheck.isWhatsApp ? "WhatsApp Chat" : "Document Page"
  );
  const fullText = pages
    .map((p) => `[Page ${p.pageNumber} — ${p.heading}]\n${p.text}`)
    .join("\n\n");

  return {
    extracted: {
      numPages: Math.max(1, pages.length),
      pages,
      fullText,
      isScannedPdf: false,
      scannedPageImages: [],
      metadataTitle: waCheck.titleHint,
    },
    resolvedCategory: "docs_whatsapp",
    effectiveMimeType: "text/plain",
  };
}
