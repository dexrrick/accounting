import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { tryGenerateGroundedSynthesis } from '../../src/services/evidenceGroundedSynthesis.ts';

const provider = {
  activeProvider: 'openai',
  openai: { apiKey: 'test-key-for-numeric-provenance', model: 'test-model' },
  gemini: {},
  azure: {}
};
const targetDate = '2026-11-03';
const records = {
  mom: UNIFIED_SOURCE_REGISTRY.MOM_SEC21_SALARY_TIMELINES,
  gstRate: UNIFIED_SOURCE_REGISTRY.GST_RATE_9_PERCENT,
  badDebt: UNIFIED_SOURCE_REGISTRY.GST_REG82_90_BAD_DEBT_RELIEF,
  formCsLite: UNIFIED_SOURCE_REGISTRY.IRAS_FORM_CS_LITE_CRITERIA
};

for (const [name, record] of Object.entries(records)) {
  assert.ok(record, name + ' uses an admitted first-party registry record');
  assert.ok(record.sourceText && record.canonicalSourceUrl, name + ' has retained source text and a canonical URL');
}

function makeInput(record, query, domain, authority) {
  const issueId = 'issue-' + record.id.toLowerCase();
  const population = authority === 'MOM' ? 'EMPLOYEE' : 'COMPANY';
  const sourceClaim = {
    recordId: record.id,
    quote: record.sourceText,
    text: record.sourceText,
    supportKind: 'EXACT_SOURCE_QUOTE',
    canonicalUrl: record.canonicalSourceUrl,
    sourceAdmissionOptions: { targetDate }
  };
  const issue = {
    issueId,
    subject: record.principleSummary || record.ruleTitle || record.id,
    population,
    domain,
    operation: 'EXPLAIN_RULE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    governingAuthority: authority,
    sourceSections: [],
    lifecycle: {},
    evidenceStatus: 'VERIFIED',
    applicationStatus: 'NOT_REQUIRED',
    verifiedClaims: [sourceClaim],
    sources: [record],
    gaps: []
  };
  return {
    query,
    standard: 'SFRS_I',
    provider,
    history: [],
    response: {
      scenarioState: {
        scenarioType: 'EXPENSE', transactionTitle: 'Office expense', amount: 100,
        transactionCurrency: 'SGD', functionalCurrency: 'SGD', transactionDate: '', eventDate: '',
        directGroups: [], missingFacts: [], missingFields: [], isComplete: false
      },
      evidenceQuality: { eligibleRecords: [record], missingFacts: [], targetDate }
    },
    workstreams: {
      query,
      issuePlan: {},
      requestCompletenessContext: {},
      workstreams: [{
        id: 'workstream-' + issueId, authority, domain, sourceSections: [], populations: [population],
        issues: [issue], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
        verifiedClaims: [sourceClaim], sources: [record], gaps: []
      }],
      evidenceStatus: 'VERIFIED',
      applicationStatus: 'NOT_REQUIRED',
      status: 'VERIFIED',
      gaps: []
    }
  };
}

function scriptedClaim(text) {
  const calls = [];
  const call = async (prompt, system) => {
    const packet = JSON.parse(prompt);
    calls.push({ system, packet });
    const passage = packet.evidencePassages[0];
    return JSON.stringify({
      claims: [{
        id: 'numeric-claim',
        kind: 'RULE',
        text,
        supportIds: [passage.id],
        factRefs: [],
        issueId: passage.issueId
      }]
    });
  };
  return { call, calls };
}

async function accept(record, query, domain, authority, text) {
  const scripted = scriptedClaim(text);
  const result = await tryGenerateGroundedSynthesis(makeInput(record, query, domain, authority), { call: scripted.call });
  assert.ok(result, 'supported numeric paraphrase should be retained: ' + text);
  assert.equal(result.verification.claimValidation, 'DETERMINISTIC_PACKET_CHECKS');
  assert.equal(scripted.calls.length, 1, 'a supported numeric paraphrase uses one synthesis generation call');
}

async function reject(record, query, domain, authority, text, reason) {
  const scripted = scriptedClaim(text);
  await assert.rejects(
    tryGenerateGroundedSynthesis(makeInput(record, query, domain, authority), { call: scripted.call }),
    /no supportable claims/,
    reason
  );
  assert.equal(scripted.calls.length, 1,
    'unsupported numeric claims fail the deterministic source-provenance check after one generation');
}

