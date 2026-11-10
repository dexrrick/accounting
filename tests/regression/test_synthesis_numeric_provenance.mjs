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
  formCsLite: UNIFIED_SOURCE_REGISTRY.IRAS_FORM_CS_LITE_CRITERIA,
  citRate: UNIFIED_SOURCE_REGISTRY.ITA_SUTE_PTE_TAX_EXEMPTION
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
    if (system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION')) {
      return JSON.stringify({ verdicts: packet.claims.map(item => ({
        claimId: item.claimId, support: 'SUPPORTED', claimType: 'RULE'
      })) });
    }
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
  assert.equal(result.verification.claimValidation, 'DETERMINISTIC_AND_SELECTIVE_AI_SUPPORT_CHECK');
  assert.equal(scripted.calls.length, 2, 'a paraphrased statutory rule receives one batched support check');
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

// Synthetic allowance passages isolate amount parsing, not statutory eligibility.
// The actual Form C-S Lite sourceText below supports SGD 200,000, not SGD 5 million.
const allowanceFixture = amount => ({ ...records.formCsLite,
  sourceText: `The annual sample allowance is ${amount}.`
});
const allowanceQuery = 'What annual sample allowance is stated in this fixture?';
const magnitudeRecord = allowanceFixture('SGD 5 million');
for (const amount of ['S$5 million', 'S$5mn', 'S$5e6', 'SGD 5,000,000', 'SGD 0.005 billion']) {
  await accept(magnitudeRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
    `The annual sample allowance is ${amount}.`);
}
await reject(magnitudeRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is S$5.',
  'the parser must treat S$5 million as five million dollars rather than the partial amount S$5');
await accept(magnitudeRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is S$.005 billion.');
await accept(allowanceFixture('SGD 500,000'), allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is S$.5m.');
await accept(magnitudeRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is SGD 5 mm.');
await reject(allowanceFixture('SGD 500'), allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is SGD 500,000.',
  'a magnitude suffix cannot be dropped when it changes the amount');
await reject(allowanceFixture('SGD 5'), allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is SGD 5 mmm.',
  'an unsupported contiguous magnitude-like suffix cannot be dropped as ordinary prose');
for (const [sourceAmount, malformed] of [
  ['SGD 5', 'S$5mm'], ['SGD 50', 'S$500 crore'], ['SGD 5,000,000', 'S$5,000,000mm'],
  ['SGD 5', 'S$５mm']
]) {
  await reject(allowanceFixture(sourceAmount), allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
    `The annual sample allowance is ${malformed}.`,
    `an unsupported or incomplete currency magnitude cannot be reduced to a matching partial amount: ${malformed}`);
}

const decimalSuffixRecord = {
  ...records.formCsLite,
  sourceText: 'The annual expense allowance is 1.25 million Singapore dollars.'
};
await accept(decimalSuffixRecord, 'What is the annual expense allowance?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual expense allowance is SGD 1,250,000.');

const signedDecimalRecord = {
  ...records.formCsLite,
  sourceText: 'The annual expense amount is SGD -10.50.'
};
await accept(signedDecimalRecord, 'What annual expense amount is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual expense amount is negative SGD 10.50.');
await reject(signedDecimalRecord, 'What annual expense amount is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual expense amount is SGD 10.50.',
  'a decimal currency claim cannot discard the admitted negative sign');

const parenthesizedAmountRecord = {
  ...records.formCsLite,
  sourceText: 'The annual sample expense is SGD (500).'
};
await accept(parenthesizedAmountRecord, 'What annual sample expense is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample expense is (SGD 500).');
await accept(parenthesizedAmountRecord, 'What annual sample expense is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample expense is -SGD 500.');
await reject(parenthesizedAmountRecord, 'What annual sample expense is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample expense is SGD 500.',
  'accounting parentheses preserve the negative currency sign');
for (const text of [
  'The annual sample expense is -(SGD 500).',
  'The annual sample expense is -SGD (500).'
]) {
  await reject(parenthesizedAmountRecord, 'What annual sample expense is stated?', 'IRAS_INCOME_TAX', 'IRAS', text,
    'an explicit sign before accounting parentheses is ambiguous and cannot match an admitted negative amount');
}
const halfMillionParentheticalRecord = allowanceFixture('SGD (500,000)');
await accept(halfMillionParentheticalRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is (SGD .5m).');
await reject(halfMillionParentheticalRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is -(SGD .5m).',
  'an external sign before a supported magnitude parenthesis is ambiguous');
const fiveMillionParentheticalRecord = allowanceFixture('SGD (5,000,000)');
await accept(fiveMillionParentheticalRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is SGD (5 mm).');
await reject(fiveMillionParentheticalRecord, allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is -SGD (5 mm).',
  'an external sign before a currency parenthesis with supported magnitude is ambiguous');
await reject(allowanceFixture('SGD 500'), 'What annual sample allowance is stated?', 'IRAS_INCOME_TAX', 'IRAS',
  'The annual sample allowance is USD 500.',
  'a currency code cannot change while the numeric amount stays the same');
for (const malformed of ['SGD (500', '(SGD 500', '(500 SGD', 'SGD 500)', '500 SGD)',
  'SGD (-500)', '(SGD -500)', '(-500 SGD)']) {
  await reject(allowanceFixture('SGD 500'), allowanceQuery, 'IRAS_INCOME_TAX', 'IRAS',
    `The annual sample allowance is ${malformed}.`,
    `incomplete accounting parentheses cannot be partially parsed: ${malformed}`);
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

const reversedRateRoleRecord = {
  ...records.citRate,
  sourceText: 'The employee contribution rate is 20%. The employer contribution rate is 17%.'
};
await reject(
  reversedRateRoleRecord,
  'What are the employee and employer contribution rates?',
  'IRAS_CORPORATE_TAX',
  'IRAS',
  'The employer contribution rate is 20% for each employee.',
  'an employee rate cannot be transferred to the employer'
);
const sameSentenceRateRoleRecord = {
  ...records.citRate,
  sourceText: 'The employee contribution rate is 20% and the employer contribution rate is 17%.'
};
await reject(
  sameSentenceRateRoleRecord,
  'What are the employee and employer contribution rates?',
  'IRAS_CORPORATE_TAX',
  'IRAS',
  'The employer contribution rate is 20% for each employee.',
  'a following employer role cannot be attributed to the preceding employee rate'
);
const reversedCurrencyRoleRecord = {
  ...records.citRate,
  sourceText: 'The employee contribution cap is SGD 500. The employer contribution cap is SGD 1,000.'
};
await reject(
  reversedCurrencyRoleRecord,
  'What are the employee and employer contribution caps?',
  'IRAS_CORPORATE_TAX',
  'IRAS',
  'The employer contribution cap is SGD 500 per employee.',
  'an employee currency cap cannot be transferred to the employer'
);

await accept(
  records.citRate,
  'What is the corporate income tax rate in Singapore?',
  'IRAS_CORPORATE_TAX',
  'IRAS',
  'The headline corporate income tax rate is a flat 17% in Singapore.'
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
