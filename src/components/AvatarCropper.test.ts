import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AvatarCropper from './AvatarCropper.svelte';
import { coverScale, cropRect, rotatedSize } from '../lib/cropMath';

// jsdom lays nothing out, so the viewport measures as the rect stubbed here.
const VIEWPORT = 240;
const IMAGE = { width: 1000, height: 500 };

function props(overrides: Record<string, unknown> = {}) {
  return {
    src: 'blob:avatar',
    width: IMAGE.width,
    height: IMAGE.height,
    onconfirm: vi.fn(),
    oncancel: vi.fn(),
    ...overrides,
  };
}

function viewport(): HTMLElement {
  return screen.getByRole('img', { name: /crop preview/i });
}

function image(): HTMLImageElement {
  return viewport().querySelector('img') as HTMLImageElement;
}

/** The transform the component renders for the current pan/zoom/rotation. */
function transform(): string {
  return image().style.transform;
}

describe('AvatarCropper', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      window.DOMRect.fromRect({ width: VIEWPORT, height: VIEWPORT })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the image, zoom slider, rotate, and crop controls', () => {
    render(AvatarCropper, { props: props() });

    expect(image()).toHaveAttribute('src', 'blob:avatar');
    expect(screen.getByLabelText('Zoom')).toHaveAttribute('type', 'range');
    expect(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crop' })).toBeInTheDocument();
  });

  it('draws the image centered at cover scale', () => {
    render(AvatarCropper, { props: props() });

    const scale = coverScale(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0));
    expect(transform()).toBe(
      `translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(${scale})`
    );
  });

  it('pans with the drag', async () => {
    render(AvatarCropper, { props: props() });

    // At cover scale the image has no vertical room; zoom in first so both
    // axes can move.
    await fireEvent.input(screen.getByLabelText('Zoom'), { target: { value: '1.5' } });
    await fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 140, clientY: 90 });

    expect(transform()).toContain('translate(40px, -10px)');
  });

  it('stops a drag at the edge of the image', async () => {
    render(AvatarCropper, { props: props() });

    // Vertically the image fits exactly, so no amount of downward drag moves it.
    await fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 140, clientY: 400 });

    expect(transform()).toContain('translate(40px, 0px)');
  });

  it('keeps panning after a second pointer turns the drag into a pinch', async () => {
    render(AvatarCropper, { props: props() });
    const cover = coverScale(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0));

    await fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 140, clientY: 100 });
    expect(transform()).toContain('translate(40px, 0px)');

    // A second finger 40px out from the first opens to 80px: zoom doubles, and
    // the pinch's centroid drift adds its own pan.
    await fireEvent.pointerDown(viewport(), { pointerId: 2, clientX: 180, clientY: 100 });
    await fireEvent.pointerMove(viewport(), { pointerId: 2, clientX: 220, clientY: 100 });
    expect(transform()).toContain(`scale(${cover * 2})`);
    expect(transform()).toContain('translate(60px, 0px)');

    // Lifting one finger must re-anchor the remaining one where the pinch left
    // the image, not where that finger last started a drag.
    await fireEvent.pointerUp(viewport(), { pointerId: 2 });
    await fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 160, clientY: 100 });
    expect(transform()).toContain(`scale(${cover * 2})`);
    expect(transform()).toContain('translate(80px, 0px)');
  });

  it('zooms with the wheel and no further out than the cover scale', async () => {
    render(AvatarCropper, { props: props() });
    const cover = coverScale(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0));

    await fireEvent.wheel(viewport(), { deltaY: -120 });
    expect(transform()).toContain(`scale(${cover * Math.exp(0.18)})`);

    // Wheeling back out past 1x would open gaps around the image.
    await fireEvent.wheel(viewport(), { deltaY: 2000 });
    await fireEvent.wheel(viewport(), { deltaY: 2000 });
    expect(transform()).toContain(`scale(${cover})`);
  });

  it('zooms from the slider', async () => {
    render(AvatarCropper, { props: props() });
    const cover = coverScale(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0));

    await fireEvent.input(screen.getByLabelText('Zoom'), { target: { value: '2' } });

    expect(transform()).toContain(`scale(${cover * 2})`);
  });

  it('rotates in quarter turns', async () => {
    render(AvatarCropper, { props: props() });

    await fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(transform()).toContain('rotate(90deg)');

    await fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(transform()).toContain('rotate(0deg)');
  });

  it('pans with the keyboard, more with Shift', async () => {
    render(AvatarCropper, { props: props() });

    await fireEvent.keyDown(viewport(), { key: 'ArrowRight' });
    expect(transform()).toContain('translate(10px, 0px)');

    await fireEvent.keyDown(viewport(), { key: 'ArrowRight', shiftKey: true });
    expect(transform()).toContain('translate(50px, 0px)');

    await fireEvent.keyDown(viewport(), { key: 'ArrowUp' });
    expect(transform()).toContain('translate(50px, 0px)');
  });

  it('confirms with the crop rect the preview is showing', async () => {
    const onconfirm = vi.fn();
    render(AvatarCropper, { props: props({ onconfirm }) });

    await fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 140, clientY: 90 });
    await fireEvent.click(screen.getByRole('button', { name: 'Crop' }));

    const cover = coverScale(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0));
    expect(onconfirm).toHaveBeenCalledWith(
      cropRect(VIEWPORT, rotatedSize(IMAGE.width, IMAGE.height, 0), cover, 40, 0),
      0
    );
  });

  it('cancels', async () => {
    const oncancel = vi.fn();
    render(AvatarCropper, { props: props({ oncancel }) });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('disables its controls while saving', () => {
    render(AvatarCropper, { props: props({ saving: true }) });

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' })).toBeDisabled();
    expect(screen.getByLabelText('Zoom')).toBeDisabled();
  });
});

describe('AvatarCropper before the viewport measures', () => {
  // No rect stub: jsdom reports 0×0, which is exactly the unmeasured state.
  it('renders no image and refuses to confirm', () => {
    const onconfirm = vi.fn();
    render(AvatarCropper, { props: props({ onconfirm }) });

    expect(viewport().querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Crop' })).toBeDisabled();
  });
});
