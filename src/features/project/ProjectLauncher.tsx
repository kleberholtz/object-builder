import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Boxes, FolderOpen, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
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

interface Snapshot { project: ProjectInfo; objects: ThingObject[] }
export interface LoadProgress { stage: string; status: string; file?: string; processed: number; total: number; percent: number }

const versions = ["7.40", "7.50", "7.55", "7.60", "7.80", "8.00", "8.10", "8.20", "8.40", "8.54", "8.60", "9.60", "10.50", "10.98", "11.00", "12.00", "13.10", "14.00", "15.00", "15.25"].map((value) => ({ value, label: `Tibia ${value}` }));

function explainError(value: unknown) {
  if (value && typeof value === "object") {
    const error = value as { kind?: string; message?: unknown };
    if (error.kind === "operation" && error.message && typeof error.message === "object") {
      const detail = error.message as { file?: string; operation?: string; reason?: string; suggestion?: string };
      return detail;
    }
    return { reason: JSON.stringify(value, null, 2) };
  }
  return { reason: String(value) };
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "launcher-field wide" : "launcher-field"}><span>{label}</span>{children}</label>;
}

function DirectoryField({ value, onChange, title }: { value: string; onChange: (value: string) => void; title: string }) {
  const browse = async () => {
    const selected = await open({ directory: true, multiple: false, title });
    if (typeof selected === "string") onChange(selected);
  };
  return <div className="path-field"><Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="/path/to/client" /><Button type="button" variant="outline" onClick={() => void browse()}>Browse…</Button></div>;
}

function CreateProjectDialog({ openState, onOpenChange }: { openState: boolean; onOpenChange: (open: boolean) => void }) {
  const hydrate = useProjectStore((state) => state.hydrate);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [version, setVersion] = useState("10.98");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setError(""); setBusy(true);
    try {
      const snapshot = await invoke<Snapshot>("create_project", { request: { directory, name, version } });
      hydrate(snapshot.project, snapshot.objects); onOpenChange(false);
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <Dialog open={openState} onOpenChange={onOpenChange}><DialogContent title="Create Project" description="Create an empty Object Builder workspace on disk.">
    <div className="dialog-body launcher-form"><Field label="Project name" wide><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field><Field label="Location" wide><DirectoryField value={directory} onChange={setDirectory} title="Choose project directory" /></Field><Field label="Client version"><Select value={version} onValueChange={setVersion} options={versions} ariaLabel="Client version" /></Field></div>
    {error && <div className="inline-error">{error}</div>}
    <footer className="dialog-footer"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || !name.trim() || !directory} onClick={() => void create()}>{busy ? "Creating…" : "Create Project"}</Button></footer>
  </DialogContent></Dialog>;
}

