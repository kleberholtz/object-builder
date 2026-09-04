import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Skeleton } from "../../components/ui/skeleton";
import { loadSprite, type NativeSprite } from "../../lib/sprite-cache";
import { objectKey } from "../../lib/utils";
import {
  DEFAULT_OUTFIT_PREVIEW_COLORS,
  type OutfitPreviewColors,
  useEditorStore,
} from "../../stores/editor-store";
import { useSettingsStore } from "../../stores/settings-store";
import { usePaintStore } from "../../stores/paint-store";
import type { ThingObject } from "../../types/editor";

interface SpritePreviewProps {
  spriteId: number;
  object?: ThingObject;
  groupIndex?: number;
  frame?: number;
  size?: number;
  className?: string;
}
export type { NativeSprite };

// Pixels of slack around the viewport. Wide enough that a preview finishes loading
// before it is scrolled into view, narrow enough that an off-screen page of rows
// keeps no image buffers alive.
const PREFETCH_MARGIN = "240px";

function previewColorsToRgb(colors: OutfitPreviewColors) {
  const rgb = (value: string): [number, number, number] => {
    const normalized = value.replace("#", "");
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [
      number,
      number,
      number,
    ];
  };
  return {
    head: rgb(colors.head),
    body: rgb(colors.body),
    legs: rgb(colors.legs),
    feet: rgb(colors.feet),
  };
}

export async function fetchObjectImage(
  object: Pick<ThingObject, "id" | "kind">,
  groupIndex = 0,
  frameIndex = 0,
  patternIndex = 0,
  outfitColors: OutfitPreviewColors = DEFAULT_OUTFIT_PREVIEW_COLORS,
  includeOutfitBase = false,
  allOutfitAddons = false,
) {
  return invoke<NativeSprite>("get_object_image", {
    identity: { id: object.id, kind: object.kind },
    groupIndex,
    frameIndex,
    patternIndex,
    outfitColors: previewColorsToRgb(outfitColors),
    includeOutfitBase,
    allOutfitAddons,
  });
}

export async function fetchSprite(spriteId: number) {
  return loadSprite(spriteId);
}

export function outfitPreviewPatternIndex(
  object: ThingObject,
  groupIndex: number,
  direction: number,
  addon: number,
) {
  if (object.kind !== "Outfit") return 0;
  const layout = object.frameGroups[groupIndex]?.layout;
  const directionCount = Math.max(1, layout?.patternX ?? object.dimensions.patterns);
  const addonCount = Math.max(1, layout?.patternY ?? 1);
  return (addon % addonCount) * directionCount + (direction % directionCount);
}

/**
 * The scroll container a preview lives in, or null for the page itself. An
 * IntersectionObserver expands only its *root* by `rootMargin`: left on the
 * document, the margin buys nothing, because the row is already clipped by the
 * list it scrolls in and only counts as visible once it is truly on screen. Handed
 * the list as the root, the margin does what it is there for and the row loads
 * just before it is scrolled to.
 */
function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Reports whether the element is near the viewport. Previews outside it are never
 * requested, and the canvas they had is released, so a long list costs the memory
 * of what is on screen instead of the memory of the whole page.
 */
function useNearViewport(ref: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[entries.length - 1].isIntersecting),
      { root: scrollParent(element), rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

export function SpritePreview({
  spriteId,
  object,
  groupIndex = 0,
  frame = 0,
  size = 44,
  className = "",
}: SpritePreviewProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [hasImage, setHasImage] = useState(false);
  const [ratio, setRatio] = useState(1);
  const near = useNearViewport(wrapRef);
  const key = object ? objectKey(object) : null;
  const defaultOutfitColors = useSettingsStore((state) => state.defaultOutfitColors);
  const outfitColors =
    useEditorStore((state) => (key ? state.outfitPreviewColors[key] : undefined)) ??
    defaultOutfitColors;
  const previewDirection = useEditorStore((state) =>
    key ? (state.outfitPreviewDirections[key] ?? 0) : 0,
  );
  const previewAddon = useEditorStore((state) => (key ? (state.outfitPreviewAddons[key] ?? 0) : 0));
  const previewWithBody = useEditorStore((state) =>
    key ? (state.outfitPreviewWithBody[key] ?? true) : true,
  );
  const patternIndex = object
    ? outfitPreviewPatternIndex(object, groupIndex, previewDirection, Math.max(0, previewAddon))
    : 0;
  // A preview holds pixels, not a subscription to them. The pixel editor rewrites sprite
  // bytes under ids that never change, so the only signal a thumbnail has is this counter.
  const previewRevision = usePaintStore((state) => state.previewRevision);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !near) return;
    let cancelled = false;
    setLoading(true);
    const request = object
      ? fetchObjectImage(
          object,
          groupIndex,
          frame,
          patternIndex,
          outfitColors,
          previewAddon !== 0 && previewWithBody,
          previewAddon === -1,
        )
      : fetchSprite(spriteId);
    void request
      .then((image) => {
        if (!image || cancelled) return;
        canvas.width = image.width;
        canvas.height = image.height;
        context.clearRect(0, 0, image.width, image.height);
        context.putImageData(
          new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
          0,
          0,
        );
        setRatio(image.width / image.height);
        setHasImage(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    frame,
    groupIndex,
    near,
    object,
    outfitColors,
    patternIndex,
    previewAddon,
    previewRevision,
    previewWithBody,
    spriteId,
  ]);
  useEffect(() => {
    const canvas = ref.current;
    if (near || !canvas) return;
    // Collapsing the canvas is what actually frees the pixels: WebKit keeps a
    // width x height x 4 backing store alive for as long as the element does.
    canvas.width = 1;
    canvas.height = 1;
    setHasImage(false);
  }, [near]);
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio <= 1 ? size : size / ratio;
  return (
    <span
      ref={wrapRef}
      className={`sprite-preview-wrap ${className}`}
      style={{ width: size, height: size }}
    >
      {!hasImage && (loading || !near) && <Skeleton className="sprite-skeleton" />}
      <canvas
        ref={ref}
        width={1}
        height={1}
        className="sprite-preview"
        style={{ width, height, opacity: hasImage ? 1 : 0 }}
      />
    </span>
  );
}
