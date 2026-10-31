# Sand Boxes — design & module contract

A relaxing web puzzle game. No ads, **no timer**, no scoring pressure. Finishing the puzzle is the reward.

## The game

- The board is a grid of cells (typically 6–8 wide, 8–11 tall).
- **Sand boxes** are fixed containers on the grid, filled with horizontal **layers** of colored sand
  (bottom layer first). Sand inside them obeys falling-sand cellular-automaton rules.
- **Boxes** are player-movable, colored containers with tetris-like shapes (1x1, 2x1, 1x2, 2x2,
  3x1, 1x3, L/J tetrominoes in 4 rotations, 3-cell small L in 4 rotations). They slide on the grid
  and collide with each other, with sand boxes, and with the board edges (Rush Hour / traffic-jam
  feel: you must shuffle boxes to reach a sand box).
- When a box of color C shares an edge with a sand box, sand of color C flows out of the sand box
  through the shared edge into the box, grain by grain, appearing at the mirrored position on the
  box side and then falling inside the box. Other colors stay put.
- **Same-color boxes also exchange sand** across a shared edge (so a box can act as a conduit).
- A box that is **full** is complete: it pops and is removed from the board, freeing space.
- Some boxes start **frozen** with a number on them. Each completed box decrements every frozen
  counter. At 0 the box thaws, reveals its color, and becomes movable.
- **Conservation:** for each color, total sand in all sand boxes == total capacity of all boxes of
  that color (including frozen). A box pops when it is within a tenth of a cell of full, so a few
  stranded grains never block a level; the level is won when every box has been removed.
- Controls: drag with pointer (snaps to grid, slides around obstacles). Keyboard: Tab / Shift+Tab
  cycles selection through movable boxes, arrow keys move one cell, Esc deselects, R restarts,
  N next level (after win), [ and ] previous/next level.

## Sand mechanics (the part that must be exactly right)

Philosophy: **the falling-sand simulation is the ground truth.** Gravity always applies to every
grain. There is no long-range magnetism, no tunnelling through other colors, no engineered layer
collapse, and grains are never teleported to "the lowest empty cell". What the player sees is the
simulation figuring it out. The only non-gravity force is a **short-reach pull** that colored boxes
exert on matching sand right next to their opening.

Fine grid: `GRAINS_PER_CELL = 24` grains per grid-cell edge, so a 1x1 box holds 576 grains.
Every sand box and every box has a `SandRegion` (see `src/core/types.ts`). Box regions are the
bounding box of the shape with a `mask` marking in-shape fine cells. y grows DOWN in all grids.

Sim runs at a fixed 60 steps/second (the renderer may call `stepGame` multiple times per frame to
catch up; cap at ~4 steps per frame). Everything uses the deterministic RNG in `state.rng`.

### One shared simulation

All regions are simulated as one space. Where a region's grid cell shares an edge with a docked
region's grid cell, the fine cells across that edge are neighbours of each other (mirrored
positions, like the current docking pairs). A move across an edge is allowed only if the
destination region **accepts** that grain:
- a **box** accepts grains of its own color while `count < capacity` (and it is active and unfrozen);
- a **sand box** never accepts grains (sand never flows back into a sand box);
- grains never leave a box except into another box of the same color.
Boxes never dock to frozen boxes. Nothing else is special about edges: a grain falling off the
bottom row of a sand box into a box below is just gravity; a grain sliding diagonally across a side
edge is just the slide rule; two same-color boxes side by side level out by slumping; a same-color
box above another drains into it by gravity.

### Per-step rules, bottom-up sweep, alternating scan direction each step

1. **Gravity:** a grain falls 1 cell if the cell below (possibly across an edge) is in-mask and
   empty and accepts it.
2. **Slide:** else if down-left or down-right is in-mask, empty and accepting, move there (random
   pick when both are free).
3. **Slump:** else with probability `P_SLUMP`, if a sideways neighbour is in-mask, empty and
   accepting, AND there is a drop (an empty in-mask cell below) within `SLUMP_REACH` cells along
   that free run, move sideways. Piles relax to a shallow slope; sand on a flat surface stays still.
