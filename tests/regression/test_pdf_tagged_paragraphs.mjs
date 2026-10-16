import assert from 'node:assert/strict';
import { extractPdfDocumentText } from '../../src/retrieval/pdfDocumentTextExtractor.ts';

function pdfText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function mcr(mcid) {
  return { mcid };
}

function struct(role, children) {
  return { role, children };
}

function createPdf({ items, structure }) {
  const stream = items.map(item => {
    const marked = item.mcid === undefined ? '' : `/P <</MCID ${item.mcid}>> BDC\n`;
    const endMarked = item.mcid === undefined ? '' : 'EMC\n';
    return `${marked}BT /F1 ${item.fontSize ?? 11} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${pdfText(item.text)}) Tj ET\n${endMarked}`;
  }).join('');
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

function paragraphItems({ markerX = 72, bodyX = 108, markerMcid = 0, bodyMcid = 1, continuationMcid = 2, footnoteMcid = 3 } = {}) {
  return [
    { x: markerX, y: 700, text: '1.', mcid: markerMcid },
    { x: bodyX, y: 700, text: 'The manager must document all decisions affecting the fund.', mcid: bodyMcid },
    { x: markerX, y: 680, text: 'These records must remain complete and available for independent review.', mcid: continuationMcid },
    { x: 72, y: 60, text: 'Footnote 1: the term includes a designated fund manager.', mcid: footnoteMcid }
  ];
}

const taggedParagraphBytes = createPdf({
  items: paragraphItems(),
  structure: [
    struct('Document', [
      struct('P', [mcr(0), mcr(1), mcr(2)]),
      struct('Note', [struct('P', [mcr(3)])])
    ])
  ]
});
const taggedParagraph = await extractPdfDocumentText(taggedParagraphBytes);
assert.equal(taggedParagraph.tableStructure, 'NONE');
assert.ok(taggedParagraph.lines.some(line => line.text === '1. The manager must document all decisions affecting the fund.'),
  'same-paragraph marker and prose cells should be rejoined');
assert.ok(taggedParagraph.pageTexts[0].includes('Footnote 1: the term includes a designated fund manager.'),
  'footnote text remains in page order after reflow');

const taggedShortTrailingContinuation = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'The manager shall maintain all relevant records in a complete and accessible manner.', mcid: 1 },
    { x: 72, y: 680, text: 'These records must be available for inspection by the regulator when requested.', mcid: 2 },
    { x: 72, y: 660, text: 'and retained securely.', mcid: 3 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2), mcr(3)])])]
}));
assert.equal(taggedShortTrailingContinuation.tableStructure, 'NONE');
assert.ok(taggedShortTrailingContinuation.lines.some(line =>
  line.text === '1. The manager shall maintain all relevant records in a complete and accessible manner.'
));
assert.ok(taggedShortTrailingContinuation.pageTexts[0].includes('and retained securely.'),
  'a short final continuation remains in the paragraph after earlier full-width prose');

const taggedDidContinuation = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '9', mcid: 0 },
    { x: 108, y: 700, text: 'The review observed a small number of VCC managers as managing multiple VCCs that', mcid: 1 },
    { x: 72, y: 680, text: 'did not hold any assets and/or did not have any investors during the review period.', mcid: 2 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2)])])]
}));
assert.equal(taggedDidContinuation.tableStructure, 'NONE');
assert.ok(taggedDidContinuation.lines.some(line =>
  line.text === '9 The review observed a small number of VCC managers as managing multiple VCCs that'
), 'ordinary prose beginning with “did not” is not mistaken for a Roman numeral marker');

const taggedRomanContinuation = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '10.', mcid: 0 },
    { x: 112, y: 700, text: 'The review describes the duties applying to the manager.', mcid: 1 },
    { x: 72, y: 680, text: 'iv is relevant to the structure and operation of the manager.', mcid: 2 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2)])])]
}));
assert.equal(taggedRomanContinuation.tableStructure, 'AMBIGUOUS');
assert.ok(taggedRomanContinuation.lines.some(line => line.cells.length === 2 && line.cells[0] === '10.'),
  'a valid bare Roman numeral remains guarded as a possible list marker');

