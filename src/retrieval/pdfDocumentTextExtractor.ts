export interface PdfTextLine {
  text: string;
  pageNumber: number;
  y: number;
  cells: string[];
  cellStarts: number[];
  /** Stable structure-tree owner for text belonging to a PDF Note element. */
  noteOwnerId?: string;
  /** Tagged content identifiers for this line when it is owned by a PDF Note. */
  noteContentIds?: string[];
  /** Note owners linked to tagged reference text on this line. */
  referencedNoteIds?: string[];
  /** Exact tagged content identifiers expected for each linked note owner. */
  referencedNotes?: Array<{ noteOwnerId: string; contentIds: string[] }>;
  /** True when the source tags do not prove one unambiguous note association. */
  noteAssociationAmbiguous?: boolean;
  /** True when a raised numeric marker cannot be bound to one tagged source note. */
  unresolvedNumericReference?: boolean;
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
  height: number;
  contentId?: string;
  superscriptReference?: boolean;
}

interface InternalPdfTextLine extends PdfTextLine {
  itemCells: PositionedTextItem[][];
}

interface PdfStructureNode {
  type?: string;
  role?: string;
  id?: string;
  children?: PdfStructureNode[];
}

interface PdfStructureBinding {
  paragraphId?: string;
  listItemId?: string;
  listRegion?: 'Lbl' | 'LBody';
  noteOwnerId?: string;
  referencedNoteIds?: string[];
  referencedNotes?: Array<{ noteOwnerId: string; contentIds: string[] }>;
  noteReferenceExpected?: boolean;
  noteAssociationAmbiguous?: boolean;
  inTable: boolean;
}

interface PdfBlockOwner {
  kind: 'P' | 'LI';
  id: string;
}

const DEFAULT_MAX_PAGES = 150;
const DEFAULT_MAX_TEXT_CHARACTERS = 1_000_000;
const PDF_TIMEOUT_MS = 15_000;

function groupPositionedTextIntoLines(items: PositionedTextItem[], pageNumber: number): InternalPdfTextLine[] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: Array<{ y: number; items: PositionedTextItem[] }> = [];
  for (const item of sorted) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2.5);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map(row => createPositionedLine(row.items, pageNumber, row.y)).filter(line => line.text.length > 0);
}

function createPositionedLine(items: PositionedTextItem[], pageNumber: number, y: number): InternalPdfTextLine {
  const rowItems = [...items].sort((left, right) => left.x - right.x);
  const cells: string[] = [];
  const cellStarts: number[] = [];
  const itemCells: PositionedTextItem[][] = [];
  let current = '';
  let currentStart = rowItems[0]?.x ?? 0;
  let previousRight = rowItems[0]?.x ?? 0;
  let currentItems: PositionedTextItem[] = [];
  for (const item of rowItems) {
    const gap = item.x - previousRight;
    if (current && gap >= 22) {
      cells.push(current.trim());
      cellStarts.push(currentStart);
      itemCells.push(currentItems);
      current = item.text;
      currentStart = item.x;
      currentItems = [item];
    } else {
      const closingPunctuation = /^[,.;:!?)}\]]/.test(item.text);
      current += current && !item.superscriptReference && !closingPunctuation && !/\s$/.test(current) && !/^\s/.test(item.text)
        ? ` ${item.text}`
        : item.text;
      currentItems.push(item);
    }
    previousRight = Math.max(item.x + item.width, item.x);
  }
  if (current.trim()) {
    cells.push(current.trim());
    cellStarts.push(currentStart);
    itemCells.push(currentItems);
  }
  return { text: cells.join(' | '), pageNumber, y, cells, cellStarts, itemCells };
}

