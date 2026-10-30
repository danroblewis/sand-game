// Pointer (mouse + touch + pen) drag input via Pointer Events.
import type { Box, GameState } from '../core/types';
import { moveBoxToward } from '../core';
import type { Renderer, View } from '../render/renderer';

export interface PointerDeps {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  getState: () => GameState;
  view: View;
  /** Return true to ignore input (e.g. a modal overlay is open). */
  isBlocked?: () => boolean;
}

/** Extra grab radius around boxes, in CSS px, by pointer type. */
const HIT_SLOP: Record<string, number> = { touch: 14, pen: 8, mouse: 3 };

interface DragInfo {
  pointerId: number;
  boxId: number;
  state: GameState;
  offX: number;
  offY: number;
  moved: boolean;
}

const noCtxFn = (e: Event) => e.preventDefault();

/** Attach pointer handlers. Returns a detach function. */
export function attachPointer(deps: PointerDeps): () => void {
  const { canvas, renderer, getState, view } = deps;
  canvas.style.touchAction = 'none';
  let drag: DragInfo | null = null;

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const findBox = (state: GameState, id: number): Box | undefined => state.boxes.find((b) => b.id === id);

  const endDrag = () => {
    const d = drag;
    if (!d) return;
    drag = null;
    view.dragBoxId = null;
    // Release: conveyors may carry the box again.
    if (d.state.heldBoxId === d.boxId) d.state.heldBoxId = null;
    if (d.moved && d.state === getState()) d.state.moves += 1;
    if (canvas.hasPointerCapture(d.pointerId)) canvas.releasePointerCapture(d.pointerId);
  };

  const updateHover = (px: number, py: number) => {
    const b = renderer.boxAtPixel(getState(), px, py);
    const movable = b && b.frozen === 0 ? b : undefined;
    view.hoverBoxId = movable ? movable.id : null;
    canvas.style.cursor = drag ? 'grabbing' : movable ? 'grab' : 'default';
  };

  const onDown = (e: PointerEvent) => {
    if (deps.isBlocked?.()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag) return; // ignore extra fingers
    const state = getState();
    if (state.hero) return; // hero levels: boxes are pushed by the hero (see input/hero.ts)
    const { px, py } = local(e);
    const box = renderer.boxAtPixel(state, px, py, HIT_SLOP[e.pointerType] ?? 6);
    if (!box) {
      view.selectedBoxId = null;
      return;
    }
    if (box.frozen > 0) return;
    e.preventDefault();
    const g = renderer.pixelToGrid(px, py);
    drag = { pointerId: e.pointerId, boxId: box.id, state, offX: g.x - box.x, offY: g.y - box.y, moved: false };
    view.selectedBoxId = box.id;
    view.dragBoxId = box.id;
    // Held boxes are never carried by conveyors (and block boxes behind them).
    state.heldBoxId = box.id;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onMove = (e: PointerEvent) => {
    const { px, py } = local(e);
    if (!drag) {
      if (e.pointerType === 'mouse' && !getState().hero) updateHover(px, py);
      else if (getState().hero) view.hoverBoxId = null;
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    const state = getState();
    const box = state === drag.state ? findBox(state, drag.boxId) : undefined;
    if (!box || box.state !== 'active' || box.frozen > 0) {
      endDrag();
      return;
    }
    const g = renderer.pixelToGrid(px, py);
    // Round (rather than floor) so the box follows the finger with half-cell hysteresis.
    const tx = Math.round(g.x - drag.offX);
    const ty = Math.round(g.y - drag.offY);
    if (tx !== box.x || ty !== box.y) {
      if (moveBoxToward(state, box.id, tx, ty) > 0) drag.moved = true;
    }
  };

  const onUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pointerId) {
      endDrag();
      const { px, py } = local(e);
      if (e.pointerType === 'mouse') updateHover(px, py);
    }
  };

  const onLeave = () => {
    if (!drag) {
      view.hoverBoxId = null;
      canvas.style.cursor = 'default';
    }
  };

  // iOS Safari: stop the canvas from scrolling, zooming, pull-to-refresh, or showing the callout.
  // Pointer events still fire after preventDefault on touch events.
  const stopTouch = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };
  canvas.addEventListener('touchstart', stopTouch, { passive: false });
  canvas.addEventListener('touchmove', stopTouch, { passive: false });
  canvas.addEventListener('touchend', stopTouch, { passive: false });
  canvas.addEventListener('dblclick', noCtxFn);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', noCtxFn);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('contextmenu', noCtxFn);
    canvas.removeEventListener('dblclick', noCtxFn);
    canvas.removeEventListener('touchstart', stopTouch);
    canvas.removeEventListener('touchmove', stopTouch);
    canvas.removeEventListener('touchend', stopTouch);
  };
}
