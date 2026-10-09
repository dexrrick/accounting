import React from 'react';
import { X } from 'lucide-react';
import type { ChatImageAttachment } from '../types/accounting';

interface ImageAttachmentPreviewProps {
  attachments: ChatImageAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

const formatSize = (size: number) => `${(size / 1024 / 1024).toFixed(size >= 1024 * 1024 ? 1 : 2)} MB`;

export const ImageAttachmentPreview: React.FC<ImageAttachmentPreviewProps> = ({ attachments, onRemove, disabled }) => (
  <div className="mb-2 flex flex-wrap gap-2" aria-label="Attached images">
    {attachments.map((attachment) => (
      <div key={attachment.id} className="relative flex w-32 gap-2 rounded-lg border border-workspace-border bg-workspace-raised p-1.5 dark:border-workspace-border dark:bg-workspace-panel">
        <img src={attachment.dataUrl} alt={attachment.fileName} className="h-12 w-12 rounded object-cover" />
        <div className="min-w-0 pr-3 text-[10px] leading-tight text-slate-600 dark:text-workspace-secondary">
          <div className="truncate font-medium">{attachment.fileName}</div>
          <div>{formatSize(attachment.size)}</div>
        </div>
        <button type="button" disabled={disabled} onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.fileName}`} className="absolute right-1 top-1 rounded p-0.5 text-workspace-muted hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed dark:hover:bg-workspace-hover dark:hover:text-white">
          <X className="h-3 w-3" />
        </button>
      </div>
    ))}
  </div>
);
