// Station progression styles (deck-plan map, delivery fanfare, hatch ceremony), injected once
// when the skin is first activated (Skin contract `css`).
export const STATION_PROGRESSION_CSS = `
/* ---------- station map: a deck plan ---------- */
.levelmap[data-skin='station'] .map-card,
.picker[data-skin='station'] .picker-card {
  background: #171b22;
  border-color: #3a414d;
}
.pm-station {
  display: flex;
  flex-direction: column;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.deck-total {
  align-self: flex-end;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8d97a6;
  margin-bottom: 10px;
}
.deck-total b {
  color: #e7edf5;
  font-size: 15px;
  margin: 0 3px 0 0;
}
.deck-total span:first-child {
  margin-right: 8px;
}
.deck {
  position: relative;
  border: 3px solid #4a5260;
  border-radius: 6px;
  background:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px) 0 0 / 100% 22px,
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px) 0 0 / 22px 100%,
    #1c2129;
  box-shadow: inset 0 0 0 1px #0b0d11, 0 2px 0 #0b0d11;
}
.deck-plate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: linear-gradient(#3b434f, #2e353f);
  border-bottom: 2px solid #0e1116;
}
.deck-id {
  font-size: 11px;
  color: #f2b33d;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 2px 6px;
  border: 1px solid rgba(242, 179, 61, 0.5);
  border-radius: 3px;
}
.deck-name {
  flex: 1;
  font-size: 15px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #e7edf5;
}
.deck-stars {
  font-size: 12px;
  color: #aab4c2;
}
.deck-floor {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 10px;
  padding: 12px;
}
.hatch {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  border: 2px solid #59626f;
  background:
    radial-gradient(circle at 50% 50%, transparent 58%, rgba(0, 0, 0, 0.25) 60%),
    linear-gradient(#2c333d, #232931);
  color: #dfe6ef;
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  touch-action: manipulation;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 0 #0b0d11;
}
.hatch::before {
  /* corner bolts */
  content: '';
  position: absolute;
  inset: 4px;
  pointer-events: none;
  background:
    radial-gradient(circle at 3px 3px, #737c88 1.5px, transparent 2px),
    radial-gradient(circle at calc(100% - 3px) 3px, #737c88 1.5px, transparent 2px),
    radial-gradient(circle at 3px calc(100% - 3px), #737c88 1.5px, transparent 2px),
    radial-gradient(circle at calc(100% - 3px) calc(100% - 3px), #737c88 1.5px, transparent 2px);
}
.hatch:focus-visible {
  outline: 3px solid #f2b33d;
  outline-offset: 2px;
}
.hatch:active {
  transform: translateY(1px);
}
.hatch-lamps {
  display: flex;
  gap: 4px;
}
.hatch-lamps i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0e1116;
  box-shadow: inset 0 0 0 1px #4a5260;
}
.hatch-lamps i.on {
  background: #ffd35a;
  box-shadow: 0 0 6px rgba(255, 211, 90, 0.8);
}
.hatch.done {
  border-color: #7d8794;
}
.hatch.current {
  border-color: #f2b33d;
  box-shadow: 0 0 0 3px rgba(242, 179, 61, 0.25), 0 2px 0 #0b0d11;
}
.hatch-beacon {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #ffb02e;
  box-shadow: 0 0 10px #ffb02e;
  animation: beacon 1s steps(2, jump-none) infinite;
}
@keyframes beacon {
  50% {
    opacity: 0.25;
  }
}
.hatch.locked {
  color: #6c7480;
  border-color: #3a414b;
  background: repeating-linear-gradient(-45deg, #2a2a22 0 6px, #1e2228 6px 12px);
}
.hatch.locked svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}
.deck.locked .deck-floor {
  opacity: 0.6;
}
.corridor {
  position: relative;
  min-height: 58px;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
}
.corridor::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 34px;
  transform: translateX(-50%);
  background: #1c2129;
  border-left: 3px solid #4a5260;
  border-right: 3px solid #4a5260;
}
.bulkhead {
  position: relative;
  width: 34px;
  height: 14px;
  background: repeating-linear-gradient(-45deg, #f2b33d 0 6px, #22262d 6px 12px);
  border: 2px solid #0e1116;
  border-radius: 3px;
}
.corridor.open .bulkhead {
  background: #2e353f;
  height: 6px;
  opacity: 0.6;
}
.bulkhead svg {
  position: absolute;
  left: -28px;
  top: -5px;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: #f2b33d;
  stroke-width: 2;
}
.bulkhead-req {
  position: relative;
  z-index: 1;
  max-width: 100%;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(242, 179, 61, 0.45);
  background: #171b22;
  font-size: 11.5px;
  color: #f2b33d;
  text-align: center;
}

/* station fanfare: a delivery readout */
.win[data-skin='station'] .win-card,
.ceremony[data-skin='station'] .ceremony-card {
  background: #171b22;
  border: 2px solid #4a5260;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px #0b0d11, 0 20px 60px rgba(0, 0, 0, 0.5);
}
.ff-station {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.ff-station .ff-kicker {
  color: #f2b33d;
}
.ff-station .ff-headline {
  font-size: 22px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.ff-station .ff-stars {
  gap: 14px;
  padding: 10px 16px;
  border-radius: 8px;
  background: #0e1116;
  border: 1px solid #3a414b;
}
.ff-station .ff-star svg,
.ff-station .ff-star:nth-child(2) svg {
  width: 44px;
  height: 44px;
  margin: 0;
}
.ff-station .ff-star path {
  fill: #20252d;
  stroke: #3d4550;
}
.ff-station .ff-star.lit path {
  fill: #ffd35a;
  stroke: #fff1b8;
}
.ff-station .ff-star.lit svg {
  overflow: visible;
  filter: drop-shadow(0 0 5px rgba(255, 211, 90, 0.75));
}
.ff-station .ff-row {
  border-radius: 4px;
  background: #0e1116;
  border: 1px solid #262c35;
  text-transform: uppercase;
  font-size: 12.5px;
  letter-spacing: 0.04em;
}
.ff-station .ff-row dd {
  color: #9fe7ff;
}
.ff-station .ff-badge {
  background: #ffb02e;
  border-radius: 3px;
}

/* station: a hatch slides open on the unlocked thing */
.cer-station {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.cer-status {
  font-size: 12px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #6dff9b;
  text-shadow: 0 0 8px rgba(109, 255, 155, 0.6);
  animation: beacon 0.5s steps(2, jump-none) 4;
}
.cer-hatch {
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: 10px;
  border: 4px solid #59626f;
  background: radial-gradient(circle, #2b3a46, #10151b);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffd35a;
  box-shadow: 0 0 0 3px #0e1116, 0 0 24px rgba(255, 211, 90, 0.25);
}
.cer-hatch .cer-icon svg {
  filter: drop-shadow(0 0 8px rgba(255, 211, 90, 0.7));
}
.cer-hatch .door-l,
.cer-hatch .door-r {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  background: repeating-linear-gradient(-45deg, #f2b33d 0 8px, #2a2f37 8px 16px);
  border: 2px solid #0e1116;
}
.cer-hatch .door-l {
  left: 0;
  animation: door-l 700ms 350ms cubic-bezier(0.6, 0, 0.3, 1) forwards;
}
.cer-hatch .door-r {
  right: 0;
  animation: door-r 700ms 350ms cubic-bezier(0.6, 0, 0.3, 1) forwards;
}
@keyframes door-l {
  to {
    transform: translateX(-100%);
  }
}
@keyframes door-r {
  to {
    transform: translateX(100%);
  }
}
.cer-station .cer-title {
  font-size: 20px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
`;
