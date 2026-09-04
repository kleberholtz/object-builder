import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Tooltip } from "../../components/ui/tooltip";
import { useT } from "../../lib/i18n";
import { objectKey } from "../../lib/utils";
import { useEditorStore } from "../../stores/editor-store";
import { useSettingsStore } from "../../stores/settings-store";
import type { Frame, ThingObject } from "../../types/editor";
import { fetchObjectImage, outfitPreviewPatternIndex, type NativeSprite } from "./SpritePreview";

interface AnimationPreviewProps {
  object: ThingObject;
  groupIndex: number;
  /** Side of the square the frame is fitted into, in CSS pixels. */
  size?: number;
}

/** A stable empty array: a fresh `[]` per render would restart the playback timer. */
const NO_FRAMES: Frame[] = [];

/**
 * Plays one frame group at the durations the object actually carries, so the number typed
 * into Duration or FPS is the number being watched.
 *
 * Every frame is fetched once and kept as decoded pixels. Asking the core for the image on
 * each tick would put an IPC round trip inside the frame interval, which is exactly what
 * makes a 40 ms animation stutter.
 */
export function AnimationPreview({ object, groupIndex, size = 92 }: AnimationPreviewProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<Array<NativeSprite | null>>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => useSettingsStore.getState().autoPlayAnimation);
  const loopAnimation = useSettingsStore((state) => state.loopAnimation);
  const animationSpeed = useSettingsStore((state) => state.animationSpeed);
  const defaultOutfitColors = useSettingsStore((state) => state.defaultOutfitColors);
  const key = objectKey(object);
  const outfitColors =
    useEditorStore((state) => state.outfitPreviewColors[key]) ?? defaultOutfitColors;
  const previewDirection = useEditorStore((state) => state.outfitPreviewDirections[key] ?? 0);
  const previewAddon = useEditorStore((state) => state.outfitPreviewAddons[key] ?? 0);
  const previewWithBody = useEditorStore((state) => state.outfitPreviewWithBody[key] ?? true);
  const patternIndex = outfitPreviewPatternIndex(
    object,
    groupIndex,
    previewDirection,
    Math.max(0, previewAddon),
  );
  const frames = object.frameGroups[groupIndex]?.frames ?? NO_FRAMES;
  const frameCount = frames.length;
  // Modulo instead of a reset: selecting a shorter object mid-play must not draw a frame
  // that is no longer there, and clamping here needs no render of its own to settle.
  const current = frameCount ? index % frameCount : 0;

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      frames.map((_, frameIndex) =>
        fetchObjectImage(
          object,
          groupIndex,
          frameIndex,
          patternIndex,
          outfitColors,
          previewAddon !== 0 && previewWithBody,
          previewAddon === -1,
        ).catch(() => null),
      ),
      // A frame the core refuses stays null and is skipped, so one bad sprite does not
      // shift every frame after it onto the wrong index.
    ).then((loaded) => {
      if (!cancelled) setImages(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [frames, groupIndex, object, outfitColors, patternIndex, previewAddon, previewWithBody]);

  useEffect(() => {
    if (!playing || frameCount < 2) return;
    const timer = window.setTimeout(
      () => {
        // The last frame is still shown for its full duration before playback stops.
        if (current + 1 >= frameCount && !loopAnimation) {
          setPlaying(false);
          return;
        }
        setIndex(current + 1);
      },
      Math.max(1, frames[current].duration / animationSpeed),
    );
    return () => window.clearTimeout(timer);
  }, [animationSpeed, current, frameCount, frames, loopAnimation, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const image = images[current];
    if (!canvas || !context || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    context.clearRect(0, 0, image.width, image.height);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
      0,
      0,
    );
  }, [current, images]);

  // Every frame of a group shares the object's box, so the first image that loaded sizes the
  // stage: reading it from the current frame alone would resize the canvas on a failed frame.
  const natural = images[current] ?? images.find((image) => image !== null) ?? null;
  const fit = natural ? Math.min(size / natural.width, size / natural.height) : 1;
  // Whole-number scaling above 1:1 is what keeps a 32x32 sprite from landing between pixels.
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  return (
    <div className="animation-preview">
      <div className="animation-stage" style={{ height: size }}>
        {natural ? (
          <canvas
            ref={canvasRef}
            className="sprite-preview"
            style={{ width: natural.width * scale, height: natural.height * scale }}
          />
        ) : (
          <Skeleton className="animation-skeleton" />
        )}
      </div>
      <div className="animation-controls">
        <Tooltip
          label={playing ? t("Pause animation") : t("Play animation")}
          description={t(
            "Previews frames using each frame's configured duration and the playback speed from Settings.",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={frameCount < 2}
            onClick={() => {
              if (!playing && !loopAnimation && current + 1 >= frameCount) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </Button>
        </Tooltip>
        <span className="animation-counter">
          {String(current + 1).padStart(2, "0")} / {String(frameCount).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
