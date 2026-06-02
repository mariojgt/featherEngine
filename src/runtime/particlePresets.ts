import type { ParticleConfig, ParticleSystemComponent, ParticleSystemDefinition } from '../types';

/** A complete, safe emitter config (no identity / enable flag) — the base for components and assets. */
export const defaultParticleConfig = (): ParticleConfig => ({
  looping: true,
  rate: 40,
  burst: 0,
  maxParticles: 240,
  shape: 'cone',
  shapeRadius: 0.25,
  coneAngle: 20,
  speed: 2,
  speedJitter: 0.4,
  direction: [0, 1, 0],
  gravity: 0,
  drag: 0.1,
  lifetime: 1.2,
  lifetimeJitter: 0.3,
  startSize: 0.35,
  endSize: 0.05,
  startColor: '#ffd27f',
  endColor: '#ff5722',
  startOpacity: 1,
  endOpacity: 0,
  worldSpace: true,
  blend: 'additive',
  light: false,
});

/** A complete, safe particle component (config + enabled) — used when seeding an inline emitter. */
export const defaultParticleSystem = (): ParticleSystemComponent => ({ enabled: true, ...defaultParticleConfig() });

/** Fills in any missing fields on a (possibly partial / legacy) particle component. */
export const withParticleDefaults = (
  patch: Partial<ParticleSystemComponent> = {},
): ParticleSystemComponent => ({ ...defaultParticleSystem(), ...patch });

/** Strips an asset's identity fields, leaving just the emitter config. */
export const particleAssetConfig = (asset: ParticleSystemDefinition): ParticleConfig => {
  const { id: _id, name: _name, description: _description, folderId: _folderId, createdAt: _createdAt, ...config } = asset;
  return { ...defaultParticleConfig(), ...config };
};

/**
 * Resolves an object's emitter to a full component: when it references an asset (`systemId`), the asset's
 * config wins (so editing the asset updates every instance); otherwise the inline fields are used.
 */
export const resolveParticleConfig = (
  component: ParticleSystemComponent | undefined,
  particleSystems: ParticleSystemDefinition[],
): ParticleSystemComponent => {
  if (!component) return defaultParticleSystem();
  if (component.systemId) {
    const asset = particleSystems.find((p) => p.id === component.systemId);
    if (asset) return { ...particleAssetConfig(asset), enabled: component.enabled, systemId: component.systemId };
  }
  return withParticleDefaults(component);
};

export type ParticlePresetId = 'fire' | 'smoke' | 'sparks' | 'magic' | 'fountain' | 'rain' | 'explosion' | 'dust';

/** Hand-tuned starting points so the inspector + AI can spin up a believable effect in one click. */
export const particlePresets: Record<ParticlePresetId, Partial<ParticleConfig>> = {
  fire: {
    looping: true, rate: 60, burst: 0, maxParticles: 300, shape: 'disc', shapeRadius: 0.2, coneAngle: 12,
    speed: 1.8, speedJitter: 0.5, direction: [0, 1, 0], gravity: -1.2, drag: 0.2, lifetime: 0.9, lifetimeJitter: 0.4,
    startSize: 0.45, endSize: 0.04, startColor: '#ffd45a', endColor: '#ff3b1f', startOpacity: 0.95, endOpacity: 0,
    worldSpace: true, blend: 'additive', light: true,
  },
  smoke: {
    looping: true, rate: 18, burst: 0, maxParticles: 200, shape: 'disc', shapeRadius: 0.18, coneAngle: 14,
    speed: 0.9, speedJitter: 0.5, direction: [0, 1, 0], gravity: -0.4, drag: 0.4, lifetime: 2.6, lifetimeJitter: 0.4,
    startSize: 0.4, endSize: 1.6, startColor: '#6b6b6b', endColor: '#202020', startOpacity: 0.5, endOpacity: 0,
    worldSpace: true, blend: 'normal', light: false,
  },
  sparks: {
    looping: true, rate: 50, burst: 0, maxParticles: 220, shape: 'point', shapeRadius: 0.05, coneAngle: 60,
    speed: 4, speedJitter: 0.7, direction: [0, 1, 0], gravity: 9, drag: 0.05, lifetime: 0.7, lifetimeJitter: 0.5,
    startSize: 0.08, endSize: 0.02, startColor: '#fff3b0', endColor: '#ff7a18', startOpacity: 1, endOpacity: 0,
    worldSpace: true, blend: 'additive', light: false,
  },
  magic: {
    looping: true, rate: 36, burst: 0, maxParticles: 260, shape: 'sphere', shapeRadius: 0.5, coneAngle: 30,
    speed: 0.6, speedJitter: 0.6, direction: [0, 1, 0], gravity: -0.6, drag: 0.5, lifetime: 1.6, lifetimeJitter: 0.4,
    startSize: 0.18, endSize: 0.02, startColor: '#a98bff', endColor: '#39c5ff', startOpacity: 0.95, endOpacity: 0,
    worldSpace: true, blend: 'additive', light: true,
  },
  fountain: {
    looping: true, rate: 90, burst: 0, maxParticles: 360, shape: 'point', shapeRadius: 0.06, coneAngle: 16,
    speed: 5.5, speedJitter: 0.25, direction: [0, 1, 0], gravity: 9.8, drag: 0.02, lifetime: 1.6, lifetimeJitter: 0.2,
    startSize: 0.12, endSize: 0.05, startColor: '#bfe6ff', endColor: '#5aa9ff', startOpacity: 0.9, endOpacity: 0.1,
    worldSpace: true, blend: 'normal', light: false,
  },
  rain: {
    looping: true, rate: 200, burst: 0, maxParticles: 700, shape: 'box', shapeRadius: 6, coneAngle: 0,
    speed: 12, speedJitter: 0.1, direction: [0, -1, 0], gravity: 6, drag: 0, lifetime: 1.2, lifetimeJitter: 0.1,
    startSize: 0.05, endSize: 0.05, startColor: '#bcd6ff', endColor: '#9ec2ff', startOpacity: 0.7, endOpacity: 0.4,
    worldSpace: true, blend: 'normal', light: false,
  },
  explosion: {
    looping: false, rate: 0, burst: 80, maxParticles: 160, shape: 'sphere', shapeRadius: 0.1, coneAngle: 90,
    speed: 7, speedJitter: 0.6, direction: [0, 1, 0], gravity: 4, drag: 0.6, lifetime: 0.8, lifetimeJitter: 0.4,
    startSize: 0.4, endSize: 0.02, startColor: '#fff0a0', endColor: '#ff3b1f', startOpacity: 1, endOpacity: 0,
    worldSpace: true, blend: 'additive', light: true,
  },
  dust: {
    looping: true, rate: 10, burst: 0, maxParticles: 120, shape: 'disc', shapeRadius: 0.5, coneAngle: 40,
    speed: 0.4, speedJitter: 0.6, direction: [0, 1, 0], gravity: -0.1, drag: 0.6, lifetime: 3, lifetimeJitter: 0.5,
    startSize: 0.12, endSize: 0.5, startColor: '#cdbfa6', endColor: '#cdbfa6', startOpacity: 0.25, endOpacity: 0,
    worldSpace: true, blend: 'normal', light: false,
  },
};

export const particlePresetIds = Object.keys(particlePresets) as ParticlePresetId[];
