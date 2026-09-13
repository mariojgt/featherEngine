export const CLOUD_WORKFLOW = 'feather-build-centre.yml';
export interface CloudSetup { repository: string; ref: string }
export interface CloudJob {
  requestId: string; repository: string; ref: string; createdAt: number; commit?: string;
  run?: CloudRun; error?: string; directory?: string; cleaned?: boolean;
}
export interface CloudRun {
  id: number; status: string; conclusion: string | null; url: string; commit: string;
  jobs: Array<{ name: string; status: string; conclusion: string | null; steps: Array<{ name: string; conclusion: string | null }> }>;
  artifacts: Array<{ name: string; size: number; expired: boolean }>;
}
export interface CloudRequest extends CloudSetup {
  action: 'check' | 'start' | 'status' | 'download' | 'cancel' | 'retry' | 'cleanup';
  requestId?: string; runId?: number; bundleJson?: string; expectedCommit?: string; directory?: string;
}
export interface CloudReply { repository?: string; private?: boolean; commit?: string; run?: CloudRun; directory?: string; message?: string }
export function validateCloudSetup(setup: CloudSetup): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(setup.repository)) return 'Use a GitHub repository in owner/name form.';
  if (!setup.ref || setup.ref.startsWith('-') || /[^A-Za-z0-9_./-]/.test(setup.ref) || setup.ref.includes('..') || setup.ref.includes('@{') || setup.ref.length > 200) return 'Enter a valid branch or tag, such as main.';
  return null;
}
export const cloudReleaseTag = (requestId: string) => `feather-build-${requestId}`;
export function cloudProjectKey(dir: string | null, name: string) { return `feather.build-centre.v1:${dir ?? ''}:${name}`; }
export function readCloudHistory(key: string): { setup: CloudSetup; jobs: CloudJob[] } {
  const fallback = { setup: { repository: '', ref: 'main' }, jobs: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!stored || !stored.setup || typeof stored.setup.repository !== 'string' || typeof stored.setup.ref !== 'string') return fallback;
    return { setup: stored.setup, jobs: Array.isArray(stored.jobs) ? stored.jobs.filter((j: CloudJob) => /^[a-f0-9]{32}$/.test(j?.requestId) && !validateCloudSetup(j) && Number.isFinite(j.createdAt)).slice(0, 20) : [] };
  } catch { return fallback; }
}
