import { Grid3X3, Maximize, Move, Scan, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { useEditorStore } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { paintSprite } from "./SpritePreview";
import { objectKey } from "../../lib/utils";

export function SpriteCanvas() {
  const objects = useProjectStore((state) => state.objects);
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const { zoom, setZoom, showGrid, toggleGrid, activeFrameGroup, setActiveFrameGroup, selectedFrames } = useEditorStore();
  const object = objects.find((entry) => objectKey(entry) === selectedKey) ?? objects[0];
  const frameGroups = object?.frameGroups ?? [];
  const group = frameGroups[activeFrameGroup] ?? frameGroups[0];
  const activeFrame = selectedFrames[0] ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState({ x: 16, y: 16 });
  const size = Math.round(32 * zoom);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context || !object) return;
    void paintSprite(context, group?.frames[activeFrame]?.spriteId ?? object.spriteId);
  }, [activeFrame, group, object]);

  const gridStyle = useMemo(() => showGrid ? {
    backgroundImage: "linear-gradient(to right, rgba(110,125,145,.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(110,125,145,.22) 1px, transparent 1px)",
    backgroundSize: `${zoom}px ${zoom}px`,
  } : undefined, [showGrid, zoom]);

  if (!object) return null;
  return (
    <section className="canvas-panel">
      <div className="canvas-header">
        <div className="breadcrumbs"><span>{object.kind}s</span><b>/</b><span>#{object.id}</span><b>/</b><strong>{object.name}</strong></div>
        <div className="canvas-meta"><span>{object.dimensions.width * 32} × {object.dimensions.height * 32} px</span><i />RGBA</div>
      </div>
      <div className="frame-group-bar">
        <span className="small-label">Frame group</span>
        {frameGroups.map((entry, index) => <button key={entry.id} className={activeFrameGroup === index ? "active" : ""} onClick={() => setActiveFrameGroup(index)}><span className={index === 0 ? "status-pulse" : ""} />{entry.name}</button>)}
        <div className="canvas-inline-tools">
          <Tooltip label="Toggle pixel grid" shortcut="G"><Button variant="ghost" size="icon" className={showGrid ? "tool-active" : ""} onClick={toggleGrid}><Grid3X3 size={14} /></Button></Tooltip>
          <Tooltip label="Fit to screen"><Button variant="ghost" size="icon" onClick={() => setZoom(12)}><Maximize size={14} /></Button></Tooltip>
        </div>
      </div>
      <div className="canvas-workarea" onWheel={(event) => { if (event.ctrlKey) { event.preventDefault(); setZoom(zoom + (event.deltaY < 0 ? 1 : -1)); } }}>
        <div className="canvas-corner-label"><Scan size={12} />Sprite {group?.frames[activeFrame]?.spriteId ?? object.spriteId}</div>
        <div className="axis axis-x"><span>0</span><span>16</span><span>32</span></div>
        <div className="axis axis-y"><span>0</span><span>16</span><span>32</span></div>
        <div className="sprite-stage" style={{ width: size, height: size }} onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setCursor({ x: Math.max(0, Math.min(31, Math.floor((event.clientX - bounds.left) / zoom))), y: Math.max(0, Math.min(31, Math.floor((event.clientY - bounds.top) / zoom))) });
        }}>
          <canvas ref={canvasRef} width={32} height={32} style={{ width: size, height: size }} />
          {showGrid && <div className="pixel-grid" style={gridStyle} />}
          <div className="selection-outline"><span className="handle tl" /><span className="handle tr" /><span className="handle bl" /><span className="handle br" /></div>
        </div>
        <div className="canvas-hint"><Move size={12} />Space + drag to pan <i /> Ctrl + wheel to zoom</div>
        <div className="cursor-coordinates">X {cursor.x.toString().padStart(2, "0")} &nbsp; Y {cursor.y.toString().padStart(2, "0")}</div>
        <div className="canvas-ambient"><Sparkles size={14} />Nearest-neighbor</div>
      </div>
    </section>
  );
}
