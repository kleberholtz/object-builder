import { ExternalLink, Keyboard, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { APP_INFO } from "../../lib/app-info";
import { keyboardEventToShortcut, shortcutDefinitions, useShortcutStore, type ShortcutAction } from "../../stores/shortcut-store";

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="About Object Builder" className="about-dialog"><div className="about-body"><div className="about-logo">OB</div><h2>{APP_INFO.name}</h2><p>{APP_INFO.tagline}</p><strong>Version {APP_INFO.version}</strong><dl><div><dt>Rust core / app</dt><dd>{APP_INFO.version}</dd></div><div><dt>Tauri</dt><dd>{APP_INFO.tauri}</dd></div><div><dt>Frontend</dt><dd>{APP_INFO.frontend}</dd></div><div><dt>UI</dt><dd>Tailwind CSS · Radix UI</dd></div><div><dt>License</dt><dd>{APP_INFO.license}</dd></div></dl><div className="about-links"><a href={APP_INFO.repository} target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a><a href={APP_INFO.documentation} target="_blank" rel="noreferrer">Documentation <ExternalLink size={12} /></a></div><small>© 2026 Object Builder contributors</small></div></DialogContent></Dialog>;
}

export function ShortcutSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { bindings, setBinding, resetBinding, resetAll } = useShortcutStore();
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [pending, setPending] = useState("");
  const [conflict, setConflict] = useState<ShortcutAction | null>(null);
  const definition = shortcutDefinitions.find((item) => item.action === editing);
  const capture = (event: React.KeyboardEvent) => {
    event.preventDefault(); event.stopPropagation();
    const shortcut = keyboardEventToShortcut(event.nativeEvent);
    if (!shortcut) return;
    setPending(shortcut);
    setConflict(setBinding(editing!, shortcut));
    if (!shortcutDefinitions.some((item) => item.action !== editing && bindings[item.action] === shortcut)) { setEditing(null); setPending(""); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="Keyboard Shortcuts" description="Customize commands. Changes are saved automatically." className="shortcut-dialog"><div className="shortcut-toolbar"><span><Keyboard size={14} />Application shortcuts</span><Button variant="ghost" size="sm" onClick={resetAll}><RotateCcw size={12} />Reset all</Button></div><div className="shortcut-list">{shortcutDefinitions.map((item) => <div className="shortcut-row" key={item.action}><div><strong>{item.name}</strong><small>{item.description}</small></div><kbd>{bindings[item.action] || "Unassigned"}</kbd><Button variant="ghost" size="sm" onClick={() => { setEditing(item.action); setPending(""); setConflict(null); }}>Edit</Button><Button variant="ghost" size="icon" onClick={() => resetBinding(item.action)} aria-label={`Reset ${item.name}`}><RotateCcw size={12} /></Button></div>)}</div>{editing && <div className="shortcut-capture" tabIndex={0} autoFocus onKeyDown={capture}><span>Change shortcut</span><strong>{definition?.name}</strong><kbd>{pending || "Press the new shortcut…"}</kbd>{conflict && <div className="shortcut-conflict"><b>Shortcut already in use</b><span>{pending} is assigned to {shortcutDefinitions.find((item) => item.action === conflict)?.name}.</span><div><Button variant="ghost" size="sm" onClick={() => { setEditing(null); setConflict(null); }}>Cancel</Button><Button size="sm" onClick={() => { setBinding(editing, pending, true); setEditing(null); setConflict(null); }}>Reassign</Button></div></div>}</div>}</DialogContent></Dialog>;
}
