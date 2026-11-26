import assert from 'node:assert/strict';
import { ACCEPTED_IMAGE_TYPES, extractBase64Data, MAX_IMAGE_FILE_SIZE, validateImageFile } from '../../src/utils/imageUtils.ts';
import { buildJournalGroupsFromImageEvidence, buildTransactionGroupsFromImageEvidence, createGeminiImageParts, extractImageEvidenceWithGemini, flattenImageEvidence, getMaterialImageUncertainties, processAccountingQuery, supportsGeminiVision } from '../../src/services/geminiService.ts';
import { getDisplayableUncommittedJournalGroups } from '../../src/services/committedJournal.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';
import { invoiceVisionResponse } from '../fixtures/visionEvidenceFixtures.mjs';
import { compileFeedbackReport } from '../../src/services/feedback.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { createIrasEvidencePresentation } from '../../src/utils/irasEvidencePresentation.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

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
  fields: { documentTitle: 'Supplier Invoice', invoiceNo: 'INV-202', invoiceDate: '20/01/2025', itemDescription: 'Maintenance Expense', total: 500, currency: 'SGD' }
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
let extractedImageResponse = correctionVision;
const correctionProviderRequests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('Offline fixture unavailable', { status: 404 });
  if (url.pathname.endsWith(':streamGenerateContent')) return new Response('Use the offline JSON fixture', { status: 404 });
  const request = JSON.parse(init.body);
  correctionProviderRequests.push(request);
  const value = JSON.stringify(request).includes('Extract only visible document evidence')
    ? extractedImageResponse
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
  assert.match(imageExtractionInstruction, /copy each visible goods or service line into fields\.itemDescription/i,
    'invoice account evidence must come from the printed line description, not the supplier heading');
  assert.match(imageExtractionInstruction, /copy visible invoice number, date, currency, subtotal, GST, and total into fields\.invoiceNo, fields\.invoiceDate, fields\.currency, fields\.subtotal, fields\.gst, and fields\.total/i,
    'invoice extraction uses the field names consumed by the existing invoice validation path');

  const clearInitialInvoiceVision = { imageEvidence: [{
    imageIndex: 1, documentType: 'supplier_invoice', confidence: 0.97,
    fields: { documentTitle: 'Supplier Invoice INV-202', invoiceNo: 'INV-202', invoiceDate: '20/01/2025',
      itemDescription: 'Maintenance Expense', total: 500, currency: 'SGD' }
  }] };
  extractedImageResponse = clearInitialInvoiceVision;
  proposedInvoice = invoiceProposal(0);
  correctionProviderRequests.length = 0;
  const initialImageInvoice = await processAccountingQuery(
    correctionImageTurn.text, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite', [correctionImageTurn]
  );
  const initialImageInvoiceGroups = getDisplayableUncommittedJournalGroups(initialImageInvoice.scenarioState, 'SFRS_I');
  assert.equal(initialImageInvoiceGroups.length, 1,
    'a failed zero-value model proposal can be recovered from one clear supplier invoice using the existing invoice controls');
  assert.equal(initialImageInvoice.scenarioState.isComplete, true);
  assert.equal(initialImageInvoiceGroups[0].authorityStatus, 'CONDITIONAL');
  assert.deepEqual(initialImageInvoiceGroups[0].lines.map(line => [line.accountName, line.debit, line.credit]), [
    ['Maintenance Expense', 500, 0], ['Trade Payables', 0, 500]
  ]);
  assert.equal(validateJournalGroups(initialImageInvoiceGroups).isValid, true);
  assert.match(initialImageInvoice.messageText, /initial supplier invoice journal proposal/i);
  assert.match(initialImageInvoice.messageText, /remains conditional and uncommitted/i);
  assert.match(initialImageInvoice.messageText, /assumes the invoice remains unpaid/i);
  assert.ok(initialImageInvoice.scenarioState.evidence.some(field =>
    field.source === 'image' && field.field === 'total' && field.value === 500));
  assert.equal(initialImageInvoice.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false,
  'the initial invoice proposal retains image provenance without inventing a user correction');
  assert.equal(initialImageInvoice.scenarioState.committedDirectGroups?.length || 0, 0,
    'the initial invoice proposal remains uncommitted');
  assert.equal(correctionProviderRequests.filter(request =>
    JSON.stringify(request).includes('Extract only visible document evidence')).length, 1,
  'invoice journal recovery reuses the existing image extraction request');

  const digitFreeInvoiceTurn = { ...correctionImageTurn, text: 'Please prepare the journal for this invoice.' };
  proposedInvoice = invoiceProposal(0);
  const digitFreeInitialImageInvoice = await processAccountingQuery(
    digitFreeInvoiceTurn.text, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite', [digitFreeInvoiceTurn]
  );
  const digitFreeInvoiceGroups = getDisplayableUncommittedJournalGroups(digitFreeInitialImageInvoice.scenarioState, 'SFRS_I');
  assert.equal(digitFreeInvoiceGroups.length, 1,
    'a verified image total satisfies journal amount validation when the request contains no digits or invoice reference');
  assert.deepEqual(digitFreeInvoiceGroups[0].lines.map(line => [line.accountName, line.debit, line.credit]), [
    ['Maintenance Expense', 500, 0], ['Trade Payables', 0, 500]
  ]);
  assert.equal(validateJournalGroups(digitFreeInvoiceGroups).isValid, true);
  assert.equal(digitFreeInitialImageInvoice.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false);
  const verifiedStatutoryInvoiceQuery = 'Please prepare the journal for this invoice, and explain whether input GST is recoverable.';
  const verifiedGstSource = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
  const verifiedGstClassification = classifyQuestion(verifiedStatutoryInvoiceQuery);
  const verifiedGstQuality = {
    status: 'LOCAL_SUFFICIENT', eligibleRecords: [verifiedGstSource], rejectedRecords: [],
    coveredTopicIds: verifiedGstClassification.topicIds, uncoveredTopicIds: [], missingFacts: [],
    targetDateConfidence: 'HIGH'
  };
  const verifiedGstClaim = {
    text: verifiedGstSource.sourceText, quote: verifiedGstSource.sourceText,
    recordId: verifiedGstSource.id, canonicalUrl: verifiedGstSource.canonicalSourceUrl,
    supportKind: 'REVIEWED_EDITORIAL_SUMMARY'
  };
  const verifiedGstPresentation = createIrasEvidencePresentation({
    query: verifiedStatutoryInvoiceQuery, classification: verifiedGstClassification,
    quality: verifiedGstQuality, acceptedClaims: [verifiedGstClaim], missingFacts: [],
    applicationConclusions: [], hasVerifiedCalculation: false, hasApplicationUncertainty: false,
    isGeneralRuleRequest: true
  });
  const currentStatutoryScenario = {
    scenarioType: 'UNRECOGNIZED', rawQuery: verifiedStatutoryInvoiceQuery,
    transactionTitle: 'Current invoice request', functionalCurrency: 'SGD', transactionCurrency: 'SGD',
    directGroups: [], isComplete: false, missingFields: [], queryIntent: 'HYBRID', primaryDomain: 'IRAS_GST',
    irasEvidencePresentation: verifiedGstPresentation,
    officialAnswerLinks: [{ title: verifiedGstSource.documentTitle, url: verifiedGstSource.canonicalSourceUrl }]
  };
  proposedInvoice = invoiceProposal(0);
  correctionProviderRequests.length = 0;
  const verifiedStatutoryInvoice = await processAccountingQuery(
    verifiedStatutoryInvoiceQuery, currentStatutoryScenario, 'SFRS_I', correctionProviderKey,
    'gemini-3.5-flash-lite', [{ ...digitFreeInvoiceTurn, text: verifiedStatutoryInvoiceQuery }]
  );
  const verifiedStatutoryInvoiceGroups = getDisplayableUncommittedJournalGroups(verifiedStatutoryInvoice.scenarioState, 'SFRS_I');
  assert.equal(verifiedStatutoryInvoiceGroups.length, 1,
    'invoice recovery still prepares the journal when the active request has a current verified statutory answer');
  assert.equal(verifiedStatutoryInvoice.scenarioState.queryIntent, 'HYBRID');
  assert.equal(verifiedStatutoryInvoice.scenarioState.primaryDomain, 'IRAS_GST');
  assert.equal(verifiedStatutoryInvoice.scenarioState.irasEvidencePresentation, verifiedGstPresentation,
    'invoice recovery preserves the current verified IRAS presentation');
  assert.ok(verifiedStatutoryInvoice.scenarioState.officialAnswerLinks.some(link =>
    link.url === verifiedGstSource.canonicalSourceUrl), 'invoice recovery preserves the verified official source link');
  assert.match(verifiedStatutoryInvoice.messageText, /Regulations 26 and 27 generally disallow input tax/i,
    'the verified statutory answer remains visible beside the recovered journal');

  const staleStatutoryScenario = {
    ...currentStatutoryScenario, rawQuery: 'What are the input GST rules?',
    irasEvidencePresentation: { ...verifiedGstPresentation, query: 'What are the input GST rules?' },
    officialAnswerLinks: [{ title: 'unverified', url: 'https://attacker.example/source' }]
  };
  proposedInvoice = invoiceProposal(0);
  const staleStatutoryInvoice = await processAccountingQuery(
    verifiedStatutoryInvoiceQuery, staleStatutoryScenario, 'SFRS_I', correctionProviderKey,
    'gemini-3.5-flash-lite', [{ ...digitFreeInvoiceTurn, text: verifiedStatutoryInvoiceQuery }]
  );
  assert.equal(staleStatutoryInvoice.scenarioState.officialAnswerLinks?.some(link =>
    link.url === 'https://attacker.example/source'), false,
  'invoice recovery does not retain stale, unverified statutory links');
  assert.notEqual(staleStatutoryInvoice.scenarioState.irasEvidencePresentation, staleStatutoryScenario.irasEvidencePresentation,
    'invoice recovery does not reuse the prior query presentation object');

  proposedInvoice = invoiceProposal(0);
  const onCreditInvoiceText = 'Please prepare the journal for this invoice on credit.';
  const onCreditInvoice = await processAccountingQuery(
    onCreditInvoiceText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: onCreditInvoiceText }]
  );
  const onCreditInvoiceGroups = getDisplayableUncommittedJournalGroups(onCreditInvoice.scenarioState, 'SFRS_I');
  assert.equal(onCreditInvoiceGroups.length, 1);
  assert.equal(onCreditInvoiceGroups[0].authorityStatus, 'CONDITIONAL',
    'an explicit credit instruction does not upgrade the image-derived proposal from conditional or uncommitted');
  assert.match(onCreditInvoice.messageText, /request states that the invoice is unpaid/i,
    'the explicit credit instruction is preserved without asking whether the invoice is unpaid');
  assert.equal(onCreditInvoice.scenarioState.committedDirectGroups?.length || 0, 0);

  for (const paymentText of [
    'Please prepare the journal for this invoice. We bought it for cash, not on credit.',
    'Please prepare the journal for this invoice. It was paid in full, with no outstanding balance.'
  ]) {
    extractedImageResponse = clearInitialInvoiceVision;
    proposedInvoice = invoiceProposal(0);
    const paidInvoice = await processAccountingQuery(
      paymentText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
      [{ ...digitFreeInvoiceTurn, text: paymentText }]
    );
    assert.deepEqual(getDisplayableUncommittedJournalGroups(paidInvoice.scenarioState, 'SFRS_I'), [],
      `initial image recovery does not replace an explicit paid fact with Trade Payables: ${paymentText}`);
    assert.equal(paidInvoice.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceSettlement', paymentText);
    assert.match(paidInvoice.messageText, /payment account and any amount that remains payable/i, paymentText);
  }

  const incompatibleClassificationText =
    'Please prepare the journal for this invoice. Classify it as a fixed asset, Office Equipment.';
  extractedImageResponse = clearInitialInvoiceVision;
  proposedInvoice = invoiceProposal(0);
  const incompatibleClassification = await processAccountingQuery(
    incompatibleClassificationText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: incompatibleClassificationText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(incompatibleClassification.scenarioState, 'SFRS_I'), [],
    'an explicit fixed-asset classification cannot be replaced by the invoice image expense account');
  assert.equal(incompatibleClassification.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceAccountClassification');
  assert.match(incompatibleClassification.messageText, /does not establish a consistent expense, inventory, or fixed-asset account/i);

  proposedInvoice = invoiceProposal(0);
  const paidInvoiceText = 'Please prepare the journal for this invoice. It was paid in cash.';
  const paidInvoice = await processAccountingQuery(
    paidInvoiceText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: paidInvoiceText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(paidInvoice.scenarioState, 'SFRS_I'), [],
    'initial image recovery does not replace an explicit cash payment with Trade Payables');
  assert.equal(paidInvoice.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceSettlement');
  assert.match(paidInvoice.messageText, /payment account and any amount that remains payable/i);

  const conflictingInvoiceText = 'Please prepare the journal for this invoice. The invoice total is SGD 600.';
  proposedInvoice = invoiceProposal(0);
  const conflictingInvoiceAmount = await processAccountingQuery(
    conflictingInvoiceText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: conflictingInvoiceText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(conflictingInvoiceAmount.scenarioState, 'SFRS_I'), [],
    'image recovery does not replace an explicit conflicting invoice total with the image amount');
  assert.match(conflictingInvoiceAmount.messageText, /does not match the total read from the screenshot/i);

  const conflictingCurrencyText = 'Please prepare the journal for this invoice. Its total is USD 500.';
  extractedImageResponse = clearInitialInvoiceVision;
  proposedInvoice = invoiceProposal(0);
  const conflictingInvoiceCurrency = await processAccountingQuery(
    conflictingCurrencyText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: conflictingCurrencyText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(conflictingInvoiceCurrency.scenarioState, 'SFRS_I'), [],
    'an explicit USD invoice instruction cannot be silently replaced by a verified SGD image');
  assert.equal(conflictingInvoiceCurrency.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceCurrency');
  assert.match(conflictingInvoiceCurrency.messageText, /request states USD, but the invoice image states SGD/i);

  const [initialInvoiceEvidence] = clearInitialInvoiceVision.imageEvidence;
  extractedImageResponse = { imageEvidence: [{
    ...initialInvoiceEvidence, fields: { ...initialInvoiceEvidence.fields, currency: 'USD' }
  }] };
  const unsupportedInvoiceCurrency = await processAccountingQuery(
    conflictingCurrencyText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: conflictingCurrencyText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(unsupportedInvoiceCurrency.scenarioState, 'SFRS_I'), []);
  assert.match(unsupportedInvoiceCurrency.messageText, /supplier invoice currency is not confirmed as SGD/i);
  assert.doesNotMatch(unsupportedInvoiceCurrency.messageText, /image states SGD/i);

  extractedImageResponse = clearInitialInvoiceVision;
  const conflictingDateText = 'Please prepare the journal for this invoice. The invoice date is 25/01/2025.';
  const conflictingInvoiceDate = await processAccountingQuery(
    conflictingDateText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: conflictingDateText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(conflictingInvoiceDate.scenarioState, 'SFRS_I'), [],
    'initial recovery withholds a posting date when the explicit invoice date conflicts with the image');
  assert.equal(conflictingInvoiceDate.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceDate');
  assert.match(conflictingInvoiceDate.messageText, /25\/01\/2025.*20\/01\/2025/i);

  const omittedSecondInvoice = {
    ...correctionImageTurn,
    images: [...correctionImageTurn.images, { ...correctionImageTurn.images[0], id: 'image-203' }]
  };
  const invoiceEvidenceWithoutConfidence = { imageEvidence: [{ ...clearInitialInvoiceVision.imageEvidence[0], confidence: undefined }] };
  for (const [turn, extractedEvidence, label] of [
    [omittedSecondInvoice, clearInitialInvoiceVision, 'one extraction from multiple attached invoices'],
    [correctionImageTurn, invoiceEvidenceWithoutConfidence, 'an invoice extraction without a confidence estimate']
  ]) {
    extractedImageResponse = extractedEvidence;
    proposedInvoice = invoiceProposal(0);
    const response = await processAccountingQuery(turn.text, null, 'SFRS_I',
      correctionProviderKey, 'gemini-3.5-flash-lite', [turn]);
    assert.equal(response.scenarioState.isComplete, false, label);
    assert.deepEqual(getDisplayableUncommittedJournalGroups(response.scenarioState, 'SFRS_I'), [], label);
  }

  extractedImageResponse = { imageEvidence: [{
    imageIndex: 1, documentType: 'supplier_invoice', confidence: 0.97,
    fields: { documentTitle: 'Supplier Invoice INV-203', invoiceNo: 'INV-203', invoiceDate: '21/01/2025',
      itemDescription: 'Maintenance Expense', subtotal: 500, gst: 45, total: 545, currency: 'SGD' }
  }] };
  proposedInvoice = invoiceProposal(0);
  correctionProviderRequests.length = 0;
  const initialGstInvoice = await processAccountingQuery(
    'Attached invoice INV-203. Please prepare the journal from the screenshot.', null, 'SFRS_I',
    correctionProviderKey, 'gemini-3.5-flash-lite', [{ ...correctionImageTurn, id: 'gst-invoice-image',
      text: 'Attached invoice INV-203. Please prepare the journal from the screenshot.' }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(initialGstInvoice.scenarioState, 'SFRS_I'), [],
    'a GST invoice without supported recovery facts does not create an input-tax journal line');
  assert.equal(initialGstInvoice.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceGstTreatment');
  assert.match(initialGstInvoice.messageText, /shows subtotal SGD 500 \+ GST SGD 45 = total SGD 545/i);
  assert.match(initialGstInvoice.messageText, /does not establish whether the GST is recoverable as input tax/i);
  assert.doesNotMatch(initialGstInvoice.messageText, /provide any missing invoice amount figures/i,
    'a reconciled subtotal, GST, and total do not trigger a false missing-amount request');
  assert.match(initialGstInvoice.messageText, /This journal is withheld; no input-GST asset is recognized from the image alone/i);
  assert.equal(initialGstInvoice.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false,
  'the GST clarification preserves only image-derived invoice values');
  assert.equal(correctionProviderRequests.filter(request =>
    JSON.stringify(request).includes('Extract only visible document evidence')).length, 1,
  'the GST recovery clarification reuses the existing image extraction request');

  const gstTreatmentReply = 'The GST is recoverable.';
  const gstTreatmentFollowUp = await processAccountingQuery(
    gstTreatmentReply, initialGstInvoice.scenarioState, 'SFRS_I', correctionProviderKey,
    'gemini-3.5-flash-lite', [
      { ...correctionImageTurn, id: 'gst-invoice-image', text: 'Attached invoice INV-203. Please prepare the journal from the screenshot.' },
      { id: 'gst-treatment-reply', sender: 'user', timestamp: '', text: gstTreatmentReply }
    ]
  );
  assert.match(gstTreatmentFollowUp.messageText, /image-derived invoice total of SGD 545 remains retained/i,
    'an initial image-derived GST clarification retains its invoice amount through a text-only reply');
  assert.deepEqual(getDisplayableUncommittedJournalGroups(gstTreatmentFollowUp.scenarioState, 'SFRS_I'), [],
    'a GST reply alone still does not create an input-tax journal line');
  assert.equal(gstTreatmentFollowUp.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false,
  'the GST follow-up retains image evidence without fabricating user correction evidence');

  extractedImageResponse = { imageEvidence: [{
    imageIndex: 1, documentType: 'supplier_invoice', confidence: 0.97,
    fields: { documentTitle: 'Supplier Invoice', invoiceDate: '20/01/2025', itemDescription: 'Consulting service',
      total: 500, currency: 'SGD' }
  }] };
  proposedInvoice = invoiceProposal(0);
  const paidUnclassifiedInvoiceText = 'Please prepare the journal for this invoice. It was paid in cash.';
  const paidUnclassifiedInvoice = await processAccountingQuery(
    paidUnclassifiedInvoiceText, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
    [{ ...digitFreeInvoiceTurn, text: paidUnclassifiedInvoiceText }]
  );
  assert.equal(paidUnclassifiedInvoice.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceAccountClassification');
  assert.ok(paidUnclassifiedInvoice.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.imageId === 'image-202' &&
    field.field === 'invoicePaymentStatus' && field.value === 'paid'),
  'an initial payment fact is retained against the same image while the account is clarified');
  assert.equal(paidUnclassifiedInvoice.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false);

  const accountReply = 'Classify this as Maintenance Expense.';
  proposedInvoice = invoiceProposal(0);
  const paidInvoiceAccountFollowUp = await processAccountingQuery(
    accountReply, paidUnclassifiedInvoice.scenarioState, 'SFRS_I', correctionProviderKey,
    'gemini-3.5-flash-lite', [
      { ...digitFreeInvoiceTurn, text: paidUnclassifiedInvoiceText },
      { id: 'invoice-account-reply', sender: 'user', timestamp: '', text: accountReply }
    ]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(paidInvoiceAccountFollowUp.scenarioState, 'SFRS_I'), [],
    'account classification cannot discard the paid fact and recover a Trade Payables journal');
  assert.equal(paidInvoiceAccountFollowUp.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceSettlement');
  assert.match(paidInvoiceAccountFollowUp.messageText, /transaction facts indicate that this invoice was paid/i);
  assert.ok(paidInvoiceAccountFollowUp.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.imageId === 'image-202' &&
    field.field === 'invoicePaymentStatus' && field.value === 'paid'));
  assert.equal(paidInvoiceAccountFollowUp.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal'), false,
  'image-derived clarification continuity does not create corrected-total user evidence');

  const unclassifiedInvoice = await processAccountingQuery(
    digitFreeInvoiceTurn.text, null, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite', [digitFreeInvoiceTurn]
  );
  assert.equal(unclassifiedInvoice.scenarioState.missingFields?.[0]?.fieldKey, 'invoiceAccountClassification');
  assert.equal(unclassifiedInvoice.scenarioState.evidence.some(field => field.field === 'invoicePaymentStatus'), false);

  for (const [accountAndPaymentReply, paymentStatus] of [
    ['Classify this as Maintenance Expense. It was paid in cash.', 'paid'],
    ['Classify this as Maintenance Expense. It was partially paid, SGD 100 in cash.', 'partially_paid']
  ]) {
    const requestCountBeforeReply = correctionProviderRequests.length;
    const { scenarioState: followUp } = await processAccountingQuery(
      accountAndPaymentReply, unclassifiedInvoice.scenarioState, 'SFRS_I', correctionProviderKey, 'gemini-3.5-flash-lite',
      [digitFreeInvoiceTurn, { id: 'invoice-account-and-payment-reply', sender: 'user', timestamp: '', text: accountAndPaymentReply }]
    );
    assert.deepEqual(getDisplayableUncommittedJournalGroups(followUp, 'SFRS_I'), [],
      'payment first stated in the account clarification prevents a Trade Payables proposal');
    assert.equal(followUp.missingFields?.[0]?.fieldKey, 'invoiceSettlement');
    assert.equal(followUp.amount, 500, 'a partial payment does not replace the image-derived invoice total');
    assert.ok(followUp.evidence.some(field =>
      field.source === 'image' && field.imageId === 'image-202' && field.field === 'total' && field.value === 500));
    assert.ok(followUp.evidence.some(field =>
      field.source === 'user_text' && field.imageId === 'image-202' && field.field === 'invoicePaymentStatus' && field.value === paymentStatus));
    assert.equal(correctionProviderRequests.length, requestCountBeforeReply,
      'an invoice clarification uses the existing local understanding with no provider requests');
  }

  extractedImageResponse = correctionVision;

  const retainedInvoiceFactsWithoutJournal = {
    ...initialImageInvoice.scenarioState,
    directGroups: [],
    committedDirectGroups: undefined,
    isComplete: false,
    missingFields: []
  };
  proposedInvoice = invoiceProposal(0);
  const invoiceTextFollowUp = 'Please prepare a double entry for this invoice.';
  const invoiceTextFollowUpResult = await processAccountingQuery(
    invoiceTextFollowUp, retainedInvoiceFactsWithoutJournal, 'SFRS_I', correctionProviderKey,
    'gemini-3.5-flash-lite', [correctionImageTurn, { id: 'invoice-text-follow-up', sender: 'user',
      timestamp: '', text: invoiceTextFollowUp }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(invoiceTextFollowUpResult.scenarioState, 'SFRS_I'), [],
    'retained image evidence without a current image attachment cannot create a fresh invoice journal during a text follow-up');

  extractedImageResponse = correctionVision;
  proposedInvoice = invoiceProposal(500);

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
      assert.equal(correctionProviderRequests.length, 0);
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
  assert.equal(capturedCorrectionGroups[0].title, 'Supplier invoice INV-202 for Maintenance Expense');
  assert.equal(capturedCorrectionGroups[0].authorityStatus, 'CONDITIONAL',
    'the payable proposal is conditional when settlement was not stated');
  assert.equal(capturedCorrectionGroups.length, 1);
  assert.equal(capturedCorrectionGroups[0].eventDate, '20/01/2025',
    'the invoice date is preserved exactly after date validation');
  assert.equal(capturedCorrectionGroups[0].totalDebit, 600);
  assert.equal(capturedCorrectionGroups[0].totalCredit, 600);
  assert.equal(validateJournalGroups(capturedCorrectionGroups).isValid, true);
  assert.equal(capturedCorrection.scenarioState.committedDirectGroups?.length || 0, 0);
  assert.equal(correctionProviderRequests.filter(request => JSON.stringify(request).includes('Extract only visible document evidence')).length, 0,
    'the correction uses retained image evidence without re-extracting the screenshot');
  assert.equal(correctionProviderRequests.length, 0,
    'the grounded invoice description and user-corrected total construct the uncommitted proposal without another model journal attempt');

  const goodsInvoiceState = structuredClone(capturedInvoiceState);
  goodsInvoiceState.imageEvidence[0].fields.find(field => field.field === 'description').value = 'Office equipment';
  goodsInvoiceState.evidence = flattenImageEvidence(goodsInvoiceState.imageEvidence);
  const unsupportedEquipmentCorrection = await processAccountingQuery(
    capturedCorrectionText,
    goodsInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unclassified-equipment-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(unsupportedEquipmentCorrection.scenarioState, 'SFRS_I'), [],
    'a goods description alone cannot be presumed to be a capital asset');
  assert.match(unsupportedEquipmentCorrection.messageText, /corrected invoice total of SGD 600 is retained.*does not establish a consistent expense, inventory, or fixed-asset account/i);

  const assetPurchaseState = structuredClone(goodsInvoiceState);
  assetPurchaseState.imageEvidence[0].fields.push(
    { source: 'image', imageId: 'image-202', field: 'transactionType', value: 'equipment_purchase', confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'assetName', value: 'Office Equipment', confidence: 0.95 }
  );
  assetPurchaseState.evidence = flattenImageEvidence(assetPurchaseState.imageEvidence);
  const equipmentCorrection = await processAccountingQuery(
    capturedCorrectionText,
    assetPurchaseState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unclassified-goods-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const equipmentGroups = getDisplayableUncommittedJournalGroups(equipmentCorrection.scenarioState, 'SFRS_I');
  assert.equal(equipmentGroups.length, 1);
  assert.deepEqual(equipmentGroups[0].lines.map(line => [line.category, line.debit, line.credit]), [
    ['ASSET', 600, 0], ['LIABILITY', 0, 600]
  ]);
  assert.equal(equipmentGroups[0].authorityStatus, 'CONDITIONAL',
    'the equipment proposal requires review of capitalisation policy');

  const inventoryPurchaseState = structuredClone(goodsInvoiceState);
  inventoryPurchaseState.imageEvidence[0].fields.push(
    { source: 'image', imageId: 'image-202', field: 'transactionType', value: 'inventory_purchase', confidence: 0.95 },
    { source: 'image', imageId: 'image-202', field: 'assetName', value: 'Inventory', confidence: 0.95 }
  );
  inventoryPurchaseState.evidence = flattenImageEvidence(inventoryPurchaseState.imageEvidence);
  const inventoryPurchaseCorrection = await processAccountingQuery(
    capturedCorrectionText,
    inventoryPurchaseState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'inventory-purchase-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const inventoryPurchaseGroups = getDisplayableUncommittedJournalGroups(inventoryPurchaseCorrection.scenarioState, 'SFRS_I');
  assert.equal(inventoryPurchaseGroups.length, 1, 'an explicit inventory purchase type and asset identity permit the supported inventory path');
  assert.deepEqual(inventoryPurchaseGroups[0].lines.map(line => [line.accountName, line.category, line.debit, line.credit]), [
    ['Inventory', 'ASSET', 600, 0], ['Trade Payables', 'LIABILITY', 0, 600]
  ]);

  for (const serviceDescription of ['Equipment Maintenance', 'Computer Repair', 'Machinery Rental']) {
    const serviceInvoiceState = structuredClone(capturedInvoiceState);
    serviceInvoiceState.imageEvidence[0].fields.find(field => field.field === 'description').value = serviceDescription;
    serviceInvoiceState.evidence = flattenImageEvidence(serviceInvoiceState.imageEvidence);
    const serviceCorrection = await processAccountingQuery(
      capturedCorrectionText,
      serviceInvoiceState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `service-invoice-${serviceDescription}`, sender: 'user', timestamp: '', text: capturedCorrectionText }]
    );
    assert.deepEqual(getDisplayableUncommittedJournalGroups(serviceCorrection.scenarioState, 'SFRS_I'), [],
      `${serviceDescription} must not be classified as PPE from a keyword alone`);
    assert.equal(serviceCorrection.scenarioState.amount, 600);
    assert.equal(serviceCorrection.scenarioState.missingFields[0].fieldKey, 'invoiceAccountClassification');
  }
  const serviceAccountState = structuredClone(capturedInvoiceState);
  serviceAccountState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'accountName', value: 'Computer Repair', confidence: 0.95
  });
  serviceAccountState.evidence = flattenImageEvidence(serviceAccountState.imageEvidence);
  const serviceAccountCorrection = await processAccountingQuery(
    capturedCorrectionText,
    serviceAccountState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'service-account-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(serviceAccountCorrection.scenarioState, 'SFRS_I'), [],
    'a computer-repair account label cannot be capitalized because it contains a computer keyword');

  const ambiguousGoodsState = structuredClone(goodsInvoiceState);
  ambiguousGoodsState.imageEvidence[0].fields.find(field => field.field === 'description').value = 'Office items';
  ambiguousGoodsState.evidence = flattenImageEvidence(ambiguousGoodsState.imageEvidence);
  const unclassifiedGoodsCorrection = await processAccountingQuery(
    capturedCorrectionText,
    ambiguousGoodsState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unclassified-goods-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(unclassifiedGoodsCorrection.scenarioState, 'SFRS_I'), []);
  assert.match(unclassifiedGoodsCorrection.messageText, /corrected invoice total of SGD 600 is retained.*does not establish a consistent expense, inventory, or fixed-asset account/i);
  assert.equal(unclassifiedGoodsCorrection.scenarioState.amount, 600);
  assert.ok(unclassifiedGoodsCorrection.scenarioState.evidence.some(field => field.source === 'user_text' && field.value === 600));
  assert.equal(unclassifiedGoodsCorrection.scenarioState.imageEvidence[0].fields.find(field => field.field === 'totalAmount').value, 500);
  assert.equal(unclassifiedGoodsCorrection.scenarioState.missingFields[0].fieldKey, 'invoiceAccountClassification');

  correctionProviderRequests.length = 0;
  const accountClassificationText = 'Classify this as fixed asset: Office Equipment.';
  const classifiedGoodsCorrection = await processAccountingQuery(
    accountClassificationText,
    unclassifiedGoodsCorrection.scenarioState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn,
      { id: 'unclassified-goods-correction', sender: 'user', timestamp: '', text: capturedCorrectionText },
      { id: 'account-classification-followup', sender: 'user', timestamp: '', text: accountClassificationText }]
  );
  const classifiedGoodsGroups = getDisplayableUncommittedJournalGroups(classifiedGoodsCorrection.scenarioState, 'SFRS_I');
  assert.equal(classifiedGoodsGroups.length, 1, 'a definite classification reply resumes the same invoice correction');
  assert.deepEqual(classifiedGoodsGroups[0].lines.map(line => [line.accountName, line.category, line.debit, line.credit]), [
    ['Office Equipment', 'ASSET', 600, 0], ['Trade Payables', 'LIABILITY', 0, 600]
  ]);
  assert.equal(classifiedGoodsGroups[0].eventDate, '20/01/2025');
  assert.equal(classifiedGoodsCorrection.scenarioState.imageEvidence[0].fields.find(field => field.field === 'totalAmount').value, 500,
    'the classification reply remains separate from the original S$500 image amount');
  assert.ok(classifiedGoodsCorrection.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'invoiceAccountName' && field.value === 'Office Equipment'));
  assert.ok(classifiedGoodsCorrection.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'invoiceAccountCategory' && field.value === 'ASSET'));
  assert.equal(classifiedGoodsCorrection.scenarioState.amount, 600);
  assert.equal(correctionProviderRequests.length, 0, 'the retained amount and explicit classification bind without another Gemini request');

  correctionProviderRequests.length = 0;
  const restatedAccountTotalText = 'S$600 is not correct, please use S$650';
  const restatedAccountCorrection = await processAccountingQuery(
    restatedAccountTotalText,
    unclassifiedGoodsCorrection.scenarioState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn,
      { id: 'unclassified-goods-correction', sender: 'user', timestamp: '', text: capturedCorrectionText },
      { id: 'restated-account-total', sender: 'user', timestamp: '', text: restatedAccountTotalText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(restatedAccountCorrection.scenarioState, 'SFRS_I'), []);
  assert.equal(restatedAccountCorrection.scenarioState.amount, 650,
    'an explicit replacement can update the retained total after the account clarification');
  assert.equal(restatedAccountCorrection.scenarioState.missingFields[0].fieldKey, 'invoiceAccountClassification');
  assert.equal(correctionProviderRequests.length, 0);

  const gstInvoiceState = structuredClone(capturedInvoiceState);
  gstInvoiceState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'gst', value: 54, confidence: 0.95
  });
  gstInvoiceState.evidence = flattenImageEvidence(gstInvoiceState.imageEvidence);
  const unassessedGstCorrection = await processAccountingQuery(
    capturedCorrectionText,
    gstInvoiceState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'unassessed-gst-correction', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(unassessedGstCorrection.scenarioState, 'SFRS_I'), []);
  assert.match(unassessedGstCorrection.messageText, /corrected invoice total of SGD 600 is retained.*cannot safely construct a GST split/i);
  assert.equal(unassessedGstCorrection.scenarioState.amount, 600);
  assert.ok(unassessedGstCorrection.scenarioState.evidence.some(field => field.source === 'user_text' && field.value === 600));
  assert.equal(unassessedGstCorrection.scenarioState.missingFields[0].fieldKey, 'invoiceGstTreatment');

  correctionProviderRequests.length = 0;
  const unverifiedGstReplyText = 'Recoverable GST is SGD 54.';
  const unverifiedGstReply = await processAccountingQuery(
    unverifiedGstReplyText,
    unassessedGstCorrection.scenarioState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn,
      { id: 'unassessed-gst-correction', sender: 'user', timestamp: '', text: capturedCorrectionText },
      { id: 'unverified-gst-reply', sender: 'user', timestamp: '', text: unverifiedGstReplyText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(unverifiedGstReply.scenarioState, 'SFRS_I'), [],
    'a GST recovery statement cannot authorize a split journal in this flow');
  assert.equal(unverifiedGstReply.scenarioState.amount, 600);
  assert.ok(unverifiedGstReply.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'unverifiedGstRecoveryStatement' && field.value === 54));
  assert.match(unverifiedGstReply.messageText, /cannot use a GST recovery statement alone.*no journal is shown/i);
  assert.equal(correctionProviderRequests.length, 0, 'GST treatment stays on the guarded invoice path without a model journal call');

  correctionProviderRequests.length = 0;
  const restatedTotalText = 'The invoice total is SGD 650.';
  const restatedGstCorrection = await processAccountingQuery(
    restatedTotalText,
    unassessedGstCorrection.scenarioState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn,
      { id: 'unassessed-gst-correction', sender: 'user', timestamp: '', text: capturedCorrectionText },
      { id: 'restated-total-after-gst-clarification', sender: 'user', timestamp: '', text: restatedTotalText }]
  );
  assert.deepEqual(getDisplayableUncommittedJournalGroups(restatedGstCorrection.scenarioState, 'SFRS_I'), []);
  assert.equal(restatedGstCorrection.scenarioState.amount, 650,
    'a restated total remains routable after the GST clarification state');
  assert.ok(restatedGstCorrection.scenarioState.evidence.some(field =>
    field.source === 'user_text' && field.field === 'correctedInvoiceTotal' && field.value === 650));
  assert.equal(restatedGstCorrection.scenarioState.missingFields[0].fieldKey, 'invoiceGstTreatment');
  assert.equal(correctionProviderRequests.length, 0);

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
  negatedSupplierHeadingState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Not a Supplier Invoice';
  negatedSupplierHeadingState.evidence = flattenImageEvidence(negatedSupplierHeadingState.imageEvidence);
  correctionProviderRequests.length = 0;
  for (const confirmationText of [
    capturedCorrectionText,
    'This is a supplier purchase invoice. The invoice total is SGD 600.'
  ]) {
    correctionProviderRequests.length = 0;
    const negatedSupplierHeading = await processAccountingQuery(
      confirmationText,
      negatedSupplierHeadingState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `negated-supplier-invoice-heading-${confirmationText.length}`, sender: 'user', timestamp: '', text: confirmationText }]
    );
    assert.match(negatedSupplierHeading.messageText, /does not establish whether it is a supplier purchase invoice, customer sales invoice, or credit note/i,
      'a negated supplier invoice title cannot authorize a correction even after user confirmation');
    assert.deepEqual(negatedSupplierHeading.scenarioState.directGroups, []);
    assert.equal(correctionProviderRequests.length, 0, 'a negated supplier heading is clarified before Gemini');
  }

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
  assert.equal(correctionProviderRequests.length, 0);

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
  assert.equal(correctionProviderRequests.length, 0);

  const numberedHeadingState = structuredClone(noNumberInvoiceState);
  numberedHeadingState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = 'Supplier Invoice No. INV-202';
  numberedHeadingState.imageEvidence[0].fields.push({
    source: 'image', imageId: 'image-202', field: 'invoiceType', value: 'Supplier Invoice No. INV-202', confidence: 0.95
  });
  numberedHeadingState.evidence = flattenImageEvidence(numberedHeadingState.imageEvidence);
  for (const [id, text] of [
    ['numbered-invoice-total-only', 'The invoice total is SGD 600.'],
    ['confirmed-numbered-invoice', 'This is a supplier purchase invoice. The invoice total is SGD 600.']
  ]) {
    correctionProviderRequests.length = 0;
    const numberedHeadingCorrection = await processAccountingQuery(
      text,
      numberedHeadingState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id, sender: 'user', timestamp: '', text }]
    );
    const numberedHeadingGroups = getDisplayableUncommittedJournalGroups(numberedHeadingCorrection.scenarioState, 'SFRS_I');
    assert.equal(numberedHeadingCorrection.scenarioState.amount, 600,
      'No. in a supplier invoice heading is interpreted as its number, not as negation');
    assert.equal(numberedHeadingGroups.length, 1);
    assert.equal(numberedHeadingGroups[0].totalDebit, 600);
    assert.equal(numberedHeadingGroups[0].totalCredit, 600);
    assert.equal(validateJournalGroups(numberedHeadingGroups).isValid, true);
    assert.equal(correctionProviderRequests.length, 0);
  }

  for (const { title, invoiceNumber } of [
    { title: 'Supplier Invoice Summary' },
    { title: 'Supplier Invoice Statement' },
    { title: 'Invoice Register' },
    { title: 'Supplier Invoice Payment Summary', invoiceNumber: 'INV-202' }
  ]) {
    const invoiceAggregateState = structuredClone(noNumberInvoiceState);
    invoiceAggregateState.imageEvidence[0].fields.find(field => field.field === 'documentTitle').value = title;
    if (invoiceNumber) {
      invoiceAggregateState.imageEvidence[0].fields.push({
        source: 'image', imageId: 'image-202', field: 'invoiceNumber', value: invoiceNumber, confidence: 0.95
      });
    }
    invoiceAggregateState.evidence = flattenImageEvidence(invoiceAggregateState.imageEvidence);
    correctionProviderRequests.length = 0;
    const confirmedInvoiceAggregate = await processAccountingQuery(
      'This is a supplier purchase invoice. The invoice total is SGD 600.',
      invoiceAggregateState,
      'SFRS_I',
      correctionProviderKey,
      'gemini-3.5-flash-lite',
      [correctionImageTurn, { id: `confirmed-${title.toLowerCase().replace(/\s+/g, '-')}`, sender: 'user', timestamp: '', text: 'This is a supplier purchase invoice. The invoice total is SGD 600.' }]
    );
    assert.deepEqual(getDisplayableUncommittedJournalGroups(confirmedInvoiceAggregate.scenarioState, 'SFRS_I'), [],
      `${title} is not eligible for an individual invoice correction journal`);
    assert.doesNotMatch(confirmedInvoiceAggregate.messageText, /Corrected invoice journal proposal/i);
    assert.match(confirmedInvoiceAggregate.messageText, /upload the individual supplier invoice/i);
    assert.equal(correctionProviderRequests.length, 0,
      `${title} is rejected before invoice journal generation`);
  }

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
  assert.match(fullPayableGroups[0].lines.find(line => /payable/i.test(line.accountName)).lineExplanation,
    /screenshot shows the full corrected amount remains payable/i,
    'the payable explanation reflects the explicit full-payable image facts');

  correctionProviderRequests.length = 0;
  const incorrectBankCredit = await processAccountingQuery(
    capturedCorrectionText,
    fullPayableState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'reject-bank-credit-for-full-payable', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const incorrectBankCreditGroups = getDisplayableUncommittedJournalGroups(incorrectBankCredit.scenarioState, 'SFRS_I');
  assert.equal(incorrectBankCreditGroups.length, 1);
  assert.ok(incorrectBankCreditGroups[0].lines.some(line => /payable/i.test(line.accountName) && line.credit === 600));
  assert.equal(correctionProviderRequests.length, 0, 'the accounting service builds the payable from the extracted settlement facts');

  correctionProviderRequests.length = 0;
  const splitLiabilityCredit = await processAccountingQuery(
    capturedCorrectionText,
    fullPayableState,
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'reject-other-liability-split', sender: 'user', timestamp: '', text: capturedCorrectionText }]
  );
  const splitLiabilityGroups = getDisplayableUncommittedJournalGroups(splitLiabilityCredit.scenarioState, 'SFRS_I');
  assert.equal(splitLiabilityGroups.length, 1);
  assert.deepEqual(splitLiabilityGroups[0].lines.map(line => [line.accountName, line.debit, line.credit]), [
    ['Maintenance Expense', 600, 0], ['Trade Payables', 0, 600]
  ]);
  assert.equal(correctionProviderRequests.length, 0,
    'the accounting service does not accept model-generated account splits for a corrected invoice');
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
  assert.equal(getDisplayableUncommittedJournalGroups(mismatchedResult.scenarioState, 'SFRS_I')[0].totalDebit, 600,
    'the model journal amount cannot override the user correction');
  assert.equal(correctionProviderRequests.length, 0);
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
  assert.equal(getDisplayableUncommittedJournalGroups(dateMismatch.scenarioState, 'SFRS_I')[0].eventDate, '20/01/2025',
    'the model journal date cannot override the invoice date evidence');

  proposedInvoice = invoiceProposal(600, '20/01/2025', 'USD');
  const foreignCurrency = await processAccountingQuery(
    mismatchedCorrection,
    structuredClone(initialCorrectionState.scenarioState),
    'SFRS_I',
    correctionProviderKey,
    'gemini-3.5-flash-lite',
    [correctionImageTurn, { id: 'foreign-currency', sender: 'user', timestamp: '', text: mismatchedCorrection }]
  );
  assert.equal(getDisplayableUncommittedJournalGroups(foreignCurrency.scenarioState, 'SFRS_I')[0].lines.every(line => !line.foreignCurrency), true,
    'the model cannot introduce a foreign currency that conflicts with the invoice evidence');

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
