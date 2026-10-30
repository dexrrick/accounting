import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getMomAcraMasExpansionEvidence,
  hasMomAcraMasExpansionContradiction,
  selectMomAcraMasExpansionQuotes,
  supportMomAcraMasExpansionRule,
  MAS_VCFM_TOOLKIT_URL
} from '../../src/retrieval/momAcraMasExpansionRules.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { extractPdfDocumentText } from '../../src/retrieval/pdfDocumentTextExtractor.ts';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';

const fixture = name => readFileSync(fileURLToPath(new URL(`../fixtures/statutoryExpansionSources/${name}`, import.meta.url)), 'utf8');
const momHtmlBytes = readFileSync(fileURLToPath(new URL('../fixtures/statutoryExpansionSources/mom-salary-deductions-native.html', import.meta.url)));
const acraHtmlBytes = readFileSync(fileURLToPath(new URL('../fixtures/statutoryExpansionSources/acra-company-secretary-native.html', import.meta.url)));
const momHtml = momHtmlBytes.toString('utf8');
const acraHtml = acraHtmlBytes.toString('utf8');
const momText = cleanHtmlText(momHtml);
const acraText = cleanHtmlText(acraHtml);
const momProductionValidation = defaultExternalSourceValidator.validateTopicContent(momHtml, {
  standardIdentifiers: ['MOM'], expectedTitles: ['Salary deductions'], topicTerms: ['salary'],
  requireSubstantiveBody: true
});
assert.equal(momProductionValidation.isValid, true, 'The native MOM page passes the production topic validator.');
const momProductionText = momProductionValidation.substantiveText ?? '';
const masPdf = readFileSync(fileURLToPath(new URL('../fixtures/statutoryExpansionSources/mas-vcfm-toolkit.pdf', import.meta.url)));
const masPdfTextExtraction = await extractPdfDocumentText(masPdf);
const masPdfText = masPdfTextExtraction.text;
const masPdfTitle = 'Compliance Toolkit for Venture Capital Fund Managers';
const misconductFaqPdf = readFileSync(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261030/mas-misconduct-faq-native.pdf', import.meta.url)));
const misconductFaqTextExtraction = await extractPdfDocumentText(misconductFaqPdf);
const misconductFaqText = misconductFaqTextExtraction.text;
const misconductFaqManifest = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261030/expansion-source-manifest.json', import.meta.url)), 'utf8'));
const misconductFaqCapture = misconductFaqManifest.sources.find(source => source.fixture === 'mas-misconduct-faq-native.pdf');
assert.ok(misconductFaqCapture, 'the current MAS nil-return FAQ has a retained native source manifest entry');
assert.equal(createHash('sha256').update(misconductFaqPdf).digest('hex'), misconductFaqCapture.sha256,
  'the current MAS nil-return PDF bytes match their retained source manifest digest');
assert.equal(misconductFaqPdf.subarray(0, 5).toString('ascii'), '%PDF-', 'the FAQ fixture retains native PDF bytes');
assert.equal(misconductFaqTextExtraction.pageCount, 12, 'the native FAQ PDF extracts all twelve pages');
const misconductFaqUrl = misconductFaqCapture.url;
const misconductFaqTitle = misconductFaqCapture.title;
assert.match(masPdfTextExtraction.pageTexts[0], /COMPLIANCE TOOLKIT FOR\s+VENTURE CAPITAL FUND MANAGERS/i,
  'The validator title comes from the retained PDF first page.');
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const masPdfHtml = `<html><head><title>${masPdfTitle}</title></head><body><h1>${masPdfTitle}</h1><p>${escapeHtml(masPdfText).replace(/\r?\n/g, '<br>')}</p></body></html>`;
const masPdfValidation = defaultExternalSourceValidator.validateTopicContent(masPdfHtml, {
  standardIdentifiers: ['MAS'], expectedTitles: ['Venture Capital Fund Managers'], topicTerms: ['VCFM'],
  minimumTopicTermMatches: 1, requireSubstantiveBody: true
});
assert.equal(masPdfValidation.isValid, true, 'The native PDF parser output passes the default content validator wrapper.');
assert.match(masPdfValidation.pageTitle ?? '', /Venture Capital Fund Managers/i);
const masPdfValidatorText = masPdfValidation.substantiveText ?? '';

assert.equal(MAS_VCFM_TOOLKIT_URL,
  'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit--vcfms29-may-2026-clean.pdf');
assert.equal(createHash('sha256').update(momHtmlBytes).digest('hex'), '9c70f7305f2d41440ea82f194d517f4ee5c235c117dab04fc3a09105355a9aac',
  'The MOM fixture is the retained current official HTML response.');
assert.equal(createHash('sha256').update(acraHtmlBytes).digest('hex'), '53db082b8686ee7cea205d7ce29c5fde6de51e16a7c389acb8241322d0560956',
  'The ACRA fixture is the retained current official HTML response.');
assert.equal(masPdf.subarray(0, 5).toString('ascii'), '%PDF-', 'The fixture retains raw official PDF bytes.');
assert.equal(masPdfTextExtraction.pageCount, 10, 'The retained toolkit extracts all ten pages.');
assert.equal(createHash('sha256').update(masPdf).digest('hex'), '98e89fb58014311bd5840cd76110b82e4c268189fe0d6d53572100e6a425f440',
  'The retained toolkit PDF matches its recorded full-document SHA-256.');

const cases = [
  {
    authority: 'MOM', topicId: 'mom-salary-payment', domain: 'MOM_EMPLOYMENT', population: 'Employee',
    subject: 'Employment Act salary deductions',
    query: 'What salary deduction rules apply under the Employment Act?', sourceText: momText,
    url: 'https://www.mom.gov.sg/employment-practices/salary/salary-deductions',
    title: 'Allowable salary deductions | Ministry of Manpower', expected: '50% cap per salary period'
  },
  {
    authority: 'ACRA', topicId: 'acra_company-secretary', domain: 'ACRA_CORPORATE', population: 'Company',
    subject: 'Company secretary appointment deadline, eligibility and responsibilities',
    query: 'What are the general eligibility requirements for a company secretary?', sourceText: acraText,
    url: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/',
    title: 'Step 4.3: Choosing company directors & other key officers', expected: 'real person'
  },
  {
    authority: 'MAS', topicId: 'mas-regulatory-reporting', domain: 'MAS_FUNDS', population: 'Company',
    subject: 'VCFM Form 25A annual declarations',
    query: 'What annual declarations must a VCFM file with MAS after financial year end?', sourceText: masPdfText,
    url: MAS_VCFM_TOOLKIT_URL, title: masPdfTitle, expected: 'one month after its financial year end'
  },
  {
    authority: 'MAS', topicId: 'mas-regulatory-reporting', domain: 'MAS_FUNDS', population: 'Company',
    subject: 'VCFM nil misconduct return filing requirement',
    query: 'For calendar year 2026, does a VCFM need to submit a nil misconduct return, and what does the change from 1 January 2027 mean?', sourceText: misconductFaqText,
    url: misconductFaqUrl, title: misconductFaqTitle, expected: 'calendar year ending 31 December 2026', sourceBytes: misconductFaqPdf
  }
];

function evidenceFor(sample, overrides = {}) {
  const issueId = overrides.issueId || 'expansion-issue';
  const sourceUrl = overrides.sourceUrl || sample.url;
  const documentHash = overrides.documentHash || (sample.authority === 'MAS'
    ? createHash('sha256').update(sample.sourceBytes || masPdf).digest('hex') : 'a'.repeat(64));
  const retrievedAt = '2026-10-26T02:00:00Z';
  const makeClaim = (text, hash = documentHash) => ({
    text,
    supportKind: 'EXACT_SOURCE_QUOTE',
    issueIds: overrides.claimIssueIds || [issueId],
    provenance: 'LIVE_EXTERNAL',
    ...(overrides.validTo ? { validTo: overrides.validTo } : {}),
    fetchedSourceBinding: {
      recordId: 'official-source-revision', documentHash: hash, canonicalUrl: sourceUrl, retrievedAt
    }
  });
  const deadlineStart = sample.sourceText.indexOf('Within 1 month');
  const splitAt = deadlineStart > 0 ? deadlineStart : Math.floor(sample.sourceText.length / 2);
  const claims = overrides.splitDocument
    ? [makeClaim(sample.sourceText.slice(0, splitAt), 'a'.repeat(64)),
      makeClaim(sample.sourceText.slice(splitAt), 'b'.repeat(64))]
    : [makeClaim(overrides.claimText || sample.sourceText)];
  const issue = {
    id: issueId, subject: overrides.subject || sample.subject, population: overrides.population || sample.population,
    operation: overrides.operation || 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED',
    applicationStatus: 'UNRESOLVED', claims: [], gaps: []
  };
  const source = {
    key: 'official-source', title: sample.title, publisher: sample.authority, documentTitle: sample.title,
    officialUrl: sourceUrl, provenance: overrides.provenance || 'LIVE_EXTERNAL',
    ...(overrides.sourceValidTo ? { validTo: overrides.sourceValidTo } : {}), claims
  };
  const stream = {
    authority: sample.authority, domain: overrides.domain || sample.domain,
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [issue], sources: [source]
  };
  return getMomAcraMasExpansionEvidence(sample.query, stream, issue);
}

for (const sample of cases) {
  const request = {
    authority: sample.authority, topicId: sample.topicId, query: sample.query,
    subject: sample.subject, sourceText: sample.sourceText, officialUrl: sample.url
  };
  assert.equal(supportMomAcraMasExpansionRule(request), true,
    `${sample.authority} complete official passage proves the supported rule.`);
  if (sample.authority === 'MOM') {
    assert.equal(supportMomAcraMasExpansionRule({ ...request, sourceText: momHtml }), true,
      'The source proof also accepts native MOM HTML directly.');
    assert.equal(supportMomAcraMasExpansionRule({ ...request, sourceText: momProductionText }), true,
      'The source proof also accepts MOM substantiveText from the production topic validator.');
    assert.ok(selectMomAcraMasExpansionQuotes({ ...request, sourceText: momProductionText }).length >= 2,
      'Both complete MOM source excerpts can be selected from production substantiveText.');
  } else if (sample.authority === 'ACRA') {
    assert.equal(supportMomAcraMasExpansionRule({ ...request, sourceText: acraHtml }), true,
      'The source proof also accepts native ACRA HTML directly.');
  } else if (sample.authority === 'MAS' && sample.url === MAS_VCFM_TOOLKIT_URL) {
    assert.equal(supportMomAcraMasExpansionRule({ ...request, sourceText: masPdfValidatorText }), true,
      'The source proof accepts the default validator output produced from the extracted official PDF.');
    assert.ok(selectMomAcraMasExpansionQuotes({ ...request, sourceText: masPdfValidatorText }).length > 0,
      'The same validator output supplies a bounded PDF-table-row quotation.');
  } else if (sample.authority === 'MAS') {
    assert.equal(supportMomAcraMasExpansionRule({ ...request, sourceText: masPdfText, officialUrl: MAS_VCFM_TOOLKIT_URL }), false,
      'The older toolkit 14-day row cannot support the current nil-return answer.');
    assert.equal(supportMomAcraMasExpansionRule({ ...request,
      sourceText: misconductFaqText.replace('No. MAS does not require', 'Yes. MAS requires'),
    }), false, 'A reversed FAQ answer cannot prove the nil-return transition.');
    assert.equal(supportMomAcraMasExpansionRule({ ...request, officialUrl: `${misconductFaqUrl}?revision=other` }), false,
      'A noncanonical FAQ URL cannot prove the current nil-return transition.');
    assert.equal(supportMomAcraMasExpansionRule({ ...request,
      query: 'For calendar year 2025, what nil misconduct return due date applied to our VCFM?',
    }), false, 'The 2026 FAQ does not claim a deadline for a different reporting year.');
  }
  assert.ok(selectMomAcraMasExpansionQuotes(request).some(quote => quote.length > 100),
    `${sample.authority} proof selects a substantial bounded source passage.`);
  const evidence = evidenceFor(sample);
  assert.ok(evidence, `${sample.authority} rule is rendered from issue-bound official evidence.`);
  assert.ok(evidence.text.includes(sample.expected), `${sample.authority} answer contains the requested usable detail.`);
  assert.equal(evidence.officialUrl, sample.url);
  if (sample.authority === 'ACRA') {
    assert.match(evidence.text, /vacant for more than six months/i);
    assert.match(evidence.text, /local residency rules/i);
    assert.match(evidence.text, /sole director/i);
  }
}

const mom = cases[0];
const momProductionRequest = { ...mom, sourceText: momProductionText };
const momSelectedClaims = selectMomAcraMasExpansionQuotes(momProductionRequest);
assert.equal(momSelectedClaims.length, 2, 'The complete production source yields two bounded MOM claims.');
const incidentalLevyStart = momProductionText.indexOf('The deduction also cannot contravene any other law.');
const incidentalLevyEnd = momProductionText.indexOf('\n\n• For deductions approved', incidentalLevyStart);
assert.ok(incidentalLevyStart >= 0 && incidentalLevyEnd > incidentalLevyStart,
  'The native production text contains the separate foreign-worker levy clause.');
const momCombinedClaims = [...momSelectedClaims,
  momProductionText.slice(incidentalLevyStart, incidentalLevyEnd)].join('\n\n');
const momCombinedRequest = { ...mom, sourceText: momCombinedClaims };
assert.equal(hasMomAcraMasExpansionContradiction(momCombinedRequest), false,
  'An incidental quote repeating the official negative levy rule is not treated as its reversal.');
assert.equal(supportMomAcraMasExpansionRule(momCombinedRequest), true,
  'Complete selected MOM evidence stays supported when same-document claims are appended.');
assert.ok(evidenceFor({ ...mom, sourceText: momCombinedClaims }),
  'The getter renders complete same-document MOM evidence with incidental source claims.');
const momDamageQuery = { ...momCombinedRequest,
  query: 'What limits apply to salary deductions for loss or damage under the Employment Act?',
  subject: 'Employment Act salary deduction grounds and limits'
};
assert.equal(hasMomAcraMasExpansionContradiction(momDamageQuery), false,
  'The focused loss-or-damage question is not vetoed by the repeated levy clause.');
assert.equal(supportMomAcraMasExpansionRule(momDamageQuery), true,
  'The focused loss-or-damage question retains the verified complete MOM rule.');
assert.ok(evidenceFor(momDamageQuery), 'The getter renders the root-reported MOM question.');
assert.equal(hasMomAcraMasExpansionContradiction({ ...mom,
  sourceText: momText.replace('25% of your 1 month&rsquo;s salary', 'a capped portion of your salary') }), false,
  'A missing damage cap is insufficient evidence, not a source contradiction.');
assert.equal(hasMomAcraMasExpansionContradiction({ ...mom,
  sourceText: momText.replace('25% of your 1 month&rsquo;s salary', '40% of your 1 month&rsquo;s salary') }), true,
  'An explicit conflicting damage cap is a source contradiction.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, sourceText: momText.replace('25% of your 1 month&rsquo;s salary', '40% of your 1 month&rsquo;s salary') }), false,
  'A conflicting damage deduction limit fails closed.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, sourceText: momText.replace('until you have had the opportunity to explain', 'without giving you an opportunity to explain') }), false,
  'Removing the employee opportunity-to-explain condition fails closed.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, sourceText: momText.replace('not allowed to deduct your salary to recover levy costs', 'allowed to deduct your salary to recover levy costs') }), false,
  'A source that reverses the foreign-worker levy rule fails closed.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, query: 'What salary deduction rules applied in 2024?' }), false,
  'A historical query is not answered from current guidance.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, query: 'What salary deduction rules apply this year, 2026?' }), true,
  'A current-year general question remains answerable.');
assert.equal(supportMomAcraMasExpansionRule({ ...mom, query: 'How much can my employer deduct from my salary?' }), false,
  'Personal and calculation questions remain outside the general rule response.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'What are the company secretary requirements as of today?' }), true,
  'An ordinary current/as-of-today question is not mistaken for a historical request.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'What were company secretary requirements before 26 October 2026?' }), false,
  'An explicit before-date cutoff remains historical.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'What were the company secretary requirements last month?' }), false,
  'A relative historical period remains out of scope.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'Can the sole director also act as the company secretary?' }), undefined,
  'The narrow sole-director question remains available to the existing exact-prohibition path.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'Can the sole director also be the company secretary?' }), undefined,
  'A sole-director-only paraphrase remains unowned by the broader expansion rule.');
assert.equal(supportMomAcraMasExpansionRule({ ...cases[1], query: 'Can the sole director serve as company secretary, and what residency, vacancy and appointment deadline requirements apply?' }), true,
  'The combined eligibility and vacancy question remains owned by the complete ACRA rule.');

const acra = cases[1];
assert.equal(hasMomAcraMasExpansionContradiction({ ...acra,
  sourceText: acraText.replace(/not be the same person as the sole director/i, '') }), false,
  'An omitted sole-director restriction is insufficient evidence, not a contradiction.');
assert.equal(hasMomAcraMasExpansionContradiction({ ...acra,
  sourceText: acraText.replace(/not be the same person as the sole director/i, 'may be the same person as the sole director') }), true,
  'An explicit reversal of the sole-director restriction is a source contradiction.');
assert.equal(supportMomAcraMasExpansionRule({ ...acra, sourceText: acraText.replace('secretary must be appointed within six months', 'secretary must be appointed within three months') }), false,
  'A conflicting appointment/vacancy period fails closed.');
assert.equal(supportMomAcraMasExpansionRule({ ...acra, sourceText: acraText.replace(/not be the same person as the sole director/i, 'May be the same person as the sole director') }), false,
  'A source that reverses the sole-director restriction fails closed.');

const masAnnual = cases[2];
assert.equal(hasMomAcraMasExpansionContradiction({ ...masAnnual,
  sourceText: masPdfText.replace('Within 1 month after', '') }), false,
  'A missing Form 25A deadline is insufficient evidence, not a contradiction.');
assert.equal(hasMomAcraMasExpansionContradiction({ ...masAnnual,
  sourceText: masPdfText.replace('Within 1 month after', 'Within 4 months after') }), true,
  'An explicit conflicting Form 25A deadline is a source contradiction.');
assert.equal(supportMomAcraMasExpansionRule({ ...masAnnual, sourceText: masPdfText.replace('Within 1 month after', 'Within 4 months after') }), false,
  'A wrong Form 25A deadline fails closed.');
assert.equal(supportMomAcraMasExpansionRule({ ...masAnnual, sourceText: masPdfText.replace('investor types and numbers', 'investor types only') }), false,
  'A source omitting declaration content fails closed.');

const masNil = cases[3];
assert.equal(hasMomAcraMasExpansionContradiction({ ...masNil,
  sourceText: misconductFaqText.replace('No. MAS does not require', 'Yes. MAS requires') }), true,
  'An explicit reversal of the current VCFM nil-return FAQ answer is a source contradiction.');
assert.equal(supportMomAcraMasExpansionRule({ ...masNil, query: 'What nil misconduct declaration must a VCFM submit for the preceding calendar year and when is it due?' }), true,
  'A current nil-return rule may describe the preceding calendar year without becoming a historical query.');
assert.equal(supportMomAcraMasExpansionRule({ ...masNil,
  sourceText: misconductFaqText.replace('No. MAS does not require', 'Yes. MAS requires') }), false,
  'The current FAQ cannot prove a nil-return obligation when its answer is reversed.');

for (const [label, overrides] of [
  ['wrong URL', { sourceUrl: 'https://example.com/mas.pdf' }],
  ['unbound claim', { claimIssueIds: ['another-issue'] }],
  ['claims split across document revisions', { splitDocument: true }],
  ['wrong authority domain', { domain: 'MOM_EMPLOYMENT' }],
  ['wrong population', { population: 'Employee' }],
  ['stale source', { sourceValidTo: '2025-12-31' }]
]) {
  assert.equal(evidenceFor(masAnnual, overrides), undefined, `MAS evidence is rejected for ${label}.`);
}

assert.equal(supportMomAcraMasExpansionRule({ ...mom, authority: 'ACRA' }), undefined,
  'A question owned by another authority is left unhandled.');
assert.equal(selectMomAcraMasExpansionQuotes({ ...masAnnual, sourceText: masAnnual.sourceText.replace('1 month', '4 months') }).length, 0,
  'No quotation is selected when the source fails full proof.');

console.log('MOM/ACRA/MAS statutory expansion rule checks passed.');
