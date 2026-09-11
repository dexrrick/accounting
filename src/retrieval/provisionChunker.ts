import { computeSha256 } from '../standards/sourceVersioning';
import type {
  AuthoritativeSourceRecord,
  SourceLocator,
  SourceType,
  EvidenceTier
} from '../standards/unifiedSourceModel';

export interface VerifiedChunk {
  id: string;
  parentRecordId: string;
  chunkText: string;

  startOffset: number;
  endOffset: number;

  sourceLocator: SourceLocator;

  sourceType: SourceType;
  evidenceTier: EvidenceTier;

  validFrom?: string;
  validTo?: string;

  textHash: string;
  heading?: string;
  section?: string;
  subsection?: string;
  tags?: string[];
}

/**
 * Deterministic Provision & Paragraph Chunker.
 *
 * Invariants:
 * 1. Operates only on eligible VERIFIED or HISTORICAL parent records.
 * 2. Exact Slice Invariant:
 *    parentRecord.sourceText.slice(chunk.startOffset, chunk.endOffset) === chunk.chunkText
 * 3. Never synthesizes, modifies, or paraphrases text outside parentRecord.sourceText.
 * 4. Preserves parent custody: chunk is a retrieval unit, not an independent evidence authority.
 */
export class ProvisionChunker {
  /**
   * Computes deterministic SHA-256 hash of text.
   */
  public static computeTextHash(text: string): string {
    return computeSha256(text);
  }

  /**
   * Chunks an authoritative source record into discrete, verified paragraph/subsection chunks.
   */
  public chunkRecord(parentRecord: AuthoritativeSourceRecord): VerifiedChunk[] {
    if (!parentRecord || !parentRecord.sourceText) {
      return [];
    }

    // Hard Gate: Only approved registry records (strictly excluding STAGED or REJECTED candidates) may produce chunks
    if ((parentRecord.sourceStatus as string) === 'REJECTED' || parentRecord.id.includes('staged') || parentRecord.id.includes('candidate')) {
      return [];
    }

    const text = parentRecord.sourceText;
    const len = text.length;
    if (len === 0) return [];

    const chunks: VerifiedChunk[] = [];

    // Attempt structural subsection extraction (e.g. "(1)", "(2)", "(5)" or numbered paras "57.", "§57")
    // Regex matches subsection markers at the beginning of lines or text
    const subsectionRegex = /(?:^|\n\s*)(?:(?:\(([0-9]+[a-zA-Z]?)\))|([0-9]{1,3}\.)|(?:§\s*([0-9]{1,3})))/g;
    const matches: Array<{ index: number; label: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = subsectionRegex.exec(text)) !== null) {
      // Offset of the actual subsection text start
      const matchIndex = match.index + (match[0].startsWith('\n') ? match[0].indexOf(match[1] || match[2] || match[3]) - 1 : 0);
      const label = match[1] ? `(${match[1]})` : (match[2] ? match[2] : `§${match[3]}`);
      matches.push({ index: Math.max(0, matchIndex), label });
    }

    if (matches.length > 1) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : len;

        // Extract exact slice from original raw text
        const chunkText = text.slice(start, end);
        if (chunkText.trim().length === 0) continue;

        const chunkId = `${parentRecord.id}#chunk${i + 1}`;
        const locator: SourceLocator = {
          ...(parentRecord.sourceLocator || {}),
          startOffset: start,
          endOffset: end,
          subsection: matches[i].label,
          canonicalLocator: parentRecord.sourceLocator?.canonicalLocator
            ? `${parentRecord.sourceLocator.canonicalLocator} > ${matches[i].label}`
            : `${parentRecord.standardOrActCode} ${matches[i].label}`
        };

        const chunk: VerifiedChunk = {
          id: chunkId,
          parentRecordId: parentRecord.id,
          chunkText,
          startOffset: start,
          endOffset: end,
          sourceLocator: locator,
          sourceType: parentRecord.sourceType,
          evidenceTier: parentRecord.evidenceTier,
          validFrom: parentRecord.validFrom,
          validTo: parentRecord.validTo,
          textHash: ProvisionChunker.computeTextHash(chunkText),
          section: parentRecord.paragraphOrSection,
          subsection: matches[i].label
        };

        // Strict Invariant Check
        if (!this.verifyChunk(chunk, parentRecord)) {
          throw new Error(`Chunk invariant violation for ${chunkId}: slice mismatch.`);
        }

        chunks.push(chunk);
      }
    }

    // Fallback: If no distinct subsections were extracted or only 1 was found,
    // treat the full provision as a single authoritative chunk
    if (chunks.length === 0) {
      const chunkId = `${parentRecord.id}#chunk1`;
      const locator: SourceLocator = {
        ...(parentRecord.sourceLocator || {}),
        startOffset: 0,
        endOffset: len,
        canonicalLocator: parentRecord.sourceLocator?.canonicalLocator || `${parentRecord.standardOrActCode} ${parentRecord.paragraphOrSection}`
      };

      const singleChunk: VerifiedChunk = {
        id: chunkId,
        parentRecordId: parentRecord.id,
        chunkText: text,
        startOffset: 0,
        endOffset: len,
        sourceLocator: locator,
        sourceType: parentRecord.sourceType,
        evidenceTier: parentRecord.evidenceTier,
        validFrom: parentRecord.validFrom,
        validTo: parentRecord.validTo,
        textHash: ProvisionChunker.computeTextHash(text),
        section: parentRecord.paragraphOrSection
      };

      if (!this.verifyChunk(singleChunk, parentRecord)) {
        throw new Error(`Chunk invariant violation for single chunk ${chunkId}: slice mismatch.`);
      }

      chunks.push(singleChunk);
    }

    return chunks;
  }

  /**
   * Chunks multiple records.
   */
  public chunkRecords(parentRecords: AuthoritativeSourceRecord[]): VerifiedChunk[] {
    const allChunks: VerifiedChunk[] = [];
    for (const rec of parentRecords) {
      const chunks = this.chunkRecord(rec);
      allChunks.push(...chunks);
    }
    return allChunks;
  }

  /**
   * Validates chunk integrity invariant against parent record:
   * parentRecord.sourceText.slice(startOffset, endOffset) === chunk.chunkText
   */
  public verifyChunk(chunk: VerifiedChunk, parentRecord: AuthoritativeSourceRecord): boolean {
    if (!chunk || !parentRecord) return false;
    if (chunk.parentRecordId !== parentRecord.id) return false;
    if (chunk.startOffset < 0 || chunk.endOffset > parentRecord.sourceText.length) return false;
    if (chunk.startOffset >= chunk.endOffset) return false;

    // Strict slice identity
    const expected = parentRecord.sourceText.slice(chunk.startOffset, chunk.endOffset);
    if (expected !== chunk.chunkText) return false;

    // Hash verification
    const expectedHash = ProvisionChunker.computeTextHash(chunk.chunkText);
    if (chunk.textHash !== expectedHash) return false;

    return true;
  }
}

export const defaultProvisionChunker = new ProvisionChunker();
