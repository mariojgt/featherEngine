import { MOBA_HEROES } from './mobaHeroes';
import { MOBA_ECONOMY_SOURCE, MOBA_ECONOMY_RESET, MOBA_ECONOMY_STATS } from './mobaEconomy';
/** Ordinary FeatherScript: selection, orders, combat and lane routes stay editable in the engine. */
export const MOBA_UNIT_SOURCE = `blueprint Lumen_Rift_Unit
var tags: string = "lumen-unit"
var team: number = 1
var kind: number = 0
var lane: number = 1
var controlled: boolean = false
var hp: number = 120
var max_hp: number = 120
var incoming: number = 0
var damage: number = 18
var armor: number = 0
var bounty: number = 25
var reach: number = 2
var pace: number = 4.5
var cadence: number = 1
var home: vector3 = vec3(28,0,28)
var guardian: string = ""
var guardian_top: string = ""
var guardian_bot: string = ""
var exposed: boolean = true
var rig: string = ""
var arm: string = ""
var offarm: string = ""
var leg: string = ""
var leg2: string = ""
var bar: string = ""
var backing: string = ""
var effect: string = ""
var bolt: string = ""
var bolt_time: number = 0
var bolt_from: vector3 = vec3(0,0,0)
var bolt_to: vector3 = vec3(0,0,0)
var target: string = ""
var nearest: number = 100
var score: number = 100
var cooldown: number = 0
var respawn: number = 0
var flash: number = 0
var swing: number = 0
var clock: number = 0
var moving: boolean = false
var direction: vector3 = vec3(-1,0,-1)
var destination: vector3 = vec3(0,0,0)
var slot: number = 0
var way: number = 0
var nav0: vector3 = vec3(28,0,28)
var nav1: vector3 = vec3(20,0,20)
var nav2: vector3 = vec3(10,0,10)
var nav3: vector3 = vec3(-10,0,-10)
var nav4: vector3 = vec3(-20,0,-20)
var nav5: vector3 = vec3(-28,0,-28)
var retreating: boolean = false
var credited: boolean = false
on event LLResetUnit(payload):
    self.hp = self.max_hp
    self.incoming = 0
    if self.kind == 0:
        self.hp = 0
    self.exposed = self.kind != 3
    self.cooldown = 0
    self.respawn = 0
    self.flash = 0
    self.swing = 0
    self.clock = 0
    self.way = 0
    self.bolt_time = 0
    self.retreating = false
    self.credited = false
    self.target = ""
    self.moving = false
    set_position(self, self.home)
    set_rotation(self, vec3(0,0,0))
    set_rotation(self.rig, vec3(0,0,0))
    set_rotation(self.arm, vec3(0,0,0))
    set_rotation(self.bar, vec3(0,0,0))
    set_rotation(self.backing, vec3(0,0,0))
    set_rotation(self.leg, vec3(0,0,0))
    set_rotation(self.leg2, vec3(0,0,0))
    set_scale(self.effect, vec3(0,0,0))
    set_scale(self.bolt, vec3(0,0,0))
    if self.hp > 0:
        set_scale(self, vec3(1,1,1))
    else:
        set_scale(self, vec3(0,0,0))
on event LLWave(payload):
    if self.kind == 0 and self.hp <= 0 and self.slot == Game.LLWaveBank:
        self.hp = self.max_hp
        self.incoming = 0
        self.cooldown = 0.4
        self.way = 0
        self.target = ""
        self.flash = 0
        self.swing = 0
        self.credited = false
        set_position(self, self.home)
        set_scale(self, vec3(1,1,1))
on event LLStrike(payload):
    if Game.LLPlaying and Game.LLPaused == false and self.hp > 0 and self.cooldown <= 0:
        self.target = ""
        self.nearest = self.reach + 0.001
        for actor in find_actors(tag: "lumen-unit"):
            if get_var(actor,"team") != self.team and get_var(actor,"hp") > 0 and get_var(actor,"exposed") == true:
                self.score = distance(position(self),position(actor))
                if self.score < self.nearest:
                    self.nearest = self.score
                    self.target = actor
        if self.target != "":
            fire_event("LLHit",target:self)
on event LLHit(payload):
    if self.target != "" and self.cooldown <= 0 and self.hp > 0:
        if get_var(self.target,"hp") > 0 and get_var(self.target,"exposed") == true:
            if distance(position(self),position(self.target)) <= self.reach + 0.2:
                self.cooldown = self.cadence
                self.swing = 0.24
                look_at(self,position(self.target))
                set_var(self.target,"incoming",get_var(self.target,"incoming") + max(0,self.damage - get_var(self.target,"armor")))
                if self.controlled:
                    set_var(self.target,"credited",true)
                if self.reach > 4:
                    self.bolt_time = 0.24
                    self.bolt_from = vec_add(position(self),vec3(0,1.8,0))
                    self.bolt_to = vec_add(position(self.target),vec3(0,1.2,0))
on timer(0.35):
    if Game.LLPlaying and Game.LLPaused == false and self.hp > 0 and self.controlled == false and self.kind != 3:
        self.target = ""
        self.nearest = 100
        for actor in find_actors(tag:"lumen-unit"):
            if get_var(actor,"team") != self.team and get_var(actor,"hp") > 0 and get_var(actor,"exposed") == true:
                self.score = distance(position(self),position(actor))
                if self.score <= 10:
                    if self.kind == 2 or self.kind == 4:
                        if self.score > self.reach:
                            self.score = 100
                        else:
                            if get_var(actor,"kind") == 0:
                                self.score = self.score - 20
                    if self.score < self.nearest:
                        self.nearest = self.score
                        self.target = actor
on update(dt):
    if Game.LLPlaying and Game.LLPaused == false:
        if self.kind == 3:
            self.exposed = get_var(self.guardian,"hp") <= 0 or get_var(self.guardian_top,"hp") <= 0 or get_var(self.guardian_bot,"hp") <= 0
        if self.incoming > 0 and self.hp > 0:
            if self.exposed:
                self.hp = max(0,self.hp - self.incoming)
                self.flash = 0.18
                if self.hp <= 0:
                    self.target = ""
                    self.respawn = 8
                    if self.kind == 4:
                        self.respawn = 30
                    if self.credited:
                        self.bounty = 25
                        Game.LLIncomeMessage = "+25 gold · Minion"
                        if self.kind == 1:
                            self.bounty = 150
                            Game.LLKills = Game.LLKills + 1
                            Game.LLIncomeMessage = "+150 gold · Hero takedown"
                        if self.kind == 2:
                            self.bounty = 150
                            Game.LLIncomeMessage = "+150 gold · Tower destroyed"
                        if self.kind == 4:
                            self.bounty = 100
                            Game.LLIncomeMessage = "+100 gold · Jungle sentinel"
                        Game.LLGold = Game.LLGold + self.bounty
                        Game.LLIncomeTime = 3
                    set_scale(self,vec3(0,0,0))
        self.incoming = 0
        self.clock = self.clock + dt
        self.cooldown = max(0,self.cooldown - dt)
        self.flash = max(0,self.flash - dt)
        self.swing = max(0,self.swing - dt)
        self.bolt_time = max(0,self.bolt_time - dt)
        self.moving = false
        if self.bolt_time > 0:
            set_scale(self.bolt,vec3(0.45,0.45,0.45))
            set_position(self.bolt,vec_add(self.bolt_from,vec_scale(vec_sub(self.bolt_to,self.bolt_from),1 - self.bolt_time / 0.24)))
        else:
            set_scale(self.bolt,vec3(0,0,0))
        if self.hp <= 0:
            set_scale(self,vec3(0,0,0))
            if self.kind == 1 or self.kind == 4:
                self.respawn = max(0,self.respawn - dt)
                if self.respawn <= 0:
                    self.hp = self.max_hp
                    self.cooldown = 0.5
                    self.way = 0
                    self.target = ""
                    self.credited = false
                    set_position(self,self.home)
                    set_scale(self,vec3(1,1,1))
        else:
            if self.kind == 1 and distance(position(self),self.home) < 4:
                self.hp = min(self.max_hp,self.hp + dt * 55)
            if self.controlled == false and self.kind != 3:
                if self.kind == 1:
                    if self.hp < self.max_hp * 0.22:
                        self.retreating = true
                        self.way = 0
                    if self.hp >= self.max_hp * 0.94:
                        self.retreating = false
                if self.retreating:
                    self.moving = distance(position(self),self.home) > 1.3
                    self.move_to(self.home,speed:self.pace)
                else:
                    if self.target != "" and get_var(self.target,"hp") > 0:
                        if distance(position(self),position(self.target)) <= self.reach:
                            if self.cooldown <= 0:
                                fire_event("LLHit",target:self)
                        else:
                            if self.kind < 2:
                                self.moving = true
                                self.move_to(position(self.target),speed:self.pace)
                    else:
                        if self.kind < 2:
                            self.destination = self.nav5
                            if self.way == 0:
                                self.destination = self.nav0
                            if self.way == 1:
                                self.destination = self.nav1
                            if self.way == 2:
                                self.destination = self.nav2
                            if self.way == 3:
                                self.destination = self.nav3
                            if self.way == 4:
                                self.destination = self.nav4
                            if distance(position(self),self.destination) < 2.3 and self.way < 5:
                                self.way = self.way + 1
                            self.moving = distance(position(self),self.destination) > 1.3
                            self.move_to(self.destination,speed:self.pace)
            set_scale(self.bar,vec3(max(0.001,self.hp / self.max_hp),1,1))
            set_rotation(self.bar,vec3(0,0 - dot(rotation(self),vec3(0,1,0)),0))
            set_rotation(self.backing,vec3(0,0 - dot(rotation(self),vec3(0,1,0)),0))
            set_rotation(self.rig,vec3(0,0,self.flash * 45))
            if self.kind < 2:
                set_position(self.rig,vec3(0,0.38 + sin(self.clock * 200) * 0.035,0))
                set_rotation(self.arm,vec3(sin(self.clock * 160) * 5 - self.swing * 430,0,0))
                if self.moving:
                    set_rotation(self.leg,vec3(sin(self.clock * 720) * 32,0,0))
                    set_rotation(self.leg2,vec3(sin(self.clock * 720) * -32,0,0))
                else:
                    set_rotation(self.leg,vec3(0,0,0))
                    set_rotation(self.leg2,vec3(0,0,0))
            set_scale(self.effect,vec3(self.swing * 5,self.swing * 5,self.swing * 5))
`;
const heroRefs=MOBA_HEROES.map(h=>['rig','arm','offarm','leg','leg2'].map(key=>`var hero${h.id}_${key}: string = ""`).join('\n')).join('\n');
const resetStats=MOBA_HEROES.map(h=>`    if Game.LLHeroChoice == ${h.id}:
        self.max_hp = ${h.hp}
        self.hp = ${h.hp}
        self.damage = ${h.damage}
        self.reach = ${h.reach}
        self.pace = ${h.pace}
        self.cadence = ${h.cadence}`).join('\n');
