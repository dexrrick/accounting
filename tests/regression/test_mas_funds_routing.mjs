import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { querySingaporeStatutes } from '../../src/standards/singaporeStatutesKnowledge.ts';

const classification = classifyQuestion('what is MAS 13O');
assert.equal(classification.primaryDomain, 'MAS_FUNDS');
assert.deepEqual(classification.authorities, ['MAS']);

const rules = querySingaporeStatutes('what is MAS 13O');
assert.equal(rules[0]?.id, 'MAS_SFO_13O_13U_MATERIAL_CHANGES');
assert.match(rules[0].canonicalUrl, /^https:\/\/ask\.gov\.sg\/mas\/questions\//);
console.log('PASS | MAS 13O routes to MAS funds evidence, not Companies Act fallback');
