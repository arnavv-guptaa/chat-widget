import { useEffect, useRef } from "react";

export function useCodeBlockAutoScroll(isStreaming: boolean) {
  const observerRef = useRef<MutationObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStreaming || !containerRef.current) {
      // Clean up observer when not streaming
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      return;
    }

    // Create observer only when streaming starts
    observerRef.current = new MutationObserver(() => {
      if (!containerRef.current) return;

      const codeBlocks = containerRef.current.querySelectorAll("pre");
      codeBlocks.forEach((pre) => {
        pre.scrollTop = pre.scrollHeight;
      });
    });

    // Observe the container for changes
    observerRef.current.observe(containerRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [isStreaming]);

  return containerRef;
}
