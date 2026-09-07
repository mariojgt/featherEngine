import { useEditorStore } from '../store/editorStore';
import { findUIElement, findUIParent } from '../store/editor/ui';
import type { UIDocument, UIElement, UIStyle } from '../types';

export function UIWidgetLayoutFields({ doc, element }: { doc: UIDocument; element: UIElement }) {
  const update = useEditorStore((state) => state.updateUIElement);
  const reparent = useEditorStore((state) => state.reparentUIElement);
  const patch = (value: Partial<UIStyle>) => update(doc.id, element.id, { style: { ...element.style, ...value } });
  const parents: Array<{ id: string; name: string }> = [];
  const walk = (node: UIElement, path: string) => {
    if (findUIElement(element, node.id)) return;
    if (node.kind === 'panel' || node.kind === 'scroll') parents.push({ id: node.id, name: path + node.name });
    node.children.forEach((child) => walk(child, path + node.name + ' / '));
  };
  walk(doc.root, '');
  const container = element.kind === 'panel' || element.kind === 'scroll';
  return <>
    <h4 className="ui-inspector-sub">Layout & slot</h4>
    {element.id !== doc.root.id && <>
      <label className="node-field"><span>Parent</span><select aria-label="Widget parent" value={findUIParent(doc.root, element.id)?.id ?? ''} onChange={(event) => reparent(doc.id, element.id, event.target.value)}>
        {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
      </select></label>
      <label className="node-field"><span>Slot sizing</span><select value={element.style.flexGrow ? 'fill' : 'auto'} onChange={(event) => patch(event.target.value === 'fill' ? { flexGrow: 1, flexShrink: 1, flexBasis: '0px', minWidth: '0px', minHeight: '0px' } : { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' })}>
        <option value="auto">Auto · fit content</option><option value="fill">Fill · share available space</option>
      </select></label>
      <label className="node-field"><span>Slot alignment</span><select value={element.style.alignSelf ?? 'auto'} onChange={(event) => patch({ alignSelf: event.target.value })}>
        {['auto', 'stretch', 'flex-start', 'center', 'flex-end'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="node-field"><span>Layer order</span><input type="number" value={element.style.zIndex ?? 0} onChange={(event) => patch({ zIndex: Number(event.target.value) })} /></label>
      <label className="node-field"><span>Margin</span><input placeholder="0px" value={element.style.margin ?? ''} onChange={(event) => patch({ margin: event.target.value || undefined })} /></label>
      {findUIParent(doc.root, element.id)?.style.display === 'grid' && <>
        <label className="node-field"><span>Grid column</span><input placeholder="auto or 1 / span 2" value={element.style.gridColumn ?? ''} onChange={(event) => patch({ gridColumn: event.target.value || undefined })} /></label>
        <label className="node-field"><span>Grid row</span><input placeholder="auto or 1 / span 2" value={element.style.gridRow ?? ''} onChange={(event) => patch({ gridRow: event.target.value || undefined })} /></label>
      </>}
    </>}
    {container && <>
      <label className="node-field"><span>Spacing</span><input value={element.style.gap ?? ''} placeholder="8px" onChange={(event) => patch({ gap: event.target.value || undefined })} /></label>
      <label className="node-field"><span>Align children</span><select value={element.style.alignItems ?? 'stretch'} onChange={(event) => patch({ alignItems: event.target.value })}>
        {['stretch', 'flex-start', 'center', 'flex-end'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="node-field"><span>Distribute</span><select value={element.style.justifyContent ?? 'flex-start'} onChange={(event) => patch({ justifyContent: event.target.value })}>
        {['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="node-field"><span>Wrap children</span><select value={element.style.flexWrap ?? 'nowrap'} onChange={(event) => patch({ flexWrap: event.target.value as UIStyle['flexWrap'] })}>
        <option value="nowrap">Single line</option><option value="wrap">Wrap</option>
      </select></label>
    </>}
    <label className="node-field"><span>Clipping</span><select value={element.style.overflow ?? (element.kind === 'scroll' ? 'auto' : 'visible')} onChange={(event) => patch({ overflow: event.target.value as UIStyle['overflow'] })}>
      <option value="visible">Visible</option><option value="hidden">Clip to bounds</option><option value="auto">Scroll when needed</option>
    </select></label>
  </>;
}
