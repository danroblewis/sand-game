// Keyboard controls: Tab cycles selection, arrows move, Esc deselects, R/N/[/] level control.
import type { GameState } from '../core/types';
import { movableBoxes, tryMoveBox } from '../core';
import type { View } from '../render/renderer';

export interface KeyboardActions {
  restart: () => void;
  next: () => void;
  prev: () => void;
  /** True when playing a generated level (N then means "new random level" even before winning). */
  isRandom?: () => boolean;
}

export interface KeyboardDeps {
  getState: () => GameState;
  view: View;
  actions: KeyboardActions;
  /** Return true to ignore game keys (e.g. a modal overlay is open). */
  isBlocked?: () => boolean;
}

let lastSelected: { id: number; x: number; y: number } | null = null;

/**
 * Keep the selection valid: if the selected box was removed or is frozen, move the selection to
 * the next movable box in tab order (after the old box's position, wrapping). Call once per frame.
 */
export function fixSelection(state: GameState, view: View): void {
  if (view.selectedBoxId === null) {
    lastSelected = null;
    return;
  }
  const sel = state.boxes.find((b) => b.id === view.selectedBoxId);
  if (sel && sel.state === 'active' && sel.frozen === 0) {
    lastSelected = { id: sel.id, x: sel.x, y: sel.y };
    return;
  }
  const ref = sel ?? (lastSelected && lastSelected.id === view.selectedBoxId ? lastSelected : null);
  const list = movableBoxes(state);
  if (list.length === 0) {
    view.selectedBoxId = null;
    lastSelected = null;
    return;
  }
  let next = list[0];
  if (ref) {
    const after = list.find((b) => b.y > ref.y || (b.y === ref.y && b.x > ref.x));
    if (after) next = after;
  }
  view.selectedBoxId = next.id;
  if (view.dragBoxId !== null && view.dragBoxId !== next.id) view.dragBoxId = null;
  lastSelected = { id: next.id, x: next.x, y: next.y };
}

function cycle(state: GameState, view: View, dir: 1 | -1): void {
  const list = movableBoxes(state);
  if (list.length === 0) {
    view.selectedBoxId = null;
    return;
  }
  const i = list.findIndex((b) => b.id === view.selectedBoxId);
  let j: number;
  if (i < 0) j = dir > 0 ? 0 : list.length - 1;
  else j = (i + dir + list.length) % list.length;
  view.selectedBoxId = list[j].id;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Attach keyboard handlers to window. Returns a detach function. */
export function attachKeyboard(deps: KeyboardDeps): () => void {
  const { getState, view, actions } = deps;

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (deps.isBlocked?.()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const state = getState();

    if (e.key === 'Tab') {
      e.preventDefault();
      cycle(state, view, e.shiftKey ? -1 : 1);
      return;
    }
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      if (view.selectedBoxId === null) {
        cycle(state, view, 1);
        return;
      }
      tryMoveBox(state, view.selectedBoxId, arrow[0], arrow[1]);
      return;
    }
    switch (e.key) {
      case 'Escape':
        view.selectedBoxId = null;
        break;
      case 'r':
      case 'R':
        actions.restart();
        break;
      case 'n':
      case 'N':
        if (state.won || actions.isRandom?.()) actions.next();
        break;
      case '[':
        actions.prev();
        break;
      case ']':
        actions.next();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
