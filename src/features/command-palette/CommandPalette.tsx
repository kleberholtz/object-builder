import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Boxes,
  ChevronsLeftRight,
  Copy,
  CornerDownLeft,
  Database,
  Download,
  FileJson,
  Film,
  FolderOpen,
  Grid3X3,
  History,
  Image,
  Info,
  Keyboard,
  Layers3,
  ListChecks,
  LogOut,
  MousePointerClick,
  Redo2,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useT } from "../../lib/i18n";
import { useEditorStore, type ObjectKindFilter } from "../../stores/editor-store";
import { useLogStore } from "../../stores/log-store";
import { useShortcutStore, type ShortcutAction } from "../../stores/shortcut-store";

/** Everything the palette can run that only `App` knows how to do. */
export interface CommandActions {
  openClient: () => void;
  importAny: () => void;
  save: () => void;
  saveAs: () => void;
  importObject: () => void;
  exportObject: () => void;
  importPng: (sheet: boolean) => void;
  exportPng: (mode: string) => void;
  undo: () => void;
  redo: () => void;
  history: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  searchObjects: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  validate: () => void;
  optimize: () => void;
  spriteManager: () => void;
  settings: () => void;
  shortcuts: () => void;
  about: () => void;
  closeApp: () => void;
}

interface Command {
  id: string;
  group: string;
  title: string;
  hint?: string;
  /** Extra words the search also matches, so "category" finds the Items tab. */
  keywords?: string;
  binding?: ShortcutAction;
  icon: ReactNode;
  run: () => void;
}

interface CommandGroup {
  group: string;
  items: Command[];
}

const HISTORY_KEY = "object-builder-command-history";
const HISTORY_LIMIT = 5;

