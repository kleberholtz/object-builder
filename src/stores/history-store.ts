import { create } from "zustand";
import { invalidateSpriteCache } from "../lib/sprite-cache";
import { useProjectStore } from "./project-store";
import { useSelectionStore } from "./selection-store";
import { usePaintStore } from "./paint-store";
import type { ObjectKind, ThingObject } from "../types/editor";
import { invoke } from "@tauri-apps/api/core";
import { writeLog } from "./log-store";
import { objectKey } from "../lib/utils";
import { tr } from "../lib/i18n";
import { useSettingsStore } from "./settings-store";

let coreMutationQueue: Promise<void> = Promise.resolve();

function enqueueCoreMutation(operation: () => Promise<unknown>, failureMessage: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const sessionVersion = useProjectStore.getState().sessionVersion;
  const runForCurrentSession = () =>
    useProjectStore.getState().sessionVersion === sessionVersion ? operation() : Promise.resolve();
  coreMutationQueue = coreMutationQueue
    .then(runForCurrentSession, runForCurrentSession)
    .then(() => undefined)
    .catch((error) => writeLog("ERROR", failureMessage, undefined, String(error)));
}

export function flushCoreMutations() {
  return coreMutationQueue;
}

/** The frame layer a pixel edit was painted on. */
export interface PixelEditTarget {
  identity: { id: number; kind: ObjectKind };
  groupIndex: number;
  frameIndex: number;
  patternIndex: number;
  layer: number;
}

/**
 * One side of a pixel edit. The sprite ids travel with the bytes because a stroke on
 * an empty tile allocates a sprite: undoing has to pin the tile back to the id it had
 * — otherwise the object would keep pointing at a sprite the undo just blanked.
 */
export interface PixelEditSide {
  image: { width: number; height: number; rgba: number[] };
  slotIds: number[];
}

export interface PixelEdit extends PixelEditTarget {
  before: PixelEditSide;
  after: PixelEditSide;
}

interface FrameLayerWrite {
  object: ThingObject;
  slotIds: number[];
  allocated: number[];
  shared: number[];
}

/**
 * Object edits snapshot the whole list, as they always have — the Rust core keeps its
 * own matching stack and `undo`/`redo` pops it. A pixel edit is not in that stack: it
 * carries the frame bytes on both sides and is replayed by writing them back.
 *
 * The label is written by whoever recorded the step and is what the history panel shows;
 * it describes the change, not the snapshot, and travels with the entry when it moves
 * between the two stacks — undoing "Deleted 2 frames" has to keep saying that on the way
 * back. `id` is what the list keys on: two steps can share a label and a millisecond.
 */
export interface HistoryMeta {
  id: number;
  label: string;
  /** What the edit was applied to — `Item #1234`. Written once, by whoever knows the target. */
  context?: string;
  timestamp: number;
}

export type HistoryEntry = HistoryMeta &
  ({ kind: "objects"; objects: ThingObject[] } | { kind: "pixels"; edit: PixelEdit });

let nextEntryId = 1;

function meta(label: string, context?: string): HistoryMeta {
  return { id: nextEntryId++, label, context, timestamp: Date.now() };
}

function replaceObject(object: ThingObject) {
  const state = useProjectStore.getState();
  state.setObjects(
    state.objects.map((entry) =>
      entry.id === object.id && entry.kind === object.kind ? object : entry,
    ),
  );
}