function indexPdfStructureTree(value: unknown, pageNumber: number): Map<string, PdfStructureBinding> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const bindings = new Map<string, PdfStructureBinding>();
  const roleIds = new WeakMap<object, string>();
  const linkReferences = new Map<string, {
    noteContentIds: Map<string, Set<string>>;
    expected: boolean;
    ambiguous: boolean;
  }>();
  let nextNodeId = 0;
  let malformed = false;
  const tableRoles = new Set(['Table', 'TR', 'TD', 'TH']);

  const roleIdentity = (node: PdfStructureNode): { role: string; id: string } => {
    let id = roleIds.get(node);
    if (!id) {
      id = `${pageNumber}:node-${nextNodeId++}`;
      roleIds.set(node, id);
    }
    return { role: node.role || '', id };
  };

  const contentIdsUnder = (rawNode: unknown): string[] => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) return [];
    const node = rawNode as PdfStructureNode;
    const ids = node.type === 'content' && typeof node.id === 'string' ? [node.id] : [];
    return [...ids, ...(Array.isArray(node.children) ? node.children.flatMap(contentIdsUnder) : [])];
  };

  const visit = (rawNode: unknown, path: Array<{ role: string; id: string }>): void => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
      malformed = true;
      return;
    }
    const node = rawNode as PdfStructureNode;
    if ((node.role !== undefined && typeof node.role !== 'string') ||
        (node.type !== undefined && typeof node.type !== 'string') ||
        (node.id !== undefined && typeof node.id !== 'string') ||
        (node.children !== undefined && !Array.isArray(node.children))) {
      malformed = true;
      return;
    }
    const nodePath = node.role ? [...path, roleIdentity(node)] : path;
    if (node.role === 'Link') {
      const spanIds = (node.children || []).filter(child =>
        child && typeof child === 'object' && !Array.isArray(child) && (child as PdfStructureNode).role === 'Span'
      ).flatMap(contentIdsUnder);
      const noteChildren = (node.children || []).filter(child =>
        child && typeof child === 'object' && !Array.isArray(child) && (child as PdfStructureNode).role === 'Note'
      ) as PdfStructureNode[];
      const notes = noteChildren.map(child => ({
        noteOwnerId: roleIdentity(child).id,
        contentIds: [...new Set(contentIdsUnder(child))]
      }));
      if (noteChildren.length > 0) {
        if (spanIds.length === 0) malformed = true;
        const noteHasContent = notes.length === 1 && notes[0].contentIds.length > 0;
        for (const contentId of spanIds) {
          const association = linkReferences.get(contentId) || {
            noteContentIds: new Map<string, Set<string>>(), expected: false, ambiguous: false
          };
          association.expected = true;
          if (!noteHasContent || association.noteContentIds.size > 0) association.ambiguous = true;
          for (const note of notes) {
            const expectedIds = association.noteContentIds.get(note.noteOwnerId) || new Set<string>();
            for (const id of note.contentIds) expectedIds.add(id);
            association.noteContentIds.set(note.noteOwnerId, expectedIds);
          }
          if (notes.length !== 1) association.ambiguous = true;
          linkReferences.set(contentId, association);
        }
      }
    }
    if (node.type === 'content') {
      if (!node.id || bindings.has(node.id) || (node.children && node.children.length > 0)) {
        malformed = true;
        return;
      }
      const paragraph = [...nodePath].reverse().find(entry => entry.role === 'P');
      const listItem = [...nodePath].reverse().find(entry => entry.role === 'LI');
      const listItemIndex = listItem ? nodePath.lastIndexOf(listItem) : -1;
      const listRegion = listItemIndex >= 0
        ? [...nodePath.slice(listItemIndex + 1)].reverse().find(entry => entry.role === 'Lbl' || entry.role === 'LBody')?.role as 'Lbl' | 'LBody' | undefined
        : undefined;
      const association = linkReferences.get(node.id);
      bindings.set(node.id, {
        paragraphId: paragraph?.id,
        listItemId: listItem?.id,
        listRegion,
        noteOwnerId: [...nodePath].reverse().find(entry => entry.role === 'Note')?.id,
        referencedNoteIds: association ? [...association.noteContentIds.keys()] : undefined,
        referencedNotes: association ? [...association.noteContentIds].map(([noteOwnerId, contentIds]) => ({
          noteOwnerId,
          contentIds: [...contentIds]
        })) : undefined,
        noteReferenceExpected: association?.expected,
        noteAssociationAmbiguous: association?.ambiguous,
        inTable: nodePath.some(entry => tableRoles.has(entry.role))
      });
    } else if (node.type !== undefined && node.type !== 'annotation') {
      malformed = true;
      return;
    }
    for (const child of node.children || []) visit(child, nodePath);
  };

  visit(value, []);
  return malformed ? undefined : bindings;
}

