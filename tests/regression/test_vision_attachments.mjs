import assert from 'node:assert/strict';
import { ACCEPTED_IMAGE_TYPES, extractBase64Data, MAX_IMAGE_FILE_SIZE, validateImageFile } from '../../src/utils/imageUtils.ts';
import { createGeminiImageParts, extractImageEvidenceWithGemini, flattenImageEvidence, getMaterialImageUncertainties, supportsGeminiVision } from '../../src/services/geminiService.ts';
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

console.log('✓ MIME validation and base64 extraction passed.');
