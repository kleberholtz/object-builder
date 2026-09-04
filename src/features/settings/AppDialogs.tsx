import {
  AlertTriangle,
  ExternalLink,
  Film,
  Keyboard,
  Languages,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Scan,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { NumberInput } from "../../components/ui/number-input";
import { PAGE_SIZES, usePersistentPageSize } from "../../components/ui/pagination";
import { Tabs } from "../../components/ui/tabs";
import { useLogStore } from "../../stores/log-store";
import { APP_INFO } from "../../lib/app-info";
import { detectLocale, useT } from "../../lib/i18n";
import { detectTheme } from "../../lib/theme";
import {
  keyboardEventToShortcut,
  shortcutDefinitions,
  useShortcutStore,
  type ShortcutAction,
} from "../../stores/shortcut-store";
import {
  SETTINGS_LIMITS,
  useSettingsStore,
  type CanvasBackground,
  type DefaultCanvasZoom,
  type DefaultFilmRoll,
  type DefaultFrameGroup,
  type DefaultObjectType,
  type DefaultOutfitAddon,
  type DefaultOutfitDirection,
  type DefaultSort,
  type Language,
  type OutfitColorPart,
  type Theme,
} from "../../stores/settings-store";

type SettingsTab = "general" | "canvas" | "animation" | "outfits" | "advanced";

const settingsTabs: Array<{
  value: SettingsTab;
  label: string;
  icon: LucideIcon;
  heading: string;
  hint: string;
}> = [
  {
    value: "general",
    label: "General",
    icon: Settings2,
    heading: "Object workflow",
    hint: "Defaults applied to the Object Browser when a project opens.",
  },
  {
    value: "canvas",
    label: "Canvas",
    icon: Scan,
    heading: "Canvas & preview",
    hint: "How objects are framed and rendered on the canvas.",
  },
  {
    value: "animation",
    label: "Animation",
    icon: Film,
    heading: "Film roll & playback",
    hint: "Frame group, playback and new-frame defaults.",
  },
  {
    value: "outfits",
    label: "Outfits",
    icon: Palette,
    heading: "Outfit preview",
    hint: "Starting direction, addons and palette used to preview outfits.",
  },
  {
    value: "advanced",
    label: "Advanced",
    icon: SlidersHorizontal,
    heading: "History & diagnostics",
    hint: "Memory limits for undo history and the application log.",
  },
];

function SettingsRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-row">
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      {children}
    </label>
  );
}

