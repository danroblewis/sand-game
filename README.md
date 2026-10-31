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
- Walls are fixed. Some sand boxes can only be reached through a lane.
- Chapter 2, Workshop, turns on gravity for boxes: they fall when you let go and stack. Only the
  box at the foot of a shaft touches the sand tray beside it, so the order you stack is the order
  the colors drain. Pull a support out and everything above it drops. Frozen boxes inside a stack
  hold it until enough other boxes pop.
- Chapters 3 and 4, Pusher and Pusher II, are Sokoban: you are a little character who walks and
  pushes boxes (arrows or WASD, tap to walk, or swipe). A long swipe kicks a box so it slides until
  it hits something. Under gravity you fall and can climb one cell. Z undoes a move.
- Driven boxes carry a built-in thrust, drawn as a nozzle on the box. They move the moment they
  can and push whatever is in front of them, so a stack pressed against a sand box advances by
  itself as the front box pops.
- Chapter 5, Expanse, has boards bigger than the screen. The view follows you or snaps between
  rooms; O or the map button shows the whole board, and edge markers point to pops out of view.
  Belt loops circulate boxes past stations, and the hero can ride them.
- The gear in the top bar opens the pause menu: undo, restart, levels, sound, vibration, and the
  level's hint.
- Touching boxes of the same color count as one container: they pop together once all are full.
  Pull a full one away from its partners and it pops on its own.

## Endless mode

Open **Levels** and use the **Random** section: pick a difficulty from 1 to 10, choose
Floating, Gravity, or Mixed, turn Pusher on for Sokoban levels, then press **Play random** or
**Daily**, or type a seed to replay or share a level. The URL hash
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
