import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { modelSpecToGlbFile } from '../model/exportModelGlb';
import type { ModelPart, ModelPartShape, ModelStyle } from '../types/model';
import { defineFeatherPlugin, type FeatherPluginAPI } from './types';

/**
 * Image to 3D — turn a reference image into a model asset you can place in your scene.
 *
 * img2threejs is a Python skill that needs a large vision-capable LLM and an external agent, so it
 * cannot run inside the browser. This plugin's assistant tool performs the browser-compatible slice:
 * the assistant (a remote vision model reads the reference image) describes the object structurally,
 * and this tool rebuilds that description as a Feather Model Spec and bakes it to a GLB asset. For
 * maximum-fidelity reconstructions an external agent (Claude Code / Codex) can run the full
 * img2threejs pipeline and place the result through the same tool surface via MCP.
 */

const PLUGIN_ID = 'feather.image-to-3d';
const PANEL_ID = `${PLUGIN_ID}.studio`;

const MODEL_SHAPES: readonly ModelPartShape[] = [
  'box',
  'cylinder',
  'sphere',
  'cone',
  'wedge',
  'torus',
  'pyramid',
  'hexprism',
  'capsule',
  'mesh',
];

const partSchema = z.object({
  name: z.string().optional(),
  shape: z.enum(MODEL_SHAPES as unknown as [ModelPartShape, ...ModelPartShape[]]),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
  colorSlot: z.number().int().min(0).max(15).optional(),
  faceColors: z.record(z.number(), z.number()).optional(),
});

const toolInputSchema = z.object({
  name: z.string().min(1).describe('A short, descriptive model name, e.g. "Talos Vase".'),
  palette: z
    .array(z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/))
    .min(1)
    .max(16)
    .describe('Flat-color palette (hex). Parts reference these by index.'),
  finish: z.enum(['flat', 'smooth']).optional().describe("'flat' = crisp faceted, 'smooth' = Spline-style rounded. Default 'smooth'."),
  bevel: z.number().min(0).max(0.5).optional().describe('Corner radius on box parts (smooth finish only), world units. Default 0.06.'),
  roughness: z.number().min(0.05).max(1).optional().describe('Material roughness (0.05-1), lower is glossier. Default 0.45.'),
  parts: z
    .array(partSchema)
    .min(1)
    .describe(
      'A kit-bash of primitive parts that reconstructs the object from the reference image. Every part needs a real component — e.g. a vase = cylinder body + cylinder rim. Prefer a clear pose/orientation: position each part in world units where the model sits on the ground plane (y-up, origin at the floor).',
    ),
  placeInScene: z.boolean().optional().describe('Whether to also place an instance in the scene. Default false (creates the asset only).'),
});

function requireEditableProject(): void {
  const project = useProjectStore.getState();
  if (!project.hasProject) throw new Error('No Feather project is open.');
  if (useEditorStore.getState().isPlaying) throw new Error('Project edits are disabled while Play mode is running.');
}

type ToolInput = z.infer<typeof toolInputSchema>;

async function buildModelFromParts(input: ToolInput): Promise<{ assetFileName: string; specName: string }> {
  requireEditableProject();
  const store = useEditorStore.getState();

  const specId = store.createModelSpec('blank', input.name);
  if (!specId) throw new Error('Could not create a model asset — the Model Forge library is unavailable.');

  store.setModelPalette(specId, input.palette);

  const style: ModelStyle = {
    finish: input.finish ?? 'smooth',
    bevel: input.bevel ?? 0.06,
    roughness: input.roughness ?? 0.45,
  };
  store.updateModelSpec(specId, { style });

  // Strip the starter's placeholder box and lay down the described primitives instead.
  const spec = store.modelSpecs.find((entry) => entry.id === specId);
  for (const part of spec?.parts ?? []) store.removeModelPart(specId, part.id);

  for (const part of input.parts) {
    const init: Partial<Omit<ModelPart, 'id' | 'shape'>> = {
      name: part.name?.trim() || part.shape,
      position: part.position ?? [0, 0, 0],
      rotation: part.rotation ?? [0, 0, 0],
      scale: part.scale ?? [1, 1, 1],
      colorSlot: part.colorSlot ?? 0,
    };
    if (part.faceColors && Object.keys(part.faceColors).length > 0) init.faceColors = part.faceColors;
    const partId = store.addModelPart(specId, part.shape, init);
    if (!partId) throw new Error(`Could not add a ${part.shape} part to "${input.name}".`);
  }

  // Bake the spec into a real GLB asset through the ordinary import pipeline.
  const baked = await modelSpecToGlbFile(store.modelSpecs.find((entry) => entry.id === specId)!);
  store.addAssets([baked]);

  if (input.placeInScene) {
    const objectId = store.createModelFromSpec(specId, { name: input.name });
    if (objectId) store.selectObject(objectId);
  }

  return { assetFileName: baked.name, specName: input.name };
}

