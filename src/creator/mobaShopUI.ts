import { useEditorStore } from '../store/editorStore';
import type { UIElement } from '../types';
import {
  MOBA_ITEMS,
  MOBA_INVENTORY_CAPACITY,
  mobaItemSellValue,
} from '../project/mobaItems';

/**
 * Appends ordinary editable elements to an existing DOM UI document.
 * Integration: append MOBA_SHOP_CSS to the document CSS and call this once.
 * Runtime owns P -> LLShopToggle, transactions, starting gold and all LL globals.
 * Opening the shop does not pause the match. LLShopMessage is displayed verbatim
 * so purchase success, inventory-full and insufficient-gold replies stay distinct.
 */
export function addMobaShopUI(docId: string, rootId: string): void {
  const s = useEditorStore.getState();
  const active = 'LLPlaying && !LLIntro && !LLDone && !LLPaused';
  const canTrade = `(${active}) && LLAtBase && LLHealth > 0`;
  const el = (
    parent: string,
    kind: 'panel' | 'text' | 'button',
    name: string,
    patch: Partial<UIElement>,
    visible?: string,
  ): string => {
    const id = s.addUIElement(docId, parent, kind);
    s.updateUIElement(docId, id, { name, style: {}, states: {}, ...patch });
    if (visible) s.setUIBinding(docId, id, 'visible', visible);
    return id;
  };
  const text = (parent: string, name: string, content: string, className: string, binding?: string): string => {
    const id = el(parent, 'text', name, { text: content, className });
    if (binding) s.setUIBinding(docId, id, 'text', binding);
    return id;
  };
  const button = (parent: string, name: string, content: string, event: string, className: string, visible?: string): string =>
    el(parent, 'button', name, { text: content, className, onClickEvent: event }, visible);

  const hud = el(rootId, 'panel', 'Gold and four-slot inventory', {
    className: 'll-shop-hud',
  }, `${active} && !LLShopOpen`);
  const wallet = el(hud, 'panel', 'Gold and shop access', { className: 'll-shop-wallet' });
  text(wallet, 'Gold balance', '', 'll-shop-gold', "LLGold + ' gold'");
  button(wallet, 'Open item shop (P)', 'Shop  [P]', 'LLShopToggle', 'll-shop-button ll-shop-access');
  const income = text(hud, 'Earned gold feedback', '', 'll-shop-income', 'LLIncomeMessage');
  s.setUIBinding(docId, income, 'visible', "LLIncomeTime > 0 && LLIncomeMessage != ''");
  const inventory = el(hud, 'panel', 'Inventory slots', { className: 'll-shop-inventory' });
  // Separate background slots and six conditional icons: owned icons pack left
  // automatically, including after sales, without a nested table or slot globals.
  const slots = el(inventory, 'panel', 'Four empty slot outlines', { className: 'll-shop-slots' });
  for (let i = 1; i <= MOBA_INVENTORY_CAPACITY; i++) {
    text(slots, `Slot ${i}`, `${i}`, 'll-shop-slot');
  }
  const owned = el(inventory, 'panel', 'Owned items', { className: 'll-shop-owned' });
  for (const item of MOBA_ITEMS) {
    button(owned, `${item.label} · open shop to sell`, item.label, 'LLShopToggle',
      `ll-shop-inventory-item ll-shop-icon-${item.id}`, `LLOwned${item.id}`);
  }
  text(hud, 'Inventory capacity', '', 'll-shop-capacity',
    `LLInventoryCount + ' / ${MOBA_INVENTORY_CAPACITY} items  ·  one of each'`);

  const overlay = el(rootId, 'panel', 'Item shop overlay', { className: 'll-shop-overlay' }, `${active} && LLShopOpen`);
  const shop = el(overlay, 'panel', 'Astral armory', { className: 'll-shop-modal' });
  const header = el(shop, 'panel', 'Shop heading', { className: 'll-shop-header' });
  const title = el(header, 'panel', 'Shop identity', { className: 'll-shop-heading' });
  text(title, 'Shop eyebrow', 'THE ASTRAL RIFT / ITEM SHOP', 'll-shop-eyebrow');
  text(title, 'Shop title', 'The Astral Armory', 'll-shop-title');
  button(header, 'Close item shop (P)', 'Close  ×', 'LLShopClose', 'll-shop-button ll-shop-close');
  const balance = el(shop, 'panel', 'Shop balance and capacity', { className: 'll-shop-balance' });
  text(balance, 'Available gold', '', 'll-shop-gold ll-shop-gold-large', "LLGold + ' gold'");
  text(balance, 'Carried items', '', 'll-shop-counter',
    `LLInventoryCount + ' / ${MOBA_INVENTORY_CAPACITY} slots occupied'`);
  const shopIncome = text(balance, 'Recent gold earned', '', 'll-shop-income', 'LLIncomeMessage');
  s.setUIBinding(docId, shopIncome, 'visible', "LLIncomeTime > 0 && LLIncomeMessage != ''");
  const location = text(shop, 'Trade availability', '', 'll-shop-location',
    "LLHealth <= 0 ? 'Browse while respawning. Buy and sell once alive at base.' : !LLAtBase ? 'Browse anywhere. Close shop and press B to recall, then buy or sell at base.' : 'At base · Buy and sell here. The match keeps running while you shop.'");
  s.setUIBinding(docId, location, 'color', "LLAtBase && LLHealth > 0 ? '#91d9c3' : '#e5c88a'");
  const message = text(shop, 'Shop transaction message', '', 'll-shop-message', 'LLShopMessage');
  s.setUIBinding(docId, message, 'visible', "LLShopMessage != ''");

  text(shop, 'Gold income rules', '500 starting gold · +2 gold / second · Minions +25 · Heroes / towers +150 · Jungle +100', 'll-shop-footnote');
  text(shop, 'Equipped champion stats', '', 'll-shop-stats',
    "'ATTACK ' + LLTotalDamage + '   /   SPELL ' + LLTotalSpellPower + '   /   ARMOR ' + LLTotalArmor + '   /   SPEED ' + (LLTotalSpeed * 10 - LLTotalSpeed * 10 % 1) / 10");
  const cards = el(shop, 'panel', 'Six available items', { className: 'll-shop-cards' });
  for (const item of MOBA_ITEMS) {
    const isOwned = `LLOwned${item.id}`;
    const full = `LLInventoryCount >= ${MOBA_INVENTORY_CAPACITY}`;
    const card = el(cards, 'panel', item.label, { className: 'll-shop-card' });
    s.setUIBinding(docId, card, 'background', `${isOwned} ? '${item.colors.background}' : '#142930'`);
    const heading = el(card, 'panel', `${item.label} heading`, { className: 'll-shop-item-heading' });
    el(heading, 'panel', `${item.label} icon`, { className: `ll-shop-item-icon ll-shop-icon-${item.id}` });
    const detail = el(heading, 'panel', `${item.label} identity`, { className: 'll-shop-item-identity' });
    text(detail, `${item.label} name`, item.label, 'll-shop-item-name');
    text(detail, `${item.label} price`, `${item.cost} gold`, 'll-shop-price');
    text(card, `${item.label} stats`, item.description, 'll-shop-description');
    const status = text(card, `${item.label} availability`, '', 'll-shop-item-status',
      `${isOwned} ? 'Owned · one per champion' : ${full} ? 'Inventory full · sell an item first' : LLGold < ${item.cost} ? 'Need ' + (${item.cost} - LLGold) + ' more gold' : LLHealth <= 0 ? 'Available after respawn at base' : !LLAtBase ? 'Available to buy at base' : 'Ready to equip'`);
    s.setUIBinding(docId, status, 'color',
      `${isOwned} ? '#91d9c3' : (${full} || LLGold < ${item.cost}) ? '#efb0a6' : '#acbfbb'`);
    const actions = el(card, 'panel', `${item.label} actions`, { className: 'll-shop-item-actions' });
    const buy = button(actions, `Buy ${item.label}`, `Buy · ${item.cost} gold`, `LLBuy${item.id}`, 'll-shop-button ll-shop-buy');
    s.setUIBinding(docId, buy, 'disabled', `!(${canTrade}) || ${isOwned} || ${full} || LLGold < ${item.cost}`);
    s.setUIBinding(docId, buy, 'text', `${isOwned} ? 'Owned' : ${full} ? 'Inventory full' : LLGold < ${item.cost} ? 'Insufficient gold' : 'Buy · ${item.cost} gold'`);
    const sell = button(actions, `Sell ${item.label}`, `Sell · ${mobaItemSellValue(item.cost)} gold`, `LLSell${item.id}`, 'll-shop-button ll-shop-sell', isOwned);
    s.setUIBinding(docId, sell, 'disabled', `!(${canTrade}) || !${isOwned}`);
  }
  text(shop, 'Inventory rules', '4 different items maximum · 1 of each · Sell for 70% of the purchase price, rounded down.', 'll-shop-footnote');
  text(shop, 'Shop controls', 'P opens / closes · Esc closes · Close shop and press B to recall · Match keeps running.', 'll-shop-footnote');
}

