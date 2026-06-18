"use client";

/**
 * Trigger-driven autocomplete for the chat input. Generic: knows nothing
 * about portfolios, stocks, slash commands, etc. The host app passes an
 * array of InputPlugin definitions to ChatWidget; this component wires
 * them up to the textarea.
 *
 * Behaviour:
 *   - User types a trigger char (e.g. '@'). We capture the offset and
 *     start tracking the query.
 *   - As the user keeps typing, we extract the substring from the
 *     trigger to the cursor and (debounced) call `plugin.fetch(query)`.
 *   - Results render INLINE in a panel above the input — same layout
 *     spot as the StarterMessages suggestions, so we don't fight the
 *     panel's overflow boundaries with an absolute popover.
 *   - ArrowUp/Down navigate, Enter selects, Escape closes.
 *   - On select, we replace the trigger+query span with the plugin's
 *     `onSelect(item)` text.
 *
 * Edge cases handled:
 *   - Trigger only fires when preceded by whitespace or beginning of
 *     input (so an email address "foo@bar" doesn't open the popover).
 *   - Whitespace inside the query closes the popover.
 *   - Backspacing past the trigger char closes the popover.
 *   - Race-condition on activation: keydown sets active synchronously
 *     before the textarea's onChange fires, so on the first render
 *     `value` is still pre-keystroke. We skip the trigger-still-present
 *     check until value is long enough to include the trigger.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../utils/cn";
import type { InputPlugin, InputPluginItem } from "../types";

interface ActiveSession {
  plugin: InputPlugin;
  /** Index of the trigger character within the textarea value. */
  triggerIndex: number;
}

interface UseInputPluginsOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (next: string) => void;
  plugins?: InputPlugin[];
}

const FETCH_DEBOUNCE_MS = 120;

