<script lang="ts">
  import type { CropRect } from '../lib/cropMath';
  import { clampOffset, coverScale, cropRect, rotatedSize } from '../lib/cropMath';
  import Button from './ui/Button.svelte';

  interface Props {
    /** Object URL of the image to crop. */
    src: string;
    /** Natural pixel size of the image, as measured when it was loaded. */
    width: number;
    height: number;
    /** True while the caller is uploading the confirmed crop. */
    saving?: boolean;
    onconfirm: (rect: CropRect, rotation: number) => void;
    oncancel: () => void;
  }

  let { src, width, height, saving = false, onconfirm, oncancel }: Props = $props();

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;

  const uid = $props.id();

  let viewportEl = $state<HTMLDivElement | null>(null);
  /** Square viewport size in CSS px, measured rather than bound: bindable
   * element sizes need an API test runners lack, and an imperative read keeps
   * the measurement honest under late-arriving CSS (see the effect below). */
  let viewport = $state(0);
  let zoom = $state(1);
  let rotation = $state(0);
  let offset = $state({ x: 0, y: 0 });

  const rotated = $derived(rotatedSize(width, height, rotation));
  const scale = $derived(viewport > 0 ? coverScale(viewport, rotated) * zoom : 0);
  /** The offset actually rendered — the raw one can drift past the clamp when
   * zoom or rotation shrinks the room it has. */
  const placed = $derived(
    viewport > 0 ? clampOffset(viewport, rotated, scale, offset.x, offset.y) : { x: 0, y: 0 }
  );
  const transform = $derived(
    `translate(-50%, -50%) translate(${placed.x}px, ${placed.y}px) rotate(${rotation}deg) scale(${scale})`
  );

  $effect(() => {
    const measure = () => {
      const rect = viewportEl?.getBoundingClientRect();
      if (rect && rect.width > 0) viewport = rect.width;
    };
    measure();
    // A mount-time read can race the stylesheet: the cropper often mounts before
    // the sizing classes have applied, and no window resize ever follows to
    // correct it. ResizeObserver catches that and any later reflow; where the
    // API is absent (test runners), the mount read plus window resize is the
    // best available.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      if (viewportEl) observer.observe(viewportEl);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  function setZoom(next: number): void {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    offset = clampOffset(viewport, rotated, scale, offset.x, offset.y);
  }

  function rotate(): void {
    rotation = (rotation + 90) % 360;
    offset = clampOffset(viewport, rotated, scale, offset.x, offset.y);
  }

  /** Pointers currently down on the viewport, so a second finger turns a pan
   * into a pinch. Plain bookkeeping: nothing renders from it. */
  let pointers: { id: number; x: number; y: number }[] = [];
  let pan: { x: number; y: number; ox: number; oy: number } | null = null;
  let pinch: {
    dist: number;
    zoom: number;
    cx: number;
    cy: number;
    ox: number;
    oy: number;
  } | null = null;

  /** Re-derive the gesture baseline from the pointers currently down, always
   * from the displayed placement so a clamp that happened mid-gesture is not
   * undone by the next move. */
  function restartGesture(): void {
    pan = null;
    pinch = null;
    const [a, b] = pointers;
    if (a === undefined) return;
    if (b === undefined) {
      pan = { x: a.x, y: a.y, ox: placed.x, oy: placed.y };
      return;
    }
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      zoom,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      ox: placed.x,
      oy: placed.y,
    };
  }

  function onpointerdown(event: PointerEvent): void {
    if (viewport <= 0) return;
    // Capture so a drag leaving the viewport keeps reporting moves. The spec
    // throws NotFoundError for a pointer the browser does not consider active,
    // which synthetic events never are — and the gesture itself must survive
    // without capture, since its handlers live on this element either way.
    try {
      viewportEl?.setPointerCapture?.(event.pointerId);
    } catch {
      // no capture; pointer events still reach the handlers below
    }
    pointers = [...pointers, { id: event.pointerId, x: event.clientX, y: event.clientY }];
    restartGesture();
  }

  function onpointermove(event: PointerEvent): void {
    if (!pointers.some((p) => p.id === event.pointerId)) return;
    pointers = pointers.map((p) =>
      p.id === event.pointerId ? { ...p, x: event.clientX, y: event.clientY } : p
    );
    const [a, b] = pointers;
    if (b === undefined) {
      if (pan !== null) {
        offset = clampOffset(viewport, rotated, scale, pan.ox + a.x - pan.x, pan.oy + a.y - pan.y);
      }
    } else if (pinch !== null) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) {
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pinch.zoom * dist) / pinch.dist));
      }
      offset = clampOffset(
        viewport,
        rotated,
        scale,
        pinch.ox + (a.x + b.x) / 2 - pinch.cx,
        pinch.oy + (a.y + b.y) / 2 - pinch.cy
      );
    }
  }

  function endPointer(event: PointerEvent): void {
    pointers = pointers.filter((p) => p.id !== event.pointerId);
    restartGesture();
  }

  function onwheel(event: WheelEvent): void {
    if (viewport <= 0) return;
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * 0.0015));
  }

  function onkeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 10;
    switch (event.key) {
      case 'ArrowLeft':
        offset = clampOffset(viewport, rotated, scale, placed.x - step, placed.y);
        break;
      case 'ArrowRight':
        offset = clampOffset(viewport, rotated, scale, placed.x + step, placed.y);
        break;
      case 'ArrowUp':
        offset = clampOffset(viewport, rotated, scale, placed.x, placed.y - step);
        break;
      case 'ArrowDown':
        offset = clampOffset(viewport, rotated, scale, placed.x, placed.y + step);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function confirm(): void {
    if (viewport <= 0) return;
    onconfirm(cropRect(viewport, rotated, scale, placed.x, placed.y), rotation);
  }
</script>

<div class="flex flex-col gap-3">
  <!-- The viewport is a manipulable preview rather than a form control: role="img"
       says what it shows, the label names every way to steer it, and the gesture
       handlers are the point of the element — arrow keys pan for anyone without a
       pointer, so it stays focusable despite the role. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={viewportEl}
    role="img"
    tabindex="0"
    aria-label="Crop preview. Drag or use arrow keys to reposition; scroll, pinch or use the zoom slider."
    class="focus-ring relative mx-auto aspect-square w-full max-w-72 cursor-grab touch-none overflow-hidden rounded-full bg-black select-none active:grabbing"
    {onpointerdown}
    {onpointermove}
    onpointerup={endPointer}
    onpointercancel={endPointer}
    {onwheel}
    {onkeydown}
  >
    {#if scale > 0}
      <!-- max-width none: the stylesheet's reset clamps every img to its
           container, which squeezes the preview out of the size the transform
           math below is written for — a gap that only shows up in a real
           browser, because jsdom never lays anything out. -->
      <img
        {src}
        alt=""
        draggable="false"
        class="absolute left-1/2 top-1/2"
        style:max-width="none"
        style:width="{width}px"
        style:height="{height}px"
        style:transform
      />
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <label for="cropper-zoom-{uid}" class="shrink-0 text-sm text-muted">Zoom</label>
    <input
      id="cropper-zoom-{uid}"
      type="range"
      class="h-11 min-w-11 flex-1 accent-accent"
      min={MIN_ZOOM}
      max={MAX_ZOOM}
      step="0.01"
      value={zoom}
      aria-valuetext="{Math.round(zoom * 100)}%"
      disabled={saving}
      oninput={(event) => setZoom(event.currentTarget.valueAsNumber)}
    />
    <Button
      variant="secondary"
      class="shrink-0"
      aria-label="Rotate 90 degrees clockwise"
      disabled={saving}
      onclick={rotate}
    >
      <svg
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M20 4v4h-4" />
      </svg>
    </Button>
  </div>
  <div class="flex justify-end gap-2">
    <Button variant="secondary" disabled={saving} onclick={() => oncancel()}>Cancel</Button>
    <Button disabled={saving || scale <= 0} onclick={confirm}>
      {saving ? 'Saving…' : 'Crop'}
    </Button>
  </div>
</div>