4. **Pull:** each active unfrozen box with free capacity pulls matching grains that are within
   `PULL_REACH = 3` fine cells (grains; settable 1–6) of its opening cells, measured by a BFS from
   the opening cells that expands only through cells that are empty or hold the box's color (8-connected, but never squeezing
   diagonally between two blocking grains). Grains the BFS reaches move one cell per step toward the
   opening (nearest first, with probability `P_PULL`), into an empty cell (any direction, including
   upward — this is the one place gravity is overridden, and only within that tiny reach) or by **swapping with
   a same-color grain** (so a connected body of matching sand gets pumped toward the opening; the
   hole appears where the pulled grain was and the sand above it falls normally next step). Pulled
   grains never displace grains of another color. Grains under pull skip gravity that step; grains
   outside reach are ordinary sand.
   At the opening a grain crosses to the mirrored inlet cell if it is empty. If the inlet cell holds
   a same-color grain, the box **pushes a chain**: find the nearest empty in-mask cell of the box
   reachable from the inlet through same-color grains (BFS inside the box, any direction) and shift
   the grains along that path by one, so the incoming grain enters at the inlet and the pile
   bulges there (then gravity/slump spread it). This is how a box fills completely when docked on a
   side even after the pile reaches the inlet row, and how a box on top keeps taking sand through
   its full bottom row. Cap the pull to `PULL_RATE_BASE + PULL_RATE_PER_CELL * cells` grains per box
   per step so a 1x1 box fills in roughly 2 s when the sand is in reach, bigger shapes proportionally.
5. **Shake on move:** when a box moves by (dx, dy) in grid cells, its sand gets a small impulse
   opposite to the motion: with probability `P_SHAKE` each grain that has an empty in-mask cell in
   direction (−sign(dx), −sign(dy)) hops into it (for a downward move the surface grains hop UP one
   or two cells and then fall back; for a sideways move the surface tumbles the other way). Grain
   count is preserved exactly. Purely cosmetic, cheap, and skipped for boxes with no sand.
6. **Completion (with slack):** a box is complete when `region.count >= region.capacity - COMPLETION_SLACK`,
   where `COMPLETION_SLACK = round(0.1 * GRAINS_PER_UNIT)` (a tenth of a grid cell, 58 grains, the
   same absolute amount for every box). Real sand leaves films and trapped grains behind, and the
   user chose this tolerance over a sand surplus. On completion: set `state = 'removed'`, increment
   `completedCount`, emit `boxCompleted`, decrement every frozen box's counter (emit `boxUnfrozen`
   when one hits 0). Leftover grains of that color stay in the sand boxes as debris and no longer
   matter. When all boxes are removed emit `won` and set `state.won = true` regardless of debris.
