import type { CSSProperties } from 'react';
import { ARMOR_COLORS, TRIM_COLORS, HEADPIECES, type Appearance } from '../../examples/titan-mmo/server/appearance.mjs';

export function CharacterCreator({ value, onChange }: { value: Appearance; onChange: (appearance: Appearance) => void }) {
  return <fieldset className="titan-creator">
    <legend>Your look</legend>
    <div className="titan-creator-row">
      <div className="titan-portrait" style={{ '--armor': ARMOR_COLORS[value.armor], '--trim': TRIM_COLORS[value.trim] } as CSSProperties} aria-label={`${value.armor} armor, ${value.trim} trim, ${value.headpiece} headpiece`}>
        <i className={`titan-portrait-head ${value.headpiece}`} /><i className="titan-portrait-body" /><i className="titan-portrait-legs" />
      </div>
      <div className="titan-creator-options">
        <div role="group" aria-label="Armor color"><span>Armor</span>{Object.entries(ARMOR_COLORS).map(([id, color]) => <button key={id} type="button" className="titan-swatch" style={{ background: color }} title={id} aria-label={`${id} armor`} aria-pressed={value.armor === id} onClick={() => onChange({ ...value, armor: id as Appearance['armor'] })} />)}</div>
        <div role="group" aria-label="Trim color"><span>Trim</span>{Object.entries(TRIM_COLORS).map(([id, color]) => <button key={id} type="button" className="titan-swatch" style={{ background: color }} title={id} aria-label={`${id} trim`} aria-pressed={value.trim === id} onClick={() => onChange({ ...value, trim: id as Appearance['trim'] })} />)}</div>
        <div className="titan-headpieces" role="group" aria-label="Headpiece">{HEADPIECES.map(id => <button key={id} type="button" aria-label={`${id} headpiece`} aria-pressed={value.headpiece === id} onClick={() => onChange({ ...value, headpiece: id })}>{id === 'none' ? 'Uncovered' : id === 'crest' ? 'Crest' : 'Crown'}</button>)}</div>
      </div>
    </div>
    <small>These choices apply to a new character. Returning characters keep their saved look and class.</small>
  </fieldset>;
}
