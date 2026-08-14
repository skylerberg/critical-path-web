// Dev-only entry (NOT part of the production build) that mounts the REAL
// AvatarCropper over a source image of known colours, so a browser can answer
// what jsdom cannot: whether the square that gets saved is the square the circle
// was showing. Served by `vite dev` at /scripts/avatar-cropper-probe.html.
// See scripts/check-avatar-cropper.mjs.
import { mount } from 'svelte';
import '../src/app.css';
import AvatarCropper from '../src/components/AvatarCropper.svelte';

const SOURCE = { width: 400, height: 200 };

async function source(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = SOURCE.width;
  canvas.height = SOURCE.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(200, 0, 200, 200);
  // Asymmetric marker: the only way to tell a correct turn from a mirrored one.
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, 40, 40);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return new File([blob], 'source.png', { type: 'image/png' });
}

let saved: File | null = null;

mount(AvatarCropper, {
  target: document.getElementById('app')!,
  props: {
    file: await source(),
    onsave: (file: File) => {
      saved = file;
    },
    oncancel: () => {},
  },
});

function hex(data: Uint8ClampedArray): string {
  return `#${[data[0], data[1], data[2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

async function sample(image: CanvasImageSource, points: [number, number][]): Promise<string[]> {
  const width = Number((image as { width: number }).width);
  const height = Number((image as { height: number }).height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  return points.map(([fx, fy]) =>
    hex(
      ctx.getImageData(
        Math.min(width - 1, Math.round(fx * width)),
        Math.min(height - 1, Math.round(fy * height)),
        1,
        1
      ).data
    )
  );
}

const api = {
  frame: () => document.querySelector('[role="group"]')!.getBoundingClientRect().toJSON(),
  ready: () => document.querySelector('img')?.naturalWidth === SOURCE.width,
  saved: () => saved !== null,
  clear: () => {
    saved = null;
  },
  /** Colours of the file the cropper produced, at fractions of its own square. */
  async fromSaved(points: [number, number][]): Promise<{ size: number; colors: string[] } | null> {
    if (saved === null) return null;
    const bitmap = await createImageBitmap(saved);
    return { size: bitmap.width, colors: await sample(bitmap, points) };
  },
  /** The same fractions of the frame, read out of a screenshot of the page. */
  async fromScreen(dataUrl: string, points: [number, number][]): Promise<string[]> {
    const shot = new Image();
    shot.src = dataUrl;
    await shot.decode();
    const rect = document.querySelector('[role="group"]')!.getBoundingClientRect();
    const scale = shot.width / window.innerWidth;
    return sample(
      shot,
      points.map(([fx, fy]) => [
        ((rect.left + fx * rect.width) * scale) / shot.width,
        ((rect.top + fy * rect.height) * scale) / shot.height,
      ])
    );
  },
  /**
   * A drag, with capture stubbed: a PointerEvent made in script never registers
   * a live pointer, so the real setPointerCapture would throw NotFoundError and
   * the handler would never reach the maths this is here to measure.
   */
  drag(from: [number, number], to: [number, number]): void {
    Element.prototype.setPointerCapture = () => {};
    const frame = document.querySelector('[role="group"]')!;
    const at = (type: string, [x, y]: [number, number]) =>
      frame.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true })
      );
    at('pointerdown', from);
    at('pointermove', to);
    at('pointerup', to);
  },
};

Object.assign(window, { __cropper: api });
export {};
