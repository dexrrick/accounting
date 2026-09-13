import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

const initial = await parseAccountingQuery(
  'My Singapore business has taxable turnover of $900,000 this year. Do I need to register for GST?',
  null
);
const followUp = await parseAccountingQuery(
  'Does the threshold apply to accounting revenue or taxable turnover?',
  initial
);

assert.equal(followUp.scenarioType, 'SINGAPORE_STATUTORY_ADVISORY');
assert.equal(followUp.primaryDomain, 'IRAS_GST');
assert.match(followUp.transactionTitle, /GST Registration Threshold/i);
assert.match(followUp.accountingTreatmentSummary || '', /taxable turnover/i);
assert.match(followUp.singaporeTaxTreatmentSummary || '', /taxable supplies/i);
assert.equal(followUp.directGroups?.length, 0);
assert.equal(followUp.statutoryAdvisory?.[0].sectionOrSchedule, 'First Schedule');
assert.doesNotMatch(`${followUp.transactionTitle} ${followUp.singaporeTaxTreatmentSummary}`, /reverse charge/i);

// The same standalone wording must be routed correctly even without prior state.
const standalone = await parseAccountingQuery(
  'Does the threshold apply to accounting revenue or taxable turnover?',
  null
);
assert.equal(standalone.statutoryAdvisory?.[0].sectionOrSchedule, 'First Schedule');

console.log('PASS | GST registration threshold measurement-basis follow-ups retain the GST registration context');