export function useInputPlugins({ textareaRef, value, setValue, plugins }: UseInputPluginsOptions) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [items, setItems] = useState<InputPluginItem[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  // Latches to true the first time we observe `value[triggerIndex]` ===
  // trigger char. Until that flips, we're in the activation race window
  // where `value` may still be pre-keystroke; we don't validate. After
  // it flips, any deviation closes the session — including
  // `value.length === triggerIndex` from backspacing to empty, which
  // would otherwise look like the activation race.
  const sessionValidatedRef = useRef(false);

  const pluginsByTrigger = useMemo(() => {
    const map = new Map<string, InputPlugin>();
    for (const p of plugins ?? []) {
      if (p.trigger.length === 1) map.set(p.trigger, p);
    }
    return map;
  }, [plugins]);

  const query = useMemo(() => {
    if (!active) return "";
    const ta = textareaRef.current;
    if (!ta) return "";
    const cursor = ta.selectionEnd ?? value.length;
    if (cursor <= active.triggerIndex) return "";
    return value.slice(active.triggerIndex + 1, cursor);
  }, [active, value, textareaRef]);

  useEffect(() => {
    if (!active) {
      sessionValidatedRef.current = false;
      return;
    }
    // Latch validated as soon as we see the trigger char in its slot.
    if (value[active.triggerIndex] === active.plugin.trigger) {
      sessionValidatedRef.current = true;
    }
    // Pre-validation: in the activation race window, just wait.
    if (!sessionValidatedRef.current) return;
    // Post-validation: any deviation from `value[triggerIndex] === trigger`
    // means the user backspaced over the trigger or cleared the input.
    if (value[active.triggerIndex] !== active.plugin.trigger) {
      setActive(null);
      return;
    }
    if (/\s/.test(query)) {
      setActive(null);
    }
  }, [active, value, query]);

  // Fetch — sync if the plugin returns an array directly (e.g. a
  // host-side prefetched cache filter), debounced+loading if it
  // returns a Promise.
  useEffect(() => {
    if (!active) {
      setItems([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const reqId = ++requestIdRef.current;
    const result = active.plugin.fetch(query);
    if (Array.isArray(result)) {
      // Sync cache hit — no loading flash, no debounce.
      setItems(result);
      setHighlight(0);
      setLoading(false);
      return;
    }
    // Async path: show loading, debounce keystrokes.
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const items = await result;
        if (reqId !== requestIdRef.current) return;
        setItems(items);
        setHighlight(0);
      } catch (err) {
        console.error("[input-plugin] fetch failed:", err);
        if (reqId !== requestIdRef.current) return;
        setItems([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    }, FETCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [active, query]);

  const close = useCallback(() => {
    setActive(null);
    setItems([]);
    setHighlight(0);
  }, []);

  const selectItem = useCallback(
    (item: InputPluginItem) => {
      if (!active) return;
      const ta = textareaRef.current;
      const cursor = ta?.selectionEnd ?? value.length;
      const replacement = active.plugin.onSelect(item);
      const before = value.slice(0, active.triggerIndex);
      const after = value.slice(cursor);
      const next = `${before}${replacement}${after}`;
      setValue(next);
      const newCursor = before.length + replacement.length;
      setTimeout(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        try {
          t.setSelectionRange(newCursor, newCursor);
        } catch {
          // Some browsers throw on setSelectionRange in certain states.
        }
      }, 0);
      close();
    },
    [active, value, setValue, close, textareaRef],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (active) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlight((h) => (items.length === 0 ? 0 : (h + 1) % items.length));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlight((h) => (items.length === 0 ? 0 : (h - 1 + items.length) % items.length));
          return;
        }
        if (e.key === "Enter") {
          if (items.length > 0) {
            e.preventDefault();
            selectItem(items[highlight]);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          return;
        }
      }
      if (e.key.length === 1 && pluginsByTrigger.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ta = e.currentTarget;
        const cursor = ta.selectionStart ?? value.length;
        const prevChar = cursor > 0 ? value[cursor - 1] : "";
        if (cursor === 0 || /\s/.test(prevChar)) {
          const plugin = pluginsByTrigger.get(e.key)!;
          setActive({ plugin, triggerIndex: cursor });
        }
      }
    },
    [active, items, highlight, selectItem, close, pluginsByTrigger, value],
  );

  // Inline panel rendered above the input. Same layout slot the
  // StarterMessages component uses — keeps the visual language
  // consistent and dodges every overflow / portal pitfall.
  const panel = active ? (
    <PluginPanel
      plugin={active.plugin}
      items={items}
      loading={loading}
      highlight={highlight}
      onHover={setHighlight}
      onSelect={selectItem}
    />
  ) : null;

  return { onKeyDown, panel, isOpen: !!active };
}

interface PluginPanelProps {
  plugin: InputPlugin;
  items: InputPluginItem[];
  loading: boolean;
  highlight: number;
  onHover: (idx: number) => void;
  onSelect: (item: InputPluginItem) => void;
}

function PluginPanel({ plugin, items, loading, highlight, onHover, onSelect }: PluginPanelProps) {
  // Track the scrollable viewport + the rendered item buttons so
  // ArrowUp/Down can scroll the highlighted row into view (Radix's
  // ScrollArea doesn't auto-scroll the keyboard focus target).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const btn = itemRefs.current[highlight];
    const viewport = viewportRef.current;
    if (!btn || !viewport) return;
    // Use bounding-client-rect deltas — offsetTop chains depend on the
    // nearest positioned ancestor, which Radix's ScrollArea wraps in
    // extra DOM, so offsetTop math doesn't reliably give us the button
    // position relative to the viewport.
    const btnRect = btn.getBoundingClientRect();
    const viewRect = viewport.getBoundingClientRect();
    if (btnRect.top < viewRect.top) {
      viewport.scrollTop -= viewRect.top - btnRect.top;
    } else if (btnRect.bottom > viewRect.bottom) {
      viewport.scrollTop += btnRect.bottom - viewRect.bottom;
    }
  }, [highlight]);

  // Visually attached to the input form below: rounded only on the top
  // corners, no bottom border, sits flush with no margin so the seam
  // disappears against the form's top edge. Reads like one continuous
  // surface that "pops out" upward from the input. Width 96% of the
  // input area, centered, so the panel reads as a smaller surface that
  // "popped out" of the input rather than spanning the full width.
  return (
    <div
      role="listbox"
      className="rounded-t-xl bg-[hsl(var(--chat-background))] overflow-hidden mx-auto"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        width: "96%",
        borderTop: "1px solid var(--chat-divider)",
        borderLeft: "1px solid var(--chat-divider)",
        borderRight: "1px solid var(--chat-divider)",
        // Pull down 1px so our bottom edge overlaps the form's top
        // border, removing the visible seam between the two surfaces.
        marginBottom: -1,
      }}
    >
      {plugin.heading && (
        <div
          className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            color: "hsl(var(--chat-text)/0.5)",
            borderBottom: "1px solid var(--chat-divider)",
          }}
        >
          {plugin.heading}
        </div>
      )}

      {loading && items.length === 0 && (
        <div
          className="px-3 py-2 text-[13px]"
          style={{ color: "hsl(var(--chat-text)/0.5)" }}
        >
          Loading…
        </div>
      )}
      {!loading && items.length === 0 && (
        <div
          className="px-3 py-2 text-[13px]"
          style={{ color: "hsl(var(--chat-text)/0.5)" }}
        >
          {plugin.emptyText ?? "No results"}
        </div>
      )}
      {items.length > 0 && (
        <div
          ref={viewportRef}
          className="max-h-[200px] overflow-y-auto"
        >
          <div className="py-1">
            {items.map((item, idx) => (
              <div key={item.id}>
                <button
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={idx === highlight}
                  onMouseEnter={() => onHover(idx)}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "w-full text-left px-3 py-2",
                    "flex items-center justify-between gap-3",
                    "transition-colors duration-150 ease-out",
                    "cursor-pointer",
                  )}
                  style={{
                    backgroundColor:
                      idx === highlight ? "hsl(var(--chat-text)/0.06)" : "transparent",
                  }}
                >
                  <span
                    className="text-[13px] truncate"
                    style={{ color: "hsl(var(--chat-text)/0.85)" }}
                  >
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span
                      className="text-[11px] flex-shrink-0"
                      style={{ color: "hsl(var(--chat-text)/0.4)" }}
                    >
                      {item.sublabel}
                    </span>
                  )}
                </button>
                {idx < items.length - 1 && (
                  <div
                    className="h-px mx-3"
                    style={{ backgroundColor: "var(--chat-divider)" }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
