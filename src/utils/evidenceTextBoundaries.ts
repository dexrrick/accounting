const ATTACHED_QUALIFICATION_START = /^(?:however\b|except(?:ions?)?\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b|this(?:\s+[a-z-]+){0,3}\s+(?:rule|restriction|limitation|condition|exception|requirement)\s+applies\b)/i;
const STRONG_ATTACHED_QUALIFICATION_START = /^(?:however\b|except\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b|this(?:\s+[a-z-]+){0,3}\s+(?:rule|restriction|limitation|condition|exception|requirement)\s+applies\b)/i;

export interface VisibleEvidenceListSpan {
  startIndex: number;
  listEndIndex: number;
  endIndex: number;
  itemCount: number;
  blocks: string[];
  quote: string;
}

export interface CompleteVisibleEvidenceListSpan extends VisibleEvidenceListSpan {}

export function normalizeEvidenceText(value: string): string {
  return value.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function startsAttachedEvidenceQualification(value: string): boolean {
  return ATTACHED_QUALIFICATION_START.test(normalizeEvidenceText(value));
}

export function startsStrongAttachedEvidenceQualification(value: string): boolean {
  return STRONG_ATTACHED_QUALIFICATION_START.test(normalizeEvidenceText(value));
}

export function splitEvidenceTextBlocks(sourceText: string): string[] {
  return sourceText.normalize('NFC').replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean);
}

export function isVisibleEvidenceListItem(value: string): boolean {
  return /^(?:\|\s*)*[•◦▪]\s+/u.test(value.trim());
}

/** A marker-only block is extraction scaffolding when a content-bearing item follows it. */
export function isVisibleEvidenceListMarker(value: string): boolean {
  return /^(?:\|\s*)*[•◦▪]\s*$/u.test(value.trim());
}

type VisibleOrderedListKind = 'ALPHABETIC' | 'NUMERIC';
type VisibleListItemKind = 'BULLET' | VisibleOrderedListKind;

interface VisibleOrderedListMarker {
  kind: VisibleOrderedListKind;
  ordinal: number;
}

function visibleOrderedListMarker(value: string): VisibleOrderedListMarker | undefined {
  const block = value.trim();
  const alphabetic = /^(?:\|\s*)*(?:\(([a-z])\)|([a-z])[.)])\s+\S/iu.exec(block);
  if (alphabetic) {
    return { kind: 'ALPHABETIC', ordinal: (alphabetic[1] || alphabetic[2]).toLowerCase().charCodeAt(0) - 96 };
  }
  const numeric = /^(?:\|\s*)*(?:\(([1-9]\d*)\)|([1-9]\d*)[.)])\s+\S/u.exec(block);
  if (numeric) return { kind: 'NUMERIC', ordinal: Number(numeric[1] || numeric[2]) };
  return undefined;
}

function visibleListItemKind(value: string): VisibleListItemKind | undefined {
  if (isVisibleEvidenceListItem(value)) return 'BULLET';
  return visibleOrderedListMarker(value)?.kind;
}

