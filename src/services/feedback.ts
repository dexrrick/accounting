import type { AccountingScenarioState, ChatMessage } from '../types/accounting';
import type { ProviderSettings } from '../types/provider';
import type { OutputPreference } from './geminiService';
import { appBuildInfo } from '../buildInfo';

export interface FeedbackReport {
  description: string;
  contactEmail?: string;
  createdAt: string;
  pageUrl: string;
  userAgent: string;
  app: { version: string; gitCommit: string; buildTime: string; theme: 'light' | 'dark'; fontSize: string; activeProvider: string; model: string; shareStructureEnabled: boolean };
  conversation: Array<{ sender: string; timestamp: string; text: string }>;
  attachments: { imagesAttached: number; imageTypes: string[] };
  scenario?: Record<string, unknown>;
  telemetry?: unknown;
}

const redactScenario = (scenario: AccountingScenarioState | null): Record<string, unknown> | undefined => {
  if (!scenario) return undefined;
  return {
    scenarioType: scenario.scenarioType,
    transactionTitle: scenario.transactionTitle,
    functionalCurrency: scenario.functionalCurrency,
    transactionCurrency: scenario.transactionCurrency,
    queryIntent: scenario.queryIntent,
    primaryDomain: scenario.primaryDomain,
    missingFacts: scenario.missingFacts,
    assumptions: scenario.assumptions,
    directGroups: scenario.directGroups?.map(({ title, eventDate, totalDebit, totalCredit, isBalanced }) => ({
      title, eventDate, totalDebit, totalCredit, isBalanced
    })),
    statutoryAdvisory: scenario.statutoryAdvisory?.map(({ authority, statuteOrAct, sectionOrSchedule, topic }) => ({
      authority, statuteOrAct, sectionOrSchedule, topic
    })),
    shareTransferAnalysis: scenario.shareTransferAnalysis
  };
};

export const compileFeedbackReport = (input: {
  description: string;
  contactEmail?: string;
  messages: ChatMessage[];
  scenario: AccountingScenarioState | null;
  providerSettings: ProviderSettings;
  theme: 'light' | 'dark';
  fontSize: string;
  outputPreference: OutputPreference;
}): FeedbackReport => {
  const active = input.providerSettings.activeProvider;
  const model = active === 'offline'
    ? 'offline rules engine'
    : active === 'azure'
      ? input.providerSettings.azure.deploymentName
      : input.providerSettings[active].model;
  return {
    description: input.description.trim(),
    contactEmail: input.contactEmail?.trim() || undefined,
    createdAt: new Date().toISOString(),
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
    // Provider names/models are useful for diagnosis. API keys are deliberately never included.
    app: { version: appBuildInfo.version, gitCommit: appBuildInfo.gitCommit, buildTime: appBuildInfo.buildTime, theme: input.theme, fontSize: input.fontSize, activeProvider: active, model, shareStructureEnabled: Boolean(input.outputPreference.shareStructure) },
    conversation: input.messages.slice(-12).map(({ sender, timestamp, text, fullText }) => ({
      sender,
      timestamp,
      text: fullText || text
    })),
    attachments: {
      imagesAttached: input.messages.reduce((count, message) => count + (message.images?.length || 0), 0),
      imageTypes: [...new Set(input.messages.flatMap((message) => message.images?.map((image) => image.mimeType) || []))]
    },
    scenario: redactScenario(input.scenario),
    telemetry: (window as Window & { __LAST_REQUEST_TELEMETRY__?: unknown }).__LAST_REQUEST_TELEMETRY__
  };
};

export const submitFeedbackReport = async (report: FeedbackReport): Promise<void> => {
  const endpoint = import.meta.env.VITE_FEEDBACK_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error('Feedback delivery has not been configured yet. Set VITE_FEEDBACK_ENDPOINT to your secure feedback endpoint.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // `email` enables Formspree's Reply-To handling; generic endpoints can ignore it.
    body: JSON.stringify({ ...report, email: report.contactEmail })
  });
  if (!response.ok) throw new Error(`Feedback could not be sent (${response.status}). Please try again later.`);
};
