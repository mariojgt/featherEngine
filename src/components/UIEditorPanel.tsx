import { isWorkspacePanelMaximized, onWorkspacePanelMaximizedChange, toggleWorkspacePanelMaximized } from './workspacePanels';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  Box as PanelIcon,
  Car,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Crosshair,
  Gauge,
  Hash,
  Image as ImageIcon,
  LayoutDashboard,
  LogIn,
  MonitorPlay,
  MousePointerClick,
  Pause,
  PersonStanding,
  Plus,
  RectangleHorizontal,
  ScrollText,
  Skull,
  SlidersHorizontal,
  TextCursorInput,
  ToggleLeft,
  Sparkles,
  ListChecks,
  Trash2,
  Type as TextIcon,
  Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { UI_TEMPLATES, UI_THEMES, wouldCreateUICycle, type UITemplateKind } from '../store/editor/ui';
import { UI_ANIMATION_TYPES } from '../ui/uiAnimations';
import { UIDesignerStage } from './UIDesignerStage';
import { UIWidgetLayoutFields } from './UIWidgetLayoutFields';
import { UILogicGraph } from './UILogicGraph';
import type { UIBinding, UIDocument, UIElement, UIElementKind, UIPresetKind } from '../types';

const TEMPLATE_ICON: Record<UITemplateKind, typeof PanelIcon> = {
  shooter: Crosshair,
  platformer: PersonStanding,
  racing: Car,
  pauseMenu: Pause,
  gameOver: Skull,
  settings: SlidersHorizontal,
  login: LogIn,
  inventory: Blocks,
};

type Mode = 'design' | 'logic';

const ELEMENT_KINDS: Array<{ kind: UIElementKind; label: string; icon: typeof PanelIcon }> = [
  { kind: 'panel', label: 'Panel', icon: PanelIcon },
  { kind: 'text', label: 'Text', icon: TextIcon },
  { kind: 'bar', label: 'Bar', icon: RectangleHorizontal },
  { kind: 'button', label: 'Button', icon: MousePointerClick },
  { kind: 'image', label: 'Image', icon: ImageIcon },
  { kind: 'scroll', label: 'Scroll List', icon: ScrollText },
  { kind: 'input', label: 'Input', icon: TextCursorInput },
  { kind: 'toggle', label: 'Toggle', icon: ToggleLeft },
  { kind: 'slider', label: 'Slider', icon: SlidersHorizontal },
  { kind: 'dropdown', label: 'Dropdown', icon: ChevronDown },
  { kind: 'component', label: 'Component', icon: Blocks },
];

/** 9-slice anchor presets for the inspector (screen docs) — `${h}:${v}` value ↔ UIAnchor fields. */
const ANCHOR_PRESETS: Array<{ label: string; h: 'left' | 'center' | 'right' | 'stretch'; v: 'top' | 'middle' | 'bottom' | 'stretch' }> = [
  { label: 'Top Left', h: 'left', v: 'top' },
  { label: 'Top Center', h: 'center', v: 'top' },
  { label: 'Top Right', h: 'right', v: 'top' },
  { label: 'Middle Left', h: 'left', v: 'middle' },
  { label: 'Center', h: 'center', v: 'middle' },
  { label: 'Middle Right', h: 'right', v: 'middle' },
  { label: 'Bottom Left', h: 'left', v: 'bottom' },
  { label: 'Bottom Center', h: 'center', v: 'bottom' },
  { label: 'Bottom Right', h: 'right', v: 'bottom' },
  { label: 'Stretch Width · Top', h: 'stretch', v: 'top' },
  { label: 'Stretch Width · Bottom', h: 'stretch', v: 'bottom' },
  { label: 'Stretch Height · Left', h: 'left', v: 'stretch' },
  { label: 'Stretch Height · Right', h: 'right', v: 'stretch' },
];

