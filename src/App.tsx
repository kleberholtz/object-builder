import { useCallback, useEffect, useState } from "react";
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
import type { ProjectInfo, ThingObject } from "./types/editor";
import "./App.css";

function App() {
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manifestPath, setManifestPath] = useState<string | null>(null);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const markSaved = useProjectStore((state) => state.markSaved);
  const hydrate = useProjectStore((state) => state.hydrate);
  const select = useSelectionStore((state) => state.select);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  }, []);

  const save = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) { markSaved(); notify("Project state saved for this preview session"); return; }
    const path = manifestPath ?? await saveDialog({ title: "Save Object Builder project", defaultPath: "project.json", filters: [{ name: "Object Builder Project", extensions: ["json"] }] });
    if (!path) return;
    try {
      await invoke("save_project_manifest", { path, createBackup: true });
      setManifestPath(path); markSaved(); notify("Project saved safely");
    } catch (error) { notify(`Unable to save project: ${String(error)}`); }
  }, [manifestPath, markSaved, notify]);

  const loadDirectory = useCallback(async (directory: string) => {
    const folder = directory.split(/[\\/]/).filter(Boolean).pop() ?? "860";
    const digits = folder.replace(/\D/g, "");
    const version = digits.length === 3 ? `${digits[0]}.${digits.slice(1)}` : digits.length === 4 ? `${digits.slice(0, 2)}.${digits.slice(2)}` : "8.60";
    setLoading(true);
    notify(`Loading client ${version}…`);
    try {
      const snapshot = await invoke<{ project: ProjectInfo; objects: ThingObject[] }>("load_client_directory", { directory, version });
      hydrate(snapshot.project, snapshot.objects);
      if (snapshot.objects[0]) select(objectKey(snapshot.objects[0]));
      notify(`Loaded ${snapshot.project.objectCount.toLocaleString()} objects and ${snapshot.project.spriteCount.toLocaleString()} sprites`);
    } catch (error) {
      notify(`Unable to load client: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [hydrate, notify, select]);

  const openClient = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) { notify("Directory picker is available in the Tauri desktop app"); return; }
    const directory = await open({ directory: true, multiple: false, title: "Choose an OTClient data directory" });
    if (typeof directory === "string") await loadDirectory(directory);
  }, [loadDirectory, notify]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    invoke<{ project: ProjectInfo; objects: ThingObject[] }>("get_workspace_snapshot")
      .then((snapshot) => hydrate(snapshot.project, snapshot.objects))
      .catch(() => notify("Rust core could not be initialized"));
  }, [hydrate, notify]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const dat = event.payload.paths.find((path) => path.toLowerCase().endsWith(".dat"));
      if (dat) void loadDirectory(dat.replace(/[\\/][^\\/]+$/, ""));
    })).then((dispose) => { unlisten = dispose; }).catch(() => undefined);
    return () => unlisten?.();
  }, [loadDirectory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "o") { event.preventDefault(); void openClient(); }
      else if (command && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
      else if (command && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
      else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      else if (event.key === "+" || event.key === "=") setZoom(zoom + 1);
      else if (event.key === "-") setZoom(zoom - 1);
      else if (event.key === "0") setZoom(12);
      else if (event.key.toLowerCase() === "g") toggleGrid();
      else if (event.key === "F6") save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openClient, redo, save, setZoom, toggleGrid, undo, zoom]);

  return (
    <TooltipPrimitive.Provider>
      <main className="app-shell">
        <MenuBar notify={notify} onSave={save} onOpen={openClient} />
        <Toolbar notify={notify} onSave={save} onOpen={openClient} />
        <section className="workspace">
          <ObjectBrowser />
          <SpriteCanvas />
          <Inspector />
        </section>
        <FilmRoll />
        <StatusBar />
        {notice && <div className="toast"><span className="toast-dot" />{notice}</div>}
        {loading && <div className="loading-overlay"><div className="loading-box"><span className="loading-spinner" /><strong>Reading client files</strong><small>Parsing DAT metadata in a background worker…</small><i><b /></i></div></div>}
      </main>
    </TooltipPrimitive.Provider>
  );
}

export default App;
