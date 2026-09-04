import { invoke } from "@tauri-apps/api/core";

export interface NativeSprite {
  width: number;
  height: number;
  rgba: number[];
}

// A 32x32 sprite crosses the IPC bridge as ~4096 JSON numbers. Scrolling a list
// back over rows it already showed, or a page where the same sprite answers for
// several objects, asked the bridge for those bytes again every time — which is
// what made a fast scroll look like a list that never finishes loading. Ids are
// stable for as long as the bytes behind them are, so every flow that can rewrite
// a sprite clears this table (see `invalidateSpriteCache`).
const CACHE_LIMIT = 3072;
const cache = new Map<number, NativeSprite>();
const inFlight = new Map<number, Promise<NativeSprite>>();
let epoch = 0;

/**
 * Drops every cached sprite. Call it from anything that can change the bytes a
 * sprite id points at: loading a workspace, importing a PNG, optimizing, undo and
 * redo. A request already in the air is not cancelled — it is only barred from
 * populating the new generation's cache.
 */
export function invalidateSpriteCache() {
  epoch += 1;
  cache.clear();
  inFlight.clear();
}

/** Sprite bytes for `id`, from the cache when they are already known. */
export async function loadSprite(id: number): Promise<NativeSprite | null> {
  if (!("__TAURI_INTERNALS__" in window) || id === 0) return null;
  const cached = cache.get(id);
  if (cached) {
    // Map iterates in insertion order, so re-inserting is what makes the eviction
    // below drop the least recently *used* sprite instead of the oldest one.
    cache.delete(id);
    cache.set(id, cached);
    return cached;
  }
  const pending = inFlight.get(id);
  if (pending) return pending;
  const generation = epoch;
  const request = invoke<NativeSprite>("get_sprite", { id })
    .then((sprite) => {
      if (generation === epoch) {
        cache.set(id, sprite);
        if (cache.size > CACHE_LIMIT) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
      }
      return sprite;
    })
    .finally(() => {
      // Only clear our own entry: an invalidation may have replaced it already.
      if (inFlight.get(id) === request) inFlight.delete(id);
    });
  inFlight.set(id, request);
  return request;
}
