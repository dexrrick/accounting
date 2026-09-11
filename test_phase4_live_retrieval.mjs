import assert from 'assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SourceVersioningManager,
  computeSha256,
  computeProvisionHash,
  defaultSourceVersioningManager
} from './src/standards/sourceVersioning.ts';
import {
  SSOUpdateAdapter,
  IRASUpdateAdapter,
  ACRAUpdateAdapter,
  MOMUpdateAdapter,
  CPFUpdateAdapter,
  FrankfurterReferenceAdapter,
  extractSSOProvision,
  extractIRASProvision,
  extractACRAProvision,
  extractMOMProvision,
  extractCPFProvision,
  extractFrankfurterProvision
} from './src/retrieval/sourceAdapters.ts';

const fixturesDir = path.resolve('tests/fixtures');
const ssoHtmlFixture = fs.readFileSync(path.join(fixturesDir, 'sso-section-201-5.html'), 'utf-8');
const irasHtmlFixture = fs.readFileSync(path.join(fixturesDir, 'iras-tax-provision.html'), 'utf-8');
const acraHtmlFixture = fs.readFileSync(path.join(fixturesDir, 'acra-small-company.html'), 'utf-8');
const momHtmlFixture = fs.readFileSync(path.join(fixturesDir, 'mom-part-iv.html'), 'utf-8');
const cpfHtmlFixture = fs.readFileSync(path.join(fixturesDir, 'cpf-ow-ceiling.html'), 'utf-8');
const frankfurterJsonFixture = fs.readFileSync(path.join(fixturesDir, 'frankfurter-response.json'), 'utf-8');
import {
  ExternalSourceValidator,
  defaultExternalSourceValidator
} from './src/retrieval/externalSourceValidator.ts';
import {
  SourceCache
} from './src/retrieval/sourceCache.ts';
import {
  ControlledWebRetriever
} from './src/retrieval/controlledWebRetriever.ts';
import {
  LiveRegulatoryFeedService
} from './src/retrieval/liveRegulatoryFeed.ts';
import {
  CompositeSourceRetriever
} from './src/retrieval/compositeSourceRetriever.ts';
import {
  UNIFIED_SOURCE_REGISTRY
} from './src/standards/unifiedSourceModel.ts';
import { evaluateFastPathEligibility } from './src/services/geminiService.ts';

