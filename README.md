# Sand Boxes

A relaxing falling-sand puzzle for the browser. Slide colored boxes around a cramped board until
each one touches a sand box holding its color; the matching sand streams across and fills the box.
A full box pops and frees up room. No ads, no timer.

## Play

```sh
npm install
npm run dev      # http://localhost:5173
```

- **Drag** a box with mouse or touch. Boxes snap to the grid and slide around obstacles.
- **Tab / Shift+Tab** cycle through movable boxes, **arrow keys** move the selected box one cell.
- **Esc** deselect, **R** restart, **[** / **]** previous / next level, **N** next level after a win.
- Frozen boxes show a number: complete that many boxes to thaw them.
- Same-color boxes pass sand between each other, so a box can act as a conduit.
- Sand obeys gravity. A box below a sand box catches the bottom layer; a box beside the top layer
  drains it from the side; a box on top gets almost nothing. Boxes only pull sand that is touching
  their edge (three grains). Clear a layer to expose the one under it.
- A box pops when it is within a tenth of a cell of full. Leftover specks of a finished color
  dissolve.
- Conveyor belts crawl slowly, carrying boxes to a sand box and queueing them against it. When the
  front box pops, the queue advances. Anything parked in the belt's path blocks the riders until you
  move it. A box you are holding stays put.
- Walls are fixed. Some sand boxes can only be reached by a belt lane.
- Touching boxes of the same color count as one container: they pop together once all are full.
  Pull a full one away from its partners and it pops on its own.

## Endless mode

Open **Levels** and use the **Random** section: pick a difficulty from 1 to 10, press
**Play random** or **Daily**, or type a seed to replay or share a level. The URL hash
(`#gen-7-48213`) reopens the same level. Every generated level is proven solvable by
replaying a plan through the real physics before it is offered.

Preview generated levels from the terminal:

```sh
npx vite-node scripts/generate.ts <difficulty> <count> [startSeed] [--replay]
```

## Develop

```sh
npm test         # vitest: simulation, movement, transfer, levels
npm run replay   # replay every campaign level's authored solution through the real physics
npm run build    # typecheck + production build in dist/
```

See `DESIGN.md` for the mechanics and module layout. Levels live in `src/levels/index.ts`; the
validator enforces that sand volume equals box volume per color, and `tests/levels.test.ts` proves
every level is solvable.
