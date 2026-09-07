import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIElementView } from '../UIElementView';
import { hasInteractive } from '../ScreenUILayer';
import { makeUIDocument, makeUIElement } from '../../store/editor/ui';

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
const mount = (element: React.ReactNode) => {
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); }
  act(() => root!.render(element));
  return host;
};
afterEach(() => { root = undefined; });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('reusable widget runtime', () => {
  it('honors both true and false visibility node overrides ahead of bindings', () => {
    const element = { ...makeUIElement('text'), text: 'Visible', bindings: [{ target: 'visible' as const, expression: 'false' }] };
    mount(<UIElementView element={element} ctx={{ vars: {} }} visibleOverrides={{ [element.id]: true }} />);
    expect(host.textContent).toBe('Visible');
    mount(<UIElementView element={element} ctx={{ vars: {} }} visibleOverrides={{ [element.id]: false }} />);
    expect(host.textContent).toBe('');
  });

  it('resolves instance text, width, parameters and independent click events without wrappers', () => {
    const source = makeUIDocument('Button', 'screen');
    source.root = makeUIElement('button');
    source.root.bindings = [{ target: 'text', expression: 'param.label' }];
    const a = { ...makeUIElement('component'), componentId: source.id, onClickEvent: 'chooseA', componentParams: { label: "'A'" }, bindings: [{ target: 'width' as const, expression: "'180px'" }] };
    const b = { ...a, id: 'second', onClickEvent: 'chooseB', componentParams: { label: "'B'" } };
    const events: string[] = [];
    const panel = { ...makeUIElement('panel'), children: [a, b] };
    mount(<UIElementView element={panel} ctx={{ vars: {} }} resolveComponent={() => source} textOverrides={{ [a.id]: 'Override A' }} onButtonClick={(element) => events.push(element.onClickEvent!)} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Override A', 'B']);
    expect(buttons[0].style.width).toBe('180px');
    expect(buttons[0].parentElement?.dataset.uielId).toBe(panel.id);
    act(() => buttons.forEach((button) => button.click()));
    expect(events).toEqual(['chooseA', 'chooseB']);
  });

  it('applies an instance anchor once and ignores a source document root anchor', () => {
    const source = makeUIDocument('Reusable', 'screen');
    source.root.children = [makeUIElement('text')];
    const instance = { ...makeUIElement('component'), componentId: source.id, anchor: { h: 'left' as const, v: 'top' as const, offsetX: 16, offsetY: 24 } };
    mount(<UIElementView element={instance} ctx={{ vars: {} }} resolveComponent={() => source} />);
    const floating = [...host.querySelectorAll<HTMLElement>('div')].filter((node) => node.style.position === 'absolute');
    expect(floating).toHaveLength(1);
    expect(floating[0].style.left).toBe('16px');
    expect(floating[0].style.top).toBe('24px');
  });

  it('disables all controls in a disabled widget instance and finds nested focus targets', () => {
    const source = makeUIDocument('Nested controls', 'screen');
    source.root.children = [makeUIElement('button')];
    const doc = makeUIDocument('HUD', 'screen');
    doc.root.children = [{ ...makeUIElement('component'), componentId: source.id, bindings: [{ target: 'disabled', expression: 'true' }] }];
    expect(hasInteractive(doc, [doc, source])).toBe(true);
    mount(<UIElementView element={doc.root} ctx={{ vars: {} }} resolveComponent={() => source} />);
    expect(host.querySelector('button')?.disabled).toBe(true);
    source.root.children = [{ ...makeUIElement('component'), componentId: doc.id }];
    expect(hasInteractive(doc, [doc, source])).toBe(false);
  });
});
