/** An allowlist keeps saved and networked cosmetics deterministic, small, and independent of stats. */
export const ARMOR_COLORS = Object.freeze({ ocean: '#356981', moss: '#54764c', ember: '#a44e3c', plum: '#745b8e', gold: '#b79854' });
export const TRIM_COLORS = Object.freeze({ ivory: '#e8dcc2', bronze: '#b87745', silver: '#a8c1cd', charcoal: '#313640' });
export const HEADPIECES = Object.freeze(['none', 'crest', 'crown']);
export const DEFAULT_APPEARANCE = Object.freeze({ armor: 'ocean', trim: 'ivory', headpiece: 'none' });
export function normalizeAppearance(value) {
  const input = value && typeof value === 'object' ? value : {};
  return { armor: Object.hasOwn(ARMOR_COLORS, input.armor) ? input.armor : DEFAULT_APPEARANCE.armor,
    trim: Object.hasOwn(TRIM_COLORS, input.trim) ? input.trim : DEFAULT_APPEARANCE.trim,
    headpiece: HEADPIECES.includes(input.headpiece) ? input.headpiece : DEFAULT_APPEARANCE.headpiece };
}
