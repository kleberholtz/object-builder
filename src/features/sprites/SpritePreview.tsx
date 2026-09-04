import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SpritePreviewProps { spriteId: number; frame?: number; size?: number; className?: string }
interface NativeSprite { width: number; height: number; rgba: number[] }

export async function paintSprite(context: CanvasRenderingContext2D, spriteId: number) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (!("__TAURI_INTERNALS__" in window) || spriteId === 0) return;
  try {
    const sprite = await invoke<NativeSprite>("get_sprite", { id: spriteId });
    context.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), sprite.width, sprite.height), 0, 0);
  } catch {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  }
}

export function SpritePreview({ spriteId, size = 44, className = "" }: SpritePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const context = ref.current?.getContext("2d"); if (context) void paintSprite(context, spriteId); }, [spriteId]);
  return <canvas ref={ref} width={32} height={32} className={`sprite-preview ${className}`} style={{ width: size, height: size }} />;
}
