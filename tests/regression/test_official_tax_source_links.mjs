import assert from 'node:assert/strict';
import { appendStatutorySourceFooter, buildSsoUrl, canonicalizeSsoUrl, getSafeOfficialUrl, sanitizeStatutoryLinks } from '../../src/utils/statutoryLinkResolver.ts';
import { SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';

const section14 = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14_GENERAL_DEDUCTION;
const capitalAllowances = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC19_19A_CAPITAL_ALLOWANCES;
const capitalAllowanceGuide = capitalAllowances.supplementaryOfficialSources?.[0]?.url;

assert.equal(buildSsoUrl('ITA1947', 'Section 14(1)'), '', 'A stored statute URL without URL-specific provenance is not displayable.');
assert.equal(getSafeOfficialUrl(section14.canonicalUrl, 'Income Tax Act 1947', 'Section 14(1)', 'IRAS'), '');
assert.equal(canonicalizeSsoUrl('https://sso.agc.gov.sg/SL/GSTA1993-RG1#pr28-'), '',
  'Legacy SSO fragments do not bypass URL verification by resolving through a sourceStatus-VERIFIED rule.');

const response = appendStatutorySourceFooter(
  'A computer server is capital expenditure, not a direct Section 14(1) deduction. Review capital allowances for qualifying plant and machinery.',
  { statutoryAdvisory: [{ authority: 'IRAS', statuteOrAct: 'Income Tax Act 1947', sectionOrSchedule: 'Statutory Directives', topic: 'TAX' }] }
);
assert.doesNotMatch(response, /sso\.agc\.gov\.sg/, 'Unverified stored SSO URLs are omitted from the footer.');
assert.ok(capitalAllowanceGuide);
assert.doesNotMatch(response, new RegExp(capitalAllowanceGuide.replace(/[.?]/g, '\\$&')),
  'Supplementary IRAS guidance is not linked unless it has its own verified source record');
assert.doesNotMatch(response, /Companies Act 1967/, 'Fuzzy keyword matches must not add unrelated legislation');

const leaveResponse = appendStatutorySourceFooter('What is the annual leave entitlement under Section 88A of the Employment Act?', {});
assert.doesNotMatch(leaveResponse, /sso\.agc\.gov\.sg/, 'A known Act and section do not create a clickable URL without URL provenance.');

const irasPathWithParentheses = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
const sanitizedIrasLink = sanitizeStatutoryLinks(`[IRAS input-tax guidance](${irasPathWithParentheses})`);
assert.equal(sanitizedIrasLink, 'IRAS input-tax guidance', 'An official host alone does not verify an unregistered page URL');

const masSfoFaq = 'https://ask.gov.sg/mas/questions/clx8ktis900dbryozeeumiiux?from=relatedquestions';
assert.equal(getSafeOfficialUrl(masSfoFaq, 'MAS SFO FAQ', '', 'MAS'), masSfoFaq,
  'The explicitly verified MAS FAQ URL remains available without promoting its content status');
const faqResponse = appendStatutorySourceFooter('The SFO FAQ applies.', {
  statutoryAdvisory: [{ authority: 'MAS', statuteOrAct: 'MAS SFO FAQ', sectionOrSchedule: 'Licensing exemption', topic: 'SFO', officialUrl: masSfoFaq }]
});
assert.match(faqResponse, /ask\.gov\.sg\/mas\/questions\/clx8ktis900dbryozeeumiiux/i,
  'The verified MAS FAQ URL should be linked from the answer footer');
assert.doesNotMatch(faqResponse, /Companies Act 1967/);
console.log('PASS | Source records consistently provide canonical provisions and optional official guidance');