function attachPdfLineNoteMetadata(line: InternalPdfTextLine, bindings: Map<string, PdfStructureBinding> | undefined): void {
  if (!bindings?.size) return;
  const items = line.itemCells.flat();
  const itemBindings = items.map(item => item.contentId ? bindings.get(item.contentId) : undefined);
  const ownedItems = itemBindings.flatMap((binding, index) => binding?.noteOwnerId ? [{ binding, item: items[index] }] : []);
  const noteOwners = new Set(ownedItems.map(({ binding }) => binding.noteOwnerId!));
  if (ownedItems.length > 0) {
    line.noteContentIds = [...new Set(ownedItems.flatMap(({ item }) => item.contentId ? [item.contentId] : []))];
    if (ownedItems.length === items.length && noteOwners.size === 1) line.noteOwnerId = [...noteOwners][0];
    else line.noteAssociationAmbiguous = true;
  }

  const referencedNoteIds = new Set<string>();
  const referencedNotes = new Map<string, Set<string>>();
  for (const binding of itemBindings) {
    if (!binding) continue;
    for (const noteId of binding.referencedNoteIds || []) referencedNoteIds.add(noteId);
    for (const note of binding.referencedNotes || []) {
      const contentIds = referencedNotes.get(note.noteOwnerId) || new Set<string>();
      for (const contentId of note.contentIds) contentIds.add(contentId);
      referencedNotes.set(note.noteOwnerId, contentIds);
    }
    if (binding.noteAssociationAmbiguous) line.noteAssociationAmbiguous = true;
    if (binding.noteReferenceExpected && binding.referencedNotes?.length !== 1) line.unresolvedNumericReference = true;
  }
  if (referencedNoteIds.size > 0) line.referencedNoteIds = [...referencedNoteIds];
  if (referencedNotes.size > 0) {
    line.referencedNotes = [...referencedNotes].map(([noteOwnerId, contentIds]) => ({
      noteOwnerId,
      contentIds: [...contentIds]
    }));
  }
  if (items.some((item, index) => item.superscriptReference &&
      itemBindings[index]?.referencedNotes?.length !== 1)) {
    line.unresolvedNumericReference = true;
  }
}

