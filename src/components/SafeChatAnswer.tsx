import React, { type ReactNode } from 'react';
import type { OfficialAnswerLink } from '../utils/chatPresentation';
import { getCanonicalOfficialAnswerLinks, prioritizeExplicitAnswerSection } from '../utils/answerPresentation';

function inlineContent(text: string, trustedLinks: OfficialAnswerLink[]): ReactNode[] {
  const fragments: ReactNode[] = [];
  const sourceLink = /\[(?:\*\*([^\]]+)\*\*|([^\]]+))\]\((<https:\/\/[^>\s]+>|https:\/\/(?:[^\s()<>]|\([^()\s]*\))+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = sourceLink.exec(text)) !== null) {
    if (match.index > cursor) fragments.push(...plainContent(text.slice(cursor, match.index), `${cursor}`));
    let canonicalUrl: string | undefined;
    const label = match[1] || match[2];
    const rawUrl = match[3].startsWith('<') ? match[3].slice(1, -1) : match[3];
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.href === rawUrl &&
          trustedLinks.some(link => link.url === rawUrl)) canonicalUrl = rawUrl;
    } catch { /* malformed provider output remains plain text */ }
    fragments.push(canonicalUrl
      ? <a key={`source-${match.index}`} href={canonicalUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200">{label}</a>
      : <React.Fragment key={`untrusted-${match.index}`}>{match[0]}</React.Fragment>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) fragments.push(...plainContent(text.slice(cursor), `${cursor}`));
  return fragments;
}

function plainContent(text: string, key: string): ReactNode[] {
  const output: ReactNode[] = [];
  const bold = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = bold.exec(text)) !== null) {
    if (match.index > cursor) output.push(<React.Fragment key={`${key}-text-${cursor}`}>{text.slice(cursor, match.index)}</React.Fragment>);
    output.push(<strong key={`${key}-bold-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) output.push(<React.Fragment key={`${key}-text-${cursor}`}>{text.slice(cursor)}</React.Fragment>);
  return output;
}

/** Renders a small Markdown subset; content stays escaped React text and links must match the HTTPS source allowlist. */
function tableCells(line: string): string[] {
  const escapedPipe = '\u0000';
  const unescaped = line.replace(/\\\|/g, escapedPipe);
  const withoutEdges = unescaped.trim().replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map(cell => cell.replaceAll(escapedPipe, '|').trim());
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.includes('|');
}

export const SafeChatAnswer: React.FC<{ text: string; trustedLinks: OfficialAnswerLink[] }> = ({ text, trustedLinks }) => {
  const blocks: ReactNode[] = [];
  const safeLinks = getCanonicalOfficialAnswerLinks(trustedLinks);
  const lines = prioritizeExplicitAnswerSection(text).split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`} className="mt-4 first:mt-0 text-base font-semibold text-slate-900 dark:text-workspace-secondary">{inlineContent(heading[2], safeLinks)}</h3>);
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && isTableRow(line) && isTableSeparator(lines[index + 1].trim())) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(tableCells(lines[index].trim()));
        index += 1;
      }
      blocks.push(
        <div key={`table-wrap-${index}`} className="overflow-x-auto">
          <table aria-label="Answer details" className="min-w-full border-collapse text-left text-sm">
            <caption className="sr-only">Answer details</caption>
            <thead>
              <tr>{headers.map((cell, cellIndex) => <th key={`table-heading-${cellIndex}`} scope="col" className="border-b border-workspace-border px-3 py-2 font-semibold">{inlineContent(cell, safeLinks)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`table-row-${rowIndex}`} className="border-b border-workspace-border/70 last:border-b-0">
                  {row.map((cell, cellIndex) => <td key={`table-cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">{inlineContent(cell, safeLinks)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*[-*+]\s+/, '');
        items.push(<li key={`list-item-${index}`}>{inlineContent(item, safeLinks)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`} className="ml-5 list-disc space-y-1.5">{items}</ul>);
      continue;
    }
    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      const start = Number(ordered[1]);
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const item = lines[index].match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={`ordered-item-${index}`} value={Number(item[1])}>{inlineContent(item[2], safeLinks)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`} start={start} className="ml-5 list-decimal space-y-1.5">{items}</ol>);
      continue;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineContent(line, safeLinks)}</p>);
    index += 1;
  }
  return <div className="space-y-3 whitespace-normal">{blocks}</div>;
};
