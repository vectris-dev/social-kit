/**
 * Fits an image to a frame it does not match: a heavily blurred, saturated copy
 * of the photo fills the frame, the untouched photo sits centred on top of it.
 *
 * The blur is done by downsampling to a tiny buffer and scaling it back up
 * rather than by `ctx.filter`. That is cheap at any output size, gives the soft
 * colour-field look, and needs no filter support. `ctx.filter` is then used, if
 * available, only to smooth the interpolation edges out of the result.
 */

export interface RenderOptions {
  /** Output size in px. */
  width: number;
  height: number;
  /** 0 (barely blurred) to 100 (pure colour field). */
  blur: number;
  /** Minimum padding around the photo, as a percentage of the frame's short edge. */
  margin: number;
}

export type Look = Pick<RenderOptions, "blur" | "margin">;

export const DEFAULT_LOOK: Look = {
  blur: 70,
  margin: 6,
};

/** The frame's grade. Punchy enough to read as a frame, dim enough to sit back. */
const SATURATION = 1.35;
const BRIGHTNESS = 0.9;

/** Long side of the downsample buffer at blur 0 and blur 100. */
const BUFFER_MAX = 220;
const BUFFER_MIN = 6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function canvasOf(w: number, h: number = w): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser would not give us a 2D canvas context.");
  return ctx;
}

function smooth(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

let filterSupport: boolean | undefined;

/** Safari only gained `ctx.filter` recently, so the softening pass is optional. */
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterSupport === undefined) {
    ctx.filter = "blur(1px)";
    filterSupport = ctx.filter === "blur(1px)";
    ctx.filter = "none";
  }
  return filterSupport;
}

/** Buffer long side for a blur setting, geometric so the slider feels even. */
function bufferSide(blur: number): number {
  const t = clamp(blur, 0, 100) / 100;
  return Math.max(BUFFER_MIN, Math.round(BUFFER_MAX * (BUFFER_MIN / BUFFER_MAX) ** t));
}

/** Centre crop of the source that fills `w × h` without distortion. */
function coverRect(
  sw: number,
  sh: number,
  w: number,
  h: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

/** Saturation and brightness, done on the tiny buffer so the cost is nil. */
function grade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sat = SATURATION;
  const bri = BRIGHTNESS;
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px[i] = clamp((lum + (r - lum) * sat) * bri, 0, 255);
    px[i + 1] = clamp((lum + (g - lum) * sat) * bri, 0, 255);
    px[i + 2] = clamp((lum + (b - lum) * sat) * bri, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
}

/** Step the buffer up to the frame by doubling, which interpolates more evenly. */
function upscale(buffer: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let current = buffer;
  while (current.width < w && current.height < h) {
    const next = canvasOf(Math.min(current.width * 2, w), Math.min(current.height * 2, h));
    const ctx = ctxOf(next);
    smooth(ctx);
    ctx.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return current;
}

/** Blur in place, overscanning so the edges do not fade to transparent. */
function soften(canvas: HTMLCanvasElement, radius: number): void {
  const ctx = ctxOf(canvas);
  if (radius < 0.5 || !supportsFilter(ctx)) return;
  const copy = canvasOf(canvas.width, canvas.height);
  ctxOf(copy).drawImage(canvas, 0, 0);
  const bleed = radius * 3;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = `blur(${radius}px)`;
  smooth(ctx);
  ctx.drawImage(copy, -bleed, -bleed, canvas.width + bleed * 2, canvas.height + bleed * 2);
  ctx.filter = "none";
}

/** Resample the photo to its final size with the browser's better resizer. */
async function resample(img: ImageBitmap, w: number, h: number): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(img, {
      resizeWidth: Math.max(1, Math.round(w)),
      resizeHeight: Math.max(1, Math.round(h)),
      resizeQuality: "high",
    });
  } catch {
    return null; // Fall back to a plain scaled drawImage.
  }
}

export async function renderFrame(img: ImageBitmap, options: RenderOptions): Promise<HTMLCanvasElement> {
  const width = Math.max(16, Math.round(options.width));
  const height = Math.max(16, Math.round(options.height));
  const short = Math.min(width, height);
  const out = canvasOf(width, height);
  const ctx = ctxOf(out);
  smooth(ctx);

  // Background: cover-crop into the tiny buffer, grade it, blow it back up.
  const long = bufferSide(options.blur);
  const bufferW = width >= height ? long : Math.max(1, Math.round((long * width) / height));
  const bufferH = height >= width ? long : Math.max(1, Math.round((long * height) / width));
  const buffer = canvasOf(bufferW, bufferH);
  const bufferCtx = ctxOf(buffer);
  smooth(bufferCtx);
  const crop = coverRect(img.width, img.height, bufferW, bufferH);
  bufferCtx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, bufferW, bufferH);
  grade(bufferCtx, bufferW, bufferH);

  const background = upscale(buffer, width, height);
  soften(background, clamp((background.width / bufferW) * 0.5, 0, 40));
  ctx.drawImage(background, 0, 0, width, height);

  // Foreground: the photo untouched, contained inside the margin.
  const inset = short * (clamp(options.margin, 0, 45) / 100);
  const scale = Math.min((width - inset * 2) / img.width, (height - inset * 2) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  if (inset > 0) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
    ctx.shadowBlur = short * 0.022;
    ctx.shadowOffsetY = short * 0.006;
  }
  const resized = await resample(img, w, h);
  if (resized) {
    ctx.drawImage(resized, x, y);
    resized.close();
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  return out;
}
