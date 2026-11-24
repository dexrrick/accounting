import { readFileSync } from 'node:fs';

// Selected official wording researched on 25/10/2026. These are excerpt/layout
// fixtures, not complete source captures or live source acceptance results.
const load = (name) => readFileSync(new URL(`./statutoryCoverageSources/${name}`, import.meta.url), 'utf8').trim();
const textHtml = text => '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>';
const raw = (name) => ({ html: load(name), kind: 'VERIFIED_OFFICIAL_HTML_EXCERPT', note: 'Selected native HTML excerpt from a TLS-verified official page fetched on 25/10/2026; not a complete page. Full response hashes and provenance are retained in the development source manifest.' });
const visible = (name) => ({ html: textHtml(load(name)), kind: 'VERIFIED_OFFICIAL_VISIBLE_EXCERPT_LAYOUT_ADAPTED', note: 'Selected exact official visible wording from a TLS-verified page fetched on 25/10/2026; whitespace and table-cell layout normalized. This is not a complete page capture.' });

export const STATUTORY_VERIFIED_EXCERPTS = Object.freeze({
  'iras-gst-filing': raw('iras-gst-filing.html'),
  'cpf-due-date': { html: textHtml(load('cpf-due-date.txt')), kind: 'VERIFIED_OFFICIAL_WEB_READ_EXCERPT', note: 'Exact official FAQ body independently read through the web source tool on 25/10/2026; page last updated 25/06/2024. The separate direct HTTP response was a JavaScript shell and is not body evidence. Not a complete raw capture or historical applicability proof.' },
  'cpf-contribution-rates': visible('cpf-rate-factors.txt'),
  'mom-salary': raw('mom-final-salary.html'),
  'acra-audit-exemption': visible('acra-audit-exemption.txt'),
  'mas-fund-management': raw('mas-fund-management.html')
});