function loadHistory(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function rememberCommand(id: string) {
  const history = [id, ...loadHistory().filter((entry) => entry !== id)].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

// A contiguous hit ranks above a scattered one, and an early hit above a late one, so
// typing "opt" puts "Optimize project" ahead of "Export object" — which also contains
// o, p and t, just spread across the whole label.
function scoreMatch(text: string, query: string): number | null {
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(query);
  if (direct >= 0) return 1000 - direct * 4 - haystack.length;
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const char of query) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    score += found === previous + 1 ? 6 : 1;
    previous = found;
    cursor = found + 1;
  }
  return score;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandActions;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  const bindings = useShortcutStore((state) => state.bindings);
  const showGrid = useEditorStore((state) => state.showGrid);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const toggleFilmRoll = useEditorStore((state) => state.toggleFilmRoll);
  const toggleInspector = useEditorStore((state) => state.toggleInspector);
  const filmRollCollapsed = useEditorStore((state) => state.filmRollCollapsed);
  const inspectorCollapsed = useEditorStore((state) => state.inspectorCollapsed);
  const setInspectorCollapsed = useEditorStore((state) => state.setInspectorCollapsed);
  const objectKindFilter = useEditorStore((state) => state.objectKindFilter);
  const setObjectKindFilter = useEditorStore((state) => state.setObjectKindFilter);
  const inspectorTab = useEditorStore((state) => state.inspectorTab);
  const setInspectorTab = useEditorStore((state) => state.setInspectorTab);
  const logsExpanded = useLogStore((state) => state.expanded);
  const setLogsExpanded = useLogStore((state) => state.setExpanded);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const categories: Array<{ value: ObjectKindFilter; label: string }> = [
      { value: "All", label: "All objects" },
      { value: "Item", label: "Items" },
      { value: "Outfit", label: "Outfits" },
      { value: "Effect", label: "Effects" },
      { value: "Missile", label: "Missiles" },
    ];
    const inspectorTabs: Array<{ value: "object" | "server" | "flags"; label: string }> = [
      { value: "object", label: "Object" },
      { value: "server", label: "Server" },
      { value: "flags", label: "Flags" },
    ];
    // Opening a tab in a collapsed panel would land on nothing, so the jump expands it.
    const goToInspector = (tab: "object" | "server" | "flags") => {
      setInspectorCollapsed(false);
      setInspectorTab(tab);
    };
    return [
      {
        id: "file.open",
        group: t("File"),
        title: t("Open client…"),
        keywords: "dat spr load",
        binding: "openClient",
        icon: <FolderOpen size={14} />,
        run: actions.openClient,
      },
      {
        id: "file.import",
        group: t("File"),
        title: t("Import file…"),
        keywords: "dat spr json obd png open",
        icon: <Upload size={14} />,
        run: actions.importAny,
      },
      {
        id: "file.save",
        group: t("File"),
        title: t("Save"),
        keywords: "write dat spr",
        binding: "save",
        icon: <Save size={14} />,
        run: actions.save,
      },
      {
        id: "file.saveAs",
        group: t("File"),
        title: t("Save as…"),
        keywords: "json client copy",
        binding: "saveAs",
        icon: <FileJson size={14} />,
        run: actions.saveAs,
      },
      {
        id: "file.importObject",
        group: t("File"),
        title: t("Import OBD…"),
        keywords: "object obx",
        icon: <Upload size={14} />,
        run: actions.importObject,
      },
      {
        id: "file.exportObject",
        group: t("File"),
        title: t("Export object…"),
        keywords: "obd png spritesheet save",
        icon: <Download size={14} />,
        run: actions.exportObject,
      },
      {
        id: "file.close",
        group: t("File"),
        title: t("Close application"),
        keywords: "quit exit",
        icon: <LogOut size={14} />,
        run: actions.closeApp,
      },

      {
        id: "edit.undo",
        group: t("Edit"),
        title: t("Undo"),
        keywords: "revert history",
        binding: "undo",
        icon: <Undo2 size={14} />,
        run: actions.undo,
      },
      {
        id: "edit.redo",
        group: t("Edit"),
        title: t("Redo"),
        keywords: "history",
        binding: "redo",
        icon: <Redo2 size={14} />,
        run: actions.redo,
      },
      {
        id: "edit.history",
        group: t("Edit"),
        title: t("Change history"),
        hint: t("Travels back to any recorded edit"),
        keywords: "undo redo steps timeline",
        icon: <History size={14} />,
        run: actions.history,
      },
      {
        id: "edit.copy",
        group: t("Edit"),
        title: t("Copy object"),
        binding: "copy",
        icon: <Copy size={14} />,
        run: actions.copy,
      },
      {
        id: "edit.paste",
        group: t("Edit"),
        title: t("Paste object"),
        binding: "paste",
        icon: <Copy size={14} />,
        run: actions.paste,
      },
      {
        id: "edit.duplicate",
        group: t("Edit"),
        title: t("Duplicate selected object"),
        keywords: "clone copy",
        icon: <Copy size={14} />,
        run: actions.duplicate,
      },
      {
        id: "edit.delete",
        group: t("Edit"),
        title: t("Delete selection"),
        keywords: "remove erase",
        binding: "delete",
        icon: <Trash2 size={14} />,
        run: actions.remove,
      },
      {
        id: "edit.selectAll",
        group: t("Edit"),
        title: t("Select all objects"),
        binding: "selectAll",
        icon: <MousePointerClick size={14} />,
        run: actions.selectAll,
      },
      {
        id: "edit.searchObjects",
        group: t("Edit"),
        title: t("Search objects"),
        keywords: "find filter query",
        binding: "searchObjects",
        icon: <Search size={14} />,
        run: actions.searchObjects,
      },

      {
        id: "sprites.manager",
        group: t("Sprites"),
        title: t("View all sprites…"),
        keywords: "manager statistics usage",
        icon: <Database size={14} />,
        run: actions.spriteManager,
      },
      {
        id: "sprites.importPng",
        group: t("Sprites"),
        title: t("Import PNG…"),
        keywords: "frame replace image",
        icon: <Image size={14} />,
        run: () => actions.importPng(false),
      },
      {
        id: "sprites.importSheet",
        group: t("Sprites"),
        title: t("Import spritesheet…"),
        keywords: "png frames image",
        icon: <Image size={14} />,
        run: () => actions.importPng(true),
      },
      {
        id: "sprites.exportFrame",
        group: t("Sprites"),
        title: t("Export selected frame…"),
        keywords: "png image",
        icon: <Download size={14} />,
        run: () => actions.exportPng("frame"),
      },
      {
        id: "sprites.exportAllFrames",
        group: t("Sprites"),
        title: t("Export all frames…"),
        keywords: "png image",
        icon: <Download size={14} />,
        run: () => actions.exportPng("allFrames"),
      },
      {
        id: "sprites.exportObject",
        group: t("Sprites"),
        title: t("Export complete object…"),
        keywords: "png image",
        icon: <Download size={14} />,
        run: () => actions.exportPng("object"),
      },
      {
        id: "sprites.exportSheet",
        group: t("Sprites"),
        title: t("Export spritesheet…"),
        keywords: "png image",
        icon: <Download size={14} />,
        run: () => actions.exportPng("spritesheet"),
      },

      {
        id: "view.zoomIn",
        group: t("View"),
        title: t("Zoom in"),
        binding: "zoomIn",
        icon: <ZoomIn size={14} />,
        run: actions.zoomIn,
      },
      {
        id: "view.zoomOut",
        group: t("View"),
        title: t("Zoom out"),
        binding: "zoomOut",
        icon: <ZoomOut size={14} />,
        run: actions.zoomOut,
      },
      {
        id: "view.resetZoom",
        group: t("View"),
        title: t("Reset zoom to auto-fit"),
        keywords: "center fit",
        binding: "resetZoom",
        icon: <RotateCcw size={14} />,
        run: actions.resetZoom,
      },
      {
        id: "view.grid",
        group: t("View"),
        title: showGrid ? t("Hide pixel grid") : t("Show pixel grid"),
        keywords: "grid pixel toggle",
        binding: "toggleGrid",
        icon: <Grid3X3 size={14} />,
        run: toggleGrid,
      },
      {
        id: "view.filmRoll",
        group: t("View"),
        title: filmRollCollapsed ? t("Show film roll") : t("Hide film roll"),
        keywords: "frames animation panel toggle",
        icon: <Film size={14} />,
        run: toggleFilmRoll,
      },
      {
        id: "view.inspector",
        group: t("View"),
        title: inspectorCollapsed ? t("Show inspector") : t("Hide inspector"),
        keywords: "properties panel toggle",
        icon: <ChevronsLeftRight size={14} />,
        run: toggleInspector,
      },
      {
        id: "view.logs",
        group: t("View"),
        title: logsExpanded ? t("Hide log panel") : t("Show log panel"),
        keywords: "console output toggle",
        icon: <ScrollText size={14} />,
        run: () => setLogsExpanded(!logsExpanded),
      },

      ...categories.map<Command>((category) => ({
        id: `tab.objects.${category.value}`,
        group: t("Go to tab"),
        title: `${t("Objects")}: ${t(category.label)}`,
        hint: objectKindFilter === category.value ? t("current") : undefined,
        keywords: "browser category filter type tab",
        icon: <Layers3 size={14} />,
        run: () => setObjectKindFilter(category.value),
      })),
      ...inspectorTabs.map<Command>((tab) => ({
        id: `tab.inspector.${tab.value}`,
        group: t("Go to tab"),
        title: `${t("Inspector")}: ${t(tab.label)}`,
        hint: !inspectorCollapsed && inspectorTab === tab.value ? t("current") : undefined,
        keywords: "properties attributes flags tab panel",
        icon: <Boxes size={14} />,
        run: () => goToInspector(tab.value),
      })),

      {
        id: "tools.validate",
        group: t("Tools"),
        title: t("Validate project"),
        keywords: "check integrity sprites",
        icon: <ListChecks size={14} />,
        run: actions.validate,
      },
      {
        id: "tools.optimize",
        group: t("Tools"),
        title: t("Optimize project…"),
        keywords: "unused duplicate sprites cleanup",
        icon: <Sparkles size={14} />,
        run: actions.optimize,
      },

      {
        id: "settings.application",
        group: t("Settings"),
        title: t("Application Settings…"),
        keywords: "preferences defaults options",
        icon: <Settings size={14} />,
        run: actions.settings,
      },
      {
        id: "settings.shortcuts",
        group: t("Settings"),
        title: t("Keyboard Shortcuts…"),
        keywords: "keys bindings hotkeys",
        icon: <Keyboard size={14} />,
        run: actions.shortcuts,
      },
      {
        id: "settings.about",
        group: t("Settings"),
        title: t("About Object Builder"),
        keywords: "version help",
        icon: <Info size={14} />,
        run: actions.about,
      },
    ];
  }, [
    actions,
    filmRollCollapsed,
    t,
    inspectorCollapsed,
    inspectorTab,
    logsExpanded,
    objectKindFilter,
    setInspectorCollapsed,
    setInspectorTab,
    setLogsExpanded,
    setObjectKindFilter,
    showGrid,
    toggleFilmRoll,
    toggleGrid,
    toggleInspector,
  ]);

  const groups = useMemo<CommandGroup[]>(() => {
    const term = query.trim().toLowerCase();
    const collect = (entries: Command[]) => {
      const buckets = new Map<string, Command[]>();
      for (const command of entries) {
        const bucket = buckets.get(command.group);
        if (bucket) bucket.push(command);
        else buckets.set(command.group, [command]);
      }
      return Array.from(buckets, ([group, items]) => ({ group, items }));
    };
    if (!term) {
      const recent = history
        .map((id) => commands.find((command) => command.id === id))
        .filter((command): command is Command => Boolean(command));
      return [
        ...(recent.length ? [{ group: t("Recent"), items: recent }] : []),
        ...collect(commands),
      ];
    }
    const matches = commands
      .map((command) => ({
        command,
        score: scoreMatch(`${command.title} ${command.group} ${command.keywords ?? ""}`, term),
      }))
      .filter((entry): entry is { command: Command; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
    return collect(matches);
  }, [commands, history, query, t]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : 0;
  const activeRowId = flat.length ? `command-row-${activeIndex}` : undefined;

  useEffect(() => {
    listRef.current?.querySelector("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [activeRowId]);

  const runCommand = (command: Command) => {
    setHistory(rememberCommand(command.id));
    onOpenChange(false);
    // Radix must finish closing this dialog before a command opens another one,
    // otherwise the outgoing overlay takes focus back from it.
    window.setTimeout(command.run, 0);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (Math.min(index, flat.length - 1) + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (Math.min(index, flat.length - 1) + flat.length - 1) % flat.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(flat.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(flat[activeIndex]);
    }
  };

  let cursor = -1;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay command-overlay" />
        <DialogPrimitive.Content
          className="command-palette"
          onOpenAutoFocus={() => {
            setQuery("");
            setActive(0);
            setHistory(loadHistory());
          }}
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">{t("Command palette")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("Search commands, panels and tabs")}
          </DialogPrimitive.Description>
          <header className="command-search">
            <Search size={15} />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder={t("Search commands, panels and tabs…")}
              aria-label={t("Search commands, panels and tabs")}
              aria-activedescendant={activeRowId}
              role="combobox"
              aria-expanded
              aria-controls="command-results"
            />
            <kbd>Esc</kbd>
          </header>
          <div
            className="command-results"
            id="command-results"
            role="listbox"
            aria-label={t("Command palette")}
            ref={listRef}
          >
            {flat.length ? (
              groups.map((group) => (
                <section key={group.group}>
                  <h3>{group.group}</h3>
                  {group.items.map((command) => {
                    // A recently used command is listed twice — under "Recent" and in its own
                    // group — so the row position, not the command, is what the cursor tracks.
                    cursor += 1;
                    const index = cursor;
                    const keys = command.binding ? bindings[command.binding] : undefined;
                    return (
                      <button
                        key={`${group.group}-${command.id}`}
                        id={`command-row-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        data-active={index === activeIndex}
                        onMouseMove={() => setActive(index)}
                        onClick={() => runCommand(command)}
                      >
                        {command.icon}
                        <span>{command.title}</span>
                        {command.hint && <em>{command.hint}</em>}
                        {keys && <kbd>{keys}</kbd>}
                      </button>
                    );
                  })}
                </section>
              ))
            ) : (
              <p className="command-empty">{t("No command matches “{query}”", { query })}</p>
            )}
          </div>
          <footer className="command-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t("navigate")}
            </span>
            <span>
              <kbd>
                <CornerDownLeft size={9} />
              </kbd>{" "}
              {t("run")}
            </span>
            <span>
              <kbd>Esc</kbd> {t("close")}
            </span>
            <span className="command-footer-spacer" />
            <span>
              {flat.length} {flat.length === 1 ? t("command") : t("commands")}
            </span>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
