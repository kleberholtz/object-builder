import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Film,
  ListOrdered,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { objectKey } from "../../lib/utils";
import { tr, useT } from "../../lib/i18n";
import {
  flushCoreMutations,
  updateObject,
  useHistoryStore,
} from "../../stores/history-store";
import { writeLog } from "../../stores/log-store";
import { useEditorStore } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { useSettingsStore } from "../../stores/settings-store";
import { SpritePreview } from "../sprites/SpritePreview";
import {
  ContextActionMenu,
  type ContextMenuState,
} from "../../components/ui/context-action-menu";
import type { ThingObject } from "../../types/editor";
import { NumberInput } from "../../components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";

type DurationScope = "current" | "selected" | "all";
type DropPosition = "before" | "after";
interface FrameDropTarget {
  index: number;
  position: DropPosition;
}

/** Playback positions are read at a glance, so they are seconds with two decimals, not milliseconds. */
function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function FrameDurationInput({
  index,
  value,
  onCommit,
}: {
  index: number;
  value: number;
  onCommit: (value: number) => void;
}) {
  const t = useT();
  return (
    <div
      className="frame-duration"
      title={t(
        "Frame duration in milliseconds. Arrow keys change by 10 ms; hold Shift for 100 ms.",
      )}
    >
      <Clock3 className="duration-clock" size={11} />
      <NumberInput
        className="frame-duration-input"
        dataFrameDuration={index}
        value={value}
        onCommit={onCommit}
        min={1}
        max={60_000}
        step={10}
        shiftStep={100}
        suffix="ms"
        ariaLabel={t("Frame {index} duration in milliseconds", {
          index: index + 1,
        })}
      />
    </div>
  );
}

