import { useEffect } from 'react';
import { getPlatform, isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { useBuildCentreStore } from '../store/buildCentreStore';
import { WorkflowDialog } from './WorkflowDialog';
import { cloudReleaseTag } from '../project/cloudBuild';

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function BuildCentreDialog() {
  const state = useBuildCentreStore();
  const local = useProjectStore(s => s.lastProductionBuild), localOutput = useProjectStore(s => s.lastProductionOutput);
  const localBusy = useProjectStore(s => s.busy);
  useEffect(() => {
    if (!state.open) return;
    const timer = setInterval(() => {
      const current = useBuildCentreStore.getState();
      const pending = current.jobs.find(job => !job.cleaned && !job.error && job.run?.status !== 'completed');
      if (pending && !current.busy) void current.manage(pending.requestId, 'status');
    }, 10000);
    return () => clearInterval(timer);
  }, [state.open]);
  if (!state.open) return null;
  const reveal = async (path: string) => { try { await (await getPlatform()).revealFile?.(path); } catch (error) { useBuildCentreStore.setState({ error: String(error) }); } };
  return <WorkflowDialog title="Build Centre" onClose={state.close}>
    <p>Build your game, check that it launches, and collect the files for your players.</p>
    <section className="workflow-card"><h3>Build on this computer</h3><p>Review your saved build profile, choose available platforms and prepare a playable release.</p><div className="workflow-actions"><button className="prefs-primary-button" disabled={localBusy} onClick={() => { state.close(); void useProjectStore.getState().exportProduction(); }}>Review local build…</button>{localOutput && isDesktop && <button onClick={() => void reveal(localOutput)}>Open latest build folder</button>}</div>
      {local && <ul>{local.artifacts.map(artifact => <li key={artifact.target}>{artifact.target} · launch check {artifact.launchTest}</li>)}</ul>}
      {local?.artifacts.some(a => a.target !== 'web') && <button onClick={() => { state.close(); window.dispatchEvent(new Event('feather:publish-build')); }}>Continue to Steam…</button>}
    </section>
    <section className="workflow-card"><h3>Build for Windows, macOS and Linux</h3><p>GitHub Actions runs one build and launch check on each operating system. Linux also produces a web archive.</p>
      {!isDesktop && <p className="workflow-muted">Open this project in Feather desktop to connect GitHub. You can build and download a web game here.</p>}
      <details><summary>One-time setup</summary><ol><li>Put this version of Feather in a GitHub repository you can write to. Commit its Build Centre workflow and scripts to the default branch and the branch you select below.</li><li>Install <a href="https://cli.github.com/" target="_blank" rel="noreferrer">GitHub CLI</a> on this computer and run <code>gh auth login</code>. Give it repository and Actions access.</li><li>Enable GitHub Actions in that repository. Choose a private repository when your game package needs to stay private.</li></ol><p>Credentials stay in GitHub CLI. Builds use your GitHub Actions allowance. Uploaded input packages stay in draft releases until you remove them below; run artifacts expire after 14 days.</p></details>
      <div className="workflow-fields"><label>GitHub repository<input aria-label="GitHub repository" placeholder="owner/feather-engine" value={state.setup.repository} disabled={state.busy || !isDesktop} onChange={e => state.configure({ ...state.setup, repository: e.target.value.trim() })} /></label><label>Engine branch or tag<input aria-label="Engine branch or tag" value={state.setup.ref} disabled={state.busy || !isDesktop} onChange={e => state.configure({ ...state.setup, ref: e.target.value.trim() })} /></label></div>
      <div className="workflow-actions"><button disabled={state.busy || !isDesktop} onClick={() => void state.check()}>Check connection</button><button disabled={state.busy || !state.checked?.commit} onClick={() => void state.prepare()}>Prepare game package</button></div>
      {state.checked && <p className="workflow-success">Connected to {state.checked.repository} · {state.checked.private ? 'private' : 'public'} repository · engine {state.checked.commit?.slice(0, 8)}</p>}
      {state.prepared && <div className="workflow-preview"><h3>Review cloud build</h3><p><strong>{state.prepared.name}</strong> · {size(state.prepared.bytes)} · {state.prepared.scenes} scenes · {state.prepared.assets} assets</p><p>Prepared {new Date(state.prepared.createdAt).toLocaleTimeString()}. This snapshot will upload to a draft release in <strong>{state.setup.repository}</strong> and run on GitHub Actions using engine {state.prepared.commit.slice(0, 8)}. Later edits are not included.</p>{state.prepared.warnings.length > 0 && <ul>{state.prepared.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}<button className="prefs-primary-button" disabled={state.busy} onClick={() => void state.start()}>Upload package and start builds</button></div>}
    </section>
    {state.busy && <p role="status">Working… large uploads, downloads and builds can take several minutes.</p>}
    {state.error && <p className="workflow-error" role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
    {state.jobs.length > 0 && <h3>Cloud build history</h3>}
    {state.jobs.map(job => <section className="workflow-card" key={job.requestId}><h3>{job.repository} · {job.run?.conclusion ?? job.run?.status ?? 'Requested'}</h3><p className="workflow-muted">{new Date(job.createdAt).toLocaleString()} · {job.ref} · request {job.requestId.slice(0, 8)}</p>
      {job.error && <p className="workflow-error">{job.error} Refresh to recover a run that started. If dispatch failed, inspect its draft in GitHub Releases before preparing a new build.</p>}
      {job.run?.jobs.map((row, i) => <p key={i}>{row.name}: {row.conclusion ?? row.status} · launch check {row.steps?.find(step => step.name === 'Launch game')?.conclusion ?? 'pending'}</p>)}
      {job.run && <p><a href={job.run.url} target="_blank" rel="noreferrer">View GitHub logs</a> · {job.run.artifacts.map(a => `${a.name}: ${a.expired ? 'expired' : size(a.size)}`).join(' · ') || 'No artifacts yet'}</p>}
      <div className="workflow-actions"><button disabled={state.busy || !isDesktop} onClick={() => void state.manage(job.requestId, 'status')}>Refresh</button><button disabled={state.busy || !job.run?.artifacts.some(a => !a.expired) || !isDesktop} onClick={() => void state.manage(job.requestId, 'download')}>Collect artifacts…</button>{job.run?.status === 'completed' ? <button disabled={state.busy || job.cleaned || !isDesktop} onClick={() => void state.manage(job.requestId, 'retry')}>Rebuild same package</button> : job.run && <button disabled={state.busy || !isDesktop} onClick={() => void state.manage(job.requestId, 'cancel')}>Cancel build</button>}{job.directory && <button onClick={() => void reveal(job.directory!)}>Open collected files</button>}</div>
      <p><a href={`https://github.com/${job.repository}/releases`} target="_blank" rel="noreferrer">View input drafts on GitHub</a></p><p className="workflow-muted">{job.cleaned ? 'Uploaded input package removed. Prepare a new package for another build.' : <>Input: {cloudReleaseTag(job.requestId)}. Removing it disables retries.</>}</p>{!job.cleaned && <button disabled={state.busy || !isDesktop || job.run?.status !== 'completed'} onClick={() => void state.manage(job.requestId, 'cleanup')}>Remove uploaded input package</button>}
    </section>)}
    <details className="workflow-card"><summary>Signing and publishing</summary><p>Cloud results are portable game archives and a launch report. Extract the archive before testing or selecting its game folder in Steam publishing. Native launch checks verify the first scene renders; they do not test a complete playthrough. The web archive needs an HTTP server and a browser playtest.</p><p>These builds are unsigned on Windows and Linux. macOS uses an ad-hoc signature for the launch check, without notarization. Public distribution may need your developer certificates and signing setup in the repository. The report records this status; a passed launch check does not mean a signed release.</p><p><a href="https://v2.tauri.app/distribute/sign/macos/" target="_blank" rel="noreferrer">macOS signing and notarization</a> · <a href="https://v2.tauri.app/distribute/sign/windows/" target="_blank" rel="noreferrer">Windows signing setup</a></p></details>
  </WorkflowDialog>;
}
