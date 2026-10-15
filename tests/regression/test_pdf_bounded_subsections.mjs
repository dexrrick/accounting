import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';

const fixtureRoot = new URL('../fixtures/mas-reviewed/transport-investigation-20261016-context-live/', import.meta.url);
const requestFixture = JSON.parse(await readFile(new URL('../fixtures/mas-reviewed/subsection-requests-20261016.json', import.meta.url), 'utf8'));
const htmlRequest = requestFixture.documents[0].request;
const genuineRequest = requestFixture.documents[1].request;
assert.equal(Object.hasOwn(htmlRequest, 'sectionEndHeading'), false, 'the retained MAS HTML request stays unchanged');
assert.equal(genuineRequest.sectionEndHeading,
  'Anti-Money Laundering and Countering the Financing of Terrorism (AML/CFT)');

const genuineManifest = JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8'));
const genuineCapture = genuineManifest.documents.find(document => document.request.documentKind === 'PDF');
const genuineBytes = gunzipSync(await readFile(new URL(genuineCapture.bodyFile, fixtureRoot)));
assert.equal(genuineCapture.integrity.computedSha256, '305c50130aa341d7f2033118a825ee90d8cc3bd7475ed52a909bb604060aea17');

function envelope(bytes, url = genuineRequest.url, contentType = 'application/pdf') {
  return {
    status: 'SUCCESS',
    httpStatus: 200,
    sourceUrl: url,
    finalUrl: url,
    contentType,
    retrievedAt: '2026-10-16T00:00:00.000Z',
    contentBytes: new Uint8Array(bytes)
  };
}

const genuine = await extractOfficialDocumentFromRetrieved(genuineRequest, {
  ...genuineCapture.fetch,
  contentBytes: new Uint8Array(genuineBytes)
});
assert.equal(genuine.status, 'SUCCESS', genuine.status === 'REJECTED' ? genuine.reason : '');
assert.equal(genuine.record.documentHash, genuineCapture.integrity.computedSha256);
assert.equal(genuine.record.extractionStatus, 'EXACT');
assert.equal(genuine.record.isVerbatimText, true);
assert.equal(genuine.record.sourceLocator.pageNumber, 3);
assert.equal(genuine.record.sourceLocator.pageCount, 5);
assert.match(genuine.record.sourceText, /9 The review observed a small number of VCC managers/,
  'numeric paragraph 9 remains part of the bounded subsection');
assert.match(genuine.record.sourceText, /10 Another potential area of concern/);
assert.match(genuine.record.sourceText, /their investment performance;/);
assert.match(genuine.record.sourceText, /\(ii\) set up VCCs that merely serve as a conduit/);
assert.match(genuine.record.sourceText, /\(iii\) purely engage in marketing of the VCCs\./);
assert.match(genuine.record.sourceText, /Paragraph 3\.3 of Guidelines on Licensing and Conduct of Business for Fund Management Companies/,
  'the linked footnote outside the selected page interval is attached to its selected-body reference');
assert.doesNotMatch(genuine.record.sourceText, /Anti-Money Laundering and Countering the Financing of Terrorism/);
assert.doesNotMatch(genuine.record.sourceText, /Regulation 13B\(1\)\(c\) of Securities and Futures/,
  'an unreferenced footnote before the subsection is excluded');
assert.doesNotMatch(genuine.record.sourceText, /By extension, the EFIs appointed/,
  'an unreferenced note after the end heading is excluded');
assert.doesNotMatch(genuine.record.sourceText, /Circular No\. AMLD 06\/2022-1/,
  'a later AML/CFT note is excluded');
assert.match(genuine.record.sourceLocator.canonicalLocator, /page 3 .*Substantive Fund Management Activity/);
assert.match(genuine.record.sourceLocator.canonicalLocator, /exclusive page 4 .*Anti-Money Laundering/);
assert.match(genuine.record.sourceLocator.canonicalLocator, /p8R_mc27/);
assert.match(genuine.record.sourceLocator.canonicalLocator, /p8R_mc28/);

const legacyRequest = { ...genuineRequest };
delete legacyRequest.sectionEndHeading;
const legacy = await extractOfficialDocumentFromRetrieved(legacyRequest, envelope(genuineBytes));
assert.equal(legacy.status, 'REJECTED');
assert.equal(legacy.code, 'PDF_SECTION_NOT_SUBSTANTIVE',
  'the old request retains the guarded numeric-prefix boundary behavior');

const unsupportedHistory = await extractOfficialDocumentFromRetrieved({
  ...genuineRequest,
  asOfDate: '2025-06-26'
}, envelope(genuineBytes));
assert.equal(unsupportedHistory.status, 'REJECTED');
assert.equal(unsupportedHistory.code, 'HISTORICAL_DATE_UNVERIFIED');

function escapePdfText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function mcr(mcid) {
  return { mcid };
}

