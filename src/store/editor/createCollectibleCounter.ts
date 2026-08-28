import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { UIElement, Vector3Tuple } from '../../types';
import { uiVariableRef } from './ui';

export interface CreateCollectibleCounterOptions {
  name?: string;
  variableName?: string;
  label?: string;
  amount?: number;
  position?: Vector3Tuple;
  playerObjectId?: string;
  color?: string;
}

export interface CreateCollectibleCounterResult {
  objectId: string;
  blueprintId: string;
  variableId: string;
  uiDocumentId: string;
  counterElementId: string;
}

/** High-level "collectible pickup" macro: creates a coin pickup object + HUD counter + pickup logic. */
export const createCollectibleCounterFor = (
  get: StoreApi<EditorState>['getState'],
  options: CreateCollectibleCounterOptions = {},
): CreateCollectibleCounterResult => {

    const variableName = options.variableName?.trim() || 'Coins';
    const variableExpression = uiVariableRef(variableName);
    const label = options.label?.trim() || variableName;
    const amount = options.amount ?? 1;
    const name = options.name?.trim() || `${label} Pickup`;
    const color = options.color ?? '#FFD166';
    const expressionLabel = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let variable = get().variables.find((item) => item.name === variableName);
    if (!variable) {
      const id = get().createVariable(variableName, 'number', false);
      get().updateVariable(id, { defaultValue: 0 });
      variable = get().variables.find((item) => item.id === id);
    }
    const variableId = variable?.id ?? get().createVariable(variableName, 'number', false);

    const findCounter = (element: UIElement): string | undefined => {
      if (
        element.bindings.some(
          (binding) =>
            binding.target === 'text' &&
            (binding.expression.includes(variableName) || binding.expression.includes(variableExpression)),
        )
      ) {
        return element.id;
      }
      for (const child of element.children) {
        const found = findCounter(child);
        if (found) return found;
      }
      return undefined;
    };

    let uiDocument =
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === `${label.toLowerCase()} hud`) ??
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === 'hud') ??
      get().uiDocuments.find((doc) => doc.surface === 'screen');
    if (!uiDocument) {
      const docId = get().createUIDocument(`${label} HUD`, 'screen');
      uiDocument = get().uiDocuments.find((doc) => doc.id === docId);
    }
    const uiDocumentId = uiDocument?.id ?? get().createUIDocument(`${label} HUD`, 'screen');
    get().updateUIDocument(uiDocumentId, { surface: 'screen', visibleOnStart: true });
    const currentDoc = get().uiDocuments.find((doc) => doc.id === uiDocumentId);
    let counterElementId = currentDoc ? findCounter(currentDoc.root) : undefined;
    if (!counterElementId) {
      counterElementId = get().addUIElement(uiDocumentId, undefined, 'text');
      get().updateUIElement(uiDocumentId, counterElementId, {
        name: `${label} Counter`,
        text: `${label}: 0`,
        style: {
          color: '#ffffff',
          fontSize: '20px',
          fontWeight: '700',
          custom: { textShadow: '0 2px 6px rgba(0,0,0,0.65)' },
        },
      });
      get().setUIBinding(uiDocumentId, counterElementId, 'text', `'${expressionLabel}: ' + ${variableExpression}`);
    }

    const objectId = get().createObjectWithProps('sphere', {
      name,
      position: options.position ?? [0, 1, 0],
      color,
      physics: { enabled: true, bodyType: 'fixed', collider: 'sphere', isTrigger: true, gravityScale: 0 },
    });
    get().updateTransform(objectId, 'scale', [0.35, 0.35, 0.35]);

    const { blueprintId } = get().createBlueprintNamed(`${name} Pickup Logic`, `Adds ${amount} to ${variableName} and removes the pickup.`);
    const triggerId = get().addGraphNodeToBlueprint(
      blueprintId,
      'Trigger Enter',
      'Events',
      { otherObjectId: options.playerObjectId },
      { x: 80, y: 180 },
    );
    const getId = get().addGraphNodeToBlueprint(blueprintId, 'Get Variable', 'Variables', { variableId }, { x: 80, y: 360 });
    const amountId = get().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values', { numberValue: amount }, { x: 80, y: 500 });
    const addId = get().addGraphNodeToBlueprint(blueprintId, 'Add', 'Math', {}, { x: 320, y: 420 });
    const setId = get().addGraphNodeToBlueprint(blueprintId, 'Set Variable', 'Variables', { variableId }, { x: 560, y: 240 });
    const destroyId = get().addGraphNodeToBlueprint(blueprintId, 'Destroy Object', 'Runtime', {}, { x: 800, y: 240 });
    get().connectGraphNodes(blueprintId, triggerId, setId);
    get().connectGraphNodes(blueprintId, setId, destroyId);
    get().connectGraphNodes(blueprintId, getId, addId, 'value-out', 'a');
    get().connectGraphNodes(blueprintId, amountId, addId, 'value-out', 'b');
    get().connectGraphNodes(blueprintId, addId, setId, 'value-out', 'value');
    get().attachScript(objectId, blueprintId);
    get().setActiveBlueprint(blueprintId);

    return { objectId, blueprintId, variableId, uiDocumentId, counterElementId };
};