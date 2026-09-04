import { create } from "zustand";
import { useSettingsStore } from "./settings-store";

export type LogLevel = "ERROR" | "WARNING" | "INFO" | "SPRITE";
export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: string;
  details?: string;
  source: "Rust" | "UI";
}
interface LogState {
  entries: LogEntry[];
  expanded: boolean;
  maxEntries: number;
  add: (entry: Omit<LogEntry, "id">) => void;
  clear: () => void;
  setExpanded: (expanded: boolean) => void;
  setMaxEntries: (maximum: number) => void;
}
let nextLogId = 1;
export const useLogStore = create<LogState>((set) => ({
  entries: [],
  expanded: localStorage.getItem("object-builder-logs-expanded") === "true",
  maxEntries: useSettingsStore.getState().logRetention,
  add: (entry) =>
    set((state) => ({
      entries: [...state.entries, { ...entry, id: nextLogId++ }].slice(-state.maxEntries),
    })),
  clear: () => set({ entries: [] }),
  setExpanded: (expanded) => {
    localStorage.setItem("object-builder-logs-expanded", String(expanded));
    set({ expanded });
  },
  setMaxEntries: (value) =>
    set((state) => {
      const maxEntries = Math.max(100, Math.min(5000, value));
      return { maxEntries, entries: state.entries.slice(-maxEntries) };
    }),
}));

export function writeLog(level: LogLevel, message: string, context?: string, details?: string) {
  useLogStore
    .getState()
    .add({ timestamp: Date.now(), level, message, context, details, source: "UI" });
}
