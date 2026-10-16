import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { getAllAuthoritativeSources } from '../standards/unifiedSourceModel';
import { defaultControlledWebRetriever, type ControlledWebRetriever } from './controlledWebRetriever';
import {
  MASDocumentUpdateAdapter,
  type MasDocumentDiscoveryDiagnostic
} from './masDocumentUpdateAdapter';
import type { RegulatoryUpdatePackage } from './liveRegulatoryFeed';
import { MAS_LICENSING_COMPARISON_PROFILE_VERSION } from '../standards/masLicensingComparisonPolicy';

/**
 * These are the only MAS documents exposed by the manual browser review flow.
 * Keep this list out of the default scheduled and automatic feed adapters.
 */
export const MANUAL_MAS_REVIEW_DOCUMENTS = Object.freeze([
  {
    recordId: 'MAS_FUND_MANAGEMENT_LICENSING_SUBSECTION_RECHECK',
    comparisonProfile: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
    extractionRequest: {
      url: 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing',
      authority: 'MAS',
      domain: 'MAS_FUNDS',
      standardOrActCode: 'MAS-FUND-MANAGEMENT-LICENSING',
      topicIds: ['mas-fund-management-licensing-admission-criteria'],
      legalOrStandardInstrument: 'MAS Fund Management Licensing Guidance',
      documentKind: 'HTML',
      sectionHeading: 'What are the admission criteria and applicable requirements?',
      expectedTopic: {
        standardIdentifiers: ['Securities and Futures Act'],
        expectedTitles: ['Fund Management Licensing'],
        topicTerms: ['fund management', 'licence']
      }
    },
    amendmentTitle: 'Fund Management Licensing admission criteria'
  },
  {
    recordId: 'MAS_IID_04_2025_SUBSECTION_RECHECK',
    extractionRequest: {
      url: 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/circulars/cmi/iid-04-2025-governance-and-management-of-vcc/iid-04-2025-governance-and-management-of-variable-capital-companies-vccs.pdf',
      authority: 'MAS',
      domain: 'MAS_FUNDS',
      standardOrActCode: 'MAS-IID-04-2025',
      topicIds: ['mas-vcc-substantive-fund-management-activity'],
      legalOrStandardInstrument: 'MAS Circular IID 04/2025',
      documentKind: 'PDF',
      sectionHeading: 'Substantive Fund Management Activity',
      sectionEndHeading: 'Anti-Money Laundering and Countering the Financing of Terrorism (AML/CFT)',
      expectedTopic: {
        standardIdentifiers: ['IID 04/2025'],
        expectedTitles: ['GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES'],
        topicTerms: ['VCC', 'fund management']
      }
    },
    amendmentTitle: 'IID 04/2025 substantive fund management activity'
  }
] satisfies readonly {
  recordId: string;
  comparisonProfile?: typeof MAS_LICENSING_COMPARISON_PROFILE_VERSION;
  extractionRequest: {
    url: string;
    authority: 'MAS';
    domain: 'MAS_FUNDS';
    standardOrActCode: string;
    topicIds: string[];
    legalOrStandardInstrument: string;
    documentKind: 'HTML' | 'PDF';
    sectionHeading: string;
    sectionEndHeading?: string;
    expectedTopic: {
      standardIdentifiers: string[];
      expectedTitles: string[];
      topicTerms: string[];
    };
  };
  amendmentTitle: string;
}[]);

const manualMasAdapter = new MASDocumentUpdateAdapter(MANUAL_MAS_REVIEW_DOCUMENTS);

export interface ManualMasDiscoverySnapshot {
  status: 'NOT_CHECKED' | 'CANDIDATE' | 'NO_CHANGES' | 'BLOCKED';
  checkedAt?: string;
  package: RegulatoryUpdatePackage | null;
  documents: MasDocumentDiscoveryDiagnostic[];
  message?: string;
}

let lastManualDiscovery: ManualMasDiscoverySnapshot = {
  status: 'NOT_CHECKED',
  package: null,
  documents: []
};
const manualPackageIds = new Set<string>();

/** Runs only when requested from the manual MAS review panel. */
export async function discoverManualMasDocuments(
  retriever: ControlledWebRetriever = defaultControlledWebRetriever,
  currentSources: AuthoritativeSourceRecord[] = getAllAuthoritativeSources()
): Promise<ManualMasDiscoverySnapshot> {
  const checkedAt = new Date().toISOString();
  const result = await manualMasAdapter.checkForUpdatesWithDiagnostics(retriever, currentSources);
  if (result.updatePackage) manualPackageIds.add(result.updatePackage.packageId);
  const blockedDocument = result.documents.find(document =>
    document.fetchStatus !== 'SUCCESS' || document.extractionStatus === 'FAILED' || document.extractionStatus === 'REJECTED'
  );
  lastManualDiscovery = result.updatePackage
    ? {
        status: 'CANDIDATE', checkedAt, package: result.updatePackage, documents: result.documents,
        message: `${result.updatePackage.updates.length} changed exact document provision(s) are ready for manual review.`
      }
    : blockedDocument
      ? {
          status: 'BLOCKED', checkedAt, package: null, documents: result.documents,
          message: `${blockedDocument.recordId} could not be admitted for review: ${blockedDocument.extractionReason || blockedDocument.fetchStatus}.`
        }
      : {
          status: 'NO_CHANGES', checkedAt, package: null, documents: result.documents,
          message: 'Both requested official documents were retrieved and extracted exactly; no changed provision needs review.'
        };
  return getLastManualMasDiscovery();
}

/** Keeps a discovered candidate recoverable when the registry modal is reopened. */
export function getLastManualMasDiscovery(): ManualMasDiscoverySnapshot {
  return structuredClone(lastManualDiscovery);
}

export function getManualMasPackageIds(): string[] {
  return [...manualPackageIds];
}

export function clearManualMasDiscoveryPackage(packageId: string): void {
  if (lastManualDiscovery.package?.packageId !== packageId) return;
  lastManualDiscovery = {
    ...lastManualDiscovery,
    package: null,
    status: 'NO_CHANGES',
    message: 'The discovered candidate has been resolved in the review workflow.'
  };
}
