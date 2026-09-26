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
