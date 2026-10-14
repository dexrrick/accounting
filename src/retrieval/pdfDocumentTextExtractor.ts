export interface PdfTextLine {
  text: string;
  pageNumber: number;
  y: number;
  cells: string[];
  cellStarts: number[];
}

export interface PdfTextExtraction {
  text: string;
  pageTexts: string[];
  lines: PdfTextLine[];
  pageCount: number;
  tableDetected: boolean;
  tableStructure: 'PRESERVED' | 'AMBIGUOUS' | 'NONE';
  hasEmptyPageText: boolean;
}

export class PdfDocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfDocumentExtractionError';
  }
}

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

const DEFAULT_MAX_PAGES = 150;
const DEFAULT_MAX_TEXT_CHARACTERS = 1_000_000;
const PDF_TIMEOUT_MS = 15_000;

function groupPositionedTextIntoLines(items: PositionedTextItem[], pageNumber: number): PdfTextLine[] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: Array<{ y: number; items: PositionedTextItem[] }> = [];
  for (const item of sorted) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2.5);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map(row => {
    const rowItems = row.items.sort((left, right) => left.x - right.x);
    const cells: string[] = [];
    const cellStarts: number[] = [];
    let current = '';
    let currentStart = rowItems[0]?.x ?? 0;
    let previousRight = rowItems[0]?.x ?? 0;
    for (const item of rowItems) {
      const gap = item.x - previousRight;
      if (current && gap >= 22) {
        cells.push(current.trim());
        cellStarts.push(currentStart);
        current = item.text;
        currentStart = item.x;
      } else {
        current += current && !/\s$/.test(current) && !/^\s/.test(item.text) ? ` ${item.text}` : item.text;
      }
      previousRight = Math.max(item.x + item.width, item.x);
    }
    if (current.trim()) {
      cells.push(current.trim());
      cellStarts.push(currentStart);
    }
    return { text: cells.join(' | '), pageNumber, y: row.y, cells, cellStarts };
  }).filter(line => line.text.length > 0);
}

function assessTableStructure(lines: PdfTextLine[]): { detected: boolean; structure: PdfTextExtraction['tableStructure'] } {
  const pageNumbers = [...new Set(lines.map(line => line.pageNumber))];
  let detected = false;
  for (const pageNumber of pageNumbers) {
    const pageLines = lines.filter(line => line.pageNumber === pageNumber);
    const tableRowIndexes = pageLines.map((line, index) => line.cells.length > 1 ? index : -1).filter(index => index >= 0);
    if (tableRowIndexes.length === 0) continue;
    detected = true;
    const firstIndex = tableRowIndexes[0];
    const lastIndex = tableRowIndexes[tableRowIndexes.length - 1];
    const rows = pageLines.slice(firstIndex, lastIndex + 1);
    const columnStarts = rows[0].cellStarts;
    // Every extracted line between apparent rows is part of the same visual
    // table region until proven otherwise. A one-cell row can be a wrapped
    // continuation, orphan value, or label; never silently discard it.
    if (tableRowIndexes.length < 2 || rows.some(row => row.cells.length < 2)) {
      return { detected: true, structure: 'AMBIGUOUS' };
    }
    // A trailing one-cell line can carry a value detached from its row (for
    // example, an amount below a category). If it lines up with a table
    // column, retain the ambiguity instead of ending the table at the prior
    // complete row and silently omitting it.
    const trailingSingleCell = pageLines.slice(lastIndex + 1).some(line => line.cells.length === 1 &&
      columnStarts.some(columnStart => Math.abs(line.cellStarts[0] - columnStart) <= 12)
    );
    if (trailingSingleCell) return { detected: true, structure: 'AMBIGUOUS' };
    const expectedCells = rows[0].cells.length;
    const countsAgree = rows.every(row => row.cells.length === expectedCells);
    const columnsAlign = countsAgree && rows.every(row => row.cellStarts.every((start, index) =>
      Math.abs(start - rows[0].cellStarts[index]) <= 12
    ));
    if (!columnsAlign) return { detected: true, structure: 'AMBIGUOUS' };
  }
  return { detected, structure: detected ? 'PRESERVED' : 'NONE' };
}

