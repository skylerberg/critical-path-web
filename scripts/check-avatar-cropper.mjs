#!/usr/bin/env node
// Avatar-cropper check: mounts the ACTUAL AvatarCropper.svelte (via
// scripts/avatar-cropper-probe.html) in headless Chromium over a synthetic
// image and asserts the things jsdom cannot model — that the preview draws at
// the size the crop math assumes (a stylesheet clamp on the <img> is invisible
// to a runner that lays nothing out), that drag/wheel/pinch/slider steer the
// image by exactly the clamped amounts, and that the cropped JPEG's pixels are
// the region of the source the viewport was showing, rotation included.
//
//   npm run check:avatar-cropper
//   node scripts/check-avatar-cropper.mjs --selftest
//
// Chromium deliberately, to match the other committed browser checks: nothing
// asserted here is engine-divergent (unlike the card overlay's blur-on-unmount),
// and a committed check asking for WebKit would fail in CI, which installs
// Chromium alone. The arms run as one cumulative sequence on one page — each
// gesture builds on the state the last left, and every arm's expectation
// accounts for what came before.
//
// Boots vite in-process on the first free port at or above 5220 (override with
// AVATAR_CROPPER_PROBE_PORT), measures, tears down. Skips with exit 0 if
// Chromium isn't installed. Exits non-zero on assertion failure.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELFTEST = process.argv.includes('--selftest');

// Puts the cropper back on the two bugs its development actually surfaced, one
// per arm that has to be earned.
//
// Without the max-width override the stylesheet's reset clamps the <img> to the
// viewport, and the preview silently draws squeezed while every style-string
// assertion (all jsdom can see) still passes. With the crop rect's x sign
// flipped, the rect leaves the image and the "crop" encodes regions the source
// never had.
const MUTATIONS = [
  {
    what: "the preview's max-width override",
    find: '        style:max-width="none"\n',
    replace: '',
    breaks: 'the preview draws at cover scale',
  },
  {
    what: "the crop rect's x sign",
    find: 'x: size.width / 2 - (viewport / 2 + x) / scale,',
    replace: 'x: size.width / 2 + (viewport / 2 + x) / scale,',
    breaks: 'the crop equals the region the viewport was showing',
  },
];
const rewrites = new Map(MUTATIONS.map(({ what }) => [what, 0]));
const restoreBugs = {
  name: 'selftest-restore-cropper-bugs',
  enforce: 'pre',
  transform(code, id) {
    const targets = [
      ['src/components/AvatarCropper.svelte', MUTATIONS[0]],
      ['src/lib/cropMath.ts', MUTATIONS[1]],
    ];
    for (const [suffix, mutation] of targets) {
      if (!id.endsWith(suffix)) continue;
      // Counted by occurrence, not by "the code changed": a pattern that no
      // longer matches must be reported as zero rewrites, not sailed past.
      const hits = code.split(mutation.find).length - 1;
      if (hits === 0) continue;
      rewrites.set(mutation.what, rewrites.get(mutation.what) + hits);
      return code.replaceAll(mutation.find, () => mutation.replace);
    }
    return null;
  },
};

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  plugins: SELFTEST ? [restoreBugs] : [],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.AVATAR_CROPPER_PROBE_PORT ?? '5220'),
    strictPort: false,
  },
});
await server.listen();
const teardown = () => server.close();
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const PROBE = new URL('scripts/avatar-cropper-probe.html', server.resolvedUrls.local[0]).href;

const browser = await createBrowser();
if (!browser) {
  console.warn('check:avatar-cropper — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npx playwright install chromium`.');
  await teardown();
  process.exit(0);
}