function hasClearSentenceEnd(value: string): boolean {
  return /[.!?]["'’”)\]]*$/u.test(value.trim());
}

function isUnpunctuatedHeadingBlock(value: string | undefined): boolean {
  const block = value?.trim();
  return Boolean(block && /^\p{Lu}/u.test(block) && !hasClearSentenceEnd(block) && !/[:;]$/.test(block));
}

export function isEvidenceHeadingTransition(blocks: readonly string[], index: number): boolean {
  return isUnpunctuatedHeadingBlock(blocks[index]) &&
    isUnpunctuatedHeadingBlock(blocks[index + 1]) &&
    Boolean(blocks[index + 2] && hasClearSentenceEnd(blocks[index + 2]));
}

/** Returns a contiguous introduction with its list and attached qualifications. */
export function visibleEvidenceListSpan(
  blocks: readonly string[],
  introIndex: number
): VisibleEvidenceListSpan | undefined {
  const introduction = blocks[introIndex]?.trim();
  if (!introduction) return undefined;
  let firstItemIndex = introIndex + 1;
  while (firstItemIndex < blocks.length && isVisibleEvidenceListMarker(blocks[firstItemIndex])) firstItemIndex += 1;
  const firstItemKind = blocks[firstItemIndex] ? visibleListItemKind(blocks[firstItemIndex]) : undefined;
  if (!firstItemKind) return undefined;
  const hasColonIntroduction = /:$/.test(introduction);
  const hasDashIntroduction = /[—–-]$/.test(introduction);
  const isExplicitForwardListReference =
    /\bthe following\s+(?:\d+\s+)?(?:conditions?|requirements?|criteria|items?|steps?|points?|qualifications?|details?|examples?|documents?|factors?|options?)\b/i.test(introduction) ||
    /\b(?:as follows|listed below|set out below|shown below)[.!?:;]*$/i.test(introduction);
  const isBoundedUnpunctuatedHeading = /^\p{L}/u.test(introduction) &&
    introduction.length <= 160 && introduction.split(/\s+/).length <= 24 &&
    !hasClearSentenceEnd(introduction) && !/[:;]/.test(introduction) && !hasDashIntroduction;
  // Recognized headings and forward references may introduce lists without
  // punctuation. List-item introductions keep their existing boundary, and
  // marker-only extraction blocks are never introductions.
  if (isVisibleEvidenceListMarker(introduction)) return undefined;
  if (visibleListItemKind(introduction)) {
    if (firstItemKind === 'BULLET'
      ? !hasColonIntroduction
      : !hasColonIntroduction && !hasDashIntroduction) {
      return undefined;
    }
  } else {
    const hasPunctuatedIntroduction = hasColonIntroduction || hasDashIntroduction;
    if (!hasPunctuatedIntroduction && !isExplicitForwardListReference && !isBoundedUnpunctuatedHeading) {
      return undefined;
    }
  }

  let listEndIndex = introIndex;
  let itemCount = 0;
  let nextIndex = introIndex + 1;
  while (nextIndex < blocks.length) {
    const itemKind = visibleListItemKind(blocks[nextIndex]);
    if (itemKind) {
      listEndIndex = nextIndex;
      itemCount += 1;
      nextIndex += 1;
      continue;
    }
    if (isVisibleEvidenceListMarker(blocks[nextIndex]) && firstItemKind === 'BULLET') {
      let nextItemIndex = nextIndex;
      while (nextItemIndex < blocks.length && isVisibleEvidenceListMarker(blocks[nextItemIndex])) nextItemIndex += 1;
      if (nextItemIndex < blocks.length && visibleListItemKind(blocks[nextItemIndex]) === 'BULLET') {
        nextIndex = nextItemIndex;
        continue;
      }
    }
    break;
  }
  if (itemCount === 0) return undefined;
  let endIndex = listEndIndex;
  let qualificationContinuation = false;
  while (endIndex + 1 < blocks.length) {
    const nextIndex = endIndex + 1;
    if (isEvidenceHeadingTransition(blocks, nextIndex) &&
        !startsStrongAttachedEvidenceQualification(blocks[nextIndex])) break;
    const nextBlock = blocks[nextIndex];
    if (!qualificationContinuation && !startsAttachedEvidenceQualification(nextBlock)) break;
    endIndex = nextIndex;
    qualificationContinuation = !hasClearSentenceEnd(nextBlock);
  }
  const spanBlocks = blocks.slice(introIndex, endIndex + 1).map(block => block.trim());
  return {
    startIndex: introIndex,
    listEndIndex,
    endIndex,
    itemCount,
    blocks: spanBlocks,
    quote: spanBlocks.join('\n\n')
  };
}

/** Returns a visible list only when its boundary and ordered markers are complete. */
export function completeVisibleEvidenceListSpan(
  blocks: readonly string[],
  introIndex: number
): CompleteVisibleEvidenceListSpan | undefined {
  const span = visibleEvidenceListSpan(blocks, introIndex);
  if (!span) return undefined;

  const listBlockEndOffset = span.listEndIndex - span.startIndex;
  const listBlocks = span.blocks.slice(1, listBlockEndOffset + 1);
  const attachedQualifications = span.blocks.slice(listBlockEndOffset + 1);
  if (attachedQualifications.length > 0 &&
      !hasClearSentenceEnd(attachedQualifications[attachedQualifications.length - 1])) return undefined;
  const orderedMarkers = listBlocks.map(visibleOrderedListMarker).filter(
    (marker): marker is VisibleOrderedListMarker => marker !== undefined
  );
  if (orderedMarkers.length === 0) {
    const bulletCount = listBlocks.filter(isVisibleEvidenceListItem).length;
    return bulletCount === span.itemCount ? span : undefined;
  }

  if (orderedMarkers.length !== span.itemCount ||
      listBlocks.some(block => isVisibleEvidenceListItem(block) || isVisibleEvidenceListMarker(block))) {
    return undefined;
  }
  const first = orderedMarkers[0];
  if (first.ordinal !== 1 ||
      orderedMarkers.some((marker, index) => marker.kind !== first.kind || marker.ordinal !== index + 1)) {
    return undefined;
  }
  const lastListBlock = listBlocks[listBlocks.length - 1];
  return lastListBlock && hasClearSentenceEnd(lastListBlock) ? span : undefined;
}
