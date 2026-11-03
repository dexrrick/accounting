import React, { type ReactNode } from 'react';
import type { OfficialAnswerLink } from '../utils/chatPresentation';

function inlineContent(text: string, trustedLinks: OfficialAnswerLink[]): ReactNode[] {
  const fragments: ReactNode[] = [];
  const sourceLink = /\[\*\*([^\]]+)\*\*\]\((https:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = sourceLink.exec(text)) !== null) {
    if (match.index > cursor) fragments.push(...plainContent(text.slice(cursor, match.index), `${cursor}`));
    let canonicalUrl: string | undefined;
    try {
      const parsed = new URL(match[2]);
      if (parsed.protocol === 'https:' && trustedLinks.some(link => link.url === parsed.href)) canonicalUrl = parsed.href;
    } catch { /* malformed provider output remains plain text */ }
    fragments.push(canonicalUrl
      ? <a key={`source-${match.index}`} href={canonicalUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200">{match[1]}</a>
      : <React.Fragment key={`untrusted-${match.index}`}>{match[1]}</React.Fragment>);
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

/** Renders a small Markdown subset; all content stays escaped React text and links must match verified source records. */
export const SafeChatAnswer: React.FC<{ text: string; trustedLinks: OfficialAnswerLink[] }> = ({ text, trustedLinks }) => {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`} className="mt-4 first:mt-0 text-base font-semibold text-slate-900 dark:text-workspace-secondary">{inlineContent(heading[2], trustedLinks)}</h3>);
      index += 1;
      continue;
    }
    if (/^-\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*-\s+/, '');
        items.push(<li key={`list-item-${index}`}>{inlineContent(item, trustedLinks)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`} className="ml-5 list-disc space-y-1.5">{items}</ul>);
      continue;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineContent(line.replace(/<[^>]*>/g, ''), trustedLinks)}</p>);
    index += 1;
  }
  return <div className="space-y-3 whitespace-normal">{blocks}</div>;
};
