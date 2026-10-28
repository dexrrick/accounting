import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import {
  calculateCpfPayroll2026,
  getCpfPayrollKnowledgeEvidence,
  hasCpfPayrollKnowledgeContradiction,
  selectCpfPayrollKnowledgeQuotes,
  supportCpfPayrollKnowledgeRule,
  CPF_PAYROLL_KNOWLEDGE_RULES_20261027B
} from '../../src/retrieval/cpfPayrollKnowledge20261027b.ts';
import {
  hasPracticalExpansionContradiction,
  selectPracticalExpansionQuotes,
  supportPracticalExpansionRule
} from '../../src/retrieval/practicalStatutoryExpansion.ts';

const fixtureDir = new URL('../fixtures/statutoryKnowledge20261027b/', import.meta.url);
const readText = name => readFileSync(new URL(name, fixtureDir), 'utf8').replace(/^\uFEFF/, '').trim();
const sourceBody = text => text.replace(/^SOURCE CAPTURE METADATA[\s\S]*?\n\n/, '').trim();
const rateFixture = readText('cpf-rate-tables-2026-extract.txt');
const computationFixture = readText('cpf-computation-guidance-extract.txt');
const owFixture = readText('cpf-ow-ceiling-extract.txt');
const awFixture = readText('cpf-aw-ceiling-2026-extract.txt');
const prFixture = readText('cpf-pr-year-status-extract.txt');
const rateText = sourceBody(rateFixture);
const computationText = sourceBody(computationFixture);
const owText = sourceBody(owFixture);
const awText = sourceBody(awFixture);
const prText = sourceBody(prFixture);
const manifest = JSON.parse(readText('cpf-source-manifest.json'));

for (const [sourceId, ruleId, fixture] of [
  ['ow-ceiling', 'CPF_ORDINARY_WAGE_CEILINGS', owFixture],
  ['pr-status', 'CPF_PERMANENT_RESIDENT_YEAR', prFixture]
]) {
  const source = manifest.sources.find(item => item.id === sourceId);
  const rule = CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(item => item.id === ruleId);
  const fixtureTitle = fixture.match(/^Page title: (.+)$/m)?.[1];
  assert.ok(source && rule && fixtureTitle, `${sourceId} official page metadata exists`);
  assert.equal(source.title, fixtureTitle, `${sourceId} manifest title matches the captured official page title`);
  assert.equal(rule.title, fixtureTitle, `${sourceId} knowledge title matches the captured official page title`);
}
assert.ok(owText.includes('for all employees. It was gradually raised and has reached $8,000 in 2026.'),
  'OW source proof retains the official population and 2026 ceiling text.');
assert.ok(prText.includes('First-year rate: Applies from the day you obtain your SPR status, [i.e. the date indicated on your Entry Permit (Form 5/5A) issued by the Immigration & Checkpoints Authority (ICA)]'),
  'PR source proof retains the Entry Permit date qualifier as shown on the official page.');

for (const source of manifest.sources) {
  const excerptBytes = readFileSync(new URL(source.fixture, fixtureDir));
  assert.equal(createHash('sha256').update(excerptBytes).digest('hex'), source.excerptSha256, `${source.id} excerpt digest`);
  if (source.nativePdfFixture) {
    const documentBytes = readFileSync(new URL(source.nativePdfFixture, fixtureDir));
    assert.equal(createHash('sha256').update(documentBytes).digest('hex'), source.sha256, `${source.id} native PDF digest`);
    assert.equal(source.fixtureKind, 'NATIVE_OFFICIAL_PDF');
    assert.equal(documentBytes.subarray(0, 5).toString('ascii'), '%PDF-');
  } else {
    assert.equal(createHash('sha256').update(excerptBytes).digest('hex'), source.sha256, `${source.id} visible excerpt digest`);
  }
}

