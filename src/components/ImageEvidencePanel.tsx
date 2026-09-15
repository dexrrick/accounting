import React from 'react';
import type { ExtractedImageEvidence } from '../types/accounting';

export const ImageEvidencePanel: React.FC<{ evidence: ExtractedImageEvidence[] }> = ({ evidence }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#2B374E] dark:bg-[#1C2538]">
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-white">Evidence detected from screenshot</h3>
    <div className="mt-3 space-y-3">
      {evidence.map((image, imageIndex) => (
        <div key={image.imageId} className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#151D2C]">
          <div className="font-semibold text-slate-800 dark:text-slate-200">Image {imageIndex + 1}{image.documentType ? ` · ${image.documentType.replace(/_/g, ' ')}` : ''}</div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {image.fields.map((field) => (
              <div key={`${field.field}-${String(field.value)}`} className="flex justify-between gap-3 text-slate-600 dark:text-slate-300">
                <dt className="capitalize">{field.field.replace(/([A-Z])/g, ' $1')}</dt>
                <dd className="text-right font-medium">{String(field.value)}{field.confidence !== undefined && field.confidence < 0.9 ? ' (verify)' : ''}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  </section>
);
