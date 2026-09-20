import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Check, ChevronRight, Eye, EyeOff, Globe, LoaderCircle, Play, Power, Server, Sparkles } from 'lucide-react';
import { defineFeatherPlugin, type FeatherPluginAPI } from '../types';
import { TitanClient } from '../../titan/client';
import { TITAN_DEFAULT_API_URL, TITAN_PLUGIN_ID, isTitanScene, titanReleaseConfig, validateTitanSettings, type TitanProjectSettings } from '../../titan/settings';
import type { TitanRealmStatus } from '../../titan/preview';
import { activeExportProfile } from '../../project/exportProfiles';
import '../../titan/titan.css';
const PANEL_ID = `${TITAN_PLUGIN_ID}.setup`;
const steps = ['Connect', 'Test', 'Publish'] as const;
const setupDraft = (settings: TitanProjectSettings) => ({ ...settings, baseUrl: settings.baseUrl || TITAN_DEFAULT_API_URL });

export function TitanPanel({ api }: { api: FeatherPluginAPI }) {
  const [settings, setSettings] = useState(() => setupDraft(api.titan.settings()));
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState(() => api.titan.settings().baseUrl ? 'titan' : 'demo');
  const [visible, setVisible] = useState(false);
  const [realm, setRealm] = useState<TitanRealmStatus>({ running: false });
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>({ text: 'Open the starter, then connect your game in three steps.' });
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let sceneId = '';
    try { sceneId = api.project.read().activeSceneId; } catch { /* The panel also opens before creating a project. */ }
    const refresh = () => {
      const next = api.titan.settings(); setSettings(setupDraft(next)); setAccounts(next.baseUrl ? 'titan' : 'demo'); setStep(0);
      setNotice({ text: 'Project loaded. Choose your connection below.' });
    };
    const project = api.events.on('project:changed', refresh);
    // Package imports finish after the new-project event, including the saved variables.
    const scene = api.events.on('scene:changed', event => { if (event.activeSceneId !== sceneId) { sceneId = event.activeSceneId; refresh(); } });
    return () => { project(); scene(); };
  }, [api]);
  useEffect(() => { let live = true; const update = () => { void api.titan.realmStatus().then(value => { if (live) setRealm(value); }).catch(() => {}); }; update(); const timer = setInterval(update, 4000); return () => { live = false; clearInterval(timer); }; }, [api]);
  const attempt = async (label: string, action: () => Promise<string> | string) => {
    setBusy(label); try { setNotice({ text: await action() }); } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); } finally { setBusy(''); }
  };
  const apply = () => {
    const checked = validateTitanSettings({ ...settings, ...(accounts === 'demo' ? { baseUrl: '', gameKey: '' } : {}) });
    if (accounts === 'titan' && !checked.baseUrl) throw new Error('Paste the API base URL and game key from your Titan project.');
    api.titan.configure(checked); setSettings(setupDraft(checked)); return checked;
  };
  const release = () => { const checked = apply(); const profile = activeExportProfile(api.project.read().exportSettings); return titanReleaseConfig(checked, profile.application.identifier, profile.targets.includes('web')); };
  return <section className="titan-setup titan-wizard" aria-label="Titan game setup">
    <header className="titan-wizard-heading"><span className="titan-eyebrow">TITAN × FEATHER</span><h2>Your game, connected.</h2><p>Set it up here. Your players just sign in.</p></header>
    <div className="titan-starter-card"><Sparkles size={22} /><div><strong>Start with Ember Meadow</strong><small>A complete first quest, ready to make your own.</small></div><button disabled={!!busy} onClick={() => void attempt('Opening starter', async () => {
      if (!await api.titan.openStarter()) return 'Starter opening cancelled.';
      const next = api.titan.settings(); setSettings(setupDraft(next)); setAccounts(next.baseUrl ? 'titan' : 'demo'); setStep(0); return 'Your world is open. Choose how players will join.';
    })}>Open starter <ChevronRight size={14} /></button></div>
    <nav className="titan-setup-steps" aria-label="Setup steps">{steps.map((title, index) => <button key={title} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{title}</button>)}</nav>
    {step === 0 && <div className="titan-wizard-body">
      <h3>How will players sign in?</h3><p>Choose demo accounts to explore immediately, or connect your existing Titan project.</p>
      <div className="titan-account-options" role="group" aria-label="Account provider">
        <button aria-pressed={accounts === 'demo'} onClick={() => setAccounts('demo')}><Sparkles size={18} /><strong>Demo accounts</strong><small>Try the game without a key.</small></button>
        <button aria-pressed={accounts === 'titan'} onClick={() => { setSettings(setupDraft(settings)); setAccounts('titan'); }}><Globe size={18} /><strong>Titan accounts</strong><small>Your players and cloud saves.</small></button>
      </div>
      {accounts === 'titan' && <div className="titan-connection-fields">
        <aside className="titan-walkthrough" aria-label="Where to find your connection">
          <strong>First time? Get these two values from Titan.</strong>
          <ol><li><b>Open your Titan dashboard.</b> Sign in, go to Projects, and open the game you want to connect. Create a project if this is your first game.</li><li><b>Find Connect your game.</b> Choose the Feather Engine tab. The Unreal tab shows the same connection values.</li><li><b>Copy both values into the fields below.</b> Copy API base URL into the first field, then Game key into the second. Keep both from the same project.</li></ol>
          <a href="https://feather-engine.com/titan/#find-your-key" target="_blank" rel="noreferrer">Open the illustrated setup guide ↗</a>
        </aside>
        <label htmlFor="titan-api-url">API base URL<input id="titan-api-url" aria-describedby="titan-api-help" type="url" placeholder={TITAN_DEFAULT_API_URL} value={settings.baseUrl} onChange={event => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
        <p id="titan-api-help" className="titan-field-help">Example: <code>https://yourproject.supabase.co</code>. This is the same starting example as Unreal. Replace it with your project’s API base URL, rather than the dashboard page address.</p>
        <label htmlFor="titan-game-key">Game key<div className="titan-key-field"><input id="titan-game-key" aria-describedby="titan-key-help" type={visible ? 'text' : 'password'} placeholder="Paste your Titan game key" value={settings.gameKey} onChange={event => setSettings({ ...settings, gameKey: event.target.value })} autoComplete="off" spellCheck={false} /><button aria-label={visible ? 'Hide game key' : 'Show game key'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        <p id="titan-key-help" className="titan-field-help">Use the Game key shown by Titan for this project. You do not need your player password or a Supabase service-role key here.</p>
        <p><strong>What happens next?</strong> Test &amp; save checks the connection and key, then opens Test. It does not create a player. Your first character is created when you join the game.</p>
      </div>}
      <button className="titan-wizard-primary" disabled={!!busy} onClick={() => void attempt('Checking connection', async () => {
        const checked = validateTitanSettings({ ...settings, ...(accounts === 'demo' ? { baseUrl: '', gameKey: '' } : {}) });
        if (accounts === 'titan') await new TitanClient(checked).checkConnection();
        apply(); setStep(1); return accounts === 'titan' ? 'Titan connected. Next, press Play the game and choose Join realm. Save your Feather project to keep this connection.' : 'Demo accounts ready. Press Play the game, then Join realm to test multiplayer.';
      })}>{busy === 'Checking connection' ? <LoaderCircle className="titan-spin" size={16} /> : <Check size={16} />}{accounts === 'titan' ? 'Test & save' : 'Continue with demo accounts'}</button>
    </div>}
    {step === 1 && <div className="titan-wizard-body">
      <h3>Try your shared world.</h3><p>Press Play. Feather starts the local server using your saved connection automatically.</p>
      <div className="titan-realm-card"><Server size={24} /><div><strong>{realm.running ? 'Local realm is running' : 'Ready to start'}</strong><small>{realm.running ? `${realm.authMode === 'titan' ? 'Titan' : 'Demo'} accounts · saves kept on this computer` : 'No terminal, dependency installation, or configuration files.'}</small></div><span className={realm.running ? 'titan-state-dot on' : 'titan-state-dot'} /></div>
      <div className="titan-wizard-actions"><button className="titan-wizard-primary" disabled={!!busy} onClick={() => void attempt('Starting realm', async () => { apply(); const next = await api.titan.startRealm(); setRealm(next); return 'Your realm is ready. Press Play, then Join realm.'; })}><Power size={16} />{realm.running ? 'Restart with saved settings' : 'Start local realm'}</button>
        {realm.running && <button disabled={!!busy} onClick={() => void attempt('Stopping realm', async () => { setRealm(await api.titan.stopRealm()); return 'Local realm stopped. Saved characters are kept.'; })}>Stop realm</button>}
      </div>
      <button className="titan-wizard-play" disabled={!!busy} onClick={() => void attempt('Opening game', async () => { apply(); await api.titan.play(); return 'Game preview opened.'; })}><Play size={18} />Play the game</button>
      <aside className="titan-walkthrough" aria-label="Your first connected game"><strong>Your first connected game</strong><ol><li><b>Press Play the game.</b> Wait for the login screen and “Local realm ready”. Feather starts the server for you.</li><li><b>Enter a character name, then Join realm.</b> {accounts === 'titan' ? 'Keep Play as a guest selected to try it immediately, or choose Create an account / Sign in.' : 'Demo accounts work without a Titan key.'} “Realm online” confirms that you joined.</li><li><b>Try one saved adventure.</b> Walk to Warden Elara with WASD and press E. Complete her quest, open Inventory, equip your blade, then Save progress. Leave and join again to check your character.</li></ol><p>{accounts === 'titan' ? 'A successful save says “Progress saved to the realm and Titan cloud.” In Titan, open your project’s Players and Cloud Saves to see the player and ember-meadow save slot.' : 'Demo progress stays on this realm’s disk. Choose Titan accounts in Connect when you want to test cloud saves.'}</p></aside>
      <p className="titan-setup-hint">For a second adventurer, open another browser profile. Solo play also works while the realm is stopped.</p>
      <button className="titan-text-button" onClick={() => setStep(2)}>Ready to publish <ChevronRight size={14} /></button>
    </div>}
    {step === 2 && <div className="titan-wizard-body">
      <h3>Make the connection part of your game.</h3><p>Players receive a normal login screen. The build remembers your choices.</p>
      <div className="titan-account-options" role="group" aria-label="Release mode">
        <button aria-pressed={settings.publishMode === 'practice'} onClick={() => setSettings({ ...settings, publishMode: 'practice' })}><Play size={18} /><strong>Solo game</strong><small>Runs on the player’s device.</small></button>
        <button aria-pressed={settings.publishMode === 'online'} onClick={() => setSettings({ ...settings, publishMode: 'online' })}><Globe size={18} /><strong>Online game</strong><small>Connects to your hosted realm.</small></button>
      </div>
      {settings.publishMode === 'online' && <>
        <aside className="titan-walkthrough" aria-label="Understand your production addresses"><strong>Two services, two different addresses</strong><div className="titan-connection-map"><span>Players<br /><small>Your game</small></span><ChevronRight size={16} /><span>Realm server<br /><small>Movement &amp; rewards</small></span><ChevronRight size={16} /><span>Titan API<br /><small>Accounts &amp; cloud saves</small></span></div><p>The API URL you pasted in Connect belongs to Titan. The hosted realm address below belongs to the server that runs your shared world. Your hosting provider supplies that address after you deploy the configured server.</p></aside>
        <label>Hosted realm address<input type="url" placeholder="https://realm.yourgame.com" value={settings.realmUrl.startsWith('http://127.0.0.1') ? '' : settings.realmUrl} onChange={event => setSettings({ ...settings, realmUrl: event.target.value })} /></label>
        <label>Game website origin<input type="url" placeholder="https://play.yourgame.com" value={settings.gameOrigin} onChange={event => setSettings({ ...settings, gameOrigin: event.target.value })} /></label>
        <p>Use the website’s origin, without a path. Leave it empty for a desktop-only build.</p>
        <div className="titan-publish-includes"><Check size={16} /><span><strong>Included automatically</strong>Configured server, Titan connection, allowed game origins, and player login settings.</span></div>
        <p>Deploy the included <strong>realm-server</strong> folder to your server host. The Docker configuration is ready to use; attach a persistent volume for character saves.</p>
        <div className="titan-wizard-actions"><button disabled={!!busy} onClick={() => void attempt('Preparing server', async () => { release(); await api.titan.exportServer(); return 'Configured server package exported. Deploy it at your hosted realm address.'; })}>Export configured server</button>
        <button disabled={!!busy} onClick={() => void attempt('Checking hosted realm', async () => {
          release(); const checked = api.titan.settings(); const response = await fetch(`${checked.realmUrl}/health`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('The hosted realm is unavailable. Deploy the configured server and try again.');
          const data = await response.json(); if (data.protocol !== 1) throw new Error('This address is not a compatible Titan realm.');
          if (data.gameId !== activeExportProfile(api.project.read().exportSettings).application.identifier) throw new Error('This realm belongs to another game. Deploy this project’s configured server package.');
          if (data.authMode !== (checked.baseUrl ? 'titan' : 'local')) throw new Error('The realm uses different account settings. Deploy the newly configured server package.');
          return 'Hosted realm is online. Your production game will connect automatically.';
        })}>Test hosted realm</button></div>
      </>}
      <button className="titan-wizard-primary" disabled={!!busy} onClick={() => void attempt('Preparing build', async () => { release(); await api.titan.build(); return 'Build review opened with your saved Titan settings.'; })}><Globe size={16} />Build game</button>
    </div>}
    <div className={`titan-wizard-notice${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>{busy ? <><LoaderCircle className="titan-spin" size={15} /> {busy}…</> : notice.text}</div>
    <details className="titan-setup-help" open={notice.error || undefined}><summary>Need help with this step?</summary><ul><li><strong>Connection or key rejected:</strong> copy both values again from the same Titan project. Replace the example URL; use the Game key from Connect your game.</li><li><strong>Only solo practice is available:</strong> return to Test and press Play the game. Join realm appears when the local server is ready. Solo practice has a separate character.</li><li><strong>Character already connected:</strong> leave the first session, or use a different browser profile for a second player.</li><li><strong>Publishing online:</strong> deploy the configured server first, then Test hosted realm. Players receive the saved connection in the build.</li></ul></details>
    <footer className="titan-wizard-footer">Connection settings are part of your Feather project. Save the project to keep your changes. <a href="https://feather-engine.com/titan/" target="_blank" rel="noreferrer">Integration guide ↗</a></footer>
  </section>;
}

export const titanPlugin = defineFeatherPlugin({ id: TITAN_PLUGIN_ID, name: 'Titan — Game Backend', version: '1.1.0', apiVersion: '0.2.0',
  activate(api) {
    const open = () => { api.titan.edit(); api.panels.open(PANEL_ID); };
    api.panels.register({ id: PANEL_ID, title: 'Titan Backend', placement: { referencePanel: 'viewport', direction: 'within' }, render: () => <TitanPanel api={api} /> });
    api.commands.register({ id: `${TITAN_PLUGIN_ID}.open`, title: 'Open Titan Backend', group: 'Extensions', run: open });
    let frame = 0;
    const guidedScenes = new Set<string>();
    const guideStarter = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!isTitanScene(api.objects.list()) || api.titan.settings().gameKey) return;
        try {
          const scene = api.project.read().activeSceneId;
          if (guidedScenes.has(scene)) return;
          open(); guidedScenes.add(scene);
        } catch { /* No editable project, or a collaboration viewer. */ }
      });
    };
    const sceneGuide = api.events.on('scene:changed', guideStarter);
    const playGuide = api.events.on('runtime:play-changed', event => { if (event.isPlaying) cancelAnimationFrame(frame); });
    guideStarter();
    api.tools.register({ id: 'configure', title: 'Configure Titan', description: 'Save Titan account and publication settings. The plugin manages local realms and includes a configured server in online production exports. Never supply player passwords, tokens, or Supabase secret keys.',
      inputSchema: z.object({ realmUrl: z.string(), baseUrl: z.string().default(''), gameKey: z.string().default(''), publishMode: z.enum(['practice', 'online']).default('practice'), gameOrigin: z.string().default('') }),
      execute: async input => { api.titan.configure({ realmUrl: String(input.realmUrl), baseUrl: String(input.baseUrl ?? ''), gameKey: String(input.gameKey ?? ''), publishMode: input.publishMode === 'online' ? 'online' : 'practice', gameOrigin: String(input.gameOrigin ?? '') }); return 'Titan connection and release settings saved in the project.'; } });
    api.tools.register({ id: 'open-starter', title: 'Open Ember Meadow', description: 'Open Ember Meadow as a new project with unsaved-changes confirmation. Configure it in Titan Backend.', inputSchema: z.object({}), execute: async () => await api.titan.openStarter() ? 'Ember Meadow is ready.' : 'Starter opening was cancelled or failed.' });
    api.tools.register({ id: 'start-realm', title: 'Start local Titan realm', description: 'Start or restart the managed local realm using saved Titan settings. No shell commands or environment files.', inputSchema: z.object({}), execute: async () => { const state = await api.titan.startRealm(); return `Local realm running at ${state.url}. Press Play and Join realm.`; } });
    api.tools.register({ id: 'stop-realm', title: 'Stop local Titan realm', description: 'Stop the managed local realm, preserving saved characters.', inputSchema: z.object({}), execute: async () => { await api.titan.stopRealm(); return 'Local realm stopped.'; } });
    api.tools.register({ id: 'export-server', title: 'Export configured Titan server', description: 'Download the server deployment package using saved online release settings, including origins and Titan connection. Production builds include it automatically.', inputSchema: z.object({}), execute: async () => { await api.titan.exportServer(); return 'Configured realm server exported.'; } });
    window.addEventListener('feather:titan-setup', open);
    return () => { cancelAnimationFrame(frame); sceneGuide(); playGuide(); window.removeEventListener('feather:titan-setup', open); };
  },
});