const requests = [
  {
    authority: 'CPF', topicId: 'cpf_contribution_rates', query: 'What CPF contribution rates apply in 2026?',
    subject: 'CPF contribution rate table', sourceText: rateText,
    officialUrl: 'https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf'
  },
  {
    authority: 'CPF', topicId: 'cpf-contribution-computation', query: 'How do I calculate monthly CPF contributions in 2026?',
    subject: 'CPF contribution calculation steps', sourceText: computationText,
    officialUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'
  },
  {
    authority: 'CPF', topicId: 'cpf-ordinary-wages', query: 'What is the CPF ordinary wage ceiling in 2026?',
    subject: 'CPF ordinary wage ceiling', sourceText: owText,
    officialUrl: 'https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling-mbr'
  },
  {
    authority: 'CPF', topicId: 'cpf-additional-wage-ceiling', query: 'How is the 2026 CPF additional wage ceiling computed?',
    subject: 'CPF additional wage ceiling', sourceText: awText,
    officialUrl: 'https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000KUuZCYA1'
  },
  {
    authority: 'CPF', topicId: 'cpf-pr-contribution-rates', query: 'When does an SPR move into the second year of CPF contributions?',
    subject: 'SPR year of status timing', sourceText: prText,
    officialUrl: 'https://www.cpf.gov.sg/service/article/i-have-successfully-applied-for-a-new-re-entry-permit-and-retained-my-singapore-permanent-resident-status-how-will-this-impact-my-cpf-contributions'
  }
];

for (const request of requests) {
  assert.equal(supportCpfPayrollKnowledgeRule(request), true, request.subject);
  assert.equal(selectCpfPayrollKnowledgeQuotes(request).length, 1, request.subject);
}
const ratePdfBytes = readFileSync(new URL('cpf-rates-native-2026.pdf', fixtureDir));
const rateUrl = requests[0].officialUrl;
const repositoryPdfResult = await extractOfficialDocumentFromRetrieved({
  url: rateUrl,
  authority: 'CPF',
  domain: 'CPF_BOARD',
  standardOrActCode: 'CPF_2026_CONTRIBUTION_RATES',
  legalOrStandardInstrument: 'CPF Contribution Rate Table from 1 January 2026',
  documentKind: 'PDF',
  expectedTopic: {
    standardIdentifiers: ['CPF Contribution Rate Table from 1 January 2026'],
    expectedTitles: ['CPF Contribution Rate Table from 1 January 2026'],
    topicTerms: ['CPF contribution', 'ordinary wages']
  }
}, {
  status: 'SUCCESS',
  httpStatus: 200,
  sourceUrl: rateUrl,
  finalUrl: rateUrl,
  contentType: 'application/pdf',
  contentBytes: new Uint8Array(ratePdfBytes),
  retrievedAt: '2026-10-27T00:00:00.000Z'
});
assert.equal(repositoryPdfResult.status, 'SUCCESS',
  repositoryPdfResult.status === 'REJECTED' ? repositoryPdfResult.reason : 'native PDF extractor succeeds');
