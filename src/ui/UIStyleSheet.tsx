/**
 * Injects one UI document's raw CSS — the document stylesheet plus every element's snippet —
 * already scoped to that document by `buildUIDocumentCss`.
 *
 * Every DOM host mounts this next to its element tree and stamps the wrapper with
 * `uiDocScopeProps(doc.id)`; that attribute is the anchor the scoped selectors hang off. Because
 * all three hosts (design canvas, screen HUD, world widget) go through here, a widget looks the
 * same in the editor preview as it does in Play.
 */
import { useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { UIDocument } from '../types';
import { buildUIDocumentCss, UI_DOC_SCOPE_ATTR } from './uiCss';

/** Spread onto the wrapper element that owns a document's subtree. */
export function uiDocScopeProps(docId: string): Record<string, string> {
  return { [UI_DOC_SCOPE_ATTR]: docId };
}

export function UIStyleSheet({ doc }: { doc: UIDocument }) {
  // Component instances need their component's rules in the same sheet, so this depends on the
  // whole document list — not just `doc`.
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const css = useMemo(
    () => buildUIDocumentCss(doc, (id) => uiDocuments.find((d) => d.id === id)),
    [doc, uiDocuments],
  );
  // Zero-specificity defaults make nested widgets containing blocks without overriding a kit's
  // own absolute positioning. Inline defaults would silently defeat authored stylesheet rules.
  return <>
    <style data-ui-layout>{':where([data-uidoc]) :where([data-uiel-id]) { position: relative; }'}</style>
    {css && <style data-ui-css={doc.id}>{css}</style>}
  </>;
}
