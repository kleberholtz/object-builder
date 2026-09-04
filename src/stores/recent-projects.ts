import type { ProjectInfo } from "../types/editor";

export interface ClientOpenRequest {
  directory: string;
  version: string;
  clientType: string;
  datFile: string;
  sprFile: string;
  otfiFile?: string;
  useOtfi: boolean;
  validateSprites: boolean;
  features: {
    extended: boolean;
    transparency: boolean;
    frameDurations: boolean;
    frameGroups: boolean;
  };
}

export interface RecentProject {
  id: string;
  kind: "client" | "manifest";
  name: string;
  path: string;
  version: string;
  lastOpened: number;
  objectCount: number;
  spriteCount: number;
  request?: ClientOpenRequest;
}

const storageKey = "object-builder-recent-projects-v1";
const changedEvent = "object-builder-recents-changed";

export function loadRecentProjects(): RecentProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function write(entries: RecentProject[]) {
  localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, 12)));
  window.dispatchEvent(new Event(changedEvent));
}

export function rememberProject(
  project: ProjectInfo,
  kind: RecentProject["kind"],
  path: string,
  request?: ClientOpenRequest,
) {
  const id = `${kind}:${path}`;
  const next: RecentProject = {
    id,
    kind,
    name: project.name,
    path,
    version: project.clientVersion,
    lastOpened: Date.now(),
    objectCount: project.objectCount,
    spriteCount: project.spriteCount,
    request,
  };
  write([next, ...loadRecentProjects().filter((entry) => entry.id !== id)]);
}

export function removeRecentProject(id: string) {
  write(loadRecentProjects().filter((entry) => entry.id !== id));
}

export function clearRecentProjects() {
  write([]);
}

export function updateRecentPath(entry: RecentProject, path: string) {
  const request = entry.request ? { ...entry.request, directory: path } : undefined;
  removeRecentProject(entry.id);
  write([
    { ...entry, id: `${entry.kind}:${path}`, path, request, lastOpened: Date.now() },
    ...loadRecentProjects(),
  ]);
}

export function subscribeRecentProjects(listener: () => void) {
  window.addEventListener(changedEvent, listener);
  return () => window.removeEventListener(changedEvent, listener);
}
