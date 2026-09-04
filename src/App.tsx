import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FilmRoll } from "./features/film-roll/FilmRoll";
import { ObjectBrowser } from "./features/objects/ObjectBrowser";
import { Inspector } from "./features/objects/Inspector";
import { SpriteCanvas } from "./features/sprites/SpriteCanvas";
import { MenuBar } from "./components/layout/MenuBar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { LogPanel } from "./components/layout/LogPanel";
import { invalidateSpriteCache } from "./lib/sprite-cache";
import { isTextInput, objectKey } from "./lib/utils";
import { useT } from "./lib/i18n";
import { useEditorStore } from "./stores/editor-store";
import { flushCoreMutations, useHistoryStore } from "./stores/history-store";
import { usePaintStore, type PaintTool } from "./stores/paint-store";
import { useProjectStore } from "./stores/project-store";
import { useSelectionStore } from "./stores/selection-store";
import { keyboardEventToShortcut, useShortcutStore } from "./stores/shortcut-store";
import { useSettingsStore } from "./stores/settings-store";
import { useLogStore, writeLog, type LogLevel } from "./stores/log-store";
import {
  AboutDialog,
  ApplicationSettingsDialog,
  ShortcutSettingsDialog,
  UnsavedChangesDialog,
} from "./features/settings/AppDialogs";
import {
  OpenClientDialog,
  ProjectLauncher,
  type ClientDialogPreset,
  type LoadProgress,
} from "./features/project/ProjectLauncher";
import { SaveProgressDialog, type SaveProgress } from "./features/project/SaveProgressDialog";
import { SpriteManagerDialog } from "./features/sprites/SpriteManagerDialog";
import { OptimizeDialog } from "./features/project/OptimizeDialog";
import { SaveAsDialog, type SaveAsFormat } from "./features/project/SaveAsDialog";
import { ExportObjectDialog, type ObjectExportFormat } from "./features/objects/ExportObjectDialog";
import { CommandPalette, type CommandActions } from "./features/command-palette/CommandPalette";
import { HistoryDialog } from "./features/history/HistoryDialog";
import { Progress } from "./components/ui/progress";
import { rememberProject, type RecentProject } from "./stores/recent-projects";
import type { ProjectInfo, ThingObject } from "./types/editor";
import "./App.css";
import "./new-ui.css";
import "./new-ui-2.css";

interface Snapshot {
  project: ProjectInfo;
  objects: ThingObject[];
}
interface RecentLoadProgress extends LoadProgress {
  projectName: string;
}
const isTauri = () => "__TAURI_INTERNALS__" in window;
function errorText(error: unknown) {
  return typeof error === "string" ? error : JSON.stringify(error);
}
function withExtension(path: string, extension: string) {
  return path.toLowerCase().endsWith(`.${extension}`) ? path : `${path}.${extension}`;
}

/** Chords that only pick a tool, kept out of the switch below so the list reads as a table. */
const PAINT_TOOL_SHORTCUTS: Record<string, PaintTool> = {
  toolPencil: "pencil",
  toolEraser: "eraser",
  toolPicker: "picker",
  toolBucket: "bucket",
  toolReplace: "replace",
  toolLine: "line",
  toolRectangle: "rectangle",
  toolEllipse: "ellipse",
  toolMarquee: "marquee",
  toolWand: "wand",
  toolMove: "move",
  toolPan: "pan",
};