function struct(role, children) {
  return { role, children };
}

function createPdf({ items, structure }) {
  let stream = '';
  let activeContentGroup;
  items.forEach((item, index) => {
    const contentGroup = item.mcid === undefined
      ? undefined
      : `${item.contentGroup ?? `item-${index}`}:${item.mcid}`;
    if (contentGroup !== activeContentGroup) {
      if (activeContentGroup !== undefined) stream += 'EMC\n';
      if (contentGroup !== undefined) stream += `/P <</MCID ${item.mcid}>> BDC\n`;
      activeContentGroup = contentGroup;
    }
    stream += `BT /F1 ${item.fontSize ?? 11} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${escapePdfText(item.text)}) Tj ET\n`;
  });
  if (activeContentGroup !== undefined) stream += 'EMC\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R${structure ? ' /StructParents 0' : ''} >>`,
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  if (structure) {
    objects[0] = '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>';
    objects.push('');
    const parentByMcid = new Map();
    const serializeStruct = (node, parentRef) => {
      const objectId = objects.length + 1;
      objects.push('');
      const kids = node.children.map(child => {
        if (typeof child.mcid === 'number') {
          parentByMcid.set(child.mcid, objectId);
          return `<< /Type /MCR /Pg 3 0 R /MCID ${child.mcid} >>`;
        }
        return `${serializeStruct(child, objectId)} 0 R`;
      });
      objects[objectId - 1] = `<< /Type /StructElem /S /${node.role} /P ${parentRef} 0 R /Pg 3 0 R /K [${kids.join(' ')}] >>`;
      return objectId;
    };
    const topRefs = structure.map(node => `${serializeStruct(node, 6)} 0 R`);
    const maxMcid = Math.max(-1, ...items.map(item => item.mcid ?? -1));
    const parentTreeId = objects.length + 1;
    const parentRefs = Array.from({ length: maxMcid + 1 }, (_, mcid) =>
      parentByMcid.has(mcid) ? `${parentByMcid.get(mcid)} 0 R` : 'null'
    );
    objects.push(`<< /Nums [0 [${parentRefs.join(' ')}]] >>`);
    objects[5] = `<< /Type /StructTreeRoot /K [${topRefs.join(' ')}] /ParentTree ${parentTreeId} 0 R /ParentTreeNextKey 1 >>`;
  }
  let document = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

const START = 'Substantive Fund Management Activity';
const END = 'Anti-Money Laundering and Countering the Financing of Terrorism (AML/CFT)';
const syntheticRequest = {
  ...genuineRequest,
  url: 'https://www.mas.gov.sg/synthetic/iid-04-2025.pdf',
  sectionHeading: START,
  sectionEndHeading: END
};

function subsectionPdf({ noteMode = 'linked', duplicateStart = false, duplicateEnd = false, reverse = false, headingOnly = false,
  referenceFontSize = 6, referenceYOffset = 4 } = {}) {
  const items = [
    { x: 72, y: 760, text: 'GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES', mcid: 0 },
    { x: 72, y: 740, text: 'IID 04/2025 VCC fund management guidance', mcid: 1 }
  ];
  const paragraphs = [struct('P', [mcr(0)]), struct('P', [mcr(1)])];
  const startMcid = 2;
  const bodyMarkerMcid = 4;
  const bodyTextMcid = 3;
  const endMcid = 5;
  const nextMcid = 6;
  const linkedNoteChildren = ['linked', 'mixed', 'partial', 'absent', 'wrapped-content-id'].includes(noteMode)
    ? [struct('Link', [struct('Span', [mcr(bodyMarkerMcid)]), struct('Note', [struct('P', [mcr(7), mcr(8)])])])]
    : noteMode === 'missing'
      ? [struct('Link', [struct('Span', [mcr(bodyMarkerMcid)]), struct('Note', [struct('P', [mcr(99)])])])]
      : noteMode === 'conflicting'
        ? [struct('Link', [struct('Span', [mcr(bodyMarkerMcid)]), struct('Note', [struct('P', [mcr(7)])]), struct('Note', [struct('P', [mcr(8)])])])]
        : noteMode === 'duplicate'
          ? [struct('Link', [struct('Span', [mcr(bodyMarkerMcid)]), struct('Note', [struct('P', [mcr(7)])])]),
            struct('Link', [struct('Span', [mcr(bodyMarkerMcid)]), struct('Note', [struct('P', [mcr(8)])])])]
        : [mcr(bodyMarkerMcid)];
  const bodyText = headingOnly ? undefined : { x: 72, y: 675, text: '9 VCCs', mcid: bodyTextMcid };
  if (!reverse) {
    items.push({ x: 72, y: 700, text: START, mcid: startMcid });
    paragraphs.push(struct('P', [mcr(startMcid)]));
  }
  if (bodyText) {
    if (noteMode === 'untagged') {
      items.push({ ...bodyText, text: `${bodyText.text} provide fund management guidance under IID 04/2025.`, mcid: undefined });
    } else {
      items.push(bodyText, { x: 111, y: 675 + referenceYOffset, text: '1', fontSize: referenceFontSize, mcid: bodyMarkerMcid },
        { x: 119, y: 675, text: ' provide fund management guidance under IID 04/2025.', mcid: 9 });
    }
    paragraphs.push(struct('P', [mcr(bodyTextMcid), ...linkedNoteChildren, mcr(9)]));
  }
  if (!reverse) {
    items.push({ x: 72, y: 620, text: END, mcid: endMcid });
    paragraphs.push(struct('P', [mcr(endMcid)]));
  } else {
    items.push({ x: 72, y: 700, text: END, mcid: endMcid },
      { x: 72, y: 660, text: START, mcid: startMcid });
    paragraphs.push(struct('P', [mcr(endMcid)]), struct('P', [mcr(startMcid)]));
  }
  if (duplicateStart) {
    items.push({ x: 72, y: 590, text: START, mcid: 10 });
    paragraphs.push(struct('P', [mcr(10)]));
  }
  if (duplicateEnd) {
    items.push({ x: 72, y: 570, text: END, mcid: 11 });
    paragraphs.push(struct('P', [mcr(11)]));
  }
  items.push({ x: 72, y: 540, text: 'Next section', mcid: nextMcid });
  paragraphs.push(struct('P', [mcr(nextMcid)]));
  if (noteMode === 'linked' || noteMode === 'mixed' || noteMode === 'partial' || noteMode === 'wrapped-content-id') {
    items.push({ x: 72, y: 80, text: '1 Footnote supporting fund management.', mcid: 7 });
    if (noteMode !== 'partial') {
      items.push({ x: 72, y: 60, text: 'Continuation remains in the exact source note.', mcid: 8,
        ...(noteMode === 'wrapped-content-id' ? { contentGroup: 'wrapped-note' } : {}) });
    }
    if (noteMode === 'wrapped-content-id') {
      items.push({ x: 72, y: 40, text: 'Additional wrapped qualification stays exact.', mcid: 8, contentGroup: 'wrapped-note' });
    }
    if (noteMode === 'mixed') items.push({ x: 300, y: 80, text: 'unowned text shares note line' });
  } else if (noteMode === 'conflicting') {
    items.push({ x: 72, y: 80, text: '1 First possible note.', mcid: 7 },
      { x: 72, y: 60, text: '2 Second possible note.', mcid: 8 });
  } else if (noteMode === 'duplicate') {
    items.push({ x: 72, y: 80, text: '1 First possible note.', mcid: 7 },
      { x: 72, y: 60, text: '2 Second possible note.', mcid: 8 });
  } else if (noteMode === 'unbound') {
    items.push({ x: 72, y: 80, text: '1 Unlinked footnote text appears after the selected end heading.' });
  }
  return createPdf({ items, structure: noteMode === 'untagged' ? undefined : [struct('Document', paragraphs)] });
}

async function extractSynthetic(bytes, request = syntheticRequest) {
  return extractOfficialDocumentFromRetrieved(request, envelope(bytes, request.url));
}

const boundedSynthetic = await extractSynthetic(subsectionPdf());
assert.equal(boundedSynthetic.status, 'SUCCESS', boundedSynthetic.status === 'REJECTED' ? boundedSynthetic.reason : '');
assert.equal(boundedSynthetic.record.extractionStatus, 'EXACT');
assert.match(boundedSynthetic.record.sourceText, /9 VCCs1 provide fund management guidance/,
  'an unrelated numeric paragraph prefix stays inside the explicitly bounded source text');
assert.match(boundedSynthetic.record.sourceText, /Continuation remains in the exact source note\./,
  'wrapped note content is appended in document order');
assert.match(boundedSynthetic.record.sourceLocator.canonicalLocator, /p3R_mc7/);
assert.match(boundedSynthetic.record.sourceLocator.canonicalLocator, /p3R_mc8/);

const repeatedContentIdWrappedNote = await extractSynthetic(subsectionPdf({ noteMode: 'wrapped-content-id' }));
assert.equal(repeatedContentIdWrappedNote.status, 'SUCCESS',
  repeatedContentIdWrappedNote.status === 'REJECTED' ? repeatedContentIdWrappedNote.reason : '');
assert.match(repeatedContentIdWrappedNote.record.sourceText, /Continuation remains in the exact source note\.[\s\S]*Additional wrapped qualification stays exact\./,
  'a legitimate single tagged content span may supply multiple wrapped note lines');

const untaggedBounded = await extractSynthetic(subsectionPdf({ noteMode: 'untagged' }));
assert.equal(untaggedBounded.status, 'SUCCESS', untaggedBounded.status === 'REJECTED' ? untaggedBounded.reason : '');
assert.equal(untaggedBounded.record.extractionStatus, 'EXACT', 'simple exact bounds remain usable for untagged PDFs without references');

for (const [label, bytes] of [
  ['missing start', subsectionPdf()],
  ['missing end', subsectionPdf()]
]) {
  const request = label === 'missing start'
    ? { ...syntheticRequest, sectionHeading: 'No such heading' }
    : { ...syntheticRequest, sectionEndHeading: 'No such end heading' };
  const result = await extractSynthetic(bytes, request);
  assert.equal(result.status, 'REJECTED', `${label} is rejected`);
  assert.equal(result.code, 'SECTION_BOUNDARY_UNVERIFIED');
}

for (const [label, bytes] of [
  ['duplicate start', subsectionPdf({ duplicateStart: true })],
  ['duplicate end', subsectionPdf({ duplicateEnd: true })],
  ['reversed boundary', subsectionPdf({ reverse: true })]
]) {
  const result = await extractSynthetic(bytes);
  assert.equal(result.status, 'REJECTED', `${label} is rejected`);
  assert.equal(result.code, 'SECTION_BOUNDARY_UNVERIFIED');
}

const headingOnly = await extractSynthetic(subsectionPdf({ headingOnly: true }));
assert.equal(headingOnly.status, 'REJECTED');
assert.equal(headingOnly.code, 'PDF_SECTION_NOT_SUBSTANTIVE');

for (const [label, pdf] of [
  ['missing note target', subsectionPdf({ noteMode: 'missing' })],
  ['wholly absent linked note', subsectionPdf({ noteMode: 'absent' })],
  ['partly absent linked note continuation', subsectionPdf({ noteMode: 'partial' })],
  ['conflicting note ownership', subsectionPdf({ noteMode: 'conflicting' })],
  ['duplicate note association', subsectionPdf({ noteMode: 'duplicate' })],
  ['mixed note ownership', subsectionPdf({ noteMode: 'mixed' })]
]) {
  const result = await extractSynthetic(pdf);
  assert.equal(result.status, 'REJECTED', `${label} fails closed`);
  assert.equal(result.code, 'SECTION_BOUNDARY_UNVERIFIED');
}

const unboundRaisedReference = await extractSynthetic(subsectionPdf({ noteMode: 'unbound' }));
assert.equal(unboundRaisedReference.status, 'REJECTED');
assert.equal(unboundRaisedReference.code, 'SECTION_BOUNDARY_UNVERIFIED',
  'an attached raised numeric reference without a tagged Note association cannot pass as exact');

for (const referenceFontSize of [8.7, 8.8, 8.9, 9, 10.9]) {
  const result = await extractSynthetic(subsectionPdf({ noteMode: 'unbound', referenceFontSize }));
  assert.equal(result.status, 'REJECTED',
    `an unbound raised numeral at ${referenceFontSize}pt must fail even when it exceeds the tagged-reflow size cutoff`);
  assert.equal(result.code, 'SECTION_BOUNDARY_UNVERIFIED');
}

const baselineNumericProse = await extractSynthetic(subsectionPdf({
  noteMode: 'unbound', referenceFontSize: 11, referenceYOffset: 0
}));
assert.equal(baselineNumericProse.status, 'SUCCESS',
  baselineNumericProse.status === 'REJECTED' ? baselineNumericProse.reason : '');
assert.match(baselineNumericProse.record.sourceText, /9 VCCs 1 provide fund management guidance/,
  'a same-baseline numeric prose item is not misclassified as an unresolved raised reference');

for (const invalidRequest of [
  { ...syntheticRequest, sectionHeading: undefined },
  { ...syntheticRequest, sectionEndHeading: '  ' },
  { ...syntheticRequest, sectionEndHeading: 'x'.repeat(257) },
  { ...syntheticRequest, sectionEndHeading: START },
  { ...syntheticRequest, documentKind: 'HTML' }
]) {
  const result = await extractSynthetic(subsectionPdf(), invalidRequest);
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.code, 'INVALID_REQUEST');
}

const autoHtmlRequest = { ...syntheticRequest, documentKind: 'AUTO' };
const htmlResponse = '<html><body><h1>GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES</h1></body></html>';
const ignoredOnHtml = await extractOfficialDocumentFromRetrieved(autoHtmlRequest, envelope(
  Buffer.from(htmlResponse), autoHtmlRequest.url, 'text/html; charset=utf-8'
));
assert.equal(ignoredOnHtml.status, 'REJECTED');
assert.equal(ignoredOnHtml.code, 'PDF_END_HEADING_UNSUPPORTED');

console.log('PASS | Explicit PDF start/end headings bind the complete MAS subsection and only structurally linked notes');
