import assert from 'node:assert/strict';
import { appendStatutorySourceFooter, buildSsoUrl, canonicalizeSsoUrl, getSafeOfficialUrl } from './src/utils/statutoryLinkResolver.ts';
import { SINGAPORE_STATUTORY_REPOSITORY } from './src/standards/singaporeStatutesKnowledge.ts';

const section14 = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14_GENERAL_DEDUCTION;
const capitalAllowances = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC19_19A_CAPITAL_ALLOWANCES;
const capitalAllowanceGuide = capitalAllowances.supplementaryOfficialSources?.[0]?.url;

assert.equal(buildSsoUrl('ITA1947', 'Section 14(1)'), section14.canonicalUrl);
assert.equal(getSafeOfficialUrl(section14.canonicalUrl, 'Income Tax Act 1947', 'Section 14(1)', 'IRAS'), section14.canonicalUrl);
assert.equal(canonicalizeSsoUrl('https://sso.agc.gov.sg/SL/GSTA1993-RG1#pr28-'), 'https://sso.agc.gov.sg/SL/GSTA1993-RG1?ProvIds=P15-#pr28-');

const response = appendStatutorySourceFooter(
  'A computer server is capital expenditure, not a direct Section 14(1) deduction. Review capital allowances for qualifying plant and machinery.',
  { statutoryAdvisory: [{ authority: 'IRAS', statuteOrAct: 'Income Tax Act 1947', sectionOrSchedule: 'Statutory Directives', topic: 'TAX' }] }
);
assert.match(response, new RegExp(section14.canonicalUrl.replace(/[.?]/g, '\\$&')));
assert.ok(capitalAllowanceGuide);
assert.match(response, new RegExp(capitalAllowanceGuide.replace(/[.?]/g, '\\$&')));

const leaveResponse = appendStatutorySourceFooter('What is the annual leave entitlement under Section 88A of the Employment Act?', {});
assert.match(leaveResponse, /https:\/\/sso\.agc\.gov\.sg\/Act\/EmA1968\?ProvIds=P110-#pr88A-/);
console.log('PASS | Source records consistently provide canonical provisions and optional official guidance');
