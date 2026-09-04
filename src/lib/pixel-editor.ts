/**
 * Raster primitives for the canvas pixel editor. Everything here works on a plain
 * RGBA buffer and never touches the DOM or the store, so a tool is a pure function
 * of the frame it edits plus the pointer that drove it — which is what makes the
 * same code answer for the live preview of a shape and for the stroke that is
 * finally committed to the SPR.
 */

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Straight RGBA, 0-255 per channel. Alpha zero is the transparent sprite pixel. */
export type Rgba = [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** A per-pixel stencil: 1 where a tool may write. Absent means "the whole frame". */
export type PixelMask = Uint8Array;

export function createRaster(width: number, height: number): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneRaster(raster: RasterImage): RasterImage {
  return {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
}

export function rasterFromNative(image: { width: number; height: number; rgba: number[] }) {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.rgba),
  };
}

/** The IPC shape the Rust side reads a `SpriteImage` from. */
export function rasterToNative(raster: RasterImage) {
  return {
    width: raster.width,
    height: raster.height,
    rgba: Array.from(raster.data),
  };
}

export function inside(raster: RasterImage, x: number, y: number) {
  return x >= 0 && y >= 0 && x < raster.width && y < raster.height;
}

export function readPixel(raster: RasterImage, x: number, y: number): Rgba {
  if (!inside(raster, x, y)) return TRANSPARENT;
  const offset = (y * raster.width + x) * 4;
  return [
    raster.data[offset],
    raster.data[offset + 1],
    raster.data[offset + 2],
    raster.data[offset + 3],
  ];
}

export function writePixel(
  raster: RasterImage,
  x: number,
  y: number,
  color: Rgba,
  mask?: PixelMask | null,
) {
  if (!inside(raster, x, y)) return;
  const index = y * raster.width + x;
  if (mask && !mask[index]) return;
  const offset = index * 4;
  raster.data[offset] = color[0];
  raster.data[offset + 1] = color[1];
  raster.data[offset + 2] = color[2];
  raster.data[offset + 3] = color[3];
}

/** Square nib, anchored so an odd size centres on the pointer and an even one sits under it. */
export function drawBrush(
  raster: RasterImage,
  x: number,
  y: number,
  size: number,
  color: Rgba,
  mask?: PixelMask | null,
) {
  const span = Math.max(1, Math.round(size));
  const start = -Math.floor((span - 1) / 2);
  for (let dy = 0; dy < span; dy += 1)
    for (let dx = 0; dx < span; dx += 1)
      writePixel(raster, x + start + dx, y + start + dy, color, mask);
}

/**
 * Bresenham between two pointer samples. A drag reports positions, not pixels, so
 * without this a fast stroke lands as a dotted line at whatever rate the mouse
 * reported.
 */
