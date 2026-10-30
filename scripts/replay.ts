// End-to-end check: replay each level's authored solution (or, if it has none, the abstract
// solver's plan) through the real simulation.
// Usage: npm run replay [-- --verbose] [-- level-id ...]
import { LEVELS } from '../src/levels';
import { solveLevel } from '../src/levels/solver';
import { describeState, replayLevel } from '../src/levels/replay';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const only = args.filter((a) => !a.startsWith('-'));

let wins = 0;
let total = 0;
for (const level of LEVELS) {
  if (only.length && !only.includes(level.id)) continue;
  total++;
  const t0 = performance.now();
  let plan = level.solution;
  let src = 'authored';
  if (!plan) {
    const sol = solveLevel(level, { optimal: false });
    if (!sol.solved) {
      console.log(`✗ ${level.id.padEnd(14)} no authored solution and the solver found none`);
      continue;
    }
    plan = sol.path;
    src = 'solver';
  }
  if (verbose) console.log(`-- ${level.id} (${src} plan, ${plan.length} drags)`);
  const r = replayLevel(level, plan, {
    onDrag: verbose
      ? (step, state, s) => console.log(`   ${step.padEnd(18)} +${(s / 60).toFixed(1)}s  ${describeState(state)}`)
      : undefined,
  });
  const ms = (performance.now() - t0).toFixed(0);
  const secs = (r.steps / 60).toFixed(1);
  if (r.won) {
    wins++;
    console.log(`✓ ${level.id.padEnd(14)} drags=${r.drags} sim=${secs}s longest=${(r.longestSettle / 60).toFixed(1)}s (${src}, ${ms}ms) fills: ${r.fills.join(' ')}`);
  } else {
    console.log(`✗ ${level.id.padEnd(14)} ${r.why} sim=${secs}s  ${describeState(r.state)}`);
  }
}
console.log(`${wins}/${total} levels won`);
process.exit(wins === total ? 0 : 1);
