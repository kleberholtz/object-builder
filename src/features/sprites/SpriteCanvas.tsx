import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Grid3X3,
  Hand,
  Maximize2,
  Move,
  RotateCcw,
  RotateCw,
  Scan,
  Settings2,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { IconMenu, MenuItem, MenuLabel, MenuSeparator, MenuSub } from "../../components/ui/menu";
import { Select } from "../../components/ui/select";
import { Tooltip } from "../../components/ui/tooltip";
import { objectDimensions } from "../../lib/dimensions";
import { objectKey } from "../../lib/utils";
import { useT, type Translate } from "../../lib/i18n";
import { DEFAULT_ZOOM, useEditorStore } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { useSettingsStore, type CanvasBackground } from "../../stores/settings-store";
import { usePaintStore } from "../../stores/paint-store";
import { useShortcutStore } from "../../stores/shortcut-store";
import { rgbaToHex } from "../../lib/pixel-editor";
import { PaintPalette } from "./PaintPalette";
import { useFrameEditor } from "./useFrameEditor";
import { fetchObjectImage, outfitPreviewPatternIndex } from "./SpritePreview";

function addonLabel(t: Translate, index: number) {
  return index === 0 ? t("No addons") : t("Addon {index}", { index });
}

// Pattern order of a four-way outfit in the DAT: north, east, south, west. The arrows
// around the object are laid out by where the outfit faces, not by that index order.
const DIRECTION_ARROWS = [
  { index: 0, name: "North", className: "dir-north", Icon: ChevronUp },
  { index: 1, name: "East", className: "dir-east", Icon: ChevronRight },
  { index: 2, name: "South", className: "dir-south", Icon: ChevronDown },
  { index: 3, name: "West", className: "dir-west", Icon: ChevronLeft },
] as const;

const BACKGROUNDS: Array<{ value: CanvasBackground; label: string }> = [
  { value: "checker", label: "Checkerboard" },
  { value: "dark", label: "Solid dark" },
  { value: "light", label: "Solid light" },
  { value: "magenta", label: "Magenta" },
];

// Room reserved around the object when auto-fitting. The wider margin is what keeps the
// direction arrows, which sit outside the stage, inside the work area.
const FIT_MARGIN = 96;
const FIT_MARGIN_WITH_ARROWS = 148;

