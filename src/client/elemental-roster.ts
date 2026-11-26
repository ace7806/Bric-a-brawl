import { FighterId } from '@sim/enums';

export type ElementKind = 'Fire' | 'Rock' | 'Water' | 'Air';

export interface ElementalFighterInfo {
  readonly id: FighterId;
  readonly slug: 'ignis' | 'basalt' | 'tide' | 'zephyr';
  readonly name: string;
  readonly element: ElementKind;
  readonly title: string;
  readonly role: string;
  readonly trick: string;
  readonly glbUrl: string;
  readonly portraitUrl: string;
  readonly accentHex: string;
  readonly slashHex: string;
  readonly heavySlashHex: string;
  readonly sparkHex: string;
  readonly rimHex: string;
  readonly gameplayScale: number;
}

export const ELEMENTAL_FIGHTERS: Readonly<Record<FighterId, ElementalFighterInfo>> = {
  [FighterId.Earl]: {
    id: FighterId.Earl,
    slug: 'ignis',
    name: 'IGNIS',
    element: 'Fire',
    title: 'Ember Striker',
    role: 'All-round Fire Brawler',
    trick: 'Blaze Overdrive — cancel normals into searing flame specials and unleash golden burst combos.',
    glbUrl: './assets/ignis.glb',
    portraitUrl: './assets/ignis_portrait.png',
    accentHex: '#FF6A1A',
    slashHex: '#FF9B38',
    heavySlashHex: '#FFE066',
    sparkHex: '#FF7A24',
    rimHex: '#FFA447',
    gameplayScale: 1.05,
  },
  [FighterId.Grog]: {
    id: FighterId.Grog,
    slug: 'basalt',
    name: 'BASALT',
    element: 'Rock',
    title: 'Magma Juggernaut',
    role: 'Heavyweight Seismic Tank',
    trick: 'Tectonic Stampede — barrel through rivals with unstoppable volcanic armor and meteor dunks.',
    glbUrl: './assets/basalt.glb',
    portraitUrl: './assets/basalt_portrait.png',
    accentHex: '#E87424',
    slashHex: '#FF8533',
    heavySlashHex: '#FFD25A',
    sparkHex: '#FF661A',
    rimHex: '#FF8833',
    gameplayScale: 1.04,
  },
  [FighterId.Nesta]: {
    id: FighterId.Nesta,
    slug: 'tide',
    name: 'TIDE',
    element: 'Water',
    title: 'Hydro Acrobat',
    role: 'Agile Hydro Martial Artist',
    trick: 'Tidal Surge — shift mass (Swell → Flow → Mist) to slip out of combos and whip rivals offstage.',
    glbUrl: './assets/tide.glb',
    portraitUrl: './assets/tide_portrait.png',
    accentHex: '#22C8DA',
    slashHex: '#4CE8F4',
    heavySlashHex: '#A6FFF8',
    sparkHex: '#30D8E8',
    rimHex: '#5CEEFF',
    gameplayScale: 1.04,
  },
  [FighterId.Moss]: {
    id: FighterId.Moss,
    slug: 'zephyr',
    name: 'ZEPHYR',
    element: 'Air',
    title: 'Gale Lancer',
    role: 'Aerial Tempest Spacer',
    trick: 'Gale Snare — command long-range twin-tip staff thrusts and swirling updraft hooks from afar.',
    glbUrl: './assets/zephyr.glb',
    portraitUrl: './assets/zephyr_portrait.png',
    accentHex: '#5ED6AD',
    slashHex: '#8CF4D0',
    heavySlashHex: '#D8FFF0',
    sparkHex: '#6CE8BE',
    rimHex: '#8FF5D4',
    gameplayScale: 1.04,
  },
};

export function getElementalFighter(id: FighterId): ElementalFighterInfo {
  return ELEMENTAL_FIGHTERS[id];
}