function markUnresolvedRaisedNumericReferences(lines: InternalPdfTextLine[]): void {
  for (const line of lines) {
    if (line.noteOwnerId || line.cells.length !== 1 || !/^\d{1,3}$/.test(line.cells[0]) || line.itemCells[0]?.length !== 1) continue;
    if (line.referencedNoteIds?.length === 1 && !line.noteAssociationAmbiguous) continue;
    const reference = line.itemCells[0][0];
    if (!Number.isFinite(reference.height) || reference.height <= 0) continue;
    const geometricallyRaisedBesideText = lines.some(target => {
      if (target === line || target.pageNumber !== line.pageNumber || target.cells.length > 2) return false;
      const targetCellIndex = target.cells.length === 1 ? 0 : 1;
      const targetItems = target.itemCells[targetCellIndex];
      if (!targetItems?.length || !/[A-Za-z]{3,}/.test(target.cells[targetCellIndex])) return false;
      const heights = targetItems.map(item => item.height).filter(height => Number.isFinite(height) && height > 0).sort((a, b) => a - b);
      if (!heights.length) return false;
      const baselineHeight = heights[Math.floor(heights.length / 2)];
      const raisedBy = reference.y - target.y;
      // This is a conservative unknown-reference detector, not the successful
      // tagged-reference reflow rule. Near-body-sized numerals can still be
      // visibly raised; leave the stricter reflow tolerance unchanged above.
      if (reference.height > baselineHeight * 1.05 || reference.height < baselineHeight * 0.45 || raisedBy <= 2.5 || raisedBy > 5.5) return false;
      const ordered = [...targetItems].sort((left, right) => left.x - right.x);
      const previous = [...ordered].reverse().find(item => item.x + item.width <= reference.x + 1);
      const next = ordered.find(item => item.x >= reference.x);
      if (ordered.some(item => item.x < reference.x + reference.width - 1 && item.x + item.width > reference.x + 1)) return false;
      if (!previous || reference.x - (previous.x + previous.width) > 8) return false;
      if (next && next.x - (reference.x + reference.width) > 8) return false;
      const lineStart = Math.min(...ordered.map(item => item.x));
      const lineRight = Math.max(...ordered.map(item => item.x + item.width));
      return reference.x >= lineStart && reference.x <= lineRight + 8;
    });
    if (geometricallyRaisedBesideText) line.unresolvedNumericReference = true;
  }
}

function ownerForCell(
  cellItems: PositionedTextItem[] | undefined,
  bindings: Map<string, PdfStructureBinding>,
  kind: 'P' | 'LI',
  requiredListRegion?: 'Lbl' | 'LBody'
): PdfBlockOwner | undefined {
  if (!cellItems?.length) return undefined;
  let ownerId: string | undefined;
  for (const item of cellItems) {
    if (!item.contentId || !Number.isFinite(item.x) || !Number.isFinite(item.width) || item.width < 0) return undefined;
    const binding = bindings.get(item.contentId);
    if (!binding || binding.inTable) return undefined;
    if (kind === 'P' && binding.listItemId) return undefined;
    const candidateId = kind === 'P' ? binding.paragraphId : binding.listItemId;
    if (!candidateId || (kind === 'LI' && binding.listRegion !== requiredListRegion)) return undefined;
    if (ownerId !== undefined && ownerId !== candidateId) return undefined;
    ownerId = candidateId;
  }
  return ownerId ? { kind, id: ownerId } : undefined;
}

function itemBelongsToOwner(item: PositionedTextItem, owner: PdfBlockOwner, bindings: Map<string, PdfStructureBinding>): boolean {
  if (!item.contentId) return false;
  const binding = bindings.get(item.contentId);
  if (!binding || binding.inTable) return false;
  return owner.kind === 'P' ? binding.paragraphId === owner.id : binding.listItemId === owner.id;
}

function targetLineCellIsOwnedBy(
  line: InternalPdfTextLine,
  cellIndex: number,
  owner: PdfBlockOwner,
  bindings: Map<string, PdfStructureBinding>
): boolean {
  if (owner.kind === 'P') return lineIsOwnedBy(line, owner, bindings);
  const bodyOwner = ownerForCell(line.itemCells[cellIndex], bindings, 'LI', 'LBody');
  if (bodyOwner?.id !== owner.id) return false;
  if (line.cells.length === 1) return lineIsOwnedBy(line, owner, bindings, 'LBody');
  if (line.cells.length !== 2 || cellIndex !== 1) return false;
  return ownerForCell(line.itemCells[0], bindings, 'LI', 'Lbl')?.id === owner.id;
}