export function strokeLine(
  raster: RasterImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  color: Rgba,
  mask?: PixelMask | null,
) {
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    drawBrush(raster, x, y, size, color, mask);
    if (x === to.x && y === to.y) return;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

export function drawRectangle(
  raster: RasterImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  color: Rgba,
  filled: boolean,
  mask?: PixelMask | null,
) {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  if (filled) {
    for (let y = top; y <= bottom; y += 1)
      for (let x = left; x <= right; x += 1) writePixel(raster, x, y, color, mask);
    return;
  }
  strokeLine(raster, { x: left, y: top }, { x: right, y: top }, size, color, mask);
  strokeLine(raster, { x: right, y: top }, { x: right, y: bottom }, size, color, mask);
  strokeLine(raster, { x: right, y: bottom }, { x: left, y: bottom }, size, color, mask);
  strokeLine(raster, { x: left, y: bottom }, { x: left, y: top }, size, color, mask);
}

/**
 * Midpoint ellipse inscribed in the dragged box. Sprites are small enough that the
 * four-way symmetry matters: deriving one octant and mirroring it is what keeps a
 * 7-pixel circle from coming out lopsided.
 */
export function drawEllipse(
  raster: RasterImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  color: Rgba,
  filled: boolean,
  mask?: PixelMask | null,
) {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const radiusX = (right - left) / 2;
  const radiusY = (bottom - top) / 2;
  const centreX = left + radiusX;
  const centreY = top + radiusY;
  if (radiusX <= 0 || radiusY <= 0) {
    strokeLine(raster, { x: left, y: top }, { x: right, y: bottom }, size, color, mask);
    return;
  }
  const plot = (x: number, y: number) => {
    if (filled) {
      const mirroredX = Math.round(centreX * 2) - x;
      const start = Math.min(x, mirroredX);
      const end = Math.max(x, mirroredX);
      for (let column = start; column <= end; column += 1)
        writePixel(raster, column, y, color, mask);
    } else {
      drawBrush(raster, x, y, size, color, mask);
    }
  };
  for (let y = top; y <= bottom; y += 1) {
    const normalized = (y + 0.5 - centreY - 0.5) / radiusY;
    const span = 1 - normalized * normalized;
    if (span < 0) continue;
    const half = radiusX * Math.sqrt(span);
    const start = Math.round(centreX - half);
    const end = Math.round(centreX + half);
    if (filled || y === top || y === bottom) {
      for (let x = start; x <= end; x += 1) plot(x, y);
    } else {
      plot(start, y);
      plot(end, y);
    }
  }
}

export function colorsMatch(a: Rgba, b: Rgba, tolerance: number) {
  // Two fully transparent pixels are the same pixel whatever their dead RGB says —
  // a cleared sprite keeps the colour of what used to be there in those bytes.
  if (a[3] === 0 && b[3] === 0) return true;
  if (tolerance <= 0) return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

/** Four-way contiguous fill, clipped to `mask` when a selection is active. */
export function floodFill(
  raster: RasterImage,
  origin: { x: number; y: number },
  color: Rgba,
  tolerance: number,
  mask?: PixelMask | null,
) {
  if (!inside(raster, origin.x, origin.y)) return;
  const target = readPixel(raster, origin.x, origin.y);
  if (colorsMatch(target, color, 0)) return;
  const seen = new Uint8Array(raster.width * raster.height);
  const queue = [origin.y * raster.width + origin.x];
  while (queue.length) {
    const index = queue.pop() as number;
    if (seen[index]) continue;
    seen[index] = 1;
    const x = index % raster.width;
    const y = Math.floor(index / raster.width);
    if (mask && !mask[index]) continue;
    if (!colorsMatch(readPixel(raster, x, y), target, tolerance)) continue;
    writePixel(raster, x, y, color, mask);
    if (x > 0) queue.push(index - 1);
    if (x < raster.width - 1) queue.push(index + 1);
    if (y > 0) queue.push(index - raster.width);
    if (y < raster.height - 1) queue.push(index + raster.width);
  }
}

/** Every pixel of the frame that matches `target`, contiguous or not. */
export function replaceColor(
  raster: RasterImage,
  target: Rgba,
  color: Rgba,
  tolerance: number,
  mask?: PixelMask | null,
) {
  for (let y = 0; y < raster.height; y += 1)
    for (let x = 0; x < raster.width; x += 1)
      if (colorsMatch(readPixel(raster, x, y), target, tolerance))
        writePixel(raster, x, y, color, mask);
}

export function rectangleMask(
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): PixelMask {
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(width - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(height - 1, Math.max(from.y, to.y));
  for (let y = top; y <= bottom; y += 1)
    for (let x = left; x <= right; x += 1) mask[y * width + x] = 1;
  return mask;
}

/** Contiguous region of the colour under the pointer — the magic wand. */
export function wandMask(
  raster: RasterImage,
  origin: { x: number; y: number },
  tolerance: number,
): PixelMask {
  const mask = new Uint8Array(raster.width * raster.height);
  if (!inside(raster, origin.x, origin.y)) return mask;
  const target = readPixel(raster, origin.x, origin.y);
  const queue = [origin.y * raster.width + origin.x];
  while (queue.length) {
    const index = queue.pop() as number;
    if (mask[index]) continue;
    const x = index % raster.width;
    const y = Math.floor(index / raster.width);
    if (!colorsMatch(readPixel(raster, x, y), target, tolerance)) continue;
    mask[index] = 1;
    if (x > 0) queue.push(index - 1);
    if (x < raster.width - 1) queue.push(index + 1);
    if (y > 0) queue.push(index - raster.width);
    if (y < raster.height - 1) queue.push(index + raster.width);
  }
  return mask;
}

export function fullMask(width: number, height: number): PixelMask {
  return new Uint8Array(width * height).fill(1);
}

export function maskIsEmpty(mask: PixelMask) {
  return !mask.some((value) => value === 1);
}

export function maskBounds(mask: PixelMask, width: number) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (right < 0) return null;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * A selection lifted off the frame. It carries its own stencil so a wand selection
 * keeps its shape while it is dragged, instead of turning into its bounding box.
 */
export interface FloatingPixels {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  mask: PixelMask;
}

export function extractSelection(raster: RasterImage, mask: PixelMask): FloatingPixels | null {
  const bounds = maskBounds(mask, raster.width);
  if (!bounds) return null;
  const floating: FloatingPixels = {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
    data: new Uint8ClampedArray(bounds.width * bounds.height * 4),
    mask: new Uint8Array(bounds.width * bounds.height),
  };
  for (let y = 0; y < bounds.height; y += 1)
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceIndex = (bounds.top + y) * raster.width + bounds.left + x;
      if (!mask[sourceIndex]) continue;
      floating.mask[y * bounds.width + x] = 1;
      floating.data.set(
        raster.data.subarray(sourceIndex * 4, sourceIndex * 4 + 4),
        (y * bounds.width + x) * 4,
      );
    }
  return floating;
}

export function clearMask(raster: RasterImage, mask: PixelMask) {
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    raster.data.fill(0, index * 4, index * 4 + 4);
  }
}

/**
 * Lays a floating selection down. Only pixels the selection actually holds are
 * written: dropping the transparent corners of a wand selection would punch a hole
 * in whatever it was moved over.
 */
export function stampFloating(raster: RasterImage, floating: FloatingPixels) {
  for (let y = 0; y < floating.height; y += 1)
    for (let x = 0; x < floating.width; x += 1) {
      const index = y * floating.width + x;
      if (!floating.mask[index] || floating.data[index * 4 + 3] === 0) continue;
      writePixel(raster, floating.x + x, floating.y + y, [
        floating.data[index * 4],
        floating.data[index * 4 + 1],
        floating.data[index * 4 + 2],
        floating.data[index * 4 + 3],
      ]);
    }
}

/** Where a floating selection sits once it is stamped, as a stencil over the frame. */
export function floatingMask(floating: FloatingPixels, width: number, height: number): PixelMask {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < floating.height; y += 1)
    for (let x = 0; x < floating.width; x += 1) {
      if (!floating.mask[y * floating.width + x]) continue;
      const targetX = floating.x + x;
      const targetY = floating.y + y;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      mask[targetY * width + targetX] = 1;
    }
  return mask;
}

