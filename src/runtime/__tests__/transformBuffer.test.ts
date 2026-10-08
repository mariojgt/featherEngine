import { afterEach, describe, expect, it } from 'vitest';
import type { SceneObject } from '../../types';
import { clearTransformBuffer, publishRenderTransforms, publishTransforms, readTransform } from '../transformBuffer';

const object = (id: string, x = 0): SceneObject => ({
  id, name: id, kind: 'cube',
  transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
});

describe('runtime transform buffer', () => {
  afterEach(clearTransformBuffer);

  it('discards despawned effects and prevents stale physics poses from restoring them', () => {
    const player = object('player');
    const effect = object('effect');
    publishTransforms([player, effect]);
    publishTransforms([object('player', 5)]);
    publishRenderTransforms(new Map([[effect.id, effect.transform]]));
    expect(readTransform(effect.id)).toBeUndefined();
    expect(readTransform(player.id)?.position).toEqual([5, 0, 0]);
  });

  it('drops the previous scene even when the new scene has the same object count', () => {
    publishTransforms([object('old-a'), object('old-b')]);
    publishTransforms([object('new-a'), object('new-b')]);
    expect(readTransform('old-a')).toBeUndefined();
    expect(readTransform('old-b')).toBeUndefined();
    expect(readTransform('new-a')).toBeDefined();
    publishTransforms([]);
    expect(readTransform('new-a')).toBeUndefined();
    expect(readTransform('new-b')).toBeUndefined();
  });

  it('renders interpolated poses without changing authoritative transforms', () => {
    const body = object('body', 10);
    const interpolated = object('body', 9.5).transform;
    publishTransforms([body]);
    publishRenderTransforms(new Map([[body.id, interpolated]]));
    expect(readTransform(body.id)).toBe(interpolated);
    expect(body.transform.position[0]).toBe(10);
    publishTransforms([body]);
    expect(readTransform(body.id)).toBe(body.transform);
  });
});
