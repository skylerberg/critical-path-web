/**
 * Geometry for the avatar cropper, in the model react-easy-crop popularized: a
 * square CSS viewport sits over an image the user pans, zooms and rotates, and
 * the visible square is the crop. Everything here is pure so the tests can pin
 * the math without a canvas; {@link ../cropImage.ts} turns a finished rect into
 * pixels.
 */

export interface Size {
  width: number;
  height: number;
}

/** Bounding box of a width × height image rotated `rotation` degrees clockwise. */
export function rotatedSize(width: number, height: number, rotation: number): Size {
  const degrees = ((rotation % 360) + 360) % 360;
  // Quarter turns are decided by branch, not trigonometry, so the cropper's
  // 90-degree steps never carry rounding noise into the canvas crop.
  if (degrees === 90 || degrees === 270) {
    return { width: height, height: width };
  }
  if (degrees === 0 || degrees === 180) {
    return { width, height };
  }
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  return { width: cos * width + sin * height, height: sin * width + cos * height };
}

/** Smallest scale at which the rotated image covers every edge of the viewport. */
export function coverScale(viewport: number, size: Size): number {
  return Math.max(viewport / size.width, viewport / size.height);
}

/**
 * How far the scaled image's centre may sit from the viewport centre along each
 * axis before a gap opens between image and viewport edge.
 */
export function maxOffset(viewport: number, size: Size, scale: number): Size {
  return {
    width: (size.width * scale - viewport) / 2,
    height: (size.height * scale - viewport) / 2,
  };
}

/** Pull an offset back inside the range {@link maxOffset} allows. */
export function clampOffset(
  viewport: number,
  size: Size,
  scale: number,
  x: number,
  y: number
): { x: number; y: number } {
  const max = maxOffset(viewport, size, scale);
  return {
    x: Math.min(max.width, Math.max(-max.width, x)),
    y: Math.min(max.height, Math.max(-max.height, y)),
  };
}

export interface CropRect {
  /** Crop's top-left corner in the rotated image's own pixels. */
  x: number;
  y: number;
  /** Side length — the crop is square. */
  size: number;
}

/**
 * The viewport square expressed in the rotated image's own pixels, ready for
 * `drawImage`. `scale` and `x`/`y` are the values the image is rendered with:
 * CSS pixels per image pixel, and the image centre's offset from the viewport
 * centre.
 */
export function cropRect(
  viewport: number,
  size: Size,
  scale: number,
  x: number,
  y: number
): CropRect {
  return {
    x: size.width / 2 - (viewport / 2 + x) / scale,
    y: size.height / 2 - (viewport / 2 + y) / scale,
    size: viewport / scale,
  };
}
