import { rotatedSize } from './cropMath';
import type { CropRect } from './cropMath';

export type { CropRect };

/** An image decoded far enough to crop: its object URL and natural pixel size. */
export interface LoadedImage {
  url: string;
  width: number;
  height: number;
}

/** Rejects anything that fails to decode, so a non-image never reaches the cropper. */
export function loadImage(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ url, width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new Error('Image has no size'));
      }
    };
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = url;
  });
}

async function loadElement(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      if (image.width > 10000 || image.height > 10000) {
        reject(new Error('Image dimensions too large'));
        return;
      }
      resolve();
    };
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = url;
  });
  return image;
}

/**
 * Crop the image at `url` to `rect` — expressed in the rotated image's pixels,
 * as `cropRect` produces — and encode a square JPEG of `outputSize` pixels.
 * Mirrors the server's own normalisation closely enough that the crop the user
 * framed is the crop that survives: the server re-encodes to WebP but never
 * enlarges.
 */
export async function getCroppedBlob(
  url: string,
  rect: CropRect,
  rotation: number,
  outputSize = 400
): Promise<Blob> {
  if (rect.size <= 0) {
    throw new Error('Invalid crop dimensions');
  }
  const image = await loadElement(url);
  const degrees = ((rotation % 360) + 360) % 360;
  const rad = (degrees * Math.PI) / 180;
  const box = rotatedSize(image.width, image.height, degrees);

  // Step 1: draw the full image rotated into its bounding box, which is the
  // coordinate space `rect` lives in.
  const rotated = document.createElement('canvas');
  rotated.width = box.width;
  rotated.height = box.height;
  const rotatedCtx = rotated.getContext('2d');
  if (!rotatedCtx) throw new Error('Failed to get canvas 2D context');
  rotatedCtx.translate(box.width / 2, box.height / 2);
  rotatedCtx.rotate(rad);
  rotatedCtx.drawImage(image, -image.width / 2, -image.height / 2);

  // Step 2: copy the crop out at its final size.
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2D context');
  ctx.drawImage(rotated, rect.x, rect.y, rect.size, rect.size, 0, 0, outputSize, outputSize);

  return new Promise<Blob>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Image processing timed out')), 10_000);
    canvas.toBlob(
      (blob) => {
        clearTimeout(timeout);
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create image blob'));
        }
      },
      'image/jpeg',
      0.8
    );
  });
}
