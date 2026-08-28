import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  CableComponent,
  ClothComponent,
  FractureComponent,
  JointComponent,
  JointType,
  PhysicsComponent,
  WaterVolumeComponent,
} from '../../types';
import {
  defaultCable,
  defaultCloth,
  defaultJoint,
  defaultPhysics,
  defaultWaterVolume,
  withPhysicsDefaults,
} from './defaults';
import { defaultFracture } from './objectFactory';
import { WATER_LOOK_KEYS, waterStylePatch } from '../../three/presets';
import { mapActiveSceneObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];

export const applyUpdatePhysics = (set: SetState, id: string, patch: Partial<PhysicsComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id && object.physics ? { ...object, physics: withPhysicsDefaults({ ...object.physics, ...patch }) } : object,
      ),
    ),
  );
};

export const applyUpdateWater = (set: SetState, id: string, patch: Partial<WaterVolumeComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        // Choosing a named style stamps its look; the rest of `patch` can still override on top.
        // Hand-editing a visual/wave field with no style in the patch marks the volume 'custom' so the
        // inspector dropdown stops claiming a preset it no longer matches.
        const stylePatch =
          patch.style && patch.style !== 'custom' ? waterStylePatch(patch.style) : {};
        const touchesLook = WATER_LOOK_KEYS.some((key) => key in patch);
        const derivedStyle = patch.style ?? (touchesLook ? 'custom' : undefined);
        return {
          ...object,
          water: {
            ...defaultWaterVolume(),
            ...object.water,
            ...stylePatch,
            ...patch,
            ...(derivedStyle ? { style: derivedStyle } : {}),
          },
        };
      }),
    ),
  );
};

export const applyToggleWater = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const water = { ...defaultWaterVolume(), ...object.water };
        const enabled = !water.enabled;
        const nextPhysics = withPhysicsDefaults({
          ...(object.physics ?? defaultPhysics('fixed', 'box')),
          enabled: true,
          bodyType: 'fixed',
          collider: 'box',
          isTrigger: true,
          gravityScale: 0,
        });
        return {
          ...object,
          water: { ...water, enabled },
          physics: nextPhysics,
          variables: { ...(object.variables ?? {}), volume: enabled ? 'water' : object.variables?.volume ?? 'water' },
          renderer: object.renderer ? { ...object.renderer, color: '#2BA8FF', opacity: object.renderer.opacity ?? 0.45 } : object.renderer,
        };
      }),
    ),
  );
};

export const applyTogglePhysics = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const current = withPhysicsDefaults(object.physics ?? defaultPhysics());
        return { ...object, physics: { ...current, enabled: !current.enabled } };
      }),
    ),
  );
};

export const applyAddJoint = (set: SetState, id: string, type: JointType = 'hinge'): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id || object.joint) return object;
        // A joint needs a rigid body to act on — ensure physics is on (dynamic by default so it moves).
        const physics = withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true });
        return { ...object, joint: defaultJoint(type), physics };
      }),
    ),
  );
};

export const applyUpdateJoint = (set: SetState, id: string, patch: Partial<JointComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id === id) {
          return { ...object, joint: { ...defaultJoint(), ...object.joint, ...patch } };
        }
        // A joint links two rigid BODIES — so the object we're connecting to needs physics too. Give it
        // a dynamic body if it has none, otherwise the joint silently can't build (syncJoints waits for
        // both bodies to exist). This makes "Connect to X" just work without a separate enable step.
        if (patch.connectedObjectId && object.id === patch.connectedObjectId && !object.physics?.enabled) {
          return { ...object, physics: withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true }) };
        }
        return object;
      }),
    ),
  );
};

export const applyRemoveJoint = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id ? { ...object, joint: undefined } : object)),
    ),
  );
};

export const applyAddCloth = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id && !object.cloth ? { ...object, cloth: defaultCloth() } : object)),
    ),
  );
};

export const applyUpdateCloth = (set: SetState, id: string, patch: Partial<ClothComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id ? { ...object, cloth: { ...defaultCloth(), ...object.cloth, ...patch } } : object,
      ),
    ),
  );
};

export const applyRemoveCloth = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id ? { ...object, cloth: undefined } : object)),
    ),
  );
};

export const applyAddCable = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id && !object.cable ? { ...object, cable: defaultCable() } : object)),
    ),
  );
};

export const applyUpdateCable = (set: SetState, id: string, patch: Partial<CableComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) => {
      const owner = objects.find((object) => object.id === id);
      const merged = { ...defaultCable(), ...owner?.cable, ...patch };
      // A PHYSICAL cable needs a rigid body at BOTH ends or the rope joint can't build. Seed sensible
      // bodies for any end that has none: the cable owner is the PIVOT → fixed; the attached end is the
      // swinging MASS → dynamic. Existing physics (any body type) is respected — only absent ones seed.
      const wirePhysics = Boolean(merged.physics && merged.endObjectId);
      return objects.map((object) => {
        if (object.id === id) {
          const physics =
            wirePhysics && !object.physics?.enabled
              ? withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('fixed', 'box')), enabled: true })
              : object.physics;
          return { ...object, cable: merged, physics };
        }
        if (wirePhysics && object.id === merged.endObjectId && !object.physics?.enabled) {
          return { ...object, physics: withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true }) };
        }
        return object;
      });
    }),
  );
};

export const applyRemoveCable = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id ? { ...object, cable: undefined } : object)),
    ),
  );
};

export const applySetObjectFracture = (set: SetState, id: string, patch: Partial<FractureComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id ? { ...object, fracture: { ...defaultFracture(), ...object.fracture, ...patch } } : object,
      ),
    ),
  );
};
