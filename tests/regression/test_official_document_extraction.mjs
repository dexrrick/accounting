import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { CompositeSourceRetriever } from '../../src/retrieval/compositeSourceRetriever.ts';
import { extractOfficialDocument } from '../../src/retrieval/officialDocumentExtractor.ts';
import { handleOfficialSourceProxyRequest } from '../../src/retrieval/officialSourceProxy.ts';
import { fetchOfficialSourceSameOrigin } from '../../src/retrieval/officialSourceTransport.ts';
import { extractPdfDocumentText } from '../../src/retrieval/pdfDocumentTextExtractor.ts';
import { computeSha256, computeSha256Bytes } from '../../src/standards/sourceVersioning.ts';

function pdfString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function pdfLine(x, y, value) {
  return `BT /F1 11 Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(value)}) Tj ET\n`;
}

function createTwoPagePdf({ title, identityLine, bodyLines, pageTwoHeading, tableHeaders, tableRows, pageOneImageOnly = false, pageTwoImageOnly = false, pageTwoExtraSingleCell = false, pageTwoTrailingOrphanRows = false }) {
  const lastTableRowIndex = tableRows.length - 1;
  const pageOne = pageOneImageOnly ? 'q 300 0 0 300 40 200 cm /Im0 Do Q\n' : [
    pdfLine(40, 760, title),
    pdfLine(40, 730, identityLine),
    ...bodyLines.map((line, index) => pdfLine(40, 710 - (index * 20), line))
  ].join('');
  const pageTwo = pageTwoImageOnly ? 'q 300 0 0 300 40 200 cm /Im0 Do Q\n' : [
    pdfLine(40, 760, pageTwoHeading),
    pdfLine(40, 720, tableHeaders[0]),
    pdfLine(260, 720, tableHeaders[1]),
    ...(pageTwoExtraSingleCell ? [pdfLine(40, 682, 'Explanatory note without an associated schedule value')] : []),
    ...tableRows.flatMap((row, index) => {
      const y = 695 - (index * 25);
      if (pageTwoTrailingOrphanRows && index === lastTableRowIndex) {
        return [pdfLine(40, y, row[0]), pdfLine(260, y - 25, row[1])];
      }
      return [pdfLine(40, y, row[0]), pdfLine(260, y, row[1])];
    })
  ].join('');
  const imageResource = pageOneImageOnly || pageTwoImageOnly ? ' /XObject << /Im0 8 0 R >>' : '';
  const resources = `<< /Font << /F1 7 0 R >>${imageResource} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /Resources ${resources} /MediaBox [0 0 612 792] /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(pageOne, 'ascii')} >>\nstream\n${pageOne}endstream`,
    `<< /Type /Page /Parent 2 0 R /Resources ${resources} /MediaBox [0 0 612 792] /Contents 6 0 R >>`,
    `<< /Length ${Buffer.byteLength(pageTwo, 'ascii')} >>\nstream\n${pageTwo}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  if (pageOneImageOnly || pageTwoImageOnly) {
    objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFFFFFF>\nendstream');
  }
  let document = '%PDF-1.4\n';
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

const cpfPdfRequest = {
  url: 'https://www.cpf.gov.sg/employer/notices/contribution-schedule.pdf',
  authority: 'CPF',
  domain: 'CPF_BOARD',
  expectedTopic: {
    standardIdentifiers: ['Central Provident Fund Act 1953'],
    expectedTitles: ['CPF Employer Contributions Schedule'],
    topicTerms: ['employer contributions']
  },
  standardOrActCode: 'CPFA1953',
  legalOrStandardInstrument: 'Central Provident Fund Act 1953',
  documentKind: 'PDF'
};

function htmlRequest({ asOfDate, topicTerms = ['annual returns'] } = {}) {
  return {
    url: 'https://www.acra.gov.sg/filing/annual-returns',
    authority: 'ACRA',
    domain: 'ACRA_CORP',
    expectedTopic: {
      standardIdentifiers: ['Companies Act 1967'],
      expectedTitles: ['Annual Return Filing Requirements'],
      topicTerms
    },
    standardOrActCode: 'ACRA-ANNUAL-RETURNS',
    legalOrStandardInstrument: 'Companies Act 1967',
    documentKind: 'HTML',
    elementId: 'annual-return-eligibility',
    ...(asOfDate ? { asOfDate } : {})
  };
}

const htmlSource = `<html><head><title>ACRA filing guide</title></head><body>
  <main><h1>Annual Return Filing Requirements</h1>
  <p>Companies Act 1967 annual returns contain company financial and corporate information.</p>
  <section id="annual-return-eligibility"><h2>Annual return compliance</h2>
    <p>Companies Act 1967 governs annual returns and annual return filing for companies.</p>
    <p>Effective from 1 January 2020 until 31 December 2020, this filing schedule applies.</p>
  </section></main></body></html>`;

async function main() {
  const pdfBytes = createTwoPagePdf({
    title: 'CPF Employer Contributions Schedule',
    identityLine: 'Central Provident Fund Act 1953 governs employer contributions.',
    bodyLines: [
      'This document states the employer contributions payable for eligible employees.',
      'The schedule below shows contribution rates by employee age band.'
    ],
    pageTwoHeading: 'Employer contributions by age band',
    tableHeaders: ['Age band', 'Employer contribution rate'],
    tableRows: [['55 and below', '17 percent'], ['Above 55', '16 percent']]
  });
  for (const text of ['ASCII source fingerprint', 'Singapore compliance café']) {
    assert.equal(computeSha256(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  }
  assert.equal(computeSha256Bytes(pdfBytes), createHash('sha256').update(pdfBytes).digest('hex'));

  const imageOnlyPdf = createTwoPagePdf({
    title: '', identityLine: '', bodyLines: [], pageTwoHeading: '', tableHeaders: ['', ''], tableRows: [],
    pageOneImageOnly: true, pageTwoImageOnly: true
  });
  await assert.rejects(() => extractPdfDocumentText(imageOnlyPdf), /no substantive embedded text/i);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => handleOfficialSourceProxyRequest(
    new Request(new URL(String(url), 'https://app.local'), init),
    async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  );
  try {
    const transportedPdf = await fetchOfficialSourceSameOrigin(cpfPdfRequest.url, {
      headers: { 'x-official-source-response-mode': 'document' }
    });
    assert.equal(transportedPdf.url, cpfPdfRequest.url);
    assert.equal(Buffer.compare(Buffer.from(await transportedPdf.arrayBuffer()), pdfBytes), 0);

    globalThis.fetch = async () => new Response(JSON.stringify({
      officialUrl: cpfPdfRequest.url,
      upstreamStatus: 200,
      upstreamStatusText: 'OK',
      headers: { 'content-type': 'application/pdf' },
      bodyBase64: '%%%'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const malformedBase64 = await fetchOfficialSourceSameOrigin(cpfPdfRequest.url, {
      headers: { 'x-official-source-response-mode': 'document' }
    });
    assert.equal(malformedBase64.__officialSourceTransportFailure, 'NETWORK_ERROR');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const pdfRetriever = new ControlledWebRetriever();
  const pdfResult = await extractOfficialDocument(cpfPdfRequest, {
    fetchOfficialDocument: (url, options) => pdfRetriever.fetchOfficialDocument(url, {
      ...options,
      timeoutMs: 1_000,
      customFetch: async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(pdfResult.status, 'SUCCESS', pdfResult.status === 'REJECTED' ? pdfResult.reason : '');
  assert.equal(pdfResult.record.sourceLocator.sourceType, 'PDF');
  assert.equal(pdfResult.record.sourceLocator.pageCount, 2);
  assert.equal(pdfResult.record.sourceLocator.tableStructure, 'PRESERVED');
  assert.equal(pdfResult.record.extractionStatus, 'EXACT');
  assert.equal(pdfResult.record.isVerbatimText, true);
  assert.equal(pdfResult.record.documentHash, createHash('sha256').update(pdfBytes).digest('hex'));
  assert.equal(pdfResult.record.lifecycleState, 'CANDIDATE');
  assert.equal(pdfResult.record.groundingEligible, false);
  assert.equal(pdfResult.record.provenance, 'LIVE_EXTERNAL');
  assert.equal(pdfResult.record.authority, 'CPF');
  assert.equal(pdfResult.record.sourcePublisher, 'Central Provident Fund Board');
  assert.equal(pdfResult.record.lastVerifiedDate, undefined);
  assert.match(pdfResult.record.sourceText, /Age band \| Employer contribution rate/);

  const imagePagePdf = createTwoPagePdf({
    title: 'CPF Employer Contributions Schedule',
    identityLine: 'Central Provident Fund Act 1953 governs employer contributions.',
    bodyLines: [
      'This document states the employer contributions payable for eligible employees.',
      'The schedule below shows contribution rates by employee age band.'
    ],
    pageTwoHeading: '', tableHeaders: ['', ''], tableRows: [], pageTwoImageOnly: true
  });
  const imagePageRetriever = new ControlledWebRetriever();
  const imagePageResult = await extractOfficialDocument(cpfPdfRequest, {
    fetchOfficialDocument: (url, options) => imagePageRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(imagePagePdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(imagePageResult.status, 'SUCCESS', imagePageResult.status === 'REJECTED' ? imagePageResult.reason : '');
  assert.equal(imagePageResult.record.extractionStatus, 'PARTIAL');
  assert.equal(imagePageResult.record.isVerbatimText, false);
  assert.equal(imagePageResult.record.groundingEligible, false);

  const orphanRowPdf = createTwoPagePdf({
    title: 'CPF Employer Contributions Schedule',
    identityLine: 'Central Provident Fund Act 1953 governs employer contributions.',
    bodyLines: [
      'This document states the employer contributions payable for eligible employees.',
      'The schedule below shows contribution rates by employee age band.'
    ],
    pageTwoHeading: 'Employer contributions by age band',
    tableHeaders: ['Age band', 'Employer contribution rate'],
    tableRows: [['55 and below', '17 percent'], ['Above 55', '16 percent']],
    pageTwoExtraSingleCell: true
  });
  const orphanRowRetriever = new ControlledWebRetriever();
  const orphanRowResult = await extractOfficialDocument(cpfPdfRequest, {
    fetchOfficialDocument: (url, options) => orphanRowRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(orphanRowPdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(orphanRowResult.status, 'SUCCESS', orphanRowResult.status === 'REJECTED' ? orphanRowResult.reason : '');
  assert.equal(orphanRowResult.record.sourceLocator.tableStructure, 'AMBIGUOUS');
  assert.equal(orphanRowResult.record.extractionStatus, 'PARTIAL');
  assert.equal(orphanRowResult.record.isVerbatimText, false);

  const trailingOrphanPdf = createTwoPagePdf({
    title: 'CPF Employer Contributions Schedule',
    identityLine: 'Central Provident Fund Act 1953 governs employer contributions.',
    bodyLines: [
      'This document states the employer contributions payable for eligible employees.',
      'The schedule below shows contribution rates by employee age band.'
    ],
    pageTwoHeading: 'Employer contributions by age band',
    tableHeaders: ['Age band', 'Employer contribution rate'],
    tableRows: [['55 and below', '17 percent'], ['Above 55', '16 percent']],
    pageTwoTrailingOrphanRows: true
  });
  const trailingOrphanRetriever = new ControlledWebRetriever();
  const trailingOrphanResult = await extractOfficialDocument(cpfPdfRequest, {
    fetchOfficialDocument: (url, options) => trailingOrphanRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(trailingOrphanPdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(trailingOrphanResult.status, 'SUCCESS', trailingOrphanResult.status === 'REJECTED' ? trailingOrphanResult.reason : '');
  assert.equal(trailingOrphanResult.record.sourceLocator.tableStructure, 'AMBIGUOUS');
  assert.equal(trailingOrphanResult.record.extractionStatus, 'PARTIAL');
  assert.equal(trailingOrphanResult.record.isVerbatimText, false);

  const tableOnlyResult = await extractOfficialDocument({
    ...cpfPdfRequest,
    sectionHeading: 'Employer contributions by age band'
  }, {
    fetchOfficialDocument: (url, options) => pdfRetriever.fetchOfficialDocument(url, {
      ...options,
      timeoutMs: 1_000,
      customFetch: async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(tableOnlyResult.status, 'SUCCESS', tableOnlyResult.status === 'REJECTED' ? tableOnlyResult.reason : '');
  assert.equal(tableOnlyResult.record.extractionStatus, 'EXACT');
  assert.doesNotMatch(tableOnlyResult.record.sourceText, /Central Provident Fund Act 1953/);

  const headingOnlyPdf = createTwoPagePdf({
    title: 'CPF Employer Contributions Schedule',
    identityLine: 'Central Provident Fund Act 1953 governs employer contributions.',
    bodyLines: [
      'This document states the employer contributions payable for eligible employees.',
      'The schedule below shows contribution rates by employee age band.'
    ],
    pageTwoHeading: 'Employer contributions by age band',
    tableHeaders: ['', ''],
    tableRows: []
  });
  const pdfHeadingOnlyRetriever = new ControlledWebRetriever();
  const headingOnlyPdfResult = await extractOfficialDocument({
    ...cpfPdfRequest,
    sectionHeading: 'Employer contributions by age band'
  }, {
    fetchOfficialDocument: (url, options) => pdfHeadingOnlyRetriever.fetchOfficialDocument(url, {
      ...options,
      timeoutMs: 1_000,
      customFetch: async () => new Response(headingOnlyPdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(headingOnlyPdfResult.status, 'REJECTED');
  assert.equal(headingOnlyPdfResult.code, 'PDF_SECTION_NOT_SUBSTANTIVE');

  const syntheticMasPdf = createTwoPagePdf({
    title: 'Synthetic MAS Notice M-TEST-001: Regulatory Reporting',
    identityLine: 'Monetary Authority of Singapore Synthetic Notice M-TEST-001.',
    bodyLines: [
      'Synthetic test fixture only; this notice contains no actual regulatory requirements.',
      'It exercises extraction of regulatory reporting notice text and illustrative schedules.'
    ],
    pageTwoHeading: 'Illustrative reporting schedule',
    tableHeaders: ['Example return', 'Illustrative field'],
    tableRows: [['Example return A', 'Example field A'], ['Example return B', 'Example field B']]
  });
  const masPdfRequest = {
    url: 'https://www.mas.gov.sg/regulation/notices/synthetic-m-test-001.pdf',
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    expectedTopic: {
      standardIdentifiers: ['Synthetic MAS Notice M-TEST-001'],
      expectedTitles: ['Synthetic MAS Notice M-TEST-001: Regulatory Reporting'],
      topicTerms: ['regulatory reporting']
    },
    standardOrActCode: 'Synthetic MAS Notice M-TEST-001',
    legalOrStandardInstrument: 'Synthetic MAS Notice M-TEST-001',
    documentKind: 'PDF'
  };
  const masRetriever = new ControlledWebRetriever();
  const masPdfResult = await extractOfficialDocument(masPdfRequest, {
    fetchOfficialDocument: (url, options) => masRetriever.fetchOfficialDocument(url, {
      ...options,
      timeoutMs: 1_000,
      customFetch: async () => new Response(syntheticMasPdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(masPdfResult.status, 'SUCCESS', masPdfResult.status === 'REJECTED' ? masPdfResult.reason : '');
  assert.equal(masPdfResult.record.documentTitle, 'Synthetic MAS Notice M-TEST-001: Regulatory Reporting');
  assert.equal(masPdfResult.record.authority, 'MAS');
  assert.equal(masPdfResult.record.sourcePublisher, 'Monetary Authority of Singapore');
  assert.equal(masPdfResult.record.sourceLocator.tableStructure, 'PRESERVED');
  assert.equal(masPdfResult.record.lifecycleState, 'CANDIDATE');
  assert.equal(masPdfResult.record.groundingEligible, false);
  assert.match(masPdfResult.record.sourceText, /Synthetic test fixture only/);

  const htmlRetriever = new ControlledWebRetriever();
  const htmlResult = await extractOfficialDocument(htmlRequest({ asOfDate: '2020-06-30' }), {
    fetchOfficialDocument: (url, options) => htmlRetriever.fetchOfficialDocument(url, {
      ...options,
      timeoutMs: 500,
      customFetch: async () => new Response(htmlSource, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    })
  });
  assert.equal(htmlResult.status, 'SUCCESS', htmlResult.status === 'REJECTED' ? htmlResult.reason : '');
  assert.equal(htmlResult.record.sourceLocator.elementId, 'annual-return-eligibility');
  assert.equal(htmlResult.record.effectiveDate, '2020-01-01');
  assert.equal(htmlResult.record.validTo, '2020-12-31');

  const headingRetriever = new ControlledWebRetriever();
  const headingResult = await extractOfficialDocument({
    ...htmlRequest(), elementId: undefined, sectionHeading: 'Annual return compliance'
  }, {
    fetchOfficialDocument: (url, options) => headingRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(htmlSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(headingResult.status, 'SUCCESS', headingResult.status === 'REJECTED' ? headingResult.reason : '');
  assert.equal(headingResult.record.sourceLocator.heading, 'Annual return compliance');

  const orphanHtmlTable = htmlSource.replace('</section>', `<p>Companies Act 1967 annual returns are described with substantive compliance details for companies.</p>
    <table><tr><th>Requirement</th><th>Annual return details</th></tr><tr><td>Companies must file annual returns</td></tr><tr><td>Companies Act 1967</td><td>Annual returns filing</td></tr></table></section>`);
  const orphanHtmlRetriever = new ControlledWebRetriever();
  const orphanHtmlResult = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => orphanHtmlRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(orphanHtmlTable, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(orphanHtmlResult.status, 'SUCCESS', orphanHtmlResult.status === 'REJECTED' ? orphanHtmlResult.reason : '');
  assert.equal(orphanHtmlResult.record.sourceLocator.tableStructure, 'AMBIGUOUS');
  assert.equal(orphanHtmlResult.record.extractionStatus, 'PARTIAL');
  assert.equal(orphanHtmlResult.record.isVerbatimText, false);

  const facadeRetriever = new ControlledWebRetriever();
  const facade = new CompositeSourceRetriever(undefined, undefined, {
    fetchOfficialDocument: (url, options) => facadeRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(htmlSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  const facadeResult = await facade.extractExternalDocument(htmlRequest());
  assert.equal(facadeResult.status, 'SUCCESS', facadeResult.status === 'REJECTED' ? facadeResult.reason : '');

  const duplicateIdSource = htmlSource.replace('</main>', '<div id="annual-return-eligibility">Duplicate source boundary with annual returns.</div></main>');
  const duplicateRetriever = new ControlledWebRetriever();
  const duplicateResult = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => duplicateRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(duplicateIdSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(duplicateResult.status, 'REJECTED');
  assert.equal(duplicateResult.code, 'HTML_SECTION_UNVERIFIED');

  const commentOnlySelectorSource = htmlSource
    .replace('id="annual-return-eligibility"', 'id="different-section"')
    .replace('</main>', '<!-- <section id="annual-return-eligibility"><p>Companies Act 1967 annual returns filing details.</p></section> --></main>');
  const commentSelectorRetriever = new ControlledWebRetriever();
  const commentSelector = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => commentSelectorRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(commentOnlySelectorSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(commentSelector.status, 'REJECTED');
  assert.equal(commentSelector.code, 'HTML_SECTION_UNVERIFIED');

  const navSelectorSource = htmlSource.replace('id="annual-return-eligibility"', 'id="different-section"')
    .replace('</main>', '<nav id="annual-return-eligibility"><p>Companies Act 1967 annual returns and compliance filing details.</p></nav></main>');
  const navSelectorRetriever = new ControlledWebRetriever();
  const navSelector = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => navSelectorRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(navSelectorSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(navSelector.status, 'REJECTED');
  assert.equal(navSelector.code, 'HTML_SECTION_UNVERIFIED');

  const duplicateAttributeSource = htmlSource.replace('id="annual-return-eligibility"', 'id="annual-return-eligibility" id="annual-return-eligibility"');
  const duplicateAttributeRetriever = new ControlledWebRetriever();
  const duplicateAttribute = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => duplicateAttributeRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(duplicateAttributeSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(duplicateAttribute.status, 'REJECTED');
  assert.equal(duplicateAttribute.code, 'HTML_SECTION_UNVERIFIED');

  const headingOnlySource = `<html><body><h1>Annual Return Filing Requirements</h1><p>Companies Act 1967 annual returns contain sufficient relevant filing details and supporting compliance information for companies.</p><h2 id="annual-return-eligibility">Annual return compliance</h2><p>Companies Act 1967 annual returns and annual return filing.</p></body></html>`;
  const headingOnlyRetriever = new ControlledWebRetriever();
  const headingOnly = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => headingOnlyRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(headingOnlySource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(headingOnly.status, 'REJECTED');
  assert.equal(headingOnly.code, 'HTML_SECTION_NOT_SUBSTANTIVE');

  const metadataOnlySource = `<html><head><title>Annual Return Filing Requirements</title></head><body><nav><a href="/filing">Annual returns and Companies Act 1967 filing requirements</a></nav></body></html>`;
  const metadataRetriever = new ControlledWebRetriever();
  const metadataOnly = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => metadataRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(metadataOnlySource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(metadataOnly.status, 'REJECTED');

  const wrongTopicRetriever = new ControlledWebRetriever();
  const wrongTopic = await extractOfficialDocument(htmlRequest({ topicTerms: ['goods and services tax'] }), {
    fetchOfficialDocument: (url, options) => wrongTopicRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(htmlSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(wrongTopic.status, 'REJECTED');

  const wrongHost = await extractOfficialDocument({ ...htmlRequest(), url: 'https://example.com/annual-returns' });
  assert.equal(wrongHost.status, 'REJECTED');
  assert.equal(wrongHost.code, 'FETCH_UNAUTHORIZED_DOMAIN_ACCESS');

  const outOfRangeRetriever = new ControlledWebRetriever();
  const outOfRange = await extractOfficialDocument(htmlRequest({ asOfDate: '2021-01-01' }), {
    fetchOfficialDocument: (url, options) => outOfRangeRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(htmlSource, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(outOfRange.status, 'REJECTED');
  assert.equal(outOfRange.code, 'HISTORICAL_DATE_UNVERIFIED');

  const supersededHtml = htmlSource.replace('Effective from 1 January 2020 until 31 December 2020, this filing schedule applies.', 'This superseded filing schedule has no bounded applicability dates.');
  const supersededRetriever = new ControlledWebRetriever();
  const superseded = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => supersededRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(supersededHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(superseded.status, 'REJECTED');
  assert.equal(superseded.code, 'SUPERSEDED_SOURCE_UNBOUNDED');

  const supersededStartOnlyHtml = htmlSource.replace('Effective from 1 January 2020 until 31 December 2020, this filing schedule applies.', 'This superseded schedule is effective from 1 January 2020.');
  const supersededStartOnlyRetriever = new ControlledWebRetriever();
  const supersededStartOnly = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => supersededStartOnlyRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(supersededStartOnlyHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(supersededStartOnly.status, 'REJECTED');
  assert.equal(supersededStartOnly.code, 'SUPERSEDED_SOURCE_UNBOUNDED');

  const conflictingDatesHtml = htmlSource.replace(
    'Effective from 1 January 2020 until 31 December 2020, this filing schedule applies.',
    'Effective from 1 January 2020 until 31 December 2020. Effective from 1 January 2021 until 31 December 2021.'
  );
  const conflictingDatesRetriever = new ControlledWebRetriever();
  const conflictingDates = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => conflictingDatesRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(conflictingDatesHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(conflictingDates.status, 'REJECTED');
  assert.equal(conflictingDates.code, 'APPLICABILITY_DATES_CONTRADICTORY');

  const malformedDateHtml = htmlSource.replace(
    'Effective from 1 January 2020 until 31 December 2020, this filing schedule applies.',
    'Effective from 1 January 2020 until 31 February 2020, this filing schedule applies.'
  );
  const malformedDateRetriever = new ControlledWebRetriever();
  const malformedDate = await extractOfficialDocument(htmlRequest(), {
    fetchOfficialDocument: (url, options) => malformedDateRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(malformedDateHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(malformedDate.status, 'REJECTED');
  assert.equal(malformedDate.code, 'APPLICABILITY_DATES_CONTRADICTORY');

  const actRequest = {
    url: 'https://sso.agc.gov.sg/Act/CoA1967?WholeDoc=1#pr205C-',
    authority: 'ACRA',
    domain: 'ACRA_CORP',
    expectedTopic: {
      standardIdentifiers: ['CoA1967', 'Companies Act 1967'],
      expectedTitles: ['Companies Act 1967'],
      topicTerms: ['small company audit exemption']
    },
    standardOrActCode: 'CoA1967',
    legalOrStandardInstrument: 'Companies Act 1967',
    documentKind: 'SSO_LEGISLATION',
    legislation: { actCode: 'CoA1967', actTitle: 'Companies Act 1967', section: 'Section 205C' }
  };
  const ssoHtml = `<html><head><title>Companies Act 1967</title></head><body><h1>Companies Act 1967</h1><div id="pr205C-"><p>205C.— A small company audit exemption applies when statutory criteria are satisfied for the relevant financial period.</p></div></body></html>`;
  const actRetriever = new ControlledWebRetriever();
  const actResult = await extractOfficialDocument(actRequest, {
    fetchOfficialDocument: (url, options) => actRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(ssoHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(actResult.status, 'SUCCESS', actResult.status === 'REJECTED' ? actResult.reason : '');
  assert.equal(actResult.record.sourceLocator.act, 'CoA1967');
  assert.equal(actResult.record.sourceLocator.section, '205C');
  assert.equal(actResult.record.sourcePublisher, 'Singapore Statutes Online / Attorney-General’s Chambers');

  const numericSubsectionRequest = {
    ...actRequest,
    url: 'https://sso.agc.gov.sg/Act/CoA1967?WholeDoc=1#pr201-5-',
    expectedTopic: {
      standardIdentifiers: ['CoA1967', 'Companies Act 1967'],
      expectedTitles: ['Companies Act 1967'],
      topicTerms: ['annual returns']
    },
    legislation: { actCode: 'CoA1967', actTitle: 'Companies Act 1967', section: 'Section 201(5)' }
  };
  const numericSubsectionHtml = `<html><body><h1>Companies Act 1967</h1><p>The Companies Act 1967 applies to company annual returns.</p>
    <div id="pr201-5-"><p>(5) A company must prepare annual returns and financial statements for filing within the applicable period.</p></div></body></html>`;
  const numericSubsectionRetriever = new ControlledWebRetriever();
  const numericSubsection = await extractOfficialDocument(numericSubsectionRequest, {
    fetchOfficialDocument: (url, options) => numericSubsectionRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(numericSubsectionHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(numericSubsection.status, 'SUCCESS', numericSubsection.status === 'REJECTED' ? numericSubsection.reason : '');
  assert.equal(numericSubsection.record.extractionStatus, 'EXACT');
  assert.equal(numericSubsection.record.sourceLocator.section, '201');
  assert.equal(numericSubsection.record.sourceLocator.subsection, '5');
  assert.match(numericSubsection.record.sourceText, /annual returns/);

  const duplicateNumericSsoHtml = numericSubsectionHtml.replace('</body>', '<div id="pr201-5-"><p>(5) A contradictory duplicate annual returns provision has different content.</p></div></body>');
  const duplicateNumericSsoRetriever = new ControlledWebRetriever();
  const duplicateNumericSso = await extractOfficialDocument(numericSubsectionRequest, {
    fetchOfficialDocument: (url, options) => duplicateNumericSsoRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(duplicateNumericSsoHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(duplicateNumericSso.status, 'REJECTED');
  assert.equal(duplicateNumericSso.code, 'HTML_SECTION_UNVERIFIED');

  const wrongFinalActRetriever = new ControlledWebRetriever();
  const wrongFinalAct = await extractOfficialDocument(numericSubsectionRequest, {
    fetchOfficialDocument: (url, options) => wrongFinalActRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => {
        const response = new Response(numericSubsectionHtml, { status: 200, headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: 'https://sso.agc.gov.sg/Act/CPFA1953?WholeDoc=1#pr201-5-' });
        return response;
      }
    })
  });
  assert.equal(wrongFinalAct.status, 'REJECTED');
  assert.equal(wrongFinalAct.code, 'ACT_URL_MISMATCH');

  const wrongActOwnerRetriever = new ControlledWebRetriever();
  const wrongActOwner = await extractOfficialDocument({ ...actRequest, authority: 'IRAS', domain: 'IRAS_TAX' }, {
    fetchOfficialDocument: (url, options) => wrongActOwnerRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(ssoHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
  });
  assert.equal(wrongActOwner.status, 'REJECTED');
  assert.equal(wrongActOwner.code, 'ACT_IDENTITY_MISMATCH');

  const malformedPdfRetriever = new ControlledWebRetriever();
  const malformedPdf = await extractOfficialDocument(cpfPdfRequest, {
    fetchOfficialDocument: (url, options) => malformedPdfRetriever.fetchOfficialDocument(url, {
      ...options,
      customFetch: async () => new Response(Buffer.from('not a PDF body'), { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
  });
  assert.equal(malformedPdf.status, 'REJECTED');
  assert.equal(malformedPdf.code, 'DOCUMENT_FORMAT_MISMATCH');

  const stalledRetriever = new ControlledWebRetriever();
  const stalled = await stalledRetriever.fetchOfficialDocument('https://www.cpf.gov.sg/employer/notice.pdf', {
    timeoutMs: 25,
    customFetch: async () => new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel: () => new Promise(() => {})
    }), { status: 200, headers: { 'content-type': 'application/pdf' } })
  });
  assert.equal(stalled.status, 'TIMEOUT');
  const invalidLimit = await stalledRetriever.fetchOfficialDocument('https://www.cpf.gov.sg/employer/notice.pdf', {
    timeoutMs: 25,
    maxResponseBytes: Number.NaN,
    customFetch: async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  });
  assert.equal(invalidLimit.status, 'INVALID_CONTENT');

  console.log('PASS: bounded official HTML/PDF extraction, exact byte hashes, dates, SSO identity, and failure guards');
}

await main();