if (repositoryPdfResult.status === 'SUCCESS') {
  assert.equal(repositoryPdfResult.record.documentHash, manifest.sources.find(item => item.id === 'rate-tables').sha256);
  const extractedRequest = { ...requests[0], sourceText: repositoryPdfResult.record.sourceText };
  assert.equal(supportCpfPayrollKnowledgeRule(extractedRequest), true,
    'The CPF rate rule accepts the repository PDF extractor output, not only the pypdf excerpt.');
  const extractedQuote = selectCpfPayrollKnowledgeQuotes(extractedRequest)[0];
  assert.ok(extractedQuote.length < 12_000);
  assert.match(extractedQuote, /37%\s*\(OW\)/);
  assert.equal(supportCpfPayrollKnowledgeRule({
    ...extractedRequest, sourceText: extractedRequest.sourceText.replace('[25% (OW)]* + 25% (AW)', '[29% (OW)]* + 29% (AW)')
  }), false, 'The repository PDF extractor path rejects a changed above-60 employer/total rate.');
  assert.equal(supportCpfPayrollKnowledgeRule({
    ...extractedRequest, sourceText: extractedRequest.sourceText.replace('[12.5% (OW)]* + 12.5% (AW)', '[14.5% (OW)]* + 14.5% (AW)')
  }), false, 'The repository PDF extractor path rejects a changed above-60 employee rate.');
  const swappedNativeRates = extractedRequest.sourceText.replace(
    /\[25% \(OW\)\]\* \+ 25% \(AW\)\s*\|\s*\[12\.5% \(OW\)\]\* \+ 12\.5% \(AW\)/,
    '[12.5% (OW)]* + 12.5% (AW) | [25% (OW)]* + 25% (AW)'
  );
  assert.notEqual(swappedNativeRates, extractedRequest.sourceText, 'The native PDF rate-column mutation changes the extracted text.');
  assert.equal(supportCpfPayrollKnowledgeRule({ ...extractedRequest, sourceText: swappedNativeRates }), false,
    'The repository PDF extractor path rejects swapped employer/employee rates.');
}
const scTableQuote = selectCpfPayrollKnowledgeQuotes(requests[0])[0];
assert.ok(scTableQuote.length < 12_000, 'The current table quote stays within the evidence excerpt budget.');
assert.match(scTableQuote, /CPF Contribution Rate Table from 1 January 2026/);
assert.match(scTableQuote, /37% \(OW\)/);
assert.doesNotMatch(scTableQuote, /Table 2/, 'A general rate question selects the relevant Table 1 excerpt only.');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], query: 'What are CPF contribution rates for SPRs in their first year?'
}), true, 'The first-year graduated table is verified independently from its own complete source page.');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], query: 'What are CPF contribution rates for a first-year SPR with approved full employer and graduated employee rates?'
}), true, 'The approved Table 4 schedule has its own source proof.');
assert.match(selectCpfPayrollKnowledgeQuotes({
  ...requests[0], query: 'What are CPF contribution rates for SPRs in their first year?'
})[0], /Table 2/);
const fullFullSprQuery = 'What are the first-year SPR full employer and full employee rates in 2026?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[0], query: fullFullSprQuery }), true,
  'Table 1 full/full rates for a first-year SPR require and verify the source approval footnote.');
assert.match(selectCpfPayrollKnowledgeQuotes({ ...requests[0], query: fullFullSprQuery })[0], /after CPF Board approves their joint application/i);
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], query: fullFullSprQuery,
  sourceText: rateText.replace(/These rates are also applicable to 1st and 2nd year[\s\S]*?full employer- full employee rates\./, 'These rates are also applicable to first and second year SPRs.')
}), false, 'Table 1 full/full SPR support fails when its approval condition is missing.');

assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[0], query: 'What CPF contribution rates applied in 2025?' }), false,
  'The current 2026 tables do not answer historical rates.');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], sourceText: rateText.replace('37% (OW)', '37.5% (OW)')
}), false, 'A changed rate fails whole-table verification.');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], sourceText: rateText.replace('[25% (OW)]* + 25% (AW)', '[29% (OW)]* + 29% (AW)')
}), false, 'A changed above-60 employer-and-total row fails proof.');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...requests[0], sourceText: rateText.replace('[12.5% (OW)]* + 12.5% (AW)', '[14.5% (OW)]* + 14.5% (AW)')
}), false, 'A changed above-60 employee row fails proof.');
const swappedTableRateText = rateText.replace(
  /\[25% \(OW\)\]\* \+ 25% \(AW\)\s+\*\s*Max\.?\s+of \$2,000\s+\[12\.5% \(OW\)\]\* \+ 12\.5% \(AW\)/,
  '[12.5% (OW)]* + 12.5% (AW) * Max. of $2,000 [25% (OW)]* + 25% (AW)'
);
assert.notEqual(swappedTableRateText, rateText, 'The rate-column swap mutation changes the fixture.');
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[0], sourceText: swappedTableRateText }), false,
  'Swapping the total and employee rate columns fails proof.');
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[0], officialUrl: 'https://www.cpf.gov.sg/another-page' }), undefined,
  'The source is bound to the specific official rate document.');
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[0], topicId: 'cpf-additional-wages' }), undefined,
  'Annual wage-classification coverage does not inherit the numeric contribution tables.');
