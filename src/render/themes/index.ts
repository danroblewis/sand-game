// Skin registry and theme selection.
import type { Skin } from './skin';
import { SlateSkin } from './slate';
import { StationSkin } from './station';

const SKINS: Skin[] = [new SlateSkin(), new StationSkin()];
const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

/** All registered skins (for the theme picker). */
export function listSkins(): readonly Skin[] {
  return SKINS;
}

/** A skin by id; unknown / missing ids fall back to slate. */
export function getSkin(id: string | undefined): Skin {
  return (id && BY_ID.get(id)) || BY_ID.get('slate')!;
}

export function registerSkin(s: Skin): void {
  if (BY_ID.has(s.id)) return;
  SKINS.push(s);
  BY_ID.set(s.id, s);
}

export type { Skin };
