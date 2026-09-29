import "./style.css";
import { DEFAULT_LOOK, renderFrame, type Look, type RenderOptions } from "./render";
import {
  canvasToBlob,
  extensionFor,
  firstImage,
  formatBytes,
  loadImage,
  ratioLabel,
  saveBlob,
  type Loaded,
} from "./image";

/** The preview renders small so slider drags stay instant; exports render full size. */
const PREVIEW_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.92;

/**
 * Output frames. The size control is the short edge, which is how the platforms
 * count. Pixel 10 is 1080 × 2424, which is 45:101 exactly (20:9 is the marketing
 * round-off), so a 1080 export is a pixel-perfect wallpaper.
 */
const ASPECTS = {
  "1:1": { rw: 1, rh: 1, slug: "1x1" },
  "16:9": { rw: 16, rh: 9, slug: "16x9" },
  "9:16": { rw: 9, rh: 16, slug: "9x16" },
  pixel10: { rw: 45, rh: 101, slug: "pixel10" },
} as const;

type AspectId = keyof typeof ASPECTS;

const DEFAULT_ASPECT: AspectId = "1:1";

/** Frame size in px from a short-edge base. 9:16 at 1080 is 1080×1920. */
function dimensions(aspect: AspectId, shortEdge: number): { width: number; height: number } {
  const { rw, rh } = ASPECTS[aspect];
  return rw >= rh
    ? { width: Math.round((shortEdge * rw) / rh), height: shortEdge }
    : { width: shortEdge, height: Math.round((shortEdge * rh) / rw) };
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const dropzone = el<HTMLDivElement>("dropzone");
const previewFigure = el<HTMLElement>("preview");
const canvas = el<HTMLCanvasElement>("canvas");
const fileInput = el<HTMLInputElement>("file");
const statusLine = el<HTMLParagraphElement>("status");
const downloadButton = el<HTMLButtonElement>("download");
const resetButton = el<HTMLButtonElement>("reset");
const sizeSelect = el<HTMLSelectElement>("size");
const formatSelect = el<HTMLSelectElement>("format");
const frameGroup = el<HTMLDivElement>("frame");

const sliders = {
  blur: el<HTMLInputElement>("blur"),
  margin: el<HTMLInputElement>("margin"),
};
const outputs = {
  blur: el<HTMLOutputElement>("blurOut"),
  margin: el<HTMLOutputElement>("marginOut"),
};

let loaded: Loaded | null = null;
let aspect: AspectId = DEFAULT_ASPECT;
let renderToken = 0;
let queued = false;

function currentLook(): Look {
  return {
    blur: Number(sliders.blur.value),
    margin: Number(sliders.margin.value),
  };
}

function exportOptions(): RenderOptions {
  return { ...currentLook(), ...dimensions(aspect, Number(sizeSelect.value)) };
}

function previewOptions(): RenderOptions {
  const { rw, rh } = ASPECTS[aspect];
  const shortEdge = Math.round((PREVIEW_LONG_EDGE * Math.min(rw, rh)) / Math.max(rw, rh));
  return { ...currentLook(), ...dimensions(aspect, shortEdge) };
}

function writeSliders(look: Look): void {
  sliders.blur.value = String(look.blur);
  sliders.margin.value = String(look.margin);
  writeReadouts();
}

function writeReadouts(): void {
  outputs.blur.textContent = `${sliders.blur.value}%`;
  outputs.margin.textContent = `${sliders.margin.value}%`;
}

/** The size options spell out the frame, so they have to follow the aspect. */
function writeSizeOptions(): void {
  for (const option of sizeSelect.options) {
    const { width, height } = dimensions(aspect, Number(option.value));
    option.textContent = `${width} × ${height}`;
  }
}

function writeFrameButtons(): void {
  for (const button of frameGroup.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.aspect === aspect));
  }
}

