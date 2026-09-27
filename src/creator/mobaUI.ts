import { useEditorStore } from '../store/editorStore';
import type { UIElement } from '../types';
import { MOBA_HEROES } from '../project/mobaHeroes';
import { addMobaShopUI, MOBA_SHOP_CSS } from './mobaShopUI';

function portrait(id: number, color: string): string {
  const helmets = [
    `<path d="M43 84V47L64 27 87 47v37l-23 15z" fill="#71868d"/><path d="M47 60h35v10H47z" fill="#112a35"/><path d="M50 64h29" stroke="#a8f4f0" stroke-width="3"/><path d="M61 27V8h7v22" fill="#d8b571"/>`,
    `<path d="M36 89l9-45 19-17 22 17 7 45-29 13z" fill="${color}"/><path d="M46 72V57l18-9 18 9v15l-18 15z" fill="#273c36"/><path d="M48 60l-4-27 13 17m25 10 4-27-13 17" fill="#e0d7ae"/><path d="m50 68 9 2m10 0 9-2" stroke="#e6e4af" stroke-width="3"/>`,
    `<path d="M44 78V53q20-26 40 0v25l-20 17z" fill="#d7bba0"/><path d="m35 53 29-40 31 40-31-8z" fill="${color}"/><path d="M35 53h60" stroke="#e1bc75" stroke-width="5"/><path d="M55 69h4m11 0h4" stroke="#383343" stroke-width="3"/>`,
    `<path d="M39 84V44l25-19 26 19v40L64 97z" fill="#586f76"/><path d="m41 49 23-11 23 11-23 14z" fill="${color}"/><path d="M47 63h35v12H47z" fill="#163036"/><path d="M50 69h29" stroke="#eccd80" stroke-width="3"/>`,
    `<path d="M42 78V49q22-29 44 0v29L64 98z" fill="#d7bba0"/><path d="m36 51 28-36 28 36-28-8z" fill="${color}"/><circle cx="64" cy="29" r="7" fill="#f2d993"/><path d="M51 65h7m12 0h7" stroke="#254c50" stroke-width="3"/>`,
  ];
  const weapon =
    id === 1
      ? '<path d="M99 145V69" stroke="#bd9c62" stroke-width="7"/><path d="M87 58h27v24H87z" fill="#9caaa4"/>'
      : id === 2
        ? '<path d="m11 137 12-49 7 50m68 0 7-50 12 49" fill="#e9e4c8"/>'
        : id === 4
          ? '<path d="M108 67q-37 35 0 74M108 67v74" fill="none" stroke="#d3b270" stroke-width="4"/>'
          : '<path d="M105 145V67" stroke="#caaa73" stroke-width="4"/><circle cx="105" cy="58" r="14" fill="none" stroke="#caaa73" stroke-width="4"/><path d="m105 44 8 14-8 14-8-14z" fill="#a8e8eb"/>';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="168" viewBox="0 0 128 168"><defs><radialGradient id="g"><stop stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="#111f27"/></radialGradient></defs><rect width="128" height="168" fill="url(#g)"/><circle cx="64" cy="72" r="48" fill="none" stroke="${color}" stroke-opacity=".35"/><path d="M18 166 28 107 51 94h26l23 13 11 59" fill="${color}"/><path d="m28 110-14 24 28 10 9-40m49 6 14 24-28 10-9-40" fill="#53636b"/><path d="m51 98 13 25 13-25v63H51z" fill="#20333c"/><path d="m57 113 7-8 7 8-7 13z" fill="#d4b56e"/>${helmets[id - 1]}${weapon}</svg>`)}`;
}
/** All menus and HUD elements are normal editable UI documents. */
export function addMobaUI(worldId: string): string {
  const s = useEditorStore.getState(),
    folder = s.createFolder('Lumen Lane · Interface'),
    doc = s.createUIDocument(
      'Lumen Lane · Heroes and match HUD',
      'screen',
      folder,
    );
  s.updateUIDocument(doc, {
    visibleOnStart: true,
    renderMode: 'dom',
    css: MOBA_CSS + MOBA_SHOP_CSS,
  });
  s.attachUI(worldId, doc);
  const root = useEditorStore.getState().uiDocuments.find((d) => d.id === doc)!
    .root.id;
  s.updateUIElement(doc, root, {
    className: 'll-ui',
    style: { width: '100%', height: '100%', display: 'block', padding: '0' },
    anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 },
  });
  const el = (
    parent: string,
    kind: 'panel' | 'text' | 'button',
    name: string,
    patch: Partial<UIElement>,
    visible?: string,
  ) => {
    const id = s.addUIElement(doc, parent, kind);
    s.updateUIElement(doc, id, { name, style: {}, states: {}, ...patch });
    if (visible) s.setUIBinding(doc, id, 'visible', visible);
    return id;
  };
  const text = (
    parent: string,
    name: string,
    content: string,
    className = 'll-copy',
    binding?: string,
  ) => {
    const id = el(parent, 'text', name, { text: content, className });
    if (binding) s.setUIBinding(doc, id, 'text', binding);
    return id;
  };
  const button = (
    parent: string,
    name: string,
    content: string,
    event: string,
    className = 'll-button',
  ) =>
    el(parent, 'button', name, {
      text: content,
      className,
      onClickEvent: event,
    });
  const modal = (name: string, visible: string, extra = '') =>
    el(
      root,
      'panel',
      name,
      {
        className: `ll-modal ${extra}`,
        anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 },
      },
      visible,
    );
  const welcome = modal('Hero selection', 'LLIntro', 'll-draft');
  text(welcome, 'Eyebrow', 'LUMEN LANE  /  THE ASTRAL RIFT', 'll-eyebrow');
  text(welcome, 'Title', 'Choose your champion', 'll-title');
  text(
    welcome,
    'Match description',
    'Three lanes. Two citadels. Start with 500 gold — open the shop with P.',
    'll-subtitle',
  );
  const cards = el(welcome, 'panel', 'Five champions', {
    className: 'll-heroes',
  });
  for (const hero of MOBA_HEROES) {
    const card = button(
      cards,
      hero.name,
      `${hero.name}\n${hero.role}`,
      `LLHero${hero.id}`,
      `ll-hero ll-hero-${hero.id}`,
    );
    s.setUIBinding(
      doc,
      card,
      'background',
      `LLHeroChoice == ${hero.id} ? '#c3a567' : '#172b34'`,
    );
    s.setUIBinding(
      doc,
      card,
      'color',
      `LLHeroChoice == ${hero.id} ? '#142329' : '#e4d9bd'`,
    );
  }
  text(
    welcome,
    'Chosen champion',
    '',
    'll-chosen',
    "LLHeroName + '  /  ' + LLHeroRole",
  );
  text(
    welcome,
    'Archetype details',
    '',
    'll-copy',
    MOBA_HEROES.map(
      (h) =>
        `LLHeroChoice == ${h.id} ? '${h.description}. ${h.q}: ${h.qDescription}' : `,
    ).join('') + "''",
  );
  const start = button(
    welcome,
    'Enter the Rift',
    'Enter the Rift  →',
    'LLStart',
    'll-button ll-start',
  );
  s.setUIBinding(doc, start, 'text', "'Play as ' + LLHeroName + '  →'");
  text(
    welcome,
    'Quick controls',
    'Right-click ground to move · Click an enemy to chase and attack\nQ / R aim at cursor · E dash · B recall · S stop · P shop · Esc pause',
    'll-controls',
  );
  text(
    welcome,
    'Offline information',
    'SOLO VS AI  ·  TWO ALLIED HEROES  ·  THREE ENEMY HEROES',
    'll-eyebrow',
  );
  const hud = el(
    root,
    'panel',
    'Match HUD',
    {
      className: 'll-hud',
      style: { width: '100%', height: '100%', display: 'block' },
      anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 },
    },
    '!LLIntro && !LLDone && !LLPaused && !LLShopOpen',
  );
  const brand = el(hud, 'panel', 'Match title', {
    className: 'll-brand',
    anchor: { h: 'left', v: 'top', offsetX: 22, offsetY: 18 },
  });
  text(brand, 'World name', 'THE ASTRAL RIFT', 'll-eyebrow');
  text(brand, 'Objective', 'Break a tower. Shatter their core.', 'll-copy');
  const score = el(hud, 'panel', 'Scoreboard', {
    className: 'll-score',
    anchor: { h: 'center', v: 'top', offsetX: 0, offsetY: 14 },
  });
  text(score, 'Azure', '', 'll-mint', "'AZURE  ' + LLMintTower + ' / 3' ");
  text(
    score,
    'Clock',
    '',
    'll-clock',
    "(LLSeconds / 60 - LLSeconds / 60 % 1) + ':' + (LLSeconds % 60 < 10 ? '0' : '') + (LLSeconds % 60 - LLSeconds % 1)",
  );
  text(score, 'Crimson', '', 'll-coral', "LLCoralTower + ' / 3  CRIMSON'");
  const tray = el(hud, 'panel', 'Champion controls', {
    className: 'll-tray',
  });
  const identity = el(tray, 'panel', 'Champion identity', {
    className: 'll-identity',
  });
  text(identity, 'Name', '', 'll-hero-name', 'LLHeroName');
  text(identity, 'Role', '', 'll-eyebrow', 'LLHeroRole');
  const health = el(tray, 'panel', 'Health track', { className: 'll-health' });
  const fill = el(health, 'panel', 'Health fill', {
    className: 'll-health-fill',
  });
  s.setUIBinding(doc, fill, 'width', "(LLHealth / LLMaxHealth * 100) + '%' ");
  text(
    health,
    'Health value',
    '',
    'll-health-number',
    "LLHealth > 0 ? LLHealth + ' / ' + LLMaxHealth : 'RESPAWN IN ' + LLRespawn + 's'",
  );
  const actions = el(tray, 'panel', 'Abilities', { className: 'll-actions' });
  for (const [name, key, cooldown, label] of [
    ['Ability', 'Q', 'LLPulse', 'LLQName'],
    ['Dash', 'E', 'LLDash', "'Dash'"],
    ['Ultimate', 'R', 'LLUltimate', 'LLRName'],
    ['Recall', 'B', 'LLRecall', "'Recall'"],
  ]) {
    const id = button(
      actions,
      name,
      `${key}\n${name}`,
      cooldown,
      'll-button ll-ability',
    );
    s.setUIBinding(
      doc,
      id,
      'text',
      `'${key}  ·  ' + (${cooldown} > 0 ? ${cooldown} + 's' : ${label})`,
    );
    s.setUIBinding(doc, id, 'disabled', `${cooldown} > 0 || LLHealth <= 0`);
  }
  text(
    tray,
    'Next wave',
    '',
    'll-tray-hint',
    "'WAVE ' + LLWaves + '  ·  NEXT ' + (LLWaveIn - LLWaveIn % 1) + 's     |     RIGHT-CLICK TO MOVE / ATTACK'",
  );
  button(identity, 'Pause', 'Pause / Esc', 'LLPause', 'll-button ll-small');
  addMobaShopUI(doc, root);
  const paused = modal('Pause menu', 'LLPaused');
  text(paused, 'Pause label', 'MATCH PAUSED', 'll-eyebrow');
  text(paused, 'Pause title', 'A moment to plan', 'll-title');
  text(
    paused,
    'Strategy',
    'Push behind your minions. Towers target them first. Break any enemy lane tower to expose the crystal core. Open the shop with P. Buy or sell items at base. Gold accrues at 2 per second; takedowns and towers grant more. Jungle sentinels reward 100 gold and return after 30 seconds.\n\nUse B to recall; movement or damage interrupts the channel. Click the minimap for long journeys.',
  );
  button(paused, 'Resume', 'Return to battle', 'LLPause');
  button(paused, 'Restart', 'Restart with this hero', 'LLStart');
  button(paused, 'Change champion', 'Choose another champion', 'LLChooseAgain');
  const result = modal('Match results', 'LLDone');
  text(result, 'Result label', 'THE ASTRAL RIFT', 'll-eyebrow');
  text(result, 'Result', '', 'll-title', "LLWon ? 'Victory' : 'Defeat'");
  text(
    result,
    'Result copy',
    '',
    'll-copy',
    "LLWon ? 'The crimson core has fallen. The Rift is yours.' : 'Your citadel has fallen. Regroup and take another lane.'",
  );
  button(result, 'Play again', 'Fight again', 'LLStart');
  button(result, 'Change champion', 'Choose another champion', 'LLChooseAgain');
  return doc;
}
export const MOBA_CSS = `
.ll-ui{font-family:Inter,system-ui,sans-serif;color:#e9dfc5;pointer-events:none}
.ll-eyebrow{font-size:10px;font-weight:750;letter-spacing:2px;color:#b8ac8e;white-space:normal}
.ll-title{font-family:Georgia,serif;font-size:42px;line-height:1.08;letter-spacing:-1px;color:#eee3c4}
.ll-subtitle{font-family:Georgia,serif;font-size:18px;color:#aab8b6}
.ll-copy{font-size:12px;line-height:1.65;white-space:pre-line;color:#c2ccca}
.ll-modal{display:flex;flex-direction:column;align-items:stretch;gap:16px;width:480px;max-width:90vw;max-height:92%;overflow:auto;padding:30px;background:linear-gradient(145deg,#162c35fa,#0c1921fa);border:1px solid #a68c58;border-radius:5px;box-shadow:0 30px 100px #000a;text-align:center;pointer-events:auto}
.ll-draft{width:880px;padding:27px 35px;gap:12px}
.ll-heroes{display:flex;flex-direction:row;gap:10px;justify-content:center;margin:6px 0 0}
.ll-hero{flex:1;min-width:0;white-space:pre-line;line-height:1.8;letter-spacing:1px;font-size:10px;font-weight:800;border:1px solid #78694b;border-radius:3px;padding:0 0 10px;cursor:pointer;transition:transform .15s,filter .15s;pointer-events:auto}
.ll-hero::before{content:'';display:block;height:166px;margin:3px 3px 8px;background-size:cover;background-position:center 30%}
${MOBA_HEROES.map((h) => `.ll-hero-${h.id}::before{background-image:url("${portrait(h.id, h.color)}")}`).join('\n')}
.ll-hero:hover{transform:translateY(-4px);filter:brightness(1.16)}
.ll-hero:focus-visible,.ll-button:focus-visible{outline:2px solid #efe0a9;outline-offset:3px}
.ll-chosen{font-size:13px;letter-spacing:2px;color:#d5ba7f;font-weight:800}
.ll-controls{font-size:11px;line-height:1.9;white-space:pre-line;color:#a5b9b7}
.ll-button{pointer-events:auto;background:linear-gradient(#bca263,#907440);border:1px solid #debf79;border-radius:3px;padding:12px 17px;color:#111e24;font:750 12px Inter,system-ui,sans-serif;cursor:pointer}
.ll-button:hover{filter:brightness(1.15)}.ll-button:disabled{filter:saturate(.35);opacity:.4;cursor:default}
.ll-start{width:290px;align-self:center;text-transform:uppercase;letter-spacing:1.7px;padding:15px}
.ll-brand{display:flex;flex-direction:column;gap:4px;text-shadow:0 2px 8px #000}
.ll-score{display:flex;flex-direction:row;gap:23px;align-items:center;padding:13px 25px;background:#101f27ed;border:1px solid #867346;border-radius:0 0 8px 8px;box-shadow:0 5px 20px #0005}
.ll-mint,.ll-coral{font-size:11px;font-weight:800;letter-spacing:1px}.ll-mint{color:#72d9d4}.ll-coral{color:#ed8b93}.ll-clock{font-size:16px;font-variant-numeric:tabular-nums;color:#e3d5ae}
.ll-tray{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;width:490px;max-width:51vw;gap:9px;background:linear-gradient(135deg,#162c33f7,#0c171ef7);padding:14px 17px;border:1px solid #b19862;border-radius:5px;box-shadow:0 8px 35px #0007}
.ll-identity{display:flex;flex-direction:row;justify-content:space-between;align-items:center}.ll-hero-name{font-family:Georgia,serif;font-size:21px;color:#eddfb8}
.ll-health{height:19px;background:#080f14;position:relative;border:1px solid #6c7c62;border-radius:2px;overflow:hidden;display:block}.ll-health-fill{height:100%;background:linear-gradient(90deg,#286854,#60aa7c);position:absolute;left:0;top:0;transition:width .12s}
.ll-health-number{position:absolute;left:0;right:0;top:2px;text-align:center;font-size:10px;letter-spacing:.5px;color:white;text-shadow:0 1px 3px #000}
.ll-actions{display:flex;flex-direction:row;gap:7px}.ll-ability{flex:1;min-width:0;padding:12px 5px;background:linear-gradient(#30494e,#1b2e36);color:#e5d6b3;border-color:#7e7355;font-size:10px}
.ll-tray-hint{font-size:8px;letter-spacing:1px;text-align:center;color:#a4b4b1}
.ll-small{padding:7px 12px;font-size:10px;background:#233c43;color:#d6c7a1;border-color:#62634f}.ll-small-copy{font-size:9px;color:#9ab0aa}
@media(max-width:900px){.ll-draft{width:91vw;padding:20px}.ll-title{font-size:32px}.ll-hero::before{height:125px}.ll-brand{display:none}.ll-tray{width:450px;max-width:calc(76vw - 28px);left:12px;transform:none}.ll-ability{font-size:9px;padding:10px 3px}.ll-tray-hint{font-size:7px}}
@media(max-width:600px){.ll-heroes{gap:4px}.ll-hero{font-size:8px;letter-spacing:0}.ll-hero::before{height:90px}.ll-draft{padding:16px;gap:10px}.ll-tray{padding:11px;gap:7px}.ll-identity .ll-eyebrow{font-size:7px;letter-spacing:.5px}.ll-hero-name{font-size:17px}.ll-small{font-size:8px;padding:6px}.ll-score{gap:12px;padding:10px}.ll-controls{font-size:9px}.ll-ability{font-size:8px}}
`;