6b. **Connected boxes are one container:** active, unfrozen boxes of the same color whose cells
   share an edge form a group (4-connected between cells of different boxes; corners don't count).
   The group behaves as ONE box for sand: it accepts grains while the group's total count is below
   the group's total capacity; the chain push at an inlet searches for the nearest empty cell
   through same-color grains across the shared edges of all members (so sand entering the piece
   that touches the sand box flows on into its partners and the group fills like a single bigger
   shape); gravity/slump already cross the shared edges; the pull rate is the group's
   (base + per-cell over all member cells). Completion is also per group: it pops in one step when
   `groupCount >= groupCapacity - COMPLETION_SLACK` (one slack per group). Separating a full piece
   from its group makes it a group of one, which pops at the next check. Frozen boxes never group.
   Groups are recomputed whenever dockings change (a box moved, popped, or thawed). Rendered as one
   merged outline with a faint seam.
7. **Debris dissolves:** after any completion, a color with grains still in sand boxes but no box
   of that color left on the board (frozen boxes count as remaining capacity) is finished: over
   `DISSOLVE_STEPS` (45) its remaining grains are removed at random, evenly, then one
   `debrisDissolved` event fires. Without this, leftover debris seals the next layer from the side
   or blocks the next catch from below, limiting a sand box to two colors.

Implementation notes (as built, 2026-10-30): the pull is a 3-grain nudge at the opening, nothing
moves sand upward over distance. Only grains actually stepping into an empty cell nearer the opening
skip gravity that step; a grain whose own fall/slide already heads for the opening is left to the
CA; same-color swaps are cosmetic and hold nothing. **Edge flow** (part of slump, sand boxes only):
a surface grain whose free run along its row ends at a docked opening of its color, passes over
one below (empty or occupied: an occupied inlet is fed by the chain push, e.g. into the foot of an
L/J/S under its overhang), or reaches a column of such an opening, keeps flowing toward it at any
distance, `EDGE_FLOW_SPEED = 12` cells per step and
without the `P_SLUMP` roll, so a layer beside (or above) a box drains completely as a landslide
toward the opening instead of resting as a wedge on the far side (box-to-box flow keeps ordinary
slump); ordinary slumps toward an opening of the grain's color skip the `P_SLUMP` roll. The chain
push waits until the inlet grain has settled; the rate cap limits only pull
crossings (gravity/slide/slump cross edges freely, so a box below a sand box fills by gravity in
~0.4 s). The pull draws only from sand boxes. Quiet regions sleep until a neighbour changes.

Consequences for level design (the puzzle is now the physics):
- a box on top of a sand box only gets what is within reach of its bottom edge: the top of the
  pile, if the sand box is full enough. As the pile drops out of reach the flow stops;
- a box on the side gets the layer at its height, which drains as a wedge/slope while the layers
  above cave in; what is above it ends up on the floor and may bury the rest;
- a box below a sand box (if the layout allows) catches its color by gravity as it reaches the floor;
- grains of a color can get buried under others; they come back into reach only when the layers
  above are taken. Levels must be verified by replaying through the real simulation (see
  `scripts/replay.ts`); the abstract solver is a heuristic for finding candidate plans only.

Grain values pack color + a random shade (`packGrain`) so sand has a speckled look; shade travels
with the grain.

## Movement rules

- A box occupies `box.cells` offset by `(box.x, box.y)`. `canPlace(state, box, x, y)` is true when
  all cells are in bounds and overlap no sand box and no other active box.
- `tryMoveBox(state, id, dx, dy)` moves one grid step if `canPlace`; increments `moves`, emits
  `boxMoved`, returns boolean. Frozen or removed boxes never move.
- `moveBoxToward(state, id, tx, ty)` slides toward a target grid position one step at a time
  (up to `|dx|+|dy|` steps), trying the axis with the larger remaining distance first, then the
  other; stops when neither axis can make progress. Used for drag. Each successful step is a move.
  (Counting: a drag counts as 1 move total even if it slid several cells — `moveBoxToward` returns
  the number of steps; the input layer increments `moves` once per drag that moved. So
  `moveBoxToward` must NOT itself increment `moves`; `tryMoveBox` does.)

## Module ownership & API

```
src/core/types.ts      (DONE) shared types + grain packing helpers
src/core/shapes.ts     (DONE) SHAPES, shapeBounds, shapeCellCount
src/core/rng.ts        core: mulberry32-style `nextFloat(rng)`, `nextInt(rng, n)`
src/core/sand.ts       core: createRegion(w,h,mask?), stepRegion(region, rng, step), fillLayers(region, layers),
                             regionIsFull(region), nearestEmpty(region, x, y)
src/core/grid.ts       core: canPlace, tryMoveBox, moveBoxToward, movableBoxes(state) (tab order: y then x),
                             boxAtCell(state, gx, gy), occupancy helpers
src/core/transfer.ts   core: gameSpace/invalidateSpace (shared world map), applyPull, chainPush, shakeBox
src/core/game.ts       core: createGame(level, seed?), stepGame(state), checkCompletions(state)
src/core/index.ts      core: re-export the public API above
src/levels/validate.ts levels: validateLevel(level): string[] (empty = ok)
src/levels/index.ts    levels: LEVELS: LevelDef[] in play order, each with an authored `solution`
src/levels/solver.ts   levels: heuristic plan finder (NOT a proof); physics replay is the proof
src/levels/generate.ts levels: generateLevel(seed, difficulty) with physics-verified acceptance
src/render/*           render: canvas renderer reading GameState; effects for pop/thaw
src/input/*            input: pointer drag + keyboard → core move functions; selection state
src/ui/*               ui: HUD (level name, hint, moves, restart, prev/next, level picker), progress in localStorage
src/main.ts            app: wires everything, fixed-step loop
index.html, src/style.css
tests/*.test.ts        vitest
```

Public core API (exact names; renderer/input/levels depend on these):

```ts
createGame(level: LevelDef, seed?: number): GameState
stepGame(state: GameState): void             // one 60Hz step: sand, transfers, magnetism, completions
canPlace(state: GameState, box: Box, x: number, y: number): boolean
tryMoveBox(state: GameState, boxId: number, dx: number, dy: number): boolean
moveBoxToward(state: GameState, boxId: number, tx: number, ty: number): number // steps taken
movableBoxes(state: GameState): Box[]         // active && frozen===0, sorted by y then x
boxAtCell(state: GameState, gx: number, gy: number): Box | undefined // active boxes only
validateLevel(level: LevelDef): string[]      // from src/levels/validate.ts
```

Colors: `ColorId` 1..12 map to a palette in `src/render/colors.ts` (render owns it):
1 red, 2 orange, 3 yellow, 4 green, 5 teal, 6 blue, 7 indigo, 8 purple, 9 pink, 10 brown,
11 white/sand, 12 black/charcoal. Levels should use at most ~6 colors each.

## Visual direction

Dark slate background, soft grid. Sand boxes look like glass containers with a thin light frame;
sand is drawn as crisp pixels (offscreen canvas per region at 1px per grain, drawn scaled with
`imageSmoothingEnabled = false`). Boxes: rounded shape outline in their color, translucent tinted
fill, sand inside. Frozen boxes: pale icy fill, frosted texture, big centered number. Selected box:
glowing outline. Dragged box lerps to its grid position quickly (~80 ms) so motion feels smooth.
Completion: quick scale-up + fade pop (~250 ms) with a few sand sparks. Thaw: brief flash.
Responsive: the board scales to fit the viewport (both portrait phone and desktop), pointer events
work for touch and mouse.

## Conveyors

A **conveyor** (`LevelDef.conveyors`, `ConveyorDef {x, y, dir, length}`) is a visible strip of
`length` grid cells starting at (x, y) and running in `dir`, usually ending at a sand box face.
It replaces the earlier spring idea, which reached invisibly along a lane and grabbed boxes.
- Any active, unfrozen box with at least one cell on the strip **rides** it: every
  `CONVEYOR_INTERVAL` (100 steps, about 1.7 s per cell: a deliberate slow burn so the player
  shuffles other pieces while the belt crawls) boxes on the belt are processed front-to-back
  (closest to the end first) and each moves one cell in `dir` if `canPlace` allows (sand boxes,
  frozen boxes, the board edge, boxes that did not move, and the held box block it). So a queue
  compacts toward the end, and when the front box pops the queue advances. Any box the player
  parks in the belt's path blocks the riders until it is moved away. `ConveyorState.phase` (0..1)
  is the progress toward the next step; riders whose next cell is free are drawn gliding by
  `phase` so motion is continuous, not a hop.
- A box the player is holding (`state.heldBoxId`, set by the input layer on drag start, cleared on
  release) is never carried and blocks boxes behind it. Dragging on, off, along, or against the
  belt is all allowed; after release the belt takes over.
- Belt cells are walkable and are NOT obstacles for `canPlace`; conveyors must not overlap sand
  boxes or other conveyors (validator).
- Belt moves emit one `conveyed` event per step with the moved box ids, don't count as `moves`, and
  `shakeBox` each moved box. `box.pushDir` records the last belt direction for rendering.
- Visual: a dark strip with rollers at both ends and animated chevrons crawling in `dir`.
- Design purpose: a lane of boxes pressed against a sand box drains it in the order the lane was
  loaded; the player chooses what goes on the belt and when.

## Walls

`LevelDef.walls` is a list of fixed wall cells. They are obstacles for `canPlace` exactly like sand
boxes, hold no sand, and are never docked to. Validator: in bounds, no overlap with sand boxes,
boxes, conveyors, or other walls. Rendered as solid dark blocks with a subtle bevel so they read as
immovable. Purpose: fence a sand box off so the only way to reach it is a conveyor lane (the
"gauntlet" level: a multi-layer sand box behind walls, fed by a belt, so the player must queue the
boxes in layer order while shuffling the rest of the board).

## Box gravity (per level)

`LevelDef.boxGravity: true` turns on gravity for boxes in that level (Chapter 2 "Workshop" uses it;
Chapter 1 does not). Rules:
- Every `BOX_FALL_INTERVAL` (4) steps, each active box (frozen ones too) that is not the held box
  and whose cells can all move down one cell (`canPlace`) falls one cell. Boxes are processed
  bottom-up so a stack falls together; a box resting on the held box does not fall. `box.falling`
  counts cells fallen in the current fall; when a falling box stops, emit `boxLanded {boxId, fell}`
  and reset it. Falls don't count as `moves`; `shakeBox` on landing only.
- The player may move a box in any direction (dragging carries it; keyboard moves it); on release
  (or after a keyboard move) it falls if unsupported. Pulling a support out from under a stack drops
  the stack. Dockings/space are invalidated when anything moves (existing rule).
- Design purpose: stage a sequence without a timer. What works (measured): a **shaft** whose floor
  is a shelf beside a low, wide sand box (one grid row tall, several thin color bands) so that only
  the BOTTOM box of a stack touches the sand. The bottom box drains the top band at its height,
  pops, the stack drops one cell, and the next box lands at the contact point. Stack order = drain
  order (top band's color at the BOTTOM of the stack). About 8 s per box. What does NOT work: a
  tall sand box with one box per layer height; all boxes touch their layers at once and buried
  layers only wedge-drain. Popping the top box of a stack drops nothing, so the contact point must
  be at the bottom of a stack. Catching from below still works for sand boxes floating above a
  shelf (a box resting on a wall under the sand box). Belts/springs are not used in gravity levels.
- Rendering: falling boxes glide (same approach as belt riders: predict the fall and offset by
  phase, or lerp); a small squash/dust effect on `boxLanded` scaled by `fell`.
- Validator: for gravity levels, every box must start resting (the cell(s) below each box are the
  floor, a wall, a sand box, or another box) so levels don't start with a cascade.

## Hero mode (Sokoban, per level)

`LevelDef.hero: {x, y}` turns a level into a Sokoban-style level (Chapter 3 "Pusher"). Rules:
- The hero occupies one cell and is an obstacle for boxes (`canPlace`, falls, belts). Boxes are
  never dragged in hero levels; keyboard arrows and tap-to-walk move the hero.
- `moveHero(state, dir)`: if the target cell is free (in bounds, not wall/sand box/box) the hero
  walks there. If it holds an active, unfrozen box and that box can move one cell in `dir`
  (`canPlace`, ignoring the hero's own cell), the box is pushed one cell and the hero steps into the
  vacated cell (emit `heroPushed`). Only one box moves per push (classic Sokoban; multi-cell shapes
  move as a whole). Frozen boxes, walls, sand boxes, and board edges block. Each successful move
  emits `heroMoved` and increments `moves`.
- With `boxGravity`, the hero also falls (one cell per BOX_FALL_INTERVAL steps, `heroLanded`), and
  can **climb one cell**: moving sideways into an obstacle whose cell above is free, while the cell
  above the hero is free, steps the hero up onto it (`heroMoved` with `climbed: true`). Up/down
  inputs do nothing in gravity hero levels (no jumping, no digging). A box pushed off a ledge falls.
  Boxes never fall into the hero's cell (the hero holds them up, like the held box did).
- **Kick:** `kickBox(state, dir)`: if the cell in `dir` from the hero holds an active, unfrozen box
  that can move one cell in `dir`, the box starts **sliding** (`box.sliding = dir`) and the hero stays
  put (facing updates). A sliding box moves one cell per `KICK_INTERVAL` (2) steps while `canPlace`
  allows; when blocked it stops (`boxSlid {boxId, dir, cells}`), under gravity it stops sliding as
  soon as it starts falling (the fall then proceeds normally). Sliding boxes are ordinary obstacles.
  A kick separates the box from any group it was in. A kick counts as one move and emits
  `heroKicked`. If there is NO box in `dir` and the cell is free, the same input **throws the
  hero**: `hero.sliding = dir`, it slides one cell per KICK_INTERVAL until blocked (`heroSlid`),
  stopping (then falling) under gravity as boxes do; it never pushes while sliding. One move,
  undoable. Touch input: a swipe is a kick/throw only when it ENDS in the edge band of the screen
  in the swipe direction (band ≈ max(64 px, 10% of that viewport dimension)); anything shorter is a
  step. Keyboard: Shift+arrow. Solutions write a kick/throw as `K` + direction (e.g. `RRKL`).
- **Undo:** `snapshotState(state)` / `restoreState(state, snap)` in core (deep copies of all regions
  and box/hero positions, dockings invalidated on restore). The app keeps a stack of snapshots, one
  per hero move, capped at 200; Z or the Undo button restores the previous one. Undo exists only in
  hero levels.
- Solutions for hero levels are strings of `U D L R` (one char per input) in `solution`; the replay
  settles the sim after each string, so `['RRU', 'LL']` means walk RRU, wait until nothing changes,
  then LL. Validator: the hero start must be a free cell; in gravity levels it must be resting.
- Rendering: a small round character with eyes facing `facing`, a bob while walking, a squash on
  landing; tap-to-walk on touch (BFS through free cells; walking into a box pushes it); a 4-way
  d-pad overlay on phones; Tab/box selection disabled in hero levels; an Undo button.

## Driven boxes (force on a box)

`BoxDef.force: Dir` makes a **driven box**: a colored box with a built-in thrust in one direction,
drawn on the box itself (a thruster/chevron on its back edge, exhaust while moving, a compressed
glow while pressing). Rules:
- Every `BOX_FALL_INTERVAL` (4) steps, each active, unfrozen, not-held, not-sliding driven box
  tries to move one cell in `force`, pushing the **train** in front of it: the closure of active
  unfrozen boxes that would be overlapped by moving the set one cell (like a Sokoban multi-push).
  If every cell the train would move into is free (not wall, sand box, frozen box, hero, board
  edge, or a box outside the train), the whole train moves (emit `forcePushed`, `shakeBox` each);
  otherwise nothing moves and the driven box is `pressing`. Several driven boxes resolve in id
  order, repeated until nothing more moves; a train containing two opposed driven boxes is stuck.
- Driven boxes ignore gravity in the direction of their force (an upward-driven box lifts its train
  and supports it); otherwise gravity applies normally (a right-driven box on a ledge still falls).
- The hero cannot push a driven box against its force (it resists); pushes along or across the
  force are normal pushes; kicks across the force are allowed; a kick along the force is just a push.
- Driven boxes drain and complete like any box of their color; when they pop, the force is gone.
  Frozen driven boxes do nothing until thawed. Groups (rule 6b) apply as usual.
- Validator: `force` must be a valid Dir; a driven box may start pressing (nothing moves) or free.
- Purpose: stage a sequence with a visible pusher: a driven box behind a stack presses it against a
  sand box; when the front box pops the train advances at once. It replaces belts/springs/zones.

## Big maps (Chapter 5 "Expanse")

Boards may be much larger than the screen (e.g. 16x16 to 32x14). `LevelDef.camera` selects how
they are shown: `'fit'` (default, today's behaviour), `'scroll'` (fixed cell size, viewport follows
the focus with a soft lerp, clamped to the board; focus = hero in hero levels, else the held box or
the last moved box), `'rooms'` (the board is divided into screen-sized rooms; the view snaps to the
room containing the focus, like a square reveal). Both large modes have: an overview (pinch or a
key / button) that shows the whole board scaled down and snaps back; off-screen pings (a marker at
the screen edge pointing to a pop, thaw, or landing that happened out of view, fading after ~1 s);
edge-scroll while dragging in drag levels; a faster hero walk on long tap-to-walk paths (speed up
after 3 steps). Frozen counters are visible in the overview.

Belts return as **circulation**: belts may form loops (contiguous strips whose directions chain,
e.g. right along a top row, down, left, up). `ConveyorDef.interval` makes a belt faster or slower
than the default. A box rides the belt under its first cell (top-left of its shape) so corner
handoffs are unambiguous; use 1x1 or belt-aligned shapes on loops. The hero rides belts too (moving
walkways) when standing on one and not blocked. Design use: a loop carries a set of boxes past
several sand box stations; the player pushes a box off the loop at the right station or lets it
circulate until the station is ready; long same-color chains across the map act as one container
(rule 6b), so a chain can feed a far-away piece.

## Themes (skins)

The renderer draws everything through a **Skin** (src/render/themes/): palette (background, grid,
per-ColorId box and sand colors, outline/ice/wall tones), element drawers (sand box frame, box
body and outline, frozen overlay, wall tiles, belt strip, driver nozzle/exhaust, hero, effects) and
optional baked sprite sheets at the current cell size. Theme selection: `LevelDef.theme` →
chapter default (src/ui/chapters.ts `theme`) → user override in the pause menu ("Theme: Auto /
…") → the default skin `slate` (today's look). Skins style the sand through a `sand` section (palette per color/shade, grain style
square/dot/chunky, surface light and shadow, depth darkening, moving-grain sparkle, an animated
overlay on active regions); the simulation grid itself never changes and `slate` stays
pixel-identical. Skins must keep all gameplay affordances (frozen counters, pushDir/force arrows, selection, pings) readable, and must
work at phone sizes and HiDPI. Planned skins: `slate` (current), `station` (cargo station: hoppers,
containers, thrusters, cryo pods, bulkheads, a maintenance bot), others per chapter later.

## Progression, scores, and fanfare

Principles: no time pressure ever (no countdowns, no visible clock during play); scores reward
mastery after the fact; generators are "Free Play"; every unlock is an event.

- **Par** (`src/levels/par.ts`, generated by `npm run par` from the authored solutions through the
  physics replay): per level `{ moves, seconds, sandSeconds }` where moves = inputs for hero levels
  (a kick/throw counts 1) or drags for drag levels, seconds = sim time to win, sandSeconds = time
  sand was flowing. Tests require a par for every campaign level.
- **Records** per level (progress storage): completed, bestMoves, bestSeconds, bestSandSeconds,
  maxSandSeconds ("longest pour"), stars (best). Shown on the result screen and the map.
- **Stars** from moves vs par: 3 if moves ≤ ceil(par.moves × 1.15), 2 if ≤ par.moves × 1.6,
  1 for finishing. (Time is recorded, not starred, so waiting is never penalised.)
- **Unlocks:** within a chapter, level n+1 unlocks when n is completed; chapter k+1 unlocks when
  the player has ≥ 60% of the stars available in chapters ≤ k (and chapter 1 is always open);
  Free Play unlocks after the first 6 levels; a "Daily" needs Free Play. Unlocking anything (a
  level, a chapter, Free Play, a star milestone) triggers a themed **ceremony** overlay once.
- **Fanfare:** the win screen reveals stars one by one with sound/haptics, counts moves vs par,
  shows records and "new record" badges, then offers Next / Replay / Map.
- **Themed presentation:** the Skin contract gains `progression`: `renderMap(host, model)` (the
  chapter/level map replacing the flat picker: a trail, a deck plan, whatever fits the skin, with
  locked/unlocked/starred states and the current level), `winFanfare(host, result)`, and
  `ceremony(host, unlock)`. The default `slate` skin draws a simple trail; `station` draws a deck
  plan. The flat grid picker remains as the fallback inside the pause menu ("All levels").
- Free Play section: the existing Random controls (modes, difficulty, seed, daily), plus
  Expedition (big maps) when the generator supports it.

## Non-goals (v1)

No timer, no stars, no monetisation, no accounts, no level editor, no sound (maybe later).