function lineIsOwnedBy(
  line: InternalPdfTextLine,
  owner: PdfBlockOwner,
  bindings: Map<string, PdfStructureBinding>,
  listRegion?: 'Lbl' | 'LBody'
): boolean {
  const items = line.itemCells.flat();
  return items.length > 0 && items.every(item => {
    if (!itemBelongsToOwner(item, owner, bindings)) return false;
    return owner.kind !== 'LI' || bindings.get(item.contentId!)?.listRegion === listRegion;
  });
}

function isStandaloneListMarker(value: string): boolean {
  const marker = value.trim();
  return /^(?:\d{1,3}[.)]?|\(?[A-Za-z][.)]?\)?|\(?[ivxlcdm]{1,8}[.)]\)?)$/i.test(marker);
}

function startsWithContinuationMarker(value: string): boolean {
  const trimmed = value.trim();
  if (/^\d{1,3}(?:[.)])?\s+\S/.test(trimmed) || /^[A-Za-z](?:[.)])?\s+\S/.test(trimmed)) return true;
  const romanMarker = /^([ivxlcdm]{2,8})([.)]?)\s+\S/i.exec(trimmed);
  if (!romanMarker) return false;
  if (romanMarker[2]) return true;
  const roman = romanMarker[1].toUpperCase();
  return /^(?=.+)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman);
}

function containsNumericCharacter(value: string): boolean {
  return /\d/.test(value);
}

function isUppercaseHeading(value: string): boolean {
  const trimmed = value.trim();
  if (/[\d$€£¥₹₩₿₺₽¢]/.test(trimmed)) return false;
  const letters = trimmed.match(/[A-Za-z]/g);
  const uppercaseAcronymPlural = trimmed.replace(/\b([A-Z]{2,})s\b/g, '$1S');
  return trimmed.length >= 8 && (trimmed.match(/\S+/g)?.length || 0) >= 1 &&
    Boolean(letters?.length) && [...uppercaseAcronymPlural.matchAll(/[A-Za-z]/g)]
      .every(match => match[0] === match[0].toUpperCase());
}

function fullWidthContinuation(
  line: InternalPdfTextLine,
  owner: PdfBlockOwner,
  bindings: Map<string, PdfStructureBinding>,
  expectedStart: number
): boolean {
  if (line.cells.length !== 1 || !lineIsOwnedBy(line, owner, bindings, owner.kind === 'LI' ? 'LBody' : undefined)) return false;
  const items = line.itemCells[0];
  const start = Math.min(...items.map(item => item.x));
  const right = Math.max(...items.map(item => item.x + item.width));
  return Math.abs(start - expectedStart) <= 12 && right - start >= 160 &&
    line.cells[0].split(/\s+/).filter(Boolean).length >= 8;
}

