import { useMemo, useState } from 'react';
import {
  Box as PanelIcon,
  ChevronDown,
  ChevronUp,
  Copy,
  Gauge,
  Hash,
  Image as ImageIcon,
  LayoutDashboard,
  MousePointerClick,
  Plus,
  RectangleHorizontal,
  Trash2,
  Type as TextIcon,
  Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { UIEditLayer } from '../ui/UIEditLayer';
import { UILogicGraph } from './UILogicGraph';
import type { UIBinding, UIDocument, UIElement, UIElementKind, UIPresetKind } from '../types';

type Mode = 'design' | 'logic';

const ELEMENT_KINDS: Array<{ kind: UIElementKind; label: string; icon: typeof PanelIcon }> = [
  { kind: 'panel', label: 'Panel', icon: PanelIcon },
  { kind: 'text', label: 'Text', icon: TextIcon },
  { kind: 'bar', label: 'Bar', icon: RectangleHorizontal },
  { kind: 'button', label: 'Button', icon: MousePointerClick },
  { kind: 'image', label: 'Image', icon: ImageIcon },
];

const KIND_ICON: Record<UIElementKind, typeof PanelIcon> = {
  panel: PanelIcon,
  text: TextIcon,
  bar: RectangleHorizontal,
  button: MousePointerClick,
  image: ImageIcon,
};

const PRESETS: Array<{ preset: UIPresetKind; label: string; icon: typeof PanelIcon }> = [
  { preset: 'healthBar', label: 'Health Bar', icon: Gauge },
  { preset: 'label', label: 'Label', icon: TextIcon },
  { preset: 'counter', label: 'Counter', icon: Hash },
  { preset: 'button', label: 'Button', icon: MousePointerClick },
  { preset: 'panel', label: 'Panel', icon: PanelIcon },
];

function bindableTargetsFor(kind: UIElementKind): UIBinding['target'][] {
  switch (kind) {
    case 'bar':
      return ['fill', 'color', 'visible'];
    case 'text':
      return ['text', 'color', 'visible'];
    case 'button':
      return ['text', 'background', 'color', 'visible'];
    case 'image':
      return ['width', 'visible'];
    case 'panel':
    default:
      return ['background', 'width', 'visible'];
  }
}

const TARGET_LABEL: Record<UIBinding['target'], string> = {
  text: 'Text',
  fill: 'Fill',
  visible: 'Visible',
  color: 'Color',
  background: 'Background',
  width: 'Width',
};

type Source = 'fixed' | 'variable' | 'self' | 'expression';
interface Parsed {
  source: Source;
  name?: string;
  max?: string;
  raw?: string;
}

const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

function quoteExpressionString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function variableRef(name: string | undefined): string {
  if (!name) return '';
  return IDENTIFIER_RE.test(name) ? name : `vars[${quoteExpressionString(name)}]`;
}

function unquoteExpressionString(value: string): string {
  return value.replace(/\\(['"\\])/g, '$1');
}

function parseVariableRef(ref: string, knownVars: Set<string>): string | undefined {
  const trimmed = ref.trim();
  if (IDENTIFIER_RE.test(trimmed) && knownVars.has(trimmed)) return trimmed;
  const quoted = trimmed.match(/^vars\[(["'])(.*)\1\]$/);
  if (!quoted) return undefined;
  const name = unquoteExpressionString(quoted[2]);
  return knownVars.has(name) ? name : undefined;
}

function parseBinding(expression: string | undefined, knownVars: Set<string>): Parsed {
  const expr = (expression ?? '').trim();
  if (!expr) return { source: 'fixed' };
  let m = expr.match(/^(.+?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const dividedName = m ? parseVariableRef(m[1], knownVars) : undefined;
  if (dividedName) return { source: 'variable', name: dividedName, max: m?.[2] };
  const name = parseVariableRef(expr, knownVars);
  if (name) return { source: 'variable', name };
  m = expr.match(/^self\.([A-Za-z_]\w*)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) return { source: 'self', name: m[1], max: m[2] };
  m = expr.match(/^self\.([A-Za-z_]\w*)$/);
  if (m) return { source: 'self', name: m[1] };
  return { source: 'expression', raw: expr };
}

function buildExpression(p: Parsed, target: UIBinding['target']): string {
  if (p.source === 'fixed') return '';
  if (p.source === 'expression') return p.raw ?? '';
  const ref = p.source === 'self' ? `self.${p.name ?? ''}` : variableRef(p.name);
  if (!ref || ref === 'self.') return '';
  if (target === 'fill' && p.max && Number(p.max) > 0) return `${ref} / ${p.max}`;
  return ref;
}

function StyleField({ label, value, type = 'text', placeholder, onChange }: { label: string; value: string; type?: 'text' | 'color'; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TreeRow({ element, doc, depth, addingUnder, setAddingUnder }: { element: UIElement; doc: UIDocument; depth: number; addingUnder: string | null; setAddingUnder: (id: string | null) => void }) {
  const addUIElement = useEditorStore((state) => state.addUIElement);
  const moveUIElement = useEditorStore((state) => state.moveUIElement);
  const duplicateUIElement = useEditorStore((state) => state.duplicateUIElement);
  const removeUIElement = useEditorStore((state) => state.removeUIElement);
  const selectedId = useEditorStore((state) => state.selectedUIElementId);
  const selectUIElement = useEditorStore((state) => state.selectUIElement);
  const isRoot = element.id === doc.root.id;
  const Icon = KIND_ICON[element.kind];

  return (
    <>
      <div className={clsx('ui-node', (selectedId || doc.root.id) === element.id && 'selected')}>
        <button className="ui-node-main" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => selectUIElement(element.id)}>
          <Icon size={13} aria-hidden />
          <span className="ui-node-name">{element.name}</span>
          <span className="ui-node-kind">{element.kind}</span>
        </button>
        <div className="ui-node-tools">
          {element.kind === 'panel' && (
            <button title="Add child" onClick={() => setAddingUnder(addingUnder === element.id ? null : element.id)}>
              <Plus size={13} aria-hidden />
            </button>
          )}
          {!isRoot && (
            <>
              <button title="Move up" onClick={() => moveUIElement(doc.id, element.id, 'up')}>
                <ChevronUp size={13} aria-hidden />
              </button>
              <button title="Move down" onClick={() => moveUIElement(doc.id, element.id, 'down')}>
                <ChevronDown size={13} aria-hidden />
              </button>
              <button title="Duplicate" onClick={() => selectUIElement(duplicateUIElement(doc.id, element.id))}>
                <Copy size={13} aria-hidden />
              </button>
              <button title="Delete" onClick={() => { removeUIElement(doc.id, element.id); selectUIElement(doc.root.id); }}>
                <Trash2 size={13} aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>

      {addingUnder === element.id && (
        <div className="ui-add-menu" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
          {ELEMENT_KINDS.map(({ kind, label, icon: KindIcon }) => (
            <button
              key={kind}
              onClick={() => {
                selectUIElement(addUIElement(doc.id, element.id, kind));
                setAddingUnder(null);
              }}
            >
              <KindIcon size={12} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {element.children.map((child) => (
        <TreeRow key={child.id} element={child} doc={doc} depth={depth + 1} addingUnder={addingUnder} setAddingUnder={setAddingUnder} />
      ))}
    </>
  );
}

/** The single Properties inspector: Content → Style → Live values → Logic. No tabs, no jargon. */
function Properties({ doc, element }: { doc: UIDocument; element: UIElement }) {
  const updateUIElement = useEditorStore((state) => state.updateUIElement);
  const setUIBinding = useEditorStore((state) => state.setUIBinding);
  const variables = useEditorStore((state) => state.variables);
  const createVariable = useEditorStore((state) => state.createVariable);
  const assets = useEditorStore((state) => state.assets);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);
  const knownVars = useMemo(() => new Set(variables.map((v) => v.name)), [variables]);

  const patchStyle = (patch: Record<string, string | undefined>) => updateUIElement(doc.id, element.id, { style: { ...element.style, ...patch } });
  const setSource = (target: UIBinding['target'], p: Parsed) => setUIBinding(doc.id, element.id, target, buildExpression(p, target));

  return (
    <div className="node-inspector-body">
      {/* Content */}
      <label className="node-field">
        <span>Name</span>
        <input value={element.name} onChange={(event) => updateUIElement(doc.id, element.id, { name: event.target.value })} />
      </label>
      {(element.kind === 'text' || element.kind === 'button') && (
        <label className="node-field">
          <span>Text</span>
          <input value={element.text ?? ''} onChange={(event) => updateUIElement(doc.id, element.id, { text: event.target.value })} />
        </label>
      )}
      {element.kind === 'image' && (
        <label className="node-field">
          <span>Image</span>
          <select value={element.assetId ?? ''} onChange={(event) => updateUIElement(doc.id, element.id, { assetId: event.target.value || undefined })}>
            <option value="">None</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
            ))}
          </select>
        </label>
      )}
      {element.kind === 'button' && (
        <label className="node-field">
          <span>On click → event</span>
          <input value={element.onClickEvent ?? ''} placeholder="e.g. restart" onChange={(event) => updateUIElement(doc.id, element.id, { onClickEvent: event.target.value || undefined })} />
        </label>
      )}

      {/* Style */}
      <h4 className="ui-inspector-sub">Style</h4>
      <StyleField label="Background" type="color" value={element.style.background ?? '#000000'} onChange={(v) => patchStyle({ background: v })} />
      <StyleField label="Text Color" type="color" value={element.style.color ?? '#ffffff'} onChange={(v) => patchStyle({ color: v })} />
      <StyleField label="Padding" value={element.style.padding ?? ''} placeholder="8px" onChange={(v) => patchStyle({ padding: v || undefined })} />
      <StyleField label="Font Size" value={element.style.fontSize ?? ''} placeholder="14px" onChange={(v) => patchStyle({ fontSize: v || undefined })} />
      <StyleField label="Radius" value={element.style.borderRadius ?? ''} placeholder="8px" onChange={(v) => patchStyle({ borderRadius: v || undefined })} />
      <div className="node-vector-field">
        <StyleField label="W" value={element.style.width ?? ''} placeholder="auto" onChange={(v) => patchStyle({ width: v || undefined })} />
        <StyleField label="H" value={element.style.height ?? ''} placeholder="auto" onChange={(v) => patchStyle({ height: v || undefined })} />
      </div>
      {element.style.position === 'absolute' && (
        <>
          <div className="node-vector-field">
            <StyleField label="X" value={element.style.left ?? ''} placeholder="0px" onChange={(v) => patchStyle({ left: v || undefined })} />
            <StyleField label="Y" value={element.style.top ?? ''} placeholder="0px" onChange={(v) => patchStyle({ top: v || undefined })} />
          </div>
          <button className="full-button" onClick={() => patchStyle({ position: undefined, left: undefined, top: undefined })}>Return to auto-layout</button>
        </>
      )}

      {/* Live values (folded-in binding builder, no "Bind" jargon) */}
      <h4 className="ui-inspector-sub">Live values</h4>
      <p className="nfn-desc">Drive a property from game data — pick a variable, no typing.</p>
      {bindableTargetsFor(element.kind).map((target) => {
        const current = element.bindings.find((b) => b.target === target)?.expression;
        const p = parseBinding(current, knownVars);
        return (
          <div className="ui-bind-row" key={target}>
            <div className="ui-bind-head">
              <strong>{TARGET_LABEL[target]}</strong>
              <select value={p.source} onChange={(event) => setSource(target, { source: event.target.value as Source, name: p.name, max: p.max, raw: p.raw })}>
                <option value="fixed">Fixed</option>
                <option value="variable">From variable</option>
                {doc.surface === 'world' && <option value="self">From object (self)</option>}
                <option value="expression">Expression</option>
              </select>
            </div>
            {p.source === 'variable' && (
              <div className="ui-bind-fields">
                <select value={p.name ?? ''} onChange={(event) => setSource(target, { ...p, name: event.target.value })}>
                  <option value="">Pick variable…</option>
                  {variables.map((v) => (
                    <option key={v.id} value={v.name}>{v.name}</option>
                  ))}
                </select>
                <button
                  className="ui-bind-newvar"
                  title="New variable"
                  onClick={() => {
                    const id = createVariable(undefined, 'number', false);
                    const name = useEditorStore.getState().variables.find((v) => v.id === id)?.name;
                    if (name) setSource(target, { ...p, name });
                  }}
                >
                  <Plus size={12} aria-hidden />
                </button>
                {target === 'fill' && <input className="ui-bind-max" type="number" title="÷ max" value={p.max ?? '100'} onChange={(event) => setSource(target, { ...p, max: event.target.value })} />}
              </div>
            )}
            {p.source === 'self' && (
              <div className="ui-bind-fields">
                <input placeholder="key, e.g. health" value={p.name ?? ''} onChange={(event) => setSource(target, { ...p, name: event.target.value })} />
                {target === 'fill' && <input className="ui-bind-max" type="number" title="÷ max" value={p.max ?? '100'} onChange={(event) => setSource(target, { ...p, max: event.target.value })} />}
              </div>
            )}
            {p.source === 'expression' && (
              <input className="ui-bind-expr" placeholder="health > 0 ? 'Alive' : 'Dead'" value={p.raw ?? ''} onChange={(event) => setSource(target, { source: 'expression', raw: event.target.value })} />
            )}
          </div>
        );
      })}

      {element.kind === 'button' && (
        <p className="nfn-desc"><Workflow size={11} aria-hidden /> Behaviour lives in the <strong>Logic</strong> tab. {element.onClickEvent ? <>This button fires <code>{element.onClickEvent}</code> — catch it with a “Custom Event” node.</> : null}</p>
      )}
    </div>
  );
}

export function UIEditorPanel() {
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const activeUIDocumentId = useEditorStore((state) => state.activeUIDocumentId);
  const setActiveUIDocument = useEditorStore((state) => state.setActiveUIDocument);
  const createUIDocument = useEditorStore((state) => state.createUIDocument);
  const updateUIDocument = useEditorStore((state) => state.updateUIDocument);
  const addUIPreset = useEditorStore((state) => state.addUIPreset);
  const selectedId = useEditorStore((state) => state.selectedUIElementId);
  const selectUIElement = useEditorStore((state) => state.selectUIElement);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('design');

  const doc = uiDocuments.find((item) => item.id === activeUIDocumentId) ?? uiDocuments[0];
  const selectedElement = doc ? findInTree(doc.root, selectedId) ?? doc.root : undefined;
  const presetParent = () => (selectedElement?.kind === 'panel' ? selectedElement.id : doc?.root.id);

  return (
    <section className="panel ui-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Interface</span>
          <h2>UI</h2>
        </div>
        {uiDocuments.length > 0 && (
          <select className="blueprint-select" value={doc?.id ?? ''} onChange={(event) => setActiveUIDocument(event.target.value)} title="Select UI document">
            {uiDocuments.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create screen UI" onClick={() => createUIDocument(undefined, 'screen')}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {doc && (
        <div className="ui-tabbar">
          <button className={clsx(mode === 'design' && 'active')} onClick={() => setMode('design')}>Design</button>
          <button className={clsx(mode === 'logic' && 'active')} onClick={() => setMode('logic')}>Logic</button>
        </div>
      )}

      {!doc ? (
        <div className="empty-state wide">
          <LayoutDashboard size={18} aria-hidden />
          <span>No UI yet</span>
          <button className="full-button" onClick={() => createUIDocument(undefined, 'screen')}>Create Screen HUD</button>
          <button className="full-button" onClick={() => createUIDocument(undefined, 'world')}>Create World UI</button>
        </div>
      ) : mode === 'logic' ? (
        <UILogicGraph doc={doc} />
      ) : (
        // Horizontal layout: tools sidebar on the left, live preview filling the right.
        <div className="ui-design">
          <div className="ui-side">
            <div className="ui-surface">
              <span className="ui-surface-label">Type</span>
              <div className="ui-seg">
                <button className={clsx(doc.surface === 'screen' && 'active')} onClick={() => updateUIDocument(doc.id, { surface: 'screen' })} title="Drawn on the player's screen (HUD)">
                  Screen HUD
                </button>
                <button className={clsx(doc.surface === 'world' && 'active')} onClick={() => updateUIDocument(doc.id, { surface: 'world' })} title="Anchored over a 3D object (attach it in an object's Inspector)">
                  World
                </button>
              </div>
            </div>

            <div className="ui-presets">
              {PRESETS.map(({ preset, label, icon: Icon }) => (
                <button key={preset} title={`Add ${label}`} onClick={() => selectUIElement(addUIPreset(doc.id, presetParent(), preset))}>
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="ui-section">
              <div className="ui-section-title">Layers</div>
              <div className="ui-tree">
                <TreeRow element={doc.root} doc={doc} depth={0} addingUnder={addingUnder} setAddingUnder={setAddingUnder} />
              </div>
            </div>

            {selectedElement && (
              <div className="ui-section">
                <div className="ui-section-title">{selectedElement.name} <span className="ui-section-kind">{selectedElement.kind}</span></div>
                <Properties doc={doc} element={selectedElement} />
              </div>
            )}

            <details className="ui-section ui-doc-settings">
              <summary>Document settings</summary>
              <label className="ui-check">
                <input type="checkbox" checked={doc.visibleOnStart} onChange={(event) => updateUIDocument(doc.id, { visibleOnStart: event.target.checked })} />
                <span>Visible on start</span>
              </label>
              <label className="node-field">
                <span>Raw CSS</span>
                <textarea className="ui-css" rows={4} value={doc.css ?? ''} placeholder={'.my-class {\n  color: gold;\n}'} onChange={(event) => updateUIDocument(doc.id, { css: event.target.value })} />
              </label>
            </details>
          </div>

          <div className="ui-design-frame">
            <UIEditLayer doc={doc} fillParent={doc.surface === 'screen'} />
          </div>
        </div>
      )}
    </section>
  );
}

function findInTree(root: UIElement, id: string): UIElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findInTree(child, id);
    if (found) return found;
  }
  return undefined;
}
