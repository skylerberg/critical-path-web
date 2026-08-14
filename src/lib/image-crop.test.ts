import { describe, expect, it } from 'vitest';
import {
  MAX_OUTPUT_SIZE,
  clampOffset,
  cropRect,
  cropSide,
  croppedFile,
  drawCrop,
  maxOffset,
  outputSize,
  rotatedSize,
  type CropView,
  type Rotation,
} from './image-crop';

const LANDSCAPE = { width: 400, height: 200 };
const PORTRAIT = { width: 200, height: 500 };

function view(overrides: Partial<CropView> = {}): CropView {
  return {
    image: LANDSCAPE,
    rotation: 0,
    zoom: 1,
    offset: { x: 0, y: 0 },
    ...overrides,
  };
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Point {
  x: number;
  y: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function apply(m: Matrix, { x, y }: Point): Point {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * jsdom has no 2D context, and a real one would only report pixels anyway. This
 * accumulates the same transform the canvas would and hands back the matrix in
 * force at the drawImage — which is the whole of what `drawCrop` decides.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; drawnWith: () => Matrix } {
  let matrix = IDENTITY;
  const stack: Matrix[] = [];
  let drawn: Matrix | null = null;
  const ctx = {
    save: () => stack.push(matrix),
    restore: () => (matrix = stack.pop() ?? IDENTITY),
    scale: (x: number, y: number) =>
      (matrix = multiply(matrix, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 })),
    translate: (x: number, y: number) =>
      (matrix = multiply(matrix, { a: 1, b: 0, c: 0, d: 1, e: x, f: y })),
    rotate: (radians: number) =>
      (matrix = multiply(matrix, {
        a: Math.cos(radians),
        b: Math.sin(radians),
        c: -Math.sin(radians),
        d: Math.cos(radians),
        e: 0,
        f: 0,
      })),
    drawImage: () => (drawn = matrix),
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    drawnWith: () => {
      if (drawn === null) throw new Error('drawCrop never drew the image');
      return drawn;
    },
  };
}

/** The inverse of the turn `drawCrop` applies, so a crop corner can be named in the source's own pixels. */
function toImageSpace(point: Point, of: CropView): Point {
  const rotated = rotatedSize(of.image, of.rotation);
  const radians = (-of.rotation * Math.PI) / 180;
  const dx = point.x - rotated.width / 2;
  const dy = point.y - rotated.height / 2;
  return {
    x: of.image.width / 2 + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: of.image.height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function closeTo(point: Point): { x: number; y: number } {
  return { x: expect.closeTo(point.x, 6) as number, y: expect.closeTo(point.y, 6) as number };
}

describe('rotatedSize', () => {
  it('swaps the sides on a quarter turn and leaves them on a half', () => {
    expect(rotatedSize(LANDSCAPE, 0)).toEqual({ width: 400, height: 200 });
    expect(rotatedSize(LANDSCAPE, 90)).toEqual({ width: 200, height: 400 });
    expect(rotatedSize(LANDSCAPE, 180)).toEqual({ width: 400, height: 200 });
    expect(rotatedSize(LANDSCAPE, 270)).toEqual({ width: 200, height: 400 });
  });
});

describe('cropSide', () => {
  it('is the short side at zoom 1, so the frame is covered and no further', () => {
    expect(cropSide(view())).toBe(200);
    expect(cropSide(view({ image: PORTRAIT }))).toBe(200);
  });

  it('shrinks with zoom', () => {
    expect(cropSide(view({ zoom: 2 }))).toBe(100);
    expect(cropSide(view({ zoom: 2.5 }))).toBe(80);
  });

  it('follows the turn, not the stored width', () => {
    expect(cropSide(view({ image: { width: 400, height: 100 }, rotation: 90 }))).toBe(100);
  });
});

describe('maxOffset', () => {
  it('pins the short side and lets the long one travel', () => {
    // 400x200 at zoom 1 crops a 200 square: 200px of slack, half the frame each way.
    expect(maxOffset(view())).toEqual({ x: 0.5, y: 0 });
    expect(maxOffset(view({ image: PORTRAIT }))).toEqual({ x: 0, y: 0.75 });
  });

  it('opens up both axes once zoomed in', () => {
    expect(maxOffset(view({ zoom: 2 }))).toEqual({ x: 1.5, y: 0.5 });
  });

  it('turns with the image', () => {
    expect(maxOffset(view({ rotation: 90 }))).toEqual({ x: 0, y: 0.5 });
  });
});

describe('clampOffset', () => {
  it('leaves an offset inside the range alone', () => {
    expect(clampOffset(view({ offset: { x: 0.25, y: 0 } }))).toEqual({ x: 0.25, y: 0 });
  });

  it('holds the image against the edge rather than past it', () => {
    expect(clampOffset(view({ offset: { x: 5, y: 5 } }))).toEqual({ x: 0.5, y: 0 });
    expect(clampOffset(view({ offset: { x: -5, y: -5 } }))).toEqual({ x: -0.5, y: -0 });
  });
});

describe('cropRect', () => {
  it('takes the middle when nothing has been moved', () => {
    expect(cropRect(view())).toEqual({ x: 100, y: 0, side: 200 });
  });

  it('slides with the offset, in frame-fractions of its own side', () => {
    expect(cropRect(view({ offset: { x: 0.25, y: 0 } }))).toEqual({ x: 50, y: 0, side: 200 });
  });

  it('lands flush with the edge at the extremes and never leaves the image', () => {
    expect(cropRect(view({ offset: { x: 0.5, y: 0 } }))).toEqual({ x: 0, y: 0, side: 200 });
    expect(cropRect(view({ offset: { x: -0.5, y: 0 } }))).toEqual({ x: 200, y: 0, side: 200 });
  });

  // The guarantee the whole clamp exists for: an avatar can never carry a strip
  // of blank canvas, whatever the caller asks for.
  it('stays inside the rotated image for every rotation, zoom and wild offset', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const zoom of [1, 1.5, 3]) {
        for (const offset of [
          { x: 0, y: 0 },
          { x: 9, y: -9 },
          { x: -4, y: 7 },
        ]) {
          const current = view({ image: PORTRAIT, rotation, zoom, offset });
          const rect = cropRect(current);
          const bounds = rotatedSize(PORTRAIT, rotation);
          const where = `rotation ${String(rotation)} zoom ${String(zoom)}`;
          expect(rect.x, where).toBeGreaterThanOrEqual(0);
          expect(rect.y, where).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.side, where).toBeLessThanOrEqual(bounds.width);
          expect(rect.y + rect.side, where).toBeLessThanOrEqual(bounds.height);
        }
      }
    }
  });
});

