export interface Appearance { armor: 'ocean' | 'moss' | 'ember' | 'plum' | 'gold'; trim: 'ivory' | 'bronze' | 'silver' | 'charcoal'; headpiece: 'none' | 'crest' | 'crown' }
export const ARMOR_COLORS: Readonly<Record<Appearance['armor'], string>>;
export const TRIM_COLORS: Readonly<Record<Appearance['trim'], string>>;
export const HEADPIECES: readonly Appearance['headpiece'][];
export const DEFAULT_APPEARANCE: Readonly<Appearance>;
export function normalizeAppearance(value: unknown): Appearance;
