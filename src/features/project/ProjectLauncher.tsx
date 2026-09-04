import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Boxes,
  CircleCheck,
  Clock3,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  Plus,
  Settings2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Progress } from "../../components/ui/progress";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import type { ProjectInfo, ThingObject } from "../../types/editor";
import { objectKey } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { Skeleton } from "../../components/ui/skeleton";
import { flushCoreMutations } from "../../stores/history-store";
import {
  clearRecentProjects,
  loadRecentProjects,
  rememberProject,
  removeRecentProject,
  subscribeRecentProjects,
  updateRecentPath,
  type ClientOpenRequest,
  type RecentProject,
} from "../../stores/recent-projects";

interface Snapshot {
  project: ProjectInfo;
  objects: ThingObject[];
}
export interface LoadProgress {
  stage: string;
  status: string;
  file?: string;
  processed: number;
  total: number;
  percent: number;
}
export interface ClientDialogPreset {
  directory: string;
  version: string;
  datFile: string;
  sprFile: string;
  otfiFile: string;
}

interface DetectedFeatures {
  extended: boolean;
  transparency: boolean;
  frameDurations: boolean;
  frameGroups: boolean;
}
interface VersionDetection {
  version: string;
  /** Where the answer came from: the OTFI, the version alone, or the format switches too. */
  source: "otfi" | "version" | "features";
  datSignature: number;
  itemCount: number;
  outfitCount: number;
  effectCount: number;
  missileCount: number;
  features: DetectedFeatures;
}
type DetectionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: VersionDetection }
  | { status: "failed"; message: string };

const AUTOMATIC = "automatic";
const CUSTOM_VERSION = "custom";

const versions = [
  "7.40",
  "7.50",
  "7.55",
  "7.60",
  "7.80",
  "8.00",
  "8.10",
  "8.20",
  "8.40",
  "8.54",
  "8.60",
  "9.60",
  "10.50",
  "10.98",
  "11.00",
  "12.00",
  "13.10",
  "14.00",
  "15.00",
  "15.25",
].map((value) => ({ value, label: `Tibia ${value}` }));

function explainError(value: unknown) {
  if (value && typeof value === "object") {
    const error = value as { kind?: string; message?: unknown };
    if (error.kind === "operation" && error.message && typeof error.message === "object") {
      const detail = error.message as {
        file?: string;
        operation?: string;
        reason?: string;
        suggestion?: string;
      };
      return detail;
    }
    return { reason: JSON.stringify(value, null, 2) };
  }
  return { reason: String(value) };
}

function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "launcher-field wide" : "launcher-field"}>
      <span>{label}</span>
      {children}
      {hint}
    </label>
  );
}

function DirectoryField({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
}) {
  const t = useT();
  const browse = async () => {
    const selected = await open({ directory: true, multiple: false, title });
    if (typeof selected === "string") onChange(selected);
  };
  return (
    <div className="path-field">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("/path/to/client")}
      />
      <Button type="button" variant="outline" onClick={() => void browse()}>
        {t("Browse…")}
      </Button>
    </div>
  );
}

