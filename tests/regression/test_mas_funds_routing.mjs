import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { querySingaporeStatutes } from '../../src/standards/singaporeStatutesKnowledge.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { getSafeOfficialUrl } from '../../src/utils/statutoryLinkResolver.ts';

const classification = classifyQuestion('what is MAS 13O');
assert.equal(classification.primaryDomain, 'MAS_FUNDS');
assert.deepEqual(classification.authorities, ['MAS']);

const rules = querySingaporeStatutes('what is MAS 13O');
assert.equal(rules[0]?.id, 'MAS_SFO_13O_13U_MATERIAL_CHANGES');
assert.match(rules[0].canonicalUrl, /^https:\/\/ask\.gov\.sg\/mas\/questions\//);
console.log('PASS | MAS 13O routes to MAS funds evidence, not Companies Act fallback');

const vccRules = querySingaporeStatutes('explain VCC to me');
assert.equal(vccRules[0]?.id, 'ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE');
assert.equal(vccRules[0]?.actCode, 'VCCA2018');
assert.match(vccRules[0].canonicalUrl, /^https:\/\/sso\.agc\.gov\.sg\/Act\/VCCA2018/);
assert.match(
  getSafeOfficialUrl('', 'Variable Capital Companies Act 2018', 'Section 5', 'ACRA'),
  /^https:\/\/sso\.agc\.gov\.sg\/Act\/VCCA2018/
);

const vccScenario = await parseAccountingQuery('explain VCC to me');
assert.notEqual(vccScenario.scenarioType, 'UNRECOGNIZED');
assert.equal(vccScenario.isComplete, true);
assert.equal(vccScenario.statutoryAdvisory?.[0]?.statuteOrAct, 'Variable Capital Companies Act 2018');
console.log('PASS | VCC routes to the VCC Act primary source instead of offline mode');
