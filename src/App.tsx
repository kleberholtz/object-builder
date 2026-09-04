import { useCallback, useEffect, useRef, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { invoke } from "@tauri-apps/api/core";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FilmRoll } from "./features/film-roll/FilmRoll";
import { ObjectBrowser } from "./features/objects/ObjectBrowser";
import { Inspector } from "./features/objects/Inspector";
import { SpriteCanvas } from "./features/sprites/SpriteCanvas";
import { MenuBar } from "./components/layout/MenuBar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { isTextInput, objectKey } from "./lib/utils";
import { useEditorStore } from "./stores/editor-store";
import { useHistoryStore } from "./stores/history-store";
import { useProjectStore } from "./stores/project-store";
import { useSelectionStore } from "./stores/selection-store";
import { keyboardEventToShortcut, useShortcutStore } from "./stores/shortcut-store";
import { AboutDialog, ShortcutSettingsDialog } from "./features/settings/AppDialogs";
import { OpenClientDialog, ProjectLauncher } from "./features/project/ProjectLauncher";
import type { ProjectInfo, ThingObject } from "./types/editor";
import "./App.css";
import "./new-ui.css";

interface Snapshot { project: ProjectInfo; objects: ThingObject[] }
const isTauri = () => "__TAURI_INTERNALS__" in window;
function errorText(error: unknown) { return typeof error === "string" ? error : JSON.stringify(error); }

