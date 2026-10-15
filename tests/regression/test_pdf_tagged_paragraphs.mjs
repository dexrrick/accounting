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
    return `${marked}BT /F1 11 Tf 1 0 0 1 ${item.x} ${item.y} Tm (${pdfText(item.text)}) Tj ET\n${endMarked}`;
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
