import { ChevronDown, Copy, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Switch } from "../../components/ui/switch";
import { Tabs } from "../../components/ui/tabs";
import { updateObject } from "../../stores/history-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import type { ThingObject } from "../../types/editor";
import { objectKey } from "../../lib/utils";

function Section({ title, children, suffix }: { title: string; children: ReactNode; suffix?: string }) {
  return <section className="property-section"><div className="section-title"><span><ChevronDown size={12} />{title}</span>{suffix && <small>{suffix}</small>}</div><div className="section-content">{children}</div></section>;
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return <label className="property-row"><span>{label}</span><div>{children}</div></label>;
}

function NumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <Input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />;
}

export function Inspector() {
  const objects = useProjectStore((state) => state.objects);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const object = objects.find((entry) => objectKey(entry) === selectedKeys[0]);
  const [tab, setTab] = useState("object");
  if (!object) return <aside className="inspector panel-border-left" />;

  const patch = (transform: (entry: ThingObject) => ThingObject) => updateObject(object, transform);
  return (
    <aside className="inspector panel-border-left">
      <div className="panel-heading"><span>Inspector</span><Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button></div>
      {selectedKeys.length > 1 && <div className="bulk-notice">Editing {selectedKeys.length} selected objects</div>}
      <Tabs.Root value={tab} onValueChange={setTab} className="inspector-tabs">
        <Tabs.List className="inspector-tab-list">
          <Tabs.Trigger value="object">Object</Tabs.Trigger><Tabs.Trigger value="server">Server</Tabs.Trigger><Tabs.Trigger value="flags">Flags</Tabs.Trigger>
        </Tabs.List>
        <ScrollArea className="inspector-scroll">
          <Tabs.Content value="object">
            <Section title="General">
              <PropertyRow label="ID"><div className="locked-input"><Input value={object.id} readOnly /><span>locked</span></div></PropertyRow>
              <PropertyRow label="Type"><select value={object.kind} onChange={(event) => patch((entry) => ({ ...entry, kind: event.target.value as ThingObject["kind"] }))}><option>Item</option><option>Outfit</option><option>Effect</option><option>Missile</option></select></PropertyRow>
              <PropertyRow label="Name"><Input value={object.name} onChange={(event) => patch((entry) => ({ ...entry, name: event.target.value }))} /></PropertyRow>
              <PropertyRow label="Sprite ID"><Input value={object.spriteId} readOnly /></PropertyRow>
            </Section>
            <Section title="Dimensions">
              <div className="property-grid">
                <PropertyRow label="Width"><NumberInput value={object.dimensions.width} onChange={(width) => patch((entry) => ({ ...entry, dimensions: { ...entry.dimensions, width } }))} /></PropertyRow>
                <PropertyRow label="Height"><NumberInput value={object.dimensions.height} onChange={(height) => patch((entry) => ({ ...entry, dimensions: { ...entry.dimensions, height } }))} /></PropertyRow>
                <PropertyRow label="Layers"><NumberInput value={object.dimensions.layers} onChange={(layers) => patch((entry) => ({ ...entry, dimensions: { ...entry.dimensions, layers } }))} /></PropertyRow>
                <PropertyRow label="Patterns"><NumberInput value={object.dimensions.patterns} onChange={(patterns) => patch((entry) => ({ ...entry, dimensions: { ...entry.dimensions, patterns } }))} /></PropertyRow>
              </div>
            </Section>
            <Section title="Animation" suffix={`${object.frameGroups.reduce((sum, group) => sum + group.frames.length, 0)} frames`}>
              <PropertyRow label="Mode"><select value={object.animation.mode} onChange={(event) => patch((entry) => ({ ...entry, animation: { ...entry.animation, mode: event.target.value as ThingObject["animation"]["mode"] } }))}><option>Asynchronous</option><option>Synchronous</option><option>Random</option></select></PropertyRow>
              <PropertyRow label="Loop"><Switch checked={object.animation.loop} onCheckedChange={(loop) => patch((entry) => ({ ...entry, animation: { ...entry.animation, loop } }))} /></PropertyRow>
            </Section>
            <Section title="Position">
              <div className="property-grid triple">
                <PropertyRow label="X offset"><NumberInput value={object.position.x} onChange={(x) => patch((entry) => ({ ...entry, position: { ...entry.position, x } }))} /></PropertyRow>
                <PropertyRow label="Y offset"><NumberInput value={object.position.y} onChange={(y) => patch((entry) => ({ ...entry, position: { ...entry.position, y } }))} /></PropertyRow>
                <PropertyRow label="Elevation"><NumberInput value={object.position.elevation} onChange={(elevation) => patch((entry) => ({ ...entry, position: { ...entry.position, elevation } }))} /></PropertyRow>
              </div>
            </Section>
            <Section title="Lighting & Minimap">
              <div className="property-grid">
                <PropertyRow label="Light level"><NumberInput value={object.gameplay.lightLevel} onChange={(lightLevel) => patch((entry) => ({ ...entry, gameplay: { ...entry.gameplay, lightLevel } }))} /></PropertyRow>
                <PropertyRow label="Light color"><div className="color-input"><i style={{ background: object.gameplay.lightColor ? "#f0a438" : "#262b32" }} /><NumberInput value={object.gameplay.lightColor} onChange={(lightColor) => patch((entry) => ({ ...entry, gameplay: { ...entry.gameplay, lightColor } }))} /></div></PropertyRow>
                <PropertyRow label="Minimap"><NumberInput value={object.gameplay.minimapColor} onChange={(minimapColor) => patch((entry) => ({ ...entry, gameplay: { ...entry.gameplay, minimapColor } }))} /></PropertyRow>
                <PropertyRow label="Ground speed"><NumberInput value={object.gameplay.groundSpeed} onChange={(groundSpeed) => patch((entry) => ({ ...entry, gameplay: { ...entry.gameplay, groundSpeed } }))} /></PropertyRow>
              </div>
            </Section>
          </Tabs.Content>
          <Tabs.Content value="server">
            <Section title="Server attributes" suffix={`${object.attributes.length} entries`}>
              <div className="attribute-header"><span>Attribute</span><span>Value</span></div>
              {object.attributes.map((attribute, index) => <div className="attribute-row" key={`${attribute.key}-${index}`}><Input value={attribute.key} onChange={(event) => patch((entry) => ({ ...entry, attributes: entry.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) }))} /><Input value={attribute.value} onChange={(event) => patch((entry) => ({ ...entry, attributes: entry.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} /><Button variant="ghost" size="icon" onClick={() => patch((entry) => ({ ...entry, attributes: entry.attributes.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={12} /></Button></div>)}
              <Button variant="outline" size="sm" className="w-full" onClick={() => patch((entry) => ({ ...entry, attributes: [...entry.attributes, { key: "attribute", value: "0" }] }))}><Plus size={12} />Add attribute</Button>
              <div className="attribute-actions"><Button variant="ghost" size="sm"><Copy size={12} />Copy all</Button><Button variant="ghost" size="sm"><RotateCcw size={12} />Reset</Button></div>
            </Section>
          </Tabs.Content>
          <Tabs.Content value="flags">
            <Section title="Object flags" suffix={`${Object.values(object.flags).filter(Boolean).length} enabled`}>
              {Object.entries(object.flags).map(([flag, enabled]) => <label className="flag-row" key={flag}><span>{flag}</span><Switch checked={enabled} onCheckedChange={(checked) => patch((entry) => ({ ...entry, flags: { ...entry.flags, [flag]: checked } }))} /></label>)}
            </Section>
          </Tabs.Content>
        </ScrollArea>
      </Tabs.Root>
    </aside>
  );
}