function applyPixelEdit(edit: PixelEdit, side: "before" | "after") {
  enqueueCoreMutation(async () => {
    const result = await invoke<FrameLayerWrite>("write_object_frame_layer", {
      identity: edit.identity,
      groupIndex: edit.groupIndex,
      frameIndex: edit.frameIndex,
      patternIndex: edit.patternIndex,
      layer: edit.layer,
      image: edit[side].image,
      slotIds: edit[side].slotIds,
    });
    replaceObject(result.object);
  }, tr("Unable to restore the frame pixels"));
  // The bytes behind those ids changed, so every preview holding them is stale.
  invalidateSpriteCache();
  usePaintStore.getState().bumpRevision();
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  checkpoint: (objects: ThingObject[], label: string, context?: string) => void;
  recordPixelEdit: (edit: PixelEdit, label: string, context?: string) => void;
  undo: () => void;
  redo: () => void;
  /** Travels to the point with `index` changes applied — 0 is the state the session opened on. */
  jumpTo: (index: number) => void;
  reset: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  checkpoint: (objects, label, context) =>
    set((state) => ({
      past: [
        ...state.past,
        {
          ...meta(label, context),
          kind: "objects",
          objects: structuredClone(objects),
        } as HistoryEntry,
      ].slice(-useSettingsStore.getState().undoLimit),
      future: [],
    })),
  recordPixelEdit: (edit, label, context) =>
    set((state) => ({
      past: [...state.past, { ...meta(label, context), kind: "pixels", edit } as HistoryEntry].slice(
        -useSettingsStore.getState().undoLimit,
      ),
      future: [],
    })),
  undo: () => {
    const { past, future } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelEdit(entry.edit, "before");
      set({ past: past.slice(0, -1), future: [entry, ...future] });
      return;
    }
    const current = structuredClone(useProjectStore.getState().objects);
    useProjectStore.getState().setObjects(structuredClone(entry.objects));
    set({ past: past.slice(0, -1), future: [{ ...entry, objects: current }, ...future] });
    // A step back may restore sprite bytes a preview already cached.
    invalidateSpriteCache();
    enqueueCoreMutation(() => invoke("undo"), tr("Undo failed in the Rust core"));
  },
  redo: () => {
    const { past, future } = get();
    const entry = future[0];
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelEdit(entry.edit, "after");
      set({ past: [...past, entry], future: future.slice(1) });
      return;
    }
    const current = structuredClone(useProjectStore.getState().objects);
    useProjectStore.getState().setObjects(structuredClone(entry.objects));
    set({ past: [...past, { ...entry, objects: current }], future: future.slice(1) });
    // A step back may restore sprite bytes a preview already cached.
    invalidateSpriteCache();
    enqueueCoreMutation(() => invoke("redo"), tr("Redo failed in the Rust core"));
  },
  // Each step is replayed one at a time, and not by restoring the target snapshot directly:
  // the Rust core keeps its own stack, and only its `undo`/`redo` walk it — a jump that
  // wrote the far state in one go would leave the two stacks pointing at different places.
  jumpTo: (index) => {
    const total = get().past.length + get().future.length;
    const target = Math.max(0, Math.min(total, index));
    while (get().past.length > target) get().undo();
    while (get().past.length < target) get().redo();
  },
  reset: () => set({ past: [], future: [] }),
}));

useProjectStore.subscribe((state, previous) => {
  if (state.sessionVersion !== previous.sessionVersion) useHistoryStore.getState().reset();
});

export function updateObject(
  target: Pick<ThingObject, "id" | "kind">,
  transform: (object: ThingObject) => ThingObject,
  label?: string,
) {
  const state = useProjectStore.getState();
  const current = state.objects.find(
    (object) => object.id === target.id && object.kind === target.kind,
  );
  if (!current) return;
  useHistoryStore
    .getState()
    .checkpoint(state.objects, label ?? tr("Edited object"), `${tr(current.kind)} #${current.id}`);
  const updated = { ...transform(current), modified: true };
  state.setObjects(state.objects.map((object) => (object === current ? updated : object)));
  const previousKey = objectKey(current);
  const updatedKey = objectKey(updated);
  if (previousKey !== updatedKey) {
    const selection = useSelectionStore.getState();
    selection.selectMany(
      selection.selectedKeys.map((key) => (key === previousKey ? updatedKey : key)),
    );
  }
  enqueueCoreMutation(
    () => invoke("update_thing", { object: updated, originalKind: current.kind }),
    tr("Unable to update {kind} #{id}", { kind: tr(current.kind), id: current.id }),
  );
  return updated;
}

/**
 * Writes one edited frame layer back into the SPR and records it as a single undo
 * step. The write is queued behind every other core mutation, so a stroke can never
 * land before the object edit that made room for it.
 */
export function commitPixelEdit(
  target: PixelEditTarget,
  before: PixelEditSide,
  after: { width: number; height: number; rgba: number[] },
  onWritten?: (result: FrameLayerWrite) => void,
  label?: string,
) {
  enqueueCoreMutation(async () => {
    const result = await invoke<FrameLayerWrite>("write_object_frame_layer", {
      identity: target.identity,
      groupIndex: target.groupIndex,
      frameIndex: target.frameIndex,
      patternIndex: target.patternIndex,
      layer: target.layer,
      image: after,
      slotIds: null,
    });
    replaceObject(result.object);
    useHistoryStore.getState().recordPixelEdit(
      {
        ...target,
        before,
        after: { image: after, slotIds: result.slotIds },
      },
      label ?? tr("Painted frame {index}", { index: target.frameIndex + 1 }),
      `${tr(target.identity.kind)} #${target.identity.id}`,
    );
    onWritten?.(result);
  }, tr("Unable to write the edited frame"));
  invalidateSpriteCache();
  usePaintStore.getState().bumpPreviewRevision();
}
