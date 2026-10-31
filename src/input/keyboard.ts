// Keyboard controls: Tab cycles selection, arrows move, Esc deselects, R/N/[/] level control.
import type { Dir, GameState } from '../core/types';
import { movableBoxes, tryMoveBox } from '../core';
import type { View } from '../render/renderer';

export interface KeyboardActions {
  restart: () => void;
  next: () => void;
  prev: () => void;
  /** True when playing a generated level (N then means "new random level" even before winning). */
  isRandom?: () => boolean;
  /** Hero levels: one hero move (arrows / WASD). */
  heroMove?: (dir: Dir) => void;
  /** Hero levels: key pressed (one step; `kick` = Shift: kick). */
  heroKeyDown?: (dir: Dir, kick: boolean) => void;

  /** Hero levels: undo the last hero move (Z / U). */
  undo?: () => void;
  /** Big maps: toggle the overview (O). */
  overview?: () => void;
  /** Open the gear menu (Esc when nothing is selected, or M). */
  menu?: () => void;
}

const HERO_KEYS: Record<string, Dir> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down',
};

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
  if (state.hero) {
    // Hero levels: boxes are never selected (the hero pushes them).
    view.selectedBoxId = null;
    lastSelected = null;
    return;
  }
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

    if (state.hero) {
      const hd = HERO_KEYS[e.key];
      if (hd) {
        e.preventDefault();
        // Auto-repeat walks; Shift+arrow kicks (not repeated).
        if (e.repeat && e.shiftKey) return;
        if (actions.heroKeyDown) actions.heroKeyDown(hd, e.shiftKey);
        else actions.heroMove?.(hd);
        return;
      }
      if (e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        actions.undo?.();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault(); // no box selection in hero levels; keep focus on the game
        return;
      }
    }

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
        if (view.selectedBoxId !== null) view.selectedBoxId = null;
        else actions.menu?.();
        break;
      case 'o':
      case 'O':
        actions.overview?.();
        break;
      case 'm':
      case 'M':
        actions.menu?.();
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
