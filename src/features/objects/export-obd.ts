import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { tr } from "../../lib/i18n";
import { flushCoreMutations } from "../../stores/history-store";
import type { ObjectKind } from "../../types/editor";

export async function exportObdBatch(keys: string[]) {
  const directory = await open({ directory: true, title: tr("Export objects as OBD to folder") });
  if (typeof directory !== "string") return null;
  const identities = keys.map((key) => {
    const [kind, id] = key.split(":");
    return { kind: kind as ObjectKind, id: Number(id) };
  });
  await flushCoreMutations();
  const count = await invoke<number>("export_objects", { request: { identities, directory } });
  return { count, directory };
}
