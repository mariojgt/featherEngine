import {
  CLASSES, ENEMIES, ITEMS, QUESTS, SLOTS, ZONES, questObjectives,
  type ClassId, type Enemy, type Hero, type ItemId, type NpcDef, type QuestId, type ZoneId,
} from '../../examples/titan-mmo/server/world.mjs';
import { realmCommand } from './session';

const QUEST_IDS = Object.keys(QUESTS) as QuestId[];
const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const questOfZone = (zone: ZoneId): QuestId => QUEST_IDS.find(id => QUESTS[id].zone === zone) ?? QUEST_IDS[0];
const giverName = (questId: QuestId) => ZONES[QUESTS[questId].zone].npcs.find(npc => npc.id === QUESTS[questId].giver)?.name ?? 'the keeper';
const rewardLine = (questId: QuestId) => {
  const reward = QUESTS[questId].reward;
  return [`${reward.gold} gold`, ...Object.keys(reward.items).map(item => ITEMS[item as ItemId].name)].join(' · ');
};

/** Story tracker: this zone's chapter in full, then a compact line for every other active quest. */
export function TitanQuestTracker({ hero, zone, log, onToggleLog }: { hero: Hero; zone: ZoneId; log: boolean; onToggleLog: () => void }) {
  const questId = zone === 'sunlit-valley' ? QUEST_IDS.find(id => hero.quests[id]?.state !== 'complete') ?? QUEST_IDS[2] : questOfZone(zone);
  const quest = QUESTS[questId];
  const entry = hero.quests[questId];
  const objectives = questObjectives(hero, questId);
  const elsewhere = QUEST_IDS.filter(id => id !== questId && hero.quests[id]?.state === 'active');
  return <aside className="titan-card titan-quest">
    <span className="titan-eyebrow">{entry?.state === 'complete' ? 'CHAPTER COMPLETE' : `STORY QUEST · LEVEL ${quest.level}`}</span>
    <h2>{quest.name}</h2>
    {!entry
      ? <p>Find {giverName(questId)}.<br />{quest.brief}</p>
      : entry.state === 'complete'
        ? <p>{quest.after}</p>
        : <>{objectives.map(objective => <div key={objective.label} className={objective.done ? 'titan-done' : ''}>
            {objective.type === 'gather' ? '◆' : '⚔'} {objective.label} <b>{objective.done ? '✓ ' : ''}{objective.current}/{objective.count}</b>
          </div>)}
          <div className={objectives.every(o => o.done) ? 'titan-done' : ''}>✧ Return to {giverName(questId)}</div></>}
    {elsewhere.map(id => <div key={id} className="titan-quest-other">↳ {QUESTS[id].name} <b>{questObjectives(hero, id).filter(o => o.done).length}/{QUESTS[id].objectives.length}</b></div>)}
    <footer>REWARD <span>{rewardLine(questId)}</span></footer>
    <button className="titan-questlog-toggle" aria-pressed={log} onClick={onToggleLog}>Quest log (L)</button>
    {log && <ol className="titan-questlog">
      {QUEST_IDS.map(id => {
        const state = hero.quests[id]?.state;
        return <li key={id} className={state === 'complete' ? 'titan-done' : ''}>
          <strong>Chapter {ZONES[QUESTS[id].zone].chapter} · {QUESTS[id].name}</strong>
          <small>{state === 'complete' ? 'Complete' : state === 'active' ? 'In progress' : `Not started · Level ${QUESTS[id].level}`} · {ZONES[QUESTS[id].zone].name}</small>
        </li>;
      })}
    </ol>}
  </aside>;
}

/** The raid-style frame the Ashen Warden takes over, including its ember burst warning. */
export function TitanBossFrame({ boss }: { boss: Enemy }) {
  const burst = ENEMIES.boss.burst;
  return <div className="titan-card titan-boss" role="status">
    <strong>{boss.name}</strong>
    <div className="titan-boss-health"><i style={{ width: `${Math.max(0, (boss.health / boss.maxHealth) * 100)}%` }} /></div>
    <small>{boss.burstAt > 0 ? `EMBER BURST INCOMING — step out of the ring (${burst?.radius ?? 5} m)` : `${Math.round(boss.health)} / ${boss.maxHealth}`}</small>
  </div>;
}

