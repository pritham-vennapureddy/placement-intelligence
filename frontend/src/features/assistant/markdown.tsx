import type { ReactNode } from "react";

/**
 * A small, safe markdown renderer for assistant answers: headings, bullet and
 * numbered lists, tables, bold, italics and inline code. No raw HTML is rendered.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed) { index++; continue; }

    if (/^-{3,}$|^\*{3,}$/.test(trimmed)) {
      blocks.push(<hr key={index} className="my-3 border-slate-200" />);
      index++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push(<p key={index} className="mt-3 font-semibold text-slate-900 first:mt-0">{inline(heading[2]!)}</p>);
      index++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        const cells = lines[index]!.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
        index++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={index} className="my-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            {head && <thead className="bg-slate-50 text-left text-slate-600"><tr>{head.map((cell, i) => <th key={i} className="px-2.5 py-1.5 font-semibold">{inline(cell)}</th>)}</tr></thead>}
            <tbody className="divide-y divide-slate-100">
              {body.map((row, r) => <tr key={r}>{row.map((cell, i) => <td key={i} className="px-2.5 py-1.5 tabular-nums text-slate-700">{inline(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      while (index < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[index]!)) {
        const match = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(lines[index]!)!;
        items.push({ depth: Math.min(Math.floor(match[1]!.length / 2), 3), ordered: /\d/.test(match[2]!), text: match[3]! });
        index++;
      }
      blocks.push(
        <ul key={index} className="my-1.5 space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2" style={{ paddingLeft: `${item.depth * 1.1}rem` }}>
              <span className="select-none text-slate-400">{item.ordered ? "›" : "•"}</span>
              <span>{inline(item.text)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !/^(#{1,4}\s|\||\s*([-*•]|\d+[.)])\s)/.test(lines[index]!.trim())) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push(<p key={index} className="my-1.5">{inline(paragraph.join(" "))}</p>);
  }
  return <div className="text-sm leading-relaxed text-slate-800">{blocks}</div>;
}

/** **bold**, *italic* / _italic_ and `code`. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) parts.push(<strong key={match.index} className="font-semibold text-slate-900">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={match.index} className="rounded bg-slate-100 px-1 text-[0.85em]">{token.slice(1, -1)}</code>);
    else parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
