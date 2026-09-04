import {
  ArrowLeftRight,
  Circle,
  ClipboardPaste,
  Copy,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Ghost,
  Hand,
  Layers,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pipette,
  Replace,
  RotateCw,
  Square,
  SquareDashed,
  Trash2,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { useT, type Translate } from "../../lib/i18n";
import { rgbaToHex, hexToRgba, type Rgba } from "../../lib/pixel-editor";
import {
  MAX_BRUSH,
  usePaintStore,
  type PaintTool,
} from "../../stores/paint-store";
import { useShortcutStore, type ShortcutAction } from "../../stores/shortcut-store";

interface ToolDefinition {
  tool: PaintTool;
  icon: LucideIcon;
  name: string;
  description: string;
  action: ShortcutAction;
}

const TOOLS: ToolDefinition[] = [
  {
    tool: "pencil",
    icon: Pencil,
    name: "Pencil",
    description: "Paints the primary color. Right-drag paints the secondary one.",
    action: "toolPencil",
  },
  {
    tool: "eraser",
    icon: Eraser,
    name: "Eraser",
    description: "Clears pixels back to transparent.",
    action: "toolEraser",
  },
  {
    tool: "picker",
    icon: Pipette,
    name: "Eyedropper",
    description: "Takes the color under the pointer. Alt does the same from any tool.",
    action: "toolPicker",
  },
  {
    tool: "bucket",
    icon: PaintBucket,
    name: "Paint Bucket",
    description: "Fills the contiguous region under the pointer, within the tolerance.",
    action: "toolBucket",
  },
  {
    tool: "replace",
    icon: Replace,
    name: "Replace Color",
    description: "Repaints every pixel of the color you click, contiguous or not.",
    action: "toolReplace",
  },
  {
    tool: "line",
    icon: Minus,
    name: "Line",
    description: "Drag to draw. Shift snaps to 45°.",
    action: "toolLine",
  },
  {
    tool: "rectangle",
    icon: Square,
    name: "Rectangle",
    description: "Drag to draw. Shift keeps it square.",
    action: "toolRectangle",
  },
  {
    tool: "ellipse",
    icon: Circle,
    name: "Ellipse",
    description: "Drag to draw. Shift keeps it circular.",
    action: "toolEllipse",
  },
  {
    tool: "marquee",
    icon: SquareDashed,
    name: "Select Pixels",
    description: "Drag a rectangle. Every tool then writes only inside it.",
    action: "toolMarquee",
  },
  {
    tool: "wand",
    icon: WandSparkles,
    name: "Magic Wand",
    description: "Selects the contiguous region of the color you click.",
    action: "toolWand",
  },
  {
    tool: "move",
    icon: Move,
    name: "Move Pixels",
    description: "Drags the selection elsewhere. Hold Alt to leave a copy behind.",
    action: "toolMove",
  },
  {
    tool: "pan",
    icon: Hand,
    name: "Pan Canvas",
    description: "Moves the camera. Middle-drag and Space do this from any tool.",
    action: "toolPan",
  },
];

const TOLERANCE_TOOLS: PaintTool[] = ["bucket", "replace", "wand"];
const BRUSH_TOOLS: PaintTool[] = ["pencil", "eraser", "line", "rectangle", "ellipse"];
const SHAPE_TOOLS: PaintTool[] = ["rectangle", "ellipse"];

function swatchStyle(color: Rgba) {
  return { background: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})` };
}

function colorTitle(t: Translate, color: Rgba) {
  return color[3] === 0 ? t("Transparent") : rgbaToHex(color).toUpperCase();
}

export interface PaintPaletteProps {
  layers: number;
  canRotate: boolean;
  hasSelection: boolean;
  framePalette: Rgba[];
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onRotate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDeleteSelection: () => void;
}

export function PaintPalette({
  layers,
  canRotate,
  hasSelection,
  framePalette,
  onFlipHorizontal,
  onFlipVertical,
  onRotate,
  onCopy,
  onPaste,
  onDeleteSelection,
}: PaintPaletteProps) {
  const t = useT();
  const bindings = useShortcutStore((state) => state.bindings);
  const {
    tool,
    setTool,
    primary,
    secondary,
    setPrimary,
    setSecondary,
    swapColors,
    recentColors,
    brushSize,
    setBrushSize,
    shapeFilled,
    setShapeFilled,
    tolerance,
    setTolerance,
    layer,
    setLayer,
    onionSkin,
    toggleOnionSkin,
    showOtherLayers,
    setShowOtherLayers,
    clipboard,
  } = usePaintStore();
  return (
    <div className="paint-palette" onPointerDown={(event) => event.stopPropagation()}>
      <div className="paint-tool-grid">
        {TOOLS.map((entry) => (
          <Tooltip
            key={entry.tool}
            label={t(entry.name)}
            description={t(entry.description)}
            shortcut={bindings[entry.action]}
          >
            <Button
              variant="ghost"
              size="icon"
              className={tool === entry.tool ? "tool-active" : ""}
              aria-pressed={tool === entry.tool}
              onClick={() => setTool(entry.tool)}
            >
              <entry.icon size={14} />
            </Button>
          </Tooltip>
        ))}
      </div>
      <div className="paint-section paint-colors">
        <div className="paint-color-pair">
          <Tooltip
            label={t("Primary color")}
            description={t("Painted by the left button. Click the swatch to change it.")}
          >
            <label className="paint-swatch primary" style={swatchStyle(primary)}>
              <input
                type="color"
                value={rgbaToHex(primary)}
                onChange={(event) => setPrimary(hexToRgba(event.target.value))}
                aria-label={t("Primary color")}
              />
            </label>
          </Tooltip>
          <Tooltip
            label={t("Secondary color")}
            description={t("Painted by the right button.")}
          >
            <label className="paint-swatch secondary" style={swatchStyle(secondary)}>
              <input
                type="color"
                value={rgbaToHex(secondary)}
                onChange={(event) => setSecondary(hexToRgba(event.target.value))}
                aria-label={t("Secondary color")}
              />
            </label>
          </Tooltip>
          <Tooltip
            label={t("Swap colors")}
            description={t("Exchanges the primary and secondary colors.")}
            shortcut={bindings.swapColors}
          >
            <Button variant="ghost" size="icon" onClick={swapColors}>
              <ArrowLeftRight size={13} />
            </Button>
          </Tooltip>
        </div>
        {recentColors.length > 0 && (
          <div className="paint-swatch-row">
            {recentColors.map((color, index) => (
              <button
                key={`${color.join(",")}-${index}`}
                type="button"
                className="paint-mini-swatch"
                style={swatchStyle(color)}
                title={colorTitle(t, color)}
                onClick={() => setPrimary(color)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSecondary(color);
                }}
              />
            ))}
          </div>
        )}
        {framePalette.length > 0 && (
          <>
            <span className="paint-section-label">{t("Colors in this frame")}</span>
            <div className="paint-swatch-row">
              {framePalette.map((color, index) => (
                <button
                  key={`${color.join(",")}-${index}`}
                  type="button"
                  className="paint-mini-swatch"
                  style={swatchStyle(color)}
                  title={colorTitle(t, color)}
                  onClick={() => setPrimary(color)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSecondary(color);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {BRUSH_TOOLS.includes(tool) && (
        <div className="paint-section">
          <span className="paint-section-label">
            {t("Brush")} · {brushSize}px
          </span>
          <input
            type="range"
            min={1}
            max={MAX_BRUSH}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            aria-label={t("Brush size")}
          />
          {SHAPE_TOOLS.includes(tool) && (
            <label className="paint-check">
              <input
                type="checkbox"
                checked={shapeFilled}
                onChange={(event) => setShapeFilled(event.target.checked)}
              />
              <span>{t("Filled")}</span>
            </label>
          )}
        </div>
      )}
      {TOLERANCE_TOOLS.includes(tool) && (
        <div className="paint-section">
          <span className="paint-section-label">
            {t("Tolerance")} · {tolerance}
          </span>
          <input
            type="range"
            min={0}
            max={255}
            value={tolerance}
            onChange={(event) => setTolerance(Number(event.target.value))}
            aria-label={t("Tolerance")}
          />
        </div>
      )}
      {layers > 1 && (
        <div className="paint-section">
          <span className="paint-section-label">
            <Layers size={11} />
            {t("Layer")}
          </span>
          <div className="paint-layer-row">
            {Array.from({ length: layers }, (_, index) => (
              <Tooltip
                key={index}
                label={t("Layer {index}", { index })}
                description={
                  index === 1
                    ? t("Outfits keep their four-color mask here: yellow head, red body, green legs, blue feet.")
                    : t("Paints this layer of the frame. The others stay untouched.")
                }
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={layer === index ? "tool-active" : ""}
                  onClick={() => setLayer(index)}
                >
                  {index}
                </Button>
              </Tooltip>
            ))}
          </div>
          <label className="paint-check">
            <input
              type="checkbox"
              checked={showOtherLayers}
              onChange={(event) => setShowOtherLayers(event.target.checked)}
            />
            <span>{t("Ghost other layers")}</span>
          </label>
        </div>
      )}
      <div className="paint-section paint-actions">
        <Tooltip
          label={t("Copy pixels")}
          description={t("Copies the selection. Without one, the whole layer is copied.")}
          shortcut="Ctrl+C"
        >
          <Button variant="ghost" size="icon" onClick={onCopy}>
            <Copy size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Paste pixels")}
          description={t("Drops the copied pixels on the frame, ready to be dragged into place.")}
          shortcut="Ctrl+V"
        >
          <Button variant="ghost" size="icon" disabled={!clipboard} onClick={onPaste}>
            <ClipboardPaste size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Delete pixels")}
          description={t("Clears the selected pixels.")}
          shortcut="Delete"
        >
          <Button variant="ghost" size="icon" disabled={!hasSelection} onClick={onDeleteSelection}>
            <Trash2 size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Onion skin")}
          description={t("Ghosts the previous and next frames under this one.")}
          shortcut={bindings.toggleOnionSkin}
        >
          <Button
            variant="ghost"
            size="icon"
            className={onionSkin ? "tool-active" : ""}
            onClick={toggleOnionSkin}
          >
            <Ghost size={13} />
          </Button>
        </Tooltip>
      </div>
      <div className="paint-section paint-actions">
        <Tooltip
          label={t("Flip horizontally")}
          description={t("Mirrors the edited layer left to right.")}
          shortcut={bindings.flipHorizontal}
        >
          <Button variant="ghost" size="icon" onClick={onFlipHorizontal}>
            <FlipHorizontal2 size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Flip vertically")}
          description={t("Mirrors the edited layer top to bottom.")}
          shortcut={bindings.flipVertical}
        >
          <Button variant="ghost" size="icon" onClick={onFlipVertical}>
            <FlipVertical2 size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Rotate a quarter turn")}
          description={
            canRotate
              ? t("Turns the edited layer clockwise.")
              : t("Only a square frame can be rotated in place.")
          }
          shortcut={bindings.rotateFrame}
        >
          <Button variant="ghost" size="icon" disabled={!canRotate} onClick={onRotate}>
            <RotateCw size={13} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