// Page-side helpers, injected as source text. Elements are found by role/text
// so the check reads like the unit tests do.
const FIND = `
  const viewport = document.querySelector('[role="img"]');
  const img = viewport && viewport.querySelector('img');
  const button = (label) => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === label);
  const centers = () => {
    const v = viewport.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return { vw: v.width, dx: i.left + i.width / 2 - (v.left + v.width / 2), dy: i.top + i.height / 2 - (v.top + v.height / 2), imgW: i.width };
  };
  const pointer = (id, x, y, type = 'pointermove') => viewport.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: type === 'pointerdown' ? id === 1 : undefined }));
  // Svelte applies state-driven DOM changes on a microtask; reading geometry in
  // the same tick as the dispatch would grade the placement from before it.
  const settle = () => new Promise(r => setTimeout(r, 30));
  const gesture = async (moves) => { for (const [id, x, y, type] of moves) pointer(id, x, y, type); await settle(); return centers(); };
`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

// Readiness is polled, not waited out: on a cold load the cropper mounts before
// the stylesheet applies, and grading that moment measures a preview squeezed
// into a pre-CSS viewport — the same squashed look the max-width arm exists to
// catch, arriving for an innocent reason. The gate is the viewport being laid
// out as a square, NOT the preview's width: the selftest's max-width bug is
// meant to squeeze the preview, and a gate that refused to start under it could
// never reach the arm that catches it.
const READY = `(() => {
  const v = document.querySelector('[role="img"]');
  const img = v && v.querySelector('img');
  return Boolean(v && img && v.getBoundingClientRect().width > 200);
})()`;

async function openProbe() {
  await browser.setViewport({ width: 1280, height: 900, mobile: false });
  await browser.goto(PROBE, { wait: 300 });
  for (let poll = 0; poll < 60; poll += 1) {
    if (await browser.eval(READY)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.error('\ncheck:avatar-cropper — FAILED: the cropper never mounted at %s', PROBE);
  await browser.close();
  await teardown();
  process.exit(1);
}

await openProbe();

const init = JSON.parse(
  await browser.eval(
    `(() => { ${FIND} return JSON.stringify({ hasViewport: !!viewport, hasImg: !!img, ...centers() }); })()`
  )
);
check(
  'the viewport measured and the image rendered',
  init.hasViewport === true && init.hasImg === true
);
check(
  'the preview starts centred on the viewport',
  Math.abs(init.dx) < 1 && Math.abs(init.dy) < 1,
  `dx=${init.dx.toFixed(2)} dy=${init.dy.toFixed(2)}`
);
// The synthetic source is 800x400, so the cover scale is set by its height.
const cover = init.vw / 400;
check(
  'the preview draws at cover scale',
  Math.abs(init.imgW - 800 * cover) < 2,
  `imgW=${init.imgW.toFixed(1)} expected=${(800 * cover).toFixed(1)}`
);

const drag = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    const v = viewport.getBoundingClientRect();
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
    return JSON.stringify(await gesture([[1, cx, cy, 'pointerdown'], [1, cx + 40, cy - 20], [1, cx + 40, cy - 20, 'pointerup']]));
  })()`)
);
// At cover scale the image has no vertical room, so the upward drag must clamp
// away while the horizontal move lands exactly.
check(
  'a drag pans by the pointer delta, clamped at the image edge',
  Math.abs(drag.dx - 40) < 1 && Math.abs(drag.dy) < 1,
  `dx=${drag.dx.toFixed(2)} dy=${drag.dy.toFixed(2)}`
);

const wheeled = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    await settle();
    return JSON.stringify(centers());
  })()`)
);
const zoomFactor = Math.exp(120 * 0.0015);
check(
  'the wheel zooms in',
  Math.abs(wheeled.imgW - 800 * cover * zoomFactor) < 2,
  `imgW=${wheeled.imgW.toFixed(1)} expected=${(800 * cover * zoomFactor).toFixed(1)}`
);