function OpenClientDialog({ openState, onOpenChange }: { openState: boolean; onOpenChange: (open: boolean) => void }) {
  const hydrate = useProjectStore((state) => state.hydrate);
  const selectObject = useSelectionStore((state) => state.select);
  const [directory, setDirectory] = useState("");
  const [version, setVersion] = useState("8.60");
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

  const load = async () => {
    setError(null); setProgress({ stage: "starting", status: "Opening client", processed: 0, total: 1, percent: 0 });
    const channel = new Channel<LoadProgress>();
    channel.onmessage = setProgress;
    try {
      const snapshot = await invoke<Snapshot>("load_client_directory", { request: { directory, version, clientType, datFile, sprFile, otfiFile, useOtfi, validateSprites, features: { extended, transparency, frameDurations, frameGroups } }, onProgress: channel });
      hydrate(snapshot.project, snapshot.objects);
      if (snapshot.objects[0]) selectObject(objectKey(snapshot.objects[0]));
      onOpenChange(false);
    } catch (reason) { setError(explainError(reason)); }
  };
  const loading = progress !== null && progress.stage !== "complete" && !error;
  return <Dialog open={openState} onOpenChange={(next) => { if (!loading) onOpenChange(next); }}><DialogContent title="Open Client" description="Configure the client before parsing its DAT and SPR files." className="client-dialog">
    {!progress && <><div className="dialog-body launcher-form">
      <Field label="Client directory" wide><DirectoryField value={directory} onChange={setDirectory} title="Choose OTClient data directory" /></Field>
      <Field label="Version"><div className="version-field"><Select value={versions.some((item) => item.value === version) ? version : "15.25"} onValueChange={setVersion} options={versions} ariaLabel="Client version preset" /><Input value={version} onChange={(event) => setVersion(event.target.value)} aria-label="Exact client version" /></div></Field>
      <Field label="Client type"><Select value={clientType} onValueChange={(value) => { setClientType(value); if (value === "CipSoft") setUseOtfi(false); }} options={[{ value: "OTClient", label: "OTClient" }, { value: "CipSoft", label: "CipSoft client" }, { value: "Custom", label: "Custom client" }]} ariaLabel="Client type" /></Field>
      <Field label="DAT file"><Input value={datFile} onChange={(event) => setDatFile(event.target.value)} /></Field><Field label="SPR file"><Input value={sprFile} onChange={(event) => setSprFile(event.target.value)} /></Field>
      <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)}><Settings2 size={13} />{advanced ? "Hide" : "Show"} format options</button>
      {advanced && <div className="advanced-options"><label className="advanced-file"><span>OTFI file</span><Input value={otfiFile} onChange={(event) => setOtfiFile(event.target.value)} disabled={!useOtfi} /></label><Option label="Read OTFI configuration" checked={useOtfi} onChange={setUseOtfi} /><Option label="Validate complete SPR index" checked={validateSprites} onChange={setValidateSprites} /><Option label="32-bit sprite IDs" checked={extended} onChange={setExtended} /><Option label="Sprite alpha channel" checked={transparency} onChange={setTransparency} /><Option label="Frame durations" checked={frameDurations} onChange={setFrameDurations} /><Option label="Frame groups" checked={frameGroups} onChange={setFrameGroups} /></div>}
    </div><footer className="dialog-footer"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!directory || !datFile || !sprFile} onClick={() => void load()}>Open Client</Button></footer></>}
    {progress && <div className="load-progress"><div className="progress-title"><strong>{error ? "Unable to open client" : progress.status}</strong><span>{Math.round(progress.percent)}%</span></div><Progress value={progress.percent} />{progress.file && <code>{progress.file}</code>}<div className="progress-count">{progress.total > 1 ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}` : progress.stage}</div>{error && <div className="load-error">{error.operation && <p><b>Operation</b>{error.operation}</p>}{error.file && <p><b>File</b><code>{error.file}</code></p>}<p><b>Reason</b>{error.reason}</p>{error.suggestion && <p><b>How to fix</b>{error.suggestion}</p>}</div>}<footer className="dialog-footer"><Button variant="ghost" disabled={loading} onClick={() => { setProgress(null); setError(null); }}>Back</Button><Button disabled={loading} onClick={() => onOpenChange(false)}>Close</Button></footer></div>}
  </DialogContent></Dialog>;
}

function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="switch-option"><span>{label}</span><Switch checked={checked} onCheckedChange={onChange} /></label>; }

export function ProjectLauncher({ initialOpenClient = false }: { initialOpenClient?: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(initialOpenClient);
  return <main className="launcher"><div className="launcher-brand"><span className="launcher-logo"><Boxes size={29} /></span><h1>Object Builder</h1><p>Native OTClient object and sprite editor</p></div><div className="launcher-actions"><button onClick={() => setCreateOpen(true)}><Plus size={21} /><span><strong>Create Project</strong><small>Start an empty workspace on disk</small></span></button><button onClick={() => setClientOpen(true)}><FolderOpen size={21} /><span><strong>Open Client</strong><small>Load existing DAT and SPR assets</small></span></button></div><small className="launcher-version">Supports client versions 7.40–15.25</small><CreateProjectDialog openState={createOpen} onOpenChange={setCreateOpen} /><OpenClientDialog openState={clientOpen} onOpenChange={setClientOpen} /></main>;
}

export { OpenClientDialog };
