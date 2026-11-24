const ATTACHED_QUALIFICATION_START = /^(?:however\b|except(?:ions?)?\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b|this(?:\s+[a-z-]+){0,3}\s+(?:rule|restriction|limitation|condition|exception|requirement)\s+applies\b)/i;
const STRONG_ATTACHED_QUALIFICATION_START = /^(?:however\b|except\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b|this(?:\s+[a-z-]+){0,3}\s+(?:rule|restriction|limitation|condition|exception|requirement)\s+applies\b)/i;

export interface VisibleEvidenceListSpan {
  startIndex: number;
  listStartIndex: number;
  contextStartIndex?: number;
  contextQuote?: string;
  listEndIndex: number;
  endIndex: number;
  itemCount: number;
  tableContinuation?: boolean;
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

function isStructuralEvidenceDivider(value: string): boolean {
  const block = value.trim();
  return /^(?:[-–—_]{3,}|(?:\*\s*){3,})$/u.test(block) ||
    /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u.test(block);
}

function orderedMarkerInPipeDelimitedRow(value: string): VisibleOrderedListMarker | undefined {
  if (!value.includes('|')) return undefined;
  for (const cell of value.split('|')) {
    const marker = visibleOrderedListMarker(cell);
    if (marker) return marker;
  }
  return undefined;
}

function pipeTableContinuation(blocks: readonly string[], index: number): {
  rowIndex: number;
  firstMarker: VisibleOrderedListMarker;
} | undefined {
  const marker = visibleOrderedListMarker(blocks[index]);
  if (!marker || marker.ordinal < 2) return undefined;
  let previous = index - 1;
  while (previous >= 0 && isStructuralEvidenceDivider(blocks[previous])) previous -= 1;
  if (previous < 0) return undefined;
  const firstMarker = orderedMarkerInPipeDelimitedRow(blocks[previous]);
  if (!firstMarker || firstMarker.kind !== marker.kind) return undefined;
  return { rowIndex: previous, firstMarker };
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
  const introductionIsListItem = Boolean(visibleListItemKind(introduction));
  const hasColonIntroduction = /:$/.test(introduction);
  const hasDashIntroduction = /[—–-]$/.test(introduction);
  const isListItemIntroduction = introductionIsListItem && (hasColonIntroduction || hasDashIntroduction);
  const tableContinuation = introductionIsListItem ? pipeTableContinuation(blocks, introIndex) : undefined;
  // A visible marker run defines its own boundary. Do not depend on the prose
  // immediately before it to decide whether the items form a complete list:
  // that prose may be an ordinary fact followed by unrelated bullets.
  if (introductionIsListItem && introIndex > 0 && visibleListItemKind(blocks[introIndex - 1])) return undefined;
  let firstItemIndex = introIndex + 1;
  if (tableContinuation) firstItemIndex = tableContinuation.rowIndex;
  else if (introductionIsListItem && !isListItemIntroduction) firstItemIndex = introIndex;
  else while (firstItemIndex < blocks.length && isVisibleEvidenceListMarker(blocks[firstItemIndex])) firstItemIndex += 1;
  const firstItemKind = tableContinuation
    ? tableContinuation.firstMarker.kind
    : introductionIsListItem
    ? visibleListItemKind(introduction)
    : blocks[firstItemIndex] ? visibleListItemKind(blocks[firstItemIndex]) : undefined;
  if (!firstItemKind) return undefined;
  const isExplicitForwardListReference =
    /\bthe following\s+(?:\d+\s+)?(?:conditions?|requirements?|criteria|items?|steps?|points?|qualifications?|details?|examples?|documents?|factors?|options?)\b/i.test(introduction) ||
    /\b(?:as follows|listed below|set out below|shown below)[.!?:;]*$/i.test(introduction);
  // A preceding sentence may be kept as separate context. Only punctuation
  // or an explicit forward reference binds it to the marker run. Unpunctuated
  // prose remains independently selectable; the marker run has its own span.
  if (isVisibleEvidenceListMarker(introduction)) return undefined;
  if (!introductionIsListItem) {
    const hasPunctuatedIntroduction = hasColonIntroduction || hasDashIntroduction;
    if (!hasPunctuatedIntroduction && !isExplicitForwardListReference) {
      return undefined;
    }
  }

  let listEndIndex = tableContinuation
    ? firstItemIndex
    : introductionIsListItem && !isListItemIntroduction ? introIndex - 1 : introIndex;
  let itemCount = tableContinuation ? 1 : 0;
  let nextIndex = tableContinuation ? firstItemIndex + 1 : firstItemIndex;
  while (nextIndex < blocks.length) {
    if (tableContinuation && isStructuralEvidenceDivider(blocks[nextIndex])) {
      nextIndex += 1;
      continue;
    }
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
  const spanStartIndex = tableContinuation
    ? tableContinuation.rowIndex
    : introductionIsListItem && !isListItemIntroduction ? firstItemIndex : introIndex;
  const spanBlocks = blocks.slice(spanStartIndex, endIndex + 1).map(block => block.trim());
  let contextStartIndex = spanStartIndex - 1;
  while (contextStartIndex >= 0 && (isVisibleEvidenceListMarker(blocks[contextStartIndex]) ||
      isStructuralEvidenceDivider(blocks[contextStartIndex]))) contextStartIndex -= 1;
  const contextBlocks = blocks.slice(contextStartIndex, spanStartIndex).map(block => block.trim()).filter(Boolean);
  const requiresPrecedingContext = introductionIsListItem || spanStartIndex < introIndex;
  return {
    startIndex: spanStartIndex,
    listStartIndex: tableContinuation ? tableContinuation.rowIndex : firstItemIndex,
    ...(requiresPrecedingContext && contextBlocks.length > 0 &&
      !visibleListItemKind(blocks[contextStartIndex])
      ? { contextStartIndex, contextQuote: `${contextBlocks.join('\n\n')}\n\n${spanBlocks.join('\n\n')}` }
      : {}),
    listEndIndex,
    endIndex,
    itemCount,
    ...(tableContinuation ? { tableContinuation: true } : {}),
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

  const listStartOffset = span.listStartIndex - span.startIndex;
  const listBlockEndOffset = span.listEndIndex - span.startIndex;
  const listBlocks = span.blocks.slice(listStartOffset, listBlockEndOffset + 1);
  const attachedQualifications = span.blocks.slice(listBlockEndOffset + 1);
  if (attachedQualifications.length > 0 &&
      !hasClearSentenceEnd(attachedQualifications[attachedQualifications.length - 1])) return undefined;
  const orderedMarkers = (span.tableContinuation
    ? listBlocks.map((block, index) => index === 0
      ? orderedMarkerInPipeDelimitedRow(block) : visibleOrderedListMarker(block))
    : listBlocks.map(visibleOrderedListMarker)
  ).filter((marker): marker is VisibleOrderedListMarker => marker !== undefined);
  if (orderedMarkers.length === 0) {
    const bulletCount = listBlocks.filter(isVisibleEvidenceListItem).length;
    return bulletCount === span.itemCount ? span : undefined;
  }

  if (orderedMarkers.length !== span.itemCount ||
      listBlocks.some(block => !isStructuralEvidenceDivider(block) &&
        (isVisibleEvidenceListItem(block) || isVisibleEvidenceListMarker(block) ||
          (span.tableContinuation && !visibleOrderedListMarker(block) && !orderedMarkerInPipeDelimitedRow(block))))) {
    return undefined;
  }
  const first = orderedMarkers[0];
  if (first.ordinal !== 1 ||
      orderedMarkers.some((marker, index) => marker.kind !== first.kind || marker.ordinal !== index + 1)) {
    return undefined;
  }
  if (span.tableContinuation) return span;
  const lastListBlock = listBlocks[listBlocks.length - 1];
  return lastListBlock && hasClearSentenceEnd(lastListBlock) ? span : undefined;
}
