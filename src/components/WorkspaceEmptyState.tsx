import React from 'react';
import { BookOpen, FileText, Landmark, ListChecks } from 'lucide-react';

const emptyStateSections = [
  {
    icon: ListChecks,
    title: 'Key parameters',
    description: 'Review the facts identified from your question.'
  },
  {
    icon: BookOpen,
    title: 'Double Entry Journal',
    description: 'See the debit and credit entries for your transaction.'
  },
  {
    icon: Landmark,
    title: 'Statutory Citations & Directives',
    description: 'Explore the standards and statutory sources supporting the response.'
  }
];

export const WorkspaceEmptyState: React.FC = () => (
  <section className="flex h-full flex-col rounded-xl border border-workspace-border bg-workspace-panel px-5 py-7 dark:border-workspace-border sm:px-8 sm:py-8 lg:px-12 lg:py-10">
    <div className="pt-5 sm:pt-8 lg:pt-12">
      <FileText aria-hidden="true" className="mb-5 h-12 w-12 text-workspace-secondary" />
      <h2 className="text-xl font-semibold tracking-tight text-workspace-text sm:text-2xl">
        Your accounting analysis starts here
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-workspace-muted sm:text-base">
        Describe a transaction in the chat to see its journal entries, key parameters, and supporting guidance.
      </p>

      <div className="mt-8">
        {emptyStateSections.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex gap-4 border-t border-workspace-border py-4 dark:border-workspace-border sm:gap-5 sm:py-5">
            <Icon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-workspace-secondary" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-workspace-text">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-workspace-muted">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <p className="mt-auto pt-8 text-center text-xs text-workspace-muted">
      Results appear here after you submit a question.
    </p>
  </section>
);