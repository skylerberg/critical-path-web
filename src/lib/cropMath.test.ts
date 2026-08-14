import { describe, expect, it } from 'vitest';
import { clampOffset, coverScale, cropRect, maxOffset, rotatedSize } from './cropMath';

describe('rotatedSize', () => {
  it('leaves the size alone at 0 and 180 degrees', () => {
    expect(rotatedSize(1000, 500, 0)).toEqual({ width: 1000, height: 500 });
    expect(rotatedSize(1000, 500, 180)).toEqual({ width: 1000, height: 500 });
  });

  it('swaps width and height at 90 and 270 degrees', () => {
    expect(rotatedSize(1000, 500, 90)).toEqual({ width: 500, height: 1000 });
    expect(rotatedSize(1000, 500, 270)).toEqual({ width: 500, height: 1000 });
  });

  it('wraps rotations past a full turn, including negatives', () => {
    expect(rotatedSize(1000, 500, 450)).toEqual({ width: 500, height: 1000 });
    expect(rotatedSize(1000, 500, -90)).toEqual({ width: 500, height: 1000 });
    expect(rotatedSize(1000, 500, -180)).toEqual({ width: 1000, height: 500 });
  });

  it('grows to the diagonal bounding box at 45 degrees', () => {
    const size = rotatedSize(100, 100, 45);
    expect(size.width).toBeCloseTo(Math.SQRT2 * 100, 10);
    expect(size.height).toBeCloseTo(Math.SQRT2 * 100, 10);
  });
});

describe('coverScale', () => {
  it('fits the limiting dimension exactly', () => {
    // A 1000×500 image in a 240px square: the height is the constraint.
    expect(coverScale(240, { width: 1000, height: 500 })).toBe(0.48);
    expect(coverScale(240, { width: 500, height: 1000 })).toBe(0.48);
  });

  it('is 1 for an image the size of the viewport', () => {
    expect(coverScale(240, { width: 240, height: 240 })).toBe(1);
  });
});

describe('maxOffset and clampOffset', () => {
  it('allows no movement on the axis that fits exactly', () => {
    // 1000×500 at cover scale in 240px: height fills the viewport, width has room.
    const max = maxOffset(240, { width: 1000, height: 500 }, 0.48);
    expect(max.width).toBeCloseTo(120, 10);
    expect(max.height).toBeCloseTo(0, 10);
  });

  it('clamps each axis independently', () => {
    const clamped = clampOffset(240, { width: 1000, height: 500 }, 0.48, 500, -30);
    expect(clamped.x).toBe(120);
    expect(clamped.y).toBeCloseTo(0, 10);
  });

  it('passes through offsets already in range', () => {
    expect(clampOffset(240, { width: 1000, height: 500 }, 0.48, 40, 0)).toEqual({ x: 40, y: 0 });
  });

  it('tightens as zoom rises', () => {
    // At 2x zoom the drawn image is 960 wide: half the slack on each side.
    const max = maxOffset(240, { width: 1000, height: 500 }, 0.96);
    expect(max.width).toBeCloseTo(360, 10);
    expect(max.height).toBeCloseTo(120, 10);
  });
});

describe('cropRect', () => {
  const size = { width: 1000, height: 500 };

  it('centers the crop on a centered image', () => {
    // Cover scale of 0.48 makes the visible square 500 image px; the height has
    // no room, so the crop spans it exactly.
    expect(cropRect(240, size, 0.48, 0, 0)).toEqual({ x: 250, y: 0, size: 500 });
  });

  it('moves opposite the drag, in image pixels', () => {
    // Dragging the image 40px right shows content further right: the crop's
    // left edge moves right by 40/0.48 image px.
    const rect = cropRect(240, size, 0.48, 40, -10);
    expect(rect.x).toBeCloseTo(250 - 40 / 0.48, 10);
    // The y offset is clamped away in practice (no vertical room); the math
    // still answers, so pin what it says.
    expect(rect.y).toBeCloseTo(0 + 10 / 0.48, 10);
    expect(rect.size).toBe(500);
  });

  it('keeps the crop inside the image when offsets are clamped', () => {
    const clamped = clampOffset(240, size, 0.48, 500, 0);
    const rect = cropRect(240, size, 0.48, clamped.x, clamped.y);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.size).toBeLessThanOrEqual(size.width);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.size).toBeLessThanOrEqual(size.height);
  });

  it('shrinks the crop as zoom deepens', () => {
    const rect = cropRect(240, size, 0.48 * 2, 0, 0);
    expect(rect.size).toBe(250);
  });
});