const choose=MOBA_HEROES.map(h=>`on event LLHero${h.id}(payload):
    if Game.LLIntro:
        Game.LLHeroChoice = ${h.id}
        Game.LLHeroName = "${h.name}"
        Game.LLHeroRole = "${h.role}"
        Game.LLQName = "${h.q}"
        Game.LLRName = "${h.r}"
        self.max_hp = ${h.hp}
        self.hp = ${h.hp}
        self.damage = ${h.damage}
        self.reach = ${h.reach}
        self.pace = ${h.pace}
        self.cadence = ${h.cadence}
${MOBA_HEROES.map(option=>`        set_scale(self.hero${option.id}_rig,vec3(${option.id===h.id?'1,1,1':'0,0,0'}))`).join('\n')}
${['rig','arm','offarm','leg','leg2'].map(key=>`        self.${key} = self.hero${h.id}_${key}`).join('\n')}
        Game.LLHealth = self.hp
        Game.LLMaxHealth = self.max_hp
`).join('\n');
export const MOBA_HERO_SOURCE = `
${heroRefs}
${MOBA_ECONOMY_SOURCE}
var pulse: number = 0
var dash: number = 0
var ultimate: number = 0
var dash_time: number = 0
var recall: number = 0
var ordered: boolean = false
var attack_order: string = ""
var marker: string = ""
var marker_time: number = 0
var pulse_fx: string = ""
var pulse_time: number = 0
var pulse_radius: number = 4
var pulse_damage: number = 70
var pulse_heal: number = 0
var pulse_location: vector3 = vec3(0,0,0)
var aim_point: vector3 = vec3(0,0,0)
${choose}
on event LLResetUnit(payload):
${resetStats}
    self.spell_power = 0
    self.armor = 0
    self.attack_speed = 0
    self.pulse = 0
    self.dash = 0
    self.ultimate = 0
    self.dash_time = 0
    self.recall = 0
    self.ordered = false
    self.attack_order = ""
    self.direction = normalize(vec3(-1,0,-1))
    self.marker_time = 0
    self.pulse_time = 0
    self.destination = self.home
    set_scale(self.marker,vec3(0,0,0))
    set_scale(self.pulse_fx,vec3(0,0,0))
on event LLMove(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0:
        self.destination = payload
        self.aim_point = payload
        self.ordered = true
        self.attack_order = ""
        self.recall = 0
        self.marker_time = 0.7
        set_position(self.marker,self.destination)
on event LLTarget(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0:
        if get_var(payload,"team") != self.team and get_var(payload,"hp") > 0:
            self.attack_order = payload
            self.aim_point = position(payload)
            self.ordered = true
            self.recall = 0
on key_pressed("KeyS"):
    self.ordered = false
    self.attack_order = ""
    self.recall = 0
on update(dt):
    if Game.LLPlaying and Game.LLPaused == false:
        self.pulse = max(0,self.pulse - dt)
        self.dash = max(0,self.dash - dt)
        self.ultimate = max(0,self.ultimate - dt)
        self.dash_time = max(0,self.dash_time - dt)
        self.marker_time = max(0,self.marker_time - dt)
        self.pulse_time = max(0,self.pulse_time - dt)
        set_scale(self.marker,vec3(self.marker_time * 1.5,1,self.marker_time * 1.5))
        if self.marker_time <= 0:
            set_scale(self.marker,vec3(0,0,0))
        set_scale(self.pulse_fx,vec3(self.pulse_time * self.pulse_radius * 2,1,self.pulse_time * self.pulse_radius * 2))
        if self.pulse_time <= 0:
            set_scale(self.pulse_fx,vec3(0,0,0))
        if self.hp <= 0:
            self.ordered = false
            self.attack_order = ""
            self.recall = 0
        else:
            if self.flash > 0:
                self.recall = 0
            if self.recall > 0:
                self.recall = max(0,self.recall - dt)
                if self.recall <= 0:
                    set_position(self,self.home)
                    self.hp = min(self.max_hp,self.hp + 100)
            if self.attack_order != "":
                if get_var(self.attack_order,"hp") <= 0:
                    self.attack_order = ""
                    self.ordered = false
                else:
                    self.destination = position(self.attack_order)
                    if distance(position(self),self.destination) <= self.reach:
                        self.ordered = false
                        self.target = self.attack_order
                        if self.cooldown <= 0:
                            fire_event("LLHit",target:self)
                    else:
                        self.ordered = true
            if self.ordered:
                self.direction = normalize(vec_sub(self.destination,position(self)))
                self.moving = true
                self.move_to(self.destination,speed:self.pace)
                if distance(position(self),self.destination) < 1.4:
                    self.ordered = false
            if self.dash_time > 0:
                self.move_to(vec_add(position(self),vec_scale(self.direction,4)),speed:20)
                self.moving = true
            if self.moving:
                set_rotation(self.leg,vec3(sin(self.clock * 720) * 35,0,0))
                set_rotation(self.leg2,vec3(sin(self.clock * 720) * -35,0,0))
                set_rotation(self.offarm,vec3(sin(self.clock * 720) * -18,0,0))
            else:
                set_rotation(self.offarm,vec3(sin(self.clock * 180) * 4,0,0))
            set_position(self,vec3(clamp(dot(position(self),vec3(1,0,0)),-35,35),0,clamp(dot(position(self),vec3(0,0,1)),-35,35)))
${MOBA_ECONOMY_STATS}
        Game.LLHealth = floor(self.hp + 0.999)
        Game.LLMaxHealth = self.max_hp
        Game.LLAtBase = distance(position(self),self.home) < 5
        Game.LLRespawn = floor(self.respawn + 0.999)
        Game.LLAttack = floor(self.cooldown * 10 + 0.999) / 10
        Game.LLPulse = floor(self.pulse * 10 + 0.999) / 10
        Game.LLDash = floor(self.dash * 10 + 0.999) / 10
        Game.LLUltimate = floor(self.ultimate * 10 + 0.999) / 10
        Game.LLRecall = floor(self.recall * 10 + 0.999) / 10
on key_down("Space"):
    fire_event("LLAttack")
on event LLAttack(payload):
    if Game.LLShopOpen == false:
        fire_event("LLStrike",target:self)
on key_pressed("KeyQ"):
    fire_event("LLPulse")
on event LLPulse(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0 and self.pulse <= 0:
        self.pulse = 6
        self.recall = 0
        self.pulse_damage = 70
        self.pulse_heal = 0
        self.pulse_radius = 4.5
        self.pulse_location = position(self)
        if Game.LLHeroChoice == 1:
            self.hp = min(self.max_hp,self.hp + 70 + self.spell_power)
        if Game.LLHeroChoice == 2:
            self.pulse = 4
            self.pulse_damage = 115
        if Game.LLHeroChoice == 3 or Game.LLHeroChoice == 4:
            self.pulse_damage = 100
            self.pulse_location = vec_add(position(self),vec_scale(normalize(vec_sub(self.aim_point,position(self))),min(12,distance(position(self),self.aim_point))))
        if Game.LLHeroChoice == 5:
            self.pulse_damage = 35
            self.pulse_heal = 95
            self.pulse_radius = 6
        fire_event("LLCast",target:self)
on key_pressed("KeyR"):
    fire_event("LLUltimate")
on event LLUltimate(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0 and self.ultimate <= 0:
        self.ultimate = 25
        self.recall = 0
        self.pulse_damage = 180
        self.pulse_radius = 7
        self.pulse_heal = 0
        self.pulse_location = position(self)
        if Game.LLHeroChoice == 1:
            self.hp = min(self.max_hp,self.hp + 200 + self.spell_power)
            self.pulse_damage = 110
        if Game.LLHeroChoice == 3 or Game.LLHeroChoice == 4:
            self.pulse_location = vec_add(position(self),vec_scale(normalize(vec_sub(self.aim_point,position(self))),min(12,distance(position(self),self.aim_point))))
        if Game.LLHeroChoice == 5:
            self.pulse_heal = 220
            self.pulse_damage = 70
        fire_event("LLCast",target:self)
on event LLCast(payload):
    self.pulse_damage = self.pulse_damage + self.spell_power
    if self.pulse_heal > 0:
        self.pulse_heal = self.pulse_heal + self.spell_power
    self.swing = 0.4
    self.pulse_time = 0.5
    set_position(self.pulse_fx,self.pulse_location)
    for actor in find_actors(tag:"lumen-unit"):
        if get_var(actor,"hp") > 0 and distance(position(actor),self.pulse_location) <= self.pulse_radius:
            if get_var(actor,"team") != self.team:
                set_var(actor,"incoming",get_var(actor,"incoming") + self.pulse_damage)
                set_var(actor,"credited",true)
            else:
                if get_var(actor,"kind") < 2:
                    set_var(actor,"hp",min(get_var(actor,"max_hp"),get_var(actor,"hp") + self.pulse_heal))
on key_pressed("KeyE"):
    fire_event("LLDash")
on event LLDash(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0 and self.dash <= 0:
        self.dash = 5
        self.dash_time = 0.2
        self.recall = 0
on key_pressed("KeyB"):
    fire_event("LLRecall")
on event LLRecall(payload):
    if Game.LLPlaying and Game.LLPaused == false and Game.LLShopOpen == false and self.hp > 0:
        self.recall = 3
        self.ordered = false
        self.attack_order = ""
`;
export const MOBA_MATCH_SOURCE = `blueprint Lumen_Rift_Match
var resetting: number = 0
var income_clock: number = 0
var mint_tower: string = ""
var coral_tower: string = ""
var mint_core: string = ""
var coral_core: string = ""
on start:
    Game.LLShopOpen = false
    Game.LLIntro = true
    Game.LLPlaying = false
    Game.LLPaused = false
    Game.LLDone = false
    for actor in find_actors(tag:"lumen-unit"):
        fire_event("LLResetUnit",target:actor)
on key_pressed("Enter"):
    if Game.LLIntro or Game.LLDone:
        fire_event("LLStart")
on event LLChooseAgain(payload):
    Time.scale = 1
    Game.LLShopOpen = false
    Game.LLIntro = true
    Game.LLPlaying = false
    Game.LLPaused = false
    Game.LLDone = false
on event LLStart(payload):
    Time.scale = 1
    self.resetting = 3
    Game.LLIntro = false
    Game.LLPlaying = false
    Game.LLPaused = false
    Game.LLDone = false
    Game.LLWon = false
    Game.LLSeconds = 0
    Game.LLWaveIn = 3
    Game.LLWaveBank = 1
    Game.LLWaves = 0
    Game.LLAttack = 0
    Game.LLPulse = 0
    Game.LLDash = 0
    Game.LLUltimate = 0
    Game.LLRecall = 0
    Game.LLKills = 0
${MOBA_ECONOMY_RESET}
    for actor in find_actors(tag:"lumen-unit"):
        fire_event("LLResetUnit",target:actor)
on key_pressed("Escape"):
    if Game.LLShopOpen:
        Game.LLShopOpen = false
    else:
        fire_event("LLPause")
on event LLPause(payload):
    if Game.LLPlaying:
        if Game.LLPaused:
            Game.LLPaused = false
            Time.scale = 1
        else:
            Game.LLShopOpen = false
            Game.LLPaused = true
            Time.scale = 0
on update(dt):
    if self.resetting > 0:
        self.resetting = self.resetting - 1
        if self.resetting <= 0:
            Game.LLPlaying = true
    if Game.LLPlaying and Game.LLPaused == false:
        self.income_clock = self.income_clock + dt
        if self.income_clock >= 1:
            Game.LLGold = Game.LLGold + floor(self.income_clock) * 2
            self.income_clock = self.income_clock - floor(self.income_clock)
        Game.LLIncomeTime = max(0,Game.LLIncomeTime - dt)
        Game.LLSeconds = Game.LLSeconds + dt
        Game.LLWaveIn = Game.LLWaveIn - dt
        if Game.LLWaveIn <= 0:
            Game.LLWaveIn = 18
            Game.LLWaveBank = 1 - Game.LLWaveBank
            Game.LLWaves = Game.LLWaves + 1
            for actor in find_actors(tag:"lumen-unit"):
                fire_event("LLWave",target:actor)
        Game.LLMintTower = 0
        Game.LLCoralTower = 0
        for actor in find_actors(tag:"lumen-unit"):
            if get_var(actor,"kind") == 2 and get_var(actor,"hp") > 0:
                if get_var(actor,"team") == 1:
                    Game.LLMintTower = Game.LLMintTower + 1
                else:
                    Game.LLCoralTower = Game.LLCoralTower + 1
        Game.LLMintCore = floor(get_var(self.mint_core,"hp") + 0.999)
        Game.LLCoralCore = floor(get_var(self.coral_core,"hp") + 0.999)
        if Game.LLCoralCore <= 0 or Game.LLMintCore <= 0:
            Game.LLWon = Game.LLCoralCore <= 0 and Game.LLMintCore > 0
            Game.LLShopOpen = false
            Game.LLDone = true
            Game.LLPlaying = false
`;