export function ApplicationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const settings = useSettingsStore();
  const setMaxLogEntries = useLogStore((state) => state.setMaxEntries);
  const [pageSize, setPageSize] = usePersistentPageSize();
  const [tab, setTab] = useState<SettingsTab>("general");
  const active = settingsTabs.find((entry) => entry.value === tab) ?? settingsTabs[0];
  const ActiveIcon = active.icon;
  // "Automatic" names the language it resolves to, so the option says what it will do here.
  const detectedLanguage = t(detectLocale() === "pt" ? "Portuguese" : "English");
  const detectedTheme = t(detectTheme() === "light" ? "Light" : "Dark");
  const ThemeIcon = settings.theme === "light" ? Sun : settings.theme === "dark" ? Moon : Monitor;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Application Settings")}
        description={t("Configure defaults used when browsing, previewing and editing objects.")}
        className="settings-dialog"
      >
        <Tabs.Root
          value={tab}
          onValueChange={(value) => setTab(value as SettingsTab)}
          className="settings-tabs"
        >
          <Tabs.List className="settings-tab-list">
            {settingsTabs.map((entry) => (
              <Tabs.Trigger key={entry.value} value={entry.value}>
                <entry.icon size={13} />
                {t(entry.label)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="settings-body">
            <header>
              <ActiveIcon size={15} />
              <span>
                <strong>{t(active.heading)}</strong>
                <small>
                  {t("{hint} Changes are saved automatically.", { hint: t(active.hint) })}
                </small>
              </span>
            </header>

            <Tabs.Content value="general" className="settings-panel">
              <SettingsRow
                title={t("Language")}
                hint={t(
                  "Interface language. Automatic follows the language configured on this computer.",
                )}
              >
                <Select
                  value={settings.language}
                  onValueChange={(value) => settings.setLanguage(value as Language)}
                  ariaLabel={t("Interface language")}
                  icon={<Languages size={12} />}
                  options={[
                    {
                      value: "auto",
                      label: t("Automatic ({language})", { language: detectedLanguage }),
                    },
                    { value: "en", label: "English" },
                    { value: "pt", label: "Português" },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Theme")}
                hint={t(
                  "Interface colours. Automatic follows the theme configured on this computer.",
                )}
              >
                <Select
                  value={settings.theme}
                  onValueChange={(value) => settings.setTheme(value as Theme)}
                  ariaLabel={t("Interface theme")}
                  icon={<ThemeIcon size={12} />}
                  options={[
                    {
                      value: "auto",
                      label: t("Automatic ({theme})", { theme: detectedTheme }),
                    },
                    { value: "light", label: t("Light") },
                    { value: "dark", label: t("Dark") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Default object type")}
                hint={t("Choose the category shown when a project opens.")}
              >
                <Select
                  value={settings.defaultObjectType}
                  onValueChange={(value) =>
                    settings.setDefaultObjectType(value as DefaultObjectType)
                  }
                  ariaLabel={t("Default object type")}
                  options={[
                    { value: "Item", label: t("Items") },
                    { value: "Outfit", label: t("Outfits") },
                    { value: "Effect", label: t("Effects") },
                    { value: "Missile", label: t("Missiles") },
                    { value: "last", label: t("Last selected") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Default sort")}
                hint={t("Initial ordering used by the Object Browser.")}
              >
                <Select
                  value={settings.defaultSort}
                  onValueChange={(value) => settings.setDefaultSort(value as DefaultSort)}
                  ariaLabel={t("Default object sort")}
                  options={[
                    { value: "idAsc", label: t("ID ↑") },
                    { value: "idDesc", label: t("ID ↓") },
                    { value: "sizeDesc", label: t("Heaviest") },
                    { value: "sizeAsc", label: t("Lightest") },
                    { value: "nameAsc", label: t("Name ↑") },
                    { value: "nameDesc", label: t("Name ↓") },
                    { value: "spriteAsc", label: t("Sprite ↑") },
                    { value: "spriteDesc", label: t("Sprite ↓") },
                    { value: "modified", label: t("Modified") },
                    { value: "manual", label: t("Manual") },
                    { value: "last", label: t("Last used") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Objects per page")}
                hint={t("Rows requested from the core for each Object Browser page.")}
              >
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => setPageSize(Number(value))}
                  ariaLabel={t("Objects per page")}
                  options={PAGE_SIZES.map((size) => ({
                    value: String(size),
                    label: t("{size} objects", { size }),
                  }))}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Confirm before deleting")}
                hint={t("Ask for confirmation before removing an object from the project.")}
              >
                <Switch
                  checked={settings.confirmObjectDelete}
                  onCheckedChange={settings.setConfirmObjectDelete}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Notification duration")}
                hint={t("How long status messages stay on screen before fading out.")}
              >
                <NumberInput
                  value={settings.noticeDuration}
                  onCommit={settings.setNoticeDuration}
                  min={SETTINGS_LIMITS.noticeDuration.min}
                  max={SETTINGS_LIMITS.noticeDuration.max}
                  step={1}
                  suffix="s"
                  ariaLabel={t("Notification duration in seconds")}
                />
              </SettingsRow>
            </Tabs.Content>

            <Tabs.Content value="canvas" className="settings-panel">
              <SettingsRow
                title={t("Default canvas zoom")}
                hint={t("Auto includes a small margin; Fit uses all available canvas space.")}
              >
                <span className="settings-control-group">
                  <Select
                    value={settings.defaultCanvasZoom}
                    onValueChange={(value) =>
                      settings.setDefaultCanvasZoom(value as DefaultCanvasZoom)
                    }
                    ariaLabel={t("Default canvas zoom")}
                    options={[
                      { value: "auto", label: t("Auto") },
                      { value: "fit", label: t("Fit") },
                      { value: "percent", label: t("Zoom percent") },
                      { value: "last", label: t("Last used") },
                    ]}
                  />
                  {settings.defaultCanvasZoom === "percent" && (
                    <NumberInput
                      value={settings.defaultCanvasZoomPercent}
                      onCommit={settings.setDefaultCanvasZoomPercent}
                      min={SETTINGS_LIMITS.canvasZoomPercent.min}
                      max={SETTINGS_LIMITS.canvasZoomPercent.max}
                      step={10}
                      suffix="%"
                      ariaLabel={t("Default canvas zoom percentage")}
                    />
                  )}
                </span>
              </SettingsRow>
              <SettingsRow
                title={t("Canvas background")}
                hint={t("Backdrop drawn behind transparent pixels of the object.")}
              >
                <Select
                  value={settings.canvasBackground}
                  onValueChange={(value) => settings.setCanvasBackground(value as CanvasBackground)}
                  ariaLabel={t("Canvas background")}
                  options={[
                    { value: "checker", label: t("Checkerboard") },
                    { value: "dark", label: t("Solid dark") },
                    { value: "light", label: t("Solid light") },
                    { value: "magenta", label: t("Magenta") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Show pixel grid by default")}
                hint={t("Opens the canvas with the pixel grid already enabled.")}
              >
                <Switch
                  checked={settings.showGridByDefault}
                  onCheckedChange={settings.setShowGridByDefault}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Smooth scaling")}
                hint={t("Interpolates zoomed sprites instead of keeping hard pixel edges.")}
              >
                <Switch
                  checked={settings.smoothScaling}
                  onCheckedChange={settings.setSmoothScaling}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Canvas overlays")}
                hint={t("Cursor coordinates, zoom hint and the size badges around the object.")}
              >
                <Switch
                  checked={settings.showCanvasOverlays}
                  onCheckedChange={settings.setShowCanvasOverlays}
                />
              </SettingsRow>
            </Tabs.Content>

            <Tabs.Content value="animation" className="settings-panel">
              <SettingsRow
                title={t("Default frame group")}
                hint={t("The preferred animation group selected when opening an object.")}
              >
                <Select
                  value={settings.defaultFrameGroup}
                  onValueChange={(value) =>
                    settings.setDefaultFrameGroup(value as DefaultFrameGroup)
                  }
                  ariaLabel={t("Default frame group")}
                  options={[
                    { value: "idle", label: t("Idle") },
                    { value: "moving", label: t("Moving") },
                    { value: "last", label: t("Last selected") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Default film roll")}
                hint={t("Choose its initial state when opening an animated object.")}
              >
                <Select
                  value={settings.defaultFilmRoll}
                  onValueChange={(value) => settings.setDefaultFilmRoll(value as DefaultFilmRoll)}
                  ariaLabel={t("Default film roll state")}
                  options={[
                    { value: "auto", label: t("Auto") },
                    { value: "minimized", label: t("Minimized") },
                    { value: "maximized", label: t("Maximized") },
                    { value: "last", label: t("Last used") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Auto-play animation")}
                hint={t("Start playback automatically after selecting another animated object.")}
              >
                <Switch
                  checked={settings.autoPlayAnimation}
                  onCheckedChange={settings.setAutoPlayAnimation}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Loop playback")}
                hint={t("Restart from the first frame instead of stopping at the last one.")}
              >
                <Switch
                  checked={settings.loopAnimation}
                  onCheckedChange={settings.setLoopAnimation}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Playback speed")}
                hint={t(
                  "Multiplies frame durations during preview only; stored values are untouched.",
                )}
              >
                <Select
                  value={String(settings.animationSpeed)}
                  onValueChange={(value) => settings.setAnimationSpeed(Number(value))}
                  ariaLabel={t("Animation playback speed")}
                  options={[
                    { value: "0.25", label: "0.25×" },
                    { value: "0.5", label: "0.5×" },
                    { value: "1", label: t("1× (normal)") },
                    { value: "1.5", label: "1.5×" },
                    { value: "2", label: "2×" },
                    { value: "4", label: "4×" },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("New frame duration")}
                hint={t("Duration assigned to frames created with the Add frame button.")}
              >
                <NumberInput
                  value={settings.newFrameDuration}
                  onCommit={settings.setNewFrameDuration}
                  min={SETTINGS_LIMITS.newFrameDuration.min}
                  max={SETTINGS_LIMITS.newFrameDuration.max}
                  step={10}
                  shiftStep={100}
                  suffix="ms"
                  ariaLabel={t("Default duration for new frames")}
                />
              </SettingsRow>
            </Tabs.Content>

            <Tabs.Content value="outfits" className="settings-panel">
              <SettingsRow
                title={t("Default outfit direction")}
                hint={t("Direction selected when previewing an outfit for the first time.")}
              >
                <Select
                  value={settings.defaultOutfitDirection}
                  onValueChange={(value) =>
                    settings.setDefaultOutfitDirection(value as DefaultOutfitDirection)
                  }
                  ariaLabel={t("Default outfit direction")}
                  options={[
                    { value: "north", label: t("North") },
                    { value: "east", label: t("East") },
                    { value: "south", label: t("South") },
                    { value: "west", label: t("West") },
                    { value: "last", label: t("Last used") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Default outfit addons")}
                hint={t("Addons selected when previewing an outfit for the first time.")}
              >
                <Select
                  value={settings.defaultOutfitAddon}
                  onValueChange={(value) =>
                    settings.setDefaultOutfitAddon(value as DefaultOutfitAddon)
                  }
                  ariaLabel={t("Default outfit addons")}
                  options={[
                    { value: "none", label: t("No addons") },
                    { value: "addon1", label: t("Addon 1") },
                    { value: "addon2", label: t("Addon 2") },
                    { value: "all", label: t("All addons") },
                    { value: "last", label: t("Last used") },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Compose addons over the body")}
                hint={t("Draws the outfit body under the selected addon by default.")}
              >
                <Switch
                  checked={settings.outfitShowBody}
                  onCheckedChange={settings.setOutfitShowBody}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Default outfit colors")}
                hint={t("Preview palette for head, body, legs and feet.")}
              >
                <span className="settings-outfit-colors">
                  {(["head", "body", "legs", "feet"] as OutfitColorPart[]).map((part) => {
                    const label = t(part[0].toUpperCase() + part.slice(1));
                    return (
                      <input
                        key={part}
                        type="color"
                        value={settings.defaultOutfitColors[part]}
                        title={label}
                        aria-label={t("Default outfit {part} color", { part: label.toLowerCase() })}
                        onChange={(event) =>
                          settings.setDefaultOutfitColor(part, event.target.value)
                        }
                      />
                    );
                  })}
                </span>
              </SettingsRow>
            </Tabs.Content>

            <Tabs.Content value="advanced" className="settings-panel">
              <SettingsRow
                title={t("Undo history")}
                hint={t("How many editing steps are kept before the oldest ones are dropped.")}
              >
                <NumberInput
                  value={settings.undoLimit}
                  onCommit={settings.setUndoLimit}
                  min={SETTINGS_LIMITS.undoLimit.min}
                  max={SETTINGS_LIMITS.undoLimit.max}
                  step={5}
                  shiftStep={25}
                  suffix={t("steps")}
                  ariaLabel={t("Undo history limit")}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Log retention")}
                hint={t("Maximum events kept in the log panel; older entries are discarded.")}
              >
                <NumberInput
                  value={settings.logRetention}
                  onCommit={(value) => {
                    settings.setLogRetention(value);
                    setMaxLogEntries(value);
                  }}
                  min={SETTINGS_LIMITS.logRetention.min}
                  max={SETTINGS_LIMITS.logRetention.max}
                  step={100}
                  shiftStep={500}
                  suffix={t("events")}
                  ariaLabel={t("Log retention limit")}
                />
              </SettingsRow>
              <SettingsRow
                title={t("Restore defaults")}
                hint={t(
                  "Resets every preference on all tabs. Remembered “last used” values are kept.",
                )}
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    settings.resetSettings();
                    setMaxLogEntries(useSettingsStore.getState().logRetention);
                  }}
                >
                  <RotateCcw size={12} />
                  {t("Reset settings")}
                </Button>
              </SettingsRow>
            </Tabs.Content>
          </div>
        </Tabs.Root>
        <footer className="dialog-footer">
          <Button onClick={() => onOpenChange(false)}>{t("Done")}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function UnsavedChangesDialog({
  open,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent
        title={t("Save changes before closing?")}
        description={t("Your unsaved object, frame, sprite, and property changes will be lost.")}
        className="unsaved-dialog"
        overlayClassName="unsaved-dialog-overlay"
      >
        <div className="unsaved-body">
          <AlertTriangle size={24} />
          <span>
            <strong>{t("This workspace has unsaved changes.")}</strong>
            <small>
              {t("Save them now or discard them permanently before closing Object Builder.")}
            </small>
          </span>
        </div>
        <footer className="dialog-footer">
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            className="discard-button"
            onClick={onDiscard}
          >
            <Trash2 size={13} />
            {t("Discard")}
          </Button>
          <Button disabled={saving} onClick={onSave}>
            <Save size={13} />
            {saving ? t("Saving…") : t("Save and close")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("About Object Builder")} className="about-dialog">
        <div className="about-body">
          <div className="about-logo">OB</div>
          <h2>{APP_INFO.name}</h2>
          <p>{APP_INFO.tagline}</p>
          <strong>{t("Version {version}", { version: APP_INFO.version })}</strong>
          <dl>
            <div>
              <dt>{t("Rust core / app")}</dt>
              <dd>{APP_INFO.version}</dd>
            </div>
            <div>
              <dt>Tauri</dt>
              <dd>{APP_INFO.tauri}</dd>
            </div>
            <div>
              <dt>{t("Frontend")}</dt>
              <dd>{APP_INFO.frontend}</dd>
            </div>
            <div>
              <dt>{t("UI")}</dt>
              <dd>Tailwind CSS · Radix UI</dd>
            </div>
            <div>
              <dt>{t("License")}</dt>
              <dd>
                <a href={APP_INFO.licenseUrl} target="_blank" rel="noreferrer">
                  {APP_INFO.license} <ExternalLink size={12} />
                </a>
              </dd>
            </div>
          </dl>
          <div className="about-links">
            <a href={APP_INFO.repository} target="_blank" rel="noreferrer">
              GitHub <ExternalLink size={12} />
            </a>
            <a href={APP_INFO.documentation} target="_blank" rel="noreferrer">
              {t("Documentation")} <ExternalLink size={12} />
            </a>
          </div>
          <small>{t("© 2026 Eibly · Released under the MIT License")}</small>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShortcutSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { bindings, setBinding, resetBinding, resetAll } = useShortcutStore();
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [pending, setPending] = useState("");
  const [conflict, setConflict] = useState<ShortcutAction | null>(null);
  const definition = shortcutDefinitions.find((item) => item.action === editing);
  const capture = (event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = keyboardEventToShortcut(event.nativeEvent);
    if (!shortcut) return;
    setPending(shortcut);
    setConflict(setBinding(editing!, shortcut));
    if (
      !shortcutDefinitions.some(
        (item) => item.action !== editing && bindings[item.action] === shortcut,
      )
    ) {
      setEditing(null);
      setPending("");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Keyboard Shortcuts")}
        description={t("Customize commands. Changes are saved automatically.")}
        className="shortcut-dialog"
      >
        <div className="shortcut-toolbar">
          <span>
            <Keyboard size={14} />
            {t("Application shortcuts")}
          </span>
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <RotateCcw size={12} />
            {t("Reset all")}
          </Button>
        </div>
        <div className="shortcut-list">
          {shortcutDefinitions.map((item, index) => (
            <Fragment key={item.action}>
              {item.group && item.group !== shortcutDefinitions[index - 1]?.group && (
                <div className="shortcut-group">{t(item.group)}</div>
              )}
              <div className="shortcut-row">
              <div>
                <strong>{t(item.name)}</strong>
                <small>{t(item.description)}</small>
              </div>
              <kbd>{bindings[item.action] || t("Unassigned")}</kbd>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(item.action);
                  setPending("");
                  setConflict(null);
                }}
              >
                {t("Edit")}
              </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => resetBinding(item.action)}
                  aria-label={t("Reset {name}", { name: t(item.name) })}
                >
                  <RotateCcw size={12} />
                </Button>
              </div>
            </Fragment>
          ))}
        </div>
        {editing && (
          <div className="shortcut-capture" tabIndex={0} autoFocus onKeyDown={capture}>
            <span>{t("Change shortcut")}</span>
            <strong>{definition && t(definition.name)}</strong>
            <kbd>{pending || t("Press the new shortcut…")}</kbd>
            {conflict && (
              <div className="shortcut-conflict">
                <b>{t("Shortcut already in use")}</b>
                <span>
                  {t("{shortcut} is assigned to {name}.", {
                    shortcut: pending,
                    name: t(
                      shortcutDefinitions.find((item) => item.action === conflict)?.name ?? "",
                    ),
                  })}
                </span>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setConflict(null);
                    }}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setBinding(editing, pending, true);
                      setEditing(null);
                      setConflict(null);
                    }}
                  >
                    {t("Reassign")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