const KIND_ICON: Record<UIElementKind, typeof PanelIcon> = {
  panel: PanelIcon,
  text: TextIcon,
  bar: RectangleHorizontal,
  button: MousePointerClick,
  image: ImageIcon,
  scroll: ScrollText,
  input: TextCursorInput,
  toggle: ToggleLeft,
  slider: SlidersHorizontal,
  dropdown: ChevronDown,
  component: Blocks,
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
      return ['text', 'background', 'color', 'visible', 'disabled'];
    case 'input':
    case 'toggle':
    case 'slider':
    case 'dropdown':
      return ['background', 'color', 'visible', 'disabled'];
    case 'image':
      return ['width', 'visible'];
    case 'panel':
    case 'scroll':
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
  disabled: 'Disabled',
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
  const componentName = useEditorStore((state) =>
    element.kind === 'component' ? state.uiDocuments.find((d) => d.id === element.componentId)?.name : undefined,
  );
  const [collapsed, setCollapsed] = useState(false);
  const reparent = useEditorStore((state) => state.reparentUIElement);
  const isRoot = element.id === doc.root.id;
  const Icon = KIND_ICON[element.kind];
  const componentLabel = componentName ?? (element.componentId ? 'missing' : 'unset');

  return (
    <>
      <div className={clsx('ui-node', (selectedId || doc.root.id) === element.id && 'selected')}
        draggable={!isRoot} onDragStart={(event) => { event.dataTransfer.setData('application/feather-widget', JSON.stringify({ docId: doc.id, id: element.id })); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(event) => { if (['panel', 'scroll'].includes(element.kind) && event.dataTransfer.types.includes('application/feather-widget')) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); try { const data = JSON.parse(event.dataTransfer.getData('application/feather-widget')); if (data.docId === doc.id) { reparent(doc.id, data.id, element.id); setCollapsed(false); } } catch { /* unrelated drop */ } }}>
        {element.children.length > 0 && <button className="ui-tree-expand" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${element.name}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '▾'}</button>}
        <button className="ui-node-main" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => selectUIElement(element.id)}>
          <Icon size={14} aria-hidden />
          <span className="ui-node-name">{element.name}</span>
          {/* An instance names the widget it points at — the tree should read as composition,
              not as a mystery leaf node. */}
          <span className="ui-node-kind">{element.kind === 'component' ? componentLabel : element.kind}</span>
        </button>
        <div className="ui-node-tools">
          {(element.kind === 'panel' || element.kind === 'scroll') && (
            <button title="Add child" onClick={() => setAddingUnder(addingUnder === element.id ? null : element.id)}>
              <Plus size={14} aria-hidden />
            </button>
          )}
          {!isRoot && (
            <>
              <button title="Move up" onClick={() => moveUIElement(doc.id, element.id, 'up')}>
                <ChevronUp size={14} aria-hidden />
              </button>
              <button title="Move down" onClick={() => moveUIElement(doc.id, element.id, 'down')}>
                <ChevronDown size={14} aria-hidden />
              </button>
              <button title="Duplicate" onClick={() => selectUIElement(duplicateUIElement(doc.id, element.id))}>
                <Copy size={14} aria-hidden />
              </button>
              <button title="Delete" onClick={() => { removeUIElement(doc.id, element.id); selectUIElement(doc.root.id); }}>
                <Trash2 size={14} aria-hidden />
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

      {!collapsed && element.children.map((child) => (
        <TreeRow key={child.id} element={child} doc={doc} depth={depth + 1} addingUnder={addingUnder} setAddingUnder={setAddingUnder} />
      ))}
    </>
  );
}