assert.equal(hasCpfPayrollKnowledgeContradiction({
  ...requests[2], sourceText: owText + '\\nContradiction: the 2026 OW ceiling is S$8,001.'
}), true, 'The known ceiling family flags a contradictory 2026 number.');
assert.equal(hasCpfPayrollKnowledgeContradiction({ ...requests[0], query: 'What CPF contribution rates apply in 2025?' }), true,
  'An unsupported year blocks the general 2026 fallback.');
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[2], query: 'What was the CPF OW ceiling in 2018?' }), true,
  'The official dated 2016–2023 row supports explicitly bounded historical ceilings.');
assert.equal(supportCpfPayrollKnowledgeRule({ ...requests[2], query: 'What was the CPF OW ceiling in 2015?' }), false,
  'The retained timeline does not establish the 2015 ceiling.');

const basePayroll = {
  contributionMonth: '2026-01',
  employmentScope: 'PRIVATE_SECTOR',
  citizenship: 'SINGAPORE_CITIZEN',
  dateOfBirth: '1980-05-10',
  ordinaryWageCents: 500_000,
  additionalWageCents: 0,
  priorYearToDateOrdinaryWageSubjectCents: 0,
  priorYearToDateAdditionalWageSubjectCents: 0,
  estimatedFullYearOrdinaryWageSubjectCents: 9_600_000,
  isLastMonthOfEmployment: false,
  wagesAreCpfClassified: true
};
const ordinary = calculateCpfPayroll2026(basePayroll);
assert.equal(ordinary.status, 'CALCULATED');
assert.equal(ordinary.totalContributionCents, 185_000);
assert.equal(ordinary.employeeContributionCents, 100_000);
assert.equal(ordinary.employerContributionCents, 85_000);
assert.equal(ordinary.ordinaryWageSubjectCents, 500_000);

const annualCeiling = calculateCpfPayroll2026({ ...basePayroll, ordinaryWageCents: 900_000, additionalWageCents: 1_200_000 });
assert.equal(annualCeiling.status, 'CALCULATED');
assert.equal(annualCeiling.ordinaryWageSubjectCents, 800_000, 'The OW contribution base is capped at S$8,000.');
assert.equal(annualCeiling.additionalWageSubjectCents, 600_000, 'Projected 2026 full-year OW of S$96,000 leaves S$6,000 AW ceiling.');
assert.equal(annualCeiling.totalContributionCents, 518_000);
assert.equal(annualCeiling.employeeContributionCents, 280_000);
assert.equal(annualCeiling.employerContributionCents, 238_000);

const lowWageBand = calculateCpfPayroll2026({ ...basePayroll, ordinaryWageCents: 30_000 });
assert.equal(lowWageBand.status, 'CALCULATED');
assert.equal(lowWageBand.totalContributionCents, 5_100);
assert.equal(lowWageBand.employeeContributionCents, 0);
assert.equal(lowWageBand.employerContributionCents, 5_100);
const graduatedBand = calculateCpfPayroll2026({ ...basePayroll, ordinaryWageCents: 60_000 });
assert.equal(graduatedBand.status, 'CALCULATED');
assert.equal(graduatedBand.totalContributionCents, 16_200);
assert.equal(graduatedBand.employeeContributionCents, 6_000);
assert.equal(graduatedBand.employerContributionCents, 10_200);

const roundDown = calculateCpfPayroll2026({ ...basePayroll, ordinaryWageCents: 29_700 });
const roundUp = calculateCpfPayroll2026({ ...basePayroll, ordinaryWageCents: 29_706 });
assert.equal(roundDown.status, 'CALCULATED');
assert.equal(roundDown.totalContributionCents, 5_000, 'S$50.49 rounds down to S$50.');
assert.equal(roundUp.status, 'CALCULATED');
assert.equal(roundUp.totalContributionCents, 5_100, 'S$50.5002 rounds up to S$51.');

const birthdayMonth = calculateCpfPayroll2026({
  ...basePayroll, contributionMonth: '2026-06', dateOfBirth: '1971-06-15', ordinaryWageCents: 800_000
});
const monthAfterBirthday = calculateCpfPayroll2026({
  ...basePayroll, contributionMonth: '2026-07', dateOfBirth: '1971-06-15', ordinaryWageCents: 800_000,
  priorYearToDateOrdinaryWageSubjectCents: 800_000
});
assert.equal(birthdayMonth.status, 'CALCULATED');
assert.equal(birthdayMonth.ageBand, '55 and below', 'The new age-group rate starts the month after the birthday.');
assert.equal(birthdayMonth.totalContributionCents, 296_000);
assert.equal(monthAfterBirthday.status, 'CALCULATED');
assert.equal(monthAfterBirthday.ageBand, 'above 55 to 60');
assert.equal(monthAfterBirthday.totalContributionCents, 272_000);

