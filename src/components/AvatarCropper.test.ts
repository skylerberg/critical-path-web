import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AvatarCropper from './AvatarCropper.svelte';

// jsdom implements neither, and the cropper shows the chosen file through one.
const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:cropper');
const revokeObjectURL = vi.fn();
vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));

const FRAME = 300;
const LANDSCAPE = { width: 400, height: 200 };

function chosen(name = 'face.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

interface Harness {
  container: HTMLElement;
  onsave: ReturnType<typeof vi.fn>;
  oncancel: ReturnType<typeof vi.fn>;
  rerender: (props: Record<string, unknown>) => Promise<void>;
}

function open(props: Record<string, unknown> = {}): Harness {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  const { container, rerender } = render(AvatarCropper, {
    file: chosen(),
    onsave,
    oncancel,
    ...props,
  });
  const frame = container.querySelector('[role="group"]');
  // jsdom has no layout, and the drag converts pixels to fractions of this.
  if (frame !== null) frame.getBoundingClientRect = () => new DOMRect(0, 0, FRAME, FRAME);
  return { container, onsave, oncancel, rerender };
}

function frame(): HTMLElement {
  return screen.getByRole('group', { name: 'Crop area' });
}

function picture(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img');
  if (img === null) throw new Error('the cropper is showing no image');
  return img;
}

/** Loads the image the way a browser would, since jsdom fetches nothing. */
async function loads(
  container: HTMLElement,
  size: { width: number; height: number } = LANDSCAPE
): Promise<HTMLImageElement> {
  const img = picture(container);
  Object.defineProperty(img, 'naturalWidth', { value: size.width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: size.height, configurable: true });
  await fireEvent.load(img);
  return img;
}

/**
 * What the frame is actually showing, read back off the transform and put in the
 * units the geometry uses. The image is laid out at its own size in frame-widths
 * — two of them across for the 2:1 fixture — so its translate percentages are of
 * that, and `box` is what turns them back into percentages of the frame.
 */
function shown(
  container: HTMLElement,
  box = { width: 2, height: 1 }
): { x: number; y: number; zoom: number; rotation: number } {
  const img = picture(container);
  const translate = /translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(img.style.transform);
  const scale = /scale\((-?[\d.]+)\)/.exec(img.style.transform);
  const rotate = /rotate\((-?[\d.]+)deg\)/.exec(img.style.transform);
  return {
    x: Number(translate?.[1]) * box.width,
    y: Number(translate?.[2]) * box.height,
    zoom: Number(scale?.[1]),
    rotation: Number(rotate?.[1]),
  };
}

async function dragBy(x: number, y: number): Promise<void> {
  const surface = frame();
  await fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
  await fireEvent.pointerMove(surface, { pointerId: 1, clientX: 100 + x, clientY: 100 + y });
  await fireEvent.pointerUp(surface, { pointerId: 1, clientX: 100 + x, clientY: 100 + y });
}

function slider(): HTMLInputElement {
  return screen.getByRole('slider', { name: 'Zoom' });
}

/** The label doubles as the progress indicator, so both spellings are this one button. */
function save(): HTMLElement {
  return screen.getByRole('button', { name: /^Sav(e|ing)/ });
}

/** jsdom has no 2D context and encodes nothing; the geometry is proved in image-crop.test.ts. */
function stubCanvas(type = 'image/webp'): { drawn: () => boolean } {
  let drew = false;
  const ctx = {
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => (drew = true),
    imageSmoothingQuality: 'low',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['cropped'], { type }));
  });
  return { drawn: () => drew };
}

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe('AvatarCropper', () => {
  it('stays shut until a file is chosen, and opens on one', async () => {
    const { container, rerender } = open({ file: null });
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();

    await rerender({ file: chosen() });
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(picture(container).src).toBe('blob:cropper');
  });

  it('will not save an image it has not measured yet', async () => {
    const { container } = open();
    expect(save()).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading image' })).toBeInTheDocument();

    await loads(container);
    expect(save()).toBeEnabled();
    expect(screen.queryByRole('status', { name: 'Loading image' })).toBeNull();
  });

  it('says so rather than cropping an image the browser could not decode', async () => {
    const { container } = open();
    await fireEvent.error(picture(container));

    expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
    expect(save()).toBeDisabled();
  });

  it('drags in fractions of the frame, whatever size the frame is drawn at', async () => {
    const { container } = open();
    await loads(container);

    await dragBy(FRAME * 0.2, 0);

    expect(shown(container).x).toBeCloseTo(20);
  });

  it('holds the image against its edge rather than dragging past it', async () => {
    const { container } = open();
    await loads(container);

    // A 400x200 image at zoom 1 has 200px of slack across and none down.
    await dragBy(FRAME, FRAME);

    expect(shown(container)).toMatchObject({ x: 50, y: 0 });
  });

  it('zooms from the slider, and pulls the pan back in when it zooms out again', async () => {
    const { container } = open();
    await loads(container);

    await fireEvent.input(slider(), { target: { value: '2' } });
    // Zoom 2 halves the crop, so a 400x200 image has three frame-widths of slack.
    await dragBy(FRAME * 2, 0);
    expect(shown(container)).toMatchObject({ zoom: 2, x: 150 });

    await fireEvent.input(slider(), { target: { value: '1' } });
    expect(shown(container)).toMatchObject({ zoom: 1, x: 50 });
  });

  it('turns the image a quarter at a time, carrying the pan onto the other axis', async () => {
    const { container } = open();
    await loads(container);
    await dragBy(FRAME * 0.5, 0);
    expect(shown(container)).toMatchObject({ rotation: 0, x: 50, y: 0 });

    await fireEvent.click(screen.getByRole('button', { name: 'Rotate a quarter turn' }));

    // Upright the image is 400x200 and only x can move; on its side it is 200x400
    // and only y can, so a pan that stayed on x would have been thrown away.
    expect(shown(container)).toMatchObject({ rotation: 90, x: 0, y: 50 });
  });

  it('pans by keyboard for anyone not dragging', async () => {
    const { container } = open();
    await loads(container);

    // Left twice takes the image left, the way dragging it there would.
    await fireEvent.keyDown(frame(), { key: 'ArrowLeft' });
    await fireEvent.keyDown(frame(), { key: 'ArrowLeft' });
    expect(shown(container).x).toBeCloseTo(-10);

    await fireEvent.keyDown(frame(), { key: '+' });
    expect(shown(container).zoom).toBeCloseTo(1.1);
  });

  it('hands back the cropped image as a file named for what was encoded', async () => {
    const canvas = stubCanvas();
    const { container, onsave } = open();
    await loads(container);

    await fireEvent.click(save());

    expect(canvas.drawn()).toBe(true);
    const [file] = onsave.mock.calls[0] as [File];
    expect(file.name).toBe('avatar.webp');
    expect(file.type).toBe('image/webp');
    expect(await file.text()).toBe('cropped');
  });

  it('reports a crop the canvas refused instead of sending nothing', async () => {
    stubCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(null);
    });
    const { container, onsave } = open();
    await loads(container);

    await fireEvent.click(save());

    expect(onsave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be cropped');
  });

  it('locks the controls while the upload it fed is running', async () => {
    const { container } = open({ saving: true });
    await loads(container);

    expect(save()).toBeDisabled();
    expect(save()).toHaveTextContent('Saving…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(slider()).toBeDisabled();
  });

  it('shows the failure of that upload where the dialog covers the page', async () => {
    const { container } = open({ error: 'That image is too large (max 10 MB)' });
    await loads(container);

    expect(screen.getByRole('alert')).toHaveTextContent('That image is too large (max 10 MB)');
    expect(save()).toBeEnabled();
  });

  it('cancels without saving', async () => {
    const { container, oncancel, onsave } = open();
    await loads(container);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(oncancel).toHaveBeenCalledOnce();
    expect(onsave).not.toHaveBeenCalled();
  });

  it('starts the next image from the top, and lets go of the last one', async () => {
    const { container, rerender } = open();
    await loads(container);
    await fireEvent.input(slider(), { target: { value: '2' } });
    await dragBy(FRAME, 0);

    await rerender({ file: chosen('other.png') });
    await loads(container, { width: 300, height: 300 });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cropper');
    expect(shown(container, { width: 1, height: 1 })).toMatchObject({
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
    });
  });
});