const taggedSuperscriptReference = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'VCCs', mcid: 1 },
    { x: 138, y: 704, text: '1', fontSize: 6, mcid: 2 },
    { x: 147, y: 700, text: 'and their managers shall retain complete records for review.', mcid: 3 },
    { x: 72, y: 680, text: 'These managers shall maintain complete records for every regulatory requirement.', mcid: 4 },
    { x: 72, y: 60, text: 'Footnote 1: relevant statutory provisions apply.', mcid: 5 }
  ],
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(1), mcr(2), mcr(3), mcr(4)]),
    struct('Note', [struct('P', [mcr(5)])])
  ])]
}));
assert.equal(taggedSuperscriptReference.tableStructure, 'NONE');
assert.ok(taggedSuperscriptReference.lines.some(line => line.text === '1. VCCs1 and their managers shall retain complete records for review.'));
assert.ok(taggedSuperscriptReference.pageTexts[0].includes('Footnote 1: relevant statutory provisions apply.'),
  'attaching an inline reference preserves the separate footnote body');

const taggedLetterHeading = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: 'A', mcid: 0 },
    { x: 108, y: 700, text: 'GOVERNANCE AND MANAGEMENT', mcid: 1 },
    { x: 72, y: 660, text: 'The document explains governance duties and management responsibilities for the fund manager.', mcid: 2 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1)]), struct('P', [mcr(2)])])]
}));
assert.equal(taggedLetterHeading.tableStructure, 'NONE');
assert.ok(taggedLetterHeading.lines.some(line => line.text === 'A GOVERNANCE AND MANAGEMENT'));

const taggedAcronymAndSingleWordHeadings = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: 'A', mcid: 0 },
    { x: 108, y: 700, text: 'PROFILE OF VCCs AND KEY REGULATORY REQUIREMENTS', mcid: 1 },
    { x: 72, y: 680, text: 'C', mcid: 2 },
    { x: 108, y: 680, text: 'CONCLUSION', mcid: 3 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1)]), struct('P', [mcr(2), mcr(3)])])]
}));
assert.equal(taggedAcronymAndSingleWordHeadings.tableStructure, 'NONE');
assert.ok(taggedAcronymAndSingleWordHeadings.lines.some(line => line.text === 'A PROFILE OF VCCs AND KEY REGULATORY REQUIREMENTS'));
assert.ok(taggedAcronymAndSingleWordHeadings.lines.some(line => line.text === 'C CONCLUSION'));

const taggedCurrencyHeading = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: 'A', mcid: 0 },
    { x: 108, y: 700, text: 'SGD99999', mcid: 1 },
    { x: 72, y: 650, text: 'This separate paragraph contains unrelated substantive text for context.', mcid: 2 }
  ],
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(1)]),
    struct('P', [mcr(2)])
  ])]
}));
assert.equal(taggedCurrencyHeading.tableStructure, 'AMBIGUOUS');
assert.ok(taggedCurrencyHeading.lines.some(line => line.cells.length === 2 && line.cells[0] === 'A' && line.cells[1] === 'SGD99999'),
  'digit-bearing content is not accepted as a lettered heading body');

const taggedListItem = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '(i)', mcid: 0 },
    { x: 108, y: 700, text: 'Each fund manager shall retain the required records.', mcid: 1 },
    { x: 72, y: 680, text: 'Those records must be accessible to the regulator on request.', mcid: 2 }
  ],
  structure: [struct('Document', [struct('L', [struct('LI', [
    struct('Lbl', [mcr(0)]),
    struct('LBody', [mcr(1), mcr(2)])
  ])])])]
}));
assert.equal(taggedListItem.tableStructure, 'NONE');
assert.ok(taggedListItem.lines.some(line => line.text === '(i) Each fund manager shall retain the required records.'));

const taggedListSuperscriptReference = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '(a)', mcid: 0 },
    { x: 125, y: 700, text: 'VCCs', mcid: 1 },
    { x: 155, y: 704, text: '2', fontSize: 6, mcid: 2 },
    { x: 164, y: 700, text: 'shall maintain complete records for all relevant matters.', mcid: 3 },
    { x: 125, y: 680, text: 'Those records must be accessible to the regulator on request.', mcid: 4 }
  ],
  structure: [struct('Document', [struct('L', [struct('LI', [
    struct('Lbl', [mcr(0)]),
    struct('LBody', [mcr(1), mcr(2), mcr(3), mcr(4)])
  ])])])]
}));
assert.equal(taggedListSuperscriptReference.tableStructure, 'AMBIGUOUS',
  'the list label and body stay separate when continuation alignment does not prove a full reflow');
assert.ok(taggedListSuperscriptReference.lines.some(line => line.cells[0] === '(a)' && line.cells[1].startsWith('VCCs2 shall maintain')),
  'a same-LI raised reference joins its body while preserving the original label/body cells');