const sprInput = {
  ...basePayroll, citizenship: 'PERMANENT_RESIDENT', permanentResidentStartDate: '2025-01-15',
  ordinaryWageCents: 500_000, prRateElection: 'GRADUATED_GG'
};
const sprFirst = calculateCpfPayroll2026({ ...sprInput, contributionMonth: '2026-01' });
const sprSecond = calculateCpfPayroll2026({
  ...sprInput, contributionMonth: '2026-02', priorYearToDateOrdinaryWageSubjectCents: 500_000
});
assert.equal(sprFirst.status, 'CALCULATED');
assert.equal(sprFirst.prYear, 1);
assert.equal(sprFirst.totalContributionCents, 45_000);
assert.equal(sprFirst.employeeContributionCents, 25_000);
assert.equal(sprFirst.employerContributionCents, 20_000);
assert.equal(sprSecond.status, 'CALCULATED');
assert.equal(sprSecond.prYear, 2);
assert.equal(sprSecond.totalContributionCents, 120_000);
assert.equal(sprSecond.employeeContributionCents, 75_000);

const sprApprovedHigher = calculateCpfPayroll2026({
  ...sprInput, contributionMonth: '2026-01', prRateElection: 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED'
});
assert.equal(sprApprovedHigher.status, 'CALCULATED');
assert.equal(sprApprovedHigher.totalContributionCents, 110_000);
assert.equal(sprApprovedHigher.employeeContributionCents, 25_000);
assert.equal(sprApprovedHigher.employerContributionCents, 85_000);

const prThirdYear = calculateCpfPayroll2026({
  ...sprInput, permanentResidentStartDate: '2024-01-15', contributionMonth: '2026-02',
  priorYearToDateOrdinaryWageSubjectCents: 800_000, prRateElection: undefined
});
assert.equal(prThirdYear.status, 'CALCULATED', prThirdYear.status === 'UNSUPPORTED' ? prThirdYear.reason : 'third-year table applies without a separate rate election');
assert.equal(prThirdYear.prYear, 3);
assert.equal(prThirdYear.totalContributionCents, 185_000);
const prThirdYearPriorFullElection = calculateCpfPayroll2026({
  ...sprInput, permanentResidentStartDate: '2024-01-15', contributionMonth: '2026-02',
  priorYearToDateOrdinaryWageSubjectCents: 800_000,
  prRateElection: 'FULL_EMPLOYER_FULL_EMPLOYEE_APPROVED'
});
assert.equal(prThirdYearPriorFullElection.status, 'CALCULATED',
  'An explicit full/full choice may use the same third-year table without requiring a fictitious graduated-rate election.');
assert.equal(prThirdYearPriorFullElection.totalContributionCents, prThirdYear.totalContributionCents);
assert.equal(calculateCpfPayroll2026({ ...sprInput, contributionMonth: '2026-01', prRateElection: undefined }).status, 'UNSUPPORTED',
  'First-year SPR calculations still require the graduated basis or an approved higher-rate choice.');
assert.equal(calculateCpfPayroll2026({ ...sprInput, contributionMonth: '2026-02', prRateElection: undefined }).status, 'UNSUPPORTED',
  'Second-year SPR calculations still require the graduated basis or an approved higher-rate choice.');
assert.equal(calculateCpfPayroll2026({
  ...sprInput, permanentResidentStartDate: '2024-01-15', contributionMonth: '2026-02',
  prRateElection: 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED'
}).status, 'UNSUPPORTED', 'The first/second-year full-employer/graduated-employee election is not carried into year three.');

