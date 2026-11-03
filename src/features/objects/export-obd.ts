import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { tr } from "../../lib/i18n";
import { flushCoreMutations } from "../../stores/history-store";
import type { ObjectKind } from "../../types/editor";

/**
 * Exports every selected object as its own OBD into a folder the user picks. The selection
 * is read from the keys, not from the loaded page, so objects selected on another page go too.
 * Resolves to null when the folder dialog is dismissed.
 */
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
