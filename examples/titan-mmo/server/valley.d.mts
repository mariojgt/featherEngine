export const VALLEY_ID: 'sunlit-valley';
export const VALLEY_SIZE: number;
export const GRID_SPACING: number;
export const VALLEY_HEIGHTS: Readonly<Record<string, number>>;
export const VALLEY_SOLIDS: readonly { id: string; kind: string; x: number; z: number; width: number; depth: number; height: number }[];
export function groundHeight(zone: string, x: number, z: number): number;
export function walkable(zone: string, x: number, z: number, radius?: number): boolean;
export function moveOnGround(actor: { zone: string; x: number; z: number }, dx: number, dz: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void;
export function clearSight(zone: string, a: {x: number; z: number}, b: {x: number; z: number}): boolean;
