/** Quarter turns are the only rotations the cropper offers, and all the geometry here assumes it. */
export type Rotation = 0 | 90 | 180 | 270;

export interface Size {
  width: number;
  height: number;
}

/**
 * How far the image is panned, as a fraction of the crop frame's side rather
 * than in pixels: the frame is fluid, so an offset captured at one rendered
 * width would mean a different crop at the next. Every quantity below is
 * therefore independent of the frame's size, and the frame is measured only to
 * turn a drag in pixels into one of these.
 */
export interface Offset {
  x: number;
  y: number;
}

export interface CropView {
  /** Natural size of the source image, before rotation. */
  image: Size;
  rotation: Rotation;
  /** 1 covers the frame exactly; the frame is square, so this is the short side fitted to it. */
  zoom: number;
  offset: Offset;
}

/** A square region of the rotated image, in its pixels. */
export interface CropRect {
  x: number;
  y: number;
  side: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** The API auto-orients, fits to 1024x1024 and re-encodes, so sending more pixels only costs upload. */
export const MAX_OUTPUT_SIZE = 1024;

const QUALITY = 0.92;

export function rotatedSize({ width, height }: Size, rotation: Rotation): Size {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

/** The side of the crop square in source pixels. */
export function cropSide(view: CropView): number {
  const { width, height } = rotatedSize(view.image, view.rotation);
  return Math.min(width, height) / view.zoom;
}

/**
 * How far the image can pan before the crop square would leave it. Zoom 1 fits
 * the short side exactly, so that direction pins to 0 and only the long one moves.
 */
export function maxOffset(view: CropView): Offset {
  const { width, height } = rotatedSize(view.image, view.rotation);
  const side = cropSide(view);
  return {
    x: Math.max(0, (width / side - 1) / 2),
    y: Math.max(0, (height / side - 1) / 2),
  };
}

export function clampOffset(view: CropView): Offset {
  const limit = maxOffset(view);
  return {
    x: Math.min(limit.x, Math.max(-limit.x, view.offset.x)),
    y: Math.min(limit.y, Math.max(-limit.y, view.offset.y)),
  };
}

/**
 * Always inside the image, whatever offset it is handed — the guarantee that a
 * saved avatar can never carry a strip of empty canvas.
 *
 * Clamped here in pixels rather than by running the offset through
 * `clampOffset` first, which reaches the same interval a different way and then
 * misses by a rounding error: an offset sitting exactly on its limit multiplies
 * out to a hair either side of the edge, and on the low side that is a source
 * rectangle starting outside the image.
 */
export function cropRect(view: CropView): CropRect {
  const { width, height } = rotatedSize(view.image, view.rotation);
  const side = cropSide(view);
  const inside = (position: number, extent: number): number =>
    Math.min(Math.max(0, position), Math.max(0, extent - side));
  return {
    x: inside(width / 2 - view.offset.x * side - side / 2, width),
    y: inside(height / 2 - view.offset.y * side - side / 2, height),
    side,
  };
}

/** Never upscales: a crop of 120 source pixels is written as 120, not stretched to the cap. */
export function outputSize(view: CropView): number {
  return Math.max(1, Math.min(MAX_OUTPUT_SIZE, Math.round(cropSide(view))));
}

/**
 * Draws the cropped square into `size` x `size` at the context's origin.
 *
 * One drawImage rather than a rotate-the-whole-image pass first: the transform
 * carries the rotation, and the intermediate canvas that pass needs is the size
 * of the source, which for a phone photo is tens of megabytes to hold a region
 * that ends up 1024 pixels wide.
 */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  view: CropView,
  size: number
): void {
  const rect = cropRect(view);
  const rotated = rotatedSize(view.image, view.rotation);
  ctx.save();
  // Read right to left: centre the source on its own midpoint, turn it, move the
  // crop's top-left corner to the origin, then scale that square up to the output.
  ctx.scale(size / rect.side, size / rect.side);
  ctx.translate(rotated.width / 2 - rect.x, rotated.height / 2 - rect.y);
  ctx.rotate((view.rotation * Math.PI) / 180);
  ctx.translate(-view.image.width / 2, -view.image.height / 2);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

/**
 * WebP because the API stores WebP anyway and it keeps the alpha a PNG upload
 * arrived with. An engine without WebP encoding falls back to PNG on its own
 * (the canvas spec says so), which the API also accepts — so the caller reads
 * the type off the blob rather than assuming it.
 */
export async function renderCrop(image: CanvasImageSource, view: CropView): Promise<Blob> {
  const size = outputSize(view);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas is unavailable');
  }
  ctx.imageSmoothingQuality = 'high';
  drawCrop(ctx, image, view, size);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', QUALITY);
  });
  if (blob === null) {
    throw new Error('Could not encode the cropped image');
  }
  return blob;
}

export function croppedFile(blob: Blob): File {
  const extension = blob.type === 'image/png' ? 'png' : 'webp';
  return new File([blob], `avatar.${extension}`, { type: blob.type });
}