await accept(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Salary must be paid by the end of the seventh day after the salary period ends.'
);
await accept(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Overtime pay is due within fourteen days after the salary period ends.'
);
await accept(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Pay salary within seven days after the end of the salary period.'
);
await reject(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Overtime pay is due on the fourteenth day of each calendar month.',
  'a day-of-month ordinal cannot be substituted for a duration after the salary period'
);
await reject(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Salary must be paid within fourteen days after the salary period ends.',
  'the overtime deadline cannot be transferred to regular salary'
);
await reject(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Overtime pay is due within fourteen days before the salary period ends.',
  'a deadline direction cannot be reversed'
);
await reject(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Overtime pay is due within fourteen days after employment ends.',
  'the deadline cannot be shifted to a different triggering event'
);
await reject(
  records.mom,
  'When must an employer pay salary and overtime?',
  'MOM_EMPLOYMENT',
  'MOM',
  'Salary is due on the first business day after the salary period ends.',
  'the first business day is not supported by the cited salary deadline'
);

await accept(
  records.gstRate,
  'What is the standard GST rate and when did it take effect?',
  'IRAS_GST',
  'IRAS',
  'The standard GST rate is nine percent from and including January 1, 2024.'
);
await reject(
  records.gstRate,
  'What is the standard GST rate and when did it take effect?',
  'IRAS_GST',
  'IRAS',
  'The standard GST rate is not nine percent from January 1, 2024.',
  'a negated numeric equality cannot reuse support for the positive rate'
);
await reject(
  records.gstRate,
  'What is the standard GST rate and when did it take effect?',
  'IRAS_GST',
  'IRAS',
  'The Singapore standard GST rate has been nine percent since January 1, 2025.',
  'a paraphrased rate sentence cannot shift its effective date'
);
await reject(
  records.gstRate,
  'What is the standard GST rate and when did it take effect?',
  'IRAS_GST',
  'IRAS',
  'The standard GST rate was nine percent until January 1, 2024.',
  'an effective-start date cannot be relabelled as an effective-end date'
);
await reject(
  records.gstRate,
  'What is the standard GST rate and when did it take effect?',
  'IRAS_GST',
  'IRAS',
  'Businesses with turnover of SGD nine hundred must register for GST.',
  'a spelled-out SGD amount cannot bypass numeric provenance'
);

await accept(
  records.badDebt,
  'What GST amount can be claimed for the registered bad-debt relief example?',
  'IRAS_GST',
  'IRAS',
  'The debt must remain unpaid for twelve months beginning with the supply date, unless the debtor becomes insolvent sooner.'
);
await reject(
  records.badDebt,
  'What GST amount can be claimed for the registered bad-debt relief example?',
  'IRAS_GST',
  'IRAS',
  'The company can claim SGD nine hundred back as bad-debt relief.',
  'an unsupported spelled-out currency amount cannot bypass numeric provenance'
);
await reject(
  records.badDebt,
  'What GST amount can be claimed for the registered bad-debt relief example?',
  'IRAS_GST',
  'IRAS',
  'The company can claim SGD a hundred back as bad-debt relief.',
  'the article form in a spelled-out currency amount cannot bypass numeric provenance'
);
for (const amountText of [
  'The company can claim $nine hundred back as bad-debt relief.',
  'The company can claim $ nine hundred back as bad-debt relief.'
]) {
  await reject(
    records.badDebt,
    'What GST amount can be claimed for the registered bad-debt relief example?',
    'IRAS_GST',
    'IRAS',
    amountText,
    'an ambiguous dollar symbol is detected as a currency without being assumed to mean SGD'
  );
}

await accept(
  records.formCsLite,
  'What annual revenue cap applies to Form C-S Lite for YA 2026?',
  'IRAS_INCOME_TAX',
  'IRAS',
  'Companies with annual revenue of SGD two hundred thousand or less that satisfy the Form C-S conditions may choose Form C-S Lite.'
);
await accept(
  records.formCsLite,
  'What annual revenue cap applies to Form C-S Lite for YA 2026?',
  'IRAS_INCOME_TAX',
  'IRAS',
  'For Form C-S Lite, annual revenue must not exceed SGD two hundred thousand.'
);
await reject(
  records.formCsLite,
  'What annual revenue cap applies to Form C-S Lite for YA 2026?',
  'IRAS_INCOME_TAX',
  'IRAS',
  'For YA 2026, the annual revenue ceiling for Form C-S Lite is -SGD 200,000.',
  'a negative signed cap cannot reuse support for the positive revenue threshold'
);
await reject(
  records.formCsLite,
  'What annual revenue cap applies to Form C-S Lite for YA 2026?',
  'IRAS_INCOME_TAX',
  'IRAS',
  'For YA 2026, the annual revenue ceiling for Form C-S Lite is minus SGD two hundred thousand.',
  'a spelled-out negative sign before currency cannot bypass numeric provenance'
);

console.log('PASS: typed numeric provenance covers ordinal deadlines, spelled amounts, currency, rates, dates and faithful paraphrases');