/** The single Properties inspector: Content → Style → Live values → Logic. No tabs, no jargon. */
function Properties({ doc, element }: { doc: UIDocument; element: UIElement }) {
  const updateUIElement = useEditorStore((state) => state.updateUIElement);
  const setUIElementCss = useEditorStore((state) => state.setUIElementCss);
  const extractUIComponent = useEditorStore((state) => state.extractUIComponent);
  const setUIBinding = useEditorStore((state) => state.setUIBinding);
  const variables = useEditorStore((state) => state.variables);
  const createVariable = useEditorStore((state) => state.createVariable);
  const assets = useEditorStore((state) => state.assets);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);
  const knownVars = useMemo(() => new Set(variables.map((v) => v.name)), [variables]);

  const patchStyle = (patch: Record<string, string | number | undefined>) => updateUIElement(doc.id, element.id, { style: { ...element.style, ...patch } });
  const patchEl = (patch: Partial<UIElement>) => updateUIElement(doc.id, element.id, patch);
  const setSource = (target: UIBinding['target'], p: Parsed) => setUIBinding(doc.id, element.id, target, buildExpression(p, target));
  const interactive = element.kind === 'button' || element.kind === 'input' || element.kind === 'toggle' || element.kind === 'slider' || element.kind === 'dropdown';
  const valueControl = element.kind === 'input' || element.kind === 'toggle' || element.kind === 'slider' || element.kind === 'dropdown';
  const patchState = (key: 'hover' | 'active' | 'disabled', stylePatch: Record<string, string | undefined>) =>
    patchEl({ states: { ...element.states, [key]: { ...(element.states?.[key] ?? {}), ...stylePatch } } });
  const styleConflicts = useMemo(() => inlineStyleConflicts(element), [element]);

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
        <>
          <label className="node-field">
            <span>Image</span>
            <select value={element.assetId ?? ''} onChange={(event) => updateUIElement(doc.id, element.id, { assetId: event.target.value || undefined })}>
              <option value="">None</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </label>
          <label className="node-field" title="How the image scales. 9-slice keeps corners fixed for scalable panels/borders.">
            <span>Scaling</span>
            <select value={element.imageFit ?? 'stretch'} onChange={(event) => patchEl({ imageFit: event.target.value as UIElement['imageFit'] })}>
              <option value="stretch">Stretch</option>
              <option value="contain">Contain (fit)</option>
              <option value="cover">Cover (fill)</option>
              <option value="nineSlice">9-slice (scalable border)</option>
            </select>
          </label>
          {element.imageFit === 'nineSlice' && (
            <label className="node-field">
              <span>Slice inset (px)</span>
              <input type="number" min={1} value={element.sliceInset ?? 12} onChange={(event) => patchEl({ sliceInset: Math.max(1, Number(event.target.value)) })} />
            </label>
          )}
        </>
      )}
      {element.kind === 'button' && (
        <label className="node-field">
          <span>On click → event</span>
          <input value={element.onClickEvent ?? ''} placeholder="e.g. restart" onChange={(event) => updateUIElement(doc.id, element.id, { onClickEvent: event.target.value || undefined })} />
        </label>
      )}

      {/* Interactive controls: two-way bind to a variable (reads + writes it during Play). */}
      {valueControl && (
        <>
          <label className="node-field" title="The control shows this variable's live value and writes edits back to it during Play.">
            <span>Bind to variable</span>
            <div className="ui-bind-fields">
              <select value={element.valueVariable ?? ''} onChange={(event) => patchEl({ valueVariable: event.target.value || undefined })}>
                <option value="">None (display only)</option>
                {variables.map((v) => (
                  <option key={v.id} value={v.name}>{v.name}</option>
                ))}
              </select>
              <button
                className="ui-bind-newvar"
                title="New variable"
                onClick={() => {
                  const type = element.kind === 'toggle' ? 'boolean' : element.kind === 'input' || element.kind === 'dropdown' ? 'string' : 'number';
                  const id = createVariable(undefined, type, false);
                  const name = useEditorStore.getState().variables.find((v) => v.id === id)?.name;
                  if (name) patchEl({ valueVariable: name });
                }}
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
          </label>
          {(element.kind === 'input' || element.kind === 'toggle') && (
            <label className="node-field">
              <span>{element.kind === 'input' ? 'Placeholder' : 'Label'}</span>
              {element.kind === 'input' ? (
                <input value={element.placeholder ?? ''} onChange={(event) => patchEl({ placeholder: event.target.value || undefined })} />
              ) : (
                <input value={element.text ?? ''} onChange={(event) => patchEl({ text: event.target.value })} />
              )}
            </label>
          )}
          {element.kind === 'slider' && (
            <div className="node-vector-field">
              <label className="node-field"><span>Min</span><input type="number" value={element.min ?? 0} onChange={(event) => patchEl({ min: Number(event.target.value) })} /></label>
              <label className="node-field"><span>Max</span><input type="number" value={element.max ?? 100} onChange={(event) => patchEl({ max: Number(event.target.value) })} /></label>
              <label className="node-field"><span>Step</span><input type="number" value={element.step ?? 1} onChange={(event) => patchEl({ step: Number(event.target.value) })} /></label>
            </div>
          )}
          {element.kind === 'dropdown' && (
            <label className="node-field" title="One option per line. The selected line's text is written to the variable.">
              <span>Options</span>
              <textarea
                rows={3}
                value={(element.options ?? []).join('\n')}
                onChange={(event) => patchEl({ options: event.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              />
            </label>
          )}
        </>
      )}

      {(doc.renderMode === 'webgl') && (
        <label className="node-field" title="WebGL renderer only. glow blooms via post-FX; holographic/scanline read as translucent panels.">
          <span>FX (WebGL)</span>
          <select value={element.fx ?? ''} onChange={(event) => updateUIElement(doc.id, element.id, { fx: (event.target.value || undefined) as UIElement['fx'] })}>
            <option value="">None</option>
            <option value="glow">Glow (bloom)</option>
            <option value="holographic">Holographic</option>
            <option value="scanline">Scanline</option>
          </select>
        </label>
      )}

      <UIWidgetLayoutFields doc={doc} element={element} />

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
      <div className="node-vector-field">
        <StyleField label="Min W" value={element.style.minWidth ?? ''} placeholder="—" onChange={(v) => patchStyle({ minWidth: v || undefined })} />
        <StyleField label="Max W" value={element.style.maxWidth ?? ''} placeholder="—" onChange={(v) => patchStyle({ maxWidth: v || undefined })} />
        <StyleField label="Min H" value={element.style.minHeight ?? ''} placeholder="—" onChange={(v) => patchStyle({ minHeight: v || undefined })} />
        <StyleField label="Max H" value={element.style.maxHeight ?? ''} placeholder="—" onChange={(v) => patchStyle({ maxHeight: v || undefined })} />
      </div>
      {(element.kind === 'panel' || element.kind === 'scroll') && (
        <>
          <label className="node-field">
            <span>Layout</span>
            <select
              value={element.style.display === 'block' ? 'canvas' : element.style.display === 'grid' ? 'grid' : element.style.flexDirection === 'row' ? 'row' : 'column'}
              onChange={(event) => {
                const v = event.target.value;
                if (v === 'canvas') patchStyle({ display: 'block', position: 'relative' });
                else if (v === 'grid') patchStyle({ display: 'grid', position: 'relative', flexDirection: undefined });
                else patchStyle({ display: 'flex', flexDirection: v as 'row' | 'column' });
              }}
            >
              <option value="column">Stack (column)</option>
              <option value="row">Row</option>
              <option value="grid">Grid</option>
              <option value="canvas">Canvas · free placement</option>
            </select>
          </label>
          {element.style.display === 'grid' && (
            <label className="node-field">
              <span>Grid columns</span>
              <input type="number" min={1} value={element.style.gridColumns ?? 2} onChange={(event) => patchStyle({ gridColumns: Math.max(1, Number(event.target.value)) })} />
            </label>
          )}
        </>
      )}
      {(element.kind === 'text' || element.kind === 'button') && (
        <>
          <StyleField label="Text Shadow" value={element.style.textShadow ?? ''} placeholder="0 0 8px #5adcff" onChange={(v) => patchStyle({ textShadow: v || undefined })} />
          <label className="node-field">
            <span>Overflow</span>
            <select value={element.style.textOverflow === 'ellipsis' ? 'ellipsis' : element.style.whiteSpace === 'nowrap' ? 'nowrap' : 'wrap'} onChange={(event) => {
              const v = event.target.value;
              if (v === 'ellipsis') patchStyle({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
              else if (v === 'nowrap') patchStyle({ textOverflow: undefined, whiteSpace: 'nowrap' });
              else patchStyle({ textOverflow: undefined, whiteSpace: undefined });
            }}>
              <option value="wrap">Wrap</option>
              <option value="nowrap">No wrap</option>
              <option value="ellipsis">Ellipsis (…)</option>
            </select>
          </label>
        </>
      )}
      {element.style.position === 'absolute' && (
        <>
          <div className="node-vector-field">
            <StyleField label="X" value={element.style.left ?? ''} placeholder="0px" onChange={(v) => patchStyle({ left: v || undefined })} />
            <StyleField label="Y" value={element.style.top ?? ''} placeholder="0px" onChange={(v) => patchStyle({ top: v || undefined })} />
          </div>
          <button className="full-button" onClick={() => patchStyle({ position: undefined, left: undefined, top: undefined })}>Return to auto-layout</button>
        </>
      )}

      {/* Anchor (screen docs): pin the element to a corner/edge so HUDs survive any resolution.
          Picking an anchor clears free placement; dragging on the canvas clears the anchor back. */}
      {doc.surface === 'screen' && element.id !== doc.root.id && (
        <>
          <h4 className="ui-inspector-sub">Anchor</h4>
          <label className="node-field">
            <span>Pin to parent</span>
            <select
              value={element.anchor ? `${element.anchor.h}:${element.anchor.v}` : ''}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  updateUIElement(doc.id, element.id, { anchor: undefined });
                  return;
                }
                const preset = ANCHOR_PRESETS.find((p) => `${p.h}:${p.v}` === value);
                if (!preset) return;
                updateUIElement(doc.id, element.id, {
                  anchor: { h: preset.h, v: preset.v, offsetX: element.anchor?.offsetX ?? 16, offsetY: element.anchor?.offsetY ?? 16 },
                  // Anchored placement replaces free placement.
                  style: { ...element.style, position: undefined, left: undefined, top: undefined },
                });
              }}
            >
              <option value="">None (flow / free placement)</option>
              {ANCHOR_PRESETS.map((preset) => (
                <option key={`${preset.h}:${preset.v}`} value={`${preset.h}:${preset.v}`}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {element.anchor && (
            <div className="node-vector-field">
              <label className="node-field">
                <span>Offset X</span>
                <input
                  type="number"
                  value={element.anchor.offsetX}
                  onChange={(event) => updateUIElement(doc.id, element.id, { anchor: { ...element.anchor!, offsetX: Number(event.target.value) } })}
                />
              </label>
              <label className="node-field">
                <span>Offset Y</span>
                <input
                  type="number"
                  value={element.anchor.offsetY}
                  onChange={(event) => updateUIElement(doc.id, element.id, { anchor: { ...element.anchor!, offsetY: Number(event.target.value) } })}
                />
              </label>
            </div>
          )}
        </>
      )}

      {/* Component instance: which widget, and the per-instance values it reads as param.* */}
      {element.kind === 'component' && <ComponentInstanceFields doc={doc} element={element} />}

      {/* Turn any subtree into a reusable widget — the move that stops a HUD being hardcoded. */}
      {element.id !== doc.root.id && element.kind !== 'component' && (
        <button
          className="full-button"
          title="Move this element and its children into a reusable component, and replace it here with an instance."
          onClick={() => extractUIComponent(doc.id, element.id)}
        >
          <Blocks size={12} aria-hidden /> Extract to component
        </button>
      )}

      {/* Raw CSS on this element — the escape hatch for anything the flat style model can't say
          (gradients, pseudo-elements, :hover, media queries). Scoped to the element on injection. */}
      <h4 className="ui-inspector-sub"><Code2 size={12} aria-hidden /> Custom CSS</h4>
      <p className="nfn-desc">
        <code>&amp;</code> is this element; any other selector matches inside it. Bare declarations style the element directly.
        {doc.renderMode === 'webgl' && <> <strong>This document uses the WebGL renderer, which ignores CSS</strong> — switch it to DOM in Document settings.</>}
      </p>
      <label className="node-field">
        <span>Class</span>
        <input
          value={element.className ?? ''}
          placeholder="e.g. hud-card"
          title="Class name for targeting this element from the document stylesheet."
          onChange={(event) => patchEl({ className: event.target.value || undefined })}
        />
      </label>
      <textarea
        className="ui-css"
        rows={4}
        spellCheck={false}
        value={element.css ?? ''}
        placeholder={'background: linear-gradient(180deg, #2f96a6, #11414c);\nborder-radius: 12px;\n\n&:hover { filter: brightness(1.15); }'}
        onChange={(event) => setUIElementCss(doc.id, element.id, event.target.value)}
      />
      {styleConflicts.length > 0 && (
        <p className="nfn-desc nfn-warn">
          Inline style wins over CSS for {styleConflicts.join(', ')} — clear {styleConflicts.length > 1 ? 'those fields' : 'that field'} above, or add <code>!important</code>.
        </p>
      )}

      {/* Pointer states (interactive kinds): hover / press / disabled colour overlays. */}
      {interactive && (
        <>
          <h4 className="ui-inspector-sub"><ListChecks size={12} aria-hidden /> States</h4>
          <p className="nfn-desc">Background colour while hovered, pressed, or disabled.</p>
          <StyleField label="Hover bg" type="color" value={element.states?.hover?.background ?? '#6f9bff'} onChange={(v) => patchState('hover', { background: v })} />
          <StyleField label="Press bg" type="color" value={element.states?.active?.background ?? '#4a78e6'} onChange={(v) => patchState('active', { background: v })} />
        </>
      )}

      {/* Entrance / looping animation (DOM backend). */}
      <h4 className="ui-inspector-sub"><Sparkles size={12} aria-hidden /> Animation</h4>
      <label className="node-field">
        <span>Play on appear</span>
        <select
          value={element.animation?.type ?? ''}
          onChange={(event) => {
            const type = event.target.value as NonNullable<UIElement['animation']>['type'] | '';
            if (!type) patchEl({ animation: undefined });
            else patchEl({ animation: { duration: 0.3, ...element.animation, type } });
          }}
        >
          <option value="">None</option>
          {UI_ANIMATION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      {element.animation && (
        <div className="node-vector-field">
          <label className="node-field"><span>Dur (s)</span><input type="number" step={0.05} value={element.animation.duration ?? 0.3} onChange={(event) => patchEl({ animation: { ...element.animation!, duration: Number(event.target.value) } })} /></label>
          <label className="node-field"><span>Delay</span><input type="number" step={0.05} value={element.animation.delay ?? 0} onChange={(event) => patchEl({ animation: { ...element.animation!, delay: Number(event.target.value) } })} /></label>
          <label className="node-field" title="Repeat forever (pulse/spin)"><span>Loop</span><input type="checkbox" checked={!!element.animation.loop} onChange={(event) => patchEl({ animation: { ...element.animation!, loop: event.target.checked } })} /></label>
        </div>
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

/** Header "+" dropdown: start a blank doc or drop in a complete HUD/menu template. */
function UINewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const createUIDocument = useEditorStore((state) => state.createUIDocument);
  const createUIFromTemplate = useEditorStore((state) => state.createUIFromTemplate);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu" ref={ref}>
      <button className="icon-button compact" title="New UI — blank or from a template" onClick={() => setOpen((value) => !value)}>
        <Plus size={14} aria-hidden />
      </button>
      {open && (
        <div className="file-menu-popover add-popover ui-new-popover">
          <button onClick={pick(() => createUIDocument(undefined, 'screen'))}>
            <LayoutDashboard size={14} aria-hidden />
            <span>Blank Screen HUD</span>
          </button>
          <button onClick={pick(() => createUIDocument(undefined, 'world'))}>
            <MonitorPlay size={14} aria-hidden />
            <span>Blank World UI</span>
          </button>
          <hr />
          <div className="file-menu-section">Templates</div>
          {UI_TEMPLATES.map((template) => {
            const Icon = TEMPLATE_ICON[template.kind];
            return (
              <button key={template.kind} title={template.blurb} onClick={pick(() => createUIFromTemplate(template.kind))}>
                <Icon size={14} aria-hidden />
                <span>{template.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function UIEditorPanel() {
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const createUIFromTemplate = useEditorStore((state) => state.createUIFromTemplate);
  const applyUITheme = useEditorStore((state) => state.applyUITheme);
  const activeUIDocumentId = useEditorStore((state) => state.activeUIDocumentId);
  const setActiveUIDocument = useEditorStore((state) => state.setActiveUIDocument);
  const createUIDocument = useEditorStore((state) => state.createUIDocument);
  const updateUIDocument = useEditorStore((state) => state.updateUIDocument);
  const setUIDocumentCss = useEditorStore((state) => state.setUIDocumentCss);
  const addUIPreset = useEditorStore((state) => state.addUIPreset);
  const selectedId = useEditorStore((state) => state.selectedUIElementId);
  const selectUIElement = useEditorStore((state) => state.selectUIElement);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('design');
  const [widgetSearch, setWidgetSearch] = useState('');
  const [focused, setFocused] = useState(() => isWorkspacePanelMaximized('ui'));
  useEffect(() => onWorkspacePanelMaximizedChange('ui', setFocused), []);
  const addUIElement = useEditorStore((state) => state.addUIElement);
  const insertUIComponent = useEditorStore((state) => state.insertUIComponent);

  const doc = uiDocuments.find((item) => item.id === activeUIDocumentId) ?? uiDocuments[0];
  const selectedElement = doc ? findInTree(doc.root, selectedId) ?? doc.root : undefined;
  const presetParent = () => (selectedElement && ['panel', 'scroll'].includes(selectedElement.kind) ? selectedElement.id : doc?.root.id);

  return (
    <section className="panel ui-panel">
      <div className="panel-header panel-header-actions-only">
        {uiDocuments.length > 0 && (
          // Components are grouped apart from screens/world UIs: they are building blocks you
          // compose, not HUDs you show.
          <select className="blueprint-select" value={doc?.id ?? ''} onChange={(event) => setActiveUIDocument(event.target.value)} title="Select UI document">
            <optgroup label="Screens">
              {uiDocuments.filter((item) => !item.isComponent).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </optgroup>
            {uiDocuments.some((item) => item.isComponent) && (
              <optgroup label="Components">
                {uiDocuments.filter((item) => item.isComponent).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        <UINewMenu />
        <button className="ui-focus-button" title="Focus UI designer" onClick={() => toggleWorkspacePanelMaximized('ui')}>{focused ? 'Exit focus' : 'Focus designer'}</button>
      </div>

      {doc && mode === 'logic' && (
        <div className="ui-tabbar">
          <button onClick={() => setMode('design')}>Design</button>
          <button className="active" onClick={() => setMode('logic')}>Logic</button>
        </div>
      )}

      {!doc ? (
        <div className="empty-state wide ui-empty">
          <LayoutDashboard size={18} aria-hidden />
          <span>Build HUDs & menus</span>
          <small>Start from a template — login, pause, settings, or a genre HUD — then tweak on the canvas.</small>
          <div className="ui-template-grid">
            <button className="ui-template-card" onClick={() => createUIDocument(undefined, 'screen')}>
              <LayoutDashboard size={18} aria-hidden />
              <strong>Blank Screen HUD</strong>
              <small>Empty full-screen overlay</small>
            </button>
            <button className="ui-template-card" onClick={() => createUIDocument(undefined, 'world')}>
              <MonitorPlay size={18} aria-hidden />
              <strong>Blank World UI</strong>
              <small>Floats over a 3D object</small>
            </button>
            {UI_TEMPLATES.map((template) => {
              const Icon = TEMPLATE_ICON[template.kind];
              return (
                <button key={template.kind} className="ui-template-card" onClick={() => createUIFromTemplate(template.kind)}>
                  <Icon size={18} aria-hidden />
                  <strong>{template.label}</strong>
                  <small>{template.blurb}</small>
                </button>
              );
            })}
          </div>
        </div>
      ) : mode === 'logic' ? (
        <UILogicGraph doc={doc} />
      ) : (
        // Dedicated palette, hierarchy, artboard and details stay separate while composing widgets.
        <div className="ui-design ui-design-workspace">
          <UIDesignerStage doc={doc} />

          <div className="ui-float-dock" role="toolbar" aria-label="UI tools">
            <div className="ui-seg ui-dock-seg">
              <button className="active" onClick={() => setMode('design')}>
                Design
              </button>
              <button onClick={() => setMode('logic')}>
                Logic
              </button>
            </div>
            <div className="ui-dock-divider" aria-hidden />
            <div className="ui-seg ui-dock-seg">
              <button className={clsx(doc.surface === 'screen' && 'active')} onClick={() => updateUIDocument(doc.id, { surface: 'screen' })} title="Drawn on the player's screen (HUD)">
                Screen
              </button>
              <button className={clsx(doc.surface === 'world' && 'active')} onClick={() => updateUIDocument(doc.id, { surface: 'world' })} title="Anchored over a 3D object">
                World
              </button>
            </div>
            <div className="ui-seg ui-dock-seg">
              <button
                className={clsx((doc.renderMode ?? 'dom') === 'dom' && 'active')}
                onClick={() => updateUIDocument(doc.id, { renderMode: 'dom' })}
                title="HTML/CSS overlay"
              >
                DOM
              </button>
              <button
                className={clsx(doc.renderMode === 'webgl' && 'active')}
                onClick={() => updateUIDocument(doc.id, { renderMode: 'webgl' })}
                title="WebGL (bloom / diegetic)"
              >
                WebGL
              </button>
            </div>
            <div className="ui-dock-divider" aria-hidden />
            <div className="ui-presets ui-dock-presets">
              {PRESETS.map(({ preset, label, icon: Icon }) => (
                <button key={preset} title={`Add ${label}`} onClick={() => selectUIElement(addUIPreset(doc.id, presetParent(), preset))}>
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="ui-theme-row ui-dock-themes">
              {UI_THEMES.map((theme) => (
                <button key={theme.kind} title={theme.blurb} onClick={() => applyUITheme(doc.id, theme.kind)}>
                  {theme.label}
                </button>
              ))}
            </div>
          </div>

          <aside className="ui-float-panel ui-float-layers">
            <div className="ui-section-title">Widget palette</div>
            <input className="ui-widget-search" aria-label="Search widgets" placeholder="Search widgets…" value={widgetSearch} onChange={(event) => setWidgetSearch(event.target.value)} />
            <div className="ui-widget-palette">
              {ELEMENT_KINDS.filter((item) => item.label.toLowerCase().includes(widgetSearch.toLowerCase())).map(({ kind, label, icon: Icon }) => <button key={kind} onClick={() => selectUIElement(addUIElement(doc.id, presetParent(), kind))}><Icon size={13} />{label}</button>)}
              {uiDocuments.filter((item) => item.isComponent && item.name.toLowerCase().includes(widgetSearch.toLowerCase()) && !wouldCreateUICycle(doc.id, item.id, uiDocuments)).map((item) => <button key={item.id} onClick={() => { const id = insertUIComponent(doc.id, presetParent(), item.id); if (id) selectUIElement(id); }}><Blocks size={13} />{item.name}</button>)}
            </div>
            <div className="ui-section-title">Hierarchy</div>
            <div className="ui-tree">
              <TreeRow element={doc.root} doc={doc} depth={0} addingUnder={addingUnder} setAddingUnder={setAddingUnder} />
            </div>
          </aside>

          {selectedElement && (
            <aside className="ui-float-panel ui-float-inspector">
              <div className="ui-section-title">
                {selectedElement.name} <span className="ui-section-kind">{selectedElement.kind}</span>
              </div>
              {doc.renderMode === 'webgl' && <p className="nfn-desc">Use DOM for editable inputs, toggles, dropdowns and CSS grid spans. WebGL displays these controls as readouts.</p>}
              <Properties doc={doc} element={selectedElement} />
              <details className="ui-section ui-doc-settings">
                <summary>Document</summary>
                <label className="ui-check">
                  <input type="checkbox" checked={doc.visibleOnStart} onChange={(event) => updateUIDocument(doc.id, { visibleOnStart: event.target.checked })} />
                  <span>Visible on start</span>
                </label>
                <div className="ui-doc-css">
                  <span className="ui-surface-label">
                    <Code2 size={12} aria-hidden /> Stylesheet
                  </span>
                  <textarea
                    className="ui-css"
                    rows={5}
                    spellCheck={false}
                    aria-label="Document stylesheet"
                    value={doc.css ?? ''}
                    placeholder={'.hud-card {\n  background: linear-gradient(180deg, #2f96a6, #11414c);\n  border-radius: 12px;\n}'}
                    onChange={(event) => setUIDocumentCss(doc.id, event.target.value)}
                  />
                </div>
              </details>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The instance half of a reusable widget: which component it points at, a jump to edit that
 * component, and the parameters this instance feeds it. Params are the reason one component can
 * serve many uses — the component's bindings read them as `param.<key>`.
 */
function ComponentInstanceFields({ doc, element }: { doc: UIDocument; element: UIElement }) {
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const updateUIElement = useEditorStore((state) => state.updateUIElement);
  const setUIComponentParam = useEditorStore((state) => state.setUIComponentParam);
  const setActiveUIDocument = useEditorStore((state) => state.setActiveUIDocument);
  const [newKey, setNewKey] = useState('');

  // Anything that would loop back to this document is not offered — you cannot pick a cycle.
  const choices = useMemo(
    () => uiDocuments.filter((item) => item.id !== doc.id && !wouldCreateUICycle(doc.id, item.id, uiDocuments)),
    [uiDocuments, doc.id],
  );
  const source = uiDocuments.find((item) => item.id === element.componentId);
  const params = element.componentParams ?? {};

  return (
    <>
      <h4 className="ui-inspector-sub"><Blocks size={12} aria-hidden /> Component</h4>
      <label className="node-field">
        <span>Widget</span>
        <select
          value={element.componentId ?? ''}
          onChange={(event) => updateUIElement(doc.id, element.id, { componentId: event.target.value || undefined })}
        >
          <option value="">Pick a component…</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>{item.name}{item.isComponent ? '' : ' (screen)'}</option>
          ))}
        </select>
      </label>
      {source ? (
        <>
          <button className="full-button" onClick={() => setActiveUIDocument(source.id)}>
            Edit “{source.name}” →
          </button>
          <p className="nfn-desc">
            Edits to that component appear in <strong>every</strong> instance. Give this one its own data below —
            the component reads them as <code>param.name</code>.
          </p>
          {Object.entries(params).map(([key, value]) => (
            <label className="node-field" key={key}>
              <span>{key}</span>
              <input
                value={value}
                placeholder="value or expression"
                onChange={(event) => setUIComponentParam(doc.id, element.id, key, event.target.value)}
              />
            </label>
          ))}
          <div className="ui-bind-fields">
            <input
              value={newKey}
              placeholder="new parameter, e.g. label"
              onChange={(event) => setNewKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !newKey.trim()) return;
                setUIComponentParam(doc.id, element.id, newKey.trim(), "''");
                setNewKey('');
              }}
            />
            <button
              className="ui-bind-newvar"
              title="Add parameter"
              disabled={!newKey.trim()}
              onClick={() => {
                setUIComponentParam(doc.id, element.id, newKey.trim(), "''");
                setNewKey('');
              }}
            >
              <Plus size={12} aria-hidden />
            </button>
          </div>
        </>
      ) : (
        <p className="nfn-desc">Pick a component to instance here, or build one with “Extract to component” on any element.</p>
      )}
    </>
  );
}

/**
 * Properties an element declares in BOTH its inline style and its CSS. React writes inline styles
 * onto the node, so those always win — silently, which reads as "my CSS does nothing". Declarations
 * marked `!important` are excluded because they do win.
 */
function inlineStyleConflicts(element: UIElement): string[] {
  if (!element.css?.trim()) return [];
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const inline = new Set<string>();
  for (const [key, value] of Object.entries(element.style)) {
    if (value == null || key === 'custom' || key === 'gridColumns') continue;
    inline.add(kebab(key));
  }
  for (const key of Object.keys(element.style.custom ?? {})) inline.add(kebab(key));

  const hits = new Set<string>();
  for (const match of element.css.matchAll(/(?:^|[;{])\s*(-{0,2}[a-zA-Z][\w-]*)\s*:([^;}]*)/g)) {
    const prop = match[1].toLowerCase();
    if (prop.startsWith('--') || /!\s*important/i.test(match[2])) continue;
    if (inline.has(prop)) hits.add(prop);
  }
  return [...hits].slice(0, 4);
}

function findInTree(root: UIElement, id: string): UIElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findInTree(child, id);
    if (found) return found;
  }
  return undefined;
}