export const MOBA_SHOP_CSS = `
.ll-shop-hud,.ll-shop-overlay{font-family:Inter,system-ui,sans-serif;color:#e9dfc5;box-sizing:border-box}
.ll-shop-hud *,.ll-shop-overlay *{box-sizing:border-box}
.ll-shop-hud{position:absolute;left:20px;bottom:20px;width:202px;display:flex;flex-direction:column;gap:9px;padding:12px;background:linear-gradient(135deg,#19363af5,#0d2028f5);border:1px solid #937e4e;border-radius:6px;box-shadow:0 8px 30px #0006;pointer-events:auto;z-index:12}
.ll-shop-wallet{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px}
.ll-shop-gold{color:#f2d184;font-size:21px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.ll-shop-button{pointer-events:auto;border:1px solid #c8aa6a;border-radius:4px;padding:10px 12px;font:750 12px Inter,system-ui,sans-serif;line-height:1.3;background:linear-gradient(#d0b373,#a28347);color:#102129;cursor:pointer;min-height:40px;transition:filter .15s}
.ll-shop-button:hover:not(:disabled),.ll-shop-inventory-item:hover{filter:brightness(1.16)}
.ll-shop-button:focus-visible,.ll-shop-inventory-item:focus-visible{outline:2px solid #fff0b8;outline-offset:3px}
.ll-shop-button:disabled{background:#23363b;color:#99aaa5;border-color:#4b5b57;cursor:default;opacity:.8}
.ll-shop-access{padding:8px;font-size:11px;white-space:nowrap}
.ll-shop-income{color:#97e5b5;font-size:11px;line-height:1.4;white-space:normal;overflow-wrap:anywhere}
.ll-shop-inventory{position:relative;height:38px}
.ll-shop-slots,.ll-shop-owned{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;position:absolute;inset:0}
.ll-shop-slot{display:flex;align-items:center;justify-content:center;border:1px solid #52645c;border-radius:4px;background:#091b22;color:#60746d;font-size:10px}
.ll-shop-inventory-item{width:100%;height:38px;min-width:0;padding:0;border:1px solid #bcac7b;border-radius:4px;background-color:#15343b;background-size:contain;background-position:center;background-repeat:no-repeat;font-size:0;cursor:pointer;pointer-events:auto}
.ll-shop-capacity{font-size:9px;color:#b0c3bb;letter-spacing:.4px}
.ll-shop-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:16px;background:#051016b8;pointer-events:auto}
.ll-shop-modal{display:flex;flex-direction:column;gap:9px;width:920px;max-width:100%;max-height:100%;min-height:0;padding:20px;overflow:auto;overscroll-behavior:contain;background:linear-gradient(145deg,#19343dfc,#0b1b23fc);border:1px solid #b19862;border-radius:9px;box-shadow:0 24px 100px #000b;text-align:left}
.ll-shop-modal>*{flex-shrink:0}
.ll-shop-header{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
.ll-shop-heading{display:flex;flex-direction:column;gap:5px;min-width:0}
.ll-shop-eyebrow{font-size:9px;font-weight:800;letter-spacing:2px;color:#bcad85;white-space:normal}
.ll-shop-title{font:32px/1.1 Georgia,serif;color:#f0e3be;white-space:normal}
.ll-shop-close{flex-shrink:0;background:#213b42;color:#eddfb8;min-width:80px;min-height:44px}
.ll-shop-balance{display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px 22px;padding:8px 13px;background:#0c2029;border:1px solid #4e655c;border-radius:5px}
.ll-shop-gold-large{font-size:29px}
.ll-shop-counter{font-size:12px;color:#c3d0c8}
.ll-shop-location{font-size:12px;line-height:1.5;white-space:normal}
.ll-shop-message{padding:8px 11px;border-left:3px solid #e6c276;background:#493d242e;color:#ffe1a1;font-size:13px;font-weight:700;white-space:normal;overflow-wrap:anywhere}
.ll-shop-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.ll-shop-card{display:flex;flex-direction:column;gap:7px;min-width:0;padding:11px;border:1px solid #49605a;border-radius:6px}
.ll-shop-item-heading{display:flex;flex-direction:row;align-items:center;gap:10px}
.ll-shop-item-icon{width:48px;height:48px;flex-shrink:0;background-size:contain;background-position:center;background-repeat:no-repeat;border:1px solid #617269;border-radius:8px}
.ll-shop-item-identity{display:flex;flex-direction:column;gap:4px;min-width:0}
.ll-shop-item-name{font-size:14px;font-weight:750;line-height:1.3;color:#f0e4c7;white-space:normal}
.ll-shop-price{font-size:12px;font-weight:750;color:#e5c47d}
.ll-shop-description{font-size:12px;line-height:1.5;color:#c5d4ce;white-space:pre-line;min-height:32px}
.ll-shop-item-status{margin-top:auto;font-size:10px;line-height:1.5;white-space:normal}
.ll-shop-item-actions{display:flex;flex-direction:row;gap:7px}.ll-shop-buy,.ll-shop-sell{flex:1;min-width:0;padding:8px 6px;font-size:11px}
.ll-shop-sell{background:#183c3c;border-color:#648d78;color:#bee3c9}
.ll-shop-stats{font-size:10px;font-weight:750;letter-spacing:.7px;line-height:1.5;color:#d8c08a;white-space:normal}
.ll-shop-footnote{font-size:10px;line-height:1.5;color:#a9bcb4;white-space:normal}
${MOBA_ITEMS.map((item) => `.ll-shop-icon-${item.id}{background-image:url("${item.icon}")}`).join('\n')}
@media(max-width:1100px){.ll-shop-hud{left:12px;bottom:215px;width:190px}}
@media(max-width:700px){.ll-shop-overlay{padding:10px}.ll-shop-modal{padding:16px;gap:11px}.ll-shop-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ll-shop-title{font-size:27px}.ll-shop-card{padding:11px}.ll-shop-item-heading{gap:7px}.ll-shop-item-icon{width:38px;height:38px}.ll-shop-item-name{font-size:12px}.ll-shop-button{min-height:44px}}
@media(max-width:600px){.ll-shop-hud{left:8px;bottom:200px;width:176px;gap:6px;padding:9px}.ll-shop-gold{font-size:20px}.ll-shop-gold-large{font-size:26px}.ll-shop-capacity{font-size:8px}.ll-shop-slots,.ll-shop-owned{gap:4px}.ll-shop-title{font-size:24px}.ll-shop-eyebrow{font-size:8px;letter-spacing:1px}.ll-shop-balance{padding:10px;gap:7px 14px}.ll-shop-counter{font-size:11px}.ll-shop-description{font-size:11px}.ll-shop-close{min-width:70px;padding:9px}.ll-shop-item-heading{flex-wrap:wrap}}
@media(max-width:360px){.ll-shop-cards{grid-template-columns:minmax(0,1fr)}.ll-shop-item-heading{flex-wrap:nowrap}.ll-shop-title{font-size:21px}}
@media(max-height:500px) and (min-width:601px){.ll-shop-hud{bottom:175px;gap:5px;padding:8px;width:184px}.ll-shop-capacity{display:none}.ll-shop-modal{padding:14px}}
`;
