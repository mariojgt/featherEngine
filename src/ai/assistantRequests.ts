import { focusWorkspacePanel } from '../components/workspacePanels';

type Listener = (prompt: string) => void;
let listener: Listener | undefined;
let started = false;
const pending: string[] = [];

/** Capture prompts even while the Agent panel's code is still loading. */
export function startAssistantRequests(): void {
  if (started) return;
  started = true;
  window.addEventListener('nf:ask-ai', (event) => {
    const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
    focusWorkspacePanel('agent');
    if (!prompt) return;
    if (listener) listener(prompt);
    else pending.push(prompt);
  });
}

export function subscribeAssistantRequests(next: Listener): () => void {
  listener = next;
  for (const prompt of pending.splice(0)) next(prompt);
  return () => { if (listener === next) listener = undefined; };
}