function App() {
  const t = useT();
  const sprSplitSize = useSettingsStore((state) => state.sprSplitSize);
  const setSprSplitSize = useSettingsStore((state) => state.setSprSplitSize);
  const [notice, setNotice] = useState<string | null>(null);
  const [manifestPath, setManifestPath] = useState<string | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientPreset, setClientPreset] = useState<ClientDialogPreset | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The format and volume size of the running save, so the progress dialog draws the stages
  // that this save will actually emit instead of guessing them from the status text.
  const [saveFormat, setSaveFormat] = useState<SaveAsFormat | null>(null);
  const [saveSplitSize, setSaveSplitSize] = useState(0);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [exportObjectOpen, setExportObjectOpen] = useState(false);
  const [spriteManagerOpen, setSpriteManagerOpen] = useState(false);
  const [spriteManagerScope, setSpriteManagerScope] = useState<ThingObject | null>(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [recentLoadProgress, setRecentLoadProgress] = useState<RecentLoadProgress | null>(null);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closingAfterSave, setClosingAfterSave] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const objects = useProjectStore((state) => state.objects);
  const setProject = useProjectStore((state) => state.setProject);
  const markDirty = useProjectStore((state) => state.markDirty);
  const adjustObjectCount = useProjectStore((state) => state.adjustObjectCount);
  const objectOrderDraft = useProjectStore((state) => state.objectOrderDraft);
  const frameOrderDrafts = useProjectStore((state) => state.frameOrderDrafts);
  const sessionVersion = useProjectStore((state) => state.sessionVersion);
  const markObjectOrderDraft = useProjectStore((state) => state.markObjectOrderDraft);
  const hydrate = useProjectStore((state) => state.hydrate);
  const setObjects = useProjectStore((state) => state.setObjects);
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const select = useSelectionStore((state) => state.select);
  const selectMany = useSelectionStore((state) => state.selectMany);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const resetView = useEditorStore((state) => state.resetView);
  const setSelectedFrames = useEditorStore((state) => state.setSelectedFrames);
  const focusObjectSearch = useEditorStore((state) => state.focusObjectSearch);
  const selectedFrame = useEditorStore((state) => state.selectedFrames[0] ?? 0);
  const activeFrameGroup = useEditorStore((state) => state.activeFrameGroup);
  const filmRollCollapsed = useEditorStore((state) => state.filmRollCollapsed);
  const inspectorCollapsed = useEditorStore((state) => state.inspectorCollapsed);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const bindings = useShortcutStore((state) => state.bindings);
  const logsExpanded = useLogStore((state) => state.expanded);
  const addLog = useLogStore((state) => state.add);
  const selectedObject = objects.find((object) => objectKey(object) === selectedKey);
  const clipboard = useRef<ThingObject | null>(null);
  const allowClose = useRef(false);
  const optimizeOpenPending = useRef(false);
  const hasFilmRoll = Boolean(
    selectedObject &&
    (selectedObject.frameGroups.length > 1 ||
      selectedObject.frameGroups.some((group) => group.frames.length > 1)),
  );

  // The severity is decided by the English source key, so the heuristic does not depend on the
  // language the message is finally shown in.
  const notify = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const message = t(key, vars);
      setNotice(message);
      const level: LogLevel = /unable|failed|error/i.test(key)
        ? "ERROR"
        : /select|requires|missing/i.test(key)
          ? "WARNING"
          : "INFO";
      writeLog(level, message);
      window.setTimeout(() => setNotice(null), useSettingsStore.getState().noticeDuration * 1000);
    },
    [t],
  );
  const openClientDialog = useCallback(() => {
    if (
      project?.dirty &&
      !window.confirm(t("Replace the current unsaved workspace with another client?"))
    )
      return;
    setClientPreset(null);
    setClientOpen(true);
  }, [project?.dirty, t]);
  const save = useCallback(
    async (requestedFormat?: SaveAsFormat) => {
      if (!isTauri()) {
        notify("Saving projects requires the Tauri desktop application");
        return false;
      }
      const hasClientPair = Boolean(project?.sourceDirectory && project.datFile && project.sprFile);
      const format: SaveAsFormat = requestedFormat ?? (hasClientPair ? "client" : "json");
      // Megabytes in the preference, bytes in the command: the splitter counts bytes.
      const splitMegabytes = format === "client" ? useSettingsStore.getState().sprSplitSize : 0;
      const splitSize = splitMegabytes > 0 ? splitMegabytes * 1024 * 1024 : null;
      if (format === "client" && (objectOrderDraft || Object.keys(frameOrderDrafts).length > 0)) {
        notify("Apply the pending object/frame order before saving DAT/SPR");
        return false;
      }
      let path: string | null = null;
      if (requestedFormat === "client") {
        const directory = project?.sourceDirectory?.replace(/[\\/]+$/, "");
        path = await saveDialog({
          title: t("Save Client DAT/SPR"),
          defaultPath: directory
            ? `${directory}/${project?.datFile || "Tibia.dat"}`
            : project?.datFile || "Tibia.dat",
          filters: [{ name: t("Client DAT/SPR pair"), extensions: ["dat", "spr"] }],
        });
        if (!path) return false;
      } else if (requestedFormat === "json") {
        path = await saveDialog({
          title: t("Save Project JSON"),
          defaultPath: project?.projectFile ?? "project.json",
          filters: [{ name: t("Object Builder JSON"), extensions: ["json"] }],
        });
        if (!path) return false;
      } else if (!hasClientPair) {
        path =
          manifestPath ??
          project?.projectFile ??
          (await saveDialog({
            title: t("Save Object Builder project"),
            defaultPath: "project.json",
            filters: [{ name: t("Object Builder JSON"), extensions: ["json"] }],
          }));
        if (!path) return false;
      }
      const channel = new Channel<SaveProgress>();
      channel.onmessage = setSaveProgress;
      setSaveError(null);
      setSaveFormat(format);
      setSaveSplitSize(splitMegabytes);
      setSaveProgress({
        stage: "preparing",
        status: "Collecting workspace changes",
        detail: null,
        percent: 0,
        objectsProcessed: 0,
        objectsTotal: project?.objectCount ?? 0,
        spritesProcessed: 0,
        spritesTotal: 0,
        bytesWritten: 0,
        bytesTotal: 0,
        volumes: 0,
        elapsedMs: 0,
        complete: false,
      });
      try {
        await flushCoreMutations();
        if (format === "client") {
          const saved = await invoke<ProjectInfo>("save_client_files", {
            path,
            createBackup: true,
            splitSize,
            onProgress: channel,
          });
          setObjects(
            objects.map((object) => ({ ...object, modified: false })),
            false,
          );
          setProject(saved);
          if (saved.sourceDirectory && saved.clientFeatures)
            rememberProject(saved, "client", saved.sourceDirectory, {
              directory: saved.sourceDirectory,
              version: saved.clientVersion,
              clientType: "Custom",
              datFile: saved.datFile,
              sprFile: saved.sprFile,
              otfiFile: saved.datFile.replace(/\.dat$/i, ".otfi"),
              useOtfi: true,
              validateSprites: true,
              features: {
                extended: saved.clientFeatures.extended,
                transparency: saved.clientFeatures.transparency,
                frameDurations: saved.clientFeatures.frameDurations,
                frameGroups: saved.clientFeatures.frameGroups,
              },
            });
          notify("Client DAT/SPR saved successfully");
        } else {
          const jsonPath = withExtension(path as string, "json");
          await invoke("save_project_manifest", {
            path: jsonPath,
            createBackup: true,
            onProgress: channel,
          });
          setManifestPath(jsonPath);
          if (project) {
            const saved = { ...project, dirty: false, projectFile: jsonPath };
            setProject(saved);
            rememberProject(saved, "manifest", jsonPath);
          }
          notify("Project JSON saved successfully");
        }
        return true;
      } catch (error) {
        const details = errorText(error);
        setSaveError(details);
        notify("Unable to save project: {details}", { details });
        return false;
      }
    },
    [
      frameOrderDrafts,
      manifestPath,
      notify,
      objectOrderDraft,
      objects,
      project,
      setObjects,
      setProject,
      t,
    ],
  );

  const openRecent = useCallback(
    async (entry: RecentProject) => {
      if (!isTauri() || recentLoadProgress) return;
      if (
        project?.dirty &&
        !window.confirm(
          t(
            "Replace the current unsaved workspace with this recent project? Unsaved changes will be lost.",
          ),
        )
      )
        return;
      setRecentLoadProgress({
        projectName: entry.name,
        stage: "starting",
        status: t("Opening recent project"),
        processed: 0,
        total: 1,
        percent: 4,
      });
      try {
        await flushCoreMutations();
        setRecentLoadProgress((current) =>
          current
            ? { ...current, stage: "checking", status: t("Checking project location"), percent: 9 }
            : current,
        );
        if (!(await invoke<boolean>("path_exists", { path: entry.path }))) {
          notify("Recent project is unavailable: {path}", { path: entry.path });
          return;
        }
        let snapshot: Snapshot;
        if (entry.kind === "manifest") {
          setRecentLoadProgress((current) =>
            current
              ? {
                  ...current,
                  stage: "manifest",
                  status: t("Reading project manifest"),
                  file: entry.path,
                  percent: 28,
                }
              : current,
          );
          snapshot = await invoke<Snapshot>("load_project_manifest", { path: entry.path });
          setManifestPath(entry.path);
        } else {
          if (!entry.request) {
            notify("This recent client is missing its load configuration");
            return;
          }
          const channel = new Channel<LoadProgress>();
          channel.onmessage = (progress) =>
            setRecentLoadProgress({ ...progress, projectName: entry.name });
          snapshot = await invoke<Snapshot>("load_client_directory", {
            request: entry.request,
            onProgress: channel,
          });
          setManifestPath(null);
        }
        setRecentLoadProgress((current) =>
          current
            ? {
                ...current,
                stage: "hydrating",
                status: t("Preparing workspace"),
                processed: 1,
                total: 1,
                percent: 96,
              }
            : current,
        );
        hydrate(snapshot.project, snapshot.objects);
        if (snapshot.objects[0]) select(objectKey(snapshot.objects[0]));
        rememberProject(snapshot.project, entry.kind, entry.path, entry.request);
        notify("Opened {name}", { name: snapshot.project.name });
      } catch (error) {
        notify("Unable to open recent project: {details}", { details: errorText(error) });
      } finally {
        setRecentLoadProgress(null);
      }
    },
    [hydrate, notify, project?.dirty, recentLoadProgress, select, t],
  );

  const closeWithoutSaving = useCallback(async () => {
    allowClose.current = true;
    setClosePromptOpen(false);
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      await appWindow.destroy();
    } catch (error) {
      try {
        await appWindow.close();
      } catch {
        allowClose.current = false;
        setClosePromptOpen(true);
        notify("Unable to close application: {details}", { details: errorText(error) });
      }
    }
  }, [notify]);

  const saveAndClose = useCallback(async () => {
    setClosingAfterSave(true);
    const saved = await save();
    setClosingAfterSave(false);
    if (saved) void closeWithoutSaving();
  }, [closeWithoutSaving, save]);

  const requestAppClose = useCallback(() => {
    if (project?.dirty) {
      setClosePromptOpen(true);
      return;
    }
    void closeWithoutSaving();
  }, [closeWithoutSaving, project?.dirty]);

  const requireObject = useCallback(() => {
    if (!selectedObject) notify("Select an object first");
    return selectedObject;
  }, [notify, selectedObject]);
  const importObject = useCallback(
    async (selectedPath?: string) => {
      if (!isTauri()) return notify("Import requires the Tauri desktop application");
      const path =
        selectedPath ??
        (await open({
          multiple: false,
          filters: [{ name: t("Object Builder Object"), extensions: ["obd", "obx"] }],
          title: t("Import Object"),
        }));
      if (typeof path !== "string") return;
      try {
        await flushCoreMutations();
        const object = await invoke<ThingObject>("import_object", { path });
        setObjects([...objects, object]);
        adjustObjectCount(1);
        select(objectKey(object));
        notify("Imported {kind} #{id}", { kind: t(object.kind), id: object.id });
      } catch (error) {
        notify("Unable to import object: {details}", { details: errorText(error) });
      }
    },
    [adjustObjectCount, notify, objects, select, setObjects, t],
  );
  const exportObd = useCallback(async () => {
    const object = requireObject();
    if (!object || !isTauri()) return;
    const path = await saveDialog({
      title: t("Export Object as OBD"),
      defaultPath: `${object.kind.toLowerCase()}-${object.id}.obd`,
      filters: [{ name: t("Object Builder Object"), extensions: ["obd"] }],
    });
    if (!path) return;
    const outputPath = withExtension(path, "obd");
    try {
      await flushCoreMutations();
      await invoke("export_object", {
        request: { objectId: object.id, kind: object.kind, path: outputPath },
      });
      notify("Object exported with its referenced sprites");
    } catch (error) {
      notify("Unable to export object: {details}", { details: errorText(error) });
    }
  }, [notify, requireObject, t]);
  const exportPng = useCallback(
    async (mode = "frame") => {
      const object = requireObject();
      if (!object || !isTauri()) return;
      const path = await saveDialog({
        title: mode === "frame" ? t("Export selected frame") : t("Export spritesheet"),
        defaultPath: `${object.kind.toLowerCase()}-${object.id}-${mode}.png`,
        filters: [{ name: t("PNG image"), extensions: ["png"] }],
      });
      if (!path) return;
      const outputPath = withExtension(path, "png");
      try {
        await flushCoreMutations();
        await invoke("export_png", {
          request: {
            objectId: object.id,
            kind: object.kind,
            frameIndex: selectedFrame,
            groupIndex: activeFrameGroup,
            mode,
            path: outputPath,
          },
        });
        notify("PNG exported");
      } catch (error) {
        notify("Unable to export PNG: {details}", { details: errorText(error) });
      }
    },
    [activeFrameGroup, notify, requireObject, selectedFrame, t],
  );
  const importPng = useCallback(
    async (sheet = false, selectedPath?: string) => {
      const object = requireObject();
      if (!object || !isTauri()) return;
      const path =
        selectedPath ??
        (await open({
          multiple: false,
          filters: [{ name: t("PNG image"), extensions: ["png"] }],
          title: sheet ? t("Import spritesheet") : t("Replace selected frame"),
        }));
      if (typeof path !== "string") return;
      try {
        await flushCoreMutations();
        const updated = await invoke<ThingObject>("import_png", {
          request: {
            objectId: object.id,
            kind: object.kind,
            frameIndex: selectedFrame,
            groupIndex: activeFrameGroup,
            mode: sheet ? "spritesheet" : "frame",
            path,
          },
        });
        setObjects(
          objects.map((entry) => (objectKey(entry) === objectKey(object) ? updated : entry)),
        );
        invalidateSpriteCache();
        notify(sheet ? "Spritesheet imported" : "Frame replaced from PNG");
      } catch (error) {
        notify("Unable to import PNG: {details}", { details: errorText(error) });
      }
    },
    [activeFrameGroup, notify, objects, requireObject, selectedFrame, setObjects, t],
  );
  const importAny = useCallback(async () => {
    if (!isTauri()) return notify("Import requires the Tauri desktop application");
    const path = await open({
      multiple: false,
      title: t("Import DAT/SPR, JSON, OBD or PNG"),
      filters: [
        { name: t("Supported files"), extensions: ["dat", "spr", "json", "obd", "obx", "png"] },
        { name: t("Client files"), extensions: ["dat", "spr"] },
        { name: t("Object Builder JSON"), extensions: ["json"] },
        { name: t("Object Builder Object"), extensions: ["obd", "obx"] },
        { name: t("PNG image"), extensions: ["png"] },
      ],
    });
    if (typeof path !== "string") return;
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension === "obd" || extension === "obx") return void importObject(path);
    if (extension === "png") return void importPng(false, path);
    if (
      (extension === "json" || extension === "dat" || extension === "spr") &&
      project?.dirty &&
      !window.confirm(t("Replace the current unsaved workspace with the imported project/client?"))
    )
      return;
    if (extension === "json") {
      try {
        await flushCoreMutations();
        const snapshot = await invoke<Snapshot>("load_project_manifest", { path });
        hydrate(snapshot.project, snapshot.objects);
        setManifestPath(path);
        if (snapshot.objects[0]) select(objectKey(snapshot.objects[0]));
        notify("Project JSON imported");
      } catch (error) {
        notify("Unable to import JSON: {details}", { details: errorText(error) });
      }
      return;
    }
    if (extension === "dat" || extension === "spr") {
      const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const directory = separator >= 0 ? path.slice(0, separator) : ".";
      const file = separator >= 0 ? path.slice(separator + 1) : path;
      const stem = file.replace(/\.(dat|spr)$/i, "");
      setClientPreset({
        directory,
        version: project?.clientVersion ?? "10.98",
        datFile: `${stem}.dat`,
        sprFile: `${stem}.spr`,
        otfiFile: `${stem}.otfi`,
      });
      setClientOpen(true);
      return;
    }
    notify("Unsupported import format");
  }, [hydrate, importObject, importPng, notify, project?.clientVersion, select, t]);
  const chooseExportFormat = useCallback(
    (format: ObjectExportFormat) => {
      setExportObjectOpen(false);
      if (format === "obd") void exportObd();
      else void exportPng(format === "png" ? "frame" : "spritesheet");
    },
    [exportObd, exportPng],
  );
  const copyObject = useCallback(() => {
    const object = requireObject();
    if (object) {
      clipboard.current = structuredClone(object);
      notify("{kind} #{id} copied", { kind: t(object.kind), id: object.id });
    }
  }, [notify, requireObject, t]);
  const pasteObject = useCallback(async () => {
    const source = clipboard.current;
    if (!source) return notify("Copy an object before pasting");
    if (!isTauri()) return notify("Pasting objects requires the Tauri desktop application");
    try {
      await flushCoreMutations();
      const object = await invoke<ThingObject>("duplicate_thing", {
        identity: { id: source.id, kind: source.kind },
      });
      const next = [...objects, object];
      setObjects(next);
      adjustObjectCount(1);
      select(objectKey(object));
      notify("Created {kind} #{id}", { kind: t(object.kind), id: object.id });
    } catch (error) {
      notify("Unable to paste object: {details}", { details: errorText(error) });
    }
  }, [adjustObjectCount, notify, objects, select, setObjects, t]);
  const deleteSelection = useCallback(async () => {
    const selected = objects.filter((object) => selectedKeys.includes(objectKey(object)));
    if (!selected.length || !isTauri()) return;
    if (
      !window.confirm(
        t(
          selected.length === 1
            ? "Delete {count} selected object?"
            : "Delete {count} selected objects?",
          { count: selected.length },
        ),
      )
    )
      return;
    try {
      await flushCoreMutations();
      const removed = await invoke<number>("delete_things", {
        identities: selected.map(({ id, kind }) => ({ id, kind })),
      });
      const keys = new Set(selected.map(objectKey));
      const next = objects.filter((object) => !keys.has(objectKey(object)));
      setObjects(next);
      adjustObjectCount(-removed);
      markObjectOrderDraft();
      selectMany([]);
      notify(
        removed === 1
          ? "{count} object deleted; apply order before saving DAT/SPR"
          : "{count} objects deleted; apply order before saving DAT/SPR",
        { count: removed },
      );
    } catch (error) {
      notify("Unable to delete selection: {details}", { details: errorText(error) });
    }
  }, [
    adjustObjectCount,
    markObjectOrderDraft,
    notify,
    objects,
    selectMany,
    selectedKeys,
    setObjects,
    t,
  ]);
  const validateProject = useCallback(async () => {
    if (!isTauri()) return notify("Validation requires the Tauri desktop application");
    try {
      await flushCoreMutations();
      const report = await invoke<{
        valid: boolean;
        checkedObjects: number;
        checkedSprites: number;
        issues: string[];
      }>("validate_workspace");
      if (report.valid)
        notify("Validated {objects} objects and {sprites} sprite references", {
          objects: report.checkedObjects.toLocaleString(),
          sprites: report.checkedSprites.toLocaleString(),
        });
      else
        notify("Validation found {count} issues: {first}", {
          count: report.issues.length,
          first: report.issues[0],
        });
    } catch (error) {
      notify("Unable to validate project: {details}", { details: errorText(error) });
    }
  }, [notify]);
  const openSpriteManager = useCallback((scope: ThingObject | null = null) => {
    setSpriteManagerScope(scope);
    setSpriteManagerOpen(true);
  }, []);
  const openOptimize = useCallback(() => {
    if (optimizeOpenPending.current) return;
    optimizeOpenPending.current = true;
    setSpriteManagerOpen(false);
    // Radix must finish closing the menu/dialog that originated the action
    // before the optimization portal takes ownership of focus.
    window.setTimeout(() => {
      setOptimizeOpen(true);
      optimizeOpenPending.current = false;
    }, 0);
  }, []);
  const navigateToObject = useCallback(
    async (reference: { id: number; kind: ThingObject["kind"] }) => {
      try {
        await flushCoreMutations();
        const object = await invoke<ThingObject>("get_object", { identity: reference });
        setObjects([object], false);
        select(objectKey(object));
        setSpriteManagerOpen(false);
      } catch (error) {
        notify("Unable to open referenced object: {details}", { details: errorText(error) });
      }
    },
    [notify, select, setObjects],
  );

  const commandActions = useMemo<CommandActions>(
    () => ({
      openClient: openClientDialog,
      importAny: () => void importAny(),
      save: () => void save(),
      saveAs: () => setSaveAsOpen(true),
      importObject: () => void importObject(),
      exportObject: () => setExportObjectOpen(true),
      importPng: (sheet) => void importPng(sheet),
      exportPng: (mode) => void exportPng(mode),
      undo,
      redo,
      history: () => setHistoryOpen(true),
      copy: copyObject,
      paste: () => void pasteObject(),
      duplicate: () => {
        copyObject();
        void pasteObject();
      },
      remove: () => void deleteSelection(),
      selectAll: () => selectMany(objects.map(objectKey)),
      searchObjects: focusObjectSearch,
      zoomIn: () => setZoom(zoom + 0.1),
      zoomOut: () => setZoom(zoom - 0.1),
      resetZoom: resetView,
      validate: () => void validateProject(),
      optimize: openOptimize,
      spriteManager: () => openSpriteManager(),
      settings: () => setSettingsOpen(true),
      shortcuts: () => setShortcutsOpen(true),
      about: () => setAboutOpen(true),
      closeApp: requestAppClose,
    }),
    [
      copyObject,
      deleteSelection,
      exportPng,
      focusObjectSearch,
      importAny,
      importObject,
      importPng,
      objects,
      openClientDialog,
      openOptimize,
      openSpriteManager,
      pasteObject,
      redo,
      requestAppClose,
      resetView,
      save,
      selectMany,
      setZoom,
      undo,
      validateProject,
      zoom,
    ],
  );

  useEffect(() => {
    if (!isTauri()) return;
    invoke<Snapshot | null>("get_workspace_snapshot")
      .then((value) => {
        if (value) hydrate(value.project, value.objects);
      })
      .catch((error) =>
        notify("Rust core could not initialize: {details}", { details: errorText(error) }),
      );
  }, [hydrate, notify]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    void listen<{
      timestampMs: number;
      level: LogLevel;
      message: string;
      context?: string;
      details?: string;
    }>("core-log", (event) =>
      addLog({
        timestamp: Number(event.payload.timestampMs),
        level: event.payload.level,
        message: event.payload.message,
        context: event.payload.context,
        details: event.payload.details,
        source: "Rust",
      }),
    ).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [addLog]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowClose.current) return;
        if (useProjectStore.getState().project?.dirty) {
          event.preventDefault();
          setClosePromptOpen(true);
        }
      })
      .then((unlisten) => {
        dispose = unlisten;
      });
    return () => dispose?.();
  }, []);

  useEffect(() => {
    if (!project?.dirty || isTauri()) return;
    const protectBrowserClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectBrowserClose);
    return () => window.removeEventListener("beforeunload", protectBrowserClose);
  }, [project?.dirty]);

  /**
   * Shortcuts the pixel editor claims. It returns false for anything it does not handle
   * so the same chord keeps its application-wide meaning — Ctrl+C copies the object when
   * there is no frame open, and copies pixels when there is.
   */
  const handlePaintShortcut = useCallback(
    (action: string) => {
      const paint = usePaintStore.getState();
      const group =
        selectedObject?.frameGroups[activeFrameGroup] ?? selectedObject?.frameGroups[0];
      if (action === "previousFrame" || action === "nextFrame") {
        const frameCount = group?.frames.length ?? 0;
        if (frameCount < 2) return false;
        const step = action === "nextFrame" ? 1 : -1;
        setSelectedFrames([(selectedFrame + step + frameCount) % frameCount]);
        return true;
      }
      if (action === "toggleEditMode") {
        if (!selectedObject) return false;
        paint.toggleEditMode();
        return true;
      }
      if (!paint.editMode) return false;
      const tool = PAINT_TOOL_SHORTCUTS[action];
      if (tool) {
        paint.setTool(tool);
        return true;
      }
      const controller = paint.controller;
      switch (action) {
        case "swapColors":
          paint.swapColors();
          return true;
        case "brushLarger":
          paint.stepBrushSize(1);
          return true;
        case "brushSmaller":
          paint.stepBrushSize(-1);
          return true;
        case "toggleOnionSkin":
          paint.toggleOnionSkin();
          return true;
        case "deselect":
          controller?.deselect();
          return Boolean(controller);
        case "flipHorizontal":
          controller?.flipHorizontal();
          return Boolean(controller);
        case "flipVertical":
          controller?.flipVertical();
          return Boolean(controller);
        case "rotateFrame":
          controller?.rotate();
          return Boolean(controller);
        case "selectAll":
          controller?.selectAll();
          return Boolean(controller);
        case "copy":
          return Boolean(controller?.copySelection());
        case "paste":
          return Boolean(controller?.pasteClipboard());
        case "delete":
          // Always consumed while a frame is open: falling through would delete the
          // object because the frame happened to have nothing selected.
          controller?.deleteSelection();
          return Boolean(controller);
        default:
          return false;
      }
    },
    [activeFrameGroup, selectedFrame, selectedObject, setSelectedFrames],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = keyboardEventToShortcut(event);
      // Spotlight-style: the palette opens over any focus, including a text field, and
      // the same chord closes it again.
      if (shortcut && shortcut === bindings.commandPalette) {
        // The launcher has no workspace to act on, and the palette is not rendered there.
        if (project) {
          event.preventDefault();
          setPaletteOpen((open) => !open);
        }
        return;
      }
      if (paletteOpen) return;
      // Like the palette, the search chord reaches the field from any focus — including
      // another text box — and the browser's own find dialog never gets it.
      if (shortcut && shortcut === bindings.searchObjects) {
        if (project) {
          event.preventDefault();
          focusObjectSearch();
        }
        return;
      }
      if (event.key === "Escape") {
        const paint = usePaintStore.getState();
        if (paint.editMode && (paint.selection || paint.floating)) {
          paint.controller?.deselect();
          return;
        }
        selectMany([]);
        setSelectedFrames([]);
        return;
      }
      if (isTextInput(event.target)) return;
      const action = Object.entries(bindings).find(([, value]) => value === shortcut)?.[0];
      if (!action) return;
      // The pixel editor answers first, and only for what it actually handles: Ctrl+C on a
      // frame copies pixels, but with edit mode off the same chord still copies the object.
      if (handlePaintShortcut(action)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (action === "openClient") openClientDialog();
      else if (action === "save" || action === "quickSave") void save();
      else if (action === "saveAs") setSaveAsOpen(true);
      else if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "zoomIn") setZoom(zoom + 0.1);
      else if (action === "zoomOut") setZoom(zoom - 0.1);
      else if (action === "resetZoom") resetView();
      else if (action === "toggleGrid") toggleGrid();
      else if (action === "copy") copyObject();
      else if (action === "paste") void pasteObject();
      else if (action === "delete") void deleteSelection();
      else if (action === "selectAll") selectMany(objects.map(objectKey));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bindings,
    copyObject,
    deleteSelection,
    focusObjectSearch,
    objects,
    openClientDialog,
    paletteOpen,
    pasteObject,
    project,
    redo,
    resetView,
    save,
    selectMany,
    setSelectedFrames,
    setZoom,
    toggleGrid,
    undo,
    zoom,
  ]);

  if (!project)
    return (
      <TooltipPrimitive.Provider>
        <ProjectLauncher />
      </TooltipPrimitive.Provider>
    );
  return (
    <TooltipPrimitive.Provider>
      <main
        className={`app-shell ${hasFilmRoll ? "" : "no-film"} ${hasFilmRoll && filmRollCollapsed ? "film-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""} ${logsExpanded ? "logs-open" : ""}`}
      >
        <MenuBar
          onSave={() => void save()}
          onSaveAs={() => setSaveAsOpen(true)}
          onOpen={openClientDialog}
          onOpenRecent={(entry) => void openRecent(entry)}
          onImportAny={() => void importAny()}
          onImportObject={() => void importObject()}
          onExportObject={() => setExportObjectOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onSearchObjects={focusObjectSearch}
          onHistory={() => setHistoryOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          onAbout={() => setAboutOpen(true)}
          onCopy={() => {
            // In edit mode these act on the frame; with nothing to act on they fall back
            // to the object, which is what the same chords do.
            if (!handlePaintShortcut("copy")) copyObject();
          }}
          onPaste={() => {
            if (!handlePaintShortcut("paste")) void pasteObject();
          }}
          onDelete={() => {
            if (!handlePaintShortcut("delete")) void deleteSelection();
          }}
          onSelectAll={() => {
            if (!handlePaintShortcut("selectAll")) selectMany(objects.map(objectKey));
          }}
          onValidate={() => void validateProject()}
          onOptimize={openOptimize}
          onDuplicate={() => {
            copyObject();
            void pasteObject();
          }}
          onClose={requestAppClose}
        />
        <Toolbar
          onCommandPalette={() => setPaletteOpen(true)}
          onHistory={() => setHistoryOpen(true)}
          onSave={() => void save()}
          onOpen={openClientDialog}
          onImport={() => void importAny()}
          onExport={() => setExportObjectOpen(true)}
          onOptimize={openOptimize}
          onSpriteManager={() => openSpriteManager()}
        />
        <section className="workspace">
          <ObjectBrowser key={sessionVersion} />
          <SpriteCanvas />
          <Inspector onViewSprites={() => selectedObject && openSpriteManager(selectedObject)} />
        </section>
        {hasFilmRoll && <FilmRoll key={selectedKey} />}
        <LogPanel />
        <StatusBar />
        {recentLoadProgress && (
          <div
            className="loading-overlay recent-project-loading"
            role="dialog"
            aria-modal="true"
            aria-label={t("Opening {name}", { name: recentLoadProgress.projectName })}
          >
            <div className="loading-box">
              <span className="loading-spinner" />
              <strong>{t("Opening {name}", { name: recentLoadProgress.projectName })}</strong>
              <small>{recentLoadProgress.status}</small>
              <Progress value={recentLoadProgress.percent} />
              {recentLoadProgress.file && <code>{recentLoadProgress.file}</code>}
              <em>
                {Math.round(recentLoadProgress.percent)}%
                {recentLoadProgress.total > 1
                  ? ` · ${recentLoadProgress.processed.toLocaleString()} / ${recentLoadProgress.total.toLocaleString()}`
                  : ""}
              </em>
            </div>
          </div>
        )}
        {notice && (
          <div className="toast">
            <span className="toast-dot" />
            {notice}
          </div>
        )}
        <OpenClientDialog
          openState={clientOpen}
          onOpenChange={setClientOpen}
          preset={clientPreset}
          onLoaded={(snapshot) => {
            setManifestPath(snapshot.project.projectFile ?? null);
            setClientPreset(null);
          }}
        />
        <ShortcutSettingsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <ApplicationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        <SaveProgressDialog
          progress={saveProgress}
          error={saveError}
          format={saveFormat}
          splitSize={saveSplitSize}
          onClose={() => {
            setSaveProgress(null);
            setSaveError(null);
          }}
        />
        <SaveAsDialog
          open={saveAsOpen}
          onOpenChange={setSaveAsOpen}
          canSaveClient={Boolean(project.sourceDirectory && project.datFile && project.sprFile)}
          splitSize={sprSplitSize}
          onSplitSizeChange={setSprSplitSize}
          onSelect={(format) => {
            setSaveAsOpen(false);
            void save(format);
          }}
        />
        <ExportObjectDialog
          open={exportObjectOpen}
          onOpenChange={setExportObjectOpen}
          object={selectedObject ?? null}
          onSelect={chooseExportFormat}
        />
        <SpriteManagerDialog
          open={spriteManagerOpen}
          onOpenChange={setSpriteManagerOpen}
          objectScope={spriteManagerScope}
          onNavigateObject={(reference) => void navigateToObject(reference)}
          onOptimize={openOptimize}
        />
        {optimizeOpen && (
          <OptimizeDialog
            open
            onOpenChange={setOptimizeOpen}
            onComplete={(message) => {
              // Optimization rewrites and renumbers sprites.
              invalidateSpriteCache();
              markDirty();
              notify(message);
            }}
          />
        )}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={commandActions} />
        <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
        <UnsavedChangesDialog
          open={closePromptOpen}
          saving={closingAfterSave}
          onCancel={() => setClosePromptOpen(false)}
          onDiscard={() => void closeWithoutSaving()}
          onSave={() => void saveAndClose()}
        />
      </main>
    </TooltipPrimitive.Provider>
  );
}

export default App;
