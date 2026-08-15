#!/usr/bin/env node
// Avatar-cropper check: mounts the ACTUAL AvatarCropper.svelte (via
// scripts/avatar-cropper-probe.html) in headless Chrome over a source image of
// flat, named colours, and asserts what the unit tests cannot reach — in two
// tiers.
//
//   pnpm run check:avatar-cropper
//   node scripts/check-avatar-cropper.mjs --selftest
//
// The measuring tier reads where each gesture actually put the image, in pixels,
// against the frame it sits in. The comparing tier saves a crop and reads the
// same four points twice, once out of the file and once out of a screenshot.
// Neither tier subsumes the other: measuring catches a preview that moved by the
// wrong amount, comparing catches a preview and a crop that disagree however
// they got there — which is what happened, a pan sliding the image off the frame
// and uncovering the background while the file that came out was cropped
// correctly and told nobody.
//
// Colours are compared by name, because the saved file is lossy WebP and reads
// #ff0100 where the screenshot of the same pixel reads #ff0000.
//
// The measuring arms share one page and build on each other; each comparing arm
// that moves the image takes a fresh one, since nothing here puts the view back.
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

// Puts the component back on three bugs, each of which leaves the saved file
// perfect and only the display wrong — the asymmetry that makes the measuring
// arms worth their runtime, since every other arm here reads only the output.
// One per piece the transform is built from, which is why it is built in pieces.
const MUTATIONS = [
  {
    what: 'the image box sized in frame-widths',
    find: '`width: ${String(box.width * 100)}%; height: ${String(box.height * 100)}%; ` +',
    replace: '`width: 100%; height: 100%; ` +',
    breaks: 'what a pan saves is what it was showing',
  },
  {
    what: "the display's rotation",
    find: '`rotate(${String(rotation)}deg) ` +',
    replace: '`` +',
    breaks: 'what a turn saves is what it was showing',
  },
  {
    what: "the display's zoom",
    find: '`scale(${String(zoom)})`',
    replace: '``',
    breaks: 'the wheel zooms the image by what it was turned',
  },
];
const rewrites = new Map(MUTATIONS.map(({ what }) => [what, 0]));
const restoreBugs = {
  name: 'selftest-restore-cropper-display-bugs',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('src/components/AvatarCropper.svelte')) return null;
    let next = code;
    for (const mutation of MUTATIONS) {
      const hits = next.split(mutation.find).length - 1;
      if (hits === 0) continue;
      rewrites.set(mutation.what, rewrites.get(mutation.what) + hits);
      next = next.replaceAll(mutation.find, () => mutation.replace);
    }
    return next === code ? null : next;
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

// Inside the circle, so the mask's black does not darken what is compared, and
// off both midlines, which are where the source's colours meet and a sample
// lands on a blend of the two.
const POINTS = [
  [0.25, 0.3],
  [0.75, 0.3],
  [0.25, 0.7],
  [0.75, 0.7],
];

