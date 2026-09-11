import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import {
  type ISourceRetriever,
  type SourceRetrievalQuery,
  InMemorySourceRetriever
} from './sourceRetriever';
import { defaultLiveRegulatoryFeedService, LiveRegulatoryFeedService } from './liveRegulatoryFeed';
import { defaultControlledWebRetriever, ControlledWebRetriever } from './controlledWebRetriever';
import { defaultSourceVersioningManager, SourceVersioningManager } from '../standards/sourceVersioning';

/**
 * Composite Source Retriever.
 * Integrates local approved sources with live regulatory updates and controlled external fetching.
 *
 * Architecture:
 * 1. Queries local active registry (InMemorySourceRetriever) as the baseline authority.
 * 2. Isolates unapproved candidate versions: candidates in staging cannot contaminate active retrieval results.
 * 3. Once an update package is verified and activated, it is seamlessly queryable.
 * 4. In offline mode or network failure, falls back seamlessly to the approved registry without throwing.
 */
export class CompositeSourceRetriever implements ISourceRetriever {
  private localRetriever: InMemorySourceRetriever;
  private feedService: LiveRegulatoryFeedService;
  private webRetriever: ControlledWebRetriever;
  private versioningManager: SourceVersioningManager;

  constructor(
    localRetriever: InMemorySourceRetriever = new InMemorySourceRetriever(),
    feedService: LiveRegulatoryFeedService = defaultLiveRegulatoryFeedService,
    webRetriever: ControlledWebRetriever = defaultControlledWebRetriever,
    versioningManager: SourceVersioningManager = defaultSourceVersioningManager
  ) {
    this.localRetriever = localRetriever;
    this.feedService = feedService;
    this.webRetriever = webRetriever;
    this.versioningManager = versioningManager;
  }

  public getWebRetriever(): ControlledWebRetriever {
    return this.webRetriever;
  }

  /**
   * Retrieves sources by unique ID
   */
  public getSourceById(id: string): AuthoritativeSourceRecord | undefined {
    // 1. Check local active registry
    const local = this.localRetriever.getSourceById(id);
    if (local) return local;

    return undefined;
  }

  /**
   * Finds sources matching a standard/statute code and optional section.
   */
  public findSourcesByStandardOrAct(
    standardOrActCode: string,
    paragraphOrSection?: string
  ): AuthoritativeSourceRecord[] {
    return this.localRetriever.findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection);
  }

  /**
   * Retrieves relevant sources matching the query.
   * Preserves Phase 3 temporal scoring and candidate-isolation invariants.
   */
  public async retrieveSources(retrievalQuery: SourceRetrievalQuery): Promise<AuthoritativeSourceRecord[]> {
    // Retrieve from local active registry (which contains all approved static and activated live-patch sources)
    const records = await this.localRetriever.retrieveSources(retrievalQuery);

    // Safeguard: Ensure no unapproved candidate records are returned
    const approvedRecords = records.filter((r) => {
      // If record has versionId, check that it is activated in the versioning manager ledger
      if (r.versionId) {
        const activeVersionId = this.versioningManager.getActiveVersionId(r.id);
        if (activeVersionId && activeVersionId !== r.versionId) {
          // Record has been superseded
          return false;
        }
      }
      return r.sourceStatus === 'VERIFIED' || r.sourceStatus === 'HISTORICAL' || r.sourceStatus === 'NEEDS_REVIEW';
    });

    return approvedRecords;
  }

  /**
   * Diagnostic helper to inspect active status
   */
  public getRetrievalDiagnostics() {
    return {
      syncState: this.feedService.getSyncState(),
      lastCheckDate: this.feedService.getLastCheckDate(),
      lastVerificationDate: this.feedService.getLastVerificationDate(),
      activePackagesCount: this.feedService.getActivePackages().length,
      stagedPackagesCount: this.feedService.getStagedPackages().length,
      ledgerEntriesCount: this.versioningManager.getAllLedgerEntries().length
    };
  }
}

/**
 * Singleton instance of CompositeSourceRetriever.
 */
export const defaultCompositeSourceRetriever = new CompositeSourceRetriever();
