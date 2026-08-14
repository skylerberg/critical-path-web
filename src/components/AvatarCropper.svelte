<script lang="ts">
  import {
    MAX_ZOOM,
    MIN_ZOOM,
    clampOffset,
    croppedFile,
    renderCrop,
    type Offset,
    type Rotation,
    type Size,
  } from '../lib/image-crop';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    /** The image being adjusted; null closes the dialog. */
    file: File | null;
    /** The upload the saved crop feeds, so the dialog stays up while it runs. */
    saving?: boolean;
    /** How that upload failed, if it did. */
    error?: string | null;
    onsave: (file: File) => void;
    oncancel: () => void;
  }

  let { file, saving = false, error = null, onsave, oncancel }: Props = $props();

  const ZOOM_STEP = 0.1;
  const WHEEL_ZOOM_PER_PIXEL = 0.004;
  /** One arrow press moves the image a twentieth of the frame. */
  const PAN_STEP = 0.05;

  const uid = $props.id();

  let url = $state<string | null>(null);
  let image = $state<Size | null>(null);
  let rotation = $state<Rotation>(0);
  let zoom = $state(MIN_ZOOM);
  let offset = $state<Offset>({ x: 0, y: 0 });
  let failure = $state<string | null>(null);
  let rendering = $state(false);

  let frameElement = $state<HTMLElement | null>(null);
  let imageElement = $state<HTMLImageElement | null>(null);

  // Plain bindings, not $state: pointer bookkeeping is read inside the listener
  // that just wrote it, and nothing renders from it.
  let pointers: { id: number; x: number; y: number }[] = [];
  let drag: { x: number; y: number; offset: Offset } | null = null;
  let pinch: { distance: number; zoom: number } | null = null;

  $effect(() => {
    const chosen = file;
    if (chosen === null) {
      url = null;
      return;
    }
    const objectUrl = URL.createObjectURL(chosen);
    url = objectUrl;
    image = null;
    rotation = 0;
    zoom = MIN_ZOOM;
    offset = { x: 0, y: 0 };
    failure = null;
    pointers = [];
    drag = null;
    pinch = null;
    return () => URL.revokeObjectURL(objectUrl);
  });

  const busy = $derived(saving || rendering);
  const ready = $derived(image !== null && !busy);
  /**
   * The image's own size in frame-widths, before any turn: its short side is one
   * frame, which is what `zoom: 1` means, and its long side hangs over. A quarter
   * turn swaps which one hangs over without changing either number, so this is
   * the divisor that keeps `offset` — which is in frame-widths, along the screen's
   * axes — meaning the same thing at every rotation.
   */
  const box = $derived.by(() => {
    if (image === null) return { width: 1, height: 1 };
    const short = Math.min(image.width, image.height);
    return { width: image.width / short, height: image.height / short };
  });

  const layout = $derived(
    `width: ${String(box.width * 100)}%; height: ${String(box.height * 100)}%; ` +
      `transform: translate(${String((offset.x / box.width) * 100)}%, ${String((offset.y / box.height) * 100)}%) ` +
      `rotate(${String(rotation)}deg) scale(${String(zoom)})`
  );
  // Only one of the two can be set: each save clears its own before running, and
  // an upload only happens once a render has succeeded. Neither is shown with no
  // file: a closed <dialog> is still in the page, and a message inside it would
  // be read out twice by anything counting text rather than looking.
  const message = $derived(file === null ? null : (failure ?? error));

  function setOffset(next: Offset): void {
    offset = image === null ? { x: 0, y: 0 } : clampOffset({ image, rotation, zoom, offset: next });
  }

  function setZoom(next: number): void {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    // Zooming out shrinks the room to pan, so the offset it leaves may be outside it.
    setOffset(offset);
  }

  function rotate(): void {
    rotation = ((rotation + 90) % 360) as Rotation;
    // The pan turns with the image, which keeps whatever was framed framed: at
    // zoom 1 only the long side can pan, and a quarter turn is what swaps which
    // side that is.
    setOffset({ x: -offset.y, y: offset.x });
  }

  function loaded(): void {
    const element = imageElement;
    if (element === null || element.naturalWidth === 0 || element.naturalHeight === 0) {
      failure = 'That image could not be read.';
      return;
    }
    image = { width: element.naturalWidth, height: element.naturalHeight };
  }

  function frameSize(): number {
    return frameElement?.getBoundingClientRect().width ?? 0;
  }

  /** Moves a pointer already down; false if this one is not one of ours. */
  function track(event: PointerEvent): boolean {
    const known = pointers.find((pointer) => pointer.id === event.pointerId);
    if (known === undefined) return false;
    known.x = event.clientX;
    known.y = event.clientY;
    return true;
  }

  function separation(): number {
    const [first, second] = pointers;
    if (first === undefined || second === undefined) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function pointerDown(event: PointerEvent): void {
    if (!ready) return;
    frameElement?.setPointerCapture(event.pointerId);
    if (!track(event)) {
      pointers.push({ id: event.pointerId, x: event.clientX, y: event.clientY });
    }
    if (pointers.length === 2) {
      drag = null;
      pinch = { distance: separation(), zoom };
    } else if (pointers.length === 1) {
      drag = { x: event.clientX, y: event.clientY, offset };
    }
  }

  function pointerMove(event: PointerEvent): void {
    if (!track(event)) return;
    event.preventDefault();
    if (pinch !== null && pointers.length >= 2) {
      const distance = separation();
      if (pinch.distance > 0 && distance > 0) setZoom((pinch.zoom * distance) / pinch.distance);
      return;
    }
    if (drag === null) return;
    const size = frameSize();
    if (size === 0) return;
    setOffset({
      x: drag.offset.x + (event.clientX - drag.x) / size,
      y: drag.offset.y + (event.clientY - drag.y) / size,
    });
  }

  function pointerUp(event: PointerEvent): void {
    pointers = pointers.filter((pointer) => pointer.id !== event.pointerId);
    if (pointers.length < 2) pinch = null;
    // A finger lifted out of a pinch leaves the other one down, and the drag it
    // resumes has to start from where that finger is now rather than from where
    // the gesture began.
    const [remaining] = pointers;
    drag = remaining === undefined ? null : { x: remaining.x, y: remaining.y, offset };
  }

  function wheel(event: WheelEvent): void {
    if (!ready) return;
    event.preventDefault();
    setZoom(zoom - event.deltaY * WHEEL_ZOOM_PER_PIXEL);
  }

  function keydown(event: KeyboardEvent): void {
    if (!ready) return;
    switch (event.key) {
      // The image moves the way the arrow points, which is the direction a drag
      // that way would have taken it.
      case 'ArrowLeft':
        setOffset({ x: offset.x - PAN_STEP, y: offset.y });
        break;
      case 'ArrowRight':
        setOffset({ x: offset.x + PAN_STEP, y: offset.y });
        break;
      case 'ArrowUp':
        setOffset({ x: offset.x, y: offset.y - PAN_STEP });
        break;
      case 'ArrowDown':
        setOffset({ x: offset.x, y: offset.y + PAN_STEP });
        break;
      case '+':
      case '=':
        setZoom(zoom + ZOOM_STEP);
        break;
      case '-':
      case '_':
        setZoom(zoom - ZOOM_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  async function save(): Promise<void> {
    const source = imageElement;
    if (image === null || source === null || busy) return;
    rendering = true;
    failure = null;
    try {
      onsave(croppedFile(await renderCrop(source, { image, rotation, zoom, offset })));
    } catch {
      failure = 'That image could not be cropped. Try another one.';
    } finally {
      rendering = false;
    }
  }
</script>

<Modal open={file !== null} title="Adjust your image" onclose={busy ? undefined : oncancel}>
  <p class="mb-3 text-sm text-muted" id="{uid}-hint">
    Drag the image to choose what sits inside the circle, and zoom or turn it below. Arrow keys move
    it too.
  </p>

  <!-- No ARIA role describes a surface you pan an image on, and the two that would
       silence the warnings below both announce something untrue — `button` promises
       an activation this has none of. So: a named group that takes focus, which is
       what puts the arrow keys within reach of someone not using a pointer, plus a
       zoom slider and a rotate button that need no gesture at all. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={frameElement}
    role="group"
    tabindex="0"
    aria-label="Crop area"
    aria-describedby="{uid}-hint"
    class="focus-ring relative mx-auto aspect-square w-full max-w-80 touch-none overflow-hidden rounded-lg bg-canvas select-none"
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerUp}
    onwheel={wheel}
    onkeydown={keydown}
  >
    {#if url !== null}
      <div class="absolute inset-0 flex items-center justify-center">
        <!-- Sized in frame-widths, so the image hangs over the frame on its long
             side and a pan reveals more of it. Given the frame's own size instead
             it would move off the frame and expose the background behind it — and
             then the circle shows one square while the canvas crops another. -->
        <img
          bind:this={imageElement}
          src={url}
          alt=""
          draggable="false"
          class="max-w-none shrink-0 object-cover {image === null ? 'opacity-0' : ''}"
          style={layout}
          onload={loaded}
          onerror={() => (failure = 'That image could not be read.')}
        />
      </div>
    {/if}
    <div
      class="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-white/70"
    ></div>
    {#if image === null && failure === null}
      <div class="absolute inset-0 flex items-center justify-center">
        <Spinner label="Loading image" />
      </div>
    {/if}
  </div>

  <div class="mt-4 flex items-center gap-3">
    <Button
      variant="secondary"
      class="px-0"
      disabled={!ready}
      onclick={rotate}
      aria-label="Rotate a quarter turn"
    >
      <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke-linecap="round" />
        <path d="M20 4v4h-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </Button>
    <label class="flex flex-1 items-center gap-2 text-sm text-muted">
      <span class="sr-only">Zoom</span>
      <span aria-hidden="true">−</span>
      <input
        type="range"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step="0.01"
        value={zoom}
        disabled={!ready}
        class="focus-ring h-11 min-w-0 flex-1 accent-accent"
        oninput={(event) => setZoom(event.currentTarget.valueAsNumber)}
      />
      <span aria-hidden="true">+</span>
    </label>
  </div>

  {#if message !== null}
    <p role="alert" class="mt-3 text-sm text-danger">{message}</p>
  {/if}

  {#snippet footer()}
    <Button variant="secondary" disabled={busy} onclick={oncancel}>Cancel</Button>
    <Button disabled={!ready} onclick={save}>{busy ? 'Saving…' : 'Save'}</Button>
  {/snippet}
</Modal>
