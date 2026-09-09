import { Box, Circle, Square, Camera, LampDesk, Mountain, Gamepad2, Coins, DoorOpen, Ghost, Flame, Unplug, MoveHorizontal, Cylinder } from 'lucide-react';
import type { SceneObjectKind } from '../types';
export const objectIcons: Record<SceneObjectKind, typeof Box> = { empty: Square, cube: Box, sphere: Circle, capsule: Cylinder, plane: Square, light: LampDesk, camera: Camera, terrain: Mountain };
export const objectTypeNames: Record<SceneObjectKind, string> = { empty: 'Empty object', cube: 'Cube', sphere: 'Sphere', capsule: 'Capsule', plane: 'Plane', light: 'Light', camera: 'Camera', terrain: 'Terrain' };
export const roleIcons: Record<string, typeof Box> = { player: Gamepad2, collectible: Coins, door: DoorOpen, enemy: Ghost, hazard: Flame, destructible: Unplug, 'moving-platform': MoveHorizontal };
