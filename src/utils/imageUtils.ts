import type { ChatImageAttachment, SupportedImageMimeType } from '../types/accounting';

export const ACCEPTED_IMAGE_TYPES: readonly SupportedImageMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2400;

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as SupportedImageMimeType)) {
    return 'This image type is not supported. Use PNG, JPEG or WEBP.';
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return 'This image is too large. Maximum size is 10 MB.';
  }
  return null;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function extractBase64Data(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Unable to decode the image.'));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });
}

/** Resizes only when needed, preserving PNG/WebP where browser support permits. */
export async function createImageAttachment(file: File, id: string): Promise<ChatImageAttachment> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const originalDataUrl = await fileToDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestSide <= MAX_IMAGE_DIMENSION) {
    return { id, fileName: file.name || 'pasted-image', mimeType: file.type as SupportedImageMimeType, dataUrl: originalDataUrl, size: file.size, width: image.naturalWidth, height: image.naturalHeight };
  }

  const scale = MAX_IMAGE_DIMENSION / longestSide;
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to resize the image.');
  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type as SupportedImageMimeType;
  const dataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
  const resizedSize = Math.ceil((extractBase64Data(dataUrl).length * 3) / 4);
  return { id, fileName: file.name || 'pasted-image', mimeType, dataUrl, size: resizedSize, width, height };
}
