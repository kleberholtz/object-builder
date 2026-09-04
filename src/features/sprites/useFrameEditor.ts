import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";
import {
  clearMask,
  cloneRaster,
  createRaster,
  drawBrush,
  drawEllipse,
  drawRectangle,
  extractSelection,
  flipHorizontal,
  flipVertical,
  floatingMask,
  floodFill,
  fullMask,
  maskBounds,
  rasterFromNative,
  rasterPalette,
  rasterToNative,
  readPixel,
  rectangleMask,
  replaceColor,
  rotateQuarterTurn,
  stampFloating,
  strokeLine,
  wandMask,
  type PixelMask,
  type RasterImage,
  type Rgba,
} from "../../lib/pixel-editor";
import { tr } from "../../lib/i18n";
import { commitPixelEdit, type PixelEditSide } from "../../stores/history-store";
import { writeLog } from "../../stores/log-store";
import { usePaintStore } from "../../stores/paint-store";
import type { ThingObject } from "../../types/editor";

interface FrameLayerResponse {
  image: { width: number; height: number; rgba: number[] };
  slotIds: number[];
}

interface Point {
  x: number;
  y: number;
}

type DragState =
  | { mode: "freehand"; last: Point; color: Rgba }
  | { mode: "shape"; from: Point; to: Point; color: Rgba; shift: boolean }
  | { mode: "marquee"; from: Point; to: Point }
  | { mode: "floating"; grabX: number; grabY: number };

export interface FrameEditorTarget {
  object?: ThingObject;
  groupIndex: number;
  frameIndex: number;
  frameCount: number;
  patternIndex: number;
  layers: number;
  width: number;
  height: number;
}

export interface FrameEditorCanvases {
  /** The layer being painted. */
  paint: RefObject<HTMLCanvasElement | null>;
  /** Marching-ants outline of the selection and of a floating paste. */
  selection: RefObject<HTMLCanvasElement | null>;
  /** The layers of this frame that are not being edited. */
  otherLayers: RefObject<HTMLCanvasElement | null>;
  /** The neighbouring frames of the group. */
  onion: RefObject<HTMLCanvasElement | null>;
}

const ONION_BEFORE: Rgba = [255, 92, 92, 255];
const ONION_AFTER: Rgba = [92, 168, 255, 255];

function samePixels(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** Snaps a drag to the nearest 45° while Shift is held, as every pixel editor does. */
function constrainLine(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= Math.min(Math.abs(dx), Math.abs(dy))) {
    const span = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: from.x + Math.sign(dx) * span, y: from.y + Math.sign(dy) * span };
  }
  return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

function constrainBox(from: Point, to: Point): Point {
  const span = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return {
    x: from.x + Math.sign(to.x - from.x || 1) * span,
    y: from.y + Math.sign(to.y - from.y || 1) * span,
  };
}

function drawRaster(canvas: HTMLCanvasElement | null, raster: RasterImage | null) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  if (!raster) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  canvas.width = raster.width;
  canvas.height = raster.height;
  context.clearRect(0, 0, raster.width, raster.height);
  context.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
}

/** Flattens a frame layer to a single tint, keeping its alpha — the onion-skin ghost. */
function tintRaster(raster: RasterImage, tint: Rgba) {
  const output = createRaster(raster.width, raster.height);
  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const alpha = raster.data[index * 4 + 3];
    if (!alpha) continue;
    output.data[index * 4] = tint[0];
    output.data[index * 4 + 1] = tint[1];
    output.data[index * 4 + 2] = tint[2];
    output.data[index * 4 + 3] = alpha;
  }
  return output;
}

function mergeRaster(target: RasterImage, source: RasterImage) {
  for (let index = 0; index < target.width * target.height; index += 1) {
    if (!source.data[index * 4 + 3]) continue;
    target.data.set(source.data.subarray(index * 4, index * 4 + 4), index * 4);
  }
}

/**
 * The pixel editor behind the canvas. It owns exactly one thing — the RGBA buffer of
 * the frame layer that is open — and every tool is a mutation of that buffer followed
 * by a repaint. The buffer only reaches the SPR when a gesture ends, so a stroke is
 * one undo step and one write instead of one per pointer sample.
 */