export function SpriteCanvas() {
  const t = useT();
  const objects = useProjectStore((state) => state.objects);
  const project = useProjectStore((state) => state.project);
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const {
    zoom,
    pan,
    setZoom,
    applyZoom,
    zoomAround,
    panBy,
    setPan,
    resetView,
    showGrid,
    toggleGrid,
    activeFrameGroup,
    setActiveFrameGroup,
    selectedFrames,
    outfitPreviewColors,
    outfitPreviewDirections,
    outfitPreviewAddons,
    outfitPreviewWithBody,
    rotateOutfitPreview,
    setOutfitPreviewDirection,
    initializeOutfitPreview,
    setOutfitPreviewAddon,
    setOutfitPreviewWithBody,
  } = useEditorStore();
  const rememberFrameGroup = useSettingsStore((state) => state.rememberFrameGroup);
  const defaultCanvasZoom = useSettingsStore((state) => state.defaultCanvasZoom);
  const defaultCanvasZoomPercent = useSettingsStore((state) => state.defaultCanvasZoomPercent);
  const lastCanvasZoom = useSettingsStore((state) => state.lastCanvasZoom);
  const defaultOutfitDirection = useSettingsStore((state) => state.defaultOutfitDirection);
  const defaultOutfitAddon = useSettingsStore((state) => state.defaultOutfitAddon);
  const defaultOutfitColors = useSettingsStore((state) => state.defaultOutfitColors);
  const lastOutfitDirection = useSettingsStore((state) => state.lastOutfitDirection);
  const lastOutfitAddon = useSettingsStore((state) => state.lastOutfitAddon);
  const canvasBackground = useSettingsStore((state) => state.canvasBackground);
  const setCanvasBackground = useSettingsStore((state) => state.setCanvasBackground);
  const smoothScaling = useSettingsStore((state) => state.smoothScaling);
  const setSmoothScaling = useSettingsStore((state) => state.setSmoothScaling);
  const showCanvasOverlays = useSettingsStore((state) => state.showCanvasOverlays);
  const setShowCanvasOverlays = useSettingsStore((state) => state.setShowCanvasOverlays);
  const showTileGrid = useSettingsStore((state) => state.showTileGrid);
  const setShowTileGrid = useSettingsStore((state) => state.setShowTileGrid);
  const showObjectBounds = useSettingsStore((state) => state.showObjectBounds);
  const setShowObjectBounds = useSettingsStore((state) => state.setShowObjectBounds);
  const showDirectionArrows = useSettingsStore((state) => state.showDirectionArrows);
  const setShowDirectionArrows = useSettingsStore((state) => state.setShowDirectionArrows);
  const showCanvasAxes = useSettingsStore((state) => state.showCanvasAxes);
  const setShowCanvasAxes = useSettingsStore((state) => state.setShowCanvasAxes);
  const outfitShowBody = useSettingsStore((state) => state.outfitShowBody);
  const object = selectedKey
    ? objects.find((entry) => objectKey(entry) === selectedKey)
    : undefined;
  const previewColors = object
    ? (outfitPreviewColors[objectKey(object)] ?? defaultOutfitColors)
    : defaultOutfitColors;
  const frameGroups = object?.frameGroups ?? [];
  const group = frameGroups[activeFrameGroup] ?? frameGroups[0];
  const previewGroupIndex = group ? Math.max(0, frameGroups.indexOf(group)) : 0;
  const directionCount = Math.max(1, group?.layout?.patternX ?? object?.dimensions.patterns ?? 1);
  const initialDirection =
    defaultOutfitDirection === "last"
      ? lastOutfitDirection
      : ["north", "east", "south", "west"].indexOf(defaultOutfitDirection);
  const previewDirection =
    object?.kind === "Outfit"
      ? (outfitPreviewDirections[objectKey(object)] ?? Math.max(0, initialDirection)) %
        directionCount
      : 0;
  const addonCount = object?.kind === "Outfit" ? Math.max(1, group?.layout?.patternY ?? 1) : 1;
  const initialAddon =
    defaultOutfitAddon === "last"
      ? lastOutfitAddon
      : defaultOutfitAddon === "all"
        ? -1
        : defaultOutfitAddon === "addon2"
          ? 2
          : defaultOutfitAddon === "addon1"
            ? 1
            : 0;
  const storedAddon =
    object?.kind === "Outfit" ? (outfitPreviewAddons[objectKey(object)] ?? initialAddon) : 0;
  const previewAddon = storedAddon === -1 ? -1 : storedAddon % addonCount;
  const previewWithBody =
    object?.kind === "Outfit" ? (outfitPreviewWithBody[objectKey(object)] ?? outfitShowBody) : true;
  const directionNames = directionCount === 4 ? [t("North"), t("East"), t("South"), t("West")] : [];
  const directionLabel =
    directionCount === 1
      ? t("Single direction")
      : (directionNames[previewDirection] ??
        t("Direction {index}", { index: previewDirection + 1 }));
  // Arrows can only mean north/east/south/west; any other pattern count keeps the stepper.
  const arrowsAvailable = object?.kind === "Outfit" && directionCount === 4;
  const arrowsVisible = arrowsAvailable && showDirectionArrows;
  const patternIndex = object
    ? outfitPreviewPatternIndex(
        object,
        previewGroupIndex,
        previewDirection,
        Math.max(0, previewAddon),
      )
    : 0;
  const activeFrame = Math.min(
    selectedFrames[0] ?? 0,
    Math.max(0, (group?.frames.length ?? 1) - 1),
  );
  const editMode = usePaintStore((state) => state.editMode);
  const paintTool = usePaintStore((state) => state.tool);
  const paintLayer = usePaintStore((state) => state.layer);
  const paintSelection = usePaintStore((state) => state.selection);
  const paintFloating = usePaintStore((state) => state.floating);
  const paintPrimary = usePaintStore((state) => state.primary);
  const toggleEditMode = usePaintStore((state) => state.toggleEditMode);
  const editModeShortcut = useShortcutStore((state) => state.bindings.toggleEditMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const otherLayersCanvasRef = useRef<HTMLCanvasElement>(null);
  const onionCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderedObjectKeyRef = useRef<string | null>(null);
  const workareaRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  // The work area is only rendered once something is selected, so every effect that binds
  // to it has to re-run when that flips — otherwise the listeners never attach.
  const hasObject = Boolean(object);
  const dimensions = object
    ? objectDimensions(object, project?.spriteSize ?? 32, activeFrameGroup)
    : null;
  const spriteSize = project?.spriteSize ?? 32;
  const fitMargin = arrowsVisible ? FIT_MARGIN_WITH_ARROWS : FIT_MARGIN;
  const fitScale =
    dimensions && viewport.width > 0 && viewport.height > 0
      ? Math.min(
          16,
          Math.max(0.1, (viewport.width - fitMargin) / dimensions.pixelWidth),
          Math.max(0.1, (viewport.height - fitMargin) / dimensions.pixelHeight),
        )
      : 1;
  const renderScale = Math.max(0.1, fitScale * zoom);
  const renderedWidth = Math.max(1, Math.round((dimensions?.pixelWidth ?? 1) * renderScale));
  const renderedHeight = Math.max(1, Math.round((dimensions?.pixelHeight ?? 1) * renderScale));
  const layerCount = Math.max(1, dimensions?.layers ?? 1);
  const editor = useFrameEditor(
    {
      object,
      groupIndex: previewGroupIndex,
      frameIndex: activeFrame,
      frameCount: group?.frames.length ?? 1,
      patternIndex,
      layers: layerCount,
      width: dimensions?.pixelWidth ?? 0,
      height: dimensions?.pixelHeight ?? 0,
    },
    {
      paint: canvasRef,
      selection: selectionCanvasRef,
      otherLayers: otherLayersCanvasRef,
      onion: onionCanvasRef,
    },
  );
  // An object with fewer layers than the one before it would leave the editor pointing at
  // a layer the frame does not have, and every read of it would fail.
  const setPaintLayer = usePaintStore((state) => state.setLayer);
  useEffect(() => {
    if (paintLayer >= layerCount) setPaintLayer(0);
  }, [layerCount, paintLayer, setPaintLayer]);

  // Window-level shortcuts cannot reach the frame buffer, which lives in this component:
  // the canvas publishes the verbs and the shortcut handler calls them.
  const setPaintController = usePaintStore((state) => state.setController);
  useEffect(() => {
    setPaintController(editor);
    return () => setPaintController(null);
  }, [editor, setPaintController]);

  // The wheel/gesture listeners are registered once and read the live view through refs;
  // re-registering them on every zoom step would drop events mid-pinch.
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };

  useEffect(() => {
    const element = workareaRef.current;
    if (!element) return;
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasObject]);
  useEffect(() => {
    const initialZoom =
      defaultCanvasZoom === "fit"
        ? 1
        : defaultCanvasZoom === "percent"
          ? defaultCanvasZoomPercent / 100
          : defaultCanvasZoom === "last"
            ? lastCanvasZoom
            : DEFAULT_ZOOM;
    applyZoom(initialZoom);
    setPan({ x: 0, y: 0 });
    setCursor({ x: 0, y: 0 });
  }, [applyZoom, defaultCanvasZoom, defaultCanvasZoomPercent, object?.id, object?.kind, setPan]);
  useEffect(() => {
    if (object?.kind !== "Outfit") return;
    const addon = initialAddon === -1 ? -1 : Math.min(Math.max(0, initialAddon), addonCount - 1);
    initializeOutfitPreview(
      objectKey(object),
      Math.max(0, initialDirection) % directionCount,
      addon,
    );
  }, [
    addonCount,
    defaultOutfitAddon,
    defaultOutfitDirection,
    directionCount,
    initializeOutfitPreview,
    object?.id,
    object?.kind,
  ]);

  // In edit mode the same canvas belongs to the pixel editor, which paints the raw
  // layer. Composing the tinted preview over it would fight the tool for the buffer.
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context || !object || !group || editMode) return;
    let cancelled = false;
    const currentObjectKey = objectKey(object);
    if (renderedObjectKeyRef.current !== currentObjectKey) {
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      renderedObjectKeyRef.current = currentObjectKey;
    }
    void fetchObjectImage(
      object,
      previewGroupIndex,
      activeFrame,
      patternIndex,
      previewColors,
      previewAddon !== 0 && previewWithBody,
      previewAddon === -1,
    )
      .then((image) => {
        if (cancelled) return;
        context.canvas.width = image.width;
        context.canvas.height = image.height;
        context.clearRect(0, 0, image.width, image.height);
        context.putImageData(
          new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
          0,
          0,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    activeFrame,
    editMode,
    group,
    object,
    patternIndex,
    previewAddon,
    previewColors,
    previewGroupIndex,
    previewWithBody,
  ]);

  /** Pointer position relative to the work-area centre, which is where the stage sits at pan zero. */
  const focalOf = useCallback((clientX: number, clientY: number) => {
    const bounds = workareaRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clientX - bounds.left - bounds.width / 2,
      y: clientY - bounds.top - bounds.height / 2,
    };
  }, []);

  // A trackpad pinch reaches the page as a wheel event with ctrlKey forced on by the
  // browser, which the event alone cannot tell apart from a real Ctrl + wheel. Following
  // the physical key is what keeps pinch zooming while Ctrl pans.
  const ctrlHeldRef = useRef(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      ctrlHeldRef.current = event.ctrlKey;
    };
    // Releasing Ctrl outside the window never produces a keyup, so the key would stay stuck.
    const clear = () => {
      ctrlHeldRef.current = false;
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Wheel and trackpad. Scrolling zooms — the object is the whole content of this view, so
  // there is nothing below it to scroll to — and Ctrl turns the same wheel into panning.
  // Safari additionally emits its own gesture events for a pinch. The listener is native
  // and non-passive because React's wheel handler cannot preventDefault the browser's own
  // page zoom.
  useEffect(() => {
    const element = workareaRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // ctrlKey without the key actually being down is a pinch, and a pinch zooms.
      if (event.ctrlKey && ctrlHeldRef.current) {
        // Shift turns a vertical-only wheel into horizontal panning, as everywhere else.
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
        panBy(-dx, -dy);
        return;
      }
      // A mouse wheel reports whole notches — 100px, or 1-3 lines/pages — while a trackpad
      // reports single-digit pixels. Normalising and then clamping puts one mouse notch at
      // a comfortable ~20% instead of a 3x jump, and leaves a pinch as fine as it is.
      const pixels =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 100
            : event.deltaY;
      const step = Math.max(-18, Math.min(18, pixels));
      zoomAround(
        viewRef.current.zoom * Math.exp(-step * 0.01),
        focalOf(event.clientX, event.clientY),
      );
    };
    let gestureStartZoom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = viewRef.current.zoom;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      zoomAround(gestureStartZoom * gesture.scale, focalOf(gesture.clientX, gesture.clientY));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    element.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart as EventListener);
      element.removeEventListener("gesturechange", onGestureChange as EventListener);
    };
  }, [focalOf, hasObject, panBy, zoomAround]);

  const gridStyle = useMemo(
    () =>
      showGrid
        ? {
            backgroundImage:
              "linear-gradient(to right, rgba(110,125,145,.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(110,125,145,.22) 1px, transparent 1px)",
            backgroundSize: `${renderScale}px ${renderScale}px`,
          }
        : undefined,
    [renderScale, showGrid],
  );
  const tileGridStyle = useMemo(
    () =>
      showTileGrid
        ? {
            backgroundImage:
              "linear-gradient(to right, rgba(215,123,82,.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(215,123,82,.45) 1px, transparent 1px)",
            backgroundSize: `${renderScale * spriteSize}px ${renderScale * spriteSize}px`,
          }
        : undefined,
    [renderScale, showTileGrid, spriteSize],
  );
  if (!object || !dimensions)
    return (
      <section className="canvas-panel canvas-empty">
        <div className="canvas-empty-state">
          <Scan size={22} />
          <strong>{t("No object selected")}</strong>
          <span>{t("Select an object in the browser to open it on the Canvas.")}</span>
        </div>
      </section>
    );

  const objectKeyValue = objectKey(object);
  const zoomPercent = Math.round(renderScale * 100);
  const paintColor = rgbaToHex(paintPrimary);

  return (
    <section className="canvas-panel">
      <div className="canvas-header">
        <div className="breadcrumbs">
          <span>{t(`${object.kind}s`)}</span>
          <b>/</b>
          <span>#{object.id}</span>
          <b>/</b>
          <strong>{object.name}</strong>
        </div>
        <div className="canvas-meta">
          <span>
            {dimensions.pixelWidth} × {dimensions.pixelHeight} px
          </span>
          <i />
          {dimensions.tileWidth}×{dimensions.tileHeight} tiles
          <i />
          {dimensions.layers} {t("layers")}
        </div>
      </div>
      <div className="frame-group-bar">
        <span className="small-label">{t("Frame group")}</span>
        {frameGroups.map((entry, index) => (
          <button
            key={entry.id}
            className={activeFrameGroup === index ? "active" : ""}
            onClick={() => {
              setActiveFrameGroup(index);
              rememberFrameGroup(entry.layout?.groupType ?? index);
            }}
          >
            <span className={index === 0 ? "status-pulse" : ""} />
            {entry.name}
          </button>
        ))}
        <div className="canvas-inline-tools">
          <Tooltip
            label={t("Edit Mode")}
            description={t(
              "Turns the canvas into a pixel editor for the frame on screen. Edits are written straight into the sprites.",
            )}
            shortcut={editModeShortcut}
          >
            <Button
              variant={editMode ? "default" : "ghost"}
              size="icon"
              aria-pressed={editMode}
              onClick={toggleEditMode}
            >
              <Brush size={13} />
            </Button>
          </Tooltip>
          <div className="canvas-tool-divider" />
          <div className="canvas-zoom-cluster">
            <Tooltip
              label={t("Zoom Out")}
              description={t("Scales the object down around the canvas centre.")}
              shortcut="-"
            >
              <Button variant="ghost" size="icon" onClick={() => setZoom(zoom - 0.1)}>
                <ZoomOut size={13} />
              </Button>
            </Tooltip>
            <span className="canvas-zoom-value">{zoomPercent}%</span>
            <Tooltip
              label={t("Zoom In")}
              description={t("Scales the object up around the canvas centre.")}
              shortcut="+"
            >
              <Button variant="ghost" size="icon" onClick={() => setZoom(zoom + 0.1)}>
                <ZoomIn size={13} />
              </Button>
            </Tooltip>
          </div>
          <Tooltip
            label={t("Fit to Canvas")}
            description={t(
              "Scales the object so it fills the work area with margin, and recentres it.",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                applyZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <Maximize2 size={13} />
            </Button>
          </Tooltip>
          <Tooltip
            label={t("Actual Size")}
            description={t("Renders one sprite pixel per screen pixel.")}
          >
            <Button
              variant="ghost"
              size="icon"
              className="canvas-ratio-button"
              onClick={() => {
                setZoom(1 / fitScale);
                setPan({ x: 0, y: 0 });
              }}
            >
              1:1
            </Button>
          </Tooltip>
          <Tooltip
            label={t("Reset View")}
            description={t("Restores the default zoom and recentres the object.")}
            shortcut="0"
          >
            <Button variant="ghost" size="icon" onClick={resetView}>
              <RotateCcw size={13} />
            </Button>
          </Tooltip>
          <div className="canvas-tool-divider" />
          <Tooltip
            label={t("Pixel Grid")}
            description={t("Displays a grid over the object for pixel-level inspection.")}
            shortcut="G"
          >
            <Button
              variant="ghost"
              size="icon"
              className={showGrid ? "tool-active" : ""}
              onClick={toggleGrid}
            >
              <Grid3X3 size={14} />
            </Button>
          </Tooltip>
          <IconMenu
            trigger={
              <Button variant="ghost" size="icon" aria-label={t("Canvas view options")}>
                <Settings2 size={14} />
              </Button>
            }
          >
            <MenuLabel>{t("Overlays")}</MenuLabel>
            <MenuItem keepOpen checked={showGrid} onSelect={toggleGrid} shortcut="G">
              {t("Pixel grid")}
            </MenuItem>
            <MenuItem
              keepOpen
              checked={showTileGrid}
              onSelect={() => setShowTileGrid(!showTileGrid)}
            >
              {t("Tile grid ({size}px)", { size: spriteSize })}
            </MenuItem>
            <MenuItem
              keepOpen
              checked={showObjectBounds}
              onSelect={() => setShowObjectBounds(!showObjectBounds)}
            >
              {t("Object bounds")}
            </MenuItem>
            <MenuItem
              keepOpen
              checked={showCanvasAxes}
              onSelect={() => setShowCanvasAxes(!showCanvasAxes)}
            >
              {t("Centre axes")}
            </MenuItem>
            <MenuItem
              keepOpen
              checked={showCanvasOverlays}
              onSelect={() => setShowCanvasOverlays(!showCanvasOverlays)}
            >
              {t("Badges and coordinates")}
            </MenuItem>
            {arrowsAvailable && (
              <MenuItem
                keepOpen
                checked={showDirectionArrows}
                onSelect={() => setShowDirectionArrows(!showDirectionArrows)}
              >
                {t("Direction arrows")}
              </MenuItem>
            )}
            <MenuSeparator className="my-1 h-px bg-border" />
            <MenuLabel>{t("Rendering")}</MenuLabel>
            <MenuItem
              keepOpen
              checked={smoothScaling}
              onSelect={() => setSmoothScaling(!smoothScaling)}
            >
              {t("Smooth scaling")}
            </MenuItem>
            <MenuSub label={t("Background")}>
              {BACKGROUNDS.map((entry) => (
                <MenuItem
                  key={entry.value}
                  keepOpen
                  checked={canvasBackground === entry.value}
                  onSelect={() => setCanvasBackground(entry.value)}
                >
                  {t(entry.label)}
                </MenuItem>
              ))}
            </MenuSub>
            <MenuSeparator className="my-1 h-px bg-border" />
            <MenuLabel>{t("View")}</MenuLabel>
            <MenuItem
              onSelect={() => {
                applyZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              {t("Fit to canvas")}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setZoom(1 / fitScale);
                setPan({ x: 0, y: 0 });
              }}
            >
              {t("Actual size (1:1)")}
            </MenuItem>
            <MenuItem onSelect={() => setPan({ x: 0, y: 0 })}>{t("Centre object")}</MenuItem>
            <MenuItem onSelect={resetView} shortcut="0">
              {t("Reset view")}
            </MenuItem>
          </IconMenu>
        </div>
      </div>
      <div
        ref={workareaRef}
        className={`canvas-workarea${showCanvasAxes ? "" : " no-axes"}${panning ? " panning" : ""}`}
        onPointerDown={(event) => {
          // Dragging anywhere on the work area moves the camera. The floating controls sit
          // inside it, so a press that lands on one is theirs and never starts a drag.
          if (event.button !== 0 && event.button !== 1) return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              ".canvas-outfit-controls, .canvas-direction-arrow, .paint-palette",
            )
          )
            return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (panning) panBy(event.movementX, event.movementY);
        }}
        onPointerUp={(event) => {
          if (panning) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setPanning(false);
          }
        }}
        onPointerCancel={() => setPanning(false)}
        onDoubleClick={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(
              ".canvas-outfit-controls, .canvas-direction-arrow, .paint-palette",
            )
          )
            resetView();
        }}
      >
        {showCanvasOverlays && (
          <div className="canvas-corner-label">
            <Scan size={12} />
            {t("Object {width}×{height}", {
              width: dimensions.pixelWidth,
              height: dimensions.pixelHeight,
            })}
            {object.kind === "Outfit" && directionCount > 1 && <> · {directionLabel}</>}
          </div>
        )}
        {editMode && (
          <PaintPalette
            layers={layerCount}
            canRotate={editor.canRotate}
            hasSelection={Boolean(paintSelection || paintFloating)}
            framePalette={editor.framePalette}
            onFlipHorizontal={editor.flipHorizontal}
            onFlipVertical={editor.flipVertical}
            onRotate={editor.rotate}
            onCopy={editor.copySelection}
            onPaste={editor.pasteClipboard}
            onDeleteSelection={editor.deleteSelection}
          />
        )}
        {object.kind === "Outfit" && (addonCount > 1 || !arrowsVisible) && (
          <div className="canvas-outfit-controls">
            {!arrowsVisible && (
              <div className="canvas-outfit-field">
                <span>{t("Direction")}</span>
                <div className="canvas-direction-control">
                  <Tooltip
                    label={t("Previous direction")}
                    description={t(
                      "Rotates the outfit preview to the previous available direction.",
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={directionCount <= 1}
                      onClick={() => rotateOutfitPreview(objectKeyValue, directionCount, -1)}
                      aria-label={t("Previous outfit direction")}
                    >
                      <RotateCcw size={13} />
                    </Button>
                  </Tooltip>
                  <strong>
                    {directionLabel}
                    <small>
                      {previewDirection + 1} / {directionCount}
                    </small>
                  </strong>
                  <Tooltip
                    label={t("Next direction")}
                    description={t("Rotates the outfit preview to the next available direction.")}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={directionCount <= 1}
                      onClick={() => rotateOutfitPreview(objectKeyValue, directionCount, 1)}
                      aria-label={t("Next outfit direction")}
                    >
                      <RotateCw size={13} />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            )}
            {addonCount > 1 && (
              <div className="canvas-outfit-field canvas-addon-field">
                <div className="canvas-outfit-field-heading">
                  <span>{t("Addons")}</span>
                  {previewAddon !== 0 && (
                    <Tooltip
                      label={t("Show body")}
                      description={t(
                        "Composes the selected addon over the outfit body. Uncheck to inspect only the addon.",
                      )}
                    >
                      <label className="canvas-addon-body">
                        <input
                          type="checkbox"
                          checked={previewWithBody}
                          onChange={(event) =>
                            setOutfitPreviewWithBody(objectKeyValue, event.target.checked)
                          }
                        />
                        <span>{t("Show body")}</span>
                      </label>
                    </Tooltip>
                  )}
                </div>
                <Select
                  value={String(previewAddon)}
                  onValueChange={(value) => setOutfitPreviewAddon(objectKeyValue, Number(value))}
                  options={[
                    ...Array.from({ length: addonCount }, (_, index) => ({
                      value: String(index),
                      label: addonLabel(t, index),
                    })),
                    { value: "-1", label: t("All addons") },
                  ]}
                  ariaLabel={t("Outfit addons")}
                />
              </div>
            )}
          </div>
        )}
        <div
          className="canvas-viewport"
          style={{ transform: `translate3d(${Math.round(pan.x)}px, ${Math.round(pan.y)}px, 0)` }}
        >
          <div className="canvas-stage-wrap">
            {arrowsVisible &&
              DIRECTION_ARROWS.map(({ index, name, className, Icon }) => (
                <Tooltip
                  key={index}
                  label={t("Face {direction}", { direction: t(name.toLowerCase()) })}
                  description={t(
                    "Draws the outfit facing {direction}. The object stays in place — only the pattern changes.",
                    { direction: t(name.toLowerCase()) },
                  )}
                >
                  <button
                    type="button"
                    className={`canvas-direction-arrow ${className}${previewDirection === index ? " active" : ""}`}
                    aria-label={t("Face {direction}", { direction: t(name.toLowerCase()) })}
                    aria-pressed={previewDirection === index}
                    onClick={() => setOutfitPreviewDirection(objectKeyValue, index)}
                  >
                    <Icon size={14} />
                  </button>
                </Tooltip>
              ))}
            <div
              className={`sprite-stage stage-${canvasBackground}${
                editMode ? ` editing tool-${paintTool}` : ""
              }`}
              style={{ width: renderedWidth, height: renderedHeight }}
              onPointerDown={(event) => editor.onPointerDown(event, renderScale)}
              onPointerMove={(event) => editor.onPointerMove(event, renderScale)}
              onPointerUp={editor.onPointerUp}
              onPointerCancel={editor.onPointerUp}
              // The right button paints the secondary colour, so it cannot also open a menu.
              onContextMenu={(event) => editMode && event.preventDefault()}
              onMouseMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setCursor({
                  x: Math.max(
                    0,
                    Math.min(
                      dimensions.pixelWidth - 1,
                      Math.floor((event.clientX - bounds.left) / renderScale),
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      dimensions.pixelHeight - 1,
                      Math.floor((event.clientY - bounds.top) / renderScale),
                    ),
                  ),
                });
              }}
            >
              {editMode && (
                <>
                  <canvas
                    ref={onionCanvasRef}
                    className="stage-ghost stage-onion"
                    width={dimensions.pixelWidth}
                    height={dimensions.pixelHeight}
                    style={{ width: renderedWidth, height: renderedHeight }}
                  />
                  <canvas
                    ref={otherLayersCanvasRef}
                    className="stage-ghost stage-other-layers"
                    width={dimensions.pixelWidth}
                    height={dimensions.pixelHeight}
                    style={{ width: renderedWidth, height: renderedHeight }}
                  />
                </>
              )}
              <canvas
                ref={canvasRef}
                className="stage-paint"
                width={dimensions.pixelWidth}
                height={dimensions.pixelHeight}
                style={{
                  width: renderedWidth,
                  height: renderedHeight,
                  imageRendering: smoothScaling && !editMode ? "auto" : "pixelated",
                }}
              />
              {editMode && (
                <canvas
                  ref={selectionCanvasRef}
                  className="stage-selection"
                  width={dimensions.pixelWidth}
                  height={dimensions.pixelHeight}
                  style={{ width: renderedWidth, height: renderedHeight }}
                />
              )}
              {showGrid && <div className="pixel-grid" style={gridStyle} />}
              {showTileGrid && <div className="pixel-grid tile-grid" style={tileGridStyle} />}
              {showObjectBounds && (
                <div className="selection-outline">
                  <span className="handle tl" />
                  <span className="handle tr" />
                  <span className="handle bl" />
                  <span className="handle br" />
                </div>
              )}
            </div>
          </div>
        </div>
        {showCanvasOverlays && (
          <>
            <div className="canvas-hint">
              <Move size={12} />
              {t("Scroll or pinch to zoom")}
              <i />
              <Hand size={11} />
              {editMode
                ? t("Middle-drag or the hand tool moves the camera")
                : t("Drag or Ctrl + scroll to move the camera")}
            </div>
            <div className="cursor-coordinates">
              X {cursor.x.toString().padStart(2, "0")} &nbsp; Y{" "}
              {cursor.y.toString().padStart(2, "0")}
            </div>
            <div className="canvas-ambient">
              {editMode ? (
                <>
                  <Brush size={13} />
                  {t("Layer {index}", { index: paintLayer })}
                  <i />
                  <span className="canvas-ambient-swatch" style={{ background: paintColor }} />
                  {paintColor.toUpperCase()}
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  {smoothScaling ? t("Smooth") : t("Nearest-neighbor")}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
