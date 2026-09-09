import { useState } from 'react';
import { Aperture, AudioWaveform, Box, Car, Droplets, Flame, Gamepad2, Link2, Plus, Puzzle, ScrollText, Shirt, Sparkles, Unplug } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';
import { EditorActionPicker, type EditorAction } from './EditorActionPicker';

export function AddComponentMenu({ object, onConfigure }: { object: SceneObject; onConfigure: (section: string) => void }) {
  const [open, setOpen] = useState(false);
  const playing = useEditorStore((state) => state.isPlaying);
  const state = useEditorStore.getState();
  const action = (id: string, label: string, description: string, category: string, icon: EditorAction['icon'], section: string, add: () => void, attached: boolean, disabledReason?: string): EditorAction => ({
    id, label: attached ? `${label} · Attached` : label, description: attached ? 'Open this component’s settings.' : description, category, icon,
    disabledReason: attached ? undefined : disabledReason,
    run: () => { if (!attached) add(); onConfigure(section); },
  });
  const actions: EditorAction[] = [
    action('physics', 'Physics body', 'Collision, gravity, mass, and surface properties.', 'Physics', Box, 'Physics', () => state.togglePhysics(object.id), Boolean(object.physics)),
    action('character', 'Character controller', 'Player movement, jumping, and follow camera.', 'Gameplay', Gamepad2, 'Character Controller', () => state.toggleCharacterController(object.id), Boolean(object.character)),
    action('vehicle', 'Vehicle controller', 'Driving, wheels, and suspension.', 'Gameplay', Car, 'Vehicle Controller', () => state.setVehicleEnabled(object.id, true), Boolean(object.vehicle)),
    action('script', 'Script / Blueprint', 'Attach editable object behavior.', 'Gameplay', ScrollText, 'Scripts', () => state.openObjectScript(object.id), Boolean(object.script)),
    action('animation', 'Animation', 'Play clips or use an animation controller.', 'Rendering', AudioWaveform, 'Animation', () => state.toggleAnimator(object.id), Boolean(object.animator), !object.renderer?.modelAssetId ? 'Assign an imported model before adding animation.' : undefined),
    action('particles', 'Particles', 'Fire, smoke, sparks, and other visual effects.', 'Rendering', Sparkles, 'Particles', () => state.addParticles(object.id), Boolean(object.particles)),
    action('reflection', 'Reflection probe', 'Local reflections for nearby surfaces.', 'Rendering', Aperture, 'Reflection Probe', () => state.setReflectionProbe(object.id, { enabled: true }), Boolean(object.reflectionProbe)),
    action('water', 'Water volume', 'Water appearance, buoyancy, and currents.', 'Physics', Droplets, 'Water Volume', () => state.toggleWater(object.id), Boolean(object.water)),
    action('joint', 'Physics joint', 'Connect objects with a physical constraint.', 'Physics', Link2, 'Joint', () => state.addJoint(object.id), Boolean(object.joint)),
    action('cloth', 'Cloth', 'A simulated fabric surface.', 'Physics', Shirt, 'Cloth', () => state.addCloth(object.id), Boolean(object.cloth)),
    action('cable', 'Cable / rope', 'A flexible cable between two points.', 'Physics', Unplug, 'Cable', () => state.addCable(object.id), Boolean(object.cable)),
    action('destructible', 'Destructible', 'Break a mesh into physical pieces.', 'Gameplay', Flame, 'Destructible', () => state.setObjectFracture(object.id, { enabled: true }), Boolean(object.fracture), !object.renderer || object.kind === 'terrain' ? 'Requires a mesh object other than terrain.' : undefined),
    action('ui', 'World-space UI', 'Choose a world UI document, such as a health bar.', 'Interface', Puzzle, 'World-space UI', () => {}, Boolean(object.ui)),
    action('attachment', 'Bone attachment', 'Attach this object to a character’s bone or socket.', 'Gameplay', Link2, 'Attachment (bone socket)', () => {}, Boolean(object.attachment)),
  ];
  return <>
    <button type="button" className="editor-add-component" title={playing ? 'Stop preview to add components' : 'Add behavior or rendering to the selected object'} disabled={playing} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Plus size={14} aria-hidden />Add component</button>
    {open && <EditorActionPicker title="Add component" description={`Add or configure capabilities on ${object.name}.`} searchLabel="Search components…" actions={actions} onClose={() => setOpen(false)} />}
  </>;
}