function App() {
  const [notice, setNotice] = useState<string | null>(null);
  const [manifestPath, setManifestPath] = useState<string | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const objects = useProjectStore((state) => state.objects);
  const markSaved = useProjectStore((state) => state.markSaved);
  const hydrate = useProjectStore((state) => state.hydrate);
  const setObjects = useProjectStore((state) => state.setObjects);
  const selectedKey = useSelectionStore((state) => state.selectedKeys[0]);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const select = useSelectionStore((state) => state.select);
  const selectMany = useSelectionStore((state) => state.selectMany);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const selectedFrame = useEditorStore((state) => state.selectedFrames[0] ?? 0);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const bindings = useShortcutStore((state) => state.bindings);
  const selectedObject = objects.find((object) => objectKey(object) === selectedKey);
  const clipboard = useRef<ThingObject | null>(null);
  const hasFilmRoll = Boolean(selectedObject && (selectedObject.frameGroups.length > 1 || selectedObject.frameGroups.some((group) => group.frames.length > 1)));

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 3200); }, []);
  const save = useCallback(async (forceDialog = false) => {
    if (!isTauri()) { notify("Saving projects requires the Tauri desktop application"); return; }
    const existingPath = manifestPath ?? project?.projectFile ?? null;
    const path = !forceDialog && existingPath ? existingPath : await saveDialog({ title: "Save Object Builder project", defaultPath: "project.json", filters: [{ name: "Object Builder Project", extensions: ["json"] }] });
    if (!path) return;
    try { await invoke("save_project_manifest", { path, createBackup: true }); setManifestPath(path); markSaved(); notify("Project saved"); }
    catch (error) { notify(`Unable to save project: ${errorText(error)}`); }
  }, [manifestPath, markSaved, notify, project?.projectFile]);

  const requireObject = useCallback(() => { if (!selectedObject) notify("Select an object first"); return selectedObject; }, [notify, selectedObject]);
  const importObject = useCallback(async () => {
    if (!isTauri()) return notify("Import requires the Tauri desktop application");
    const path = await open({ multiple: false, filters: [{ name: "Object Builder Object", extensions: ["obx"] }], title: "Import Object" });
    if (typeof path !== "string") return;
    try { const object = await invoke<ThingObject>("import_object", { path }); setObjects([...objects, object]); if (project) hydrate({ ...project, objectCount: project.objectCount + 1, dirty: true }, [...objects, object]); select(objectKey(object)); notify(`Imported ${object.kind} #${object.id}`); }
    catch (error) { notify(`Unable to import object: ${errorText(error)}`); }
  }, [hydrate, notify, objects, project, select, setObjects]);
  const exportObject = useCallback(async () => {
    const object = requireObject(); if (!object || !isTauri()) return;
    const path = await saveDialog({ title: "Export Object", defaultPath: `${object.kind.toLowerCase()}-${object.id}.obx`, filters: [{ name: "Object Builder Object", extensions: ["obx"] }] });
    if (!path) return;
    try { await invoke("export_object", { request: { objectId: object.id, kind: object.kind, path } }); notify("Object exported with its referenced sprites"); }
    catch (error) { notify(`Unable to export object: ${errorText(error)}`); }
  }, [notify, requireObject]);
  const exportPng = useCallback(async (mode = "frame") => {
    const object = requireObject(); if (!object || !isTauri()) return;
    const path = await saveDialog({ title: mode === "frame" ? "Export selected frame" : "Export spritesheet", defaultPath: `${object.kind.toLowerCase()}-${object.id}-${mode}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (!path) return;
    try { await invoke("export_png", { request: { objectId: object.id, kind: object.kind, frameIndex: selectedFrame, mode, path } }); notify("PNG exported"); }
    catch (error) { notify(`Unable to export PNG: ${errorText(error)}`); }
  }, [notify, requireObject, selectedFrame]);
  const importPng = useCallback(async (sheet = false) => {
    const object = requireObject(); if (!object || !isTauri()) return;
    const path = await open({ multiple: false, filters: [{ name: "PNG image", extensions: ["png"] }], title: sheet ? "Import spritesheet" : "Replace selected frame" });
    if (typeof path !== "string") return;
    try { const updated = await invoke<ThingObject>("import_png", { request: { objectId: object.id, kind: object.kind, frameIndex: selectedFrame, mode: sheet ? "spritesheet" : "frame", path } }); setObjects(objects.map((entry) => objectKey(entry) === objectKey(object) ? updated : entry)); notify(sheet ? "Spritesheet imported" : "Frame replaced from PNG"); }
    catch (error) { notify(`Unable to import PNG: ${errorText(error)}`); }
  }, [notify, objects, requireObject, selectedFrame, setObjects]);
  const copyObject = useCallback(() => { const object = requireObject(); if (object) { clipboard.current = structuredClone(object); notify(`${object.kind} #${object.id} copied`); } }, [notify, requireObject]);
  const pasteObject = useCallback(async () => {
    const source = clipboard.current; if (!source) return notify("Copy an object before pasting");
    if (!isTauri()) return notify("Pasting objects requires the Tauri desktop application");
    try { const object = await invoke<ThingObject>("duplicate_thing", { identity: { id: source.id, kind: source.kind } }); const next = [...objects, object]; setObjects(next); if (project) hydrate({ ...project, objectCount: project.objectCount + 1, dirty: true }, next); select(objectKey(object)); notify(`Created ${object.kind} #${object.id}`); }
    catch (error) { notify(`Unable to paste object: ${errorText(error)}`); }
  }, [hydrate, notify, objects, project, select, setObjects]);
  const deleteSelection = useCallback(async () => {
    const selected = objects.filter((object) => selectedKeys.includes(objectKey(object)));
    if (!selected.length || !isTauri()) return;
    if (!window.confirm(`Delete ${selected.length} selected ${selected.length === 1 ? "object" : "objects"}?`)) return;
    try { const removed = await invoke<number>("delete_things", { identities: selected.map(({ id, kind }) => ({ id, kind })) }); const keys = new Set(selected.map(objectKey)); const next = objects.filter((object) => !keys.has(objectKey(object))); setObjects(next); if (project) hydrate({ ...project, objectCount: Math.max(0, project.objectCount - removed), dirty: true }, next); selectMany([]); notify(`${removed} ${removed === 1 ? "object" : "objects"} deleted`); }
    catch (error) { notify(`Unable to delete selection: ${errorText(error)}`); }
  }, [hydrate, notify, objects, project, selectMany, selectedKeys, setObjects]);
  const validateProject = useCallback(async () => {
    if (!isTauri()) return notify("Validation requires the Tauri desktop application");
    try { const report = await invoke<{ valid: boolean; checkedObjects: number; checkedSprites: number; issues: string[] }>("validate_workspace"); notify(report.valid ? `Validated ${report.checkedObjects.toLocaleString()} objects and ${report.checkedSprites.toLocaleString()} sprite references` : `Validation found ${report.issues.length} issues: ${report.issues[0]}`); }
    catch (error) { notify(`Unable to validate project: ${errorText(error)}`); }
  }, [notify]);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<Snapshot | null>("get_workspace_snapshot").then((value) => { if (value) hydrate(value.project, value.objects); }).catch((error) => notify(`Rust core could not initialize: ${errorText(error)}`));
  }, [hydrate, notify]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return;
      const shortcut = keyboardEventToShortcut(event);
      const action = Object.entries(bindings).find(([, value]) => value === shortcut)?.[0];
      if (!action) return;
      event.preventDefault();
      if (action === "openClient") setClientOpen(true);
      else if (action === "save" || action === "quickSave") void save();
      else if (action === "saveAs") void save(true);
      else if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "zoomIn") setZoom(zoom + 1);
      else if (action === "zoomOut") setZoom(zoom - 1);
      else if (action === "resetZoom") setZoom(12);
      else if (action === "toggleGrid") toggleGrid();
      else if (action === "copy") copyObject();
      else if (action === "paste") void pasteObject();
      else if (action === "delete") void deleteSelection();
      else if (action === "selectAll") selectMany(objects.map(objectKey));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, copyObject, deleteSelection, objects, pasteObject, redo, save, selectMany, setZoom, toggleGrid, undo, zoom]);

  if (!project) return <TooltipPrimitive.Provider><ProjectLauncher /></TooltipPrimitive.Provider>;
  return <TooltipPrimitive.Provider><main className={`app-shell ${hasFilmRoll ? "" : "no-film"}`}>
    <MenuBar notify={notify} onSave={() => void save()} onSaveAs={() => void save(true)} onOpen={() => setClientOpen(true)} onImportObject={() => void importObject()} onExportObject={() => void exportObject()} onImportPng={(sheet) => void importPng(sheet)} onExportPng={(mode) => void exportPng(mode)} onShortcuts={() => setShortcutsOpen(true)} onAbout={() => setAboutOpen(true)} onUndo={undo} onRedo={redo} onCopy={copyObject} onPaste={() => void pasteObject()} onDelete={() => void deleteSelection()} onSelectAll={() => selectMany(objects.map(objectKey))} onValidate={() => void validateProject()} onResetZoom={() => setZoom(12)} onDuplicate={() => { copyObject(); void pasteObject(); }} />
    <Toolbar onSave={() => void save()} onOpen={() => setClientOpen(true)} onImport={() => void importObject()} onExport={() => void exportObject()} onValidate={() => void validateProject()} />
    <section className="workspace"><ObjectBrowser /><SpriteCanvas /><Inspector /></section>
    {hasFilmRoll && <FilmRoll />}
    <StatusBar />
    {notice && <div className="toast"><span className="toast-dot" />{notice}</div>}
    <OpenClientDialog openState={clientOpen} onOpenChange={setClientOpen} />
    <ShortcutSettingsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
  </main></TooltipPrimitive.Provider>;
}

export default App;