/** Equipment, the satchel, and the vendor's stall when one is open. */
export function TitanBag({ hero, solo, vendor, onClose }: { hero: Hero; solo: boolean; vendor: NpcDef | undefined; onClose: () => void }) {
  const owned = ITEM_IDS.filter(id => (hero.inventory[id] ?? 0) > 0);
  return <section className="titan-card titan-bag" aria-label="Inventory">
    <div className="titan-bag-heading">
      <div><span className="titan-eyebrow">YOUR EQUIPMENT</span><h2>Wayfarer’s satchel</h2></div>
      <button aria-label="Close inventory" onClick={onClose}>×</button>
    </div>
    <div className="titan-slots">
      {SLOTS.map(slot => {
        const item = hero.equipped[slot];
        return <div key={slot} className="titan-slot">
          <span className="titan-item-icon">{item ? ITEMS[item].icon : '·'}</span>
          <div><small>{slot}</small><strong>{item ? ITEMS[item].name : 'Empty'}</strong></div>
          {item && slot !== 'weapon' && <button onClick={() => realmCommand({ type: 'unequip', slot })}>Unequip</button>}
        </div>;
      })}
    </div>
    <p className="titan-gold">◈ {hero.gold} gold</p>
    <div className="titan-items">{owned.map(id => {
      const item = ITEMS[id];
      const equipped = item.slot ? hero.equipped[item.slot] === id : false;
      return <article key={id} className={item.slot || item.heal ? '' : 'titan-item-quest'}>
        <span className={`titan-item-icon ${item.rarity.toLowerCase()}`}>{item.icon}</span>
        <div><strong>{item.name} <small>×{hero.inventory[id]}</small></strong><small>{item.description}</small></div>
        {item.slot ? <button disabled={equipped} onClick={() => realmCommand({ type: 'equip', item: id })}>{equipped ? 'Equipped' : 'Equip'}</button>
          : item.heal ? <button onClick={() => realmCommand({ type: 'potion' })}>Use</button>
          : <small className="titan-item-tag">Quest item</small>}
      </article>;
    })}</div>
    {vendor && <div className="titan-shop">
      <span className="titan-eyebrow">{vendor.name.toUpperCase()}</span>
      {(vendor.sells ?? []).map(id => <article key={id}>
        <span className={`titan-item-icon ${ITEMS[id].rarity.toLowerCase()}`}>{ITEMS[id].icon}</span>
        <div><strong>{ITEMS[id].name}</strong><small>{ITEMS[id].description}</small></div>
        <button disabled={hero.gold < (ITEMS[id].price ?? 0)} onClick={() => realmCommand({ type: 'buy', item: id })}>Buy · {ITEMS[id].price} ◈</button>
      </article>)}
    </div>}
    <p className="titan-bag-note">{solo ? 'Practice inventory is saved on this device.' : 'Items and rewards are validated by the realm server.'}</p>
  </section>;
}

/** The lower third that names a zone as the hero arrives in it. */
export function TitanZoneTitle({ zone }: { zone: ZoneId }) {
  return <div className="titan-zone-title" role="status">
    <strong>{ZONES[zone].name}</strong>
    <small>{ZONES[zone].subtitle}</small>
  </div>;
}

/** The three starting classes, shown as pickable cards on the login screen. */
export function TitanClassPicker({ value, onChange }: { value: ClassId; onChange: (id: ClassId) => void }) {
  return <div className="titan-classes" role="group" aria-label="Choose a class">
    {(Object.keys(CLASSES) as ClassId[]).map(id => <button key={id} type="button" className="titan-class-option"
      aria-pressed={value === id} onClick={() => onChange(id)}>
      <span>{CLASSES[id].icon}</span><strong>{CLASSES[id].name}</strong>
    </button>)}
    <p className="titan-class-description">{CLASSES[value].description}</p>
  </div>;
}
