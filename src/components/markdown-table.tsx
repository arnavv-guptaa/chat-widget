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
 * Sizing model: the table takes its CONTENT width (`max-content`) and scrolls
 * sideways inside the card, rather than being squeezed into the widget. A chat
 * column is ~380px and a six-column table simply does not fit — compressing it
 * shredded cells one character per line. Columns therefore keep their natural
 * widths and the reader pans; `data-overflow` here drives the edge fades that
 * make that panning discoverable.
 *
 * Visual styling lives in styles.src.css under "Tables". Copy serializes the
 * on-screen table to TSV, which pastes cleanly into Excel / Google Sheets /
 * Numbers as real cells.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

interface TableProps {
  children?: ReactNode;
  className?: string;
  // react-markdown passes the mdast node to every component override; keep it
  // out of the DOM spread.
  node?: unknown;
}

/** Which edges have more table hiding past them — drives the fade in CSS. */
type Overflow = "none" | "start" | "end" | "both";

export function MarkdownTable({ children, node: _node, ...props }: TableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [overflow, setOverflow] = useState<Overflow>("none");

  // Keep the edge fades honest: which side is faded depends on where the reader
  // has scrolled to. Re-measured on scroll, on resize, and as the table grows —
  // rows stream in one at a time, so the first measurement is never the last.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const sync = () => {
      // Sub-pixel layout means scrollLeft rarely hits the bounds exactly.
      const slack = 1;
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max <= slack) return setOverflow("none");
      const atStart = scroller.scrollLeft <= slack;
      const atEnd = scroller.scrollLeft >= max - slack;
      setOverflow(atStart ? "end" : atEnd ? "start" : "both");
    };

    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    // ResizeObserver fires on the initial observe, so streamed rows and widget
    // resizes both land here without a polling loop.
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    if (tableRef.current) observer.observe(tableRef.current);
    return () => {
      scroller.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  const scrollable = overflow !== "none";

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
    <div className="chat-table not-prose" data-overflow={overflow}>
      {/* When it overflows the scroll region becomes a labelled, focusable
          region so keyboard users can pan it — a mouse-only scroller would
          strand the hidden columns. It stays out of the tab order otherwise. */}
      <div
        ref={scrollRef}
        className="chat-table-scroll"
        {...(scrollable
          ? { tabIndex: 0, role: "region", "aria-label": "Table, scrollable" }
          : {})}
      >
        <table ref={tableRef} {...props}>
          {children}
        </table>
      </div>
      <button
        type="button"
        onClick={copy}
        className="chat-table-copy"
        // Pins the button visible through the ✓ confirmation, so moving the
        // pointer off the table doesn't cut the feedback short.
        data-copied={copied ? "" : undefined}
        aria-label={copied ? "Copied" : "Copy table"}
        title="Copy table"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}