describe('outputSize', () => {
  it('writes the crop at its own resolution rather than stretching it', () => {
    expect(outputSize(view())).toBe(200);
    expect(outputSize(view({ zoom: 2 }))).toBe(100);
  });

  it('stops at the size the API keeps', () => {
    expect(outputSize(view({ image: { width: 6000, height: 4000 } }))).toBe(MAX_OUTPUT_SIZE);
  });

  it('rounds, and never to nothing', () => {
    expect(outputSize(view({ image: { width: 401, height: 301 }, zoom: 3 }))).toBe(100);
    expect(outputSize(view({ image: { width: 2, height: 2 }, zoom: 3 }))).toBe(1);
  });
});

describe('drawCrop', () => {
  // Corner by corner rather than "a matrix was produced": this is the only place
  // the rotation, the offset and the output scale are combined, and each of the
  // three can be wrong in a way the other two hide.
  it('maps the cropped square onto the whole output, at every quarter turn', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const current = view({ image: LANDSCAPE, rotation, zoom: 1.5, offset: { x: 0.2, y: -0.1 } });
      const rect = cropRect(current);
      const size = 512;
      const { ctx, drawnWith } = recordingContext();
      drawCrop(ctx, {} as CanvasImageSource, current, size);
      const matrix = drawnWith();
      const corners = [
        { at: { x: rect.x, y: rect.y }, canvas: { x: 0, y: 0 } },
        { at: { x: rect.x + rect.side, y: rect.y }, canvas: { x: size, y: 0 } },
        { at: { x: rect.x, y: rect.y + rect.side }, canvas: { x: 0, y: size } },
        { at: { x: rect.x + rect.side, y: rect.y + rect.side }, canvas: { x: size, y: size } },
      ];
      for (const corner of corners) {
        expect(apply(matrix, toImageSpace(corner.at, current)), `rotation ${String(rotation)}`) //
          .toEqual(closeTo(corner.canvas));
      }
    }
  });

  it('leaves the context as it found it', () => {
    const { ctx, drawnWith } = recordingContext();
    drawCrop(ctx, {} as CanvasImageSource, view(), 256);
    drawnWith();
    expect(apply(IDENTITY, { x: 3, y: 7 })).toEqual({ x: 3, y: 7 });
    // restore() popped the save(), so a second draw starts from the same place.
    const second = recordingContext();
    drawCrop(second.ctx, {} as CanvasImageSource, view(), 256);
    expect(second.drawnWith()).toEqual(drawnWith());
  });
});

describe('croppedFile', () => {
  it('names the file after what the canvas actually encoded', () => {
    const webp = croppedFile(new Blob(['x'], { type: 'image/webp' }));
    expect(webp.name).toBe('avatar.webp');
    expect(webp.type).toBe('image/webp');
    // An engine without WebP encoding falls back to PNG on its own.
    expect(croppedFile(new Blob(['x'], { type: 'image/png' })).name).toBe('avatar.png');
  });
});
