import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface VirtualWindow {
  /** Index of the first row that must be mounted. */
  start: number;
  /** Index just past the last row that must be mounted. */
  end: number;
  /** Height of the spacer that stands in for the rows above the window. */
  paddingTop: number;
  /** Height of the spacer that stands in for the rows below the window. */
  paddingBottom: number;
  /** Attach to the scroll viewport. A callback ref, not a `RefObject` — see below. */
  viewportRef: (node: HTMLElement | null) => void;
  /** Attach to the first mounted row so the real row height replaces the estimate. */
  measureRow: (node: HTMLElement | null) => void;
  /** Returns the viewport to the top; call when the rows underneath are replaced. */
  scrollToTop: () => void;
  /** Brings one row into view, mounting it if the window had not reached it yet. */
  scrollToRow: (index: number) => void;
}

interface VirtualWindowOptions {
  /** Total number of rows the list represents, mounted or not. */
  count: number;
  /** Expected row height in pixels; replaced by the measured height of a real row. */
  rowHeight: number;
  /** Extra rows kept mounted above and below the viewport. */
  overscan?: number;
}

/**
 * Mounts only the rows a scroll viewport can show. Every row carries a canvas and
 * a sprite request, so a 500-row page held five hundred image buffers in WebKit
 * for the dozen rows someone was actually looking at.
 *
 * The viewport arrives as a **callback ref**, and that is the whole reason the
 * Sprite Manager scrolled without ever loading a row: a `RefObject` read inside an
 * effect only holds a node if that node mounted in the same commit, and Radix
 * mounts a dialog's portal one commit later. The effect saw `null` and returned —
 * and since its dependency was the ref object, which never changes, it never ran
 * again. No scroll listener was ever attached, so the window stayed frozen on the
 * first screenful while the spacer underneath scrolled past. A callback ref fires
 * when the node actually attaches, whichever commit that happens in.
 */
export function useVirtualWindow({
  count,
  rowHeight,
  overscan = 6,
}: VirtualWindowOptions): VirtualWindow {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState({ scrollTop: 0, height: 0 });
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const rowHeightRef = useRef(rowHeight);

  useLayoutEffect(() => {
    if (!viewport) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setMetrics((current) =>
        current.scrollTop === viewport.scrollTop && current.height === viewport.clientHeight
          ? current
          : { scrollTop: viewport.scrollTop, height: viewport.clientHeight },
      );
    };
    // Scroll fires many times per frame, and only the last read can reach a paint.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [viewport]);

  const measureRow = useCallback((node: HTMLElement | null) => {
    if (node && node.offsetHeight > 0) setMeasuredHeight(node.offsetHeight);
  }, []);

  const scrollToTop = useCallback(() => {
    if (viewport) viewport.scrollTop = 0;
  }, [viewport]);

  const scrollToRow = useCallback(
    (index: number) => {
      if (!viewport) return;
      const height = rowHeightRef.current;
      const top = index * height;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + height > viewport.scrollTop + viewport.clientHeight)
        viewport.scrollTop = top + height - viewport.clientHeight;
    },
    [viewport],
  );

  const height = measuredHeight || rowHeight;
  rowHeightRef.current = height;
  // Before the first layout pass the viewport reports no height; assume a screenful
  // so the initial paint is not an empty list that fills in one frame later.
  const visible = Math.ceil((metrics.height || 640) / height) + 1;
  // Clamping the start to `count - visible` keeps the window full at the bottom of
  // the list, and keeps a scroll position left over from a longer page from
  // mounting a single row when a shorter one replaces it.
  const start = Math.min(
    Math.max(0, Math.floor(metrics.scrollTop / height) - overscan),
    Math.max(0, count - visible),
  );
  const end = Math.min(count, start + visible + overscan * 2);
  return {
    start,
    end,
    paddingTop: start * height,
    paddingBottom: Math.max(0, (count - end) * height),
    viewportRef: setViewport,
    measureRow,
    scrollToTop,
    scrollToRow,
  };
}