assert.equal(calculateCpfPayroll2026({ ...sprInput, permanentResidentStartDate: undefined }).status, 'UNSUPPORTED',
  'The PR conversion date is not assumed.');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, dateOfBirth: '' }).status, 'UNSUPPORTED',
  'An age group is not assumed.');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, contributionMonth: '2027-01' }).status, 'UNSUPPORTED',
  '2026 rates cannot be applied to 2027.');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, wagesAreCpfClassified: false }).status, 'UNSUPPORTED',
  'The calculator does not classify wage types.');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, employmentScope: 'PENSIONABLE_PUBLIC' }).status, 'UNSUPPORTED');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, dateOfBirth: '2030-01-01' }).status, 'UNSUPPORTED',
  'A date of birth after the payroll period is rejected.');
const futureResident = calculateCpfPayroll2026({
  ...basePayroll, citizenship: 'PERMANENT_RESIDENT', permanentResidentStartDate: '2027-01-01', prRateElection: 'GRADUATED_GG'
});
assert.equal(futureResident.status, 'UNSUPPORTED', 'A future PR conversion date cannot qualify for 2026 rates.');
assert.equal(calculateCpfPayroll2026({ ...basePayroll, employmentScope: undefined }).status, 'UNSUPPORTED',
  'An omitted employment scope is not silently accepted.');
const midMonthResident = calculateCpfPayroll2026({
  ...basePayroll, citizenship: 'PERMANENT_RESIDENT', permanentResidentStartDate: '2026-10-15',
  contributionMonth: '2026-10', prRateElection: 'GRADUATED_GG'
});
assert.equal(midMonthResident.status, 'REVIEW_REQUIRED',
  'A within-month PR conversion requires wage amounts split around the conversion date.');

const finalDecember = calculateCpfPayroll2026({
  ...basePayroll, contributionMonth: '2026-12', priorYearToDateOrdinaryWageSubjectCents: 8_800_000,
  estimatedFullYearOrdinaryWageSubjectCents: 9_600_000, ordinaryWageCents: 800_000, additionalWageCents: 1_000_000
});
assert.equal(finalDecember.status, 'CALCULATED');
assert.equal(finalDecember.projectedAnnualOwSubjectCents, 9_600_000, 'December uses actual OW paid to date and current month.');
assert.equal(finalDecember.additionalWageSubjectCents, 600_000);
const awCeilingDecrease = calculateCpfPayroll2026({
  ...basePayroll, contributionMonth: '2026-08', ordinaryWageCents: 500_000, priorYearToDateOrdinaryWageSubjectCents: 5_000_000,
  priorYearToDateAdditionalWageSubjectCents: 5_000_000, estimatedFullYearOrdinaryWageSubjectCents: 9_600_000,
  additionalWageCents: 10_000
});
assert.equal(awCeilingDecrease.status, 'REVIEW_REQUIRED',
  'A revised expected OW estimate that makes prior AW excess requires review.');

const rateHash = createHash('sha256').update(rateText).digest('hex');
const presentationSource = {
  key: 'cpf-rate-source', title: '2026 CPF Rate Tables', publisher: 'CPF Board',
  documentTitle: 'CPF Contribution Rate Table from 1 January 2026',
  officialUrl: requests[0].officialUrl, provenance: 'LIVE_EXTERNAL', claims: [{
    text: rateText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: ['cpf-rate-issue'], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: {
      recordId: 'cpf-rate-table-official-extract', documentHash: rateHash,
      canonicalUrl: requests[0].officialUrl, retrievedAt: '2026-10-27T00:00:00Z'
    }
  }]
};
const issue = {
  id: 'cpf-rate-issue', subject: 'CPF contribution rate table', population: 'Employer',
  operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED',
  claims: [], gaps: []
};
const stream = {
  id: 'cpf-rate-stream', authority: 'CPF', authorityLabel: 'CPF Board', domain: 'CPF_PAYROLL',
  domainLabel: 'CPF contributions', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED',
  issues: [issue], sources: [presentationSource], gaps: []
};
const rendered = getCpfPayrollKnowledgeEvidence('What are CPF contribution rates in 2026?', stream, issue);
assert.equal(rendered?.ruleId, 'CPF_2026_CONTRIBUTION_TABLES');
assert.match(rendered?.text || '', /1 January 2026/);
const renderedPr1 = getCpfPayrollKnowledgeEvidence('What are CPF contribution rates for SPRs in their first year in 2026?', stream, issue);
assert.match(renderedPr1?.text || '', /Table 2/);
assert.doesNotMatch(renderedPr1?.text || '', /17%\/20%/,
  'A Table 2 proof does not render the Table 1 full/third-year percentages.');
