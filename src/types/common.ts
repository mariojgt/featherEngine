export type Vector3Tuple = [number, number, number];

/** A one-shot sound queued during a runtime tick. `position` (world space) makes it spatial; omit for 2D
 *  (UI/menu) sounds. Drained + cleared each frame by the audio runtime. */
export type RuntimeSoundEvent = { assetId: string; position?: Vector3Tuple; volume?: number };

export type SceneObjectKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'plane' | 'terrain' | 'light' | 'camera';

export type RigidBodyType = 'dynamic' | 'fixed' | 'kinematic';

// 'mesh' = exact triangle mesh (trimesh; best for static geometry), 'convex' = convex hull
// of the model's vertices (cheaper, valid for dynamic bodies). Both require an imported model.
export type ColliderType = 'box' | 'sphere' | 'capsule' | 'mesh' | 'convex';

export type AssetType = 'model' | 'image' | 'audio' | 'unknown';

export type GraphValueType = 'number' | 'string' | 'boolean' | 'vector3';

export type GraphValue = number | string | boolean | Vector3Tuple;

export type CompareOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