function attachTaggedSuperscriptReferences(
  lines: InternalPdfTextLine[],
  bindings: Map<string, PdfStructureBinding> | undefined
): boolean {
  if (!bindings?.size) return false;
  let ambiguousLayout = false;
  const referenceLines = lines.filter(line => line.cells.length === 1 && /^\d{1,3}$/.test(line.cells[0]) &&
    line.itemCells[0]?.length === 1
  );
  for (const referenceLine of referenceLines) {
    const reference = referenceLine.itemCells[0][0];
    const referenceOwner = ownerForCell(referenceLine.itemCells[0], bindings, 'P') ||
      ownerForCell(referenceLine.itemCells[0], bindings, 'LI', 'LBody');
    if (!Number.isFinite(reference.height) || reference.height <= 0) continue;
    const geometricCandidates = lines.flatMap(line => {
      if (line === referenceLine || line.cells.length > 2 || line.pageNumber !== referenceLine.pageNumber) return [];
      const targetCellIndex = line.cells.length === 1 ? 0 :
        line.cells.length === 2 && isStandaloneListMarker(line.cells[0]) ? 1 : -1;
      if (targetCellIndex < 0) return [];
      const lineItems = line.itemCells[targetCellIndex];
      if (!lineItems?.length) return [];
      const structuredBodyOwner = ownerForCell(lineItems, bindings, 'P') ||
        ownerForCell(lineItems, bindings, 'LI', 'LBody');
      if (!structuredBodyOwner) return [];
      const heights = lineItems.map(item => item.height).filter(height => Number.isFinite(height) && height > 0).sort((a, b) => a - b);
      if (!heights.length) return [];
      const baselineHeight = heights[Math.floor(heights.length / 2)];
      const raisedBy = reference.y - line.y;
      if (reference.height > baselineHeight * 0.8 || reference.height < baselineHeight * 0.45 || raisedBy <= 2.5 || raisedBy > 5.5) return [];

      const ordered = [...lineItems].sort((left, right) => left.x - right.x);
      const previous = [...ordered].reverse().find(item => item.x + item.width <= reference.x + 1);
      const next = ordered.find(item => item.x >= reference.x);
      if (ordered.some(item => item.x < reference.x + reference.width - 1 && item.x + item.width > reference.x + 1)) return [];
      if (!previous || reference.x - (previous.x + previous.width) > 8) return [];
      if (next && next.x - (reference.x + reference.width) > 8) return [];
      const lineStart = Math.min(...ordered.map(item => item.x));
      const lineRight = Math.max(...ordered.map(item => item.x + item.width));
      if (reference.x < lineStart || reference.x > lineRight + 8) return [];
      return [{ line, targetCellIndex }];
    });
    if (geometricCandidates.length !== 1) {
      if (geometricCandidates.length > 1) ambiguousLayout = true;
      continue;
    }

    const { line: target, targetCellIndex } = geometricCandidates[0];
    if (!referenceOwner || !targetLineCellIsOwnedBy(target, targetCellIndex, referenceOwner, bindings)) {
      ambiguousLayout = true;
      continue;
    }
    const merged = createPositionedLine([...target.itemCells.flat(), { ...reference, superscriptReference: true }],
      target.pageNumber, target.y);
    // A footnote marker must sit inside one prose line; a large visual gap
    // would make it a separate cell, an orphan, or a table value.
    if (merged.cells.length !== 1 && !(merged.cells.length === 2 && isStandaloneListMarker(merged.cells[0]))) {
      ambiguousLayout = true;
      continue;
    }
    target.text = merged.text;
    target.cells = merged.cells;
    target.cellStarts = merged.cellStarts;
    target.itemCells = merged.itemCells;
    lines.splice(lines.indexOf(referenceLine), 1);
  }
  return ambiguousLayout;
}

