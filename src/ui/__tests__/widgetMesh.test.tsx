import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { UIElementMesh } from '../UIElementMesh';
import { makeUIDocument, makeUIElement } from '../../store/editor/ui';
import { styleToUikit } from '../styleToUikit';

const clicks = vi.hoisted(() => [] as Array<() => void>);
// Test the renderer's bindings and event routing before the GPU-specific presentation boundary.
vi.mock('@react-three/uikit', () => ({
  Container: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => { if (onClick) clicks.push(onClick); return <div>{children}</div>; },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Image: () => <img alt="" />,
  withOpacity: (color: string) => color,
}));

describe('WebGL widget binding and event routing', () => {
  it('honors forced visibility and routes reusable button events to the instance', () => {
    clicks.length = 0;
    const source = makeUIDocument('Button', 'screen');
    source.root = { ...makeUIElement('button'), bindings: [{ target: 'visible', expression: 'false' }, { target: 'text', expression: 'param.label' }] };
    const instance = { ...makeUIElement('component'), componentId: source.id, onClickEvent: 'selected', componentParams: { label: "'Potion'" } };
    const events: string[] = [];
    const html = renderToStaticMarkup(<UIElementMesh element={instance} ctx={{ vars: {} }} visibleOverrides={{ [instance.id]: true }} textOverrides={{ [instance.id]: 'Changed' }} resolveComponent={() => source} onButtonClick={(element) => events.push(element.onClickEvent!)} />);
    expect(html).toContain('Changed');
    expect(clicks).toHaveLength(1); clicks[0](); expect(events).toEqual(['selected']);
    clicks.length = 0;
    renderToStaticMarkup(<UIElementMesh element={{ ...instance, bindings: [{ target: 'disabled', expression: 'true' }] }} ctx={{ vars: {} }} visibleOverrides={{ [instance.id]: true }} resolveComponent={() => source} onButtonClick={() => {}} />);
    expect(clicks).toHaveLength(0);
  });
  it('translates fill slots and clipping for the WebGL layout backend', () => {
    expect(styleToUikit({ flexGrow: 1, flexShrink: 0, flexBasis: '160px', alignSelf: 'stretch', overflow: 'auto' })).toMatchObject({ flexGrow: 1, flexShrink: 0, flexBasis: 160, alignSelf: 'stretch', overflow: 'scroll' });
  });
});