function named(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  if (r > 180 && g < 90 && b < 90) return 'red';
  if (b > 180 && r < 90 && g < 90) return 'blue';
  if (g > 180 && r < 90 && b < 90) return 'green';
  return hex;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

async function openProbe() {
  await browser.goto(PROBE, { wait: 300 });
  for (let poll = 0; poll < 60; poll += 1) {
    if (await browser.eval('window.__cropper?.ready?.() === true')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Infrastructure, not an assertion: nothing was measured, so filing it among
  // the arms would report a component nobody looked at as a badly behaved one.
  console.error('\ncheck:avatar-cropper — FAILED: the cropper never loaded its image at %s', PROBE);
  await browser.close();
  await teardown();
  process.exit(1);
}

/** Saves the crop, then reads the same four fractions out of the file and off the screen. */
async function saveAndSample() {
  await browser.eval(`(() => {
    window.__cropper.clear();
    [...document.querySelectorAll('dialog button')]
      .find((b) => b.textContent.trim() === 'Save').click();
  })()`);
  for (let poll = 0; poll < 60; poll += 1) {
    if (await browser.eval('window.__cropper.saved()')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const saved = JSON.parse(
    (await browser.eval(
      `window.__cropper.fromSaved(${JSON.stringify(POINTS)}).then(JSON.stringify)`
    )) ?? 'null'
  );
  if (saved === null) {
    return { size: 0, saved: [], screen: [] };
  }
  const shot = (await browser.screenshot()).toString('base64');
  const screen = JSON.parse(
    await browser.eval(
      `window.__cropper.fromScreen('data:image/png;base64,${shot}', ${JSON.stringify(POINTS)})` +
        `.then(JSON.stringify)`
    )
  );
  return { size: saved.size, saved: saved.colors.map(named), screen: screen.map(named) };
}

// Guarded on length as well as on the colours: two empty lists are equal, and an
// arm that measured nothing would otherwise report the agreement it never saw.
function agrees(a, b) {
  return a.length === POINTS.length && b.length === POINTS.length && a.every((c, i) => c === b[i]);
}

await browser.setViewport({ width: 900, height: 900, mobile: false });

// What the gestures do to the image, in pixels, before anything is saved. The
// colour arms further down prove the crop agrees with the display; these prove
// the display is where it was asked to be, which is what tells a crop that
// followed a wrong preview from one that followed a right one.
//
// One page load, read cumulatively: each arm starts from where the last left the
// image, and says so.
await openProbe();
const frame = JSON.parse(await browser.eval('JSON.stringify(window.__cropper.frame())'));
const geometry = async () =>
  JSON.parse(await browser.eval('JSON.stringify(window.__cropper.geometry())'));
// Svelte applies a state change on a microtask, so a read in the same tick as
// the gesture grades the placement from before it.
const settle = () => browser.eval('new Promise((r) => setTimeout(r, 30))');
const near = (value, wanted, slack = 1) => Math.abs(value - wanted) <= slack;

// A 400x200 source in a square frame: the short side fits, so the image is two
// frames wide and centred.
const start = await geometry();
check(
  'the preview starts centred, at the scale that covers the frame',
  near(start.dx, 0) && near(start.dy, 0) && near(start.width, frame.width * 2, 2),
  `dx=${start.dx.toFixed(1)} dy=${start.dy.toFixed(1)} width=${start.width.toFixed(1)} frame=${String(frame.width)}`
);

await browser.eval(
  `window.__cropper.drag([${String(frame.left + frame.width / 2)}, ${String(frame.top + frame.height / 2)}], ` +
    `[${String(frame.left + frame.width / 2 + 40)}, ${String(frame.top + frame.height / 2 - 30)}])`
);
await settle();
const dragged = await geometry();
check(
  'a drag moves the image by the pointer delta, and by nothing on the axis with no room',
  near(dragged.dx, 40) && near(dragged.dy, 0),
  `dx=${dragged.dx.toFixed(1)} dy=${dragged.dy.toFixed(1)}`
);

await browser.eval('window.__cropper.wheel(-125)');
await settle();
const wheeled = await geometry();
check(
  'the wheel zooms the image by what it was turned',
  near(wheeled.width, start.width * 1.5, 3),
  `width=${wheeled.width.toFixed(1)} wanted=${(start.width * 1.5).toFixed(1)}`
);

await browser.eval(
  `window.__cropper.pinch([${String(frame.left + frame.width / 2)}, ${String(frame.top + frame.height / 2)}], 100, 200, 25)`
);
await settle();
const pinched = await geometry();
check(
  'a pinch doubles the zoom and carries the image with the fingers',
  near(pinched.width, wheeled.width * 2, 4) && near(pinched.dx, dragged.dx + 25, 2),
  `width=${pinched.width.toFixed(1)} wanted=${(wheeled.width * 2).toFixed(1)}, dx=${pinched.dx.toFixed(1)} wanted=${String(dragged.dx + 25)}`
);

// Pushed out to where only the zoomed-in image has room, so the slider's return
// has something to pull back: at cover scale the pan stops at half a frame.
await browser.eval(
  `window.__cropper.drag([${String(frame.left + frame.width / 2)}, ${String(frame.top + frame.height / 2)}], ` +
    `[${String(frame.left + frame.width * 1.5)}, ${String(frame.top + frame.height / 2)}])`
);
await settle();
await browser.eval('window.__cropper.zoomTo(1)');
await settle();
const reset = await geometry();
check(
  'the slider returns it to cover scale, pulling the pan back inside',
  near(reset.width, start.width, 2) && near(reset.dx, frame.width / 2, 2) && near(reset.dy, 0),
  `width=${reset.width.toFixed(1)} dx=${reset.dx.toFixed(1)} dy=${reset.dy.toFixed(1)}`
);

// Untouched: a 400x200 source, red left half and blue right, crops to its middle
// 200 square — which is half of each.
await openProbe();
const plain = await saveAndSample();
check(
  'the saved square is the crop at its own resolution, not the frame it was drawn in',
  plain.size === 200,
  `${String(plain.size)}px from a ${String(frame.width)}px frame`
);
check(
  'untouched, it saves the middle of the image',
  JSON.stringify(plain.saved) === JSON.stringify(['red', 'blue', 'red', 'blue']),
  JSON.stringify(plain.saved)
);
check(
  'and the circle was showing that same square',
  agrees(plain.saved, plain.screen),
  `saved ${JSON.stringify(plain.saved)} vs shown ${JSON.stringify(plain.screen)}`
);

// Real key presses rather than dispatched events, so the focus and the keyboard
// are the browser's: twelve steps of a twentieth, past a limit of half a frame.
for (let press = 0; press < 12; press += 1) {
  await browser.press('ArrowLeft', { selector: '[role="group"]' });
}
const panned = await saveAndSample();
check(
  'arrow keys pan, and stop at the edge rather than past it',
  panned.saved.length === POINTS.length && panned.saved.every((color) => color === 'blue'),
  JSON.stringify(panned.saved)
);
check(
  'what a pan saves is what it was showing',
  agrees(panned.saved, panned.screen),
  `saved ${JSON.stringify(panned.saved)} vs shown ${JSON.stringify(panned.screen)}`
);

await openProbe();
await browser.eval(
  `window.__cropper.drag([${String(frame.left + frame.width / 2)}, ${String(
    frame.top + frame.height / 2
  )}], [${String(frame.left + frame.width * 1.5)}, ${String(frame.top + frame.height / 2)}])`
);
const draggedCrop = await saveAndSample();
check(
  'a drag moves the image under the circle',
  draggedCrop.saved.length === POINTS.length && draggedCrop.saved.every((color) => color === 'red'),
  JSON.stringify(draggedCrop.saved)
);
check(
  'what a drag saves is what it was showing',
  agrees(draggedCrop.saved, draggedCrop.screen),
  `saved ${JSON.stringify(draggedCrop.saved)} vs shown ${JSON.stringify(draggedCrop.screen)}`
);

await openProbe();
await browser.eval(`(() => {
  [...document.querySelectorAll('dialog button')]
    .find((b) => b.getAttribute('aria-label') === 'Rotate a quarter turn').click();
})()`);
const turned = await saveAndSample();
check(
  'a quarter turn saves the same content on its side',
  JSON.stringify(turned.saved) === JSON.stringify(['red', 'red', 'blue', 'blue']),
  JSON.stringify(turned.saved)
);
check(
  'what a turn saves is what it was showing',
  agrees(turned.saved, turned.screen),
  `saved ${JSON.stringify(turned.saved)} vs shown ${JSON.stringify(turned.screen)}`
);

await browser.close();
await teardown();

console.log(`\ncheck:avatar-cropper — crop frame ${String(frame.width)}px`);
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const failed = results.filter((r) => !r.ok);
if (SELFTEST) {
  for (const { what, breaks } of MUTATIONS) {
    // Zero here would mean the arms above ran against an unmodified component
    // and were green for that reason, which is the very thing the flag is for.
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
