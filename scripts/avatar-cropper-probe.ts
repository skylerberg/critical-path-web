// Dev-only entry (NOT part of the production build) that mounts the REAL
// AvatarCropper over a synthetic image, so a browser can answer what jsdom
// cannot: whether the preview draws at the size the transform math assumes
// (jsdom lays nothing out, so a CSS clamp on the <img> is invisible there),
// whether gestures move the image by exactly the clamped pointer delta, and
// whether the cropped JPEG's pixels equal the region of the source the viewport
// was showing. Served by `vite dev` at /scripts/avatar-cropper-probe.html. See
// scripts/check-avatar-cropper.mjs.
import { mount } from 'svelte';
import '../src/app.css';
import AvatarCropper from '../src/components/AvatarCropper.svelte';
import { getCroppedBlob } from '../src/lib/cropImage';
import type { CropRect } from '../src/lib/cropMath';

// Synthetic 800x400 source. Channels chosen so a coordinate error shows up as a
// number, not a subtlety: triangle-wave gradients (continuous, so scaling and
// interpolation cannot invent deviations) with steep slopes, and a quadrant
// pattern in blue whose sharp borders flip hard when an axis is inverted.
const W = 800;
const H = 400;
const triangle = (t: number): number => 255 * (1 - Math.abs(2 * (t % 1) - 1));
const source = document.createElement('canvas');
source.width = W;
source.height = H;
const sctx = source.getContext('2d')!;
const imageData = sctx.createImageData(W, H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    imageData.data[i] = Math.round(triangle(x / 400));
    imageData.data[i + 1] = Math.round(triangle(y / 200));
    imageData.data[i + 2] = x < W / 2 ? (y < H / 2 ? 60 : 110) : y < H / 2 ? 170 : 220;
    imageData.data[i + 3] = 255;
  }
}
sctx.putImageData(imageData, 0, 0);

const blob = await new Promise<Blob>((resolve) => source.toBlob((b) => resolve(b!), 'image/png'));
const url = URL.createObjectURL(blob);

const picked: { rect: CropRect | null; rotation: number | null } = {
  rect: null,
  rotation: null,
};

const app = mount(AvatarCropper, {
  target: document.getElementById('app')!,
  props: {
    src: url,
    width: W,
    height: H,
    onconfirm: (rect, rotation) => {
      picked.rect = rect;
      picked.rotation = rotation;
    },
    oncancel: () => {},
  },
});

interface Verdict {
  rect: CropRect | null;
  rotation: number | null;
  maxDeviation: number;
  bad: number;
  total: number;
}

/** Crop the picked rect and compare the output's pixels against the source
 * pixels mapped through the rect and back out of the rotation — the same claim
 * the component makes, verified independently of its own math. */
async function cropAndVerify(): Promise<Verdict> {
  const rect = picked.rect!;
  const rotation = picked.rotation ?? 0;
  const out = await getCroppedBlob(url, rect, rotation);
  const bmp = await createImageBitmap(out);
  const oc = document.createElement('canvas');
  oc.width = 400;
  oc.height = 400;
  const octx = oc.getContext('2d')!;
  octx.drawImage(bmp, 0, 0, 400, 400);
  const od = octx.getImageData(0, 0, 400, 400).data;

  const a = (rotation * Math.PI) / 180;
  const absSin = Math.abs(Math.sin(a));
  const absCos = Math.abs(Math.cos(a));
  const bw = absCos * W + absSin * H;
  const bh = absSin * W + absCos * H;
  const inv = -a;
  const cos = Math.cos(inv);
  const sin = Math.sin(inv);

  let max = 0;
  let bad = 0;
  let total = 0;
  for (let oy = 4; oy < 400; oy += 17) {
    for (let ox = 4; ox < 400; ox += 17) {
      const rx = rect.x + (ox / 399) * rect.size;
      const ry = rect.y + (oy / 399) * rect.size;
      const dx = rx - bw / 2;
      const dy = ry - bh / 2;
      const sx = Math.max(0, Math.min(W - 1, Math.round(W / 2 + cos * dx - sin * dy)));
      const sy = Math.max(0, Math.min(H - 1, Math.round(H / 2 + sin * dx + cos * dy)));
      const si = (sy * W + sx) * 4;
      const oi = (oy * 400 + ox) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const deviation = Math.abs(od[oi + ch] - imageData.data[si + ch]);
        if (deviation > max) max = deviation;
        if (deviation > 40) bad++;
        total++;
      }
    }
  }
  return { rect, rotation, maxDeviation: max, bad, total };
}

const probe = window as unknown as { __probe: unknown };
probe.__probe = {
  url,
  cropAndVerify,
  unmount: () => {
    import('svelte').then(({ unmount }) => unmount(app));
  },
};
export {};
