import type { ShapeName, Vec } from './types';

/** Cells occupied by each shape, relative to the top-left of its bounding box. y grows downward. */
export const SHAPES: Record<ShapeName, Vec[]> = {
  '1x1': [{ x: 0, y: 0 }],
  '2x1': [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  '1x2': [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  '2x2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  '3x1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  '1x3': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  // L tetromino: vertical bar with a foot to the right.
  L0: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  L90: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }],
  L180: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  L270: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  // J tetromino: mirrored L.
  J0: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
  J90: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  J180: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  J270: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }],
  // Small L (3 cells inside a 2x2): the missing corner rotates clockwise.
  S: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // missing top-right
  S90: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], // missing bottom-right
  S180: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], // missing bottom-left
  S270: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // missing top-left
};

export function shapeBounds(shape: ShapeName): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const c of SHAPES[shape]) {
    w = Math.max(w, c.x + 1);
    h = Math.max(h, c.y + 1);
  }
  return { w, h };
}

export function shapeCellCount(shape: ShapeName): number {
  return SHAPES[shape].length;
}