/** Extracts only embedded PDF text. Scanned/image-only documents fail closed. */
export async function extractPdfDocumentText(
  inputBytes: Uint8Array,
  limits: { maxPages?: number; maxTextCharacters?: number } = {}
): Promise<PdfTextExtraction> {
  if (inputBytes.byteLength < 8 || inputBytes.byteLength > 1_500_000 ||
      new TextDecoder('ascii').decode(inputBytes.subarray(0, 5)) !== '%PDF-') {
    throw new PdfDocumentExtractionError('The response is not a bounded PDF document');
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') {
    const localWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = localWorker.default;
  }

  const pageLimit = limits.maxPages ?? DEFAULT_MAX_PAGES;
  const characterLimit = limits.maxTextCharacters ?? DEFAULT_MAX_TEXT_CHARACTERS;
  if (!Number.isFinite(pageLimit) || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > DEFAULT_MAX_PAGES ||
      !Number.isFinite(characterLimit) || !Number.isInteger(characterLimit) || characterLimit < 100 || characterLimit > DEFAULT_MAX_TEXT_CHARACTERS) {
    throw new PdfDocumentExtractionError('PDF page and text limits must be finite positive values within supported bounds');
  }
  const loadingTask = pdfjs.getDocument({
    // `Buffer.slice()` remains a Buffer subclass, which pdfjs rejects; copy to
    // a plain Uint8Array while keeping the original byte sequence intact.
    data: new Uint8Array(inputBytes),
    useWorkerFetch: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new PdfDocumentExtractionError('PDF extraction timed out')), PDF_TIMEOUT_MS);
  });
  const extractionPromise = (async (): Promise<PdfTextExtraction> => {
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > pageLimit) {
      throw new PdfDocumentExtractionError(`PDF page count is outside the supported 1-${pageLimit} page range`);
    }
    const lines: PdfTextLine[] = [];
    const pageTexts: string[] = [];
    let hasEmptyPageText = false;
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const positioned: PositionedTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width;
        if (![x, y, width].every(Number.isFinite)) {
          throw new PdfDocumentExtractionError('PDF text has incomplete layout coordinates');
        }
        positioned.push({ text: item.str, x, y, width });
      }
      const pageLines = groupPositionedTextIntoLines(positioned, pageNumber);
      const pageText = pageLines.map(line => line.text).join('\n').trim();
      if (!pageText) hasEmptyPageText = true;
      characters += pageText.length;
      if (characters > characterLimit) {
        throw new PdfDocumentExtractionError('PDF extracted text exceeded the supported character limit');
      }
      lines.push(...pageLines);
      pageTexts.push(pageText);
      page.cleanup();
    }
    const text = pageTexts.map((pageText, index) => `Page ${index + 1}\n${pageText}`).join('\n\n').trim();
    if (text.length < 55 || text.split(/\s+/).filter(Boolean).length < 10) {
      throw new PdfDocumentExtractionError('PDF has no substantive embedded text; scanned or image-only pages are unsupported');
    }
    const table = assessTableStructure(lines);
    return {
      text,
      pageTexts,
      lines,
      pageCount: document.numPages,
      tableDetected: table.detected,
      tableStructure: table.structure,
      hasEmptyPageText
    };
  })();
  try {
    return await Promise.race([extractionPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof PdfDocumentExtractionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PdfDocumentExtractionError(/password|encrypt/i.test(message)
      ? 'Encrypted PDFs are unsupported'
      : `PDF parsing failed: ${message.slice(0, 180)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
    void loadingTask.destroy().catch(() => undefined);
  }
}
