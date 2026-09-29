# CLAUDE.md

Social Kit: a single-purpose web app that fits an image to a frame it does not
match (1:1, 16:9, 9:16, or a Pixel 10 screen) by sitting it on a blurred,
saturated copy of itself. Vite 8 +
TypeScript, no framework, no dependencies beyond the toolchain. Everything runs
client side, nothing is uploaded.

## Commands

```bash
npm run dev      # localhost:5173
npm run build    # tsc --noEmit then vite build; this is the type check
npm run preview  # serve dist/
```

There is no test suite. Verify by driving the app: drop an image, move the
sliders, download, and check the console is clean.

## Architecture

- `src/render.ts` is the whole image pipeline and knows nothing about the DOM
  chrome. `renderFrame(bitmap, options)` takes an explicit `width`/`height` and
  returns a fresh canvas; the frame list lives in `ASPECTS` in `main.ts`.
- `src/image.ts` handles file in, blob out, and the status-line formatting.
- `src/main.ts` is the UI wiring: drop, paste, file picker, sliders, export.

**The blur is not `ctx.filter`.** The background is drawn into a tiny buffer
(220px down to 6px square, geometric across the slider), graded for saturation
and brightness with a pixel loop while it is still tiny, then scaled back up by
repeated doubling. That is why it is constant-cost at any output size and why it
works without filter support. `ctx.filter` is used afterwards, only if the
browser has it, to soften the interpolation edges, and it draws overscanned by
3x the radius because a plain blur fades the canvas edges to transparent.

**The Size select is the short edge**, which is how the platforms count: 1080
gives 1080×1080, 1920×1080, 1080×1920 and 1080×2424. `dimensions()` in `main.ts`
is the only place that maths lives. The Pixel 10 frame is stored as 45:101, its
exact 1080×2424 panel, not the 20:9 the spec sheet rounds to, so a 1080 export
lands on the screen pixel for pixel.

The preview renders at 1024px on the long edge so slider drags stay instant; the
export re-renders at the chosen size. Renders are coalesced to one per frame and
tagged with a token so a stale async render cannot overwrite a newer one.

Two CSS rules are load bearing:

- `[hidden] { display: none !important }`. The `.dropzone` and `.preview` rules
  set `display`, which otherwise beats the UA hidden rule and leaves both panes
  visible at once.
- `.preview canvas` caps its width in px, not with a percentage. The figure
  hugs the canvas (no letterboxing around a 9:16 frame) only while the canvas's
  intrinsic contribution stays definite, and a percentage in `max-width` makes
  it indefinite. The percentage version is confined to the one-column media
  query, where filling the width is the intent anyway.

## Notes

- EXIF rotation is handled by `createImageBitmap(file, { imageOrientation: "from-image" })`.
- HEIC and RAW cannot be decoded by the browser; the catch in `loadImage` says so.
- Instagram's native square is 1080. 2160 is there because Instagram recompresses
  anyway and the extra resolution survives it slightly better.
- JPEG quality is fixed at 0.92 (`JPEG_QUALITY` in `main.ts`). A 2160 export
  encodes in about a second, which is the slow step, not the render (~10ms).
