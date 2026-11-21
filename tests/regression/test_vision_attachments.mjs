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
  fields: { documentTitle: 'Supplier Invoice', invoiceNo: 'INV-202', invoiceDate: '20/01/2025', total: 500, currency: 'SGD' }
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
  const imageExtractionRequests = correctionProviderRequests.filter(request =>
    JSON.stringify(request).includes('Extract only visible document evidence')
  );
  assert.equal(imageExtractionRequests.length, 1, 'the initial attached image is extracted once');
  const imageExtractionInstruction = imageExtractionRequests[0].contents[0].parts.find(part => typeof part.text === 'string').text;
  assert.match(imageExtractionInstruction, /copy the exact visible document heading into fields\.documentTitle/i);
  assert.match(imageExtractionInstruction, /supplier_invoice only when the printed title or type explicitly says/i);
  assert.match(imageExtractionInstruction, /customer sales invoices and credit notes/i);

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

  const capturedInvoiceState = structuredClone(initialCorrectionState.scenarioState);
  capturedInvoiceState.imageEvidence[0] = {
    ...capturedInvoiceState.imageEvidence[0],
    documentType: 'accounting_transaction',
    confidence: 0.95,
    fields: [
      { source: 'image', imageId: 'image-202', field: 'invoiceNumber', value: 'INV-202', confidence: 0.95 },
      { source: 'image', imageId: 'image-202', field: 'date', value: '20/01/2025', confidence: 0.95 },
      { source: 'image', imageId: 'image-202', field: 'documentTitle', value: 'Supplier invoice INV-202', confidence: 0.95 },
      { source: 'image', imageId: 'image-202', field: 'description', value: 'Maintenance Expense', confidence: 0.95 },
      { source: 'image', imageId: 'image-202', field: 'totalAmount', value: 500, confidence: 0.95 },
      { source: 'image', imageId: 'image-202', field: 'currency', value: 'SGD', confidence: 0.95 }
    ]
  };
  capturedInvoiceState.evidence = flattenImageEvidence(capturedInvoiceState.imageEvidence);
  capturedInvoiceState.missingFields = [{
    fieldKey: 'guardrail-DOUBLE_ENTRY_IMBALANCE',
    fieldName: 'Accounting guardrail validation',
    prompt: 'The invoice proposal was rejected by accounting validation.'
  }];
  capturedInvoiceState.isComplete = false;
  capturedInvoiceState.directGroups = [];
  proposedInvoice = invoiceProposal(600);
  const capturedCorrectionText = 'S$500 is not correct, please use S$600';
  correctionProviderRequests.length = 0;
  const capturedCorrection = await processAccountingQuery(
    capturedCorrectionText,
    capturedInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'captured-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const capturedCorrectionGroups = getDisplayableUncommittedJournalGroups(capturedCorrection.scenarioState, 'SFRS_I');
  assert.equal(capturedCorrection.scenarioState.amount, 600);
  assert.equal(capturedCorrection.scenarioState.imageEvidence[0].documentType, 'accounting_transaction');
  assert.equal(capturedCorrection.scenarioState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value, 'Supplier invoice INV-202',
    'the visible invoice heading remains retained as image-origin evidence');
  assert.equal(capturedCorrection.scenarioState.imageEvidence[0].fields.find(field => field.field === 'totalAmount').value, 500,
    'correcting the invoice does not rewrite the original screenshot evidence');
  assert.equal(capturedCorrectionGroups.length, 1);
  assert.equal(capturedCorrectionGroups[0].totalDebit, 600);
  assert.equal(capturedCorrectionGroups[0].totalCredit, 600);
  assert.equal(validateJournalGroups(capturedCorrectionGroups).isValid, true);
  assert.equal(capturedCorrection.scenarioState.committedDirectGroups?.length || 0, 0);
  assert.equal(correctionProviderRequests.filter(request => JSON.stringify(request).includes('Extract only visible document evidence')).length, 0,
    'the correction uses retained image evidence without re-extracting the screenshot');

  const retainedCommittedGroups = invoiceProposal(750).directGroups.map(group => ({
    ...group,
    id: 'committed-prior-journal',
    title: 'Previously committed journal',
    eventDate: '01/01/2024',
    authorityStatus: 'DETERMINISTIC'
  }));
  const correctionWithCommittedHistory = structuredClone(capturedInvoiceState);
  correctionWithCommittedHistory.committedDirectGroups = retainedCommittedGroups;
  const correctionRetainingCommittedHistory = await processAccountingQuery(
    capturedCorrectionText,
    correctionWithCommittedHistory,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'correction-with-committed-history', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.deepEqual(correctionRetainingCommittedHistory.scenarioState.committedDirectGroups, retainedCommittedGroups,
    'an invoice correction preserves an earlier committed journal unchanged');
  assert.equal(getDisplayableUncommittedJournalGroups(correctionRetainingCommittedHistory.scenarioState, 'SFRS_I').length, 1,
    'the corrected invoice remains a separate uncommitted proposal');

  const formattedAmountState = structuredClone(capturedInvoiceState);
  const formattedAmountImage = formattedAmountState.imageEvidence[0];
  formattedAmountImage.fields.find(field => field.field === 'totalAmount').value = 'SGD 500.00';
  formattedAmountState.evidence = flattenImageEvidence(formattedAmountState.imageEvidence);
  const formattedAmountCorrection = await processAccountingQuery(
    capturedCorrectionText,
    formattedAmountState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'formatted-amount-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const formattedAmountGroups = getDisplayableUncommittedJournalGroups(formattedAmountCorrection.scenarioState, 'SFRS_I');
  assert.equal(formattedAmountCorrection.scenarioState.amount, 600,
    'a formatted captured invoice total uses the same cents validation as a numeric total');
  assert.equal(formattedAmountCorrection.scenarioState.imageEvidence[0].fields.find(field => field.field === 'totalAmount').value, 'SGD 500.00',
    'normalizing a formatted amount does not rewrite the original image evidence');
  assert.equal(formattedAmountGroups.length, 1);
  assert.equal(validateJournalGroups(formattedAmountGroups).isValid, true);

  const descriptionOnlyInvoiceState = structuredClone(capturedInvoiceState);
  descriptionOnlyInvoiceState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Invoice INV-202';
  delete descriptionOnlyInvoiceState.rawQuery;
  descriptionOnlyInvoiceState.evidence = flattenImageEvidence(descriptionOnlyInvoiceState.imageEvidence);
  correctionProviderRequests.length = 0;
  const ambiguousDirection = await processAccountingQuery(
    capturedCorrectionText,
    descriptionOnlyInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'ambiguous-invoice-direction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(ambiguousDirection.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i);
  assert.match(ambiguousDirection.messageText, /No journal proposal is shown/i);
  assert.deepEqual(ambiguousDirection.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'ambiguous invoice direction is clarified without Gemini');

  const customerInvoiceHeadingState = structuredClone(capturedInvoiceState);
  customerInvoiceHeadingState.imageEvidence[0].documentType = 'supplier_invoice';
  customerInvoiceHeadingState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Customer invoice INV-202';
  customerInvoiceHeadingState.evidence = flattenImageEvidence(customerInvoiceHeadingState.imageEvidence);
  correctionProviderRequests.length = 0;
  const customerInvoiceHeading = await processAccountingQuery(
    capturedCorrectionText,
    customerInvoiceHeadingState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'customer-invoice-heading', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(customerInvoiceHeading.messageText, /identifies a customer sales invoice or credit note/i,
    'a customer invoice heading overrides both retained supplier type and expense-like description text');
  assert.deepEqual(customerInvoiceHeading.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'a conflicting sales invoice heading is stopped before Gemini');

  const negatedSupplierHeadingState = structuredClone(capturedInvoiceState);
  negatedSupplierHeadingState.imageEvidence[0].documentType = 'supplier_invoice';
  negatedSupplierHeadingState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Not a Supplier Invoice INV-202';
  negatedSupplierHeadingState.evidence = flattenImageEvidence(negatedSupplierHeadingState.imageEvidence);
  correctionProviderRequests.length = 0;
  const negatedSupplierHeading = await processAccountingQuery(
    capturedCorrectionText,
    negatedSupplierHeadingState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'negated-supplier-invoice-heading', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(negatedSupplierHeading.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
    'a negated supplier invoice title cannot authorize a correction even when documentType says supplier_invoice');
  assert.deepEqual(negatedSupplierHeading.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'a negated supplier heading is clarified before Gemini');

  const retainedTypeOnlyState = structuredClone(descriptionOnlyInvoiceState);
  retainedTypeOnlyState.imageEvidence[0].documentType = 'supplier_invoice';
  retainedTypeOnlyState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Invoice';
  retainedTypeOnlyState.evidence = flattenImageEvidence(retainedTypeOnlyState.imageEvidence);
  correctionProviderRequests.length = 0;
  const retainedTypeOnlyInvoice = await processAccountingQuery(
    capturedCorrectionText,
    retainedTypeOnlyState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'retained-invoice-type-only', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(retainedTypeOnlyInvoice.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
    'retained supplier_invoice classification cannot authorize a generic invoice');
  assert.deepEqual(retainedTypeOnlyInvoice.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0);

  const descriptionWithSupplierEvidence = structuredClone(descriptionOnlyInvoiceState);
  descriptionWithSupplierEvidence.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'supplier', value: 'ABC Maintenance Services Pte Ltd', confidence: 0.95
  });
  descriptionWithSupplierEvidence.evidence = flattenImageEvidence(descriptionWithSupplierEvidence.imageEvidence);
  correctionProviderRequests.length = 0;
  const contextBoundDescription = await processAccountingQuery(
    capturedCorrectionText,
    descriptionWithSupplierEvidence,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'supplier-context-invoice', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(contextBoundDescription.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
    'a supplier name on a generic invoice does not establish purchase direction');
  assert.deepEqual(contextBoundDescription.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'a supplier field alone cannot authorize a correction proposal');

  const explicitInvoiceTypeState = structuredClone(descriptionOnlyInvoiceState);
  explicitInvoiceTypeState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Invoice';
  explicitInvoiceTypeState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'invoiceType', value: 'supplier purchase invoice', confidence: 0.95
  });
  explicitInvoiceTypeState.evidence = flattenImageEvidence(explicitInvoiceTypeState.imageEvidence);
  correctionProviderRequests.length = 0;
  const explicitInvoiceTypeCorrection = await processAccountingQuery(
    capturedCorrectionText,
    explicitInvoiceTypeState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'explicit-invoice-type', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const explicitInvoiceTypeGroups = getDisplayableUncommittedJournalGroups(explicitInvoiceTypeCorrection.scenarioState, 'SFRS_I');
  assert.equal(explicitInvoiceTypeGroups.length, 1, 'a visible explicit invoiceType can establish direction');
  assert.equal(explicitInvoiceTypeGroups[0].totalDebit, 600);
  assert.equal(explicitInvoiceTypeGroups[0].totalCredit, 600);
  assert.ok(correctionProviderRequests.length > 0);

  for (const uncertainType of ['sales/purchase', 'possible purchase invoice', 'purchase?']) {
    const uncertainInvoiceTypeState = structuredClone(descriptionOnlyInvoiceState);
    uncertainInvoiceTypeState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Invoice';
    uncertainInvoiceTypeState.imageEvidence[0].fields.push({
      source: 'image', imageId: 'image-202', field: 'invoiceType', value: uncertainType, confidence: 0.95
    });
    uncertainInvoiceTypeState.evidence = flattenImageEvidence(uncertainInvoiceTypeState.imageEvidence);
    correctionProviderRequests.length = 0;
    const uncertainInvoiceType = await processAccountingQuery(
      capturedCorrectionText,
      uncertainInvoiceTypeState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `uncertain-invoice-type-${uncertainType}`, sender: 'user', timestamp: '', text: capturedCorrectionText }]
    );
    assert.match(uncertainInvoiceType.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
      `${uncertainType} is not an explicit purchase invoice type`);
    assert.deepEqual(uncertainInvoiceType.scenarioState.directGroups, []);
    assert.equal(correctionProviderRequests.length, 0);
  }

  const payableOnlyInvoiceState = structuredClone(descriptionOnlyInvoiceState);
  payableOnlyInvoiceState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'amountPayable', value: 500, confidence: 0.95
  });
  payableOnlyInvoiceState.evidence = flattenImageEvidence(payableOnlyInvoiceState.imageEvidence);
  correctionProviderRequests.length = 0;
  const payableOnlyInvoice = await processAccountingQuery(
    capturedCorrectionText,
    payableOnlyInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'payable-only-invoice', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(payableOnlyInvoice.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
    'an amount payable field alone does not establish purchase direction');
  assert.deepEqual(payableOnlyInvoice.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0);

  const noNumberInvoiceState = structuredClone(descriptionOnlyInvoiceState);
  noNumberInvoiceState.imageEvidence[0].fields = noNumberInvoiceState.imageEvidence[0].fields
    .filter(field => !/invoice(?:number|no|id)/i.test(field.field));
  noNumberInvoiceState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Invoice';
  noNumberInvoiceState.evidence = flattenImageEvidence(noNumberInvoiceState.imageEvidence);
  correctionProviderRequests.length = 0;
  const noNumberClarification = await processAccountingQuery(
    capturedCorrectionText,
    noNumberInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'no-number-invoice-direction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(noNumberClarification.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
    'an identifiable invoice heading without an invoice number still enters the correction flow');
  assert.deepEqual(noNumberClarification.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0);

  correctionProviderRequests.length = 0;
  const confirmedNoNumberCorrection = await processAccountingQuery(
    'This is a supplier purchase invoice. The invoice total is SGD 600.',
    noNumberInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'confirmed-no-number-invoice', sender: 'user', timestamp: '', text: 'This is a supplier purchase invoice. The invoice total is SGD 600.' }]
  );
  const confirmedNoNumberGroups = getDisplayableUncommittedJournalGroups(confirmedNoNumberCorrection.scenarioState, 'SFRS_I');
  assert.equal(confirmedNoNumberCorrection.scenarioState.amount, 600);
  assert.equal(confirmedNoNumberGroups.length, 1,
    'a clear user confirmation and corrected total can proceed without an invoice number');
  assert.equal(confirmedNoNumberGroups[0].totalDebit, 600);
  assert.equal(confirmedNoNumberGroups[0].totalCredit, 600);
  assert.deepEqual(confirmedNoNumberGroups[0].lines.map(line => [line.category, line.debit, line.credit]), [
    ['EXPENSE', 600, 0], ['LIABILITY', 0, 600]
  ]);
  assert.equal(validateJournalGroups(confirmedNoNumberGroups).isValid, true);
  assert.ok(correctionProviderRequests.length > 0);

  correctionProviderRequests.length = 0;
  const unconfirmedNoNumberCorrection = await processAccountingQuery(
    'This is a supplier purchase invoice. The invoice total is SGD 600?',
    noNumberInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'question-mark-invoice-total', sender: 'user', timestamp: '', text: 'This is a supplier purchase invoice. The invoice total is SGD 600?' }]
  );
  assert.match(unconfirmedNoNumberCorrection.messageText, /Please confirm the supplier purchase direction and corrected total/i);
  assert.deepEqual(unconfirmedNoNumberCorrection.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'a question-mark total does not authorize a journal proposal');

  const negatedInvoiceTypeState = structuredClone(noNumberInvoiceState);
  negatedInvoiceTypeState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Supplier Invoice';
  negatedInvoiceTypeState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'invoiceType', value: 'Not a purchase invoice', confidence: 0.95
  });
  negatedInvoiceTypeState.evidence = flattenImageEvidence(negatedInvoiceTypeState.imageEvidence);
  for (const confirmationText of [
    capturedCorrectionText,
    'This is a supplier purchase invoice. The invoice total is SGD 600.'
  ]) {
    correctionProviderRequests.length = 0;
    const negatedInvoiceType = await processAccountingQuery(
      confirmationText,
      negatedInvoiceTypeState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `negated-invoice-type-${confirmationText.length}`, sender: 'user', timestamp: '', text: confirmationText }]
    );
    assert.match(negatedInvoiceType.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
      'a negated invoiceType overrides both an affirmative heading and user confirmation');
    assert.deepEqual(negatedInvoiceType.scenarioState.directGroups, []);
    assert.equal(correctionProviderRequests.length, 0);
  }

  const explicitNoNumberPurchaseState = structuredClone(noNumberInvoiceState);
  explicitNoNumberPurchaseState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Supplier Invoice';
  explicitNoNumberPurchaseState.evidence = flattenImageEvidence(explicitNoNumberPurchaseState.imageEvidence);
  for (const questionedTotal of ['The invoice total is SGD 600?', 'My invoice total is SGD 600?']) {
    correctionProviderRequests.length = 0;
    const questionedStandaloneTotal = await processAccountingQuery(
      questionedTotal,
      explicitNoNumberPurchaseState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `questioned-standalone-invoice-total-${questionedTotal.length}`, sender: 'user', timestamp: '', text: questionedTotal }]
    );
    assert.match(questionedStandaloneTotal.messageText, /Please confirm the corrected invoice total in a statement without a question mark/i);
    assert.deepEqual(questionedStandaloneTotal.scenarioState.directGroups, []);
    assert.equal(correctionProviderRequests.length, 0, `${questionedTotal} cannot prepare an explicit supplier invoice`);
  }

  const confirmedCustomerInvoiceState = structuredClone(noNumberInvoiceState);
  confirmedCustomerInvoiceState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Customer Sales Invoice';
  confirmedCustomerInvoiceState.evidence = flattenImageEvidence(confirmedCustomerInvoiceState.imageEvidence);
  correctionProviderRequests.length = 0;
  const confirmedCustomerInvoice = await processAccountingQuery(
    'This is a supplier purchase invoice. The invoice total is SGD 600.',
    confirmedCustomerInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'confirmed-opposite-invoice', sender: 'user', timestamp: '', text: 'This is a supplier purchase invoice. The invoice total is SGD 600.' }]
  );
  assert.match(confirmedCustomerInvoice.messageText, /identifies a customer sales invoice or credit note/i,
    'an explicit user confirmation cannot override a conflicting customer invoice heading');
  assert.deepEqual(confirmedCustomerInvoice.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0);

  for (const oppositeDirection of ['sale', 'customer_sales_invoice', 'credit_note']) {
    const oppositeInvoiceState = structuredClone(capturedInvoiceState);
    oppositeInvoiceState.imageEvidence[0].fields.push({
      source: 'image', imageId: 'image-202', field: 'transactionType', value: oppositeDirection, confidence: 0.95
    });
    oppositeInvoiceState.evidence = flattenImageEvidence(oppositeInvoiceState.imageEvidence);
    correctionProviderRequests.length = 0;
    const oppositeInvoiceResponse = await processAccountingQuery(
      capturedCorrectionText,
      oppositeInvoiceState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `opposite-invoice-${oppositeDirection}`, sender: 'user', timestamp: '', text: capturedCorrectionText }]
    );
    assert.match(oppositeInvoiceResponse.messageText, /identifies a customer sales invoice or credit note/i);
    assert.match(oppositeInvoiceResponse.messageText, /No journal proposal is shown/i);
    assert.deepEqual(oppositeInvoiceResponse.scenarioState.directGroups, []);
    assert.equal(correctionProviderRequests.length, 0, `${oppositeDirection} is rejected before Gemini`);
  }

  const splitSettlementState = structuredClone(capturedInvoiceState);
  splitSettlementState.imageEvidence[0].fields.push(
    { source: 'image', imageId: 'image-202', field: 'immediatePayment', value: 400, confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'remainingPayable', value: 100, confidence: 0.95 }
  );
  splitSettlementState.evidence = flattenImageEvidence(splitSettlementState.imageEvidence);
  correctionProviderRequests.length = 0;
  const splitSettlementCorrection = await processAccountingQuery(
    capturedCorrectionText,
    splitSettlementState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'split-settlement-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(splitSettlementCorrection.messageText, /immediate payment of SGD 400.*remaining payable of SGD 100.*corrected invoice total of SGD 600/i);
  assert.match(splitSettlementCorrection.messageText, /No journal proposal is shown/i);
  assert.deepEqual(splitSettlementCorrection.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'a settlement split the correction path cannot preserve is clarified before Gemini');

  const conflictingSettlementState = structuredClone(capturedInvoiceState);
  conflictingSettlementState.imageEvidence[0].fields.push(
    { source: 'image', imageId: 'image-202', field: 'immediatePayment', value: 0, confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'cashPaid', value: 400, confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'creditBalance', value: 100, confidence: 0.95 }
  );
  conflictingSettlementState.evidence = flattenImageEvidence(conflictingSettlementState.imageEvidence);
  correctionProviderRequests.length = 0;
  const conflictingSettlement = await processAccountingQuery(
    capturedCorrectionText,
    conflictingSettlementState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'conflicting-settlement-aliases', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(conflictingSettlement.messageText, /conflicting or unreadable payment\/payable amounts/i);
  assert.deepEqual(conflictingSettlement.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0, 'contradictory settlement aliases stop before Gemini');

  const fullPayableState = structuredClone(capturedInvoiceState);
  fullPayableState.imageEvidence[0].fields.push(
    { source: 'image', imageId: 'image-202', field: 'immediatePayment', value: 0, confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'creditBalance', value: 600, confidence: 0.95 }
  );
  fullPayableState.evidence = flattenImageEvidence(fullPayableState.imageEvidence);
  proposedInvoice = invoiceProposal(600);
  correctionProviderRequests.length = 0;
  const fullPayableCorrection = await processAccountingQuery(
    capturedCorrectionText,
    fullPayableState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'full-payable-credit-balance', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const fullPayableGroups = getDisplayableUncommittedJournalGroups(fullPayableCorrection.scenarioState, 'SFRS_I');
  assert.equal(fullPayableGroups.length, 1);
  assert.ok(fullPayableGroups[0].lines.some(line => /payable/i.test(line.accountName) && line.credit === 600));
  assert.ok(!fullPayableGroups[0].lines.some(line => /(?:cash|bank)/i.test(line.accountName) && line.credit > 0));

  proposedInvoice = invoiceProposal(600);
  proposedInvoice.directGroups[0].lines[1] = {
    accountName: 'Bank', category: 'ASSET', debit: 0, credit: 600
  };
  correctionProviderRequests.length = 0;
  const incorrectBankCredit = await processAccountingQuery(
    capturedCorrectionText,
    fullPayableState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'reject-bank-credit-for-full-payable', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(incorrectBankCredit.messageText, /explicitly shows no amount paid and a full remaining payable/i);
  assert.match(incorrectBankCredit.messageText, /No journal proposal is shown/i);
  assert.deepEqual(incorrectBankCredit.scenarioState.directGroups, []);
  assert.equal(getDisplayableUncommittedJournalGroups(incorrectBankCredit.scenarioState, 'SFRS_I').length, 0);
  assert.ok(correctionProviderRequests.length > 0, 'the validated mock response is checked against explicit all-payable evidence');

  proposedInvoice = invoiceProposal(600);
  proposedInvoice.directGroups[0].lines[1] = {
    accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 100
  };
  proposedInvoice.directGroups[0].lines.push({
    accountName: 'Deferred Revenue', category: 'LIABILITY', debit: 0, credit: 500
  });
  correctionProviderRequests.length = 0;
  const splitLiabilityCredit = await processAccountingQuery(
    capturedCorrectionText,
    fullPayableState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'reject-other-liability-split', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.match(splitLiabilityCredit.messageText, /does not preserve that payable treatment/i);
  assert.match(splitLiabilityCredit.messageText, /No journal proposal is shown/i);
  assert.deepEqual(splitLiabilityCredit.scenarioState.directGroups, []);
  assert.equal(getDisplayableUncommittedJournalGroups(splitLiabilityCredit.scenarioState, 'SFRS_I').length, 0,
    'deferred revenue does not count toward the explicitly documented payable balance');
  proposedInvoice = invoiceProposal(600);

  const capturedConflictCases = [
    {
      text: 'S$500 is not correct, please use S$600 or S$700',
      prompt: /multiple replacement totals, SGD 600 or SGD 700/
    },
    {
      text: 'The subtotal is S$600, GST is S$54, total is S$654, and subtotal is S$650.',
      prompt: /conflicting subtotal values SGD 600 and SGD 650/
    },
    {
      text: 'S$545 is not correct, please use S$600',
      prompt: /subtotal \(SGD 500\) plus GST \(SGD 45\) does not reconcile to the corrected invoice total SGD 600/
    }
  ];
  for (const testCase of capturedConflictCases) {
    const scenario = structuredClone(capturedInvoiceState);
    if (testCase.text.startsWith('S$545')) {
      scenario.imageEvidence[0].fields.find(field => field.field === 'totalAmount').value = 545;
      scenario.imageEvidence[0].fields.push(
        { source: 'image', imageId: 'image-202', field: 'subtotal', value: 500, confidence: 0.95 },
        { source: 'image', imageId: 'image-202', field: 'tax', value: 45, confidence: 0.95 }
      );
      scenario.evidence = flattenImageEvidence(scenario.imageEvidence);
    }
    correctionProviderRequests.length = 0;
    const result = await processAccountingQuery(
      testCase.text,
      scenario,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: 'captured-conflict', sender: 'user', timestamp: '', text: testCase.text }]
    );
    assert.match(result.messageText, testCase.prompt);
    assert.match(result.messageText, /No journal proposal is shown/);
    assert.deepEqual(result.scenarioState.directGroups, []);
    assert.equal(result.scenarioState.committedDirectGroups?.length || 0, 0);
    assert.equal(correctionProviderRequests.length, 0, 'invoice amount conflicts are clarified without Gemini');
  }

  const mismatchedCorrection = 'S$500 is not correct, please use S$600';
  const amountCorrection = 'S$545 is not correct, please use S$600';
  const amountEvidenceState = structuredClone(initialCorrectionState.scenarioState);
  const amountEvidenceInvoice = amountEvidenceState.imageEvidence[0];
  amountEvidenceInvoice.fields.find(field => field.field === 'total').value = 545;
  amountEvidenceInvoice.fields.push(
    { source: 'image', imageId: amountEvidenceInvoice.imageId, field: 'subtotalBeforeTax', value: 500, confidence: 0.99 },
    { source: 'image', imageId: amountEvidenceInvoice.imageId, field: 'gstTotal', value: 45, confidence: 0.99 }
  );
  assert.equal(amountEvidenceInvoice.fields.find(field => field.field === 'total').value, 545);
  assert.equal(amountEvidenceInvoice.fields.find(field => field.field === 'subtotalBeforeTax').value, 500);
  assert.equal(amountEvidenceInvoice.fields.find(field => field.field === 'gstTotal').value, 45);
  amountEvidenceState.evidence = [
    ...(amountEvidenceState.evidence || []).filter(field => field.imageId !== amountEvidenceInvoice.imageId),
    ...flattenImageEvidence([amountEvidenceInvoice])
  ];
  proposedInvoice = invoiceProposal(600);
  correctionProviderRequests.length = 0;
  const inconsistentInvoiceAmounts = await processAccountingQuery(
    amountCorrection,
    amountEvidenceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'inconsistent-correction', sender: 'user', timestamp: '', text: amountCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(inconsistentInvoiceAmounts.scenarioState, 'SFRS_I'), []);
  assert.deepEqual(inconsistentInvoiceAmounts.scenarioState.directGroups, []);
  assert.match(inconsistentInvoiceAmounts.messageText, /subtotal.*SGD 500.*GST.*SGD 45.*SGD 600.*clearer or corrected invoice image.*confirmed figures/i);
  assert.equal(correctionProviderRequests.length, 0, 'an extracted subtotal plus GST mismatch must stop before Gemini generation');

  const uncertainAmountState = structuredClone(amountEvidenceState);
  uncertainAmountState.imageEvidence[0].fields.find(field => field.field === 'subtotalBeforeTax').confidence = 0.6;
  uncertainAmountState.evidence = [
    ...(uncertainAmountState.evidence || []).filter(field => field.imageId !== amountEvidenceInvoice.imageId),
    ...flattenImageEvidence([uncertainAmountState.imageEvidence[0]])
  ];
  correctionProviderRequests.length = 0;
  const uncertainInvoiceAmounts = await processAccountingQuery(
    amountCorrection,
    uncertainAmountState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'uncertain-correction', sender: 'user', timestamp: '', text: amountCorrection }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(uncertainInvoiceAmounts.scenarioState, 'SFRS_I'), []);
  assert.deepEqual(uncertainInvoiceAmounts.scenarioState.directGroups, []);
  assert.match(uncertainInvoiceAmounts.messageText, /subtotal.*SGD 500.*clearer or corrected invoice image.*confirmed figures/i);
  assert.equal(correctionProviderRequests.length, 0, 'a low-confidence remaining invoice amount must stop before Gemini generation');

  proposedInvoice = invoiceProposal(700);
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
  assert.match(multipleInvoices.messageText, /More than one invoice document is attached.*INV-202, INV-203/i);
  assert.equal(correctionProviderRequests.length, 0);

  const unreadableSecondInvoiceState = structuredClone(capturedInvoiceState);
  unreadableSecondInvoiceState.imageEvidence.push({
    imageId: 'image-203', documentType: 'accounting_transaction', fields: [
      { source: 'image', imageId: 'image-203', field: 'invoiceNumber', value: 'INV-203' },
      { source: 'image', imageId: 'image-203', field: 'totalAmount', value: 'unreadable' }
    ]
  });
  correctionProviderRequests.length = 0;
  const unreadableSecondInvoice = await processAccountingQuery(
    mismatchedCorrection,
    unreadableSecondInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unreadable-second-invoice', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.match(unreadableSecondInvoice.messageText, /More than one invoice document is attached.*INV-202, INV-203/i);
  assert.deepEqual(unreadableSecondInvoice.scenarioState.directGroups, []);
  assert.equal(correctionProviderRequests.length, 0,
    'an invoice with an unreadable total still counts toward multi-invoice ambiguity');

  const unrelatedQuestion = 'How is GST charged on supplier invoices?';
  const unrelatedMultiInvoiceQuery = await processAccountingQuery(
    unrelatedQuestion,
    multipleInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unrelated-advisory', sender: 'user', timestamp: '', text: unrelatedQuestion }]
  );
  assert.doesNotMatch(unrelatedMultiInvoiceQuery.messageText, /More than one invoice document is attached/);

  const unrelatedImageState = structuredClone(initialCorrectionState.scenarioState);
  unrelatedImageState.imageEvidence.push({ imageId: 'statement-204', documentType: 'investment_statement', fields: [
    { source: 'image', field: 'documentTitle', value: 'Invoice Summary' },
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
