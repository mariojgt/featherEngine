import * as THREE from 'three';

export const MAX_LOCAL_FOG_LIGHTS = 6;
type FogLight = THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight;
const position = new THREE.Vector3(), target = new THREE.Vector3();
export const localFogBudget = (steps: number) => steps >= 40 ? 6 : steps >= 24 ? 4 : steps > 0 ? 2 : 0;

function visible(object: THREE.Object3D) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return !!object.parent;
}

/** Camera-local, bounded light list. No per-pixel scene traversal and no full world scan each frame. */
export class LocalFogLights {
  readonly positions = Array.from({ length: MAX_LOCAL_FOG_LIGHTS }, () => new THREE.Vector4());
  readonly colors = Array.from({ length: MAX_LOCAL_FOG_LIGHTS }, () => new THREE.Vector3());
  readonly directions = Array.from({ length: MAX_LOCAL_FOG_LIGHTS }, () => new THREE.Vector4());
  readonly cones = Array.from({ length: MAX_LOCAL_FOG_LIGHTS }, () => new THREE.Vector2());
  count = 0;
  private candidates: FogLight[] = [];
  private scan = 0;

  update(scene: THREE.Scene, cameraPosition: THREE.Vector3, budget: number) {
    if (this.scan++ % 15 === 0) {
      this.candidates = [];
      // Cache hidden lights too: cinematic visibility cues must take effect on their first frame.
      scene.traverse(object => {
        const light = object as FogLight;
        if ((light as THREE.PointLight).isPointLight || (light as THREE.SpotLight).isSpotLight || (light as THREE.RectAreaLight).isRectAreaLight) this.candidates.push(light);
      });
    }
    const power = (light: FogLight) => light.intensity * ((light as THREE.RectAreaLight).isRectAreaLight ? Math.min(80, (light as THREE.RectAreaLight).width * (light as THREE.RectAreaLight).height) * .65 : 1);
    const ranked = this.candidates.filter(light => visible(light) && light.intensity > 0).map(light => ({ light,
      score: power(light) / (4 + light.getWorldPosition(position).distanceToSquared(cameraPosition)),
    })).sort((a, b) => b.score - a.score).slice(0, Math.min(MAX_LOCAL_FOG_LIGHTS, Math.max(0, budget)));
    this.count = ranked.length;
    ranked.forEach(({ light }, i) => {
      light.getWorldPosition(position);
      const rectangle = (light as THREE.RectAreaLight).isRectAreaLight;
      this.positions[i].set(position.x, position.y, position.z, rectangle ? 35 : (light as THREE.PointLight).distance || 45);
      this.colors[i].set(light.color.r, light.color.g, light.color.b).multiplyScalar(power(light));
      if ((light as THREE.SpotLight).isSpotLight) {
        const spot = light as THREE.SpotLight;
        spot.target.getWorldPosition(target); target.sub(position).normalize();
        this.directions[i].set(target.x, target.y, target.z, 1);
        this.cones[i].set(Math.cos(spot.angle), Math.cos(spot.angle * (1 - spot.penumbra)));
      } else if (rectangle) {
        light.getWorldDirection(target).negate();
        this.directions[i].set(target.x, target.y, target.z, 1); this.cones[i].set(0, .25);
      } else {
        this.directions[i].set(0, 0, 0, 0); this.cones[i].set(-1, -1);
      }
    });
  }
}