export function flipHorizontal(raster: RasterImage) {
  const output = createRaster(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1)
    for (let x = 0; x < raster.width; x += 1) {
      const source = (y * raster.width + x) * 4;
      const target = (y * raster.width + (raster.width - 1 - x)) * 4;
      output.data.set(raster.data.subarray(source, source + 4), target);
    }
  return output;
}

export function flipVertical(raster: RasterImage) {
  const output = createRaster(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    const source = y * raster.width * 4;
    output.data.set(
      raster.data.subarray(source, source + raster.width * 4),
      (raster.height - 1 - y) * raster.width * 4,
    );
  }
  return output;
}

/**
 * Quarter turn clockwise. A frame that is not square would land outside the tile
 * grid it has to be written back into, so it is refused rather than cropped.
 */
export function rotateQuarterTurn(raster: RasterImage): RasterImage | null {
  if (raster.width !== raster.height) return null;
  const output = createRaster(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1)
    for (let x = 0; x < raster.width; x += 1) {
      const source = (y * raster.width + x) * 4;
      const target = (x * raster.width + (raster.height - 1 - y)) * 4;
      output.data.set(raster.data.subarray(source, source + 4), target);
    }
  return output;
}

export function shiftRaster(raster: RasterImage, dx: number, dy: number) {
  const output = createRaster(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1)
    for (let x = 0; x < raster.width; x += 1) {
      const targetX = x + dx;
      const targetY = y + dy;
      if (targetX < 0 || targetY < 0 || targetX >= raster.width || targetY >= raster.height)
        continue;
      const source = (y * raster.width + x) * 4;
      output.data.set(raster.data.subarray(source, source + 4), (targetY * raster.width + targetX) * 4);
    }
  return output;
}

/**
 * The colours the frame already uses, most-used first. Painting from here is what
 * keeps an edit inside the palette the artwork was drawn with.
 */
export function rasterPalette(raster: RasterImage, limit = 64) {
  const counts = new Map<string, { color: Rgba; count: number }>();
  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const offset = index * 4;
    if (raster.data[offset + 3] === 0) continue;
    const color: Rgba = [
      raster.data[offset],
      raster.data[offset + 1],
      raster.data[offset + 2],
      raster.data[offset + 3],
    ];
    const key = color.join(",");
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { color, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.color);
}

export function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : value;
  return [
    Number.parseInt(expanded.slice(0, 2), 16) || 0,
    Number.parseInt(expanded.slice(2, 4), 16) || 0,
    Number.parseInt(expanded.slice(4, 6), 16) || 0,
    alpha,
  ];
}

export function rgbaToHex(color: Rgba) {
  return `#${color
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function rastersDiffer(a: RasterImage, b: RasterImage) {
  if (a.width !== b.width || a.height !== b.height) return true;
  for (let index = 0; index < a.data.length; index += 1) if (a.data[index] !== b.data[index]) return true;
  return false;
}
