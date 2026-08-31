import { useEditorStore } from '../../store/editorStore';
import { sanitizeLocalModelText } from './localTextSanitizer';

export const LOCAL_USER_CHAR_BUDGET = 640;
export const LOCAL_SNAPSHOT_CHAR_BUDGET = 1200;
export const LOCAL_CONTINUITY_CHAR_BUDGET = 240;

export function trimLocalUserMessage(content: string): string {
  if (content.length <= LOCAL_USER_CHAR_BUDGET) return content;
  const tailChars = 140;
  const marker = '… [middle trimmed for local WebGPU] …';
  const headChars = LOCAL_USER_CHAR_BUDGET - tailChars - marker.length;
  return `${content.slice(0, headChars)}${marker}${content.slice(-tailChars)}`;
}

const clipContinuity = (content: string, budget: number) => {
  const clean = sanitizeLocalModelText(content).replace(/\s+/g, ' ').trim();
  if (clean.length <= budget) return clean;
  const tail = Math.min(28, Math.floor(budget / 3));
  return `${clean.slice(0, budget - tail - 1)}…${clean.slice(-tail)}`;
};

/** Keeps pronoun/follow-up context without carrying old tool transcripts into Qwen's prefill. */
export function buildLocalContinuityContext(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string | null {
  const previousUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  const previousAssistant = [...messages].reverse().find(
    (message) => message.role === 'assistant' && message.content.trim(),
  );
  if (!previousUser && !previousAssistant) return null;

  if (previousUser && previousAssistant) {
    const labels = 'Previous request: '.length + '\nPrevious result: '.length;
    const contentBudget = LOCAL_CONTINUITY_CHAR_BUDGET - labels;
    const userBudget = Math.floor(contentBudget / 2);
    const resultBudget = contentBudget - userBudget;
    return `Previous request: ${clipContinuity(previousUser.content, userBudget)}\nPrevious result: ${clipContinuity(previousAssistant.content, resultBudget)}`;
  }

  const label = previousUser ? 'Previous request: ' : 'Previous result: ';
  const content = previousUser?.content ?? previousAssistant!.content;
  return `${label}${clipContinuity(content, LOCAL_CONTINUITY_CHAR_BUDGET - label.length)}`;
}

/**
 * A deliberately small, bounded scene summary for local generation. Detailed project data remains
 * available through list_scene/inspect actions; putting the cloud snapshot here would make Qwen's
 * first lm_head allocation scale with the entire project.
 */
export function buildLocalSnapshotContext(): string {
  const state = useEditorStore.getState();
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const selected = activeScene?.objects.find((object) => object.id === state.selectedObjectId);
  const summary = {
    activeScene: activeScene
      ? { id: activeScene.id, name: activeScene.name, objectCount: activeScene.objects.length }
      : null,
    scenes: state.scenes.slice(0, 3).map((scene) => ({
      id: scene.id,
      name: scene.name,
      objectCount: scene.objects.length,
    })),
    selected: selected
      ? {
          id: selected.id,
          name: selected.name,
          kind: selected.kind,
          position: selected.transform.position,
          parentId: selected.parentId ?? null,
        }
      : null,
    objects: (activeScene?.objects ?? []).slice(0, 4).map((object) => ({
      id: object.id,
      name: object.name,
      kind: object.kind,
      parentId: object.parentId ?? null,
    })),
    counts: {
      assets: state.assets.length,
      blueprints: state.blueprints.length,
      materials: state.materials.length,
      prefabs: state.prefabs.length,
      uiDocuments: state.uiDocuments.length,
    },
    isPlaying: state.isPlaying,
    editingPrefabId: state.editingPrefabId ?? null,
  };

  const prefix = 'Live project summary (bounded). Use search_engine_tools, then list/inspect actions for details.\n';
  const serialized = JSON.stringify(summary);
  if (prefix.length + serialized.length <= LOCAL_SNAPSHOT_CHAR_BUDGET) return `${prefix}${serialized}`;

  // Long user-assigned names can still inflate the compact structure. Preserve identifiers and
  // counts, then trim at a hard character boundary as a final safety net.
  const fallback = JSON.stringify({
    activeScene: summary.activeScene,
    selected: summary.selected,
    counts: summary.counts,
    isPlaying: summary.isPlaying,
  });
  return `${prefix}${fallback}`.slice(0, LOCAL_SNAPSHOT_CHAR_BUDGET);
}
