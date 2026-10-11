import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../../src/components/ChatPanel.tsx', import.meta.url), 'utf8');
const sheet = postcss.parse(css);

// Safari's input-focus zoom is triggered below 16 CSS pixels, regardless of
// Tailwind's text-sm class or the user's saved application font setting.
const mobileRule = [];
sheet.walkAtRules('media', (atRule) => {
  if (atRule.params.includes('max-width: 767px') &&
      atRule.params.includes('(hover: none) and (pointer: coarse)')) {
    atRule.walkRules((rule) => {
      if (rule.nodes.some((node) => node.type === 'decl' &&
          node.prop === 'font-size' && node.value === 'max(16px, 1rem)')) {
        mobileRule.push(rule);
      }
    });
  }
});
assert.equal(mobileRule.length, 1, 'Expected one 16px mobile/touch text-control rule');
const [rule] = mobileRule;
assert.equal(rule.parent.parent.type, 'root', 'Override must be outside Tailwind layers');
assert.ok(rule.selectors.some((selector) => selector.startsWith('input:not(')), 'Text input covered');
assert.ok(rule.selectors.includes('textarea'), 'Textarea covered');
assert.ok(rule.selectors.includes('select'), 'Select covered');
for (const type of ['checkbox', 'radio', 'file', 'range', 'hidden']) {
  assert.ok(rule.selectors[0].includes(`not([type="${type}"])`), `Non-text ${type} excluded`);
}
assert.match(chat, /<textarea[\s\S]*?aria-label="Accounting question input"[\s\S]*?text-sm/, 'Chat question textarea still covered despite text-sm');
assert.match(html, /name="viewport"\s+content="width=device-width, initial-scale=1\.0"/, 'Retain responsive viewport');
assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1(?:\.0)?(?:["',\s]|$)/i, 'Do not disable user zoom');

console.log('iOS focus zoom CSS and viewport regression checks passed');
