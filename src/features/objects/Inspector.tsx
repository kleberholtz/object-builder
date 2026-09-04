import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  MousePointer2,
  Palette,
  Plus,
  RotateCcw,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Switch } from "../../components/ui/switch";
import { Select } from "../../components/ui/select";
import { Tabs } from "../../components/ui/tabs";
import { updateObject } from "../../stores/history-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import type { FrameGroup, ThingObject } from "../../types/editor";
import { objectKey } from "../../lib/utils";
import { tr, useT } from "../../lib/i18n";
import {
  availableFlags,
  clientVersionNumber,
  derivedFlag,
  flagDefinition,
  flagGroups,
  flagSupport,
  objectCapabilities,
  type FlagDefinition,
} from "../../lib/object-capabilities";
import { type InspectorTab, type OutfitColorPart, useEditorStore } from "../../stores/editor-store";
import { useSettingsStore } from "../../stores/settings-store";
import { Tooltip } from "../../components/ui/tooltip";
import { NumberInput } from "../../components/ui/number-input";
import { AnimationPreview } from "../sprites/AnimationPreview";

const collapsedSectionsKey = "object-builder-inspector-sections";

function loadCollapsedSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(collapsedSectionsKey) ?? "{}");
  } catch {
    return {};
  }
}

type FrameLayout = NonNullable<FrameGroup["layout"]>;

// `title` is the English source: it keys both the dictionary and the collapsed-state storage,
// so switching language cannot forget which sections were folded away.
function Section({
  title,
  children,
  suffix,
}: {
  title: string;
  children: ReactNode;
  suffix?: string;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(() => loadCollapsedSections()[title] === true);
  const toggle = () =>
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem(
        collapsedSectionsKey,
        JSON.stringify({ ...loadCollapsedSections(), [title]: next }),
      );
      return next;
    });
  return (
    <section className={`property-section ${collapsed ? "collapsed" : ""}`}>
      <button type="button" className="section-title" aria-expanded={!collapsed} onClick={toggle}>
        <span>
          <ChevronDown size={12} className="section-chevron" />
          {t(title)}
        </span>
        {suffix && <small>{suffix}</small>}
      </button>
      {!collapsed && <div className="section-content">{children}</div>}
    </section>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}

