/** Offline capture owns the simulation clock and requests renders explicitly. Configure before
 * mounting GameView; normal editor/player sessions never enable this mode. */
let enabled = false;
let renderFrame: (() => Promise<void>) | undefined;

export function configureCinematicCapture(value: boolean): void { enabled = value; }
export function isCinematicCaptureEnabled(): boolean { return enabled; }
export function registerCinematicCaptureRenderer(render: () => Promise<void>): () => void {
  renderFrame = render;
  return () => { if (renderFrame === render) renderFrame = undefined; };
}
export async function renderCinematicCaptureFrame(): Promise<void> {
  if (!enabled || !renderFrame) throw new Error('The cinematic capture renderer is not mounted.');
  await renderFrame();
}
