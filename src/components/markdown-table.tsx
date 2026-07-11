"use client";

/**
 * MarkdownTable — widget-owned renderer for GFM tables in assistant messages.
 *
 * Wired in via Streamdown's `components={{ table: ... }}` override
 * (response.tsx), which REPLACES Streamdown's own table wrapper. That wrapper
 * ships Tailwind utility classes (`bg-sidebar`, `divide-border`, control
 * buttons) that the widget's CSS build never generates, so tables rendered
 * through it came out half-styled. Here the widget owns the whole thing:
 *
 *   ┌─ .chat-table (rounded card) ────────────┐
 *   │ ┌─ .chat-table-scroll (x-scroll) ─────┐ │   [copy — hover-reveal]
 *   │ │ <table> … GFM content … </table>    │ │
 *   │ └─────────────────────────────────────┘ │
 *   └─────────────────────────────────────────┘
 *
 * Visual styling lives in styles.src.css under "Tables". Copy serializes the
 * on-screen table to TSV, which pastes cleanly into Excel / Google Sheets /
 * Numbers as real cells.
 */

import { useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

interface TableProps {
  children?: ReactNode;
  className?: string;
  // react-markdown passes the mdast node to every component override; keep it
  // out of the DOM spread.
  node?: unknown;
}

export function MarkdownTable({ children, node: _node, ...props }: TableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const el = tableRef.current;
    if (!el) return;
    // Serialize what's actually on screen — one row per <tr>, cells
    // tab-separated. Tabs inside a cell would split it, so flatten them.
    const tsv = Array.from(el.querySelectorAll("tr"))
      .map((tr) =>
        Array.from(tr.querySelectorAll("th, td"))
          .map((cell) => (cell.textContent ?? "").trim().replace(/\t+/g, " "))
          .join("\t"),
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. http) — ignore */
    }
  };

  return (
    <div className="chat-table not-prose">
      <div className="chat-table-scroll">
        <table ref={tableRef} {...props}>
          {children}
        </table>
      </div>
      <button
        type="button"
        onClick={copy}
        className="chat-table-copy"
        aria-label={copied ? "Copied" : "Copy table"}
        title="Copy table"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}