function reflowTaggedParagraphs(lines: InternalPdfTextLine[], bindings: Map<string, PdfStructureBinding> | undefined): boolean {
  if (!bindings?.size) return false;
  const ambiguousLayout = attachTaggedSuperscriptReferences(lines, bindings);
  const owners = new Map<string, { owner: PdfBlockOwner; lines: Set<InternalPdfTextLine> }>();
  for (const line of lines) {
    for (const item of line.itemCells.flat()) {
      if (!item.contentId) continue;
      const binding = bindings.get(item.contentId);
      if (binding?.paragraphId) {
        const key = `P:${binding.paragraphId}`;
        const entry = owners.get(key) || { owner: { kind: 'P' as const, id: binding.paragraphId }, lines: new Set<InternalPdfTextLine>() };
        entry.lines.add(line);
        owners.set(key, entry);
      }
      if (binding?.listItemId) {
        const key = `LI:${binding.listItemId}`;
        const entry = owners.get(key) || { owner: { kind: 'LI' as const, id: binding.listItemId }, lines: new Set<InternalPdfTextLine>() };
        entry.lines.add(line);
        owners.set(key, entry);
      }
    }
  }

  for (const { owner, lines: blockLineSet } of owners.values()) {
    const blockLines = [...blockLineSet];
    const markerCandidates = blockLines.filter(line => {
      if (line.cells.length !== 2 || !isStandaloneListMarker(line.cells[0])) return false;
      const letterHeadingCandidate = owner.kind === 'P' && /^[A-Z][.)]?$/.test(line.cells[0].trim()) &&
        isUppercaseHeading(line.cells[1]);
      if (line.cells[1].trim().length < 20 && !letterHeadingCandidate) return false;
      const markerStart = line.cellStarts[0];
      const bodyStart = line.cellStarts[1];
      const markerRight = Math.max(...line.itemCells[0].map(item => item.x + item.width));
      const gutter = bodyStart - markerRight;
      if (!Number.isFinite(markerStart) || !Number.isFinite(bodyStart) || !Number.isFinite(gutter) ||
          gutter < 0 || gutter > 48 || bodyStart - markerStart > 48) return false;
      const paragraphMarker = ownerForCell(line.itemCells[0], bindings, 'P');
      const paragraphBody = ownerForCell(line.itemCells[1], bindings, 'P');
      if (owner.kind === 'P' && paragraphMarker?.id === owner.id && paragraphBody?.id === owner.id) return true;
      const listLabel = ownerForCell(line.itemCells[0], bindings, 'LI', 'Lbl');
      const listBody = ownerForCell(line.itemCells[1], bindings, 'LI', 'LBody');
      return owner.kind === 'LI' && listLabel?.id === owner.id && listBody?.id === owner.id;
    });
    if (markerCandidates.length !== 1) continue;
    const markerLine = markerCandidates[0];
    const markerStart = markerLine.cellStarts[0];
    const bodyText = markerLine.cells[1];
    const continuations = blockLines.filter(line => line !== markerLine).sort((left, right) => right.y - left.y);
    const letterHeading = owner.kind === 'P' && /^[A-Z][.)]?$/.test(markerLine.cells[0].trim()) &&
      isUppercaseHeading(bodyText) && continuations.length === 0;
    const expectedContinuationStart = markerStart;
    if (!letterHeading) {
      if (!continuations.length) continue;
      const shortAlignedTail = (line: InternalPdfTextLine): boolean =>
        line.cells.length === 1 && lineIsOwnedBy(line, owner, bindings, owner.kind === 'LI' ? 'LBody' : undefined) &&
        Math.abs(line.cellStarts[0] - expectedContinuationStart) <= 12 && /[A-Za-z]{3,}/.test(line.cells[0]) &&
        !containsNumericCharacter(line.itemCells[0].filter(item => !item.superscriptReference).map(item => item.text).join(' '));
      const tail = continuations.at(-1)!;
      const priorLines = continuations.slice(0, -1);
      let priorBaseline = markerLine.y;
      const lineFlowIsConsecutive = continuations.every(line => {
        const gap = priorBaseline - line.y;
        priorBaseline = line.y;
        return gap >= 8 && gap <= 24;
      });
      const substantiveMarkerBody = markerLine.cells[1].split(/\s+/).filter(Boolean).length >= 8 &&
        Math.max(...markerLine.itemCells[1].map(item => item.x + item.width)) - markerLine.cellStarts[1] >= 160;
      const everyPriorLineIsFullWidth = priorLines.every(line => fullWidthContinuation(line, owner, bindings, expectedContinuationStart));
      const fullWidthTail = fullWidthContinuation(tail, owner, bindings, expectedContinuationStart);
      const supportedShortTail = !fullWidthTail && shortAlignedTail(tail) &&
        (priorLines.length > 0 || substantiveMarkerBody);
      if (!lineFlowIsConsecutive || !everyPriorLineIsFullWidth || (!fullWidthTail && !supportedShortTail)) continue;
      if (continuations.some(line => startsWithContinuationMarker(line.cells[0]))) continue;
    }
    if (blockLines.some(line => line !== markerLine && line.cells.length !== 1)) continue;
    const combinedText = `${markerLine.cells[0]} ${bodyText}`.trim();
    markerLine.cells = [combinedText];
    markerLine.cellStarts = [markerStart];
    markerLine.itemCells = [[...markerLine.itemCells[0], ...markerLine.itemCells[1]]];
    markerLine.text = combinedText;
  }
  return ambiguousLayout;
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
    let hasAmbiguousTaggedLayout = false;
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: true });
      let structureBindings: Map<string, PdfStructureBinding> | undefined;
      let structureTreeAvailable = false;
      let markedContentValid = true;
      try {
        const structureTree = await page.getStructTree();
        structureTreeAvailable = Boolean(structureTree);
        structureBindings = indexPdfStructureTree(structureTree, pageNumber);
        if (structureTreeAvailable && !structureBindings) hasAmbiguousTaggedLayout = true;
      } catch {
        // Structure is optional evidence for reflow. If it is unavailable or
        // malformed, retain the original visual layout and ambiguity result.
        hasAmbiguousTaggedLayout = true;
      }
      const positioned: PositionedTextItem[] = [];
      const contentIdStack: Array<string | undefined> = [];
      const seenContentIds = new Set<string>();
      let activeContentId: string | undefined;
      for (const item of content.items) {
        if ('type' in item) {
          if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
            contentIdStack.push(activeContentId);
            if (item.type === 'beginMarkedContentProps' && (!('id' in item) ||
                (item.id !== null && typeof item.id !== 'string'))) {
              markedContentValid = false;
            }
            const contentId = 'id' in item && typeof item.id === 'string' ? item.id : undefined;
            if (contentId && seenContentIds.has(contentId)) markedContentValid = false;
            if (contentId) seenContentIds.add(contentId);
            activeContentId = contentId;
          } else if (item.type === 'endMarkedContent') {
            if (!contentIdStack.length) {
              markedContentValid = false;
              activeContentId = undefined;
            } else {
              activeContentId = contentIdStack.pop();
            }
          } else {
            markedContentValid = false;
          }
          continue;
        }
        if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width;
        if (![x, y, width].every(Number.isFinite)) {
          throw new PdfDocumentExtractionError('PDF text has incomplete layout coordinates');
        }
        positioned.push({ text: item.str, x, y, width, height: item.height, contentId: activeContentId });
      }
      if (contentIdStack.length) markedContentValid = false;
      const pageLines = groupPositionedTextIntoLines(positioned, pageNumber);
      if (structureTreeAvailable && !markedContentValid) hasAmbiguousTaggedLayout = true;
      hasAmbiguousTaggedLayout = reflowTaggedParagraphs(pageLines, markedContentValid ? structureBindings : undefined) ||
        hasAmbiguousTaggedLayout;
      for (const line of pageLines) attachPdfLineNoteMetadata(line, markedContentValid ? structureBindings : undefined);
      markUnresolvedRaisedNumericReferences(pageLines);
      const pageText = pageLines.map(line => line.text).join('\n').trim();
      if (!pageText) hasEmptyPageText = true;
      characters += pageText.length;
      if (characters > characterLimit) {
        throw new PdfDocumentExtractionError('PDF extracted text exceeded the supported character limit');
      }
      lines.push(...pageLines.map(({ itemCells: _itemCells, ...line }) => line));
      pageTexts.push(pageText);
      page.cleanup();
    }
    const text = pageTexts.map((pageText, index) => `Page ${index + 1}\n${pageText}`).join('\n\n').trim();
    if (text.length < 55 || text.split(/\s+/).filter(Boolean).length < 10) {
      throw new PdfDocumentExtractionError('PDF has no substantive embedded text; scanned or image-only pages are unsupported');
    }
    const table = assessTableStructure(lines);
    const tableStructure = hasAmbiguousTaggedLayout ? 'AMBIGUOUS' : table.structure;
    return {
      text,
      pageTexts,
      lines,
      pageCount: document.numPages,
      tableDetected: table.detected,
      tableStructure,
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
