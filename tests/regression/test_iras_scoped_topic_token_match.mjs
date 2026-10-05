import assert from 'node:assert/strict';
import { matchesTopicContentTerm } from '../../src/retrieval/externalSourceValidator.ts';

assert.equal(matchesTopicContentTerm('royalty expenses deductible', 'deductible expenses royalty'), false,
  'Word reordering and royalty/expense number changes stay disabled unless IRAS issue scope opts in.');
assert.equal(matchesTopicContentTerm('royalty expenses deductible', 'deductible expenses royalty', true), true,
  'Scoped IRAS admission accepts reordered complete terms with the reviewed singular/plural variants.');
assert.equal(matchesTopicContentTerm('royalty deductible', 'deductible expenses royalty', true), false,
  'Scoped equivalence still requires every distinctive source term.');
assert.equal(matchesTopicContentTerm('royalty deductible', 'deductible royalty', true), true,
  'The bounded fallback does not broaden ordinary exact multiword terms.');
assert.equal(matchesTopicContentTerm('deductible expenses', 'expenses deductible'), false,
  'Unscoped callers retain exact phrase matching.');

process.stdout.write('IRAS scoped topic-term matching regressions passed.\n');