function describe(extra?: string): void {
  if (!loaded) {
    statusLine.textContent = "No image loaded.";
    return;
  }
  const { bitmap, name } = loaded;
  const { width, height } = dimensions(aspect, Number(sizeSelect.value));
  const format = formatSelect.selectedOptions[0]?.text ?? "JPEG";
  const source = `${name} · ${bitmap.width}×${bitmap.height} (${ratioLabel(bitmap.width, bitmap.height)})`;
  statusLine.textContent = `${source} → ${width}×${height} ${format}${extra ? ` · ${extra}` : ""}`;
}

/** Coalesce slider input into one render per frame, newest options win. */
function scheduleRender(): void {
  if (!loaded || queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    void drawPreview();
  });
}

async function drawPreview(): Promise<void> {
  if (!loaded) return;
  const token = ++renderToken;
  const rendered = await renderFrame(loaded.bitmap, previewOptions());
  if (token !== renderToken) return; // A newer render has already started.
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(rendered, 0, 0);
}

async function accept(file: File): Promise<void> {
  try {
    statusLine.textContent = `Reading ${file.name}…`;
    const next = await loadImage(file);
    loaded?.bitmap.close();
    loaded = next;
    dropzone.hidden = true;
    previewFigure.hidden = false;
    downloadButton.disabled = false;
    describe();
    await drawPreview();
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function download(): Promise<void> {
  if (!loaded) return;
  downloadButton.disabled = true;
  const previous = statusLine.textContent;
  try {
    statusLine.textContent = "Rendering export…";
    const mime = formatSelect.value;
    const rendered = await renderFrame(loaded.bitmap, exportOptions());
    const blob = await canvasToBlob(rendered, mime, JPEG_QUALITY);
    saveBlob(blob, `${loaded.name}-${ASPECTS[aspect].slug}.${extensionFor(mime)}`);
    describe(formatBytes(blob.size));
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : previous;
  } finally {
    downloadButton.disabled = false;
  }
}

// Controls.
for (const slider of Object.values(sliders)) {
  slider.addEventListener("input", () => {
    writeReadouts();
    scheduleRender();
  });
}
frameGroup.addEventListener("click", (event) => {
  const chosen = (event.target as HTMLElement).closest("button")?.dataset.aspect;
  if (!chosen || !(chosen in ASPECTS) || chosen === aspect) return;
  aspect = chosen as AspectId;
  writeFrameButtons();
  writeSizeOptions();
  describe();
  scheduleRender();
});
sizeSelect.addEventListener("change", () => describe());
formatSelect.addEventListener("change", () => describe());
downloadButton.addEventListener("click", () => void download());
resetButton.addEventListener("click", () => {
  aspect = DEFAULT_ASPECT;
  writeSliders(DEFAULT_LOOK);
  sizeSelect.value = "1080";
  formatSelect.value = "image/jpeg";
  writeFrameButtons();
  writeSizeOptions();
  describe();
  scheduleRender();
});

// Getting an image in: click, drop, paste.
el<HTMLButtonElement>("pick").addEventListener("click", () => fileInput.click());
previewFigure.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = firstImage(fileInput.files);
  if (file) void accept(file);
  fileInput.value = "";
});

for (const type of ["dragenter", "dragover"]) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
    document.body.classList.add("dragging");
  });
}
for (const type of ["dragleave", "dragend"]) {
  window.addEventListener(type, (event) => {
    if (event.target === document.documentElement || !(event as DragEvent).relatedTarget) {
      document.body.classList.remove("dragging");
    }
  });
}
window.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dragging");
  const file = firstImage(event.dataTransfer?.files ?? null);
  if (file) void accept(file);
  else statusLine.textContent = "That drop had no image in it.";
});
window.addEventListener("paste", (event) => {
  const file = firstImage(event.clipboardData?.files ?? null);
  if (file) void accept(file);
});

writeSliders(DEFAULT_LOOK);
sizeSelect.value = "1080";
writeSizeOptions();
writeFrameButtons();
