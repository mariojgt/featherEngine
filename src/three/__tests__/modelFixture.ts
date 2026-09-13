import * as THREE from 'three';
import { Document, WebIO } from '@gltf-transform/core';

export async function modelFixture(skinned = false) {
  const sphere = new THREE.SphereGeometry(2, 48, 32), doc = new Document(), buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(sphere.getAttribute('position').array)).setBuffer(buffer);
  const index = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(sphere.getIndex()!.array)).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setIndices(index);
  const node = doc.createNode('Detailed prop').setMesh(doc.createMesh().addPrimitive(primitive)).setTranslation([2, 3, 4]);
  if (skinned) node.setSkin(doc.createSkin().addJoint(doc.createNode('Joint')));
  doc.createScene().addChild(node); doc.getRoot().getAsset().copyright = 'Fixture author';
  sphere.dispose(); return new WebIO().writeBinary(doc);
}