const diag = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    const v = viewport.getBoundingClientRect();
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
    return JSON.stringify(await gesture([[1, cx, cy, 'pointerdown'], [1, cx - 30, cy + 25], [1, cx - 30, cy + 25, 'pointerup']]));
  })()`)
);
check(
  'a drag after zoom pans on both axes',
  Math.abs(diag.dx - 10) < 1 && Math.abs(diag.dy - 25) < 1,
  `dx=${diag.dx.toFixed(2)} dy=${diag.dy.toFixed(2)}`
);

const pinched = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    const before = centers().imgW;
    const v = viewport.getBoundingClientRect();
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
    const after = await gesture([[1, cx - 20, cy, 'pointerdown'], [2, cx + 20, cy, 'pointerdown'], [2, cx + 60, cy], [1, cx - 20, cy, 'pointerup'], [2, cx + 60, cy, 'pointerup']]);
    return JSON.stringify({ ...after, before });
  })()`)
);
check(
  'a pinch doubles the zoom',
  Math.abs(pinched.imgW - pinched.before * 2) < 3,
  `imgW=${pinched.imgW.toFixed(1)} expected=${(pinched.before * 2).toFixed(1)}`
);

const slid = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    const slider = document.querySelector('input[type="range"]');
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    return JSON.stringify(centers());
  })()`)
);
check(
  'the zoom slider resets to cover scale',
  Math.abs(slid.imgW - 800 * cover) < 2,
  `imgW=${slid.imgW.toFixed(1)} expected=${(800 * cover).toFixed(1)}`
);

// The crop itself. The probe's verification maps the output pixels back through
// the rect and the rotation into the source image, so this asserts the one
// claim the whole component makes: the crop is what the viewport was showing.
const verdict = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    button('Crop').click();
    await new Promise(r => setTimeout(r, 50));
    return JSON.stringify(await window.__probe.cropAndVerify());
  })()`)
);
check(
  'the crop equals the region the viewport was showing',
  verdict.maxDeviation <= 40 && verdict.bad === 0,
  `max=${verdict.maxDeviation} bad=${verdict.bad}/${verdict.total} rect=${JSON.stringify(verdict.rect)} rotation=${verdict.rotation}`
);

// A quarter turn later: the rect is now in the rotated image's coordinate
// space, and the verification follows it there.
const rotated = JSON.parse(
  await browser.eval(`(async () => { ${FIND}
    button('Rotate 90 degrees clockwise').click();
    await settle();
    const v = viewport.getBoundingClientRect();
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
    await gesture([[1, cx, cy, 'pointerdown'], [1, cx + 25, cy], [1, cx + 25, cy, 'pointerup']]);
    button('Crop').click();
    await new Promise(r => setTimeout(r, 50));
    return JSON.stringify(await window.__probe.cropAndVerify());
  })()`)
);
check(
  'the rotated crop equals the region the viewport was showing',
  rotated.maxDeviation <= 40 && rotated.bad === 0,
  `max=${rotated.maxDeviation} bad=${rotated.bad}/${rotated.total} rect=${JSON.stringify(rotated.rect)} rotation=${rotated.rotation}`
);

await browser.close();
await teardown();

console.log('\ncheck:avatar-cropper — avatar cropper');
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const failed = results.filter((r) => !r.ok);
if (SELFTEST) {
  for (const { what, breaks } of MUTATIONS) {
    const applied = rewrites.get(what);
    if (applied !== 1) {
      console.error(
        `\ncheck:avatar-cropper --selftest — FAILED: rewrote ${String(applied)} call sites for ${what}, expected 1`
      );
      process.exit(1);
    }
    if (!failed.some((r) => r.name === breaks)) {
      console.error(
        `\ncheck:avatar-cropper --selftest — FAILED: "${breaks}" still passed with ${what} put back on its bug`
      );
      process.exit(1);
    }
  }
  console.log(
    `\ncheck:avatar-cropper --selftest — passed (${String(MUTATIONS.length)} restored bugs, each caught by the arm that names it)`
  );
  process.exit(0);
}

if (failed.length > 0) {
  console.error(`\ncheck:avatar-cropper — ${String(failed.length)} FAILED`);
  process.exit(1);
}
console.log('\ncheck:avatar-cropper — passed');
