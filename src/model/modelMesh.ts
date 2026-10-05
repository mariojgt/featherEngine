import type { ModelPartMesh } from '../types';
import { extrudeFaces, subdivideFaces } from './meshOps';
import { UNIT_CUBE_POLY, clonePolyMesh, meshFaces, normalizePolyMesh, polyEdgePairs } from './polyMesh';

/**
 * Pure, serializable mesh-part operations (Model Forge "Mesh" parts). No three.js here — the data
 * layer (src/model/modelSpec.ts) and the store use these without loading a renderer. Vertices are
 * stored in unit space; a part's `scale` multiplies at render, so these helpers reason about the data
 * directly and are trivially testable. The three.js-touching weld + CSG live in modelMeshCsg.ts.
 */

export type MeshBooleanOp = 'union' | 'difference' | 'intersect';

/** The canonical cube everyone converts from: six outward quads over the eight ±0.5 corners. */
export const DEFAULT_MESH: ModelPartMesh = UNIT_CUBE_POLY;

/** A deep copy so callers never share the canonical DEFAULT_MESH reference. */
export const cloneMesh = clonePolyMesh;

/**
 * Sanitize arbitrary mesh data (older saves, package payloads, AI output) into a renderable POLY mesh.
 * Triangle-only payloads get their quads rebuilt; see normalizePolyMesh.
 */
export const normalizeMesh = normalizePolyMesh;

export const isMeshShape = (shape: string): boolean => shape === 'mesh';

/** Unique polygon edges as [a, b] (a < b) — never the triangulation diagonals. */
export function meshEdgePairs(mesh: ModelPartMesh): Array<[number, number]> {
  return polyEdgePairs({ vertices: mesh.vertices, faces: meshFaces(mesh) });
}

/** Number of editable polygons (quads/tris/n-gons). */
export const meshFaceCount = (mesh: ModelPartMesh): number => meshFaces(mesh).length;

/** The vertex loop of one polygon, or [] out of range. */
export function meshFaceVertices(mesh: ModelPartMesh, faceIndex: number): number[] {
  return meshFaces(mesh)[faceIndex] ?? [];
}

/** Region-extrude polygons along their normals (Blender E). Selection-tracking callers use meshOps directly. */
export function extrudeMeshFaces(mesh: ModelPartMesh, faceIndices: number[], delta = 0.25): ModelPartMesh {
  return extrudeFaces(mesh, faceIndices, delta).mesh;
}

/** Flat-subdivide polygons without leaving cracks against unselected neighbours. */
export function subdivideMeshFaces(mesh: ModelPartMesh, faceIndices: number[]): ModelPartMesh {
  return subdivideFaces(mesh, faceIndices).mesh;
}
