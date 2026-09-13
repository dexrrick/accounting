import assert from 'node:assert/strict';
import { answerShareStructureQuery } from '../../src/engine/shareTransferQuery.ts';

const answer = answerShareStructureQuery("company A holds 49%, 500 units of company B's share; company A holds 100% 1000 units of company C's share; company A trade company 500 units of company C's share for 300 units of company B's share for a total of 75% control company B");
assert.ok(answer);
assert.match(answer.messageText, /800 \(78\.40%\)/);
assert.match(answer.messageText, /500 \(0\.00%\)/);
assert.match(answer.messageText, /Input inconsistency/);
assert.equal(answer.scenarioState.scenarioType, 'GROUP_SHARE_TRANSFER_ANALYSIS');
console.log('PASS | Share-structure query calculates holdings and flags contradictory control percentage');
