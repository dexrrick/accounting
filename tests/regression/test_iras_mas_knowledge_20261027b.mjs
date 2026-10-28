import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import {
  IRAS_MAS_KNOWLEDGE_RULES_20261027B,
  IRAS_MAS_KNOWLEDGE_SOURCE_CATALOG_20261027B,
  getIrasMasKnowledgeEvidence,
  hasIrasMasKnowledgeContradiction,
  selectIrasMasKnowledgeQuotes,
  supportIrasMasKnowledgeRule
} from '../../src/retrieval/irasMasKnowledge20261027b.ts';

const fixtureRoot = new URL('../fixtures/statutoryKnowledge20261027b/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('iras-mas-source-manifest.json', fixtureRoot), 'utf8'));
const byUrl = new Map(manifest.sources.map(source => [source.url, source]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesFor = filename => readFileSync(new URL(filename, fixtureRoot));
const textFor = filename => bytesFor(filename).toString('utf8');

for (const source of manifest.sources) {
  assert.equal(sha256(bytesFor(source.fixture)), source.sha256, `${source.fixture} excerpt/native fixture hash`);
  if (source.fixtureKind === 'IRAS_NATIVE_HTML_PAGE') {
    assert.equal(source.rawSourceRetained, true, `${source.fixture} retains an unrewritten official response body`);
    assert.equal(source.sourceResponseSha256, source.sha256, `${source.fixture} binds the exact response hash`);
    assert.match(textFor(source.fixture), /<!doctype html|<html\b/i, `${source.fixture} is captured HTML`);
  }
  if (source.nativePdfFixture) {
    const pdf = bytesFor(source.nativePdfFixture);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-', 'MAS notice is retained as native PDF bytes');
    assert.equal(sha256(pdf), source.sourceResponseSha256, 'native MAS PDF response hash');
  }
}

const masSource = manifest.sources.find(source => source.authority === 'MAS');
const masPdfBytes = bytesFor(masSource.nativePdfFixture);
const masExtraction = await extractOfficialDocumentFromRetrieved({
  url: masSource.url, authority: 'MAS', domain: 'MAS_FUNDS', documentKind: 'PDF',
  standardOrActCode: 'SFA 04-N24', legalOrStandardInstrument: 'Securities and Futures Act 2001 Notice SFA 04-N24',
  expectedTopic: { standardIdentifiers: ['SFA 04-N24'],
    expectedTitles: ['NOTICE ON REPORTING'],
    topicTerms: ['CMS licence', 'representatives', 'misconduct'], minimumTopicTermMatches: 1 },
  topicIds: ['mas-regulatory-reporting']
}, { status: 'SUCCESS', httpStatus: 200, sourceUrl: masSource.url, finalUrl: masSource.url,
  contentType: 'application/pdf', contentBytes: new Uint8Array(masPdfBytes), retrievedAt: '2026-10-27T00:00:00.000Z' });
assert.equal(masExtraction.status, 'SUCCESS', masExtraction.status === 'REJECTED' ? masExtraction.reason : 'native MAS PDF extraction');
const masNativeText = masExtraction.record.sourceText;
assert.equal(masExtraction.record.documentHash, masSource.sourceResponseSha256,
  'native extracted record stays bound to the retained MAS PDF bytes');
assert.match(masNativeText, /takes effect from 1 January\s+2027/);
assert.match(masNativeText, /no later than 21 calendar days/);
assert.match(masNativeText, /the Cancelled Notice as in force immediately before 1\s+January 2027 continues to apply/);

const inputTax = IRAS_MAS_KNOWLEDGE_RULES_20261027B.filter(rule => rule.id.startsWith('IRAS_GST_'));
assert.equal(inputTax.length, 2);
assert.equal(inputTax[0].officialUrl, inputTax[1].officialUrl, 'medical/motor-car findings share the same captured source revision');
assert.equal(inputTax[0].fixture, inputTax[1].fixture, 'one fixture and hash cover the same IRAS page revision');
assert.equal(byUrl.get(inputTax[0].officialUrl).topicIds.includes('iras-gst-input-tax'), true);
assert.ok(inputTax[0].topicIds.includes('iras-gst-blocked-input-tax'));
assert.ok(inputTax[1].topicIds.includes('iras-gst-motor-vehicles'));
assert.ok(IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE').topicIds.includes('iras-wht-deemed-payment-date'));

const cases = [
  {
    id: 'staff-medical', authority: 'IRAS', topicId: 'iras-gst-input-tax',
    query: 'Can we claim input GST on routine annual staff checkups, and what work-related exception could change the result?',
    subject: 'GST input tax on staff medical expenses', url: inputTax[0].officialUrl,
    file: inputTax[0].fixture, expected: /regulation 26[\s\S]*on or after 1 Oct 2021[\s\S]*COVID-19[\s\S]*PCP/i
  },
  {
    id: 'motor-car', authority: 'IRAS', topicId: 'iras-gst-input-tax',
    query: 'Can we claim GST on our company car that employees use for client visits, and what about a taxi ride?',
    subject: 'GST input tax on motor car costs and transport services', url: inputTax[1].officialUrl,
    file: inputTax[1].fixture, expected: /Regulation 27[\s\S]*from 1 Apr 2022[\s\S]*from 1 Jan 2023[\s\S]*economic use[\s\S]*ancillary to any primary supply/i
  },
  {
    id: 'eci-waiver', authority: 'IRAS', topicId: 'iras-cit-eci',
    query: 'Can a company skip ECI when sales are S$7m but its tax computation has nil chargeable income?',
    subject: 'Company ECI waiver and nil ECI filing rule', url: IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_ECI_PRACTICAL_WAIVER').officialUrl,
    file: 'iras-mas-eci-native.html', expected: /taxable profits[\s\S]*within 3 months[\s\S]*both criteria[\s\S]*\$5 million[\s\S]*self-assess[\s\S]*still required to file/i
  },
  {
    id: 'wht-services', authority: 'IRAS', topicId: 'iras-withholding-tax',
    query: 'A non-resident engineering firm sends staff here for installation and management work. Which service fees can attract WHT?',
    subject: 'Withholding tax on Singapore work by non-resident service providers', url: IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_SERVICES').officialUrl,
    file: 'iras-mas-wht-services-native.html', expected: /work done in Singapore[\s\S]*electronic means from overseas[\s\S]*Where cost reimbursement payment is made on or before 31 Oct 2022[\s\S]*this administrative concession will be withdrawn[\s\S]*17%[\s\S]*DTA/i
  },
  {
    id: 'wht-date', authority: 'IRAS', topicId: 'iras-withholding-tax',
    query: 'How does IRAS determine the date of payment when working out a WHT due date?',
    subject: 'Withholding tax filing and payment deadline', url: IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE').officialUrl,
    file: 'iras-mas-wht-deadline-native.html', expected: /15\s*(?:th)?\s+of the second month[\s\S]*earliest[\s\S]*director's fees approved in arrears[\s\S]*director's fees approved in advance[\s\S]*25th[\s\S]*60-day period/i
  },
  {
    id: 'mas-new-notice', authority: 'MAS', topicId: 'mas-regulatory-reporting',
    query: 'Under Notice SFA 04-N24 from 1 January 2027, what starts the misconduct-report clock for a former representative?',
    subject: 'MAS manager reporting for misconduct by current or former representatives',
    url: IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027').officialUrl,
    file: 'iras-mas-misconduct.txt', expected: /takes effect from 1 January 2027[\s\S]*section 99\(1\)\(a\)[\s\S]*former representatives[\s\S]*no later than 21 calendar days[\s\S]*first has reasonable grounds[\s\S]*20 Despite paragraph 5[\s\S]*has not submitted to the Authority a Misconduct Report[\s\S]*after 1 January 2027[\s\S]*21 This Notice does not apply to or in relation to any of the following[\s\S]*by 31 December 2026[\s\S]*MASNET/i
  }
];

for (const scenario of cases) {
  const sourceText = scenario.authority === 'MAS' ? masNativeText : textFor(scenario.file);
  const request = { ...scenario, sourceText, officialUrl: scenario.url };
  assert.equal(supportIrasMasKnowledgeRule(request), true, `${scenario.id} complete official-source proof`);
  const quotes = selectIrasMasKnowledgeQuotes(request);
  assert.ok(quotes.length > 0, `${scenario.id} returns source passages`);
  assert.match(quotes.join('\n\n'), scenario.expected, `${scenario.id} selected quotes prove practical output claims`);
  assert.equal(supportIrasMasKnowledgeRule({ ...request, officialUrl: `${scenario.url}?wrong-source=1` }), false,
    `${scenario.id} rejects a changed source URL`);

  const issue = {
    id: `issue-${scenario.id}`, subject: scenario.subject, population: 'Company', operation: 'FILING_REQUIREMENT',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: []
  };
  const sourceEntry = manifest.sources.find(source => source.url === scenario.url);
  const sourceHash = sourceEntry.sourceResponseSha256 || sourceEntry.sha256;
  const presentedSource = {
    key: `source-${scenario.id}`, title: sourceEntry.title, publisher: scenario.authority,
    documentTitle: sourceEntry.title, officialUrl: scenario.url, provenance: 'LIVE_EXTERNAL',
    claims: [{ text: sourceText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issue.id], provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: { recordId: `record-${scenario.id}`, documentHash: sourceHash,
        canonicalUrl: scenario.url, retrievedAt: '2026-10-27T05:14:21Z' } }]
  };
  const domain = scenario.authority === 'MAS' ? 'MAS_FUNDS'
    : scenario.topicId === 'iras-gst-input-tax' ? 'IRAS_GST' : 'IRAS_CORPORATE_TAX';
  const stream = { id: `stream-${scenario.id}`, authority: scenario.authority, authorityLabel: scenario.authority,
    domain, domainLabel: domain, evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', issues: [issue],
    sources: [presentedSource], gaps: [] };
  const evidence = getIrasMasKnowledgeEvidence(scenario.query, stream, issue);
  assert.ok(evidence, `${scenario.id} general answer survives missing case facts`);
  assert.equal(evidence.officialUrl, scenario.url);
  assert.match(evidence.text, /requires|confirm|needs|conditions|facts/i, `${scenario.id} keeps case facts separate`);
  assert.equal(getIrasMasKnowledgeEvidence(scenario.query, stream, { ...issue, applicationStatus: 'VERIFIED' }), undefined,
    `${scenario.id} does not present a general answer as verified case application`);
}

const med = cases[0];
assert.equal(supportIrasMasKnowledgeRule({ ...med, sourceText: textFor(med.file).replace(/Input tax claims are disallowed under Regulation 26/g, 'Input tax claims are allowed under Regulation 26') }), false,
  'reversed blocked-claim polarity is rejected');
assert.equal(hasIrasMasKnowledgeContradiction({ ...med, sourceText: 'Staff medical expenses are always claimable; input tax claims are not disallowed under Regulation 26.' }), true,
  'owned-family contradiction veto is exposed for legacy fallback');
const whtServicesCase = cases.find(scenario => scenario.id === 'wht-services');
const whtServices = { ...whtServicesCase, officialUrl: whtServicesCase.url };
const whtServicesHtml = textFor(whtServices.file);
const oldCostPoolPassage = /Where cost reimbursement payment is made on or before 31 Oct 2022[\s\S]{0,450}?withholding tax is not applicable on such payment\./i;
assert.equal(supportIrasMasKnowledgeRule({ ...whtServices, sourceText: whtServicesHtml.replace(oldCostPoolPassage, '') }), false,
  'the post-1-Nov-2022 withdrawal requires the page passage identifying the earlier concession it withdraws');
const reversedCostPoolHtml = whtServicesHtml
  .replaceAll('this administrative concession will be withdrawn', 'this administrative concession will not be withdrawn')
  .replaceAll('Withholding tax will be applicable to any cost reimbursement payment liable to be made on or after 1 Nov 2022',
    'Withholding tax will not be applicable to any cost reimbursement payment liable to be made on or after 1 Nov 2022');
assert.equal(supportIrasMasKnowledgeRule({ ...whtServices, sourceText: reversedCostPoolHtml }), false,
  'a reversed cost-pooling transition cannot prove the current rule');
assert.match(selectIrasMasKnowledgeQuotes({ ...whtServices, sourceText: whtServicesHtml }).join('\n'),
  /Where cost reimbursement payment is made on or before 31 Oct 2022[\s\S]*this administrative concession will be withdrawn[\s\S]*cost-pooling arrangement/i,
  'the selected passage preserves the official antecedent and transition wording');
assert.doesNotMatch(selectIrasMasKnowledgeQuotes({ ...whtServices, sourceText: whtServicesHtml }).join('\n'),
  /cost-pooling administrative concession is withdrawn/i,
  'the answer proof does not rely on the paraphrased wording absent from IRAS');
const whtDeadlineCase = cases.find(scenario => scenario.id === 'wht-date');
const whtDeadline = { ...whtDeadlineCase, officialUrl: whtDeadlineCase.url };
const whtDeadlineFlattened = textFor(whtDeadline.file).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ');
assert.equal(supportIrasMasKnowledgeRule({ ...whtDeadline,
  sourceText: whtDeadlineFlattened.replace(/second\s+month\s+from/gi, 'following month from') }), false,
  'the 15th-of-second-month filing deadline is rejected when its period is changed');
const insurancePremiums = {
  ...med,
  topicId: 'iras-gst-blocked-input-tax',
  query: 'Can GST input tax on medical and accident insurance premiums be claimed under the work-risk medical treatment exception?',
  subject: 'GST input tax on employee medical and accident insurance premiums',
  sourceText: textFor(med.file), officialUrl: med.url
};
assert.equal(supportIrasMasKnowledgeRule(insurancePremiums), false,
  'the medical-treatment family excludes insurance premiums even though the source contains the treatment exception');
assert.deepEqual(selectIrasMasKnowledgeQuotes(insurancePremiums), [],
  'the treatment exception quotes are not selected for insurance-premium questions');
assert.equal(hasIrasMasKnowledgeContradiction(insurancePremiums), true,
  'an excluded insurance-premium premise vetoes legacy generic support in this owned family');
const insuranceIssue = { id: 'issue-medical-insurance', subject: insurancePremiums.subject, population: 'Company',
  operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const inputTaxSource = byUrl.get(med.url);
const insuranceStream = { id: 'stream-medical-insurance', authority: 'IRAS', authorityLabel: 'IRAS',
  domain: 'IRAS_GST', domainLabel: 'IRAS GST', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED',
  issues: [insuranceIssue], gaps: [], sources: [{ key: 'source-medical-insurance', title: inputTaxSource.title,
    publisher: 'IRAS', documentTitle: inputTaxSource.title, officialUrl: med.url, provenance: 'LIVE_EXTERNAL',
    claims: [{ text: insurancePremiums.sourceText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [insuranceIssue.id],
      provenance: 'LIVE_EXTERNAL', fetchedSourceBinding: { recordId: 'record-medical-insurance',
        documentHash: inputTaxSource.sourceResponseSha256, canonicalUrl: med.url, retrievedAt: '2026-10-27T05:14:21Z' } }] }] };
assert.equal(getIrasMasKnowledgeEvidence(insurancePremiums.query, insuranceStream, insuranceIssue), undefined,
  'general medical-treatment evidence cannot answer a medical-insurance-premium question');
const motor = cases[1];
const compoundMedicalAndMotorQuery = 'Explain GST input tax recovery for staff medical expenses and company car expenses.';
const medicalOnlyEvidenceForMotorIssue = {
  ...motor, query: compoundMedicalAndMotorQuery, subject: 'GST input tax on motor car expenses',
  sourceText: textFor(med.file), officialUrl: motor.url
};
assert.equal(supportIrasMasKnowledgeRule(medicalOnlyEvidenceForMotorIssue), false,
  'medical-only passages cannot support a motor-car issue even when the original query leads with staff medical expenses');
assert.deepEqual(selectIrasMasKnowledgeQuotes(medicalOnlyEvidenceForMotorIssue), [],
  'a compound query is not answered by selecting only the first matching family');
assert.equal(hasIrasMasKnowledgeContradiction(medicalOnlyEvidenceForMotorIssue), true,
  'compound cross-family issues veto legacy first-match support');
const motorOnlyEvidenceForMedicalIssue = {
  ...med, query: compoundMedicalAndMotorQuery, subject: 'GST input tax on staff medical expenses',
  sourceText: textFor(motor.file), officialUrl: med.url
};
assert.equal(supportIrasMasKnowledgeRule(motorOnlyEvidenceForMedicalIssue), false,
  'motor-only passages cannot support a staff-medical issue');
assert.deepEqual(selectIrasMasKnowledgeQuotes(motorOnlyEvidenceForMedicalIssue), [],
  'the reciprocal compound issue is not answered from only motor-car passages');
assert.equal(hasIrasMasKnowledgeContradiction(motorOnlyEvidenceForMedicalIssue), true,
  'the reciprocal cross-family issue also vetoes legacy first-match support');
assert.equal(supportIrasMasKnowledgeRule({ ...med, query: 'Can we recover GST on staff medical treatment?',
  subject: 'GST input tax on motor car expenses', sourceText: textFor(med.file) }), false,
  'a medical-only query cannot override a motor-car concept subject');
const eci = cases[2];
assert.equal(supportIrasMasKnowledgeRule({ ...eci, query: 'For YA 2024, can this historical company skip ECI if revenue is S$5m or below and ECI is nil?', sourceText: textFor(eci.file) }), false,
  'current source capture does not establish an older YA rule');
const futureMisconduct = cases[5];
assert.equal(supportIrasMasKnowledgeRule({ ...futureMisconduct, query: 'What were misconduct reporting deadlines for former representatives in 2026?', sourceText: masNativeText }), undefined,
  'future Notice is not applied to a 2026 reporting period');
const mixedNoticeDate = { ...futureMisconduct,
  query: 'Does the 1 January 2027 misconduct notice already govern an October 2026 report?',
  subject: 'Misconduct reporting for representatives', sourceText: masNativeText };
assert.equal(supportIrasMasKnowledgeRule(mixedNoticeDate), false,
  'the future Notice does not establish that it governed an October 2026 report');
assert.equal(hasIrasMasKnowledgeContradiction(mixedNoticeDate), true,
  'unsupported temporal scope in an owned future-Notice question vetoes generic legacy fallback');
const generalLfmcQuestion = { ...futureMisconduct,
  query: 'What are the general financial-return obligations for an LFMC in 2026?',
  subject: 'LFMC general financial returns', sourceText: masNativeText };
assert.equal(supportIrasMasKnowledgeRule(generalLfmcQuestion), undefined,
  'general LFMC returns remain outside the future misconduct-notice family');
assert.equal(hasIrasMasKnowledgeContradiction(generalLfmcQuestion), false,
  'the temporal veto does not block unowned general LFMC questions');
const masExcerptRequest = { ...futureMisconduct, sourceText: textFor(futureMisconduct.file) };
assert.equal(supportIrasMasKnowledgeRule(masExcerptRequest), true,
  'the retained bounded excerpt preserves the same native paragraph proof');
assert.deepEqual(selectIrasMasKnowledgeQuotes(masExcerptRequest), selectIrasMasKnowledgeQuotes({ ...futureMisconduct, sourceText: masNativeText }),
  'the excerpt fixture contains the same five passages selected from the retained native PDF');
assert.equal(supportIrasMasKnowledgeRule({ ...futureMisconduct,
  sourceText: masNativeText.replace(/takes effect from 1 January\s+2027/, 'takes effect from 1 January 2026') }), false,
  'native source passage with a shifted commencement date is rejected');
assert.equal(supportIrasMasKnowledgeRule({ ...futureMisconduct,
  sourceText: masNativeText.replaceAll('the CMI must submit a Misconduct Report', 'the CMI must not submit a Misconduct Report') }), false,
  'native source passage with the reporting duty negated is rejected');
const treatyZeroWht = {
  authority: 'IRAS', topicId: 'iras-wht-treaty-relief',
  query: 'If the DTA reduces withholding tax to zero, does the payer still have to file?',
  subject: 'WHT filing duty despite zero treaty rate', officialUrl: IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE').officialUrl,
  sourceText: textFor('iras-mas-wht-deadline-native.html')
};
assert.equal(supportIrasMasKnowledgeRule(treatyZeroWht), true,
  'treaty-zero filing questions route to the complete WHT filing-duty family without requiring a due-date phrase');
assert.match(selectIrasMasKnowledgeQuotes(treatyZeroWht).join('\n'), /WHT must be filed even if[\s\S]*Agreement \(DTA\) or Approved Royalties Incentive \(ARI\)/i);
const whtFilingRule = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE');
const whtVisibleExtraction = defaultExternalSourceValidator.validateTopicContent(textFor(whtFilingRule.fixture), {
  standardIdentifiers: ['IRAS'], expectedTitles: [whtFilingRule.title],
  topicTerms: ['withholding tax', 'filing and payment due date'], allowIrasTopicTokenEquivalence: true
});
assert.equal(whtVisibleExtraction.isValid, true, 'the official filing page passes production visible-text validation');
const extractedTreatyZeroWht = {
  authority: 'IRAS', topicId: 'iras-withholding-tax',
  query: 'If a treaty reduces withholding tax to zero, can we omit the WHT filing?',
  subject: 'Withholding tax filing requirement when treaty rate is zero',
  officialUrl: whtFilingRule.officialUrl,
  sourceText: whtVisibleExtraction.substantiveText
};
assert.match(extractedTreatyZeroWht.sourceText, /For director[’']s fees\s+•\s+When the payment is due/i,
  'visible-text extraction retains decorative list markers at the director-fee heading');
assert.equal(supportIrasMasKnowledgeRule(extractedTreatyZeroWht), true,
  'the complete WHT filing family survives visible HTML extraction with bullet markers');
assert.equal(selectIrasMasKnowledgeQuotes(extractedTreatyZeroWht).length, 6,
  'all six filing, timing, deemed-payment, director-fee, GIRO and consolidation passages remain required');
assert.equal(supportIrasMasKnowledgeRule({ ...extractedTreatyZeroWht,
  query: 'A non-resident consultancy performs work in Singapore and overseas. Which service fees attract WHT?',
  subject: 'Withholding tax on non-resident consultancy service fees'
}), false, 'a service-fee question cannot be proved by the WHT filing-date page');
assert.equal(supportIrasMasKnowledgeRule({ authority: 'MAS', topicId: 'mas-quarterly-fund-data-collection',
  query: 'What QDC return must a fund manager submit?', subject: 'QDC reporting', sourceText: '' }), undefined,
  'QDC remains unowned without primary-source proof');
assert.ok(IRAS_MAS_KNOWLEDGE_SOURCE_CATALOG_20261027B.some(entry => entry.nativePdfFixture === 'iras-mas-misconduct-native.pdf'));
console.log(`IRAS/MAS 20261027b source-backed rules: ${cases.length}/${cases.length}; independent practical questions answered; QDC unsupported without primary-source evidence.`);