function FlagRow({
  name,
  description,
  badge,
  checked,
  onCheckedChange,
}: {
  name: string;
  description: string;
  badge?: { label: string; title: string };
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flag-row ${badge ? "flag-ignored" : ""}`}>
      <span title={description}>
        {name}
        {badge && <em title={badge.title}>{badge.label}</em>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

export function Inspector({ onViewSprites }: { onViewSprites: () => void }) {
  const t = useT();
  const objects = useProjectStore((state) => state.objects);
  const clientVersion = useProjectStore((state) => state.project?.clientVersion);
  const markObjectOrderDraft = useProjectStore((state) => state.markObjectOrderDraft);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const inspectorCollapsed = useEditorStore((state) => state.inspectorCollapsed);
  const toggleInspector = useEditorStore((state) => state.toggleInspector);
  const object = objects.find((entry) => objectKey(entry) === selectedKeys[0]);
  const selectedObjectKey = object ? objectKey(object) : "";
  const defaultOutfitColors = useSettingsStore((state) => state.defaultOutfitColors);
  const previewColors =
    useEditorStore((state) => state.outfitPreviewColors[selectedObjectKey]) ?? defaultOutfitColors;
  const setPreviewColor = useEditorStore((state) => state.setOutfitPreviewColor);
  const randomizePreviewColors = useEditorStore((state) => state.randomizeOutfitPreviewColors);
  const resetPreviewColors = useEditorStore((state) => state.resetOutfitPreviewColors);
  const activeFrameGroup = useEditorStore((state) => state.activeFrameGroup);
  const tab = useEditorStore((state) => state.inspectorTab);
  const setTab = useEditorStore((state) => state.setInspectorTab);
  if (inspectorCollapsed)
    return (
      <aside className="inspector collapsed panel-border-left">
        <div className="panel-heading">
          <Tooltip
            label={t("Expand Inspector")}
            description={t("Restores object properties beside the Canvas.")}
          >
            <Button variant="ghost" size="icon" onClick={toggleInspector}>
              <ChevronLeft size={14} />
            </Button>
          </Tooltip>
        </div>
      </aside>
    );
  if (!object)
    return (
      <aside className="inspector panel-border-left">
        <div className="panel-heading">
          <span>{t("Inspector")}</span>
          <Tooltip
            label={t("Collapse Inspector")}
            description={t("Releases horizontal space for the Canvas.")}
          >
            <Button variant="ghost" size="icon" onClick={toggleInspector}>
              <ChevronRight size={14} />
            </Button>
          </Tooltip>
        </div>
        <div className="inspector-empty">
          <MousePointer2 size={22} />
          <strong>{t("No object selected")}</strong>
          <span>{t("Select an object in the browser to inspect and edit its properties.")}</span>
        </div>
      </aside>
    );

  const patch = (transform: (entry: ThingObject) => ThingObject, label?: string) =>
    updateObject(object, transform, label);
  // The history panel lists one row per edit, so a row that only said "edited" would make a
  // run of Inspector changes unreadable; the field name is what tells them apart.
  const changed = (field: string) => tr("Changed {field}", { field });
  const supportsOutfitColors =
    object.kind === "Outfit" &&
    object.frameGroups.some((group) => (group.layout?.layers ?? object.dimensions.layers) >= 2);
  const capabilities = objectCapabilities(object.kind);
  const primaryLayout = object.frameGroups[0]?.layout;
  const patternY = primaryLayout?.patternY ?? 1;
  const patternZ = primaryLayout?.patternZ ?? 1;
  // A field the category does not use still shows when it carries a value: the Inspector narrows
  // what can be edited, it never hides data already in the DAT.
  const showsElevation = capabilities.elevation || object.position.elevation !== 0;
  const showsMinimap = capabilities.minimapColor || object.gameplay.minimapColor !== 0;
  const showsGroundSpeed = capabilities.groundSpeed || object.gameplay.groundSpeed !== 0;
  const showsServerTab = capabilities.serverAttributes || object.attributes.length > 0;
  const activeTab = tab === "server" && !showsServerTab ? "object" : tab;
  const colorParts: Array<{ key: OutfitColorPart; label: string }> = [
    { key: "head", label: t("Head") },
    { key: "body", label: t("Body") },
    { key: "legs", label: t("Legs") },
    { key: "feet", label: t("Feet") },
  ];
  const relayoutGroups = (entry: ThingObject, mutate: (layout: FrameLayout) => FrameLayout) =>
    entry.frameGroups.map((group, index) => {
      const layout = group.layout ?? {
        groupType: index,
        width: entry.dimensions.width,
        height: entry.dimensions.height,
        layers: entry.dimensions.layers,
        patternX: entry.dimensions.patterns,
        patternY: 1,
        patternZ: 1,
      };
      const nextLayout = mutate(layout);
      const previousStride = Math.max(
        1,
        Math.floor(group.spriteIds.length / Math.max(1, group.frames.length)),
      );
      const nextStride =
        nextLayout.width *
        nextLayout.height *
        nextLayout.layers *
        nextLayout.patternX *
        nextLayout.patternY *
        nextLayout.patternZ;
      const phases = group.frames.map((frame, phase) => {
        const ids = group.spriteIds
          .slice(phase * previousStride, (phase + 1) * previousStride)
          .slice(0, nextStride);
        while (ids.length < nextStride) ids.push(0);
        return { frame: { ...frame, spriteId: ids[0] ?? 0 }, ids };
      });
      return {
        ...group,
        layout: nextLayout,
        frames: phases.map((phase) => phase.frame),
        spriteIds: phases.flatMap((phase) => phase.ids),
      };
    });
  // The row the number was typed into is what the person will look for in the history, so the
  // label is the visible one — "Directions" for a missile, not the `patterns` field behind it.
  const dimensionLabels: Record<keyof ThingObject["dimensions"], string> = {
    width: t("Width"),
    height: t("Height"),
    layers: t("Layers"),
    patterns: t(capabilities.patternLabels.x),
  };
  const patchDimension = (field: keyof ThingObject["dimensions"], value: number) =>
    patch((entry) => {
      const dimensions = { ...entry.dimensions, [field]: value };
      // "patterns" is the X axis alone: wiping Y and Z here would drop an outfit's addons and
      // mounts, and collapse the 3x3 grid a missile uses for its directions.
      const frameGroups = relayoutGroups(entry, (layout) =>
        field === "patterns" ? { ...layout, patternX: value } : { ...layout, [field]: value },
      );
      return {
        ...entry,
        dimensions,
        frameGroups,
        spriteId: frameGroups[0]?.frames[0]?.spriteId ?? 0,
      };
    }, changed(dimensionLabels[field]));
  const version = clientVersionNumber(clientVersion);
  const offeredFlags: FlagDefinition[] = availableFlags(object.kind, version);
  // A flag the category does not read still shows when the object carries it: the Inspector
  // narrows what can be turned on, it never hides an attribute already in the DAT.
  const carriedFlags = Object.entries(object.flags)
    .filter(
      ([name, enabled]) =>
        enabled === true &&
        name !== derivedFlag &&
        !offeredFlags.some((definition) => definition.name === name),
    )
    .map(([name]) => {
      const support = flagSupport(object.kind, name, version);
      const badge =
        support === "unused"
          ? {
              label: t("ignored"),
              title: t("The client does not read this attribute for {kind}.", {
                kind: t(`${object.kind}s`).toLowerCase(),
              }),
            }
          : support === "unversioned"
            ? {
                label: t("client"),
                title: t(
                  "Client {version} has no attribute byte for this flag; saving the DAT would refuse it.",
                  { version: clientVersion ?? "10.98" },
                ),
              }
            : {
                label: t("unknown"),
                title: t(
                  "This name is not in the DAT attribute table; saving the DAT would refuse it.",
                ),
              };
      return { name, badge };
    });
  const setFlag = (name: string, checked: boolean) =>
    patch(
      (entry) => {
        const flags = { ...entry.flags, [name]: checked };
        // "Moveable" is the reader's inverse of "Not moveable" and has no attribute of its own.
        if (name === "Not moveable") flags[derivedFlag] = !checked;
        return { ...entry, flags };
      },
      tr(checked ? "Enabled {flag}" : "Disabled {flag}", { flag: tr(name) }),
    );
  // The Animation section reads the group the Film Roll is showing: those are the frames whose
  // durations are on screen, and an outfit's idle and moving groups are timed separately.
  const animationGroupIndex = Math.min(
    Math.max(0, activeFrameGroup),
    Math.max(0, object.frameGroups.length - 1),
  );
  const animationGroup = object.frameGroups[animationGroupIndex];
  const animationFrames = animationGroup?.frames ?? [];
  const totalDuration = animationFrames.reduce((sum, frame) => sum + frame.duration, 0);
  const uniformDuration = animationFrames.every(
    (frame) => frame.duration === animationFrames[0]?.duration,
  );
  // Frames per second of the whole group, so a group whose frames disagree still reports the
  // rate it is actually played at instead of the rate of whichever frame comes first.
  const framesPerSecond =
    totalDuration > 0 ? Math.round((animationFrames.length * 1000) / totalDuration) : 0;
  /** Gives every frame of the group the same duration — the one shape both FPS and Duration have. */
  const spreadFrameDuration = (perFrame: number) => {
    const valid = Math.max(1, Math.min(60_000, Math.round(perFrame)));
    if (animationFrames.every((frame) => frame.duration === valid)) return;
    patch(
      (entry) => ({
        ...entry,
        frameGroups: entry.frameGroups.map((group, index) =>
          index === animationGroupIndex
            ? { ...group, frames: group.frames.map((frame) => ({ ...frame, duration: valid })) }
            : group,
        ),
      }),
      tr(
        animationFrames.length === 1
          ? "Applied {duration} ms to {count} frame"
          : "Applied {duration} ms to {count} frames",
        { duration: valid, count: animationFrames.length },
      ),
    );
  };
  const patchPattern = (axis: "patternY" | "patternZ", value: number) =>
    patch((entry) => {
      const frameGroups = relayoutGroups(entry, (layout) => ({ ...layout, [axis]: value }));
      return { ...entry, frameGroups, spriteId: frameGroups[0]?.frames[0]?.spriteId ?? 0 };
    }, changed(tr(axis === "patternY" ? "Pattern Y" : "Pattern Z")));
  return (
    <aside className="inspector panel-border-left">
      <div className="panel-heading">
        <span>{t("Inspector")}</span>
        <Tooltip
          label={t("Collapse Inspector")}
          description={t("Releases horizontal space for the Canvas.")}
        >
          <Button variant="ghost" size="icon" onClick={toggleInspector}>
            <ChevronRight size={14} />
          </Button>
        </Tooltip>
      </div>
      {selectedKeys.length > 1 && (
        <div className="bulk-notice">
          {t("Editing {count} selected objects", { count: selectedKeys.length })}
        </div>
      )}
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setTab(value as InspectorTab)}
        className="inspector-tabs"
      >
        <Tabs.List className={`inspector-tab-list ${showsServerTab ? "" : "two-tabs"}`}>
          <Tabs.Trigger value="object">{t("Object")}</Tabs.Trigger>
          {showsServerTab && <Tabs.Trigger value="server">{t("Server")}</Tabs.Trigger>}
          <Tabs.Trigger value="flags">{t("Flags")}</Tabs.Trigger>
        </Tabs.List>
        <ScrollArea className="inspector-scroll">
          <Tabs.Content value="object">
            <Section title="General">
              <PropertyRow label={t("ID")}>
                <div className="locked-input">
                  <Input value={object.id} readOnly />
                  <span>{t("locked")}</span>
                </div>
              </PropertyRow>
              <PropertyRow label={t("Type")}>
                <Select
                  value={object.kind}
                  onValueChange={(kind) => {
                    if (kind !== object.kind) markObjectOrderDraft();
                    patch(
                      (entry) => ({ ...entry, kind: kind as ThingObject["kind"] }),
                      changed(t("Type")),
                    );
                  }}
                  options={["Item", "Outfit", "Effect", "Missile"].map((value) => ({
                    value,
                    label: t(value),
                  }))}
                  ariaLabel={t("Object type")}
                />
              </PropertyRow>
              <PropertyRow label={t("Name")}>
                <Input
                  value={object.name}
                  onChange={(event) =>
                    patch((entry) => ({ ...entry, name: event.target.value }), changed(t("Name")))
                  }
                />
              </PropertyRow>
              <PropertyRow label={t("Sprite ID")}>
                <Input value={object.spriteId} readOnly />
              </PropertyRow>
              <Button variant="outline" size="sm" className="w-full" onClick={onViewSprites}>
                <Database size={12} />
                {t("View referenced sprites")}
              </Button>
            </Section>
            {supportsOutfitColors && (
              <Section title="Outfit colors" suffix={t("Preview only")}>
                <div className="outfit-color-grid">
                  {colorParts.map((part) => (
                    <label className="outfit-color-field" key={part.key}>
                      <span>{part.label}</span>
                      <span className="outfit-color-control">
                        <input
                          type="color"
                          value={previewColors[part.key]}
                          onChange={(event) =>
                            setPreviewColor(selectedObjectKey, part.key, event.target.value)
                          }
                          aria-label={t("{part} preview color", { part: part.label })}
                        />
                        <code>{previewColors[part.key].toUpperCase()}</code>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="outfit-color-actions">
                  <Tooltip
                    label={t("Randomize preview")}
                    description={t(
                      "Chooses four random preview colors without changing or saving the outfit sprites.",
                    )}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => randomizePreviewColors(selectedObjectKey)}
                    >
                      <Shuffle size={12} />
                      {t("Randomize")}
                    </Button>
                  </Tooltip>
                  <Tooltip
                    label={t("Reset preview")}
                    description={t("Restores the neutral preview palette for this outfit.")}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resetPreviewColors(selectedObjectKey)}
                    >
                      <RotateCcw size={12} />
                      {t("Reset")}
                    </Button>
                  </Tooltip>
                </div>
                <p className="outfit-color-note">
                  <Palette size={12} />
                  {t("These colors affect previews only. DAT and SPR data are not changed.")}
                </p>
              </Section>
            )}
            <Section title="Dimensions">
              <div className="property-grid">
                <PropertyRow label={t("Width")}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={object.dimensions.width}
                    ariaLabel={t("Width")}
                    onCommit={(width) => patchDimension("width", width)}
                  />
                </PropertyRow>
                <PropertyRow label={t("Height")}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={object.dimensions.height}
                    ariaLabel={t("Height")}
                    onCommit={(height) => patchDimension("height", height)}
                  />
                </PropertyRow>
                <PropertyRow label={t("Layers")}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={object.dimensions.layers}
                    ariaLabel={t("Layers")}
                    onCommit={(layers) => patchDimension("layers", layers)}
                  />
                </PropertyRow>
                <PropertyRow label={t(capabilities.patternLabels.x)}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={object.dimensions.patterns}
                    ariaLabel={t(capabilities.patternLabels.x)}
                    onCommit={(patterns) => patchDimension("patterns", patterns)}
                  />
                </PropertyRow>
                <PropertyRow label={t(capabilities.patternLabels.y)}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={patternY}
                    ariaLabel={t(capabilities.patternLabels.y)}
                    onCommit={(value) => patchPattern("patternY", value)}
                  />
                </PropertyRow>
                <PropertyRow label={t(capabilities.patternLabels.z)}>
                  <NumberInput
                    min={1}
                    max={255}
                    value={patternZ}
                    ariaLabel={t(capabilities.patternLabels.z)}
                    onCommit={(value) => patchPattern("patternZ", value)}
                  />
                </PropertyRow>
              </div>
            </Section>
            <Section
              title="Animation"
              suffix={object.frameGroups.length > 1 ? t(animationGroup?.name ?? "") : undefined}
            >
              <PropertyRow label={t("Frames")}>
                <span className="property-readout">{animationFrames.length}</span>
              </PropertyRow>
              {animationFrames.length > 1 && (
                <>
                  <PropertyRow label={t("Duration")}>
                    <NumberInput
                      min={animationFrames.length}
                      max={60_000 * animationFrames.length}
                      value={totalDuration}
                      step={10}
                      shiftStep={100}
                      suffix="ms"
                      ariaLabel={t("Total animation duration in milliseconds")}
                      onCommit={(total) => spreadFrameDuration(total / animationFrames.length)}
                    />
                  </PropertyRow>
                  <PropertyRow label={t("FPS")}>
                    <NumberInput
                      min={1}
                      max={1000}
                      value={framesPerSecond}
                      ariaLabel={t("Frames per second")}
                      onCommit={(fps) => spreadFrameDuration(1000 / fps)}
                    />
                  </PropertyRow>
                  {!uniformDuration && (
                    <p className="flag-note">
                      {t(
                        "Frames of this group have different durations, so FPS is the average. Editing FPS or Duration gives every frame the same duration.",
                      )}
                    </p>
                  )}
                </>
              )}
              <PropertyRow label={t("Mode")}>
                <Select
                  value={object.animation.mode}
                  onValueChange={(mode) =>
                    patch(
                      (entry) => ({
                        ...entry,
                        animation: {
                          ...entry.animation,
                          mode: mode as ThingObject["animation"]["mode"],
                        },
                      }),
                      changed(t("Animation mode")),
                    )
                  }
                  options={["Asynchronous", "Synchronous", "Random"].map((value) => ({
                    value,
                    label: t(value),
                  }))}
                  ariaLabel={t("Animation mode")}
                />
              </PropertyRow>
              <PropertyRow label={t("Loop")}>
                <Switch
                  checked={object.animation.loop}
                  onCheckedChange={(loop) =>
                    patch(
                      (entry) => ({
                        ...entry,
                        animation: { ...entry.animation, loop },
                        frameGroups: entry.frameGroups.map((group) => ({ ...group, loop })),
                      }),
                      changed(t("Loop")),
                    )
                  }
                />
              </PropertyRow>
              {animationFrames.length > 1 && (
                // Not a PropertyRow: the row is a <label>, and a label wrapping the play
                // button would make the word "Preview" start and stop the animation.
                <div className="animation-preview-block">
                  <span>{t("Preview")}</span>
                  <AnimationPreview
                    key={`${selectedObjectKey}:${animationGroupIndex}`}
                    object={object}
                    groupIndex={animationGroupIndex}
                  />
                </div>
              )}
            </Section>
            <Section title="Position">
              <div className={`property-grid ${showsElevation ? "triple" : ""}`}>
                <PropertyRow label={t("X offset")}>
                  <NumberInput
                    min={-32768}
                    max={32767}
                    value={object.position.x}
                    ariaLabel={t("X offset")}
                    onCommit={(x) =>
                      patch(
                        (entry) => ({ ...entry, position: { ...entry.position, x } }),
                        changed(t("X offset")),
                      )
                    }
                  />
                </PropertyRow>
                <PropertyRow label={t("Y offset")}>
                  <NumberInput
                    min={-32768}
                    max={32767}
                    value={object.position.y}
                    ariaLabel={t("Y offset")}
                    onCommit={(y) =>
                      patch(
                        (entry) => ({ ...entry, position: { ...entry.position, y } }),
                        changed(t("Y offset")),
                      )
                    }
                  />
                </PropertyRow>
                {showsElevation && (
                  <PropertyRow label={t("Elevation")}>
                    <NumberInput
                      min={0}
                      max={255}
                      value={object.position.elevation}
                      ariaLabel={t("Elevation")}
                      onCommit={(elevation) =>
                        patch(
                          (entry) => ({ ...entry, position: { ...entry.position, elevation } }),
                          changed(t("Elevation")),
                        )
                      }
                    />
                  </PropertyRow>
                )}
              </div>
            </Section>
            <Section title={showsMinimap || showsGroundSpeed ? "Lighting & Minimap" : "Lighting"}>
              <div className="property-grid">
                <PropertyRow label={t("Light level")}>
                  <NumberInput
                    min={0}
                    max={255}
                    value={object.gameplay.lightLevel}
                    ariaLabel={t("Light level")}
                    onCommit={(lightLevel) =>
                      patch(
                        (entry) => ({ ...entry, gameplay: { ...entry.gameplay, lightLevel } }),
                        changed(t("Light level")),
                      )
                    }
                  />
                </PropertyRow>
                <PropertyRow label={t("Light color")}>
                  <div className="color-input">
                    <i
                      style={{
                        background: object.gameplay.lightColor ? "#f0a438" : "var(--c-24282e)",
                      }}
                    />
                    <NumberInput
                      min={0}
                      max={65535}
                      value={object.gameplay.lightColor}
                      ariaLabel={t("Light color")}
                      onCommit={(lightColor) =>
                        patch(
                          (entry) => ({
                            ...entry,
                            gameplay: { ...entry.gameplay, lightColor },
                          }),
                          changed(t("Light color")),
                        )
                      }
                    />
                  </div>
                </PropertyRow>
                {showsMinimap && (
                  <PropertyRow label={t("Minimap")}>
                    <NumberInput
                      min={0}
                      max={65535}
                      value={object.gameplay.minimapColor}
                      ariaLabel={t("Minimap color")}
                      onCommit={(minimapColor) =>
                        patch(
                          (entry) => ({
                            ...entry,
                            gameplay: { ...entry.gameplay, minimapColor },
                          }),
                          changed(t("Minimap color")),
                        )
                      }
                    />
                  </PropertyRow>
                )}
                {showsGroundSpeed && (
                  <PropertyRow label={t("Ground speed")}>
                    <NumberInput
                      min={0}
                      max={65535}
                      value={object.gameplay.groundSpeed}
                      ariaLabel={t("Ground speed")}
                      onCommit={(groundSpeed) =>
                        patch(
                          (entry) => ({
                            ...entry,
                            gameplay: { ...entry.gameplay, groundSpeed },
                          }),
                          changed(t("Ground speed")),
                        )
                      }
                    />
                  </PropertyRow>
                )}
              </div>
            </Section>
          </Tabs.Content>
          {showsServerTab && (
            <Tabs.Content value="server">
              <Section
                title="Server attributes"
                suffix={t("{count} entries", { count: object.attributes.length })}
              >
                <div className="attribute-header">
                  <span>{t("Attribute")}</span>
                  <span>{t("Value")}</span>
                </div>
                {object.attributes.map((attribute, index) => (
                  <div className="attribute-row" key={`${attribute.key}-${index}`}>
                    <Input
                      value={attribute.key}
                      onChange={(event) =>
                        patch(
                          (entry) => ({
                            ...entry,
                            attributes: entry.attributes.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, key: event.target.value } : item,
                            ),
                          }),
                          changed(t("Attribute")),
                        )
                      }
                    />
                    <Input
                      value={attribute.value}
                      onChange={(event) =>
                        patch(
                          (entry) => ({
                            ...entry,
                            attributes: entry.attributes.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, value: event.target.value } : item,
                            ),
                          }),
                          changed(t("Value")),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        patch(
                          (entry) => ({
                            ...entry,
                            attributes: entry.attributes.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }),
                          tr("Removed attribute"),
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    patch(
                      (entry) => ({
                        ...entry,
                        attributes: [...entry.attributes, { key: "", value: "" }],
                      }),
                      tr("Added attribute"),
                    )
                  }
                >
                  <Plus size={12} />
                  {t("Add attribute")}
                </Button>
              </Section>
            </Tabs.Content>
          )}
          <Tabs.Content value="flags">
            {flagGroups.map((group) => {
              const groupFlags = offeredFlags.filter((definition) => definition.group === group.id);
              if (groupFlags.length === 0) return null;
              return (
                <Section
                  key={group.id}
                  title={group.title}
                  suffix={`${groupFlags.filter((definition) => object.flags[definition.name] === true).length}/${groupFlags.length}`}
                >
                  {groupFlags.map((definition) => (
                    <FlagRow
                      key={definition.name}
                      name={definition.name}
                      description={t(definition.description)}
                      checked={object.flags[definition.name] === true}
                      onCheckedChange={(checked) => setFlag(definition.name, checked)}
                    />
                  ))}
                </Section>
              );
            })}
            {carriedFlags.length > 0 && (
              <Section
                title="Not offered here"
                suffix={t("{count} carried", { count: carriedFlags.length })}
              >
                <p className="flag-note">
                  {t(
                    "These attributes are on the object but not part of what {kind} carry in client {version}. They can be cleared, not added.",
                    { kind: t(`${object.kind}s`).toLowerCase(), version: clientVersion ?? "10.98" },
                  )}
                </p>
                {carriedFlags.map(({ name, badge }) => (
                  <FlagRow
                    key={name}
                    name={name}
                    description={t(
                      flagDefinition(name)?.description ??
                        "This attribute is not in the DAT attribute table; saving the DAT will refuse it.",
                    )}
                    badge={badge}
                    checked
                    onCheckedChange={(checked) => setFlag(name, checked)}
                  />
                ))}
              </Section>
            )}
          </Tabs.Content>
        </ScrollArea>
      </Tabs.Root>
    </aside>
  );
}
