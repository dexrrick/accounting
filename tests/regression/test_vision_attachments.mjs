import assert from 'node:assert/strict';
import { ACCEPTED_IMAGE_TYPES, extractBase64Data, MAX_IMAGE_FILE_SIZE, validateImageFile } from '../../src/utils/imageUtils.ts';
import { createGeminiImageParts, flattenImageEvidence, getMaterialImageUncertainties, supportsGeminiVision } from '../../src/services/geminiService.ts';

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

console.log('✓ MIME validation and base64 extraction passed.');