const taggedNumericTable = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1', mcid: 0 }, { x: 108, y: 700, text: 'Total assets before impairment and other deductions', mcid: 1 },
    { x: 72, y: 675, text: '2', mcid: 2 }, { x: 108, y: 675, text: 'Total liabilities due within twelve months', mcid: 3 }
  ],
  structure: [struct('Document', [struct('Table', [
    struct('TR', [struct('TD', [mcr(0)]), struct('TD', [mcr(1)])]),
    struct('TR', [struct('TD', [mcr(2)]), struct('TD', [mcr(3)])])
  ])])]
}));
assert.equal(taggedNumericTable.tableStructure, 'PRESERVED');
assert.ok(taggedNumericTable.lines.some(line => line.cells.length === 2 && line.cells[0] === '1'),
  'explicit table ancestry keeps numeric labels in separate cells');

const untaggedParagraph = await extractPdfDocumentText(createPdf({ items: paragraphItems(), structure: undefined }));
assert.equal(untaggedParagraph.tableStructure, 'AMBIGUOUS');
assert.ok(untaggedParagraph.lines.some(line => line.cells.length === 2 && line.cells[0] === '1.'),
  'matching geometry without structure evidence keeps the original split');

const duplicateSpanIds = await extractPdfDocumentText(createPdf({
  items: paragraphItems({ markerMcid: 0, bodyMcid: 0, continuationMcid: 0 }),
  structure: [struct('Document', [
    struct('P', [mcr(0)]),
    struct('Note', [struct('P', [mcr(3)])])
  ])]
}));
assert.equal(duplicateSpanIds.tableStructure, 'AMBIGUOUS');
assert.ok(duplicateSpanIds.lines.some(line => line.cells.length === 2 && line.cells[0] === '1.'),
  'the same MCID reused by separate marked-content spans disables reflow');
assert.ok(duplicateSpanIds.pageTexts[0].includes('Footnote 1: the term includes a designated fund manager.'));

const missingBodyBinding = await extractPdfDocumentText(createPdf({
  items: paragraphItems(),
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(2)]),
    struct('Note', [struct('P', [mcr(3)])])
  ])]
}));
assert.equal(missingBodyBinding.tableStructure, 'AMBIGUOUS');
assert.ok(missingBodyBinding.lines.some(line => line.cells.length === 2));

const conflictingBindings = await extractPdfDocumentText(createPdf({
  items: paragraphItems(),
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(2)]),
    struct('P', [mcr(1)]),
    struct('Note', [struct('P', [mcr(3)])])
  ])]
}));
assert.equal(conflictingBindings.tableStructure, 'AMBIGUOUS');
assert.ok(conflictingBindings.lines.some(line => line.cells.length === 2));

const wideGap = await extractPdfDocumentText(createPdf({
  items: paragraphItems({ bodyX: 150 }),
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(1), mcr(2)]),
    struct('Note', [struct('P', [mcr(3)])])
  ])]
}));
assert.equal(wideGap.tableStructure, 'AMBIGUOUS');
assert.ok(wideGap.lines.some(line => line.cells.length === 2));

const detachedNumericCell = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'The manager shall keep all records required for complete compliance.', mcid: 1 },
    { x: 72, y: 680, text: '999', mcid: 2 },
    { x: 72, y: 660, text: 'These records remain available for regulatory inspection.', mcid: 3 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2), mcr(3)])])]
}));
assert.equal(detachedNumericCell.tableStructure, 'AMBIGUOUS');
assert.ok(detachedNumericCell.lines.some(line => line.text === '999'), 'a detached numeric cell remains visible');

const alignedOrphanNumber = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'The manager shall keep all records required for complete compliance.', mcid: 1 },
    { x: 72, y: 680, text: 'These records remain available for regulatory inspection and review.', mcid: 2 },
    { x: 72, y: 660, text: '999', mcid: 3 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2), mcr(3)])])]
}));
assert.equal(alignedOrphanNumber.tableStructure, 'AMBIGUOUS');
assert.ok(alignedOrphanNumber.lines.some(line => line.text === '999'),
  'an aligned numeric-only tail is not absorbed as paragraph prose');