function ImageTo3DPanel({ api }: { api: FeatherPluginAPI }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [promptReady, setPromptReady] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setPromptReady(true);
  };

  const models = useEditorStore((state) => state.assets).filter((asset) => asset.type === 'model');

  return (
    <section className="terrain-panel image-to-3d-panel">
      <div className="terrain-gallery">
        <h3 className="inspector-title">Reference image</h3>
        {previewUrl ? (
          <img src={previewUrl} alt="Reference" className="image-to-3d-preview" />
        ) : (
          <div className="image-to-3d-drop" onDrop={(event) => {
            event.preventDefault();
            handleFile(event.dataTransfer.files[0]);
          }} onDragOver={(event) => event.preventDefault()}>
            <p>Drop a reference image, or</p>
            <label className="full-button">
              Browse…
              <input type="file" accept="image/*" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }} />
            </label>
          </div>
        )}

        {promptReady && (
          <div>
            <p className="field-hint">
              Now ask the assistant to rebuild this object. Make sure the AI provider is a remote
              vision model (OpenAI / Anthropic / Google), then say:
            </p>
            <div className="field-hint image-to-3d-prompt">
              “Build this object from the reference image as a playable model asset. Read it, then use
              the <code>imageTo3d.image-to-model</code> tool with a faithful kit-bash of primitives and
              an accurate color palette. Place it in the scene too.”
            </div>
          </div>
        )}

        <h3 className="inspector-subhead">Generated assets</h3>
        <p className="field-hint">
          Models built by the assistant land in the Assets panel as GLB. {models.length} model
          asset(s) in the project.
        </p>
      </div>

      <aside className="graph-inspector terrain-controls">
        <div className="node-inspector-body">
          <h4 className="inspector-subhead">How it works</h4>
          <p className="field-hint">
            In-browser: the assistant describes the object from the reference image, this plugin
            rebuilds it as a Model Forge spec, and bakes it to a GLB asset you can place.
          </p>
          <p className="field-hint">
            High-fidelity: run the full <strong>img2threejs</strong> pipeline under an external agent
            (Claude Code / Codex with the skill installed), which drives the same
            <code> imageTo3d.image-to-model </code> tool through the MCP relay to land its result here.
          </p>
        </div>
      </aside>
    </section>
  );
}

export const imageTo3dPlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Image to 3D',
  version: '1.0.0',
  description:
    'Turn a reference image into a placeable model asset: the AI assistant reads the image and rebuilds it as a procedural model, then bakes a GLB into your project. Works with img2threejs via MCP for high-fidelity reconstruction.',
  apiVersion: '0.2.0',
  activate(api) {
    api.tools.register({
      id: 'image-to-model',
      title: 'Build model from image',
      description:
        'Rebuild the object in a reference image (already described by the vision model) as a placeable Feather model asset. Accepts the structural kit-bash: a name, a flat color palette (hex, 1-16), a finish (flat/smooth), and part-by-part primitives (shape, position/rotation/scale in world units, color slot, optional per-face colors). Creates a Model Forge library asset and bakes it to a GLB in the Assets panel. Set placeInScene to also drop an instance at the origin.',
      inputSchema: toolInputSchema,
      execute: async (input) => {
        const result = await buildModelFromParts(input as ToolInput);
        return [
          `Built "${result.specName}" as a Model Forge asset and baked it to ${result.assetFileName} (now in the Assets panel).`,
          'Use place_model with the asset id, or set placeInScene next time to also drop it into the scene.',
        ].join(' ');
      },
    });

    api.panels.register({
      id: PANEL_ID,
      title: 'Image to 3D',
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <ImageTo3DPanel api={api} />,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open`,
      title: 'Open Image to 3D (reference image → model)',
      group: 'Extensions',
      keywords: 'image 3d model reference photo rebuild img2threejs',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});