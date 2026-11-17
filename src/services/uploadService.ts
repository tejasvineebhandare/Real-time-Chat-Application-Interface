import type { Attachment } from '../types/chat';
import { authService } from './authService';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
]);

export function validateFileBeforeUpload(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `"${file.name}" exceeds the 10 MB upload limit.`;
  }
  if (file.type && !ALLOWED_FILE_TYPES.has(file.type)) {
    return `"${file.name}" has an unsupported file type (${file.type}). Allowed: images, PDF, TXT, CSV, Office docs, and ZIP.`;
  }
  return null;
}

export function uploadAttachment(
  file: File,
  onProgress: (percent: number) => void
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const validationError = validateFileBeforeUpload(file);
    if (validationError) {
      reject(new Error(validationError));
      return;
    }

    const token = authService.getToken();
    if (!token) {
      reject(new Error('Authentication required before uploading files.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', '/api/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && parsed.attachment) {
          onProgress(100);
          resolve(parsed.attachment as Attachment);
        } else {
          reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error('Unexpected server response during file upload.'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading file.'));
    };

    xhr.send(formData);
  });
}
