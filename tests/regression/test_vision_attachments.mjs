import assert from 'node:assert/strict';
import { ACCEPTED_IMAGE_TYPES, extractBase64Data, MAX_IMAGE_FILE_SIZE, validateImageFile } from '../../src/utils/imageUtils.ts';
import { buildJournalGroupsFromImageEvidence, buildTransactionGroupsFromImageEvidence, createGeminiImageParts, extractImageEvidenceWithGemini, flattenImageEvidence, getMaterialImageUncertainties, processAccountingQuery, supportsGeminiVision } from '../../src/services/geminiService.ts';
import { getDisplayableUncommittedJournalGroups } from '../../src/services/committedJournal.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';
import { invoiceVisionResponse } from '../fixtures/visionEvidenceFixtures.mjs';
import { compileFeedbackReport } from '../../src/services/feedback.ts';

console.log('=== RUNNING VISION ATTACHMENT SUITE ===\n');

assert.deepEqual(ACCEPTED_IMAGE_TYPES, ['image/png', 'image/jpeg', 'image/webp']);
assert.equal(extractBase64Data('data:image/png;base64,aGVsbG8='), 'aGVsbG8=');
assert.equal(extractBase64Data('plain-base64'), 'plain-base64');
assert.equal(validateImageFile({ type: 'image/png', size: MAX_IMAGE_FILE_SIZE } ), null);
assert.match(validateImageFile({ type: 'application/pdf', size: 1 }), /not supported/i);
assert.match(validateImageFile({ type: 'image/jpeg', size: MAX_IMAGE_FILE_SIZE + 1 }), /10 MB/i);
assert.equal(supportsGeminiVision('gemini-3.5-flash-lite'), true);
assert.equal(supportsGeminiVision('gpt-4o'), false);
assert.deepEqual(createGeminiImageParts([{ id: 'img-1', fileName: 'invoice.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,c2FmZQ==', size: 4 }]), [{ inlineData: { mimeType: 'image/png', data: 'c2FmZQ==' } }]);
assert.deepEqual(flattenImageEvidence([{ imageId: 'img-1', documentType: 'supplier_invoice', fields: [{ source: 'image', field: 'total', value: 10900, confidence: 0.97 }] }]), [{ source: 'image', imageId: 'img-1', field: 'total', value: 10900, confidence: 0.97 }]);
assert.equal(getMaterialImageUncertainties([{ imageId: 'img-1', fields: [{ source: 'image', field: 'total', value: 18650, confidence: 0.6 }, { source: 'image', field: 'supplier', value: 'ABC', confidence: 0.6 }] }]).length, 1);
assert.equal(getMaterialImageUncertainties([{ imageId: 'img-1', fields: [{ source: 'image', field: 'total', value: 18650 }] }]).length, 0, 'missing confidence is not a model uncertainty signal');
const extractedJournal = buildJournalGroupsFromImageEvidence([{ imageId: 'img-1', fields: [], journalLines: [{ accountName: 'Inventory', accountCode: 'GL 130', debit: 1000 }, { accountName: 'Cash', accountCode: 'GL 100', credit: 200 }, { accountName: 'Accounts payable', accountCode: 'GL 200', credit: 800 }] }]);
assert.equal(extractedJournal[0].isBalanced, true);
assert.equal(extractedJournal[0].totalDebit, 1000);
assert.equal(extractedJournal[0].totalCredit, 1000);
const extractedTransaction = buildTransactionGroupsFromImageEvidence([{ imageId: 'img-2', fields: [{ source: 'image', field: 'transactionType', value: 'equipment_purchase' }, { source: 'image', field: 'assetName', value: 'Office Equipment' }, { source: 'image', field: 'totalAmount', value: 1200 }, { source: 'image', field: 'immediatePayment', value: 400 }, { source: 'image', field: 'remainingPayable', value: 800 }] }]);
assert.equal(extractedTransaction[0].isBalanced, true);
assert.deepEqual(extractedTransaction[0].lines.map((line) => [line.accountName, line.debit, line.credit]), [['Office Equipment', 1200, 0], ['Cash / Bank', 0, 400], ['Accounts Payable', 0, 800]]);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(invoiceVisionResponse) }] } }] }) });
const extracted = await extractImageEvidenceWithGemini('test-key', 'gemini-3.5-flash-lite', [{ id: 'img-1', fileName: 'invoice.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,c2FmZQ==', size: 4 }]);
globalThis.fetch = originalFetch;
assert.equal(extracted[0].imageId, 'img-1');
assert.equal(extracted[0].fields.find((field) => field.field === 'total')?.value, 10900);

