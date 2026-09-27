import { MOBA_HEROES } from './mobaHeroes';
import { MOBA_ITEMS, MOBA_INVENTORY_CAPACITY, MOBA_STARTING_GOLD, mobaItemSellValue } from './mobaItems';

/** Generated from the same item data as the shop; remains readable, editable FeatherScript. */
export const MOBA_ECONOMY_GLOBALS: Record<string, number | boolean | string> = {
  LLGold: MOBA_STARTING_GOLD,
  LLShopOpen: false,
  LLInventoryCount: 0,
  LLShopMessage: 'Start with 500 gold. Equip an item before heading into a lane.',
  LLIncomeMessage: '',
  LLIncomeTime: 0,
  LLTotalDamage: MOBA_HEROES[0].damage,
  LLTotalSpellPower: 0,
  LLTotalArmor: 0,
  LLTotalSpeed: MOBA_HEROES[0].pace,
  LLTotalCadence: MOBA_HEROES[0].cadence,
  ...Object.fromEntries(MOBA_ITEMS.map(item => [`LLOwned${item.id}`, false])),
};
export const MOBA_ECONOMY_RESET = `    Game.LLGold = ${MOBA_STARTING_GOLD}
    Game.LLShopOpen = false
    Game.LLInventoryCount = 0
    Game.LLShopMessage = "Start with 500 gold. Equip an item before heading into a lane."
    Game.LLIncomeMessage = ""
    Game.LLIncomeTime = 0
    self.income_clock = 0
${MOBA_ITEMS.map(item => `    Game.LLOwned${item.id} = false`).join('\n')}`;
export const MOBA_ECONOMY_STATS = `        Game.LLTotalDamage = self.damage
        Game.LLTotalSpellPower = self.spell_power
        Game.LLTotalArmor = self.armor
        Game.LLTotalSpeed = self.pace
        Game.LLTotalCadence = self.cadence`;
export const MOBA_ECONOMY_SOURCE = `
var spell_power: number = 0
var attack_speed: number = 0
var old_max_hp: number = 0
on key_pressed("KeyP"):
    fire_event("LLShopToggle")
on event LLShopToggle(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLDone == false:
        if Game.LLShopOpen:
            Game.LLShopOpen = false
        else:
            Game.LLShopOpen = true
            self.ordered = false
            self.attack_order = ""
            self.recall = 0
            self.dash_time = 0
            self.marker_time = 0
on event LLShopClose(payload):
    Game.LLShopOpen = false
on event LLRebuildItems(payload):
    self.old_max_hp = self.max_hp
${MOBA_HEROES.map(h => `    if Game.LLHeroChoice == ${h.id}:
        self.max_hp = ${h.hp}
        self.damage = ${h.damage}
        self.pace = ${h.pace}
        self.cadence = ${h.cadence}`).join('\n')}
    self.spell_power = 0
    self.armor = 0
    self.attack_speed = 0
${MOBA_ITEMS.map(item => `    if Game.LLOwned${item.id}:
${Object.entries(item.bonuses).map(([key, bonus]) => `        self.${key} = self.${key} + ${bonus}`).join('\n')}`).join('\n')}
    self.cadence = self.cadence / (1 + self.attack_speed)
    self.hp = min(self.max_hp,self.hp + max(0,self.max_hp - self.old_max_hp))
${MOBA_ITEMS.map(item => `on event LLBuy${item.id}(payload):
    if Game.LLPlaying and Game.LLPaused == false:
        if self.hp <= 0 or distance(position(self),self.home) >= 5:
            Game.LLShopMessage = "Return to base alive to buy or sell. Close the shop and press B to recall."
        else:
            if Game.LLOwned${item.id}:
                Game.LLShopMessage = "You already own ${item.label}. Each item can be bought once."
            else:
                if Game.LLInventoryCount >= ${MOBA_INVENTORY_CAPACITY}:
                    Game.LLShopMessage = "Inventory full. Sell an item to free a slot."
                else:
                    if Game.LLGold < ${item.cost}:
                        Game.LLShopMessage = "Not enough gold for ${item.label}. Earn gold in the lanes or jungle."
                    else:
                        Game.LLGold = Game.LLGold - ${item.cost}
                        Game.LLOwned${item.id} = true
                        Game.LLInventoryCount = Game.LLInventoryCount + 1
                        Game.LLShopMessage = "Equipped ${item.label}. Your stats have increased."
                        fire_event("LLRebuildItems",target:self)
on event LLSell${item.id}(payload):
    if Game.LLPlaying and Game.LLPaused == false:
        if self.hp <= 0 or distance(position(self),self.home) >= 5:
            Game.LLShopMessage = "Return to base alive to buy or sell. Close the shop and press B to recall."
        else:
            if Game.LLOwned${item.id}:
                Game.LLOwned${item.id} = false
                Game.LLInventoryCount = Game.LLInventoryCount - 1
                Game.LLGold = Game.LLGold + ${mobaItemSellValue(item.cost)}
                Game.LLShopMessage = "Sold ${item.label} for ${mobaItemSellValue(item.cost)} gold."
                fire_event("LLRebuildItems",target:self)`).join('\n')}
`;