function CreateProjectDialog({
  openState,
  onOpenChange,
}: {
  openState: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const hydrate = useProjectStore((state) => state.hydrate);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [version, setVersion] = useState("10.98");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setError("");
    setBusy(true);
    try {
      const snapshot = await invoke<Snapshot>("create_project", {
        request: { directory, name, version },
      });
      hydrate(snapshot.project, snapshot.objects);
      rememberProject(
        snapshot.project,
        "manifest",
        snapshot.project.projectFile ?? `${directory}/project.json`,
      );
      onOpenChange(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={openState} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Create Project")}
        description={t("Create an empty Object Builder workspace on disk.")}
      >
        <div className="dialog-body launcher-form">
          <Field label={t("Project name")} wide>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t("Location")} wide>
            <DirectoryField
              value={directory}
              onChange={setDirectory}
              title={t("Choose project directory")}
            />
          </Field>
          <Field label={t("Client version")}>
            <Select
              value={version}
              onValueChange={setVersion}
              options={versions}
              ariaLabel={t("Client version")}
            />
          </Field>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <footer className="dialog-footer">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button disabled={busy || !name.trim() || !directory} onClick={() => void create()}>
            {busy ? t("Creating…") : t("Create Project")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function OpenClientDialog({
  openState,
  onOpenChange,
  onLoaded,
  preset,
}: {
  openState: boolean;
  onOpenChange: (open: boolean) => void;
  onLoaded?: (snapshot: Snapshot) => void;
  preset?: ClientDialogPreset | null;
}) {
  const t = useT();
  const hydrate = useProjectStore((state) => state.hydrate);
  const selectObject = useSelectionStore((state) => state.select);
  const [directory, setDirectory] = useState("");
  const [version, setVersion] = useState("10.98");
  const [versionMode, setVersionMode] = useState<"automatic" | "manual">("automatic");
  const [detection, setDetection] = useState<DetectionState>({
    status: "idle",
  });
  const [clientType, setClientType] = useState("OTClient");
  const [datFile, setDatFile] = useState("Tibia.dat");
  const [sprFile, setSprFile] = useState("Tibia.spr");
  const [otfiFile, setOtfiFile] = useState("Tibia.otfi");
  const [useOtfi, setUseOtfi] = useState(true);
  const [validateSprites, setValidateSprites] = useState(true);
  const [extended, setExtended] = useState(false);
  const [transparency, setTransparency] = useState(false);
  const [frameDurations, setFrameDurations] = useState(false);
  const [frameGroups, setFrameGroups] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<ReturnType<typeof explainError> | null>(null);

  useEffect(() => {
    if (!openState || !preset) return;
    setDirectory(preset.directory);
    setVersion(preset.version);
    setVersionMode("manual");
    setDetection({ status: "idle" });
    setDatFile(preset.datFile);
    setSprFile(preset.sprFile);
    setOtfiFile(preset.otfiFile);
    setUseOtfi(true);
    setClientType("Custom");
    setProgress(null);
    setError(null);
  }, [openState, preset]);

  // Automatic is the default, so the version field starts as a question the files answer: the
  // DAT is probed with every layout the range supports and the first one that reads the file end
  // to end wins. A layout that only parses with format switches turned on also turns the OTFI
  // off, which is the one path where those switches reach the loader.
  useEffect(() => {
    if (!openState || versionMode !== "automatic") return;
    const path = directory.trim();
    const dat = datFile.trim();
    let active = true;
    const timer = window.setTimeout(() => {
      if (!path || !dat) {
        setDetection({ status: "idle" });
        return;
      }
      setDetection({ status: "running" });
      invoke<VersionDetection>("detect_client_version", {
        request: {
          directory: path,
          datFile: dat,
          otfiFile,
          // The loader ignores the OTFI for a CipSoft client, so detection has to as well.
          useOtfi: useOtfi && clientType !== "CipSoft",
        },
      })
        .then((result) => {
          if (!active) return;
          setDetection({ status: "done", result });
          setVersion(result.version);
          setExtended(result.features.extended);
          setTransparency(result.features.transparency);
          setFrameDurations(result.features.frameDurations);
          setFrameGroups(result.features.frameGroups);
          if (result.source === "features") setUseOtfi(false);
        })
        .catch((reason) => {
          if (!active) return;
          const message = explainError(reason).reason ?? String(reason);
          setDetection({ status: "failed", message });
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [openState, versionMode, directory, datFile, otfiFile, useOtfi, clientType]);

  const chooseVersion = (value: string) => {
    if (value === AUTOMATIC) {
      setVersionMode("automatic");
      return;
    }
    setVersionMode("manual");
    if (value !== CUSTOM_VERSION) setVersion(value);
  };
  const versionSelection =
    versionMode === "automatic"
      ? AUTOMATIC
      : versions.some((item) => item.value === version)
        ? version
        : CUSTOM_VERSION;
  // Radix needs an item behind whatever the trigger shows, and a hand-typed version has none.
  const versionOptions = [
    { value: AUTOMATIC, label: t("Automatic") },
    ...(versionSelection === CUSTOM_VERSION
      ? [{ value: CUSTOM_VERSION, label: t("Custom version") }]
      : []),
    ...versions,
  ];
  const detecting = versionMode === "automatic" && detection.status === "running";
  const undetected = versionMode === "automatic" && detection.status !== "done";
  const versionHint = (): { tone: string; text: string; detail?: string } => {
    if (versionMode === "manual")
      return { tone: "muted", text: t("Set by hand. Pick Automatic to read it from the files.") };
    if (detection.status === "running") return { tone: "busy", text: t("Reading the DAT layout…") };
    if (detection.status === "failed")
      return {
        tone: "error",
        text: t("No supported layout reads this DAT. Pick the version by hand."),
        detail: detection.message,
      };
    if (detection.status === "done") {
      const source = {
        otfi: "Read from the OTFI configuration",
        version: "Read from the DAT layout",
        features: "Read from the DAT layout, with format options",
      }[detection.result.source];
      return {
        tone: "ok",
        text: `${t(source)} · ${t("{count} items", {
          count: detection.result.itemCount.toLocaleString(),
        })}`,
      };
    }
    return { tone: "muted", text: t("Choose the client directory to detect the version.") };
  };
  const hint = versionHint();

  const load = async () => {
    setError(null);
    setProgress({
      stage: "starting",
      status: t("Opening client"),
      processed: 0,
      total: 1,
      percent: 0,
    });
    const channel = new Channel<LoadProgress>();
    channel.onmessage = setProgress;
    try {
      await flushCoreMutations();
      const request: ClientOpenRequest = {
        directory,
        version,
        clientType,
        datFile,
        sprFile,
        otfiFile,
        useOtfi,
        validateSprites,
        features: { extended, transparency, frameDurations, frameGroups },
      };
      const snapshot = await invoke<Snapshot>("load_client_directory", {
        request,
        onProgress: channel,
      });
      hydrate(snapshot.project, snapshot.objects);
      rememberProject(snapshot.project, "client", directory, request);
      if (snapshot.objects[0]) selectObject(objectKey(snapshot.objects[0]));
      onLoaded?.(snapshot);
      setProgress(null);
      onOpenChange(false);
    } catch (reason) {
      setError(explainError(reason));
    }
  };
  const loading = progress !== null && progress.stage !== "complete" && !error;
  return (
    <Dialog
      open={openState}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
    >
      <DialogContent
        title={t("Open Client")}
        description={t("Configure the client before parsing its DAT and SPR files.")}
        className="client-dialog"
      >
        {!progress && (
          <>
            <div className="dialog-body launcher-form client-form">
              <Field label={t("Client directory")} wide>
                <DirectoryField
                  value={directory}
                  onChange={setDirectory}
                  title={t("Choose OTClient data directory")}
                />
              </Field>
              <Field
                label={t("Version")}
                hint={
                  <small className={`field-hint tone-${hint.tone}`} title={hint.detail}>
                    {hint.tone === "busy" && <LoaderCircle size={11} className="hint-spinner" />}
                    {hint.tone === "ok" && <CircleCheck size={11} />}
                    {hint.tone === "error" && <TriangleAlert size={11} />}
                    <span>{hint.text}</span>
                  </small>
                }
              >
                <div className="version-field">
                  <Select
                    value={versionSelection}
                    onValueChange={chooseVersion}
                    options={versionOptions}
                    ariaLabel={t("Client version preset")}
                  />
                  <Input
                    className="version-exact"
                    value={detecting ? "" : version}
                    placeholder={detecting ? "…" : undefined}
                    onChange={(event) => {
                      setVersionMode("manual");
                      setVersion(event.target.value);
                    }}
                    aria-label={t("Exact client version")}
                  />
                </div>
              </Field>
              <Field label={t("Client type")}>
                <Select
                  value={clientType}
                  onValueChange={(value) => {
                    setClientType(value);
                    if (value === "CipSoft") setUseOtfi(false);
                  }}
                  options={[
                    { value: "OTClient", label: "OTClient" },
                    { value: "CipSoft", label: t("CipSoft client") },
                    { value: "Custom", label: t("Custom client") },
                  ]}
                  ariaLabel={t("Client type")}
                />
              </Field>
              <Field label={t("DAT file")}>
                <Input value={datFile} onChange={(event) => setDatFile(event.target.value)} />
              </Field>
              <Field label={t("SPR file")}>
                <Input value={sprFile} onChange={(event) => setSprFile(event.target.value)} />
              </Field>
              <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)}>
                <Settings2 size={13} />
                {advanced ? t("Hide format options") : t("Show format options")}
              </button>
              {advanced && (
                <div className="advanced-options">
                  <label className="advanced-file">
                    <span>{t("OTFI file")}</span>
                    <Input
                      value={otfiFile}
                      onChange={(event) => setOtfiFile(event.target.value)}
                      disabled={!useOtfi}
                    />
                  </label>
                  <Option
                    label={t("Read OTFI configuration")}
                    checked={useOtfi}
                    onChange={setUseOtfi}
                  />
                  <Option
                    label={t("Validate complete SPR index")}
                    checked={validateSprites}
                    onChange={setValidateSprites}
                  />
                  <Option
                    label={t("32-bit sprite IDs")}
                    checked={extended}
                    onChange={setExtended}
                  />
                  <Option
                    label={t("Sprite alpha channel")}
                    checked={transparency}
                    onChange={setTransparency}
                  />
                  <Option
                    label={t("Frame durations")}
                    checked={frameDurations}
                    onChange={setFrameDurations}
                  />
                  <Option
                    label={t("Frame groups")}
                    checked={frameGroups}
                    onChange={setFrameGroups}
                  />
                </div>
              )}
            </div>
            <footer className="dialog-footer">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("Cancel")}
              </Button>
              <Button
                disabled={!directory || !datFile || !sprFile || !version.trim() || undetected}
                onClick={() => void load()}
              >
                {detecting ? t("Detecting version…") : t("Open Client")}
              </Button>
            </footer>
          </>
        )}
        {progress && (
          <div className="load-progress">
            <div className="progress-title">
              <strong>{error ? t("Unable to open client") : progress.status}</strong>
              <span>{Math.round(progress.percent)}%</span>
            </div>
            <Progress value={progress.percent} />
            {progress.file && <code>{progress.file}</code>}
            <div className="progress-count">
              {progress.total > 1
                ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
                : progress.stage}
            </div>
            {error && (
              <div className="load-error">
                {error.operation && (
                  <p>
                    <b>{t("Operation")}</b>
                    {error.operation}
                  </p>
                )}
                {error.file && (
                  <p>
                    <b>{t("File")}</b>
                    <code>{error.file}</code>
                  </p>
                )}
                <p>
                  <b>{t("Reason")}</b>
                  {error.reason}
                </p>
                {error.suggestion && (
                  <p>
                    <b>{t("How to fix")}</b>
                    {error.suggestion}
                  </p>
                )}
              </div>
            )}
            <footer className="dialog-footer">
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  setProgress(null);
                  setError(null);
                }}
              >
                {t("Back")}
              </Button>
              <Button disabled={loading} onClick={() => onOpenChange(false)}>
                {t("Close")}
              </Button>
            </footer>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Option({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch-option">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function ProjectLauncher({ initialOpenClient = false }: { initialOpenClient?: boolean }) {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(initialOpenClient);
  const [recent, setRecent] = useState(loadRecentProjects);
  const [opening, setOpening] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const hydrate = useProjectStore((state) => state.hydrate);
  const selectObject = useSelectionStore((state) => state.select);
  const windowAction = (action: "minimize" | "maximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") void appWindow.minimize();
    else if (action === "maximize") void appWindow.toggleMaximize();
    else void appWindow.destroy();
  };
  useEffect(() => subscribeRecentProjects(() => setRecent(loadRecentProjects())), []);

  const reopen = async (entry: RecentProject) => {
    setError("");
    setUnavailable(null);
    setOpening(entry.id);
    try {
      await flushCoreMutations();
      const exists = await invoke<boolean>("path_exists", { path: entry.path });
      if (!exists) {
        setUnavailable(entry.id);
        return;
      }
      let snapshot: Snapshot;
      if (entry.kind === "manifest") {
        snapshot = await invoke<Snapshot>("load_project_manifest", { path: entry.path });
      } else {
        if (!entry.request)
          throw new Error(t("This recent client is missing its load configuration"));
        const channel = new Channel<LoadProgress>();
        channel.onmessage = setProgress;
        snapshot = await invoke<Snapshot>("load_client_directory", {
          request: entry.request,
          onProgress: channel,
        });
      }
      hydrate(snapshot.project, snapshot.objects);
      if (snapshot.objects[0]) selectObject(objectKey(snapshot.objects[0]));
      rememberProject(snapshot.project, entry.kind, entry.path, entry.request);
    } catch (reason) {
      setError(explainError(reason).reason ?? String(reason));
    } finally {
      setOpening(null);
      setProgress(null);
    }
  };
  const locate = async (entry: RecentProject) => {
    const path = await open(
      entry.kind === "manifest"
        ? {
            multiple: false,
            filters: [{ name: t("Object Builder Project"), extensions: ["json"] }],
            title: t("Locate project"),
          }
        : { directory: true, multiple: false, title: t("Locate client directory") },
    );
    if (typeof path === "string") {
      updateRecentPath(entry, path);
      setUnavailable(null);
    }
  };

  return (
    <main className="launcher">
      <header className="launcher-window-bar" data-tauri-drag-region>
        <span data-tauri-drag-region>Object Builder</span>
        <div className="window-controls">
          <button aria-label={t("Minimize window")} onClick={() => windowAction("minimize")}>
            ─
          </button>
          <button
            aria-label={t("Maximize or restore window")}
            onClick={() => windowAction("maximize")}
          >
            □
          </button>
          <button
            aria-label={t("Close window")}
            className="window-close"
            onClick={() => windowAction("close")}
          >
            ×
          </button>
        </div>
      </header>
      <div className="launcher-brand">
        <span className="launcher-logo">
          <Boxes size={29} />
        </span>
        <h1>Object Builder</h1>
        <p>{t("Native OTClient object and sprite editor")}</p>
      </div>
      {recent.length > 0 && (
        <section className="recent-projects">
          <header>
            <span>
              <Clock3 size={14} />
              {t("Recent Projects")}
            </span>
            <button onClick={clearRecentProjects}>
              <Trash2 size={12} />
              {t("Clear history")}
            </button>
          </header>
          <div className="recent-list">
            {recent.map((entry) => (
              <div
                className={`recent-entry ${unavailable === entry.id ? "unavailable" : ""}`}
                key={entry.id}
              >
                <button
                  className="recent-open"
                  disabled={opening !== null}
                  onClick={() => void reopen(entry)}
                >
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{entry.path}</small>
                  </span>
                  <span>
                    <b>{t("Client {version}", { version: entry.version })}</b>
                    <small>
                      {t("{count} objects", { count: entry.objectCount.toLocaleString() })} ·{" "}
                      {new Date(entry.lastOpened).toLocaleDateString()}
                    </small>
                  </span>
                </button>
                <button
                  className="recent-remove"
                  aria-label={t("Remove {name} from recent projects", { name: entry.name })}
                  onClick={() => removeRecentProject(entry.id)}
                >
                  <X size={13} />
                </button>
                {opening === entry.id && (
                  <div className="recent-loading">
                    <Skeleton />
                    <Skeleton />
                    {progress && (
                      <small>
                        {progress.status} · {Math.round(progress.percent)}%
                      </small>
                    )}
                  </div>
                )}
                {unavailable === entry.id && (
                  <div className="recent-unavailable">
                    <span>
                      <b>{t("Project unavailable")}</b>
                      <small>{t("The project path no longer exists.")}</small>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => void locate(entry)}>
                      <LocateFixed size={12} />
                      {t("Locate Project")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeRecentProject(entry.id)}>
                      {t("Remove")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <div className="inline-error">{error}</div>}
        </section>
      )}
      <div className="launcher-actions">
        <button onClick={() => setCreateOpen(true)}>
          <Plus size={21} />
          <span>
            <strong>{t("Create Project")}</strong>
            <small>{t("Start an empty workspace on disk")}</small>
          </span>
        </button>
        <button onClick={() => setClientOpen(true)}>
          <FolderOpen size={21} />
          <span>
            <strong>{t("Open Client")}</strong>
            <small>{t("Load existing DAT and SPR assets")}</small>
          </span>
        </button>
      </div>
      <small className="launcher-version">{t("Supports client versions 7.40–15.25")}</small>
      <CreateProjectDialog openState={createOpen} onOpenChange={setCreateOpen} />
      <OpenClientDialog openState={clientOpen} onOpenChange={setClientOpen} />
    </main>
  );
}

export { OpenClientDialog };