export function useFrameEditor(target: FrameEditorTarget, canvases: FrameEditorCanvases) {
  const {
    editMode,
    tool,
    layer,
    selection,
    floating,
    revision,
    onionSkin,
    showOtherLayers,
    setSelection,
    setFloating,
    setClipboard,
    setPrimary,
    setSecondary,
    rememberColor,
  } = usePaintStore();
  const layerRef = useRef<RasterImage | null>(null);
  const slotIdsRef = useRef<number[]>([]);
  const strokeBeforeRef = useRef<PixelEditSide | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [framePalette, setFramePalette] = useState<Rgba[]>([]);
  const [ready, setReady] = useState(false);
  const { object, groupIndex, frameIndex, frameCount, patternIndex, layers, width, height } = target;
  const identity = useMemo(
    () => (object ? { id: object.id, kind: object.kind } : null),
    [object?.id, object?.kind],
  );

  const editTarget = useMemo(
    () =>
      identity
        ? { identity, groupIndex, frameIndex, patternIndex, layer }
        : null,
    [identity, groupIndex, frameIndex, patternIndex, layer],
  );

  /** Repaints the layer plus whatever the current gesture is showing on top of it. */
  const repaint = useCallback(() => {
    const raster = layerRef.current;
    const canvas = canvases.paint.current;
    if (!canvas || !raster) return;
    const display = cloneRaster(raster);
    const drag = dragRef.current;
    const state = usePaintStore.getState();
    if (drag?.mode === "shape") {
      const to = drag.shift
        ? state.tool === "line"
          ? constrainLine(drag.from, drag.to)
          : constrainBox(drag.from, drag.to)
        : drag.to;
      if (state.tool === "line")
        strokeLine(display, drag.from, to, state.brushSize, drag.color, state.selection);
      else if (state.tool === "rectangle")
        drawRectangle(
          display,
          drag.from,
          to,
          state.brushSize,
          drag.color,
          state.shapeFilled,
          state.selection,
        );
      else
        drawEllipse(
          display,
          drag.from,
          to,
          state.brushSize,
          drag.color,
          state.shapeFilled,
          state.selection,
        );
    }
    if (state.floating) stampFloating(display, state.floating);
    drawRaster(canvas, display);
  }, [canvases.paint]);

  /** The selection outline, drawn as a one-pixel border on its own canvas. */
  const repaintSelection = useCallback(() => {
    const canvas = canvases.selection.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const drag = dragRef.current;
    const live = usePaintStore.getState().floating;
    const mask =
      drag?.mode === "marquee"
        ? rectangleMask(width, height, drag.from, drag.to)
        : live
          ? floatingMask(live, width, height)
          : usePaintStore.getState().selection;
    if (!mask) return;
    const outline = context.createImageData(width, height);
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[index - 1] ||
        !mask[index + 1] ||
        !mask[index - width] ||
        !mask[index + width];
      if (!edge) continue;
      // Alternating black and white is the static stand-in for marching ants: it stays
      // visible over artwork of any colour without animating a canvas every frame.
      const light = (x + y) % 2 === 0;
      const value = light ? 255 : 0;
      outline.data[index * 4] = value;
      outline.data[index * 4 + 1] = value;
      outline.data[index * 4 + 2] = value;
      outline.data[index * 4 + 3] = 235;
    }
    context.putImageData(outline, 0, 0);
  }, [canvases.selection, height, width]);

  // The frame being edited. Refetched whenever the target moves or an undo rewrote the
  // bytes underneath — never after one of our own writes, which the buffer already has.
  useEffect(() => {
    if (!editMode || !identity) return;
    let cancelled = false;
    layerRef.current = null;
    dragRef.current = null;
    strokeBeforeRef.current = null;
    void invoke<FrameLayerResponse>("get_object_frame_layer", {
      identity,
      groupIndex,
      frameIndex,
      patternIndex,
      layer,
    })
      .then((result) => {
        if (cancelled) return;
        const raster = rasterFromNative(result.image);
        layerRef.current = raster;
        slotIdsRef.current = result.slotIds;
        // A stencil is sized to the frame it was drawn on. Carried to a frame of another
        // size it would silently stop every tool, since a miss reads as "not selected".
        const carried = usePaintStore.getState().selection;
        if (carried && carried.length !== raster.width * raster.height) setSelection(null);
        setFramePalette(rasterPalette(raster));
        setReady(true);
        repaint();
        repaintSelection();
      })
      .catch((error) => {
        if (cancelled) return;
        writeLog("ERROR", tr("Unable to open this frame for editing"), undefined, String(error));
        setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    editMode,
    frameIndex,
    groupIndex,
    identity,
    layer,
    patternIndex,
    repaint,
    repaintSelection,
    revision,
    setSelection,
  ]);

  // The layers of this frame that are not open, and the frames on either side of it.
  useEffect(() => {
    if (!editMode || !identity) {
      drawRaster(canvases.otherLayers.current, null);
      drawRaster(canvases.onion.current, null);
      return;
    }
    let cancelled = false;
    const read = (frame: number, index: number) =>
      invoke<FrameLayerResponse>("get_object_frame_layer", {
        identity,
        groupIndex,
        frameIndex: frame,
        patternIndex,
        layer: index,
      }).then((result) => rasterFromNative(result.image));
    if (showOtherLayers && layers > 1) {
      const others = Array.from({ length: layers }, (_, index) => index).filter(
        (index) => index !== layer,
      );
      void Promise.all(others.map((index) => read(frameIndex, index)))
        .then((rasters) => {
          if (cancelled) return;
          const merged = createRaster(width, height);
          rasters.forEach((raster) => mergeRaster(merged, raster));
          drawRaster(canvases.otherLayers.current, merged);
        })
        .catch(() => undefined);
    } else {
      drawRaster(canvases.otherLayers.current, null);
    }
    if (onionSkin && frameCount > 1) {
      const neighbours = [
        { frame: frameIndex - 1, tint: ONION_BEFORE },
        { frame: frameIndex + 1, tint: ONION_AFTER },
      ].filter((entry) => entry.frame >= 0 && entry.frame < frameCount);
      void Promise.all(
        neighbours.map((entry) => read(entry.frame, layer).then((raster) => tintRaster(raster, entry.tint))),
      )
        .then((rasters) => {
          if (cancelled) return;
          const merged = createRaster(width, height);
          rasters.forEach((raster) => mergeRaster(merged, raster));
          drawRaster(canvases.onion.current, merged);
        })
        .catch(() => undefined);
    } else {
      drawRaster(canvases.onion.current, null);
    }
    return () => {
      cancelled = true;
    };
  }, [
    canvases.onion,
    canvases.otherLayers,
    editMode,
    frameCount,
    frameIndex,
    groupIndex,
    height,
    identity,
    layer,
    layers,
    onionSkin,
    patternIndex,
    revision,
    showOtherLayers,
    width,
  ]);

  // Selection and floating pixels also change from outside a gesture — a shortcut, the
  // palette, a paste — so the overlay follows the store as well as the pointer.
  useEffect(() => {
    repaintSelection();
    repaint();
  }, [floating, repaint, repaintSelection, selection]);

  const beginStroke = useCallback(() => {
    if (strokeBeforeRef.current || !layerRef.current) return;
    strokeBeforeRef.current = {
      image: rasterToNative(layerRef.current),
      slotIds: [...slotIdsRef.current],
    };
  }, []);

  const endStroke = useCallback(() => {
    const before = strokeBeforeRef.current;
    const raster = layerRef.current;
    strokeBeforeRef.current = null;
    if (!before || !raster || !editTarget) return;
    const after = rasterToNative(raster);
    // A gesture that ended where it started is not an undo step.
    if (samePixels(before.image.rgba, after.rgba)) return;
    setFramePalette(rasterPalette(raster));
    commitPixelEdit(editTarget, before, after, (result) => {
      slotIdsRef.current = result.slotIds;
      if (result.shared.length)
        writeLog(
          "WARNING",
          tr("{count} edited sprite(s) are shared with other objects, which changed too", {
            count: result.shared.length,
          }),
          undefined,
          result.shared.join(", "),
        );
    });
  }, [editTarget]);

  /** Lays a floating selection down on the layer and closes the undo step that lifted it. */
  const commitFloating = useCallback(() => {
    const live = usePaintStore.getState().floating;
    const raster = layerRef.current;
    if (!live || !raster) return;
    beginStroke();
    stampFloating(raster, live);
    setFloating(null);
    setSelection(floatingMask(live, raster.width, raster.height));
    endStroke();
    repaint();
  }, [beginStroke, endStroke, repaint, setFloating, setSelection]);

  const pointOf = useCallback(
    (event: PointerEvent<HTMLElement>, scale: number): Point => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(width - 1, Math.floor((event.clientX - bounds.left) / scale))),
        y: Math.max(0, Math.min(height - 1, Math.floor((event.clientY - bounds.top) / scale))),
      };
    },
    [height, width],
  );

  const pickAt = useCallback(
    (point: Point, secondary: boolean) => {
      const raster = layerRef.current;
      if (!raster) return;
      const color = readPixel(raster, point.x, point.y);
      if (secondary) setSecondary(color);
      else setPrimary(color);
      if (color[3] > 0) rememberColor(color);
    },
    [rememberColor, setPrimary, setSecondary],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>, scale: number) => {
      const raster = layerRef.current;
      if (!editMode || !raster) return;
      // The middle button and the pan tool belong to the camera, which lives one level up.
      if (event.button === 1 || tool === "pan") return;
      if (event.button !== 0 && event.button !== 2) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = pointOf(event, scale);
      const state = usePaintStore.getState();
      const color = event.button === 2 ? state.secondary : state.primary;
      if (event.altKey) {
        pickAt(point, event.button === 2);
        return;
      }
      const mask = state.selection;
      switch (tool) {
        case "picker":
          pickAt(point, event.button === 2);
          return;
        case "pencil":
        case "eraser": {
          beginStroke();
          const paint: Rgba = tool === "eraser" ? [0, 0, 0, 0] : color;
          drawBrush(raster, point.x, point.y, state.brushSize, paint, mask);
          dragRef.current = { mode: "freehand", last: point, color: paint };
          repaint();
          return;
        }
        case "bucket": {
          beginStroke();
          floodFill(raster, point, color, state.tolerance, mask);
          repaint();
          endStroke();
          return;
        }
        case "replace": {
          beginStroke();
          replaceColor(raster, readPixel(raster, point.x, point.y), color, state.tolerance, mask);
          repaint();
          endStroke();
          return;
        }
        case "line":
        case "rectangle":
        case "ellipse":
          beginStroke();
          dragRef.current = {
            mode: "shape",
            from: point,
            to: point,
            color: event.button === 2 ? state.secondary : state.primary,
            shift: event.shiftKey,
          };
          repaint();
          return;
        case "marquee":
          commitFloating();
          dragRef.current = { mode: "marquee", from: point, to: point };
          repaintSelection();
          return;
        case "wand": {
          commitFloating();
          const wand = wandMask(raster, point, state.tolerance);
          setSelection(wand);
          return;
        }
        case "move": {
          const live = state.floating;
          if (live) {
            dragRef.current = { mode: "floating", grabX: point.x - live.x, grabY: point.y - live.y };
            return;
          }
          const active: PixelMask = state.selection ?? fullMask(width, height);
          if (!active[point.y * width + point.x]) return;
          beginStroke();
          const lifted = extractSelection(raster, active);
          if (!lifted) return;
          // Alt leaves the pixels where they are, which is the copy-drag every editor has.
          if (!event.altKey) clearMask(raster, active);
          setFloating(lifted);
          dragRef.current = {
            mode: "floating",
            grabX: point.x - lifted.x,
            grabY: point.y - lifted.y,
          };
          repaint();
          return;
        }
        default:
          return;
      }
    },
    [
      beginStroke,
      commitFloating,
      editMode,
      endStroke,
      height,
      pickAt,
      pointOf,
      repaint,
      repaintSelection,
      setFloating,
      setSelection,
      tool,
      width,
    ],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>, scale: number) => {
      const drag = dragRef.current;
      const raster = layerRef.current;
      if (!drag || !raster) return;
      const point = pointOf(event, scale);
      const state = usePaintStore.getState();
      if (drag.mode === "freehand") {
        if (point.x === drag.last.x && point.y === drag.last.y) return;
        strokeLine(raster, drag.last, point, state.brushSize, drag.color, state.selection);
        drag.last = point;
        repaint();
        return;
      }
      if (drag.mode === "shape") {
        drag.to = point;
        drag.shift = event.shiftKey;
        repaint();
        return;
      }
      if (drag.mode === "marquee") {
        drag.to = point;
        repaintSelection();
        return;
      }
      const live = state.floating;
      if (!live) return;
      const x = point.x - drag.grabX;
      const y = point.y - drag.grabY;
      if (x === live.x && y === live.y) return;
      setFloating({ ...live, x, y });
    },
    [pointOf, repaint, repaintSelection, setFloating],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const raster = layerRef.current;
      if (!drag || !raster) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      const state = usePaintStore.getState();
      if (drag.mode === "shape") {
        const to = drag.shift
          ? tool === "line"
            ? constrainLine(drag.from, drag.to)
            : constrainBox(drag.from, drag.to)
          : drag.to;
        if (tool === "line") strokeLine(raster, drag.from, to, state.brushSize, drag.color, state.selection);
        else if (tool === "rectangle")
          drawRectangle(raster, drag.from, to, state.brushSize, drag.color, state.shapeFilled, state.selection);
        else
          drawEllipse(raster, drag.from, to, state.brushSize, drag.color, state.shapeFilled, state.selection);
        repaint();
        endStroke();
        return;
      }
      if (drag.mode === "marquee") {
        const mask = rectangleMask(width, height, drag.from, drag.to);
        const bounds = maskBounds(mask, width);
        // A click with no drag is how a selection is dropped, not a one-pixel selection.
        setSelection(bounds && (bounds.width > 1 || bounds.height > 1) ? mask : null);
        repaintSelection();
        return;
      }
      if (drag.mode === "floating") {
        commitFloating();
        return;
      }
      endStroke();
    },
    [commitFloating, endStroke, height, repaint, repaintSelection, setSelection, tool, width],
  );

  /** Replaces the whole layer — the frame transforms. */
  const transform = useCallback(
    (apply: (raster: RasterImage) => RasterImage | null) => {
      const raster = layerRef.current;
      if (!raster) return;
      commitFloating();
      const next = apply(layerRef.current ?? raster);
      if (!next) return;
      beginStroke();
      layerRef.current = next;
      repaint();
      endStroke();
    },
    [beginStroke, commitFloating, endStroke, repaint],
  );

  const copySelection = useCallback(() => {
    const raster = layerRef.current;
    if (!raster) return false;
    const live = usePaintStore.getState().floating;
    if (live) {
      setClipboard({ ...live, data: new Uint8ClampedArray(live.data), mask: new Uint8Array(live.mask) });
      return true;
    }
    const lifted = extractSelection(raster, usePaintStore.getState().selection ?? fullMask(width, height));
    if (!lifted) return false;
    setClipboard(lifted);
    return true;
  }, [setClipboard, width]);

  const cutSelection = useCallback(() => {
    const raster = layerRef.current;
    if (!raster || !copySelection()) return false;
    const mask = usePaintStore.getState().selection;
    if (!mask) return true;
    beginStroke();
    clearMask(raster, mask);
    repaint();
    endStroke();
    return true;
  }, [beginStroke, copySelection, endStroke, repaint]);

  const pasteClipboard = useCallback(() => {
    const raster = layerRef.current;
    const clipboard = usePaintStore.getState().clipboard;
    if (!raster || !clipboard) return false;
    commitFloating();
    beginStroke();
    // A paste lands where the selection is, or at the origin, and is dragged from there.
    const mask = usePaintStore.getState().selection;
    const bounds = mask ? maskBounds(mask, width) : null;
    setFloating({
      ...clipboard,
      data: new Uint8ClampedArray(clipboard.data),
      mask: new Uint8Array(clipboard.mask),
      x: bounds?.left ?? 0,
      y: bounds?.top ?? 0,
    });
    usePaintStore.getState().setTool("move");
    return true;
  }, [beginStroke, commitFloating, setFloating, width]);

  const deleteSelection = useCallback(() => {
    const raster = layerRef.current;
    if (!raster) return false;
    const live = usePaintStore.getState().floating;
    if (live) {
      // Deleting a floating selection throws away the pixels it lifted.
      setFloating(null);
      endStroke();
      repaint();
      return true;
    }
    const mask = usePaintStore.getState().selection;
    if (!mask) return false;
    beginStroke();
    clearMask(raster, mask);
    repaint();
    endStroke();
    return true;
  }, [beginStroke, endStroke, repaint, setFloating]);

  const selectAll = useCallback(() => {
    commitFloating();
    setSelection(fullMask(width, height));
  }, [commitFloating, setSelection, width]);

  const deselect = useCallback(() => {
    commitFloating();
    setSelection(null);
  }, [commitFloating, setSelection]);

  // Leaving edit mode, or moving to another frame, must not strand lifted pixels.
  useEffect(() => {
    if (editMode) return;
    commitFloating();
    setSelection(null);
    setReady(false);
  }, [commitFloating, editMode, setSelection]);

  // Memoised because the canvas publishes this object to the store on every render; a
  // fresh identity each time would push a store update through the whole palette.
  return useMemo(
    () => ({
      ready: ready && editMode,
      framePalette,
      canRotate: width === height,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      copySelection,
      cutSelection,
      pasteClipboard,
      deleteSelection,
      selectAll,
      deselect,
      flipHorizontal: () => transform(flipHorizontal),
      flipVertical: () => transform(flipVertical),
      rotate: () => transform(rotateQuarterTurn),
    }),
    [
      copySelection,
      cutSelection,
      deleteSelection,
      deselect,
      editMode,
      framePalette,
      height,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      pasteClipboard,
      ready,
      selectAll,
      transform,
      width,
    ],
  );
}
