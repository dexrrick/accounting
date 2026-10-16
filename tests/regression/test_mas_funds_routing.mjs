import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { querySingaporeStatutes } from '../../src/standards/singaporeStatutesKnowledge.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { getSafeOfficialUrl, sanitizeStatutoryLinks } from '../../src/utils/statutoryLinkResolver.ts';

const classification = classifyQuestion('what is MAS 13O');
assert.equal(classification.primaryDomain, 'MIXED');
assert.deepEqual([...classification.authorities].sort(), ['IRAS', 'MAS']);
assert.ok(classification.topicIds.includes('mas-family-office-13o'));
assert.ok(classification.topicIds.includes('iras-fund-tax-incentives-13o'));
assert.ok(classification.domains.includes('MULTI_AUTHORITY'));

const rules = querySingaporeStatutes('what is MAS 13O');
assert.equal(rules[0]?.id, 'MAS_SFO_13O_13U_MATERIAL_CHANGES');
assert.match(rules[0].canonicalUrl, /^https:\/\/ask\.gov\.sg\/mas\/questions\//);
console.log('PASS | MAS 13O routes to MAS and IRAS and retains its MAS-focused statutory evidence path');

const vccRules = querySingaporeStatutes('explain VCC to me');
assert.equal(vccRules[0]?.id, 'ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE');
assert.equal(vccRules[0]?.actCode, 'VCCA2018');
assert.ok(vccRules[0]?.principle, 'The local VCC statutory rule remains available for routing and explanation.');
assert.equal(getSafeOfficialUrl(vccRules[0].canonicalUrl, 'Variable Capital Companies Act 2018', 'Section 5', 'ACRA'), '',
  'The VCC rule’s sourceStatus does not make its URL clickable without URL-specific verification.');
assert.equal(sanitizeStatutoryLinks(`[VCC Act](${vccRules[0].canonicalUrl})`), 'VCC Act',
  'The unverified VCC Act URL is removed from rendered markdown.');

const vccScenario = await parseAccountingQuery('explain VCC to me');
assert.notEqual(vccScenario.scenarioType, 'UNRECOGNIZED');
assert.equal(vccScenario.isComplete, true);
assert.equal(vccScenario.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018');
console.log('PASS | VCC routes to the VCC Act primary source instead of offline mode');

const vccAuditQuery = 'Can a Singapore variable capital company (VCC) use the Companies Act small company audit exemption?';
const vccAuditScenario = await parseAccountingQuery(vccAuditQuery);
assert.equal(vccAuditScenario.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018');
assert.ok(vccAuditScenario.statutoryAdvisory?.some(advisory => advisory.topic === 'Variable Capital Company (VCC) Framework'));
assert.ok(!vccAuditScenario.statutoryAdvisory?.some(advisory => advisory.topic === 'Small Company Audit Exemption Criteria (Revenue / Assets ≤ $10M, Staff ≤ 50)'));
assert.match(vccAuditScenario.accountingTreatmentSummary, /VCC-specific rule states that a VCC must have a required auditor/i);
assert.doesNotMatch(vccAuditScenario.accountingTreatmentSummary, /eligible private companies are exempt/i);
assert.doesNotMatch(vccAuditScenario.singaporeTaxTreatmentSummary, /Form C-S|Form C\b/i);
assert.doesNotMatch(vccAuditScenario.effectiveDateOrTiming || '', /Section 205C|Thirteenth Schedule/i);
assert.equal(vccAuditScenario.directGroups?.[0]?.totalDebit, 0);
assert.equal(vccAuditScenario.directGroups?.[0]?.totalCredit, 0);
console.log('PASS | VCC audit-exemption query stays within VCC-specific statutory scope');

for (const query of [
  'Can VCC use audit exemption and small company revenue thresholds?',
  'Can a VCC use the audit exemption and private company thresholds?'
]) {
  const scenario = await parseAccountingQuery(query);
  assert.equal(scenario.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018', query);
  assert.ok(!scenario.statutoryAdvisory?.some(advisory => advisory.sectionOrSchedule.includes('205C')), query);
}

const vccAuditWithoutAcronym = await parseAccountingQuery(
  'Can a Singapore variable capital company use the private company small-company audit exemption?'
);
assert.equal(vccAuditWithoutAcronym.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018');
assert.ok(!vccAuditWithoutAcronym.statutoryAdvisory?.some(advisory => advisory.topic === 'Small Company Audit Exemption Criteria (Revenue / Assets ≤ $10M, Staff ≤ 50)'));

const companyAuditScenario = await parseAccountingQuery('What are the small company audit exemption criteria for a private company?');
assert.ok(companyAuditScenario.statutoryAdvisory?.some(advisory => advisory.statuteOrAct === 'Companies Act 1967'));
assert.match(companyAuditScenario.accountingTreatmentSummary, /Eligible private companies are exempt from statutory audit/i);

const comparedAuditScenario = await parseAccountingQuery('Compare VCC audit requirements with a private company small company audit exemption.');
assert.ok(comparedAuditScenario.statutoryAdvisory?.some(advisory => advisory.statuteOrAct === 'Variable Capital Companies Act 2018'));
assert.ok(comparedAuditScenario.statutoryAdvisory?.some(advisory => advisory.statuteOrAct === 'Companies Act 1967'));
assert.equal(comparedAuditScenario.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018');
assert.match(comparedAuditScenario.accountingTreatmentSummary, /VCC-specific rule states that a VCC must have a required auditor/i);
assert.match(comparedAuditScenario.directGroups?.[0]?.summary || '', /Companies Act 1967 \(Section 205C/);
console.log('PASS | Company audit-exemption criteria remain available for explicit company requests and comparisons');

const separateCompanyRequest = await parseAccountingQuery(
  'Can a VCC claim the small-company audit exemption, and separately what criteria apply to private companies?'
);
assert.ok(separateCompanyRequest.statutoryAdvisory?.some(advisory => advisory.statuteOrAct === 'Variable Capital Companies Act 2018'));
assert.ok(separateCompanyRequest.statutoryAdvisory?.some(advisory => advisory.statuteOrAct === 'Companies Act 1967'));

const vccMasLicensing = await parseAccountingQuery('What MAS rules govern CMS licensing and fund management for a VCC?');
assert.equal(vccMasLicensing.statutoryAdvisory?.[0]?.authority, 'MAS');
assert.ok(vccMasLicensing.statutoryAdvisory?.some(advisory => advisory.authority === 'MAS'));
console.log('PASS | VCC mentions do not displace MAS as the primary authority for licensing queries');

const mixedMasAudit = await parseAccountingQuery(
  'What MAS rules govern CMS licensing and fund management for a VCC and is there an audit exemption?'
);
assert.equal(mixedMasAudit.primaryDomain, 'MAS_FUNDS');
assert.equal(mixedMasAudit.statutoryAdvisory?.[0]?.authority, 'MAS');
assert.ok(!mixedMasAudit.statutoryAdvisory?.some(advisory => advisory.sectionOrSchedule.includes('205C')));
console.log('PASS | Mixed MAS licensing and VCC audit queries retain MAS as the primary authority');

assert.equal(sanitizeStatutoryLinks('Variable Capital Companies Act 2018'), 'Variable Capital Companies Act 2018');
assert.equal(sanitizeStatutoryLinks('Variable Capital Companies Act'), 'Variable Capital Companies Act');
assert.equal(sanitizeStatutoryLinks('Variable Capital\nCompanies Act\n2018'), 'Variable Capital\nCompanies Act\n2018');
assert.equal(sanitizeStatutoryLinks('Companies Act 1967'), 'Companies Act 1967');
console.log('PASS | Statutory link normalization preserves the VCC Act title and ordinary Companies Act wording');
