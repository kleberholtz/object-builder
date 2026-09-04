import { Clock3, Copy, Film, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tooltip } from "../../components/ui/tooltip";
import { useEditorStore } from "../../stores/editor-store";
import { updateObject } from "../../stores/history-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { SpritePreview } from "../sprites/SpritePreview";
import { objectKey } from "../../lib/utils";

export function FilmRoll() {
  const objects = useProjectStore((state) => state.objects);
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const { activeFrameGroup, selectedFrames, setSelectedFrames } = useEditorStore();
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const object = objects.find((entry) => objectKey(entry) === selectedKey);
  const group = object?.frameGroups[activeFrameGroup] ?? object?.frameGroups[0];

  useEffect(() => {
    if (!playing || !group || group.frames.length < 2) return;
    const frame = group.frames[playhead % group.frames.length];
    const timer = window.setTimeout(() => {
      const next = (playhead + 1) % group.frames.length;
      setPlayhead(next); setSelectedFrames([next]);
    }, frame.duration);
    return () => window.clearTimeout(timer);
  }, [group, playhead, playing, setSelectedFrames]);

  const hasAnimation = Boolean(object && (object.frameGroups.length > 1 || object.frameGroups.some((entry) => entry.frames.length > 1)));
  if (!object || !group || !hasAnimation) return null;
  const mutateFrames = (frames: typeof group.frames) => updateObject(object, (entry) => ({ ...entry, frameGroups: entry.frameGroups.map((item) => item.id === group.id ? { ...item, frames } : item) }));
  const duplicateFrame = (sourceIndex: number) => updateObject(object, (entry) => ({ ...entry, frameGroups: entry.frameGroups.map((item) => {
    if (item.id !== group.id) return item;
    const stride = Math.max(1, Math.floor(item.spriteIds.length / Math.max(1, item.frames.length)));
    return { ...item, frames: [...item.frames, { ...item.frames[sourceIndex], id: Date.now() }], spriteIds: [...item.spriteIds, ...item.spriteIds.slice(sourceIndex * stride, (sourceIndex + 1) * stride)] };
  }) }));
  const deleteFrames = () => updateObject(object, (entry) => ({ ...entry, frameGroups: entry.frameGroups.map((item) => {
    if (item.id !== group.id) return item;
    const stride = Math.max(1, Math.floor(item.spriteIds.length / Math.max(1, item.frames.length)));
    return { ...item, frames: item.frames.filter((_, index) => !selectedFrames.includes(index)), spriteIds: item.spriteIds.filter((_, index) => !selectedFrames.includes(Math.floor(index / stride))) };
  }) }));
  const selectFrame = (index: number, event: React.MouseEvent) => {
    if (event.shiftKey && selectedFrames.length) {
      const start = Math.min(selectedFrames[0], index), end = Math.max(selectedFrames[0], index);
      setSelectedFrames(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedFrames(selectedFrames.includes(index) ? selectedFrames.filter((frame) => frame !== index) : [...selectedFrames, index]);
    } else setSelectedFrames([index]);
    setPlayhead(index);
  };

  return (
    <section className="film-roll">
      <div className="film-header">
        <span className="film-title"><Film size={14} />Film roll <small>{group.name}</small></span>
        <div className="film-actions">
          <Tooltip label={playing ? "Pause" : "Play animation"}><Button variant="ghost" size="icon" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={13} /> : <Play size={13} />}</Button></Tooltip>
          <span className="timeline-counter">{String((selectedFrames[0] ?? 0) + 1).padStart(2, "0")} / {String(group.frames.length).padStart(2, "0")}</span>
          <div className="toolbar-separator" />
          <Tooltip label="Duplicate frame"><Button variant="ghost" size="icon" onClick={() => duplicateFrame(selectedFrames[0] ?? 0)}><Copy size={13} /></Button></Tooltip>
          <Tooltip label="Delete selected"><Button variant="ghost" size="icon" disabled={group.frames.length <= 1 || selectedFrames.length >= group.frames.length} onClick={() => { deleteFrames(); setSelectedFrames([0]); }}><Trash2 size={13} /></Button></Tooltip>
        </div>
      </div>
      <div className="film-body">
        <div className="frame-strip">
          {group.frames.map((frame, index) => <button draggable key={frame.id} className={`frame-card ${selectedFrames.includes(index) ? "selected" : ""} ${playing && playhead === index ? "playing" : ""}`} onClick={(event) => selectFrame(index, event)}>
            <span className="frame-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="frame-thumb"><SpritePreview spriteId={frame.spriteId} frame={index} size={50} /></span>
            <span className="frame-duration"><Clock3 size={10} />{frame.duration} ms</span>
          </button>)}
          <button className="add-frame" onClick={() => duplicateFrame(group.frames.length - 1)}><Plus size={17} /><span>Add frame</span></button>
        </div>
        <div className="duration-editor"><span>Duration</span><Input type="number" value={group.frames[selectedFrames[0] ?? 0]?.duration ?? 100} onChange={(event) => { const duration = Number(event.target.value); mutateFrames(group.frames.map((frame, index) => selectedFrames.includes(index) ? { ...frame, duration } : frame)); }} /><span>ms</span></div>
      </div>
    </section>
  );
}