export function FilmRoll() {
  const t = useT();
  const objects = useProjectStore((state) => state.objects);
  const setObjects = useProjectStore((state) => state.setObjects);
  const frameOrderDrafts = useProjectStore((state) => state.frameOrderDrafts);
  const markFrameOrderDraft = useProjectStore(
    (state) => state.markFrameOrderDraft,
  );
  const clearFrameOrderDraft = useProjectStore(
    (state) => state.clearFrameOrderDraft,
  );
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const {
    activeFrameGroup,
    selectedFrames,
    setSelectedFrames,
    setActiveFrameGroup,
    filmRollCollapsed,
    toggleFilmRoll,
    setFilmRollCollapsed,
  } = useEditorStore();
  const defaultFrameGroup = useSettingsStore(
    (state) => state.defaultFrameGroup,
  );
  const lastFrameGroupType = useSettingsStore(
    (state) => state.lastFrameGroupType,
  );
  const autoPlayAnimation = useSettingsStore(
    (state) => state.autoPlayAnimation,
  );
  const defaultFilmRoll = useSettingsStore((state) => state.defaultFilmRoll);
  const lastFilmRollCollapsed = useSettingsStore(
    (state) => state.lastFilmRollCollapsed,
  );
  const loopAnimation = useSettingsStore((state) => state.loopAnimation);
  const animationSpeed = useSettingsStore((state) => state.animationSpeed);
  const newFrameDuration = useSettingsStore((state) => state.newFrameDuration);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(100);
  const [scope, setScope] = useState<DurationScope>("current");
  const [draggedFrame, setDraggedFrame] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<FrameDropTarget | null>(null);
  const [contextMenu, setContextMenu] =
    useState<ContextMenuState<number> | null>(null);
  const [applyingOrder, setApplyingOrder] = useState(false);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const object = objects.find((entry) => objectKey(entry) === selectedKey);
  const currentObjectKey = object ? objectKey(object) : "";
  const orderDraft = Boolean(
    currentObjectKey && frameOrderDrafts[currentObjectKey],
  );
  const group = object?.frameGroups[activeFrameGroup] ?? object?.frameGroups[0];
  const preferredGroupType =
    defaultFrameGroup === "last"
      ? lastFrameGroupType
      : defaultFrameGroup === "moving"
        ? 1
        : 0;
  const preferredFrameGroup = object
    ? Math.max(
        0,
        object.frameGroups.findIndex(
          (entry) =>
            (entry.layout?.groupType ?? object.frameGroups.indexOf(entry)) ===
            preferredGroupType,
        ),
      )
    : 0;

  useEffect(() => {
    const canPlay = Boolean(
      object?.frameGroups.some((entry) => entry.frames.length > 1),
    );
    setPlaying(autoPlayAnimation && canPlay);
    setPlayhead(0);
    setSelectedFrames([0]);
    setActiveFrameGroup(preferredFrameGroup);
    setScope("current");
    setDraggedFrame(null);
    setDropTarget(null);
    setContextMenu(null);
    setFilmRollCollapsed(
      defaultFilmRoll === "minimized" ||
        (defaultFilmRoll === "last" && lastFilmRollCollapsed),
    );
    // The preferred group is intentionally applied when the selected object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedKey,
    autoPlayAnimation,
    defaultFilmRoll,
    setActiveFrameGroup,
    setFilmRollCollapsed,
    setSelectedFrames,
  ]);
  useEffect(() => {
    if (filmRollCollapsed) setPlaying(false);
  }, [filmRollCollapsed]);
  useEffect(() => {
    if (!group?.frames.length) return;
    const current = Math.min(playhead, group.frames.length - 1);
    if (current !== playhead) setPlayhead(current);
    const reconciled = (
      selectedFrames.length ? selectedFrames : [current]
    ).filter((index) => index < group.frames.length);
    setSelectedFrames(reconciled.length ? reconciled : [current]);
    setDuration(group.frames[current]?.duration ?? 100);
    // Frame identity changes reconcile the roll instead of retaining stale state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, group?.frames.length]);
  useEffect(() => {
    if (!playing || !group || group.frames.length < 2) return;
    const frame = group.frames[playhead % group.frames.length];
    const timer = window.setTimeout(
      () => {
        // The last frame is still shown for its full duration before playback stops.
        if (playhead + 1 >= group.frames.length && !loopAnimation) {
          setPlaying(false);
          return;
        }
        const next = (playhead + 1) % group.frames.length;
        setPlayhead(next);
        setSelectedFrames([next]);
        setDuration(group.frames[next]?.duration ?? 100);
      },
      Math.max(1, frame.duration / animationSpeed),
    );
    return () => window.clearTimeout(timer);
  }, [
    animationSpeed,
    group,
    loopAnimation,
    playhead,
    playing,
    setSelectedFrames,
  ]);

  const trackRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const frameStartedAt = useRef(0);
  useEffect(() => {
    frameStartedAt.current = performance.now();
  }, [playhead, playing]);
  // The playhead is written straight to the DOM: reconciling React sixty times a second to
  // move a line is work the timeline does not need, and the clock beside it moves with it.
  useEffect(() => {
    const track = trackRef.current;
    const frames = group?.frames;
    if (!track || !frames?.length) return;
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0) || 1;
    const current = Math.min(playhead, frames.length - 1);
    const elapsedBefore = frames
      .slice(0, current)
      .reduce((sum, frame) => sum + frame.duration, 0);
    const paint = (offset: number) => {
      track.style.setProperty("--playhead", `${(offset / total) * 100}%`);
      if (clockRef.current)
        clockRef.current.textContent = formatSeconds(offset);
    };
    if (!playing || frames.length < 2) {
      paint(elapsedBefore);
      return;
    }
    const frame = frames[current];
    let raf = 0;
    const tick = () => {
      // The same speed the playback timeout applies, so the line lands on the next frame border.
      const elapsed = Math.min(
        (performance.now() - frameStartedAt.current) * animationSpeed,
        frame.duration,
      );
      paint(elapsedBefore + elapsed);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [animationSpeed, filmRollCollapsed, group, playhead, playing]);

  const hasAnimation = Boolean(
    object &&
    (object.frameGroups.length > 1 ||
      object.frameGroups.some((entry) => entry.frames.length > 1)),
  );
  if (!object || !group || !hasAnimation) return null;
  // The label is the same sentence the log gets: the history panel and the log are two
  // views of the same edit, and writing it twice is how they start to disagree.
  const mutateFrames = (frames: typeof group.frames, label: string) =>
    updateObject(
      object,
      (entry) => ({
        ...entry,
        frameGroups: entry.frameGroups.map((item) =>
          item.id === group.id ? { ...item, frames } : item,
        ),
      }),
      label,
    );
  const reorderFrame = (
    sourceIndex: number,
    targetIndex: number,
    position: DropPosition,
  ) => {
    if (sourceIndex === targetIndex) return;
    let insertion = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
    if (position === "after") insertion += 1;
    insertion = Math.max(0, Math.min(group.frames.length - 1, insertion));
    if (insertion === sourceIndex) return;
    const moveLabel = tr("Moved frame {from} to {to}", {
      from: sourceIndex + 1,
      to: insertion + 1,
    });
    updateObject(
      object,
      (entry) => {
        const frameGroups = entry.frameGroups.map((item) => {
          if (item.id !== group.id) return item;
          const stride = Math.max(
            1,
            Math.floor(item.spriteIds.length / Math.max(1, item.frames.length)),
          );
          const frames = [...item.frames];
          const [movedFrame] = frames.splice(sourceIndex, 1);
          frames.splice(insertion, 0, movedFrame);
          const layouts = item.frames.map((_, index) =>
            item.spriteIds.slice(index * stride, (index + 1) * stride),
          );
          const [movedLayout] = layouts.splice(sourceIndex, 1);
          layouts.splice(insertion, 0, movedLayout);
          return { ...item, frames, spriteIds: layouts.flat() };
        });
        return {
          ...entry,
          frameGroups,
          spriteId: frameGroups[0]?.frames[0]?.spriteId ?? 0,
        };
      },
      moveLabel,
    );
    setSelectedFrames([insertion]);
    setPlayhead(insertion);
    markFrameOrderDraft(objectKey(object));
    writeLog("INFO", moveLabel, `${tr(object.kind)} #${object.id}`);
  };
  const setFrameDuration = (index: number, value: number) => {
    const valid = Math.round(value);
    if (!Number.isFinite(valid) || valid < 1 || valid > 60_000) {
      writeLog(
        "WARNING",
        tr("Frame duration must be between 1 and 60,000 ms"),
        tr("Frame {index}", { index: index + 1 }),
      );
      return;
    }
    if (group.frames[index]?.duration === valid) return;
    mutateFrames(
      group.frames.map((frame, frameIndex) =>
        frameIndex === index ? { ...frame, duration: valid } : frame,
      ),
      tr("Applied {duration} ms to {count} frame", {
        duration: valid,
        count: 1,
      }),
    );
  };
  const applyDuration = () => {
    const valid = Math.round(duration);
    if (!Number.isFinite(valid) || valid < 1 || valid > 60_000) {
      writeLog("WARNING", tr("Frame duration must be between 1 and 60,000 ms"));
      return;
    }
    const current = selectedFrames[0] ?? playhead;
    const targets =
      scope === "all"
        ? group.frames.map((_, index) => index)
        : scope === "selected"
          ? selectedFrames
          : [current];
    if (!targets.length) {
      writeLog(
        "WARNING",
        tr("Select at least one frame before applying duration"),
      );
      return;
    }
    const targetSet = new Set(targets);
    const durationLabel = tr(
      targets.length === 1
        ? "Applied {duration} ms to {count} frame"
        : "Applied {duration} ms to {count} frames",
      { duration: valid, count: targets.length },
    );
    mutateFrames(
      group.frames.map((frame, index) =>
        targetSet.has(index) ? { ...frame, duration: valid } : frame,
      ),
      durationLabel,
    );
    writeLog("INFO", durationLabel, `${tr(object.kind)} #${object.id}`);
  };
  const duplicateFrame = (sourceIndex: number, duration?: number) => {
    const duplicateLabel = tr("Duplicated frame {index}", {
      index: sourceIndex + 1,
    });
    updateObject(
      object,
      (entry) => ({
        ...entry,
        frameGroups: entry.frameGroups.map((item) => {
          if (item.id !== group.id) return item;
          const stride = Math.max(
            1,
            Math.floor(item.spriteIds.length / Math.max(1, item.frames.length)),
          );
          const copy = {
            ...item.frames[sourceIndex],
            id: Date.now() + item.frames.length,
            duration: duration ?? item.frames[sourceIndex].duration,
          };
          return {
            ...item,
            frames: [...item.frames, copy],
            spriteIds: [
              ...item.spriteIds,
              ...item.spriteIds.slice(
                sourceIndex * stride,
                (sourceIndex + 1) * stride,
              ),
            ],
          };
        }),
      }),
      duplicateLabel,
    );
    markFrameOrderDraft(objectKey(object));
    writeLog("INFO", duplicateLabel, `${tr(object.kind)} #${object.id}`);
  };
  const deleteFrames = (indexes = selectedFrames) => {
    const deleteLabel = tr(
      indexes.length === 1 ? "Deleted {count} frame" : "Deleted {count} frames",
      {
        count: indexes.length,
      },
    );
    updateObject(
      object,
      (entry) => {
        const frameGroups = entry.frameGroups.map((item) => {
          if (item.id !== group.id) return item;
          const stride = Math.max(
            1,
            Math.floor(item.spriteIds.length / Math.max(1, item.frames.length)),
          );
          return {
            ...item,
            frames: item.frames.filter((_, index) => !indexes.includes(index)),
            spriteIds: item.spriteIds.filter(
              (_, index) => !indexes.includes(Math.floor(index / stride)),
            ),
          };
        });
        return {
          ...entry,
          frameGroups,
          spriteId: frameGroups[0]?.frames[0]?.spriteId ?? 0,
        };
      },
      deleteLabel,
    );
    markFrameOrderDraft(objectKey(object));
    writeLog("INFO", deleteLabel, `${tr(object.kind)} #${object.id}`);
  };
  const applyFrameOrder = async () => {
    if (applyingOrder || !orderDraft || !("__TAURI_INTERNALS__" in window))
      return;
    setApplyingOrder(true);
    try {
      await flushCoreMutations();
      const updated = await invoke<ThingObject>("apply_frame_order", {
        identity: { id: object.id, kind: object.kind },
      });
      setObjects(
        useProjectStore
          .getState()
          .objects.map((entry) =>
            objectKey(entry) === currentObjectKey ? updated : entry,
          ),
      );
      clearFrameOrderDraft(currentObjectKey);
      useHistoryStore.getState().reset();
      writeLog(
        "INFO",
        tr("Frame order applied"),
        tr("{kind} #{id} · Ready to save", {
          kind: tr(object.kind),
          id: object.id,
        }),
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to apply frame order"),
        `${tr(object.kind)} #${object.id}`,
        String(error),
      );
    } finally {
      setApplyingOrder(false);
    }
  };
  const copyFrame = async (index: number) => {
    const stride = Math.max(
      1,
      Math.floor(group.spriteIds.length / Math.max(1, group.frames.length)),
    );
    const value = JSON.stringify(
      {
        frame: group.frames[index],
        spriteIds: group.spriteIds.slice(index * stride, (index + 1) * stride),
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(value);
      writeLog(
        "INFO",
        tr("Copied frame {index}", { index: index + 1 }),
        `${tr(object.kind)} #${object.id}`,
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to copy frame to the system clipboard"),
        undefined,
        String(error),
      );
    }
  };
  const editFrame = (index: number) => {
    setSelectedFrames([index]);
    setPlayhead(index);
    setDuration(group.frames[index]?.duration ?? 100);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>(`[data-frame-duration="${index}"]`)
        ?.focus(),
    );
  };
  const totalDuration = group.frames.reduce(
    (sum, frame) => sum + frame.duration,
    0,
  );
  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(group.frames.length - 1, index));
    if (
      target === playhead &&
      selectedFrames.length === 1 &&
      selectedFrames[0] === target
    )
      return;
    setPlayhead(target);
    setSelectedFrames([target]);
    setDuration(group.frames[target]?.duration ?? 100);
  };
  // The track is measured in time, not in frames: a 500 ms frame owns five times the width of a
  // 100 ms one, and that is what makes the strip above readable as an animation.
  const scrubTo = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    let offset = ratio * totalDuration;
    let index = group.frames.length - 1;
    for (let cursor = 0; cursor < group.frames.length; cursor += 1) {
      if (offset < group.frames[cursor].duration) {
        index = cursor;
        break;
      }
      offset -= group.frames[cursor].duration;
    }
    moveTo(index);
  };
  const selectFrame = (index: number, event: React.MouseEvent) => {
    if (event.shiftKey && selectedFrames.length) {
      const start = Math.min(selectedFrames[0], index),
        end = Math.max(selectedFrames[0], index);
      setSelectedFrames(
        Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
      );
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedFrames(
        selectedFrames.includes(index)
          ? selectedFrames.filter((frame) => frame !== index)
          : [...selectedFrames, index],
      );
    } else setSelectedFrames([index]);
    setPlayhead(index);
    setDuration(group.frames[index]?.duration ?? 100);
  };

  return (
    <section className={`film-roll ${filmRollCollapsed ? "collapsed" : ""}`}>
      <div className="film-header">
        <div className="film-heading-left">
          <Tooltip
            label={
              filmRollCollapsed
                ? t("Expand Film Roll")
                : t("Collapse Film Roll")
            }
            description={t("Releases vertical space for the Canvas.")}
          >
            <Button variant="ghost" size="icon" onClick={toggleFilmRoll}>
              {filmRollCollapsed ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </Button>
          </Tooltip>
          <span className="film-title">
            <Film size={14} />
            {t("Film roll")} <small>{group.name}</small>
          </span>
        </div>
        <div className="film-actions">
          <Tooltip
            label={t("Apply frame order")}
            description={
              orderDraft
                ? t(
                    "Commits the current visual order and recreates continuous frame identifiers. This starts a new Undo/Redo history.",
                  )
                : t("No pending frame order changes.")
            }
          >
            <Button
              className={`order-apply-button ${orderDraft ? "draft" : ""}`}
              variant={orderDraft ? "outline" : "ghost"}
              size="sm"
              disabled={!orderDraft || applyingOrder}
              onClick={() => void applyFrameOrder()}
            >
              {applyingOrder ? (
                <LoaderCircle className="apply-spinner" size={13} />
              ) : (
                <ListOrdered size={13} />
              )}
              {applyingOrder ? t("Applying…") : t("Apply")}
            </Button>
          </Tooltip>
          {!filmRollCollapsed && (
            <>
              <Tooltip
                label={playing ? t("Pause animation") : t("Play animation")}
                description={t(
                  "Previews frames using each frame's configured duration and the playback speed from Settings.",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (
                      !playing &&
                      !loopAnimation &&
                      playhead >= group.frames.length - 1
                    ) {
                      setPlayhead(0);
                      setSelectedFrames([0]);
                    }
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                </Button>
              </Tooltip>
              <span className="timeline-counter">
                {String((selectedFrames[0] ?? 0) + 1).padStart(2, "0")} /{" "}
                {String(group.frames.length).padStart(2, "0")}
              </span>
              <div className="toolbar-separator" />
              <Tooltip
                label={t("Duplicate frame")}
                description={t(
                  "Copies the selected frame metadata and complete sprite layout.",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => duplicateFrame(selectedFrames[0] ?? 0)}
                >
                  <Copy size={13} />
                </Button>
              </Tooltip>
              <Tooltip
                label={t("Delete selected frames")}
                description={t(
                  "Removes selected frames and their matching sprite-layout phases.",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={
                    group.frames.length <= 1 ||
                    selectedFrames.length >= group.frames.length
                  }
                  onClick={() => {
                    deleteFrames();
                    setSelectedFrames([0]);
                    setPlayhead(0);
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {!filmRollCollapsed && (
        <div className="film-body">
          <div className="film-track">
            <div className="frame-strip">
              {group.frames.map((frame, index) => {
                const dropClass =
                  dropTarget?.index === index
                    ? `drop-${dropTarget.position}`
                    : "";
                return (
                  <div
                    key={`${objectKey(object)}:${group.id}:${index}`}
                    className={`frame-card ${selectedFrames.includes(index) ? "selected" : ""} ${playing && playhead === index ? "playing" : ""} ${draggedFrame === index ? "dragging" : ""} ${dropClass}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedFrames([index]);
                      setPlayhead(index);
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        target: index,
                      });
                    }}
                    onDragStart={(event) => {
                      setDraggedFrame(index);
                      setDropTarget(null);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                    }}
                    onDragEnd={() => {
                      setDraggedFrame(null);
                      setDropTarget(null);
                    }}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget;
                      if (
                        !(next instanceof Node) ||
                        !event.currentTarget.contains(next)
                      ) {
                        if (dropTarget?.index === index) setDropTarget(null);
                      }
                    }}
                    onDragOver={(event) => {
                      if (draggedFrame === null || draggedFrame === index)
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      setDropTarget({
                        index,
                        position:
                          event.clientX < bounds.left + bounds.width / 2
                            ? "before"
                            : "after",
                      });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const source =
                        draggedFrame ??
                        Number(event.dataTransfer.getData("text/plain"));
                      const destination =
                        dropTarget?.index === index
                          ? dropTarget
                          : { index, position: "before" as const };
                      if (Number.isInteger(source))
                        reorderFrame(
                          source,
                          destination.index,
                          destination.position,
                        );
                      setDraggedFrame(null);
                      setDropTarget(null);
                    }}
                  >
                    <button
                      draggable
                      className="frame-select"
                      title={t("Drag this preview to reorder the frame")}
                      onClick={(event) => selectFrame(index, event)}
                    >
                      <span className="frame-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="frame-thumb">
                        <SpritePreview
                          spriteId={frame.spriteId}
                          object={object}
                          groupIndex={object.frameGroups.indexOf(group)}
                          frame={index}
                          size={50}
                        />
                      </span>
                    </button>
                    <FrameDurationInput
                      index={index}
                      value={frame.duration}
                      onCommit={(value) => setFrameDuration(index, value)}
                    />
                  </div>
                );
              })}
              <Tooltip
                label={t("Add frame")}
                description={t(
                  "Copies the final frame layout into a new frame using the configured default duration.",
                )}
              >
                <button
                  className="add-frame"
                  onClick={() =>
                    duplicateFrame(group.frames.length - 1, newFrameDuration)
                  }
                >
                  <Plus size={17} />
                  <span>{t("Add frame")}</span>
                </button>
              </Tooltip>
            </div>
            <div className="frame-timeline">
              <div
                ref={trackRef}
                className={`timeline-track ${playing ? "running" : ""}`}
                role="slider"
                tabIndex={0}
                aria-label={t("Animation timeline")}
                aria-valuemin={1}
                aria-valuemax={group.frames.length}
                aria-valuenow={Math.min(playhead, group.frames.length - 1) + 1}
                aria-valuetext={t("Frame {index}", { index: playhead + 1 })}
                title={t(
                  "Each frame occupies the share of the track its duration represents. Click or drag to move the playhead.",
                )}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  scrubTo(event);
                }}
                onPointerMove={(event) => {
                  if (event.buttons === 1) scrubTo(event);
                }}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!step) return;
                  event.preventDefault();
                  moveTo(playhead + step);
                }}
              >
                {group.frames.map((frame, index) => (
                  <div
                    key={`${group.id}:timeline:${index}`}
                    className={`timeline-frame ${selectedFrames.includes(index) ? "selected" : ""} ${playhead === index ? "current" : ""}`}
                    style={{ flexGrow: frame.duration }}
                    onDoubleClick={() => editFrame(index)}
                  >
                    <span>{index + 1}</span>
                  </div>
                ))}
                <span className="timeline-playhead" aria-hidden="true" />
              </div>
              <span className="timeline-clock">
                <span ref={clockRef}>{formatSeconds(0)}</span>
                {" / "}
                {formatSeconds(totalDuration)}
              </span>
            </div>
          </div>
          <aside className="duration-editor">
            <strong>{t("Apply duration")}</strong>
            <label>
              <span>{t("Duration")}</span>
              <NumberInput
                value={duration}
                onCommit={setDuration}
                min={1}
                max={60_000}
                step={10}
                shiftStep={100}
                suffix="ms"
                ariaLabel={t("Duration in milliseconds")}
              />
            </label>
            <RadioGroup
              className="duration-scopes"
              value={scope}
              onValueChange={(value) => setScope(value as DurationScope)}
              aria-label={t("Duration scope")}
            >
              {(["current", "selected", "all"] as const).map((value) => (
                <label key={value}>
                  <RadioGroupItem
                    value={value}
                    id={`duration-scope-${value}`}
                  />
                  <span>
                    {value === "current"
                      ? t("Current frame")
                      : value === "selected"
                        ? t("Selected frames ({count})", {
                            count: selectedFrames.length,
                          })
                        : t("All frames ({count})", {
                            count: group.frames.length,
                          })}
                  </span>
                </label>
              ))}
            </RadioGroup>
            <Button size="sm" onClick={applyDuration}>
              {t("Apply")}
            </Button>
          </aside>
        </div>
      )}
      <ContextActionMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        actions={
          contextMenu
            ? [
                {
                  label: t("Edit duration"),
                  icon: <Pencil size={13} />,
                  onSelect: () => editFrame(contextMenu.target),
                },
                {
                  label: t("Duplicate"),
                  icon: <Copy size={13} />,
                  onSelect: () => duplicateFrame(contextMenu.target),
                },
                {
                  label: t("Copy"),
                  icon: <Copy size={13} />,
                  shortcut: "Ctrl+C",
                  onSelect: () => void copyFrame(contextMenu.target),
                },
                {
                  label: t("Delete"),
                  icon: <Trash2 size={13} />,
                  shortcut: "Delete",
                  danger: true,
                  disabled: group.frames.length <= 1,
                  onSelect: () => {
                    deleteFrames([contextMenu.target]);
                    setSelectedFrames([0]);
                    setPlayhead(0);
                  },
                },
              ]
            : []
        }
      />
    </section>
  );
}
