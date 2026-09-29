/** Loading images in, and getting finished ones back out. */

export interface Loaded {
  bitmap: ImageBitmap;
  name: string;
}

/** Strip the extension so exports can be named after the source. */
function baseName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "").trim();
  return base || "image";
}

export async function loadImage(file: File): Promise<Loaded> {
  try {
    // `from-image` applies the EXIF rotation, so phone photos land upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { bitmap, name: baseName(file.name) };
  } catch {
    const kind = file.type || "that file type";
    throw new Error(
      `Could not decode ${kind}. HEIC and RAW files need converting to JPEG first.`,
    );
  }
}

/** The first image in a drop, paste or file dialog, if there is one. */
export function firstImage(files: Iterable<File> | FileList | null): File | null {
  if (!files) return null;
  for (const file of Array.from(files as Iterable<File>)) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

export function extensionFor(mime: string): string {
  return mime === "image/png" ? "png" : "jpg";
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))),
      mime,
      quality,
    );
  });
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on a timeout: Firefox needs the URL alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "19:6" style label for the source image, for the status line. */
export function ratioLabel(w: number, h: number): string {
  const divisor = gcd(w, h);
  const a = w / divisor;
  const b = h / divisor;
  if (a <= 40 && b <= 40) return `${a}:${b}`;
  return `${(w / h).toFixed(2)}:1`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
