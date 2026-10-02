import{u as q,s as Fe}from"./player-dqmRFcaI.js";async function Ee(){const o=q.getState(),T=o.activeSceneId;for(const e of["obj-player","obj-ground","obj-enemy","obj-light","obj-camera"])Fe(q.getState()).some(t=>t.id===e)&&o.deleteObject(e);o.renameScene(T,"Cube RPG — The Skyward Trials"),o.applyRenderPreset(T,"stylized-nature"),o.updateSceneEnvironment(T,{skyMode:"procedural",backgroundColor:"#94D7EE",skyTopColor:"#5EBEE8",skyHorizonColor:"#D1EEE8",skyGroundColor:"#B4DCE6",sunColor:"#FFE7B5",sunIntensity:1.5,sunAzimuth:135,sunElevation:48,environmentIntensity:1.1,fogEnabled:!0,fogColor:"#C6E6EE",atmosphericFog:!0,fogNear:50,fogFar:145,aerialFogEnabled:!0,aerialFogHeightFalloff:.018,aerialFogInscatter:.1,aerialFogSunColor:"#FFF0CE",skyLighting:"studio",wind:[1.2,0,.4],windTurbulence:.2,dayCycleEnabled:!1,toneMapping:"agx",toneMappingExposure:1.18,ambientMode:"hemisphere",ambientIntensity:.95,contactShadows:!0,contactShadowY:.1,contactShadowScale:32,contactShadowOpacity:.28,contactShadowBlur:2.5,contactShadowFar:8,contactShadowColor:"#304F65"}),o.updateRenderSettings({quality:"High",autoQuality:!0,bloomEnabled:!0,bloomIntensity:.35,bloomThreshold:.85,bloomRadius:.45,bloomMipmap:!1,vignetteEnabled:!0});const ce=o.createFolder("Cube RPG · Materials"),N=o.createFolder("Cube RPG · Blueprints"),pe=o.createFolder("Cube RPG · Characters"),fe=o.createFolder("Cube RPG · UI"),v=(e,t,n={})=>{const i=o.createMaterial(e,"Editable stylized surface for the Skyward Trials.",ce);return o.updateMaterial(i,{color:t,metalness:0,roughness:.8,toon:!0,toonFinish:"jelly",toonBands:3,toonRimColor:"#FFF5DA",toonRimStrength:.14,...n}),i},s={mint:v("Meadow · Pistachio","#7ACDA0"),leaf:v("Canopy · Jade","#319F80",{toonFinish:"cloth"}),stone:v("Floating Rock · Slate","#47667B",{toonFinish:"rubber"}),cream:v("Cloud & Marble · Pearl","#FFF2D9",{toonFinish:"pearl"}),coral:v("Cubie · Tangerine","#FBA06B"),ink:v("Eyes & Soles · Ink","#203748",{toonFinish:"rubber"}),gold:v("Equipment · Honey Gold","#FFD26D",{emissiveColor:"#FFC760",emissiveIntensity:.12}),silver:v("Sword · Moon Silver","#CEE7EA",{toonFinish:"pearl"}),teal:v("Shield · Lagoon","#36B8B4"),violet:v("Ruins · Lavender","#B8A4DD"),purple:v("Grumbles · Plum","#9A70BB"),rose:v("Flowers & Telegraphs · Rose","#EC7C94"),glow:v("Waystone · Sunlight","#FFF2A8",{emissiveColor:"#FFD272",emissiveIntensity:1.1}),distant:v("Distant Islands · Haze Blue","#9CBFCC",{toonFinish:"cloth"})},d=(e,t,n=[0,0,0])=>o.createObjectWithProps("empty",{name:e,parentId:t,position:n}),P=d("Cube RPG — World"),E=d("01 · Arenas & Gates",P),k=d("02 · Sky, Trees & Ruins",P),M=d("03 · Editable VFX",P),r=(e,t,n,i,a=k,l="cube",h=!1,w=[0,0,0],B=!1)=>{const $=o.createObjectWithProps(l,{name:e,position:t,parentId:a,physics:h||B?{enabled:!0,bodyType:"fixed",collider:l==="sphere"?"sphere":"box",friction:.9,isTrigger:B}:void 0});return o.updateTransform($,"scale",n),o.updateTransform($,"rotation",w),o.setObjectMaterial($,i),$},y=(e,t,n,i=M,a={})=>{const l=d(e,i,n);return o.addParticles(l,"magic"),o.updateParticles(l,{enabled:!1,looping:!1,rate:0,burst:0,maxParticles:48,shape:"sphere",shapeRadius:.35,speed:2.2,speedJitter:.6,direction:[0,1,0],gravity:1.8,drag:.4,lifetime:.65,startSize:.14,endSize:.01,startColor:t,endColor:"#FFF9DD",startOpacity:.9,endOpacity:0,worldSpace:!0,blend:"additive",light:!1,gpu:!1,...a}),l},R=(e,t,n,i)=>{const{blueprintId:a}=o.createBlueprintNamed(t,n,N),l=o.applyBlueprintFeatherSource(a,i);if(!l.ok)throw new Error(`${t}: ${l.diagnostics.map(h=>h.message).join("; ")}`);return o.attachScript(e,a),a};let H;const U=(e,t)=>{o.setObjectVariable(e,"base_color",t),H?o.attachScript(e,H):H=R(e,"Combat · Per-Character Damage Flash","A brief warm-white flash on this mesh only. Shared materials stay unchanged; the authored color returns after the hit.",`blueprint Damage_Flash
var base_color: string = "#FBA06B"
var flashing: boolean = false
on event CubeDamageFlash(payload):
    if self.flashing == false:
        self.flashing = true
        Material.set_color("base", "#FFF4CC")
        Material.set_color("emissive", "#FFD990")
        Material.set("emissiveIntensity", 0.8)
        wait(0.09)
        Material.set_color("base", self.base_color)
        Material.set_color("emissive", "#000000")
        Material.set("emissiveIntensity", 0)
        self.flashing = false
`)},J={RpgHealth:100,RpgPotions:3,RpgArena:1,RpgLevel:1,RpgEnemies:3,RpgCoins:0,RpgStarted:!1,RpgMenu:!1,RpgDefeated:!1,RpgVictory:!1,RpgSword:!0,RpgShield:!0,RpgBlocking:!1,RpgCombo:0,RpgAttackGap:0};for(const[e,t]of Object.entries(J)){const n=o.createVariable(e,typeof t=="boolean"?"boolean":"number",!1);o.updateVariable(n,{defaultValue:t})}const g="Game.RpgStarted and Game.RpgMenu == false and Game.RpgDefeated == false and Game.RpgVictory == false",K=["Petal Courtyard","Amethyst Keep","Sun Crown"];for(let e=0;e<3;e++){const t=e*36,n=[s.mint,s.violet,s.cream][e],i=d(`Arena ${e+1} · ${K[e]}`,E);r(`Arena ${e+1} · Island Bedrock`,[0,-1.2,t],[27,2.3,27],s.stone,i,"cube"),r(`Arena ${e+1} · Walkable Turf`,[0,-.2,t],[26,.6,26],n,i,"cube",!0),r(`Arena ${e+1} · Inlaid Combat Court`,[0,.11,t],[16,.04,16],e===1?s.cream:s.mint,i);for(const a of[-1,1]){r(`Arena ${e+1} · ${a} Side Rail`,[a*12.8,.55,t],[.35,1.4,26],s.cream,i,"cube",!0);for(const l of[-1,1])r(`Arena ${e+1} · ${a}/${l} End Rail`,[a*7.7,.55,t+l*12.8],[10.2,1.4,.35],s.cream,i,"cube",!0)}for(let a=0;a<5;a++)r(`Arena ${e+1} · Hanging Rock ${a}`,[(a-2)*4.8,-4-a%2,t],[5.5,5.5+a%2*2,17],s.stone,i,"sphere");for(let a=0;a<8;a++){const l=a*Math.PI/4;r(`Arena ${e+1} · Court Rune ${a}`,[Math.sin(l)*6,.16,t+Math.cos(l)*6],[.13,1.5,.13],s.cream,i,"capsule",!1,[Math.PI/2,l+Math.PI/2,0])}r(`Arena ${e+1} · Court Emblem`,[0,.15,t],[1.6,.05,1.6],s.gold,i,"cube",!1,[0,Math.PI/4,0]);for(let a=0;a<4;a++){const l=a<2?-10.3:10.3,h=a%2?8.8:-8.8;e===0?(r(`Meadow Tree ${a} · Trunk`,[l,1.6,t+h],[.5,3.2,.5],s.gold,k,"capsule"),r(`Meadow Tree ${a} · Crown`,[l,3.8,t+h],[3.7,3.6,3.3],s.leaf,k,"sphere"),r(`Meadow Tree ${a} · Crown Highlight`,[l-.65,4.7,t+h],[2.4,2.5,2.4],s.mint,k,"sphere")):(r(`Arena ${e+1} · Pillar ${a}`,[l,2,t+h],[1,4,1],s.cream,k,"cube"),r(`Arena ${e+1} · Pillar Cap ${a}`,[l,4.1,t+h],[1.55,.35,1.55],s.gold),r(`Arena ${e+1} · Crown Crystal ${a}`,[l,4.8,t+h],[.8,1.2,.8],e===1?s.violet:s.glow,k,"cube",!1,[0,Math.PI/4,Math.PI/4]));for(let w=0;w<3;w++)r(`Arena ${e+1} · Flower ${a}/${w}`,[l+(w-1)*.8,.3,t+h+2],[.4,.4,.4],w===1?s.gold:s.rose,k,"sphere")}for(const a of[-3,3])r(`Arena ${e+1} · Arch ${a}`,[a,2,t+11.6],[.7,4,.7],s.cream);if(r(`Arena ${e+1} · Arch Lintel`,[0,4.1,t+11.6],[6.8,.6,.7],s.gold),r(`Arena ${e+1} · Waystone`,[0,4.9,t+11.6],[.8,.8,.8],s.glow,k,"cube",!1,[0,0,Math.PI/4]),e<2){r(`Bridge ${e+1} · Walkway`,[0,-.2,t+18],[5.5,.6,10],s.cream,E,"cube",!0);for(const a of[-2.8,2.8])r(`Bridge ${e+1} · Rail ${a}`,[a,.6,t+18],[.3,1.5,10],s.gold,E,"cube",!0)}}for(let e=0;e<7;e++){const t=d(`Cloud Bank ${e}`,k,[e%2?25:-27,-2+e%3*3,e*15-12]);for(let n=0;n<3;n++)r(`Cloud ${e} · Puff ${n}`,[(n-1)*4,n===1?1:0,0],[7,n===1?4:2.6,5],s.cream,t,"sphere")}for(let e=0;e<5;e++)r(`Far Sky Island ${e}`,[(e%2?1:-1)*(45+e*5),-10,22+e*18],[15,22,15],s.distant,k,"sphere");y("Meadow · Floating Pollen","#FFE8A6",[0,1,0],M,{enabled:!0,looping:!0,gpu:!0,shape:"box",shapeRadius:12,maxParticles:64,rate:6,speed:.25,gravity:-.03,lifetime:8,startSize:.06,endSize:.02});const O=o.createRoleObject("player",{kind:"empty",name:"Cubie — Player Controller",position:[0,0,0]});if(!O.ok||!O.objectId)throw new Error("Could not create Cubie.");const u=O.objectId;o.updateCharacterController(u,{autoInputWithScript:!0,stableJumpArc:!0,moveSpeed:5.4,sprintMultiplier:1.45,jumpStrength:7.5,gravity:22,coyoteTime:.14,jumpBufferTime:.16,acceleration:65,deceleration:75,turnSpeed:16,stepHeight:.3,groundSnap:.3,groundLevel:-18,mouseLook:!1,cameraRelativeMovement:!1,cameraFollow:!0,cameraOffset:[7,5,-11],cameraPitch:.4,cameraMinPitch:.4,cameraMaxPitch:.4,keyAttack:"Unassigned",keyAim:"Unassigned",keyRoll:"Unassigned",keyRagdoll:"Unassigned",lockOnEnabled:!1,slideEnabled:!1,mantleEnabled:!1});const c=d("Cubie · Body Rig",u),X=r("Cubie · Cube Body",[0,.95,0],[1.2,1.15,1.05],s.coral,c);U(X,"#FBA06B"),r("Cubie · Belt",[0,.54,0],[1.23,.18,1.08],s.teal,c),r("Cubie · Belt Buckle",[0,.55,.56],[.25,.23,.07],s.gold,c);const _=[],C=[];for(const e of[-1,1]){const t=d(`Cubie · ${e<0?"Left":"Right"} Eye Pivot`,c,[e*.27,1.16,.55]);_.push(t),r(`Cubie · Eye White ${e}`,[0,0,0],[.32,.4,.12],s.cream,t,"sphere"),r(`Cubie · Pupil ${e}`,[0,0,.065],[.15,.23,.08],s.ink,t,"sphere"),r(`Cubie · Eye Spark ${e}`,[.035,.06,.107],[.045,.06,.025],s.cream,t,"sphere"),r(`Cubie · Blush ${e}`,[e*.47,.91,.54],[.18,.1,.055],s.rose,c,"sphere"),C.push(r(`Cubie · Boot ${e}`,[e*.34,.18,.1],[.45,.32,.6],s.ink,c,"sphere")),r(`Cubie · Glove ${e}`,[e*.8,.82,.07],[.32,.32,.32],s.cream,c,"sphere")}r("Cubie · Smile",[0,.89,.55],[.2,.055,.06],s.ink,c,"capsule",!1,[0,0,Math.PI/2]),r("Cubie · Little Helmet",[0,1.57,0],[1.24,.19,1.1],s.teal,c),r("Cubie · Helmet Crest",[0,1.81,-.08],[.19,.38,.7],s.gold,c);const b=d("Cubie · Sword Pivot",c,[-.85,.75,.15]);r("Sword · Grip",[0,.02,0],[.14,.35,.14],s.ink,b),r("Sword · Guard",[0,.25,0],[.62,.12,.2],s.gold,b),r("Sword · Blade",[0,.88,0],[.2,1.15,.1],s.silver,b),r("Sword · Tip",[0,1.5,0],[.18,.24,.09],s.glow,b,"cube",!1,[0,0,Math.PI/4]);const G=d("Cubie · Shield Pivot",c,[.85,.9,.14]);r("Shield · Gold Rim",[0,0,0],[.7,.88,.17],s.gold,G,"sphere"),r("Shield · Teal Face",[0,0,.1],[.57,.73,.12],s.teal,G,"sphere"),r("Shield · Star",[0,0,.18],[.2,.2,.06],s.cream,G,"cube",!1,[0,0,Math.PI/4]);const V=y("Cubie · Sword Sparks","#FFE29B",[0,.8,.9],u,{shape:"disc",shapeRadius:1.3,speed:4,lifetime:.3}),de=y("Cubie · Shield Burst","#90F3ED",[.7,1,.3],u),Y=y("Cubie · Potion Hearts","#8CF6B9",[0,.9,0],u,{gravity:-.4,speed:1,lifetime:1}),ue=y("Cubie · Hurt Puff","#FF9A9A",[0,.8,0],u,{blend:"normal"}),ge=y("Cubie · Finisher Whirl","#FFD27A",[0,.7,0],u,{shape:"disc",shapeRadius:2.6,speed:5.5,speedJitter:1.4,lifetime:.38,startSize:.2,maxParticles:72}),me=y("Cubie · Ground Slam Dust","#FFF0C2",[0,.15,0],u,{shape:"disc",shapeRadius:1.2,direction:[0,1,0],speed:6,speedJitter:2,gravity:9,lifetime:.55,startSize:.26,maxParticles:80,blend:"normal"}),j=r("Cubie · Slam Shockwave",[0,.14,0],[.001,.001,.001],s.glow,u,"sphere");if(o.updateRenderer(j,{opacity:.45}),R(j,"Combat · Shockwave Ring","A flat glowing ring that races outward from the finisher and the ground slam. Tune size and timing here.",`blueprint Shockwave_Ring
on event CubeShockwave(payload):
    set_scale(self, vec3(0.8, 0.05, 0.8))
    tween(self, property: "scale", to: vec3(7.4, 0.02, 7.4), duration: 0.24)
    wait(0.25)
    set_scale(self, vec3(0.001, 0.001, 0.001))
`),R(u,"Cubie · Equipment, Combat & Potions","A buffered 3-hit sword combo (slash, backhand, spinning finisher), a jump-attack plunge that slams the ground, a shield that absorbs 75% damage, and potions that heal 45. Tune numbers here; all VFX are named child emitters.",`blueprint Cubie_Combat
var attack_ready: boolean = true
var hurt_ready: boolean = true
var impact_ready: boolean = true
var combo: number = 0
var combo_clock: number = 0
var queued: boolean = false
var queue_clock: number = 0
var plunging: boolean = false
var plunge_clock: number = 0
var air_ready: boolean = true
on key_pressed("Mouse0"):
    fire_event("CubeAttack")
on key_pressed("KeyJ"):
    fire_event("CubeAttack")
on event CubeAttack(payload):
    if ${g} and Game.RpgSword and Game.RpgBlocking == false and self.plunging == false:
        self.queued = true
        self.queue_clock = 0
on event CubeSwing(payload):
    self.combo = self.combo + 1
    Game.RpgCombo = self.combo
    if self.combo == 1:
        fire_event("CubieStrike", target: "${c}")
        tween("${b}", property: "rotation", to: vec3(0, 0, 28), duration: 0.05, space: "local")
        wait(0.06)
        burst_particles("${V}", count: 24)
        tween("${b}", property: "rotation", to: vec3(0, 0, -125), duration: 0.07, space: "local")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 2.8:
                apply_damage(actor, 26 + (Game.RpgLevel - 1) * 6)
        wait(0.2)
    elif self.combo == 2:
        fire_event("CubieStrike2", target: "${c}")
        tween("${b}", property: "rotation", to: vec3(0, 0, -150), duration: 0.04, space: "local")
        wait(0.05)
        burst_particles("${V}", count: 30)
        tween("${b}", property: "rotation", to: vec3(0, 0, 70), duration: 0.07, space: "local")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 2.8:
                apply_damage(actor, 30 + (Game.RpgLevel - 1) * 7)
        wait(0.2)
    else:
        fire_event("CubieFinisher", target: "${c}")
        tween("${b}", property: "rotation", to: vec3(0, 0, -95), duration: 0.06, space: "local")
        wait(0.11)
        burst_particles("${V}", count: 40)
        burst_particles("${ge}", count: 56)
        fire_event("CubeShockwave", target: "${j}")
        Screen.flash(0.04, color: "#FFE7AE")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 3.5:
                apply_damage(actor, 48 + (Game.RpgLevel - 1) * 11)
        wait(0.3)
    tween("${b}", property: "rotation", to: vec3(0, 0, 0), duration: 0.14, space: "local")
    self.combo_clock = 0
    if self.combo >= 3:
        wait(0.22)
        self.combo = 0
        Game.RpgCombo = 0
    self.attack_ready = true
on event CubeAirAttack(payload):
    self.combo = 0
    Game.RpgCombo = 0
    self.air_ready = false
    fire_event("CubieAirSpin", target: "${c}")
    apply_impulse(self, vec3(0, 3.2, 0))
    tween("${b}", property: "rotation", to: vec3(0, 0, 165), duration: 0.12, space: "local")
    wait(0.16)
    apply_impulse(self, vec3(0, -26, 0))
    tween("${b}", property: "rotation", to: vec3(0, 0, -115), duration: 0.08, space: "local")
    self.plunge_clock = 0
    self.plunging = true
on event CubeSlam(payload):
    fire_event("CubieLand", target: "${c}")
    fire_event("CubeShockwave", target: "${j}")
    burst_particles("${me}", count: 60)
    Camera.shake(0.45)
    Screen.flash(0.05, color: "#FFE9B0")
    for actor in find_actors(tag: "enemy"):
        if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 3.8:
            apply_damage(actor, 42 + (Game.RpgLevel - 1) * 10)
    wait(0.16)
    tween("${b}", property: "rotation", to: vec3(0, 0, 0), duration: 0.16, space: "local")
    wait(0.2)
    self.attack_ready = true
on event CubeImpact(payload):
    if ${g} and self.impact_ready:
        self.impact_ready = false
        Camera.shake(0.28)
        Camera.set(distance: 9.7, height: 4.7)
        Screen.flash(0.035, color: "#FFF0C6")
        wait(0.09)
        Camera.set(distance: 11, height: 5)
        wait(0.08)
        self.impact_ready = true
on key_pressed("Space"):
    if ${g} and self.is_grounded():
        fire_event("CubieJump", target: "${c}")
on key_down("KeyQ"):
    if ${g} and Game.RpgShield:
        Game.RpgBlocking = true
on key_down("Mouse1"):
    if ${g} and Game.RpgShield:
        Game.RpgBlocking = true
on key_up("KeyQ"):
    Game.RpgBlocking = false
on key_up("Mouse1"):
    Game.RpgBlocking = false
on event CubeBlock(payload):
    if ${g} and Game.RpgShield:
        Game.RpgBlocking = true
        wait(0.8)
        Game.RpgBlocking = false
on key_pressed("Digit1"):
    fire_event("CubeSword")
on key_pressed("Digit2"):
    fire_event("CubeShield")
on event CubeSword(payload):
    if ${g}:
        Game.RpgSword = not Game.RpgSword
on event CubeShield(payload):
    if ${g}:
        Game.RpgShield = not Game.RpgShield
        Game.RpgBlocking = false
on key_pressed("KeyE"):
    fire_event("CubePotion")
on key_pressed("Digit3"):
    fire_event("CubePotion")
on event CubePotion(payload):
    if ${g} and Game.RpgPotions > 0 and Game.RpgHealth < 100:
        Game.RpgPotions = Game.RpgPotions - 1
        Game.RpgHealth = clamp(Game.RpgHealth + 45, 0, 100)
        burst_particles("${Y}", count: 26)
        Screen.flash(0.06, color: "#9EF4CB")
on receive_damage(amount):
    if ${g} and self.hurt_ready:
        self.hurt_ready = false
        if Game.RpgBlocking and Game.RpgShield:
            Game.RpgHealth = clamp(Game.RpgHealth - amount * 0.25, 0, 100)
            burst_particles("${de}", count: 24)
            Camera.shake(0.14)
            fire_event("CubieGuard", target: "${c}")
        else:
            Game.RpgHealth = clamp(Game.RpgHealth - amount, 0, 100)
            burst_particles("${ue}", count: 18)
            Camera.shake(0.1)
            fire_event("CubieHurt", target: "${c}")
            fire_event("CubeDamageFlash", target: "${X}")
        if Game.RpgHealth <= 0:
            Game.RpgDefeated = true
            Game.RpgBlocking = false
            Time.scale = 0
        wait(0.35)
        self.hurt_ready = true
on update(dt):
    if Game.RpgSword:
        set_scale("${b}", vec3(1, 1, 1))
    else:
        set_scale("${b}", vec3(0.001, 0.001, 0.001))
    if Game.RpgShield:
        set_scale("${G}", vec3(1, 1, 1))
    else:
        set_scale("${G}", vec3(0.001, 0.001, 0.001))
    if Game.RpgBlocking:
        set_rotation("${G}", vec3(-12, -30, -15))
    else:
        set_rotation("${G}", vec3(0, 0, 0))
    if self.attack_ready and self.combo > 0:
        self.combo_clock = self.combo_clock + dt
        if self.combo_clock > 0.6:
            self.combo = 0
            Game.RpgCombo = 0
    if self.queued:
        self.queue_clock = self.queue_clock + dt
        if self.queue_clock > 0.45:
            self.queued = false
    if self.queued and self.attack_ready and ${g} and Game.RpgSword and Game.RpgBlocking == false:
        self.queued = false
        self.attack_ready = false
        if self.is_grounded() == false and self.air_ready:
            fire_event("CubeAirAttack", target: self)
        else:
            fire_event("CubeSwing", target: self)
    if self.plunging:
        self.plunge_clock = self.plunge_clock + dt
        if self.is_grounded():
            self.plunging = false
            fire_event("CubeSlam", target: self)
        elif self.plunge_clock > 1.6:
            self.plunging = false
            self.attack_ready = true
            fire_event("CubieLand", target: "${c}")
    if self.air_ready == false and self.plunging == false and self.is_grounded():
        self.air_ready = true
on event CubeFall(payload):
    if ${g}:
        self.plunging = false
        self.queued = false
        self.attack_ready = true
        Game.RpgHealth = clamp(Game.RpgHealth - 20, 0, 100)
        set_position(self, vec3(0, 2, (Game.RpgArena - 1) * 36 - 7))
        if Game.RpgHealth <= 0:
            Game.RpgDefeated = true
            Time.scale = 0
`),R(c,"Cubie · Walk, Strike & Expressions","A real foot stride, body sway, jump stretch, sword follow-through, guard brace and hurt squint. All poses stay on the visual rig.",`blueprint Cubie_Motion
var phase: number = 0
var pose: string = "idle"
on update(dt):
    self.phase = self.phase + dt * 12
    if self.pose != "hurt" and self.pose != "blink":
        set_scale("${_[0]}", vec3(1, 1, 1))
        set_scale("${_[1]}", vec3(1, 1, 1))
    if self.pose == "idle":
        if speed("${u}") > 0.6:
            set_position(self, vec3(0, abs(sin(self.phase)) * 0.11, 0))
            set_rotation(self, vec3(3, 0, sin(self.phase) * 5))
            set_position("${C[0]}", vec3(-0.34, 0.18 + max(0, sin(self.phase)) * 0.12, 0.1 + sin(self.phase) * 0.2))
            set_position("${C[1]}", vec3(0.34, 0.18 + max(0, (0 - sin(self.phase))) * 0.12, 0.1 - sin(self.phase) * 0.2))
            set_rotation("${C[0]}", vec3(sin(self.phase) * 25, 0, 0))
            set_rotation("${C[1]}", vec3((0 - sin(self.phase)) * 25, 0, 0))
        else:
            set_position(self, vec3(0, 0.035 + sin(self.phase * 0.25) * 0.025, 0))
            set_rotation(self, vec3(0, 0, sin(self.phase * 0.25) * 1.5))
            set_position("${C[0]}", vec3(-0.34, 0.18, 0.1))
            set_position("${C[1]}", vec3(0.34, 0.18, 0.1))
            set_rotation("${C[0]}", vec3(0, 0, 0))
            set_rotation("${C[1]}", vec3(0, 0, 0))
on event CubieStrike(payload):
    self.pose = "strike"
    tween(self, property: "rotation", to: vec3(-8, 0, 12), duration: 0.05)
    tween(self, property: "scale", to: vec3(1.1, 0.88, 1.08), duration: 0.05)
    wait(0.06)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(10, 0, -14), duration: 0.07)
        tween(self, property: "scale", to: vec3(0.95, 1.1, 0.95), duration: 0.07)
    wait(0.1)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.16)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.16)
    wait(0.17)
    if self.pose == "strike":
        self.pose = "idle"
on event CubieStrike2(payload):
    self.pose = "strike"
    tween(self, property: "rotation", to: vec3(-6, 0, -14), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.08, 0.9, 1.08), duration: 0.04)
    wait(0.05)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(12, 0, 16), duration: 0.07)
        tween(self, property: "scale", to: vec3(0.94, 1.12, 0.94), duration: 0.07)
    wait(0.1)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.15)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.15)
    wait(0.16)
    if self.pose == "strike":
        self.pose = "idle"
on event CubieFinisher(payload):
    self.pose = "finisher"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(1.14, 0.84, 1.14), duration: 0.06)
    wait(0.06)
    tween(self, property: "position", to: vec3(0, 0.45, 0), duration: 0.12)
    tween(self, property: "rotation", to: vec3(0, 360, 0), duration: 0.24)
    tween(self, property: "scale", to: vec3(0.92, 1.14, 0.92), duration: 0.1)
    wait(0.14)
    if self.pose == "finisher":
        tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.1)
    wait(0.11)
    if self.pose == "finisher":
        set_rotation(self, vec3(0, 0, 0))
        tween(self, property: "scale", to: vec3(1.12, 0.86, 1.12), duration: 0.05)
        wait(0.06)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.14)
        wait(0.15)
        if self.pose == "finisher":
            self.pose = "idle"
on event CubieAirSpin(payload):
    self.pose = "air"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(0.86, 0.86, 0.86), duration: 0.06)
    tween(self, property: "rotation", to: vec3(360, 0, 0), duration: 0.18)
    wait(0.19)
    if self.pose == "air":
        set_rotation(self, vec3(18, 0, 0))
        tween(self, property: "scale", to: vec3(0.9, 1.2, 0.9), duration: 0.06)
on event CubieLand(payload):
    self.pose = "land"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(1.32, 0.66, 1.32), duration: 0.04)
    tween(self, property: "position", to: vec3(0, -0.08, 0), duration: 0.04)
    wait(0.12)
    if self.pose == "land":
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.18)
        tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.18)
    wait(0.19)
    if self.pose == "land":
        self.pose = "idle"
on event CubieJump(payload):
    if self.pose == "idle":
        self.pose = "jump"
        tween(self, property: "scale", to: vec3(0.9, 1.18, 0.9), duration: 0.07)
        wait(0.12)
        if self.pose == "jump":
            tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.13)
        wait(0.14)
        if self.pose == "jump":
            self.pose = "idle"
on event CubieGuard(payload):
    self.pose = "guard"
    tween(self, property: "rotation", to: vec3(-10, 0, -5), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.08, 0.91, 1.08), duration: 0.04)
    wait(0.1)
    if self.pose == "guard":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.14)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.14)
    wait(0.15)
    if self.pose == "guard":
        self.pose = "idle"
on event CubieHurt(payload):
    self.pose = "hurt"
    set_scale("${_[0]}", vec3(1, 0.25, 1))
    set_scale("${_[1]}", vec3(1, 0.25, 1))
    tween(self, property: "rotation", to: vec3(-16, 0, 10), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.16, 0.8, 1.12), duration: 0.04)
    wait(0.1)
    if self.pose == "hurt":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.18)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.18)
    wait(0.19)
    if self.pose == "hurt":
        set_scale("${_[0]}", vec3(1, 1, 1))
        set_scale("${_[1]}", vec3(1, 1, 1))
        self.pose = "idle"
on timer(3):
    if self.pose == "idle":
        self.pose = "blink"
        set_scale("${_[0]}", vec3(1, 0.08, 1))
        set_scale("${_[1]}", vec3(1, 0.08, 1))
        wait(0.12)
        if self.pose == "blink":
            set_scale("${_[0]}", vec3(1, 1, 1))
            set_scale("${_[1]}", vec3(1, 1, 1))
            self.pose = "idle"
`),!o.createPrefabFromObject(u,"Cubie · Playable Cube Knight",pe))throw new Error("Could not create the reusable cube knight.");o.updateTransform(u,"position",[0,1.2,-7]),o.updateTransform(u,"rotation",[0,Math.PI,0]);const Q=r("Cloud Sea · Recovery Trigger",[0,-6,36],[100,2,150],s.cream,E,"cube",!1,[0,0,0],!0);o.updateRenderer(Q,{enabled:!1}),R(Q,"Cube RPG · Fall Recovery","Falling costs 20 health and returns Cubie to the current arena.",`blueprint Fall_Recovery
on trigger_enter(other: "${u}"):
    fire_event("CubeFall", target: Player)
`);const be=d("04 · Arena Opponents",P),Z=o.createBlueprintNamed("Grumble · Chase, Telegraph & Loot","One reusable AI: arena gates activation; each foe keeps its own jittered attack clock and a shared 0.8s attack token (RpgAttackGap) stops two foes committing on the same beat. A pink warning commits the attack: light hits cannot cancel it, only damage at or above poise (combo finisher, ground slam). Per-instance hp, damage, speed, poise, attack rate and arena are Inspector-editable.",N).blueprintId,he=`blueprint Grumble_AI
var hp: number = 56
var max_hp: number = 56
var arena: number = 1
var damage: number = 16
var pace: number = 2
var defeated: boolean = false
var reacting: boolean = false
var attacking: boolean = false
var recoil: number = 3.4
var knock: number = 1
var poise: number = 40
var attack_rate: number = 1.7
var attack_clock: number = 0
var windup: number = 0
var rig_anchor: string = ""
var mesh_anchor: string = ""
var impact_anchor: string = ""
var vfx_anchor: string = ""
var tell_anchor: string = ""
var health_anchor: string = ""
var warning_anchor: string = ""
on start:
    set_visible(self.warning_anchor, false)
    set_scale(self.warning_anchor, vec3(4.6, 0.03, 4.6))
    self.attack_clock = random(0, self.attack_rate * 0.7)
on update(dt):
    set_scale(self.health_anchor, vec3(clamp(self.hp / self.max_hp, 0, 1), 1, 1))
    if ${g} and Game.RpgArena == self.arena and self.defeated == false:
        if self.reacting:
            self.move_to(Player.location, speed: 0 - self.recoil * self.knock, arrival: 0.2)
        elif self.attacking:
            self.move_to(Player.location, speed: 0, arrival: 1.3)
            self.windup = self.windup - dt
            if self.windup <= 0:
                self.attacking = false
                set_visible(self.warning_anchor, false)
                if distance(position(self), Player.location) < 2.7:
                    fire_event("GrumbleStrike", target: self.rig_anchor)
                    apply_damage(Player, self.damage)
        else:
            self.move_to(Player.location, speed: self.pace, arrival: 1.3)
            if distance(position(self), Player.location) < 3.2:
                self.attack_clock = self.attack_clock + dt
                if self.attack_clock >= self.attack_rate and Game.RpgAttackGap <= 0 and distance(position(self), Player.location) < 2.5:
                    Game.RpgAttackGap = 0.8
                    self.attack_clock = random(0, 0.5)
                    self.attacking = true
                    fire_event("GrumbleAttack", target: self)
on event GrumbleAttack(payload):
    self.windup = 0.42
    fire_event("GrumbleWindup", target: self.rig_anchor)
    set_position(self.tell_anchor, position(self))
    set_visible(self.warning_anchor, true)
    burst_particles(self.tell_anchor, count: 14)
on receive_damage(amount):
    if ${g} and Game.RpgArena == self.arena and self.defeated == false:
        self.hp = self.hp - amount
        set_position(self.vfx_anchor, vec_add(position(self), vec3(0, 0.7, 0)))
        burst_particles(self.vfx_anchor, count: 26)
        fire_event("CubeHitVfx", target: self.impact_anchor)
        fire_event("CubeImpact", target: Player)
        if self.attacking and amount < self.poise and self.hp > 0:
            fire_event("CubeDamageFlash", target: self.mesh_anchor)
        else:
            self.knock = clamp(amount / 30, 0.7, 2.4)
            self.reacting = true
            self.attacking = false
            self.attack_clock = 0
            set_visible(self.warning_anchor, false)
            fire_event("GrumbleHit", target: self.rig_anchor)
        if self.hp <= 0:
            self.defeated = true
            wait(0.26)
            burst_particles(self.vfx_anchor, count: 28)
            Game.RpgEnemies = clamp(Game.RpgEnemies - 1, 0, 10)
            Game.RpgCoins = Game.RpgCoins + 10 * self.arena
            destroy(self)
`,ee=o.applyBlueprintFeatherSource(Z,he);if(!ee.ok)throw new Error(`Grumble AI: ${ee.diagnostics.map(e=>e.message).join("; ")}`);const te=[[[-4,.1,2],[4,.1,3],[0,.1,7]],[[-4,.1,38],[4,.1,39],[0,.1,43]],[[0,.1,76]]];let z,L;for(let e=0;e<3;e++)for(let t=0;t<te[e].length;t++){const n=e===2,i=n?"Sun Crown · King Grumble":`Arena ${e+1} · Grumble ${t+1}`,a=d(i,be,te[e][t]);o.setObjectVariable(a,"enemy",!0),o.setObjectVariable(a,"enemySpeed",0),o.setObjectVariable(a,"chaseRange",0);for(const[f,A]of Object.entries({hp:n?252:e?84:56,max_hp:n?252:e?84:56,arena:e+1,damage:n?32:e?24:16,pace:n?1.65:e?2.5:2}))o.setObjectVariable(a,f,A);const l=d(`${i} · Toy Rig`,a);n&&o.updateTransform(l,"scale",[1.65,1.65,1.65]);const h=r(`${i} · Body`,[0,.72,0],[1.1,1.15,1.1],n?s.rose:s.purple,l);U(h,n?"#EC7C94":"#9A70BB");const w=[],B=[],$=[];for(const f of[-1,1]){const A=d(`${i} · Eye Pivot ${f}`,l,[f*.24,.94,.56]);w.push(A),r(`${i} · Eye ${f}`,[0,0,0],[.22,.28,.09],s.cream,A,"sphere"),r(`${i} · Pupil ${f}`,[0,0,.05],[.1,.17,.07],s.ink,A,"sphere"),B.push(r(`${i} · Brow ${f}`,[f*.24,1.16,.57],[.32,.07,.08],s.ink,l,"cube",!1,[0,0,-f*.25])),$.push(r(`${i} · Foot ${f}`,[f*.32,.14,.08],[.42,.24,.52],s.ink,l,"sphere"))}const W=d(`${i} · Hurt Mouth Pivot`,l,[0,.65,.58]);if(o.updateTransform(W,"scale",[.001,.001,.001]),r(`${i} · Hurt Mouth`,[0,0,0],[.21,.25,.08],s.ink,W,"sphere"),n){r("King Grumble · Crown Band",[0,1.37,0],[1.25,.22,1.25],s.gold,l);for(let f=-1;f<=1;f++)r(`King Grumble · Crown Point ${f}`,[f*.4,1.66,0],[.2,.45,.3],s.glow,l)}const se=n?2.2:1.6;r(`${i} · Health Track`,[0,se,0],[1.25,.1,.18],s.ink,l);const re=d(`${i} · Health Fill Pivot`,l,[-.6,se,0]);r(`${i} · Health Fill`,[.6,.035,-.04],[1.2,.075,.2],s.rose,re),o.setObjectVariable(a,"health_anchor",re);for(const[f,A]of Object.entries({owner:a,mesh_anchor:h,eye_left:w[0],eye_right:w[1],brow_left:B[0],brow_right:B[1],foot_left:$[0],foot_right:$[1],mouth_anchor:W,base_scale:n?1.65:1}))o.setObjectVariable(l,f,A);z?o.attachScript(l,z):z=R(l,"Grumble · Motion & Hit Reactions","Walk, wind-up, lunge, recoil, squint and a defeat pop. Named instance anchors make the same poses work on every foe, including the larger boss.",`blueprint Grumble_Motion
var owner: string = ""
var mesh_anchor: string = ""
var eye_left: string = ""
var eye_right: string = ""
var brow_left: string = ""
var brow_right: string = ""
var foot_left: string = ""
var foot_right: string = ""
var mouth_anchor: string = ""
var base_scale: number = 1
var phase: number = 0
var pose: string = "idle"
on update(dt):
    self.phase = self.phase + dt * 11
    if self.pose == "idle":
        if ${g} and get_var(self.owner, "arena") == Game.RpgArena and distance(position(self.owner), Player.location) > 1.4:
            set_position(self, vec3(0, abs(sin(self.phase)) * 0.12, 0))
            set_rotation(self, vec3(4, 0, sin(self.phase) * 7))
            set_position(self.foot_left, vec3(-0.32, 0.14 + max(0, sin(self.phase)) * 0.14, 0.08 + sin(self.phase) * 0.22))
            set_position(self.foot_right, vec3(0.32, 0.14 + max(0, (0 - sin(self.phase))) * 0.14, 0.08 - sin(self.phase) * 0.22))
            set_rotation(self.foot_left, vec3(sin(self.phase) * 30, 0, 0))
            set_rotation(self.foot_right, vec3((0 - sin(self.phase)) * 30, 0, 0))
        else:
            set_position(self, vec3(0, 0.04 + sin(self.phase * 0.3) * 0.03, 0))
            set_rotation(self, vec3(0, 0, sin(self.phase * 0.3) * 2))
            set_position(self.foot_left, vec3(-0.32, 0.14, 0.08))
            set_position(self.foot_right, vec3(0.32, 0.14, 0.08))
            set_rotation(self.foot_left, vec3(0, 0, 0))
            set_rotation(self.foot_right, vec3(0, 0, 0))
on event GrumbleWindup(payload):
    if self.pose != "hurt" and self.pose != "defeat":
        self.pose = "windup"
        tween(self, property: "rotation", to: vec3(-18, 0, 0), duration: 0.12)
        tween(self, property: "scale", to: vec3(self.base_scale * 1.12, self.base_scale * 0.82, self.base_scale * 1.12), duration: 0.12)
        wait(0.38)
        if self.pose == "windup":
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.12)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.12)
            wait(0.13)
            if self.pose == "windup":
                self.pose = "idle"
on event GrumbleStrike(payload):
    if self.pose != "hurt" and self.pose != "defeat":
        self.pose = "strike"
        tween(self, property: "position", to: vec3(0, 0.05, 0.3), duration: 0.06)
        tween(self, property: "rotation", to: vec3(24, 0, 0), duration: 0.06)
        tween(self, property: "scale", to: vec3(self.base_scale * 0.92, self.base_scale * 1.1, self.base_scale * 0.92), duration: 0.06)
        wait(0.08)
        if self.pose == "strike":
            tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.14)
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.14)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.14)
        wait(0.15)
        if self.pose == "strike":
            self.pose = "idle"
on event GrumbleHit(payload):
    if self.pose != "defeat" and (self.pose != "hurt" or get_var(self.owner, "defeated")):
        self.pose = "hurt"
        fire_event("CubeDamageFlash", target: self.mesh_anchor)
        set_scale(self.eye_left, vec3(1, 0.22, 1))
        set_scale(self.eye_right, vec3(1, 0.22, 1))
        set_scale(self.mouth_anchor, vec3(1, 1, 1))
        set_rotation(self.brow_left, vec3(0, 0, -28))
        set_rotation(self.brow_right, vec3(0, 0, 28))
        tween(self, property: "position", to: vec3(0, 0.12, -0.28), duration: 0.05)
        tween(self, property: "rotation", to: vec3(-22, 0, 9), duration: 0.05)
        tween(self, property: "scale", to: vec3(self.base_scale * 1.25, self.base_scale * 0.7, self.base_scale * 1.15), duration: 0.05)
        wait(0.07)
        if get_var(self.owner, "defeated"):
            self.pose = "defeat"
            tween(self, property: "rotation", to: vec3(-80, 0, 20), duration: 0.16)
            tween(self, property: "scale", to: vec3(0.001, 0.001, 0.001), duration: 0.16)
        else:
            tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.16)
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.16)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.16)
            wait(0.17)
            if get_var(self.owner, "defeated") == false:
                set_scale(self.eye_left, vec3(1, 1, 1))
                set_scale(self.eye_right, vec3(1, 1, 1))
                set_scale(self.mouth_anchor, vec3(0.001, 0.001, 0.001))
                set_rotation(self.brow_left, vec3(0, 0, 14.32))
                set_rotation(self.brow_right, vec3(0, 0, -14.32))
                set_var(self.owner, "reacting", false)
                self.pose = "idle"
`);const ne=y(`${i} · Loot & Hit Sparks`,"#FFF0B8",[0,0,0],M,{speed:4,speedJitter:1.2,lifetime:.4,startSize:.2,maxParticles:72}),I=d(`${i} · Impact Star`,ne);o.updateTransform(I,"scale",[.001,.001,.001]);for(const f of[-Math.PI/4,Math.PI/4])r(`${i} · Impact Streak ${f<0?"A":"B"}`,[0,0,0],[1.6,.12,.12],s.glow,I,"cube",!1,[0,0,f]);L?o.attachScript(I,L):L=R(I,"Combat · Impact Star","An editable bright cross that snaps on at contact, spins and disappears in 0.18 seconds.",`blueprint Impact_Star
on event CubeHitVfx(payload):
    set_scale(self, vec3(1, 1, 1))
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "rotation", to: vec3(0, 0, 75), duration: 0.18)
    tween(self, property: "scale", to: vec3(0.001, 0.001, 0.001), duration: 0.18)
`);const ie=y(`${i} · Attack Warning`,"#FF7080",[0,0,0],M,{shape:"disc",shapeRadius:2.3,direction:[0,1,0],speed:.15,gravity:0,startSize:.17,lifetime:.35,blend:"normal"}),le=r(`${i} · Danger Disc`,[0,.05,0],[.001,.001,.001],s.rose,ie,"sphere");o.updateRenderer(le,{opacity:.28}),o.setObjectVariable(a,"warning_anchor",le),o.setObjectVariable(a,"rig_anchor",l),o.setObjectVariable(a,"mesh_anchor",h),o.setObjectVariable(a,"impact_anchor",I),o.setObjectVariable(a,"recoil",n?1.8:3.4),o.setObjectVariable(a,"poise",n?999:40),o.setObjectVariable(a,"attack_rate",n?1.5:e?1.6:1.9),o.setObjectVariable(a,"vfx_anchor",ne),o.setObjectVariable(a,"tell_anchor",ie),o.attachScript(a,Z)}for(let e=0;e<2;e++){const t=e*36+14,n=r(`Arena ${e+1} · Locked Gate`,[0,1.5,t],[5.2,3.2,.45],s.teal,E,"cube",!0),i=y(`Arena ${e+1} · Gate Unlock Celebration`,"#FFDF8E",[0,1.5,t]);R(n,`Arena ${e+1} · Gate Unlock`,"The physical gate lifts once all enemies in this arena are defeated.",`blueprint Gate_Unlock
var opened: boolean = false
on update(dt):
    if Game.RpgArena == ${e+1} and Game.RpgEnemies == 0 and self.opened == false:
        self.opened = true
        set_physics(self, { enabled: false })
        tween(self, property: "position", to: vec3(0, 6.5, ${t}), duration: 0.7)
        burst_particles("${i}", count: 32)
`);const a=r(`Arena ${e+2} · Entry Trigger`,[0,1.5,t+9],[5.2,4,2],s.glow,E,"cube",!1,[0,0,0],!0);o.updateRenderer(a,{enabled:!1}),R(a,`Arena ${e+2} · Level Up`,"Enter the next arena only after clearing this one. Gain a level, two potions and 20 health.",`blueprint Arena_Entry
on trigger_enter(other: "${u}"):
    if ${g} and Game.RpgArena == ${e+1} and Game.RpgEnemies == 0:
        Game.RpgArena = ${e+2}
        Game.RpgLevel = ${e+2}
        Game.RpgEnemies = ${e===0?3:1}
        Game.RpgPotions = Game.RpgPotions + 2
        Game.RpgHealth = clamp(Game.RpgHealth + 20, 0, 100)
        burst_particles("${Y}", count: 32)
`)}const ve=y("Sun Crown · Victory Confetti","#FFDE76",[0,2,72],M,{lifetime:2,speed:4,maxParticles:64}),ye=d("05 · Start, Pause, Retry & Victory",P);R(ye,"Cube RPG · Game Flow","Start and pause stop game time. Replay reloads the complete authored scene and resets every run variable.",`blueprint Cube_RPG_Flow
on start:
    if Game.RpgStarted == false:
        Game.RpgMenu = true
        Time.scale = 0
on event CubeResume(payload):
    if Game.RpgDefeated == false and Game.RpgVictory == false:
        Game.RpgStarted = true
        Game.RpgMenu = false
        Game.RpgBlocking = false
        Time.scale = 1
on event CubePause(payload):
    if Game.RpgStarted and Game.RpgDefeated == false and Game.RpgVictory == false:
        Game.RpgMenu = true
        Game.RpgBlocking = false
        Time.scale = 0
on key_pressed("KeyP"):
    if Game.RpgDefeated == false and Game.RpgVictory == false:
        if Game.RpgMenu:
            fire_event("CubeResume")
        else:
            fire_event("CubePause")
on event CubeRestart(payload):
${Object.entries(J).map(([e,t])=>`    Game.${e} = ${e==="RpgStarted"?"true":String(t)}`).join(`
`)}
    Time.scale = 1
    Scene.load("${T}")
on update(dt):
    if Game.RpgAttackGap > 0:
        Game.RpgAttackGap = max(0, Game.RpgAttackGap - dt)
    if ${g} and Game.RpgArena == 3 and Game.RpgEnemies == 0:
        burst_particles("${ve}", count: 64)
        Game.RpgVictory = true
        Game.RpgBlocking = false
        Time.scale = 0
`);const S=o.createUIDocument("Cube RPG · Adventure HUD","screen",fe);o.updateUIDocument(S,{visibleOnStart:!0,renderMode:"dom"}),o.attachUI(P,S);const x=q.getState().uiDocuments.find(e=>e.id===S);o.updateUIElement(S,x.root.id,{name:"Cube RPG HUD Root",className:"cube-rpg-hud",anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0},style:{width:"100%",height:"100%",padding:"0",display:"block"}});const p=(e,t,n,i)=>{const a=o.addUIElement(S,e,t);return o.updateUIElement(S,a,{name:n,...t==="button"?{style:{background:i.className?.includes("rpg-primary")?"#FFD478":"#F7FAEF",color:"#2D525A",padding:"11px 15px",borderRadius:"12px",fontWeight:"800",fontSize:"13px"}}:{},...i}),a},m=(e,t,n)=>o.setUIBinding(S,e,t,n),D=p(x.root.id,"panel","Adventure Status",{className:"rpg-top",anchor:{h:"left",v:"top",offsetX:20,offsetY:20},style:{display:"flex",flexDirection:"column",gap:"6px",padding:"16px 20px",width:"300px"}});p(D,"text","Game Brand",{text:"CUBE RPG",css:"letter-spacing: 3px;",style:{fontSize:"11px",fontWeight:"800",color:"#51727E"}});const _e=p(D,"text","Arena Name",{text:K[0],style:{fontSize:"24px",fontWeight:"900",color:"#233E4A"}});m(_e,"text","RpgArena == 1 ? 'Petal Courtyard' : (RpgArena == 2 ? 'Amethyst Keep' : 'Sun Crown')");const we=p(D,"text","Health & Level",{text:"♥ 100 / 100  ·  LV 1",style:{fontSize:"15px",color:"#A34E4D",fontWeight:"800"}});m(we,"text","'♥ ' + RpgHealth + ' / 100   ·   LV ' + RpgLevel");const ke=p(D,"text","Arena Objective",{style:{fontSize:"13px",color:"#476C77",whiteSpace:"normal"}});m(ke,"text","RpgEnemies > 0 ? ('Defeat ' + RpgEnemies + ' grumbles to open the gate') : 'Arena clear! Follow the golden arch →'");const Re=p(D,"text","Loot Total",{style:{fontSize:"12px",color:"#8C701F"}});m(Re,"text","'✦ ' + RpgCoins + ' gold   ·   ARENA ' + RpgArena + ' / 3'");const ae=p(x.root.id,"text","Combo Counter",{text:"COMBO ×2",className:"rpg-combo",anchor:{h:"center",v:"middle",offsetX:0,offsetY:-150},style:{fontSize:"30px",fontWeight:"900",color:"#FFF6D8"}});m(ae,"text","RpgCombo >= 3 ? 'FINISHER!' : ('COMBO ×' + RpgCombo)"),m(ae,"visible","RpgCombo >= 2 && RpgMenu == false && RpgDefeated == false && RpgVictory == false");const oe=p(x.root.id,"panel","Equipment & Abilities",{className:"rpg-actions",anchor:{h:"center",v:"bottom",offsetX:0,offsetY:24},style:{display:"flex",gap:"8px",padding:"10px",alignItems:"stretch",maxWidth:"94%"}});m(oe,"visible","RpgStarted && RpgMenu == false && RpgDefeated == false && RpgVictory == false");for(const[e,t,n,i]of[["Sword Equipment","Sword · 1","CubeSword","RpgSword ? '⚔ Sword · 1' : 'Equip sword · 1'"],["Shield Equipment","Shield · 2","CubeShield","RpgShield ? '◈ Shield · 2' : 'Equip shield · 2'"],["Attack Ability","Slash · J","CubeAttack","RpgCombo > 0 ? ('⚔ Combo ' + RpgCombo + ' / 3') : 'Slash · J'"],["Block Ability","Block · Q","CubeBlock","RpgBlocking ? '◈ Blocking' : 'Block · Q'"],["Potion Ability","Potion · E","CubePotion","'✚ ' + RpgPotions + ' potions · E'"]]){const a=p(oe,"button",e,{text:t,onClickEvent:n,className:"rpg-button rpg-ability"});i&&m(a,"text",i)}const Ce=p(x.root.id,"text","Movement Controls",{text:"WASD move · SPACE jump · click / J ×3 combo · jump + click to slam · hold Q / right click to block",className:"rpg-hints",anchor:{h:"center",v:"bottom",offsetX:0,offsetY:92},style:{color:"#234855",fontSize:"12px",textAlign:"center",maxWidth:"85%",whiteSpace:"normal"}});m(Ce,"visible","RpgMenu == false && RpgDefeated == false && RpgVictory == false");const Se=p(x.root.id,"button","Pause Game",{text:"Pause · P",onClickEvent:"CubePause",className:"rpg-button",anchor:{h:"right",v:"top",offsetX:20,offsetY:20}});m(Se,"visible","RpgStarted && RpgMenu == false && RpgDefeated == false && RpgVictory == false");const F=p(x.root.id,"panel","Start & Pause Menu",{className:"rpg-menu",anchor:{h:"center",v:"middle",offsetX:0,offsetY:0},style:{display:"flex",flexDirection:"column",gap:"16px",padding:"32px",width:"410px",maxWidth:"90%",alignItems:"stretch",textAlign:"center"}});m(F,"visible","RpgMenu && RpgDefeated == false && RpgVictory == false"),p(F,"text","Menu Eyebrow",{text:"THE SKYWARD TRIALS",css:"letter-spacing: 3px;",style:{fontSize:"11px",fontWeight:"800",color:"#638079"}});const xe=p(F,"text","Menu Title",{text:"Little cube. Big adventure.",css:"line-height: 1.06;",style:{fontSize:"38px",fontWeight:"900",whiteSpace:"normal",color:"#233E4A"}});m(xe,"text","RpgStarted ? 'Take a breather.' : 'Little cube. Big adventure.'"),p(F,"text","How to Play",{text:"Chain three slashes into a spinning finisher, or jump and attack to slam the ground. A pink warning means a grumble is committed: block, step away, or break it with a finisher or slam. Potions heal 45 health.",css:"line-height: 1.6;",style:{fontSize:"14px",whiteSpace:"normal",color:"#4C6B76"}}),p(F,"text","Menu Controls",{text:`WASD move · Space jump · Shift sprint
Click / J ×3 combo · Jump + click ground slam
Hold Q / right click block · E / 3 potion · P pause`,css:"line-height: 1.7; white-space: pre-line;",style:{fontSize:"12px",color:"#527178"}});const $e=p(F,"button","Start or Resume",{text:"Begin adventure →",onClickEvent:"CubeResume",className:"rpg-button rpg-primary"});m($e,"text","RpgStarted ? 'Resume adventure →' : 'Begin adventure →'");const Ge=p(F,"button","Restart Run",{text:"Restart from arena 1",onClickEvent:"CubeRestart",className:"rpg-button"});m(Ge,"visible","RpgStarted");for(const e of[!1,!0]){const t=p(x.root.id,"panel",e?"Victory Menu":"Defeat Menu",{className:"rpg-menu",anchor:{h:"center",v:"middle",offsetX:0,offsetY:0},style:{display:"flex",flexDirection:"column",gap:"18px",padding:"32px",width:"380px",maxWidth:"90%",textAlign:"center"}});m(t,"visible",e?"RpgVictory":"RpgDefeated"),p(t,"text",e?"Victory Title":"Defeat Title",{text:e?"The crown is yours!":"A brave little cube.",style:{fontSize:"30px",fontWeight:"900",color:"#233E4A"}});const n=p(t,"text",e?"Victory Loot":"Retry Hint",{text:"Try holding your shield when the pink sparks appear. Save a potion for King Grumble.",css:"line-height: 1.6;",style:{fontSize:"14px",color:"#527178",whiteSpace:"normal"}});e&&m(n,"text","'Three arenas conquered · Level ' + RpgLevel + ' · ' + RpgCoins + ' gold collected'"),p(t,"button",e?"Play Again":"Try Again",{text:e?"Play again →":"Try again →",onClickEvent:"CubeRestart",className:"rpg-button rpg-primary"})}return o.updateUIDocument(S,{css:`
.cube-rpg-hud { font-family: ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; }
.rpg-top, .rpg-actions { background: rgba(255,249,232,.94); border: 1px solid rgba(255,255,255,.95); border-radius: 18px; box-shadow: 0 8px 28px rgba(30,66,77,.15); }
.rpg-menu { background: linear-gradient(145deg,#fff9e8,#e2f3e7); border: 2px solid #fffdf0; border-radius: 26px; box-shadow: 0 24px 80px rgba(27,57,70,.3); pointer-events: auto; z-index: 20; }
.rpg-button { border: 1px solid #e0e8d9; border-radius: 12px; padding: 11px 15px; color: #2d525a; background: #f7faef; font-weight: 800; font-size: 13px; cursor: pointer; pointer-events: auto; box-shadow: 0 3px 0 rgba(42,83,87,.1); }
.rpg-button:hover { background: #fff0c9; transform: translateY(-1px); }
.rpg-button:focus-visible { outline: 3px solid #327F91; outline-offset: 3px; }
.rpg-primary { background: #ffd478; border-color: #f4c363; color: #5c491f; padding: 14px 18px; }
.rpg-combo { text-shadow: 0 3px 0 #C2683F, 0 6px 18px rgba(80,40,20,.45); letter-spacing: 2px; animation: rpg-combo-pop .18s ease-out; }
@keyframes rpg-combo-pop { from { transform: scale(1.35); opacity: .4; } to { transform: scale(1); opacity: 1; } }
.rpg-hints { background: rgba(255,249,232,.82); border-radius: 20px; padding: 7px 14px; }
@media (max-width: 640px) { .rpg-top { width: 240px !important; box-sizing: border-box; padding: 10px 14px !important; } .rpg-ability { padding: 9px 8px !important; font-size: 11px !important; } .rpg-actions { gap: 4px !important; padding: 6px !important; flex-wrap: wrap; justify-content: center; bottom: 154px !important; } .rpg-hints { display: none !important; } .rpg-menu { padding: 22px !important; } }
@media (prefers-reduced-motion: reduce) { .rpg-button { transform: none !important; transition: none !important; } .rpg-combo { animation: none !important; } }
`}),o.selectObject(u),u}export{Ee as createCubeRpgTemplate};