for (const monetaryTail of [
  'SGD 999', '$999', 'SGD -999', '-999 SGD', 'CHF 999', 'SGD 999 million', '(999) CHF', '999 SGD',
  'SGD999', '999,999SGD', 'CHF999'
]) {
  const alignedMonetaryTail = await extractPdfDocumentText(createPdf({
    items: [
      { x: 72, y: 700, text: '1.', mcid: 0 },
      { x: 108, y: 700, text: 'Total assets before impairment and other deductions remain available.', mcid: 1 },
      { x: 72, y: 680, text: monetaryTail, mcid: 2 }
    ],
    structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2)])])]
  }));
  assert.equal(alignedMonetaryTail.tableStructure, 'AMBIGUOUS',
    `${monetaryTail} is not absorbed as a short prose continuation`);
  assert.ok(alignedMonetaryTail.lines.some(line => line.text === monetaryTail),
    `${monetaryTail} remains visible as an unresolved aligned value`);
}

const wrongOwnerSuperscript = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'VCCs', mcid: 1 },
    { x: 138, y: 704, text: '1', fontSize: 6, mcid: 2 },
    { x: 147, y: 700, text: 'and managers retain the necessary records for review.', mcid: 3 },
    { x: 72, y: 680, text: 'These managers must retain complete records for all regulatory reviews.', mcid: 4 }
  ],
  structure: [struct('Document', [
    struct('P', [mcr(0), mcr(1), mcr(3), mcr(4)]),
    struct('P', [mcr(2)])
  ])]
}));
assert.equal(wrongOwnerSuperscript.tableStructure, 'AMBIGUOUS');
assert.ok(wrongOwnerSuperscript.lines.some(line => line.text.startsWith('1. VCCs and managers')),
  'the same-P full-width continuation proves the paragraph reflow gate succeeds');
assert.ok(wrongOwnerSuperscript.lines.some(line => line.text === '1' && line.y === 704),
  'a raised number with a different paragraph owner stays detached');

const unboundSuperscript = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1.', mcid: 0 },
    { x: 108, y: 700, text: 'VCCs', mcid: 1 },
    { x: 138, y: 704, text: '1', fontSize: 6, mcid: 2 },
    { x: 147, y: 700, text: 'and managers retain the necessary records for review.', mcid: 3 },
    { x: 72, y: 680, text: 'These managers must retain complete records for all regulatory reviews.', mcid: 4 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(3), mcr(4)])])]
}));
assert.equal(unboundSuperscript.tableStructure, 'AMBIGUOUS',
  'a plausible raised inline number without a structure owner keeps extraction ambiguous');
assert.ok(unboundSuperscript.lines.some(line => line.text === '1' && line.y === 704),
  'an unbound raised number stays visible and detached');

const ambiguousSuperscript = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: 'VCCs', mcid: 0 },
    { x: 109, y: 700, text: 'continues in the first substantive regulatory paragraph.', mcid: 1 },
    { x: 73, y: 697.4, text: 'VCCs', mcid: 2 },
    { x: 109, y: 697.4, text: 'continues in the second substantive regulatory paragraph.', mcid: 3 },
    { x: 102.5, y: 702.8, text: '2', fontSize: 6, mcid: 4 }
  ],
  structure: [struct('Document', [struct('P', [mcr(0), mcr(1), mcr(2), mcr(3), mcr(4)])])]
}));
assert.equal(ambiguousSuperscript.tableStructure, 'AMBIGUOUS');
assert.ok(ambiguousSuperscript.lines.some(line => line.text === '2' && line.y === 702.8),
  'a raised number that geometrically fits multiple baselines stays detached');

const tableWithOrphanValue = await extractPdfDocumentText(createPdf({
  items: [
    { x: 72, y: 700, text: '1', mcid: 0 }, { x: 108, y: 700, text: 'Total assets before impairment and other deductions', mcid: 1 },
    { x: 72, y: 675, text: '2', mcid: 2 }, { x: 108, y: 675, text: 'Total liabilities due within twelve months', mcid: 3 },
    { x: 72, y: 650, text: '999', mcid: 4 }
  ],
  structure: [struct('Document', [
    struct('Table', [
      struct('TR', [struct('TD', [mcr(0)]), struct('TD', [mcr(1)])]),
      struct('TR', [struct('TD', [mcr(2)]), struct('TD', [mcr(3)])])
    ]),
    struct('P', [mcr(4)])
  ])]
}));
assert.equal(tableWithOrphanValue.tableStructure, 'AMBIGUOUS', 'a one-cell value aligned to a table column remains an orphan guard');
assert.ok(tableWithOrphanValue.lines.some(line => line.cells.length === 2 && line.cells[0] === '1'));

console.log('PASS | tagged PDF paragraphs and LI labels reflow only with structural and geometric proof; tables and unsupported bindings remain guarded');
