/**
 * Barrel for the project's shared types. The single `types.ts` grew past 2,500 lines, so it was split
 * into domain modules; this index re-exports them all so every existing `import { ... } from '../types'`
 * keeps resolving unchanged. Add new domain modules here.
 */
export * from './common';
export * from './graph';
export * from './geometry';
export * from './animation';
export * from './physics';
export * from './environment';
export * from './vehicle';
export * from './gameplay';
export * from './cinematics';
export * from './project';