globalThis.window = { location: { href: 'https://example.test' } };
const feedback = compileFeedbackReport({
  description: 'Vision request failed', messages: [{ id: 'u1', sender: 'user', timestamp: '15/09/2026', text: 'Check this invoice', images: [{ id: 'img-1', fileName: 'invoice.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,private-image-content', size: 4 }] }], scenario: null,
  providerSettings: { activeProvider: 'gemini', gemini: { apiKey: 'key', model: 'gemini-3.5-flash-lite' }, azure: { endpoint: '', apiKey: '', deploymentName: '', apiVersion: '' }, openai: { apiKey: '', model: '' } }, theme: 'light', fontSize: 'large', outputPreference: { journal: false, statutory: false }
});
assert.deepEqual(feedback.attachments, { imagesAttached: 1, imageTypes: ['image/png'] });
assert.equal(JSON.stringify(feedback).includes('private-image-content'), false);

const correctionImageTurn = {
  id: 'invoice-image', sender: 'user', timestamp: '',
  text: 'Attached invoice INV-202. Please prepare the journal from the screenshot.',
  images: [{ id: 'image-202', fileName: 'invoice.png', size: 4, mimeType: 'image/png', dataUrl: 'data:image/png;base64,bW9jaw==' }]
};
const correctionVision = { imageEvidence: [{
  imageIndex: 1, documentType: 'supplier_invoice', confidence: 0.6,
  fields: { invoiceNo: 'INV-202', invoiceDate: '20/01/2025', total: 500, currency: 'SGD' }
}] };
const invoiceProposal = (total, eventDate = '20/01/2025', foreignCurrency) => ({
  messageText: 'Proposed invoice journal.',
  transactionTitle: 'Invoice INV-202',
  directGroups: [{ id: 'proposal', title: 'Invoice INV-202', eventDate, isBalanced: true, totalDebit: total, totalCredit: total,
    lines: [
      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: total, credit: 0,
        ...(foreignCurrency ? { foreignCurrency, foreignDebit: total } : {}) },
      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: total }
    ] }]
});
const correctionProviderKey = 'offline-gemini-correction-fixture-key';
let proposedInvoice = invoiceProposal(500);
const correctionProviderRequests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('Offline fixture unavailable', { status: 404 });
  if (url.pathname.endsWith(':streamGenerateContent')) return new Response('Use the offline JSON fixture', { status: 404 });
  const request = JSON.parse(init.body);
  correctionProviderRequests.push(request);
  const value = JSON.stringify(request).includes('Extract only visible document evidence')
    ? correctionVision
    : request.systemInstruction
      ? proposedInvoice
      : {};
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
};

