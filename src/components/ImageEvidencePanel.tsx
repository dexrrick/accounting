import React from 'react';
import { AlertTriangle, ScanText } from 'lucide-react';
import type { ExtractedImageEvidence } from '../types/accounting';

export const ImageEvidencePanel: React.FC<{ evidence: ExtractedImageEvidence[] }> = ({ evidence }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#2B374E] dark:bg-[#1C2538]">
    <div className="flex items-center gap-2">
      <ScanText className="h-4 w-4 text-ynab-blue" />
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-white">Evidence detected from screenshot</h3>
    </div>
    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Visible information extracted from the image. It is separate from the accounting treatment below.</p>
    <div className="mt-3 space-y-3">
      {evidence.map((image, imageIndex) => (
        <div key={image.imageId} className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#151D2C]">
          <div className="font-semibold text-slate-800 dark:text-slate-200">Image {imageIndex + 1}</div>
          {image.documentType && <div className="mt-1 text-slate-600 dark:text-slate-300"><span className="font-medium">Document</span> · {image.documentType.replace(/_/g, ' ')}</div>}
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {image.fields.map((field) => (
              <div key={`${field.field}-${String(field.value)}`} className="flex justify-between gap-3 text-slate-600 dark:text-slate-300">
                <dt className="capitalize">{field.field.replace(/([A-Z])/g, ' $1')}</dt>
                <dd className="flex items-center justify-end gap-1 text-right font-medium">{String(field.value)}{field.confidence !== undefined && field.confidence < 0.9 && <><AlertTriangle className="h-3 w-3 text-ynab-amber" aria-hidden="true" /><span className="text-ynab-amber">Verify</span></>}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  </section>
);