console.log('=============================================================');
console.log('🧪 RUNNING PHASE 4: EXTERNAL / LIVE RETRIEVAL & SOURCE VERSIONING TEST SUITE');
console.log('=============================================================\n');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✓ ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL: ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`✓ ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL: ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

async function runTests() {
  console.log('[1. DOMAIN ALLOWLISTING & URL SECURITY]');

  it('1A. Accepts official Singapore regulatory portals and Frankfurter reference API', () => {
    const validator = new ExternalSourceValidator();
    const validUrls = [
      'https://sso.agc.gov.sg/Act/CoA1967',
      'https://www.iras.gov.sg/taxes/corporate-income-tax',
      'https://iras.gov.sg/taxes/goods-services-tax',
      'https://www.acra.gov.sg/compliance',
      'https://acra.gov.sg/legislation',
      'https://www.mom.gov.sg/employment-practices',
      'https://mom.gov.sg/workplace-safety',
      'https://www.cpf.gov.sg/employer',
      'https://cpf.gov.sg/member',
      'https://api.frankfurter.dev/v1/latest?from=USD&to=SGD'
    ];

    for (const url of validUrls) {
      const res = validator.validateUrlSecurity(url);
      assert.strictEqual(res.isValid, true, `Expected valid for '${url}', got ${res.reason}`);
    }
  });

  it('1B. Strictly rejects unauthorized domains and spoofed hostnames', () => {
    const validator = new ExternalSourceValidator();
    const invalidUrls = [
      'https://untrusted-legal-site.com/law',
      'https://sso.agc.gov.sg.evil.com/spoof',
      'https://sso.agc.gov.sg@evil.com/spoof',
      'https://fake-iras.gov.sg/tax',
      'https://not-mom.gov.sg/leave'
    ];

    for (const url of invalidUrls) {
      const res = validator.validateUrlSecurity(url);
      assert.strictEqual(res.isValid, false, `Expected rejected for '${url}'`);
      assert.strictEqual(res.errorCode, 'UNAUTHORIZED_DOMAIN_ACCESS');
    }
  });

  it('1C. Enforces port 443 / default HTTPS and rejects custom ports', () => {
    const validator = new ExternalSourceValidator();
    const portRes = validator.validateUrlSecurity('https://sso.agc.gov.sg:8443/Act/CoA1967');
    assert.strictEqual(portRes.isValid, false);
    assert.strictEqual(portRes.errorCode, 'NON_STANDARD_PORT');

    const credRes = validator.validateUrlSecurity('https://admin:secret@sso.agc.gov.sg/Act/CoA1967');
    assert.strictEqual(credRes.isValid, false);
    assert.strictEqual(credRes.errorCode, 'CREDENTIALS_DISALLOWED');
  });

  console.log('\n[2. HTTPS ENFORCEMENT & REDIRECT PROTECTION]');

  it('2A. Rejects insecure HTTP protocol and enforces HTTPS', () => {
    const validator = new ExternalSourceValidator();
    const httpRes = validator.validateUrlSecurity('http://sso.agc.gov.sg/Act/CoA1967');
    assert.strictEqual(httpRes.isValid, false);
    assert.strictEqual(httpRes.errorCode, 'INSECURE_PROTOCOL');
  });

  it('2B. Validates redirect destinations and rejects redirect to external domain', () => {
    const validator = new ExternalSourceValidator();
    const origUrl = 'https://sso.agc.gov.sg/Act/CoA1967';
    const evilTarget = 'https://evil-phishing.com/harvest';
    const redirectRes = validator.validateRedirect(origUrl, evilTarget);

    assert.strictEqual(redirectRes.isValid, false);
    assert.strictEqual(redirectRes.errorCode, 'REDIRECT_REJECTED');
  });

  console.log('\n[3. SHA-256 CONTENT HASHING & INTEGRITY AUDITING]');

  it('3A. Deterministic SHA-256 computation conforms to standard test vectors', () => {
    // Empty string SHA-256
    const emptyHash = computeSha256('');
    assert.strictEqual(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.strictEqual(emptyHash.length, 64);

    // Deterministic repeatability
    const text = 'Singapore Companies Act 1967 Section 205C Audit Exemption Criteria';
    const hash1 = computeSha256(text);
    const hash2 = computeSha256(text);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);

    // Any alteration produces different hash
    const hashModified = computeSha256(text + '.');
    assert.notStrictEqual(hash1, hashModified);
  });

  it('3B. Integrity audit detects content modification / tampering', () => {
    const manager = new SourceVersioningManager();
    const sampleRecord = {
      id: 'TEST_RULE_1',
      authority: 'ACRA',
      authorityName: 'ACRA',
      sourcePublisher: 'Singapore Statutes Online / AGC',
      legalOrStandardInstrument: 'Companies Act 1967',
      documentTitle: 'Companies Act 1967',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 205C',
      sourceText: 'Small company audit exemption requires meeting 2 of 3 criteria: revenue <= $10M, assets <= $10M, employees <= 50.',
      principleSummary: 'Audit Exemption',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/CoA1967#pr205C-',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['audit', 'exemption'],
      sourceStatus: 'VERIFIED',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      validFrom: '2015-07-01',
      lastVerifiedDate: '2026-09-01',
      provenance: 'LOCAL_STATIC'
    };

    const hash = manager.computeSourceHash(sampleRecord);
    assert.strictEqual(manager.verifySourceIntegrity(sampleRecord, hash), true);

    // Tampered copy
    const tampered = {
      ...sampleRecord,
      sourceText: 'Small company audit exemption requires meeting 2 of 3 criteria: revenue <= $20M, assets <= $20M, employees <= 50.'
    };
    assert.strictEqual(manager.verifySourceIntegrity(tampered, hash), false);
  });

  console.log('\n[4. PROVENANCE & SOURCE CACHE]');

  it('4A. Provenance validator rejects external sources falsely claiming LOCAL_STATIC', () => {
    const validator = new ExternalSourceValidator();
    const fakeRecord = {
      provenance: 'LOCAL_STATIC',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 205C',
      sourceText: 'Verbatim law',
      documentTitle: 'Companies Act 1967'
    };

    const res = validator.validateProvenance(fakeRecord, 'https://sso.agc.gov.sg/Act/CoA1967');
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errorCode, 'PROVENANCE_MISMATCH');
  });

  it('4B. Source cache handles set, get, hit, invalidation, and clear', () => {
    const cache = new SourceCache();
    assert.strictEqual(cache.size(), 0);

    const testUrl = 'https://sso.agc.gov.sg/Act/CoA1967#pr205C-';
    const cachedItem = {
      canonicalUrl: testUrl,
      retrievedAt: new Date().toISOString(),
      contentHash: 'a'.repeat(64),
      rawContent: 'Sample legal body',
      httpStatus: 200
    };

    cache.set(cachedItem);
    assert.strictEqual(cache.size(), 1);

    const fetched = cache.get(testUrl);
    assert.ok(fetched);
    assert.strictEqual(fetched.rawContent, 'Sample legal body');

    cache.invalidate(testUrl);
    assert.strictEqual(cache.get(testUrl), null);
    assert.strictEqual(cache.size(), 0);
  });

  console.log('\n[5. CONTROLLED WEB RETRIEVER & NETWORK FAILURE RESILIENCE]');

  await itAsync('5A. ControlledWebRetriever intercepts network timeouts gracefully without throwing', async () => {
    const mockTimeoutFetch = () =>
      new Promise((_, reject) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        setTimeout(() => reject(err), 50);
      });

    const retriever = new ControlledWebRetriever();
    const result = await retriever.fetchOfficialSource('https://sso.agc.gov.sg/Act/CoA1967', {
      timeoutMs: 30,
      customFetch: mockTimeoutFetch
    });

    assert.strictEqual(result.status, 'TIMEOUT');
    assert.ok(result.error.includes('timed out'));
  });

  await itAsync('5B. ControlledWebRetriever intercepts CORS failures gracefully without throwing', async () => {
    const mockCorsFetch = async () => {
      throw new TypeError('Failed to fetch (CORS block)');
    };

    const retriever = new ControlledWebRetriever();
    const result = await retriever.fetchOfficialSource('https://sso.agc.gov.sg/Act/CoA1967', {
      customFetch: mockCorsFetch
    });

    assert.strictEqual(result.status, 'CORS_ERROR');
    assert.ok(result.error.includes('CORS'));
  });

  console.log('\n[6. STAGING, ATOMIC ACTIVATION & ROLLBACK PIPELINE]');

  await itAsync('6A. Candidate update staging holds records in candidate pool without mutating active retrieval', async () => {
    const feedService = new LiveRegulatoryFeedService();

    const candidateRecord = {
      id: 'LIVE_MOM_AMENDMENT_2026',
      authority: 'MOM',
      authorityName: 'Ministry of Manpower',
      sourcePublisher: 'Singapore Statutes Online / AGC',
      legalOrStandardInstrument: 'Employment Act 1968',
      documentTitle: 'Employment Act 1968',
      standardOrActCode: 'EA1968',
      paragraphOrSection: 'Section 999',
      sourceText: 'Draft unapproved statutory provision pending parliamentary assent.',
      principleSummary: 'Draft Provision',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/EA1968',
      domain: 'MOM_EMPLOYMENT',
      jurisdiction: 'Singapore',
      tags: ['employment', 'draft'],
      sourceStatus: 'NEEDS_REVIEW',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      validFrom: '2026-10-01',
      lastVerifiedDate: '2026-09-11',
      provenance: 'LIVE_EXTERNAL'
    };

    const pkg = {
      packageId: 'SG-MOM-2026-P1',
      releaseDate: '2026-09-11',
      authority: 'MOM',
      updates: [candidateRecord],
      amendments: [
        {
          recordId: candidateRecord.id,
          title: 'Draft Amendment',
          changeType: 'TEXT_CHANGE',
          summary: 'Pending amendment'
        }
      ],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    const stageResult = await feedService.stageUpdatePackage(pkg);
    assert.strictEqual(stageResult.success, true);
    assert.strictEqual(feedService.getStagedPackages().length, 1);

    // Active registry remains untouched: record is NOT in UNIFIED_SOURCE_REGISTRY
    assert.strictEqual(UNIFIED_SOURCE_REGISTRY[candidateRecord.id], undefined);
  });

  await itAsync('6B. Verified update package activation atomically commits into active registry and version ledger', async () => {
    const feedService = new LiveRegulatoryFeedService();

    const validRecord = {
      id: 'IRAS_CORP_TAX_REBATE_2026',
      authority: 'IRAS',
      authorityName: 'Inland Revenue Authority of Singapore',
      sourcePublisher: 'Inland Revenue Authority of Singapore',
      legalOrStandardInstrument: 'Income Tax Act 1947',
      documentTitle: 'Income Tax Act 1947',
      standardOrActCode: 'ITA1947',
      paragraphOrSection: 'Section 43(1)',
      sourceText: 'Companies granted a 50% Corporate Income Tax rebate capped at SGD 40,000 for Year of Assessment 2026.',
      principleSummary: 'Corporate Income Tax Rebate YA 2026',
      officialSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax',
      domain: 'IRAS_TAX',
      jurisdiction: 'Singapore',
      tags: ['corporate tax', 'tax rebate', 'ya 2026'],
      sourceStatus: 'VERIFIED',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      lastVerifiedDate: '2026-09-11',
      provenance: 'LIVE_PATCH',
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 43(1)',
        elementId: 'cit-rebate'
      }
    };

    const pkg = {
      packageId: 'SG-IRAS-2026-Q3-01',
      releaseDate: '2026-09-11',
      authority: 'IRAS',
      updates: [validRecord],
      amendments: [
        {
          recordId: validRecord.id,
          title: 'Corporate Income Tax Rebate',
          changeType: 'RATE_CHANGE',
          summary: 'Enacted 50% CIT rebate capped at SGD 40,000'
        }
      ],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    // 1. Stage
    await feedService.stageUpdatePackage(pkg);

    // 2. Verify
    const verifyRes = await feedService.verifyUpdatePackage(pkg.packageId);
    assert.strictEqual(verifyRes.isValid, true);
    assert.strictEqual(verifyRes.verifiedRecordsCount, 1);

    // 3. Activate
    const actRes = await feedService.activateUpdatePackage(pkg.packageId);
    assert.strictEqual(actRes.success, true);

    // Now record is active in UNIFIED_SOURCE_REGISTRY
    const activatedInRegistry = UNIFIED_SOURCE_REGISTRY[validRecord.id];
    assert.ok(activatedInRegistry);
    assert.strictEqual(activatedInRegistry.sourceStatus, 'VERIFIED');
    assert.strictEqual(activatedInRegistry.provenance, 'LIVE_PATCH');
  });

  await itAsync('6C. Atomic package failure: 1 invalid record causes entire package rejection (0 activated)', async () => {
    const feedService = new LiveRegulatoryFeedService();

    const goodRecord = {
      id: 'GOOD_REC_1',
      authority: 'ACRA',
      authorityName: 'ACRA',
      sourcePublisher: 'Singapore Statutes Online / AGC',
      legalOrStandardInstrument: 'Companies Act 1967',
      documentTitle: 'Companies Act 1967',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 100',
      sourceText: 'Valid statutory provision text.',
      principleSummary: 'Valid Record',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/CoA1967',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['acra'],
      sourceStatus: 'VERIFIED',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-11',
      provenance: 'LIVE_PATCH',
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 100',
        elementId: 'pr100-'
      }
    };

    const badRecord = {
      id: 'BAD_REC_2',
      authority: 'ACRA',
      authorityName: 'ACRA',
      sourcePublisher: 'Singapore Statutes Online / AGC',
      legalOrStandardInstrument: 'Companies Act 1967',
      documentTitle: 'Companies Act 1967',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 101',
      sourceText: '', // Empty sourceText violates document structure!
      principleSummary: 'Bad Record',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/CoA1967',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['acra'],
      sourceStatus: 'VERIFIED',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-11',
      provenance: 'LIVE_PATCH'
    };

    const pkg = {
      packageId: 'SG-ACRA-FAILED-PKG',
      releaseDate: '2026-09-11',
      authority: 'ACRA',
      updates: [goodRecord, badRecord],
      amendments: [],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    await feedService.stageUpdatePackage(pkg);
    const verifyRes = await feedService.verifyUpdatePackage(pkg.packageId);

    // Atomic validation failure!
    assert.strictEqual(verifyRes.isValid, false);
    assert.strictEqual(verifyRes.failedRecordId, 'BAD_REC_2');

    // Attempting activation fails because package is not verified
    const actRes = await feedService.activateUpdatePackage(pkg.packageId);
    assert.strictEqual(actRes.success, false);
    assert.strictEqual(actRes.activatedRecordsCount, 0);
    assert.strictEqual(UNIFIED_SOURCE_REGISTRY['GOOD_REC_1'], undefined);
  });

  await itAsync('6D. Rollback cleanly restores predecessor version in active registry while keeping ledger entry', async () => {
    const feedService = new LiveRegulatoryFeedService();
    const versioningManager = defaultSourceVersioningManager;

    // First, baseline record
    const baseRecord = {
      id: 'CPF_ROLLBACK_TEST',
      authority: 'CPF',
      authorityName: 'CPF Board',
      sourcePublisher: 'Singapore Statutes Online / AGC',
      legalOrStandardInstrument: 'Central Provident Fund Act 1953',
      documentTitle: 'Central Provident Fund Act 1953',
      standardOrActCode: 'CPFA1953',
      paragraphOrSection: 'First Schedule',
      sourceText: 'Baseline Ordinary Wage ceiling is SGD 8,000.',
      principleSummary: 'CPF Ceiling 2026',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/CPFA1953',
      domain: 'CPF_BOARD',
      jurisdiction: 'Singapore',
      tags: ['cpf', 'ceiling'],
      sourceStatus: 'VERIFIED',
      sourceType: 'AUTHORITATIVE_SOURCE',
      evidenceTier: 'PRIMARY_SOURCE',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-01',
      provenance: 'LOCAL_STATIC',
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'First Schedule',
        elementId: 'first-schedule'
      }
    };

    versioningManager.registerCandidateVersion(baseRecord, {
      versionId: 'V1-CPF',
      contentHash: versioningManager.computeSourceHash(baseRecord),
      canonicalSourceUrl: baseRecord.officialSourceUrl,
      sourceAuthority: 'CPF',
      verificationStatus: 'VERIFIED',
      retrievedAt: '2026-09-01T00:00:00Z'
    });
    versioningManager.activateVersion('V1-CPF');
    UNIFIED_SOURCE_REGISTRY[baseRecord.id] = { ...baseRecord, versionId: 'V1-CPF' };

    // Now update with new enacted package
    const updatedRecord = {
      ...baseRecord,
      sourceText: 'Enacted Ordinary Wage ceiling updated to SGD 8,500.',
      provenance: 'LIVE_PATCH'
    };

    const pkg = {
      packageId: 'SG-CPF-2027-UPDATE',
      releaseDate: '2026-09-11',
      authority: 'CPF',
      updates: [updatedRecord],
      amendments: [],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    await feedService.stageUpdatePackage(pkg);
    await feedService.verifyUpdatePackage(pkg.packageId);
    await feedService.activateUpdatePackage(pkg.packageId);

    assert.ok(UNIFIED_SOURCE_REGISTRY[baseRecord.id].sourceText.includes('8,500'));

    // Execute Rollback
    const rollRes = await feedService.rollbackUpdatePackage(pkg.packageId);
    assert.strictEqual(rollRes.success, true);
    assert.strictEqual(rollRes.rolledBackRecordsCount, 1);

    // Active registry restored to baseline 8,000!
    assert.ok(UNIFIED_SOURCE_REGISTRY[baseRecord.id].sourceText.includes('8,000'));
    // Version ledger still contains the rolled-back version snapshot (immutable history)
    assert.ok(versioningManager.getLedgerEntry('SG-CPF-2027-UPDATE-CPF_ROLLBACK_TEST'));
  });

  console.log('\n[7. VERSION COMPARISON ENGINE]');

  it('7A. Detects TEXT_CHANGE, RATE_CHANGE, THRESHOLD_CHANGE, EFFECTIVE_DATE_CHANGE', () => {
    const manager = new SourceVersioningManager();
    const oldMeta = {
      versionId: 'GST-2023',
      contentHash: 'hash1'.padEnd(64, '0'),
      validFrom: '2023-01-01',
      validTo: '2023-12-31',
      effectiveDate: '2023-01-01',
      canonicalSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993',
      sourceAuthority: 'IRAS',
      verificationStatus: 'VERIFIED',
      retrievedAt: '2023-01-01T00:00:00Z'
    };
    const newMeta = {
      versionId: 'GST-2024',
      contentHash: 'hash2'.padEnd(64, '0'),
      validFrom: '2024-01-01',
      validTo: undefined,
      effectiveDate: '2024-01-01',
      canonicalSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993',
      sourceAuthority: 'IRAS',
      verificationStatus: 'VERIFIED',
      retrievedAt: '2024-01-01T00:00:00Z'
    };

    const oldRec = {
      standardOrActCode: 'GSTA1993',
      paragraphOrSection: 'Section 16',
      sourceText: 'The rate of tax shall be 8%. Compulsory registration threshold remains $1,000,000.',
      domain: 'IRAS_GST',
      tags: ['gst']
    };
    const newRec = {
      standardOrActCode: 'GSTA1993',
      paragraphOrSection: 'Section 16',
      sourceText: 'The rate of tax shall be 9%. Compulsory registration threshold remains $1,000,000.',
      domain: 'IRAS_GST',
      tags: ['gst']
    };

    const diff = manager.compareVersions(oldMeta, newMeta, oldRec, newRec);
    assert.strictEqual(diff.textChanged, true);
    assert.strictEqual(diff.rateChanged, true);
    assert.strictEqual(diff.effectiveDateChanged, true);
    assert.strictEqual(diff.thresholdChanged, false);
    assert.ok(diff.changes.includes('TEXT_CHANGE'));
    assert.ok(diff.changes.includes('RATE_CHANGE'));
    assert.ok(diff.changes.includes('EFFECTIVE_DATE_CHANGE'));
  });

  console.log('\n[8. COMPOSITE RETRIEVER & OFFLINE FALLBACK GUARANTEES]');

  await itAsync('8A. CompositeSourceRetriever merges local and live verified sources and preserves offline operation', async () => {
    const composite = new CompositeSourceRetriever();

    // Query active registry
    const sources = await composite.retrieveSources({
      query: 'what is the corporate tax loss carry-forward rule',
      domain: 'IRAS_TAX',
      maxResults: 5
    });

    assert.ok(sources.length > 0);
    const hasLossCarryForward = sources.some(s => s.id === 'ITA_SEC37_LOSS_CARRY_FORWARD');
    assert.strictEqual(hasLossCarryForward, true);
  });

  await itAsync('8B. Phase 3 temporal resolution remains 100% preserved (2023 8% GST vs 2026 9% GST)', async () => {
    const composite = new CompositeSourceRetriever();

    // Query 2023 historical GST
    const histRes = await composite.retrieveSources({
      query: 'what is the GST rate in 2023',
      domain: 'IRAS_GST',
      targetDate: '2023-06-15',
      maxResults: 3
    });
    assert.ok(histRes.length > 0);
    assert.strictEqual(histRes[0].id, 'GST_RATE_8_PERCENT_2023');

    // Query 2026 current GST
    const currRes = await composite.retrieveSources({
      query: 'what is the current GST rate in 2026',
      domain: 'IRAS_GST',
      targetDate: '2026-09-11',
      maxResults: 3
    });
    assert.ok(currRes.length > 0);
    assert.strictEqual(currRes[0].id, 'GST_RATE_9_PERCENT');
  });

  console.log('\n[9. FAST-PATH INTEGRITY & REFERENCE API SEPARATION]');

  await itAsync('9A. UNVERIFIED and REFERENCE_API sources are strictly rejected from fast-path bypass', async () => {
    const unverifiedContext = {
      classification: {
        primaryDomain: 'MOM_EMPLOYMENT',
        authorities: ['MOM'],
        intent: 'STATUTORY_ADVISORY',
        currentInformationRequired: false,
        accountingAnalysisRequired: false,
        taxAnalysisRequired: false,
        regulatoryAnalysisRequired: true,
        calculationRequired: false,
        journalEntryRequired: false,
        missingFacts: []
      },
      userFacts: ['annual leave'],
      missingFacts: [],
      assumptions: [],
      primaryEvidence: [
        {
          id: 'TEST_UNVERIFIED',
          documentTitle: 'Employment Act 1968',
          standardOrActCode: 'EA1968',
          paragraphOrSection: 'Section 88A',
          sourceText: 'Annual leave entitlement',
          sourceStatus: 'NEEDS_REVIEW', // Not VERIFIED!
          sourceType: 'AUTHORITATIVE_SOURCE',
          evidenceTier: 'PRIMARY_SOURCE',
          isVerbatimText: true,
          effectiveDate: '2026-01-01',
          sourceAuthority: 'MOM'
        }
      ],
      officialGuidance: [],
      curatedSummaries: [],
      applicationRules: [],
      currentInformationRequired: false
    };

    const mockScenario = {
      isComplete: true,
      scenarioType: 'SINGAPORE_STATUTORY_ADVISORY',
      directGroups: [],
      statutoryAdvisory: [
        {
          topic: 'Annual Leave',
          authority: 'MOM',
          statuteOrAct: 'Employment Act 1968',
          sectionOrSchedule: 'Section 88A',
          officialUrl: 'https://sso.agc.gov.sg/Act/EA1968#pr88A-'
        }
      ]
    };

    const evalRes = evaluateFastPathEligibility('what is the statutory annual leave entitlement', mockScenario, unverifiedContext);
    assert.strictEqual(evalRes.canBypass, false);
    assert.ok(evalRes.reason.includes('NEEDS_REVIEW') || evalRes.reason.includes('VERIFIED'));
  });

  await itAsync('9B. Frankfurter ECB FX is tagged REFERENCE_API and cannot satisfy statutory authority checks', async () => {
    const fxContext = {
      classification: {
        primaryDomain: 'ACRA_CORP',
        authorities: ['ACRA'],
        intent: 'STATUTORY_ADVISORY',
        missingFacts: []
      },
      userFacts: [],
      missingFacts: [],
      assumptions: [],
      primaryEvidence: [
        {
          id: 'FRANKFURTER_FX',
          documentTitle: 'European Central Bank FX',
          standardOrActCode: 'ECB_FX',
          paragraphOrSection: 'Spot Rate',
          sourceText: '1 USD = 1.34 SGD',
          sourceStatus: 'VERIFIED',
          sourceType: 'AUTHORITATIVE_SOURCE',
          evidenceTier: 'PRIMARY_SOURCE',
          isVerbatimText: true,
          effectiveDate: '2026-09-11',
          sourceAuthority: 'REFERENCE_API' // REFERENCE_API!
        }
      ],
      officialGuidance: [],
      curatedSummaries: [],
      applicationRules: [],
      currentInformationRequired: false
    };

    const mockScenario = {
      isComplete: true,
      scenarioType: 'SINGAPORE_STATUTORY_ADVISORY',
      directGroups: [
        {
          citations: [
            {
              standard: 'European Central Bank FX',
              paragraph: 'Spot Rate',
              authority: 'REFERENCE_API',
              officialSourceUrl: 'https://api.frankfurter.dev'
            }
          ]
        }
      ]
    };

    const evalRes = evaluateFastPathEligibility('tell me about ECB spot rates', mockScenario, fxContext);
    assert.strictEqual(evalRes.canBypass, false);
    assert.ok(evalRes.reason.includes('reference API') || evalRes.reason.includes('REFERENCE_API'));
  });

  console.log('\n[10. PHASE 4.1 COMPLETION & FIX PASS VALIDATION]');

  it('10A. SHA-256 standard test vectors match Node.js crypto.createHash across diverse data types', () => {
    const testCases = [
      '',
      'hello',
      'The quick brown fox jumps over the lazy dog',
      'Singapore Accounting Standards 2026',
      JSON.stringify({ standard: 'SFRS(I) 1-12', taxRate: 0.17, effectiveDate: '2026-01-01' }),
      'SG-STATUTE-'.repeat(200)
    ];

    for (const tc of testCases) {
      const computed = computeSha256(tc);
      const standard = crypto.createHash('sha256').update(tc, 'utf8').digest('hex');
      assert.strictEqual(computed, standard, `Hash mismatch for input '${tc.slice(0, 20)}...'`);
      assert.strictEqual(computed.length, 64);
    }
  });

  it('10B. MOM and CPF canonical URL validation in ExternalSourceValidator', () => {
    const validator = new ExternalSourceValidator();

    // MOM valid
    assert.strictEqual(validator.validateCanonicalUrl('https://mom.gov.sg/employment-practices/employment-act', 'MOM').isValid, true);
    assert.strictEqual(validator.validateCanonicalUrl('https://www.mom.gov.sg/workplace-safety', 'MOM').isValid, true);
    assert.strictEqual(validator.validateCanonicalUrl('https://sso.agc.gov.sg/Act/EA1968', 'MOM').isValid, true);

    // MOM invalid
    assert.strictEqual(validator.validateCanonicalUrl('https://iras.gov.sg/employment-act', 'MOM').errorCode, 'CANONICAL_URL_MISMATCH');
    assert.strictEqual(validator.validateCanonicalUrl('https://cpf.gov.sg/employment-act', 'MOM').errorCode, 'CANONICAL_URL_MISMATCH');

    // CPF valid
    assert.strictEqual(validator.validateCanonicalUrl('https://cpf.gov.sg/rates', 'CPF').isValid, true);
    assert.strictEqual(validator.validateCanonicalUrl('https://www.cpf.gov.sg/employer', 'CPF').isValid, true);
    assert.strictEqual(validator.validateCanonicalUrl('https://sso.agc.gov.sg/Act/CPFA1953', 'CPF').isValid, true);

    // CPF invalid
    assert.strictEqual(validator.validateCanonicalUrl('https://mom.gov.sg/cpf-rates', 'CPF').errorCode, 'CANONICAL_URL_MISMATCH');
    assert.strictEqual(validator.validateCanonicalUrl('https://acra.gov.sg/cpf-rates', 'CPF').errorCode, 'CANONICAL_URL_MISMATCH');
  });

  it('10C. SourceCache TTL freshness, conditional revalidation headers, and expiry pruning', () => {
    const cache = new SourceCache(100); // 100ms default TTL

    cache.set({
      canonicalUrl: 'https://sso.agc.gov.sg/Act/COA1967',
      retrievedAt: new Date().toISOString(),
      contentHash: 'hash-coa',
      rawContent: 'Companies Act text',
      httpStatus: 200,
      etag: '"v1-etag"',
      lastModified: 'Wed, 21 Oct 2025 07:28:00 GMT'
    }, 50); // 50ms custom TTL

    const now = Date.now();
    // Immediate check
    assert.strictEqual(cache.isFresh('https://sso.agc.gov.sg/Act/COA1967', now), true);
    assert.notStrictEqual(cache.getFresh('https://sso.agc.gov.sg/Act/COA1967', now), null);

    // Conditional headers
    const condHeaders = cache.getConditionalHeaders('https://sso.agc.gov.sg/Act/COA1967');
    assert.strictEqual(condHeaders['If-None-Match'], '"v1-etag"');
    assert.strictEqual(condHeaders['If-Modified-Since'], 'Wed, 21 Oct 2025 07:28:00 GMT');

    // Simulate 60ms later (expired)
    const later = now + 60;
    assert.strictEqual(cache.isFresh('https://sso.agc.gov.sg/Act/COA1967', later), false);
    assert.strictEqual(cache.getFresh('https://sso.agc.gov.sg/Act/COA1967', later), null);

    // Pruning
    const pruned = cache.pruneExpired(later);
    assert.strictEqual(pruned, 1);
    assert.strictEqual(cache.size(), 0);
  });

  await itAsync('10D. Source-specific update discovery adapters produce valid update packages', async () => {
    // Inject mock transport for all source portals
    const mockTransport = async (url) => {
      let body = '';
      if (url.includes('sso.agc.gov.sg')) body = ssoHtmlFixture;
      else if (url.includes('iras.gov.sg')) body = irasHtmlFixture;
      else if (url.includes('acra.gov.sg')) body = acraHtmlFixture;
      else if (url.includes('mom.gov.sg')) body = momHtmlFixture;
      else if (url.includes('cpf.gov.sg')) body = cpfHtmlFixture;
      else if (url.includes('frankfurter.dev')) body = frankfurterJsonFixture;

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', url.includes('frankfurter') ? 'application/json' : 'text/html'],
          ['etag', '"rev-2026-v1"'],
          ['last-modified', 'Thu, 01 Jan 2026 00:00:00 GMT']
        ]),
        text: async () => body
      };
    };

    const ssoAdapter = new SSOUpdateAdapter();
    const irasAdapter = new IRASUpdateAdapter();
    const acraAdapter = new ACRAUpdateAdapter();
    const momAdapter = new MOMUpdateAdapter();
    const cpfAdapter = new CPFUpdateAdapter();
    const fxAdapter = new FrankfurterReferenceAdapter();

    const customWebRetriever = new ControlledWebRetriever(defaultExternalSourceValidator, new SourceCache());
    const fetchOptions = { customFetch: mockTransport };

    // Test each adapter with custom fetcher
    const ssoPkg = await ssoAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(ssoPkg);
    assert.strictEqual(ssoPkg.authority, 'AGC');
    assert.ok(ssoPkg.packageHash.length === 64);

    const irasPkg = await irasAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(irasPkg);
    assert.strictEqual(irasPkg.authority, 'IRAS');

    const acraPkg = await acraAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(acraPkg);
    assert.strictEqual(acraPkg.authority, 'ACRA');

    const momPkg = await momAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(momPkg);
    assert.strictEqual(momPkg.authority, 'MOM');

    const cpfPkg = await cpfAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(cpfPkg);
    assert.strictEqual(cpfPkg.authority, 'CPF');

    const fxPkg = await fxAdapter.checkForUpdates({
      fetchOfficialSource: (u, o) => customWebRetriever.fetchOfficialSource(u, { ...o, ...fetchOptions })
    });
    assert.ok(fxPkg);
    assert.strictEqual(fxPkg.authority, 'REFERENCE_API');
  });

  await itAsync('10E. LiveRegulatoryFeedService.checkForUpdates() queries registered adapters', async () => {
    const versioning = new SourceVersioningManager();
    const feedService = new LiveRegulatoryFeedService(versioning);

    const mockCustomFetch = async (_url) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => ssoHtmlFixture
    });

    const mockRetriever = new ControlledWebRetriever(defaultExternalSourceValidator, new SourceCache());
    const boundRetriever = {
      fetchOfficialSource: (url, opts) => mockRetriever.fetchOfficialSource(url, { ...opts, customFetch: mockCustomFetch })
    };

    const checkRes = await feedService.checkForUpdates(boundRetriever);
    assert.strictEqual(checkRes.hasUpdates, true);
    assert.strictEqual(checkRes.syncState, 'UPDATE_AVAILABLE');
    assert.ok(checkRes.packages.length >= 1, 'Expected at least 1 discovered package from adapters');
  });

  await itAsync('10F. Preserves external provenance details into candidate metadata', async () => {
    const versioning = new SourceVersioningManager();
    const feedService = new LiveRegulatoryFeedService(versioning);

    const mockRecord = {
      id: 'PROVENANCE_TEST_REC',
      standardOrActCode: 'ITA1947',
      paragraphOrSection: 'Section 43',
      documentTitle: 'Income Tax Act',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947',
      sourceText: 'Tax rate provision',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-11',
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      authority: 'AGC',
      version: 'PKG-PROV-1'
    };

    const pkg = {
      packageId: 'PKG-PROV-1',
      releaseDate: '2026-09-11',
      authority: 'AGC',
      updates: [mockRecord],
      amendments: [{ recordId: mockRecord.id, title: 'Amendment', changeType: 'TEXT_CHANGE', summary: 'Summary' }],
      packageHash: 'abc'
    };

    const stageRes = await feedService.stageUpdatePackage(pkg, {
      sourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947',
      httpStatus: 200,
      etag: '"prov-etag-123"',
      lastModified: 'Wed, 21 Oct 2025 07:28:00 GMT'
    });

    assert.strictEqual(stageRes.success, true);
    const candidate = versioning.getCandidates().find((c) => c.metadata.versionId === `${pkg.packageId}-${mockRecord.id}`);
    assert.ok(candidate);
    assert.strictEqual(candidate.metadata.etag, '"prov-etag-123"');
    assert.strictEqual(candidate.metadata.lastModified, 'Wed, 21 Oct 2025 07:28:00 GMT');
    assert.strictEqual(candidate.metadata.httpStatus, 200);
    assert.strictEqual(candidate.metadata.sourceUrl, 'https://sso.agc.gov.sg/Act/ITA1947');
  });

  await itAsync('10G. Truly atomic package activation: Aborts and restores registry snapshot on any error (0 records activated)', async () => {
    const versioning = new SourceVersioningManager();
    const feedService = new LiveRegulatoryFeedService(versioning);

    const rec1 = {
      id: 'REC_ATOMIC_1',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 1',
      documentTitle: 'Record 1 Title',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/COA1967',
      sourceText: 'Valid text 1',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-11',
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      authority: 'ACRA',
      version: 'PKG-ATOMIC',
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 1',
        elementId: 'pr1-'
      }
    };

    const rec2 = {
      id: 'REC_ATOMIC_2',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 2',
      documentTitle: 'Record 2 Title',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/COA1967',
      sourceText: 'Valid text 2',
      isVerbatimText: true,
      lastVerifiedDate: '2026-09-11',
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      authority: 'ACRA',
      version: 'PKG-ATOMIC',
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 2',
        elementId: 'pr2-'
      }
    };

    const pkg = {
      packageId: 'PKG-ATOMIC',
      releaseDate: '2026-09-11',
      authority: 'AGC',
      updates: [rec1, rec2],
      amendments: [
        { recordId: rec1.id, title: 'Rev 1', changeType: 'TEXT_CHANGE', summary: 'Rev 1' },
        { recordId: rec2.id, title: 'Rev 2', changeType: 'TEXT_CHANGE', summary: 'Rev 2' }
      ],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    // Initial baseline in UNIFIED_SOURCE_REGISTRY
    const baselineRec1 = { ...rec1, sourceText: 'Original Pristine Baseline 1', version: 'ORIGINAL_BASELINE' };
    UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_1'] = baselineRec1;
    delete UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_2'];

    // Stage and verify
    await feedService.stageUpdatePackage(pkg);
    const verifyRes = await feedService.verifyUpdatePackage(pkg.packageId);
    assert.strictEqual(verifyRes.isValid, true);

    // Sabotage rec2 candidate in versioning manager to simulate failure during activation loop
    const rec2CandidateId = `${pkg.packageId}-${rec2.id}`;
    // Force versioning manager to fail activation for rec2 by deleting its candidate
    versioning['candidates'].delete(rec2CandidateId);

    // Attempt activation
    const actRes = await feedService.activateUpdatePackage(pkg.packageId);

    // Invariant: Activation MUST fail atomically
    assert.strictEqual(actRes.success, false);
    assert.strictEqual(actRes.activatedRecordsCount, 0, 'Must activate exactly 0 records upon failure');

    // Invariant: Registry snapshot for REC_ATOMIC_1 must be 100% restored
    assert.strictEqual(UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_1'].version, 'ORIGINAL_BASELINE');
    assert.strictEqual(UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_1'].sourceText, 'Original Pristine Baseline 1');

    // Invariant: REC_ATOMIC_2 must NOT be in UNIFIED_SOURCE_REGISTRY
    assert.strictEqual(UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_2'], undefined);

    // Cleanup test keys
    delete UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_1'];
    delete UNIFIED_SOURCE_REGISTRY['REC_ATOMIC_2'];
  });

  await itAsync('10H. Live fetch failures leave UNIFIED_SOURCE_REGISTRY completely untouched', async () => {
    const registryKeysBefore = Object.keys(UNIFIED_SOURCE_REGISTRY).length;
    const failingRetriever = new ControlledWebRetriever();

    const failureResults = await Promise.all([
      failingRetriever.fetchOfficialSource('https://sso.agc.gov.sg/Act/COA1967', {
        customFetch: async () => { throw new Error('Simulated Connection Refused / DNS Error'); }
      }),
      failingRetriever.fetchOfficialSource('https://unauthorized-domain.com/tax'),
      failingRetriever.fetchOfficialSource('http://insecure-http.com')
    ]);

    assert.strictEqual(failureResults[0].status, 'NETWORK_ERROR');
    assert.strictEqual(failureResults[1].status, 'UNAUTHORIZED_DOMAIN_ACCESS');
    assert.strictEqual(failureResults[2].status, 'INVALID_URL');

    // Invariant: Registry remains 100% intact
    const registryKeysAfter = Object.keys(UNIFIED_SOURCE_REGISTRY).length;
    assert.strictEqual(registryKeysBefore, registryKeysAfter, 'Active registry keys count must be unchanged');
  });

  console.log('\n[11. PHASE 4.2: EXACT PROVISION EXTRACTION, DUAL HASHING & TRUE VERBATIM INTEGRITY]');

  it('11A (Test 1). Strict anti-truncation: Rejects ellipsis, truncation markers, or missing locators with INVALID_VERBATIM_CLAIM', () => {
    const validator = new ExternalSourceValidator();

    const truncatedSamples = [
      'The financial statements shall comply with the requirements... and give a true and fair view.',
      'The financial statements shall comply with accounting standards… and give a true and fair view.',
      'The financial statements shall comply with accounting standards [truncated]',
      'The financial statements shall comply [abridged]',
      'The financial statements shall comply [content truncated]',
      'The financial statements shall comply [continued]'
    ];

    for (const text of truncatedSamples) {
      const record = {
        standardOrActCode: 'CoA1967',
        paragraphOrSection: 'Section 201(5)',
        documentTitle: 'Companies Act 1967',
        sourceText: text,
        isVerbatimText: true,
        extractionStatus: 'EXACT',
        sourceLocator: { heading: 'Section 201(5)', elementId: 'pr201-' }
      };
      const res = validator.validateProvisionMapping(record);
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errorCode, 'INVALID_VERBATIM_CLAIM');
      assert.ok(res.reason.includes('truncation marker'));
    }

    // Missing source locator with isVerbatimText: true
    const noLocatorRecord = {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: 'The complete unabridged statutory text of section 201(5).',
      isVerbatimText: true,
      extractionStatus: 'EXACT'
    };
    const noLocRes = validator.validateProvisionMapping(noLocatorRecord);
    assert.strictEqual(noLocRes.isValid, false);
    assert.strictEqual(noLocRes.errorCode, 'INVALID_VERBATIM_CLAIM');

    // Empty sourceText with isVerbatimText: true
    const emptyTextRecord = {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: '   ',
      isVerbatimText: true,
      extractionStatus: 'EXACT',
      sourceLocator: { heading: 'Section 201(5)', elementId: 'pr201-' }
    };
    const emptyRes = validator.validateProvisionMapping(emptyTextRecord);
    assert.strictEqual(emptyRes.isValid, false);
    assert.strictEqual(emptyRes.errorCode, 'INVALID_VERBATIM_CLAIM');
  });

  it('11B (Test 2). Partial extraction rejection: Blocks PARTIAL status from authoritative verification', () => {
    const validator = new ExternalSourceValidator();

    // Partial with isVerbatimText: false
    const partialRecord = {
      id: 'REC_PARTIAL_1',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: 'Partial subsection content',
      isVerbatimText: false,
      extractionStatus: 'PARTIAL',
      sourceLocator: { heading: 'Section 201', elementId: 'pr201' }
    };
    const res = validator.validateProvisionMapping(partialRecord);
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errorCode, 'PARTIAL_PROVISION');

    // Partial attempting isVerbatimText: true
    const partialVerbatim = {
      ...partialRecord,
      isVerbatimText: true
    };
    const resV = validator.validateProvisionMapping(partialVerbatim);
    assert.strictEqual(resV.isValid, false);
    assert.strictEqual(resV.errorCode, 'INVALID_VERBATIM_CLAIM');
  });

  await itAsync('11C (Test 3). Failed extraction rejection: FAILED status produces EXTRACTION_FAILED and halts verification', async () => {
    const validator = new ExternalSourceValidator();
    const versioning = new SourceVersioningManager();
    const feedService = new LiveRegulatoryFeedService(versioning);

    const failedRecord = {
      id: 'REC_FAILED_EXTRACTION',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 999',
      documentTitle: 'Companies Act 1967',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/COA1967',
      sourceText: 'Unverified text from unextractable page',
      isVerbatimText: false,
      lastVerifiedDate: '2026-09-11',
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      authority: 'AGC',
      extractionStatus: 'FAILED',
      sourceLocator: {}
    };

    const directCheck = validator.validateProvisionMapping(failedRecord);
    assert.strictEqual(directCheck.isValid, false);
    assert.strictEqual(directCheck.errorCode, 'EXTRACTION_FAILED');

    // Package staging & verification
    const pkg = {
      packageId: 'PKG-FAILED-EXTRACTION',
      releaseDate: '2026-09-11',
      authority: 'AGC',
      updates: [failedRecord],
      amendments: [],
      packageHash: ''
    };
    pkg.packageHash = feedService.computePackageHash(pkg);

    await feedService.stageUpdatePackage(pkg);
    const verifyRes = await feedService.verifyUpdatePackage(pkg.packageId);
    assert.strictEqual(verifyRes.isValid, false);
    assert.strictEqual(verifyRes.failedRecordId, failedRecord.id);
    assert.ok(verifyRes.rejectionReason.includes('Extraction failed'));
  });

  it('11D (Test 4). Correct section mapping: Full deterministic extraction passes validation with EXACT status', () => {
    const validator = new ExternalSourceValidator();
    const extraction = extractSSOProvision(ssoHtmlFixture, 'CoA1967', 'Section 201(5)');

    assert.strictEqual(extraction.extractionStatus, 'EXACT');
    assert.strictEqual(extraction.standardOrActCode, 'CoA1967');
    assert.strictEqual(extraction.paragraphOrSection, 'Section 201(5)');
    assert.strictEqual(extraction.sourceLocator.heading, 'Section 201(5)');
    assert.strictEqual(extraction.sourceLocator.elementId, 'pr201-');
    assert.ok(extraction.sourceLocator.startOffset >= 0);
    assert.ok(extraction.sourceLocator.endOffset > extraction.sourceLocator.startOffset);
    assert.ok(extraction.text.includes('comply with the requirements of the accounting standards'));

    const record = {
      id: 'COA_SEC_201_5',
      standardOrActCode: extraction.standardOrActCode,
      paragraphOrSection: extraction.paragraphOrSection,
      documentTitle: 'Companies Act 1967',
      sourceText: extraction.text,
      isVerbatimText: true,
      extractionStatus: extraction.extractionStatus,
      sourceLocator: extraction.sourceLocator
    };

    const res = validator.validateProvisionMapping(record);
    assert.strictEqual(res.isValid, true);
  });

  it('11E (Test 5). Incorrect section mapping: Mismatched section number or invalid offsets trigger PROVISION_MAPPING_MISMATCH', () => {
    const validator = new ExternalSourceValidator();

    // Contradicting claimed section vs locator heading
    const mismatchRecord = {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: 'Valid extracted text for financial statements.',
      isVerbatimText: true,
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 201(4) Statement of Financial Position',
        elementId: 'pr201-4',
        startOffset: 100,
        endOffset: 250
      }
    };
    const res = validator.validateProvisionMapping(mismatchRecord);
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errorCode, 'PROVISION_MAPPING_MISMATCH');
    assert.ok(res.reason.includes('contradicts locator heading'));

    // Inverted or non-positive boundary offsets (endOffset <= startOffset)
    const invalidOffsetsRecord = {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: 'Valid extracted text for financial statements.',
      isVerbatimText: true,
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 201(5)',
        elementId: 'pr201-5',
        startOffset: 500,
        endOffset: 200 // Invalid!
      }
    };
    const resOffset = validator.validateProvisionMapping(invalidOffsetsRecord);
    assert.strictEqual(resOffset.isValid, false);
    assert.strictEqual(resOffset.errorCode, 'PROVISION_MAPPING_MISMATCH');
    assert.ok(resOffset.reason.includes('boundary offsets are invalid'));
  });

  await itAsync('11F (Test 6). Precision update gating: Peripheral document changes modify documentHash but leave provisionHash identical (0 updates emitted)', async () => {
    const ssoAdapter = new SSOUpdateAdapter();
    const docHashOriginal = computeSha256(ssoHtmlFixture);
    const extractionOriginal = extractSSOProvision(ssoHtmlFixture);
    const provHashOriginal = computeProvisionHash('CoA1967', 'Section 201(5)', extractionOriginal.text);

    // Modify peripheral HTML: footer copyright, cookie consent banner, navigation styling
    const peripheralModifiedHtml = ssoHtmlFixture
      .replace('<footer>', '<footer>Notice: Updated Cookie Policy & Navigation System 2027. ')
      .replace('<div class="header">', '<div class="header" data-build="build-9921">');

    const docHashModified = computeSha256(peripheralModifiedHtml);
    assert.notStrictEqual(docHashOriginal, docHashModified, 'documentHash MUST change upon peripheral webpage changes');

    // Extract provision from modified HTML
    const extractionPeripheral = extractSSOProvision(peripheralModifiedHtml);
    assert.strictEqual(extractionPeripheral.extractionStatus, 'EXACT');
    const provHashPeripheral = computeProvisionHash('CoA1967', 'Section 201(5)', extractionPeripheral.text);

    // Invariant: provisionHash is 100% invariant to peripheral document changes
    assert.strictEqual(provHashOriginal, provHashPeripheral, 'provisionHash must remain identical despite peripheral changes');

    // Baseline record with current provisionHash
    const activeBaselineRecord = {
      id: 'COA_SEC_201_5_BASELINE',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: extractionOriginal.text,
      provisionHash: provHashOriginal,
      contentHash: provHashOriginal,
      sourceStatus: 'VERIFIED',
      isVerbatimText: true,
      authority: 'ACRA'
    };

    const mockRetriever = {
      fetchOfficialSource: async () => ({
        status: 'SUCCESS',
        content: peripheralModifiedHtml,
        retrievedAt: new Date().toISOString(),
        httpStatus: 200
      })
    };

    // Query adapter against active baseline
    const updateResult = await ssoAdapter.checkForUpdates(mockRetriever, [activeBaselineRecord]);

    // Invariant: No spurious update package emitted!
    assert.strictEqual(updateResult, null, 'Expected null update package when statutory provision is unchanged');
  });

  await itAsync('11G (Test 7). True provision change: Modifying statutory wording updates provisionHash and triggers valid update package', async () => {
    const ssoAdapter = new SSOUpdateAdapter();
    const extractionOriginal = extractSSOProvision(ssoHtmlFixture);
    const baselineProvHash = computeProvisionHash('CoA1967', 'Section 201(5)', extractionOriginal.text);

    const activeBaselineRecord = {
      id: 'COA_SEC_201_5_BASELINE',
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967',
      sourceText: extractionOriginal.text,
      provisionHash: baselineProvHash,
      contentHash: baselineProvHash,
      sourceStatus: 'VERIFIED',
      isVerbatimText: true,
      authority: 'ACRA'
    };

    // Make an authentic statutory amendment in Section 201(5)
    const amendedHtml = ssoHtmlFixture.replace(
      'Accounting Standards Act 2007',
      'Accounting and Corporate Standards Act 2027'
    );

    const amendedExtraction = extractSSOProvision(amendedHtml);
    assert.strictEqual(amendedExtraction.extractionStatus, 'EXACT');
    const amendedProvHash = computeProvisionHash('CoA1967', 'Section 201(5)', amendedExtraction.text);

    assert.notStrictEqual(baselineProvHash, amendedProvHash, 'provisionHash MUST change when statutory wording changes');

    const mockRetriever = {
      fetchOfficialSource: async () => ({
        status: 'SUCCESS',
        content: amendedHtml,
        retrievedAt: new Date().toISOString(),
        httpStatus: 200
      })
    };

    const updatePkg = await ssoAdapter.checkForUpdates(mockRetriever, [activeBaselineRecord]);
    assert.ok(updatePkg);
    assert.strictEqual(updatePkg.updates.length, 1);
    assert.strictEqual(updatePkg.updates[0].provisionHash, amendedProvHash);
    assert.strictEqual(updatePkg.updates[0].extractionStatus, 'EXACT');
    assert.ok(updatePkg.updates[0].sourceText.includes('Accounting and Corporate Standards Act 2027'));
  });

  it('11H (Test 8). No hard-coded fallback: Missing target section produces FAILED status and empty text', () => {
    const irrelevantHtml = '<!DOCTYPE html><html><body><h1>General Announcement</h1><p>No statutory sections here.</p></body></html>';

    const ssoRes = extractSSOProvision(irrelevantHtml);
    assert.strictEqual(ssoRes.extractionStatus, 'FAILED');
    assert.strictEqual(ssoRes.text, '');
    assert.deepStrictEqual(ssoRes.sourceLocator, {});

    const irasRes = extractIRASProvision(irrelevantHtml);
    assert.strictEqual(irasRes.extractionStatus, 'FAILED');
    assert.strictEqual(irasRes.text, '');

    const acraRes = extractACRAProvision(irrelevantHtml);
    assert.strictEqual(acraRes.extractionStatus, 'FAILED');
    assert.strictEqual(acraRes.text, '');

    const momRes = extractMOMProvision(irrelevantHtml);
    assert.strictEqual(momRes.extractionStatus, 'FAILED');
    assert.strictEqual(momRes.text, '');

    const cpfRes = extractCPFProvision(irrelevantHtml);
    assert.strictEqual(cpfRes.extractionStatus, 'FAILED');
    assert.strictEqual(cpfRes.text, '');

    const fxRes = extractFrankfurterProvision('{"error":"Invalid currency pair"}');
    assert.strictEqual(fxRes.extractionStatus, 'FAILED');
    assert.strictEqual(fxRes.text, '');
  });

  it('11I (Test 9). Hash independence: Independent mathematical derivation of documentHash vs provisionHash', () => {
    const rawDocument = ssoHtmlFixture;
    const documentHash = computeSha256(rawDocument);

    const extraction = extractSSOProvision(rawDocument);
    const provisionHash = computeProvisionHash(
      extraction.standardOrActCode,
      extraction.paragraphOrSection,
      extraction.text
    );

    // Verify independent derivation
    const manualDocHash = crypto.createHash('sha256').update(rawDocument).digest('hex');
    assert.strictEqual(documentHash, manualDocHash);

    const canonicalPayload = `${extraction.standardOrActCode}|||${extraction.paragraphOrSection}|||${extraction.text}`;
    const manualProvHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
    assert.strictEqual(provisionHash, manualProvHash);

    // Verify non-dependence: altering outer document whitespace changes documentHash without altering provisionHash
    const formattedRawDoc = rawDocument + '\n\n   <!-- trailing comment -->   ';
    const newDocHash = computeSha256(formattedRawDoc);
    const newExtraction = extractSSOProvision(formattedRawDoc);
    const newProvHash = computeProvisionHash(
      newExtraction.standardOrActCode,
      newExtraction.paragraphOrSection,
      newExtraction.text
    );

    assert.notStrictEqual(documentHash, newDocHash);
    assert.strictEqual(provisionHash, newProvHash);
  });

  it('11J (Test 10). Frankfurter source separation: Tagged REFERENCE_API and strictly separated from statutory authority', () => {
    const validator = new ExternalSourceValidator();
    const extraction = extractFrankfurterProvision(frankfurterJsonFixture, 'SGD', ['USD', 'EUR']);

    assert.strictEqual(extraction.extractionStatus, 'EXACT');
    assert.ok(extraction.fxObservation);
    assert.strictEqual(extraction.fxObservation.sourceAuthority, 'REFERENCE_API');
    assert.strictEqual(extraction.fxObservation.provider, 'FRANKFURTER');
    assert.strictEqual(extraction.fxObservation.base, 'SGD');
    assert.strictEqual(extraction.fxObservation.rates['USD'], 0.7412);
    assert.strictEqual(extraction.fxObservation.rates['EUR'], 0.6845);

    const fxUrl = 'https://api.frankfurter.dev/v1/latest?base=SGD&symbols=USD,EUR';

    // Invariant: REFERENCE_API cannot satisfy statutory AGC/SSO or IRAS canonical validation
    const agcCheck = validator.validateCanonicalUrl(fxUrl, 'AGC');
    assert.strictEqual(agcCheck.isValid, false);
    assert.strictEqual(agcCheck.errorCode, 'CANONICAL_URL_MISMATCH');

    const irasCheck = validator.validateCanonicalUrl(fxUrl, 'IRAS');
    assert.strictEqual(irasCheck.isValid, false);
    assert.strictEqual(irasCheck.errorCode, 'CANONICAL_URL_MISMATCH');

    // Only REFERENCE_API authority accepts frankfurter.dev
    const refCheck = validator.validateCanonicalUrl(fxUrl, 'REFERENCE_API');
    assert.strictEqual(refCheck.isValid, true);
  });

  console.log('=============================================================');
  console.log(`ALL ${passedTests}/${totalTests} PHASE 4 TESTS PASSED! (100% GREEN) 🎉`);
  console.log('=============================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