const renderedPr1FullFull = getCpfPayrollKnowledgeEvidence(fullFullSprQuery, stream, issue);
assert.match(renderedPr1FullFull?.text || '', /only after it approves/);
assert.doesNotMatch(renderedPr1FullFull?.text || '', /17%\/20%/,
  'A Table 1 SPR full/full answer states its approval condition instead of presenting SC/third-year rates as unconditional.');
assert.equal(getCpfPayrollKnowledgeEvidence(
  'For staff earning S$400 in total wages for a month, is there always an employee CPF deduction as well as an employer contribution?',
  stream, { ...issue, subject: 'CPF low-wage employer and employee contribution shares' }
), undefined, 'The new 2026 rate renderer does not displace the existing low-wage explanation with unrelated full-rate percentages.');
const lowWageQuery = 'For staff earning S$400 in total wages for a month, is there always an employee CPF deduction as well as an employer contribution?';
const lowWageRequest = {
  authority: 'CPF', topicId: 'cpf-contribution-computation', query: lowWageQuery,
  subject: 'CPF low-wage employer and employee contribution shares', sourceText: computationText,
  officialUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'
};
assert.match(computationText, /employee’s share of CPF contributions/i,
  'The retained visible-text source uses the curly apostrophe as published.');
assert.equal(supportCpfPayrollKnowledgeRule(lowWageRequest), undefined,
  'The dedicated 2026 payroll renderer leaves the existing low-wage explanation to its established rule owner.');
assert.equal(supportPracticalExpansionRule(lowWageRequest), true,
  'The full official visible-text excerpt supports the low-wage rule through the existing aggregate path.');
const lowWageQuotes = selectPracticalExpansionQuotes(lowWageRequest);
assert.ok(lowWageQuotes.some(quote => /above \$50 but not more than \$500 per month, there is no employee’s share/i.test(quote)),
  'The aggregate selector returns the exact official low-wage passage with its original apostrophe.');
const changedThreshold = computationText.replace(
  'Note that if your employee earns above $50 but not more than $500 per month, there is no employee’s share of CPF contributions.',
  'Note that if your employee earns above $50 but not more than $450 per month, there is no employee’s share of CPF contributions.'
);
assert.notEqual(changedThreshold, computationText, 'The threshold negative control changes the source.');
assert.equal(supportPracticalExpansionRule({ ...lowWageRequest, sourceText: changedThreshold }), false,
  'A changed S$500 wage boundary cannot support the low-wage answer.');
assert.deepEqual(selectPracticalExpansionQuotes({ ...lowWageRequest, sourceText: changedThreshold }), [],
  'A changed wage boundary yields no displayed source quotation.');
const contradictedLowWageSource = `${computationText}\nThe employee’s share is payable for wages above $50 but not more than $500 per month.`;
const contradictedLowWageRequest = { ...lowWageRequest, sourceText: contradictedLowWageSource };
assert.equal(hasPracticalExpansionContradiction(contradictedLowWageRequest), true,
  'The aggregate contradiction veto recognizes a contradictory low-wage statement with a curly apostrophe.');
assert.equal(supportPracticalExpansionRule(contradictedLowWageRequest), false,
  'A contradictory low-wage statement vetoes support even while the valid official passage is present.');
assert.deepEqual(selectPracticalExpansionQuotes(contradictedLowWageRequest), [],
  'The aggregate selector withholds quotations when the same source also contradicts the rule.');
const wrongRevision = {
  ...stream, sources: [{ ...presentationSource, officialUrl: 'https://www.cpf.gov.sg/another-page' }]
};
assert.equal(getCpfPayrollKnowledgeEvidence('What are CPF contribution rates in 2026?', wrongRevision, issue), undefined,
  'The renderer does not borrow the rate-table explanation from an adjacent source URL.');

console.log('CPF 2026 rate, ceiling, PR-year and payroll-calculation regressions passed.');