try {
  const initialCorrectionState = await processAccountingQuery(
    correctionImageTurn.text,
    null,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn]
  );
  assert.ok(initialCorrectionState.scenarioState.missingFields?.some(field => field.fieldKey === 'imageVerification'));
  assert.deepEqual(getDisplayableUncommittedJournalGroups(initialCorrectionState.scenarioState, 'SFRS_I'), []);

  const correctionCases = [
    { text: 'S$500 is not correct, please use S$600', amount: 600 },
    { text: 'S$500 is not correct, please use S$600 or S$700?', clarification: /SGD 600 or SGD 700/ },
    { text: 'S$500 is not correct, please use S$600?', clarification: /Please confirm whether the invoice total should be SGD 600/ },
    { text: 'The subtotal is S$600, GST is S$54, total is S$654, and subtotal is S$650.', clarification: /conflicting subtotal values SGD 600 and SGD 650/ },
    { text: 'S$600 is not correct, please use S$500', clarification: /could not match the rejected value/ }
  ];
  for (const testCase of correctionCases) {
    proposedInvoice = invoiceProposal(testCase.amount || 600);
    correctionProviderRequests.length = 0;
    const correctionTurn = { id: 'invoice-correction', sender: 'user', timestamp: '', text: testCase.text };
    const result = await processAccountingQuery(
      testCase.text,
      structuredClone(initialCorrectionState.scenarioState),
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, correctionTurn]
    );
    const visibleGroups = getDisplayableUncommittedJournalGroups(result.scenarioState, 'SFRS_I');
    assert.equal(result.scenarioState.committedDirectGroups?.length || 0, 0);
    if (testCase.amount) {
      assert.equal(result.scenarioState.amount, 600);
      assert.equal(result.scenarioState.imageEvidence?.[0]?.fields.find(field => field.field === 'total')?.value, 500,
        'the raw screenshot total remains visible as image evidence');
      assert.ok(result.scenarioState.evidence?.some(field => field.source === 'user_text' && field.value === 600),
        'the accepted correction has user_text provenance');
      assert.equal(result.scenarioState.isComplete, true);
      assert.equal(visibleGroups.length, 1);
      assert.equal(visibleGroups[0].authorityStatus, 'CONDITIONAL', 'the low-confidence invoice date keeps the proposal conditional');
      assert.equal(visibleGroups[0].eventDate, '20/01/2025');
      assert.equal(visibleGroups[0].totalDebit, 600);
      assert.equal(visibleGroups[0].totalCredit, 600);
      assert.equal(validateJournalGroups(visibleGroups).isValid, true);
      assert.match(result.messageText, /Corrected invoice journal proposal/);
      assert.match(result.messageText, /low-confidence.*Verify it before posting/i);
      assert.match(result.messageText, /remains uncommitted/i);
      assert.equal(result.displayFullAnswer, true);
      assert.ok(correctionProviderRequests.length > 0);
      assert.ok(correctionProviderRequests.every(request => !JSON.stringify(request).includes('S$500 is not correct')),
        'the original correction wording stays out of the canonical provider context');
    } else {
      assert.deepEqual(visibleGroups, []);
      assert.deepEqual(result.scenarioState.directGroups, []);
      assert.match(result.messageText, testCase.clarification);
      assert.match(result.messageText, /No journal proposal is shown/i);
    }
  }

  proposedInvoice = invoiceProposal(700);
  const mismatchedCorrection = 'S$500 is not correct, please use S$600';
  const mismatchedResult = await processAccountingQuery(
    mismatchedCorrection,
    structuredClone(initialCorrectionState.scenarioState),
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'mismatched-correction', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(mismatchedResult.scenarioState, 'SFRS_I'), []);
  assert.match(mismatchedResult.messageText, /did not produce one balanced journal that reconciles to SGD 600/i);
  assert.equal(mismatchedResult.scenarioState.committedDirectGroups?.length || 0, 0);

  proposedInvoice = invoiceProposal(600, '21/01/2025');
  const dateMismatch = await processAccountingQuery(
    mismatchedCorrection,
    structuredClone(initialCorrectionState.scenarioState),
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'date-mismatch', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(dateMismatch.scenarioState, 'SFRS_I'), []);
  assert.match(dateMismatch.messageText, /did not produce one balanced journal/i);

  proposedInvoice = invoiceProposal(600, '20/01/2025', 'USD');
  const foreignCurrency = await processAccountingQuery(
    mismatchedCorrection,
    structuredClone(initialCorrectionState.scenarioState),
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'foreign-currency', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(foreignCurrency.scenarioState, 'SFRS_I'), []);
  assert.match(foreignCurrency.messageText, /did not produce one balanced journal/i);

  const multipleInvoiceState = structuredClone(initialCorrectionState.scenarioState);
  multipleInvoiceState.imageEvidence.push({ imageId: 'image-203', documentType: 'supplier_invoice', fields: [
    { source: 'image', field: 'invoiceNo', value: 'INV-203' },
    { source: 'image', field: 'total', value: 500 },
    { source: 'image', field: 'currency', value: 'SGD' }
  ] });
  correctionProviderRequests.length = 0;
  const multipleInvoices = await processAccountingQuery(
    mismatchedCorrection,
    multipleInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'multiple-invoices', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(multipleInvoices.scenarioState, 'SFRS_I'), []);
  assert.match(multipleInvoices.messageText, /More than one supplier invoice is attached.*INV-202, INV-203/i);
  assert.equal(correctionProviderRequests.length, 0);

  const unrelatedQuestion = 'How is GST charged on supplier invoices?';
  const unrelatedMultiInvoiceQuery = await processAccountingQuery(
    unrelatedQuestion,
    multipleInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unrelated-advisory', sender: 'user', timestamp: '', text: unrelatedQuestion }]
  );
  assert.doesNotMatch(unrelatedMultiInvoiceQuery.messageText, /More than one supplier invoice is attached/);

  const unrelatedImageState = structuredClone(initialCorrectionState.scenarioState);
  unrelatedImageState.imageEvidence.push({ imageId: 'statement-204', documentType: 'investment_statement', fields: [
    { source: 'image', field: 'total', value: 9000 }
  ] });
  proposedInvoice = invoiceProposal(600);
  correctionProviderRequests.length = 0;
  const selectedInvoice = await processAccountingQuery(
    mismatchedCorrection,
    unrelatedImageState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'selected-invoice', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.equal(getDisplayableUncommittedJournalGroups(selectedInvoice.scenarioState, 'SFRS_I')[0]?.totalDebit, 600);
  assert.ok(correctionProviderRequests.every(request => !JSON.stringify(request).includes('9000')),
    'amounts from the unrelated attachment stay out of the selected invoice context');
} finally {
  globalThis.fetch = originalFetch;
}

const unbalancedJournal = await processAccountingQuery('show me double entry', {
  scenarioType: 'UNIVERSAL', rawQuery: 'test', transactionTitle: 'Pending valuation', functionalCurrency: 'SGD', transactionCurrency: 'SGD',
  directGroups: [{ id: 'pending', title: 'Pending valuation', eventDate: '15/09/2026', summary: '', lines: [], totalDebit: 0, totalCredit: 0, isBalanced: false, citations: [], rationalePoints: [] }],
  isComplete: false, missingFields: []
}, 'SFRS_I');
assert.match(unbalancedJournal.messageText, /No Double Entry Available Yet/);

console.log('✓ MIME validation and base64 extraction passed.');
