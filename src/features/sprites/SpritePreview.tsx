import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SpritePreviewProps { spriteId: number; frame?: number; size?: number; className?: string }

function pixel(context: CanvasRenderingContext2D, color: string, x: number, y: number, width = 1, height = 1) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

export function drawSprite(context: CanvasRenderingContext2D, spriteId: number, frame = 0) {
  context.clearRect(0, 0, 32, 32);
  const variant = spriteId % 9;
  if (spriteId >= 4784 && spriteId <= 4795) {
    // Animated stone brazier used by the selected demo object.
    const sway = frame % 3 - 1;
    pixel(context, "#312923", 7, 27, 19, 3); pixel(context, "#57463a", 9, 25, 15, 3);
    pixel(context, "#756052", 11, 22, 11, 4); pixel(context, "#392d28", 12, 18, 9, 5);
    pixel(context, "#6e5849", 9, 17, 15, 3); pixel(context, "#9a7960", 10, 16, 13, 2);
    pixel(context, "#592f24", 12, 11, 9, 6); pixel(context, "#c04a24", 13 + sway, 8, 7, 8);
    pixel(context, "#f07d28", 15 + sway, 5, 5, 10); pixel(context, "#ffc756", 16, 7, 3, 6);
    pixel(context, "#fff1a1", 17, 9, 1, 3); pixel(context, "#83351f", 12, 13, 2, 3);
    return;
  }
  const hue = (spriteId * 37) % 360;
  const dark = `hsl(${hue} 24% 21%)`, mid = `hsl(${hue} 38% 38%)`, light = `hsl(${hue} 55% 60%)`;
  if (variant <= 2) {
    pixel(context, dark, 5, 18, 23, 10); pixel(context, mid, 7, 14, 19, 12); pixel(context, light, 9, 15, 15, 3);
    pixel(context, "#171718", 9, 22, 15, 2); pixel(context, "#c79645", 15, 19, 3, 3);
  } else if (variant <= 5) {
    pixel(context, dark, 11, 7, 12, 22); pixel(context, mid, 9, 9, 13, 18); pixel(context, light, 11, 11, 8, 4);
    pixel(context, "#29252b", 13, 18, 6, 9); pixel(context, "#b69352", 18, 19, 2, 2);
  } else {
    pixel(context, dark, 7, 25, 19, 4); pixel(context, mid, 12, 10, 10, 16); pixel(context, light, 14, 7, 6, 18);
    pixel(context, "#7ce1eb", 15, 4, 4, 8); pixel(context, "#d9ffff", 16, 6, 2, 4);
  }
}

interface NativeSprite { width: number; height: number; rgba: number[] }

export async function paintSprite(context: CanvasRenderingContext2D, spriteId: number, frame = 0) {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const sprite = await invoke<NativeSprite>("get_sprite", { id: spriteId });
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), sprite.width, sprite.height), 0, 0);
      return;
    } catch { /* The demo workspace intentionally has no SPR source. */ }
  }
  drawSprite(context, spriteId, frame);
}

export function SpritePreview({ spriteId, frame = 0, size = 44, className = "" }: SpritePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) void paintSprite(context, spriteId, frame);
  }, [frame, spriteId]);
  return <canvas ref={ref} width={32} height={32} className={`sprite-preview ${className}`} style={{ width: size, height: size }} />;
}
