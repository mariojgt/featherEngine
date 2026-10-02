import{u as E,M as ie,V as Y,k as re,Q as ce,E as pe,s as de}from"./player-dqmRFcaI.js";const V=["#223d35","#315442","#45624b","#233a38","#57655c","#8a9380","#b6b296","#423e39","#203e49","#34707a","#6aa7a3","#1c302b","#33563a","#537449","#8c9a61","#caab64","#42bcca","#df686a","#ede1b2","#192936"],D=[[[28,0,28],[30,0,18],[30,0,-18],[22,0,-30],[-18,0,-30],[-28,0,-28]],[[28,0,28],[20,0,20],[10,0,10],[-10,0,-10],[-20,0,-20],[-28,0,-28]],[[28,0,28],[18,0,30],[-18,0,30],[-30,0,22],[-30,0,-18],[-28,0,-28]]],fe=[[30,0,7],[13,0,13],[7,0,30]];function t(e,n,u,d,M=[0,0,0]){return{id:`piece-${Math.random().toString(36).slice(2)}`,name:e,shape:e,position:n,scale:u,colorSlot:d,rotation:M,collider:"none"}}function C(e,n,u=V,d,M=[0,0,0]){const f=E.getState(),c=[],y=new ie,G=new Y;for(const s of n){const p=re(s,{finish:"flat",bevel:0}),h=p.getAttribute("position"),k=p.getIndex();let m=[...c].reverse().find(g=>g.slot===s.colorSlot&&g.vertices.length+h.count<8e3&&g.indices.length+(k?.count??h.count)<48e3);m||(m={slot:s.colorSlot,vertices:[],indices:[]},c.push(m)),y.compose(new Y(...s.position),new ce().setFromEuler(new pe(...s.rotation)),new Y(...s.scale));const b=m.vertices.length;for(let g=0;g<h.count;g++)G.fromBufferAttribute(h,g).applyMatrix4(y),m.vertices.push([G.x,G.y,G.z]);for(let g=0;g<(k?.count??h.count);g++)m.indices.push(b+(k?k.getX(g):g))}const l=f.createModelSpec("blank",e);f.updateModelSpec(l,{palette:u,style:{finish:"flat",bevel:0,roughness:.86},parts:c.map(({slot:s,vertices:p,indices:h},k)=>{const m=[1/0,1/0,1/0],b=[-1/0,-1/0,-1/0];for(const I of p)for(let v=0;v<3;v++)m[v]=Math.min(m[v],I[v]),b[v]=Math.max(b[v],I[v]);const g=m.map((I,v)=>(I+b[v])/2),$=m.map((I,v)=>Math.max(.001,b[v]-I));return{...t("mesh",g,$,s),name:`${e} · pigment ${s+1}/${k}`,mesh:{vertices:p.map(I=>I.map((v,S)=>(v-g[S])/$[S])),indices:h}}})});const o=f.createObjectWithProps("empty",{name:e,parentId:d,position:M});return E.setState(s=>({scenes:s.scenes.map(p=>p.id===s.activeSceneId?{...p,objects:p.objects.map(h=>h.id===o?{...h,model:{enabled:!0,specId:l}}:h)}:p)})),o}function me(e){const n=E.getState(),u=[],d=(...l)=>u.push(t(...l));d("box",[0,-1.3,0],[88,2.3,88],3),d("box",[0,-.25,0],[86,.5,86],0);for(let l=-38;l<=38;l+=9)for(let o=-38;o<=38;o+=9)d("cylinder",[l,.035,o],[12,.06,11],Math.abs(l+o)%3+0,[0,l*o%6,0]);d("box",[0,.02,0],[9,.12,108],8,[0,-Math.PI/4,0]),d("box",[0,.09,0],[6.6,.1,108],9,[0,-Math.PI/4,0]);for(let l=-32;l<=32;l+=5)d("box",[l,.15,-l+1],[2.7,.04,.15],10,[0,-.3,0]);for(let l=0;l<3;l++){const o=D[l];for(let s=1;s<o.length;s++){const p=o[s-1],h=o[s],k=h[0]-p[0],m=h[2]-p[2],b=Math.hypot(k,m),g=Math.atan2(k,m);d("box",[(p[0]+h[0])/2,.12,(p[2]+h[2])/2],[7,.2,b+1],7,[0,g,0]),d("box",[(p[0]+h[0])/2,.24,(p[2]+h[2])/2],[6.1,.16,b+.5],4,[0,g,0]);for(let $=1;$<b;$+=3){const I=p[0]+k*$/b,v=p[2]+m*$/b;for(const S of[-1,1])d("box",[I+Math.cos(g)*S*1.55,.34,v-Math.sin(g)*S*1.55],[2.8,.08,2.6],(Math.floor($)+l)%3===0?6:5,[0,g+S*.015,0])}}}for(const l of[1,-1]){const o=l*30,s=l===1?16:17;d("cylinder",[o,.25,o],[17,.5,17],7),d("cylinder",[o,.5,o],[15,.4,15],5),d("cylinder",[o,.73,o],[11,.1,11],4),d("torus",[o,.83,o],[8,8,.12],s,[Math.PI/2,0,0]);for(let p=0;p<8;p++){const h=p*Math.PI/4;d("box",[o+Math.cos(h)*6,.78,o+Math.sin(h)*6],[1.5,.13,1.5],6,[0,-h,0]),p%2===0&&(d("hexprism",[o+Math.cos(h)*8,1.3,o+Math.sin(h)*8],[1.5,2.3,1.5],4),d("pyramid",[o+Math.cos(h)*8,2.7,o+Math.sin(h)*8],[1.9,.8,1.9],15))}}for(let l=0;l<3;l++)for(let o=0;o<34;o++){const s=D[l],p=1+o%(s.length-1),h=s[p-1],k=s[p],m=(Math.floor(o/(s.length-1))+.4)/7,b=k[0]-h[0],g=k[2]-h[2],$=Math.hypot(b,g),I=o%2?1:-1,v=h[0]+b*m/$*$+g/$*3.7*I,S=h[2]+g*m/$*$-b/$*3.7*I;d("hexprism",[v,.3,S],[.5+o%3*.2,.55,.7],o%3===0?5:4,[.12,o*.7,.1]),d("cone",[v+.5,.32,S-.3],[.4,.8,.4],13,[0,o,0])}C("Rift · River, three lanes and citadel terraces",u,V,e);let M=147;const f=()=>(M=M*1664525+1013904223>>>0,M/4294967296),c=[],y=(l,o,s)=>{c.push(t("hexprism",[l,s*.3,o],[.55,s*.6,.55],7));for(let p=0;p<3;p++)c.push(t("cone",[l,s*(.48+p*.17),o],[s*(.62-p*.12),s*.55,s*(.62-p*.12)],11+p));c.push(t("cone",[l,s*.96,o],[s*.21,s*.29,s*.21],14))};for(const[l,o]of[[16,-3],[3,-16],[-16,3],[-3,16],[19,5],[5,19],[-19,-5],[-5,-19]]){for(let p=0;p<6;p++){const h=p*2.4,k=1.3+f()*3.3;y(l+Math.cos(h)*k,o+Math.sin(h)*k,4.4+f()*2.3)}const s=n.createObjectWithProps("cube",{name:"Jungle · Impassable grove",position:[l,1,o],parentId:e});n.updateTransform(s,"scale",[5,2,5]),n.updatePhysics(s,{enabled:!0,bodyType:"fixed",collider:"box"}),n.updateRenderer(s,{hideInPlay:!0})}for(const[l,o]of[[21,-2],[-2,21],[-21,2],[2,-21]]){c.push(t("hexprism",[l,1.7,o],[.65,3.4,.65],7));for(let s=0;s<5;s++){const p=s*2.4;c.push(t("hexprism",[l+Math.cos(p)*1.15,3.2+s%2*.8,o+Math.sin(p)*1.15],[2.8,1.4,2.8],12+s%3,[.1,p,.1]))}}for(let l=0;l<44;l++){const o=l%4,s=-39+Math.floor(l/4)*7.6;y(o<2?o===0?-40:40:s,o<2?s:o===2?-40:40,5+f()*3)}for(let l=0;l<60;l++){const o=(f()-.5)*76,s=(f()-.5)*76;Math.abs(o-s)<6||Math.abs(Math.abs(o)-30)<5||Math.abs(Math.abs(s)-30)<5||Math.hypot(o-30,s-30)<11||Math.hypot(o+30,s+30)<11||(c.push(t("hexprism",[o,.45,s],[1+f()*1.6,1+f(),1+f()*1.8],4,[.15,f()*5,.2])),c.push(t("cone",[o+1,.35,s+.6],[.7,.8,.7],13)))}C("Rift · Ancient pines, moss and river stones",c,V,e);const G=[];for(const[l,o]of[[18,-18],[-18,18]]){G.push(t("cylinder",[l,.23,o],[8,.4,8],7),t("torus",[l,.49,o],[6,6,.3],15,[Math.PI/2,0,0]));for(let s=0;s<6;s++){const p=s*Math.PI/3;G.push(t("hexprism",[l+Math.cos(p)*4,1,o+Math.sin(p)*4],[.8,2,.8],5))}G.push(t("pyramid",[l,1.3,o],[1.8,2.5,1.8],16),t("pyramid",[l,3,o],[1.8,1.3,1.8],10,[Math.PI,0,0]))}for(const[l,o]of[[7,-7],[-7,7],[28,0],[0,28],[-28,0],[0,-28]])G.push(t("hexprism",[l,1,o],[.55,2,.55],7),t("pyramid",[l,2.3,o],[1.1,.7,1.1],15),t("sphere",[l,2.7,o],[.45,.65,.45],18));C("Rift · Jungle shrines and crossing lanterns",G,V,e)}const R=[{id:1,name:"Aegis",role:"TANK",title:"The oathkeeper",color:"#6eabc1",hp:520,damage:32,reach:2.8,pace:6,cadence:.65,q:"Bulwark",qDescription:"Slam nearby enemies and restore your health.",r:"Unbroken",description:"Heavy armor · close combat · self healing",weapon:"hammer"},{id:2,name:"Briar",role:"JUNGLER",title:"The wild blade",color:"#86b66b",hp:340,damage:46,reach:2.7,pace:7.8,cadence:.48,q:"Fang rush",qDescription:"A quick cleave for heavy damage around you.",r:"Wild hunt",description:"Fast movement · burst damage · short cooldowns",weapon:"blades"},{id:3,name:"Lyra",role:"MID / MAGE",title:"The starweaver",color:"#a391d1",hp:290,damage:29,reach:8,pace:6.4,cadence:.85,q:"Astral bloom",qDescription:"Blast the area around your cursor, within 12 metres.",r:"Supernova",description:"Ranged magic · area control · fragile",weapon:"staff"},{id:4,name:"Kestrel",role:"RANGED CARRY",title:"The dusk ranger",color:"#cfab67",hp:310,damage:42,reach:8.5,pace:6.8,cadence:.6,q:"Piercing volley",qDescription:"Strike all enemies around your attack target.",r:"Arrow storm",description:"Long range · steady damage · evasive dash",weapon:"bow"},{id:5,name:"Sera",role:"SUPPORT",title:"The dawn herald",color:"#6ccbbb",hp:360,damage:23,reach:6.5,pace:6.5,cadence:.8,q:"Daybreak",qDescription:"Heal nearby allies while damaging enemies.",r:"Sanctuary",description:"Team healing · ranged attacks · group protection",weapon:"lantern"}];function he(e,n,u=!1){const d=E.getState(),M=["#15252c","#3d5460",n.color,"#d4bc80","#eee4cc","#66d8e3",u?"#d76875":n.color,"#172931"],f=(m,b,g)=>d.createObjectWithProps("empty",{name:`${n.name} · ${m}`,position:b,parentId:g}),c=f("Animated rig",[0,.38,0],e),y=n.id===1?1.22:n.id===2?.91:1,G=[t("hexprism",[0,1.2,0],[.9*y,.87,.62],6),t("hexprism",[0,1.02,.19],[.65*y,.62,.32],1),t("box",[0,.79,0],[.83*y,.15,.65],3),t("pyramid",[0,1.46,.4],[.27,.32,.12],3,[Math.PI,0,0]),t("capsule",[0,1.98,0],[.57,.53,.54],4)];n.id===1||n.id===4?G.push(t("hexprism",[0,2.06,0],[.7,.63,.67],1),t("box",[0,2.06,.36],[.51,.09,.04],5),t("wedge",[0,2.49,0],[.18,.5,.7],3)):n.id===2?G.push(t("cone",[0,2.13,-.03],[.79,.8,.77],6),t("box",[0,1.97,.29],[.44,.12,.08],0),t("cone",[-.29,2.36,-.05],[.22,.55,.24],4,[0,0,.3]),t("cone",[.29,2.36,-.05],[.22,.55,.24],4,[0,0,-.3])):G.push(t("cone",[0,2.2,0],[.77,.6,.75],6),t("torus",[0,2.2,0],[.8,.8,.07],3,[Math.PI/2,0,0]),t("box",[0,1.91,.3],[.29,.07,.03],0)),G.push(t("wedge",[0,1.03,-.46],[.95,1.25,.22],6,[.15,Math.PI,0]));for(const m of[-1,1])G.push(t("hexprism",[m*.61*y,1.59,0],[.56*y,.4,.66],n.id===1?3:6,[0,0,m*.22]));C(`${n.name} · Armor and mantle`,G,M,c);const l=f("Weapon shoulder",[.58*y,1.5,0],c),o=f("Guard shoulder",[-.58*y,1.5,0],c),s=[t("capsule",[0,-.26,0],[.29,.66,.3],1),t("hexprism",[0,-.55,.08],[.33,.3,.35],3)],p=[...s];n.weapon==="hammer"&&p.push(t("cylinder",[0,-.38,.56],[.12,1.2,.12],7,[Math.PI/2,0,0]),t("hexprism",[0,-.37,1.1],[.78,.55,.6],1),t("box",[0,-.37,1.42],[.51,.3,.06],5)),n.weapon==="blades"&&p.push(t("wedge",[0,-.46,.8],[.14,.36,1.3],4,[0,0,Math.PI]),t("box",[0,-.44,.36],[.53,.08,.1],3)),(n.weapon==="staff"||n.weapon==="lantern")&&p.push(t("cylinder",[0,-.1,.4],[.1,2.4,.1],3),t("torus",[0,1.15,.4],[.7,.85,.09],3),t("pyramid",[0,1.18,.4],[.33,.65,.33],5),t("pyramid",[0,1.57,.4],[.33,.25,.33],5,[Math.PI,0,0])),n.weapon==="bow"&&p.push(t("box",[0,-.3,.8],[.12,1.5,.13],3,[.3,0,0]),t("box",[0,-.3,1.05],[.025,1.4,.025],4),t("cone",[0,-.3,1.25],[.1,.75,.1],5,[Math.PI/2,0,0])),C(`${n.name} · ${n.weapon}`,p,M,l);const h=[...s];n.id===1&&h.push(t("hexprism",[-.13,-.29,.28],[.25,1.2,.95],6,[0,0,.15]),t("hexprism",[-.27,-.28,.28],[.06,.8,.65],3)),n.id===2&&h.push(t("wedge",[0,-.45,.65],[.14,.32,1],4)),C(`${n.name} · Off hand`,h,M,o);const k=[-1,1].map(m=>{const b=f(m===-1?"Left hip":"Right hip",[m*.24,.7,0],c);return C(`${n.name} · Greave`,[t("capsule",[0,-.22,0],[.31,.55,.35],1),t("box",[0,-.52,.16],[.37,.25,.59],0),t("hexprism",[0,-.34,.1],[.34,.29,.37],3)],M,b),b});return{rig:c,arm:l,offarm:o,leg:k[0],leg2:k[1]}}const j=4,te=500,Le=.7,K=e=>Math.floor(e*(Le*100)/100);function N(e,n){return`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="10" fill="#10252c"/><circle cx="32" cy="32" r="25" fill="${e}" opacity=".1"/><g stroke-linecap="round" stroke-linejoin="round">${n}</g></svg>`)}`}const H=[{id:1,label:"Ironfang Blade",description:"+16 attack damage",cost:300,colors:{accent:"#e0ae81",background:"#302921"},bonuses:{damage:16},icon:N("#e0ae81",'<path d="m23 38 5-13L51 11l-9 25-14 7z" fill="#dde8dc" stroke="#e0ae81" stroke-width="2"/><path d="m28 38 17-20" stroke="#7a999b" stroke-width="2"/><path d="m18 34 14 14M24 42l-9 10" stroke="#d6b571" stroke-width="5"/><path d="m11 49 6 6" stroke="#e0ae81" stroke-width="4"/>')},{id:2,label:"Starglass Tome",description:"+35 spell power",cost:300,colors:{accent:"#c4adf2",background:"#29253d"},bonuses:{spell_power:35},icon:N("#c4adf2",'<path d="M17 15h30v36H20q-6 0-6-6V21q0-6 6-6" fill="#53496e" stroke="#c4adf2" stroke-width="2"/><path d="M21 15v29m-6 2h32" stroke="#ddcea4" stroke-width="2"/><path d="m34 21 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#d9d0ff"/><path d="m50 9 1 4 4 1-4 1-1 4-1-4-4-1 4-1z" fill="#c4adf2"/>')},{id:3,label:"Warden Mail",description:`+180 max health · +6 armor
Blocks 6 damage from each basic attack.`,cost:350,colors:{accent:"#91c4d5",background:"#20343d"},bonuses:{max_hp:180,armor:6},icon:N("#91c4d5",'<path d="m23 13-12 9 5 12 6-3-3 21h26l-3-21 6 3 5-12-12-9q-9 10-18 0z" fill="#4a6976" stroke="#91c4d5" stroke-width="2"/><path d="m22 24 10 6 10-6-3 19-7 6-7-6z" fill="#203943" stroke="#d5c28b" stroke-width="2"/><path d="M32 30v14m-7-8h14" stroke="#91c4d5" stroke-width="2"/>')},{id:4,label:"Windrunner Boots",description:"+1.2 movement speed",cost:250,colors:{accent:"#9ed4b0",background:"#20382d"},bonuses:{pace:1.2},icon:N("#9ed4b0",'<path d="m29 13 16 3-6 23 12 7v6H22v-9l5-13z" fill="#4d7865" stroke="#9ed4b0" stroke-width="2"/><path d="m27 22 15 3m-17 6 14 3M22 48h29" stroke="#dfcc92" stroke-width="3"/><path d="M10 21h10M7 29h11m-6 8h6" stroke="#9ed4b0" stroke-width="2"/>')},{id:5,label:"Quicksteel Bow",description:`+25% attack speed
Basic attacks fire 25% faster.`,cost:400,colors:{accent:"#e4c67f",background:"#373021"},bonuses:{attack_speed:.25},icon:N("#e4c67f",'<path d="M20 10q44 22 0 44" fill="none" stroke="#e4c67f" stroke-width="4"/><path d="m20 10 8 22-8 22" fill="none" stroke="#d5e4df" stroke-width="1.5"/><path d="M12 32h40m-8-6 8 6-8 6" fill="none" stroke="#d5e4df" stroke-width="2"/><path d="m12 27 6 5-6 5" fill="none" stroke="#e4c67f" stroke-width="2"/>')},{id:6,label:"Dawnstone Charm",description:"+80 max health · +20 spell power",cost:350,colors:{accent:"#7cddd1",background:"#203b38"},bonuses:{max_hp:80,spell_power:20},icon:N("#7cddd1",'<path d="M21 11q0 17 11 18 11-1 11-18" fill="none" stroke="#d8bd78" stroke-width="3"/><circle cx="32" cy="37" r="16" fill="#2b625d" stroke="#d8bd78" stroke-width="2"/><path d="m32 24 9 13-9 14-9-14z" fill="#7cddd1"/><path d="m32 24 2 13-2 14-3-14z" fill="#d8fff0"/><path d="M12 38H8m48 0h-4M32 58v-3" stroke="#d8bd78" stroke-width="2"/>')}];function ge(e,n){const u=E.getState(),d="LLPlaying && !LLIntro && !LLDone && !LLPaused",M=`(${d}) && LLAtBase && LLHealth > 0`,f=(a,r,i,L,x)=>{const w=u.addUIElement(e,a,r);return u.updateUIElement(e,w,{name:i,style:{},states:{},...L}),x&&u.setUIBinding(e,w,"visible",x),w},c=(a,r,i,L,x)=>{const w=f(a,"text",r,{text:i,className:L});return x&&u.setUIBinding(e,w,"text",x),w},y=(a,r,i,L,x,w)=>f(a,"button",r,{text:i,className:x,onClickEvent:L},w),G=f(n,"panel","Gold and four-slot inventory",{className:"ll-shop-hud"},`${d} && !LLShopOpen`),l=f(G,"panel","Gold and shop access",{className:"ll-shop-wallet"});c(l,"Gold balance","","ll-shop-gold","LLGold + ' gold'"),y(l,"Open item shop (P)","Shop  [P]","LLShopToggle","ll-shop-button ll-shop-access");const o=c(G,"Earned gold feedback","","ll-shop-income","LLIncomeMessage");u.setUIBinding(e,o,"visible","LLIncomeTime > 0 && LLIncomeMessage != ''");const s=f(G,"panel","Inventory slots",{className:"ll-shop-inventory"}),p=f(s,"panel","Four empty slot outlines",{className:"ll-shop-slots"});for(let a=1;a<=j;a++)c(p,`Slot ${a}`,`${a}`,"ll-shop-slot");const h=f(s,"panel","Owned items",{className:"ll-shop-owned"});for(const a of H)y(h,`${a.label} · open shop to sell`,a.label,"LLShopToggle",`ll-shop-inventory-item ll-shop-icon-${a.id}`,`LLOwned${a.id}`);c(G,"Inventory capacity","","ll-shop-capacity",`LLInventoryCount + ' / ${j} items  ·  one of each'`);const k=f(n,"panel","Item shop overlay",{className:"ll-shop-overlay"},`${d} && LLShopOpen`),m=f(k,"panel","Astral armory",{className:"ll-shop-modal"}),b=f(m,"panel","Shop heading",{className:"ll-shop-header"}),g=f(b,"panel","Shop identity",{className:"ll-shop-heading"});c(g,"Shop eyebrow","THE ASTRAL RIFT / ITEM SHOP","ll-shop-eyebrow"),c(g,"Shop title","The Astral Armory","ll-shop-title"),y(b,"Close item shop (P)","Close  ×","LLShopClose","ll-shop-button ll-shop-close");const $=f(m,"panel","Shop balance and capacity",{className:"ll-shop-balance"});c($,"Available gold","","ll-shop-gold ll-shop-gold-large","LLGold + ' gold'"),c($,"Carried items","","ll-shop-counter",`LLInventoryCount + ' / ${j} slots occupied'`);const I=c($,"Recent gold earned","","ll-shop-income","LLIncomeMessage");u.setUIBinding(e,I,"visible","LLIncomeTime > 0 && LLIncomeMessage != ''");const v=c(m,"Trade availability","","ll-shop-location","LLHealth <= 0 ? 'Browse while respawning. Buy and sell once alive at base.' : !LLAtBase ? 'Browse anywhere. Close shop and press B to recall, then buy or sell at base.' : 'At base · Buy and sell here. The match keeps running while you shop.'");u.setUIBinding(e,v,"color","LLAtBase && LLHealth > 0 ? '#91d9c3' : '#e5c88a'");const S=c(m,"Shop transaction message","","ll-shop-message","LLShopMessage");u.setUIBinding(e,S,"visible","LLShopMessage != ''"),c(m,"Gold income rules","500 starting gold · +2 gold / second · Minions +25 · Heroes / towers +150 · Jungle +100","ll-shop-footnote"),c(m,"Equipped champion stats","","ll-shop-stats","'ATTACK ' + LLTotalDamage + '   /   SPELL ' + LLTotalSpellPower + '   /   ARMOR ' + LLTotalArmor + '   /   SPEED ' + (LLTotalSpeed * 10 - LLTotalSpeed * 10 % 1) / 10");const _=f(m,"panel","Six available items",{className:"ll-shop-cards"});for(const a of H){const r=`LLOwned${a.id}`,i=`LLInventoryCount >= ${j}`,L=f(_,"panel",a.label,{className:"ll-shop-card"});u.setUIBinding(e,L,"background",`${r} ? '${a.colors.background}' : '#142930'`);const x=f(L,"panel",`${a.label} heading`,{className:"ll-shop-item-heading"});f(x,"panel",`${a.label} icon`,{className:`ll-shop-item-icon ll-shop-icon-${a.id}`});const w=f(x,"panel",`${a.label} identity`,{className:"ll-shop-item-identity"});c(w,`${a.label} name`,a.label,"ll-shop-item-name"),c(w,`${a.label} price`,`${a.cost} gold`,"ll-shop-price"),c(L,`${a.label} stats`,a.description,"ll-shop-description");const B=c(L,`${a.label} availability`,"","ll-shop-item-status",`${r} ? 'Owned · one per champion' : ${i} ? 'Inventory full · sell an item first' : LLGold < ${a.cost} ? 'Need ' + (${a.cost} - LLGold) + ' more gold' : LLHealth <= 0 ? 'Available after respawn at base' : !LLAtBase ? 'Available to buy at base' : 'Ready to equip'`);u.setUIBinding(e,B,"color",`${r} ? '#91d9c3' : (${i} || LLGold < ${a.cost}) ? '#efb0a6' : '#acbfbb'`);const O=f(L,"panel",`${a.label} actions`,{className:"ll-shop-item-actions"}),P=y(O,`Buy ${a.label}`,`Buy · ${a.cost} gold`,`LLBuy${a.id}`,"ll-shop-button ll-shop-buy");u.setUIBinding(e,P,"disabled",`!(${M}) || ${r} || ${i} || LLGold < ${a.cost}`),u.setUIBinding(e,P,"text",`${r} ? 'Owned' : ${i} ? 'Inventory full' : LLGold < ${a.cost} ? 'Insufficient gold' : 'Buy · ${a.cost} gold'`);const U=y(O,`Sell ${a.label}`,`Sell · ${K(a.cost)} gold`,`LLSell${a.id}`,"ll-shop-button ll-shop-sell",r);u.setUIBinding(e,U,"disabled",`!(${M}) || !${r}`)}c(m,"Inventory rules","4 different items maximum · 1 of each · Sell for 70% of the purchase price, rounded down.","ll-shop-footnote"),c(m,"Shop controls","P opens / closes · Esc closes · Close shop and press B to recall · Match keeps running.","ll-shop-footnote")}const ue=`
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
${H.map(e=>`.ll-shop-icon-${e.id}{background-image:url("${e.icon}")}`).join(`
`)}
@media(max-width:1100px){.ll-shop-hud{left:12px;bottom:215px;width:190px}}
@media(max-width:700px){.ll-shop-overlay{padding:10px}.ll-shop-modal{padding:16px;gap:11px}.ll-shop-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ll-shop-title{font-size:27px}.ll-shop-card{padding:11px}.ll-shop-item-heading{gap:7px}.ll-shop-item-icon{width:38px;height:38px}.ll-shop-item-name{font-size:12px}.ll-shop-button{min-height:44px}}
@media(max-width:600px){.ll-shop-hud{left:8px;bottom:200px;width:176px;gap:6px;padding:9px}.ll-shop-gold{font-size:20px}.ll-shop-gold-large{font-size:26px}.ll-shop-capacity{font-size:8px}.ll-shop-slots,.ll-shop-owned{gap:4px}.ll-shop-title{font-size:24px}.ll-shop-eyebrow{font-size:8px;letter-spacing:1px}.ll-shop-balance{padding:10px;gap:7px 14px}.ll-shop-counter{font-size:11px}.ll-shop-description{font-size:11px}.ll-shop-close{min-width:70px;padding:9px}.ll-shop-item-heading{flex-wrap:wrap}}
@media(max-width:360px){.ll-shop-cards{grid-template-columns:minmax(0,1fr)}.ll-shop-item-heading{flex-wrap:nowrap}.ll-shop-title{font-size:21px}}
@media(max-height:500px) and (min-width:601px){.ll-shop-hud{bottom:175px;gap:5px;padding:8px;width:184px}.ll-shop-capacity{display:none}.ll-shop-modal{padding:14px}}
`;function be(e,n){const u=['<path d="M43 84V47L64 27 87 47v37l-23 15z" fill="#71868d"/><path d="M47 60h35v10H47z" fill="#112a35"/><path d="M50 64h29" stroke="#a8f4f0" stroke-width="3"/><path d="M61 27V8h7v22" fill="#d8b571"/>',`<path d="M36 89l9-45 19-17 22 17 7 45-29 13z" fill="${n}"/><path d="M46 72V57l18-9 18 9v15l-18 15z" fill="#273c36"/><path d="M48 60l-4-27 13 17m25 10 4-27-13 17" fill="#e0d7ae"/><path d="m50 68 9 2m10 0 9-2" stroke="#e6e4af" stroke-width="3"/>`,`<path d="M44 78V53q20-26 40 0v25l-20 17z" fill="#d7bba0"/><path d="m35 53 29-40 31 40-31-8z" fill="${n}"/><path d="M35 53h60" stroke="#e1bc75" stroke-width="5"/><path d="M55 69h4m11 0h4" stroke="#383343" stroke-width="3"/>`,`<path d="M39 84V44l25-19 26 19v40L64 97z" fill="#586f76"/><path d="m41 49 23-11 23 11-23 14z" fill="${n}"/><path d="M47 63h35v12H47z" fill="#163036"/><path d="M50 69h29" stroke="#eccd80" stroke-width="3"/>`,`<path d="M42 78V49q22-29 44 0v29L64 98z" fill="#d7bba0"/><path d="m36 51 28-36 28 36-28-8z" fill="${n}"/><circle cx="64" cy="29" r="7" fill="#f2d993"/><path d="M51 65h7m12 0h7" stroke="#254c50" stroke-width="3"/>`],d=e===1?'<path d="M99 145V69" stroke="#bd9c62" stroke-width="7"/><path d="M87 58h27v24H87z" fill="#9caaa4"/>':e===2?'<path d="m11 137 12-49 7 50m68 0 7-50 12 49" fill="#e9e4c8"/>':e===4?'<path d="M108 67q-37 35 0 74M108 67v74" fill="none" stroke="#d3b270" stroke-width="4"/>':'<path d="M105 145V67" stroke="#caaa73" stroke-width="4"/><circle cx="105" cy="58" r="14" fill="none" stroke="#caaa73" stroke-width="4"/><path d="m105 44 8 14-8 14-8-14z" fill="#a8e8eb"/>';return`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="168" viewBox="0 0 128 168"><defs><radialGradient id="g"><stop stop-color="${n}" stop-opacity=".4"/><stop offset="1" stop-color="#111f27"/></radialGradient></defs><rect width="128" height="168" fill="url(#g)"/><circle cx="64" cy="72" r="48" fill="none" stroke="${n}" stroke-opacity=".35"/><path d="M18 166 28 107 51 94h26l23 13 11 59" fill="${n}"/><path d="m28 110-14 24 28 10 9-40m49 6 14 24-28 10-9-40" fill="#53636b"/><path d="m51 98 13 25 13-25v63H51z" fill="#20333c"/><path d="m57 113 7-8 7 8-7 13z" fill="#d4b56e"/>${u[e-1]}${d}</svg>`)}`}function xe(e){const n=E.getState(),u=n.createFolder("Lumen Lane · Interface"),d=n.createUIDocument("Lumen Lane · Heroes and match HUD","screen",u);n.updateUIDocument(d,{visibleOnStart:!0,renderMode:"dom",css:ve+ue}),n.attachUI(e,d);const M=E.getState().uiDocuments.find(_=>_.id===d).root.id;n.updateUIElement(d,M,{className:"ll-ui",style:{width:"100%",height:"100%",display:"block",padding:"0"},anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0}});const f=(_,a,r,i,L)=>{const x=n.addUIElement(d,_,a);return n.updateUIElement(d,x,{name:r,style:{},states:{},...i}),L&&n.setUIBinding(d,x,"visible",L),x},c=(_,a,r,i="ll-copy",L)=>{const x=f(_,"text",a,{text:r,className:i});return L&&n.setUIBinding(d,x,"text",L),x},y=(_,a,r,i,L="ll-button")=>f(_,"button",a,{text:r,className:L,onClickEvent:i}),G=(_,a,r="")=>f(M,"panel",_,{className:`ll-modal ${r}`,anchor:{h:"center",v:"middle",offsetX:0,offsetY:0}},a),l=G("Hero selection","LLIntro","ll-draft");c(l,"Eyebrow","LUMEN LANE  /  THE ASTRAL RIFT","ll-eyebrow"),c(l,"Title","Choose your champion","ll-title"),c(l,"Match description","Three lanes. Two citadels. Start with 500 gold — open the shop with P.","ll-subtitle");const o=f(l,"panel","Five champions",{className:"ll-heroes"});for(const _ of R){const a=y(o,_.name,`${_.name}
${_.role}`,`LLHero${_.id}`,`ll-hero ll-hero-${_.id}`);n.setUIBinding(d,a,"background",`LLHeroChoice == ${_.id} ? '#c3a567' : '#172b34'`),n.setUIBinding(d,a,"color",`LLHeroChoice == ${_.id} ? '#142329' : '#e4d9bd'`)}c(l,"Chosen champion","","ll-chosen","LLHeroName + '  /  ' + LLHeroRole"),c(l,"Archetype details","","ll-copy",R.map(_=>`LLHeroChoice == ${_.id} ? '${_.description}. ${_.q}: ${_.qDescription}' : `).join("")+"''");const s=y(l,"Enter the Rift","Enter the Rift  →","LLStart","ll-button ll-start");n.setUIBinding(d,s,"text","'Play as ' + LLHeroName + '  →'"),c(l,"Quick controls",`Right-click ground to move · Click an enemy to chase and attack
Q / R aim at cursor · E dash · B recall · S stop · P shop · Esc pause`,"ll-controls"),c(l,"Offline information","SOLO VS AI  ·  TWO ALLIED HEROES  ·  THREE ENEMY HEROES","ll-eyebrow");const p=f(M,"panel","Match HUD",{className:"ll-hud",style:{width:"100%",height:"100%",display:"block"},anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0}},"!LLIntro && !LLDone && !LLPaused && !LLShopOpen"),h=f(p,"panel","Match title",{className:"ll-brand",anchor:{h:"left",v:"top",offsetX:22,offsetY:18}});c(h,"World name","THE ASTRAL RIFT","ll-eyebrow"),c(h,"Objective","Break a tower. Shatter their core.","ll-copy");const k=f(p,"panel","Scoreboard",{className:"ll-score",anchor:{h:"center",v:"top",offsetX:0,offsetY:14}});c(k,"Azure","","ll-mint","'AZURE  ' + LLMintTower + ' / 3' "),c(k,"Clock","","ll-clock","(LLSeconds / 60 - LLSeconds / 60 % 1) + ':' + (LLSeconds % 60 < 10 ? '0' : '') + (LLSeconds % 60 - LLSeconds % 1)"),c(k,"Crimson","","ll-coral","LLCoralTower + ' / 3  CRIMSON'");const m=f(p,"panel","Champion controls",{className:"ll-tray"}),b=f(m,"panel","Champion identity",{className:"ll-identity"});c(b,"Name","","ll-hero-name","LLHeroName"),c(b,"Role","","ll-eyebrow","LLHeroRole");const g=f(m,"panel","Health track",{className:"ll-health"}),$=f(g,"panel","Health fill",{className:"ll-health-fill"});n.setUIBinding(d,$,"width","(LLHealth / LLMaxHealth * 100) + '%' "),c(g,"Health value","","ll-health-number","LLHealth > 0 ? LLHealth + ' / ' + LLMaxHealth : 'RESPAWN IN ' + LLRespawn + 's'");const I=f(m,"panel","Abilities",{className:"ll-actions"});for(const[_,a,r,i]of[["Ability","Q","LLPulse","LLQName"],["Dash","E","LLDash","'Dash'"],["Ultimate","R","LLUltimate","LLRName"],["Recall","B","LLRecall","'Recall'"]]){const L=y(I,_,`${a}
${_}`,r,"ll-button ll-ability");n.setUIBinding(d,L,"text",`'${a}  ·  ' + (${r} > 0 ? ${r} + 's' : ${i})`),n.setUIBinding(d,L,"disabled",`${r} > 0 || LLHealth <= 0`)}c(m,"Next wave","","ll-tray-hint","'WAVE ' + LLWaves + '  ·  NEXT ' + (LLWaveIn - LLWaveIn % 1) + 's     |     RIGHT-CLICK TO MOVE / ATTACK'"),y(b,"Pause","Pause / Esc","LLPause","ll-button ll-small"),ge(d,M);const v=G("Pause menu","LLPaused");c(v,"Pause label","MATCH PAUSED","ll-eyebrow"),c(v,"Pause title","A moment to plan","ll-title"),c(v,"Strategy",`Push behind your minions. Towers target them first. Break any enemy lane tower to expose the crystal core. Open the shop with P. Buy or sell items at base. Gold accrues at 2 per second; takedowns and towers grant more. Jungle sentinels reward 100 gold and return after 30 seconds.

Use B to recall; movement or damage interrupts the channel. Click the minimap for long journeys.`),y(v,"Resume","Return to battle","LLPause"),y(v,"Restart","Restart with this hero","LLStart"),y(v,"Change champion","Choose another champion","LLChooseAgain");const S=G("Match results","LLDone");return c(S,"Result label","THE ASTRAL RIFT","ll-eyebrow"),c(S,"Result","","ll-title","LLWon ? 'Victory' : 'Defeat'"),c(S,"Result copy","","ll-copy","LLWon ? 'The crimson core has fallen. The Rift is yours.' : 'Your citadel has fallen. Regroup and take another lane.'"),y(S,"Play again","Fight again","LLStart"),y(S,"Change champion","Choose another champion","LLChooseAgain"),d}const ve=`
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
${R.map(e=>`.ll-hero-${e.id}::before{background-image:url("${be(e.id,e.color)}")}`).join(`
`)}
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
`,ye={LLGold:te,LLShopOpen:!1,LLInventoryCount:0,LLShopMessage:"Start with 500 gold. Equip an item before heading into a lane.",LLIncomeMessage:"",LLIncomeTime:0,LLTotalDamage:R[0].damage,LLTotalSpellPower:0,LLTotalArmor:0,LLTotalSpeed:R[0].pace,LLTotalCadence:R[0].cadence,...Object.fromEntries(H.map(e=>[`LLOwned${e.id}`,!1]))},_e=`    Game.LLGold = ${te}
    Game.LLShopOpen = false
    Game.LLInventoryCount = 0
    Game.LLShopMessage = "Start with 500 gold. Equip an item before heading into a lane."
    Game.LLIncomeMessage = ""
    Game.LLIncomeTime = 0
    self.income_clock = 0
${H.map(e=>`    Game.LLOwned${e.id} = false`).join(`
`)}`,we=`        Game.LLTotalDamage = self.damage
        Game.LLTotalSpellPower = self.spell_power
        Game.LLTotalArmor = self.armor
        Game.LLTotalSpeed = self.pace
        Game.LLTotalCadence = self.cadence`,ke=`
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
${R.map(e=>`    if Game.LLHeroChoice == ${e.id}:
        self.max_hp = ${e.hp}
        self.damage = ${e.damage}
        self.pace = ${e.pace}
        self.cadence = ${e.cadence}`).join(`
`)}
    self.spell_power = 0
    self.armor = 0
    self.attack_speed = 0
${H.map(e=>`    if Game.LLOwned${e.id}:
${Object.entries(e.bonuses).map(([n,u])=>`        self.${n} = self.${n} + ${u}`).join(`
`)}`).join(`
`)}
    self.cadence = self.cadence / (1 + self.attack_speed)
    self.hp = min(self.max_hp,self.hp + max(0,self.max_hp - self.old_max_hp))
${H.map(e=>`on event LLBuy${e.id}(payload):
    if Game.LLPlaying and Game.LLPaused == false:
        if self.hp <= 0 or distance(position(self),self.home) >= 5:
            Game.LLShopMessage = "Return to base alive to buy or sell. Close the shop and press B to recall."
        else:
            if Game.LLOwned${e.id}:
                Game.LLShopMessage = "You already own ${e.label}. Each item can be bought once."
            else:
                if Game.LLInventoryCount >= ${j}:
                    Game.LLShopMessage = "Inventory full. Sell an item to free a slot."
                else:
                    if Game.LLGold < ${e.cost}:
                        Game.LLShopMessage = "Not enough gold for ${e.label}. Earn gold in the lanes or jungle."
                    else:
                        Game.LLGold = Game.LLGold - ${e.cost}
                        Game.LLOwned${e.id} = true
                        Game.LLInventoryCount = Game.LLInventoryCount + 1
                        Game.LLShopMessage = "Equipped ${e.label}. Your stats have increased."
                        fire_event("LLRebuildItems",target:self)
on event LLSell${e.id}(payload):
    if Game.LLPlaying and Game.LLPaused == false:
        if self.hp <= 0 or distance(position(self),self.home) >= 5:
            Game.LLShopMessage = "Return to base alive to buy or sell. Close the shop and press B to recall."
        else:
            if Game.LLOwned${e.id}:
                Game.LLOwned${e.id} = false
                Game.LLInventoryCount = Game.LLInventoryCount - 1
                Game.LLGold = Game.LLGold + ${K(e.cost)}
                Game.LLShopMessage = "Sold ${e.label} for ${K(e.cost)} gold."
                fire_event("LLRebuildItems",target:self)`).join(`
`)}
`,ae=`blueprint Lumen_Rift_Unit
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
`,Ge=R.map(e=>["rig","arm","offarm","leg","leg2"].map(n=>`var hero${e.id}_${n}: string = ""`).join(`
`)).join(`
`),Me=R.map(e=>`    if Game.LLHeroChoice == ${e.id}:
        self.max_hp = ${e.hp}
        self.hp = ${e.hp}
        self.damage = ${e.damage}
        self.reach = ${e.reach}
        self.pace = ${e.pace}
        self.cadence = ${e.cadence}`).join(`
`),$e=R.map(e=>`on event LLHero${e.id}(payload):
    if Game.LLIntro:
        Game.LLHeroChoice = ${e.id}
        Game.LLHeroName = "${e.name}"
        Game.LLHeroRole = "${e.role}"
        Game.LLQName = "${e.q}"
        Game.LLRName = "${e.r}"
        self.max_hp = ${e.hp}
        self.hp = ${e.hp}
        self.damage = ${e.damage}
        self.reach = ${e.reach}
        self.pace = ${e.pace}
        self.cadence = ${e.cadence}
${R.map(n=>`        set_scale(self.hero${n.id}_rig,vec3(${n.id===e.id?"1,1,1":"0,0,0"}))`).join(`
`)}
${["rig","arm","offarm","leg","leg2"].map(n=>`        self.${n} = self.hero${e.id}_${n}`).join(`
`)}
        Game.LLHealth = self.hp
        Game.LLMaxHealth = self.max_hp
`).join(`
`),Se=`
${Ge}
${ke}
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
${$e}
on event LLResetUnit(payload):
${Me}
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
${we}
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
`,Ie=`blueprint Lumen_Rift_Match
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
${_e}
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
`;async function Ce(){const e=E.getState();for(const a of["obj-player","obj-ground","obj-enemy","obj-light","obj-camera"])de(E.getState()).some(r=>r.id===a)&&e.deleteObject(a);e.renameScene(e.activeSceneId,"Lumen Lane · The Astral Rift"),e.applyRenderPreset(e.activeSceneId,"vibrant-arcade"),e.updateSceneEnvironment(e.activeSceneId,{skyMode:"procedural",backgroundColor:"#223a42",skyTopColor:"#1c334b",skyHorizonColor:"#9bb2ac",skyGroundColor:"#233a36",ambientMode:"hemisphere",ambientIntensity:.85,environmentIntensity:.6,sunColor:"#fff0d2",sunIntensity:2.3,sunAzimuth:215,sunElevation:55,fogEnabled:!0,fogColor:"#536d69",fogNear:58,fogFar:145,toneMapping:"agx",toneMappingExposure:1.15,contactShadows:!1}),e.updateRenderSettings({quality:"High",autoQuality:!0,bloomEnabled:!0,bloomIntensity:.3,bloomThreshold:1,vignetteEnabled:!0});const n=e.createFolder("Lumen Lane · Gameplay"),u=e.createFolder("Lumen Lane · Reusable units"),d=(a,r=[0,0,0],i)=>e.createObjectWithProps("empty",{name:a,position:r,parentId:i}),M=(a,r)=>{for(const[i,L]of Object.entries(r))e.setObjectVariable(a,i,L)},f=(a,r)=>{const{blueprintId:i}=e.createBlueprintNamed(a,"Editable Astral Rift gameplay.",n),L=e.applyBlueprintFeatherSource(i,r.trim());if(!L.ok||L.diagnostics.length)throw Error(`${a}: ${L.diagnostics.map(x=>x.message).join("; ")}`);return i},c={LLIntro:!0,LLPlaying:!1,LLPaused:!1,LLDone:!1,LLWon:!1,LLSeconds:0,LLWaveIn:3,LLWaveBank:1,LLWaves:0,LLHealth:520,LLMaxHealth:520,LLRespawn:0,LLAttack:0,LLPulse:0,LLDash:0,LLUltimate:0,LLRecall:0,LLHeroChoice:1,LLHeroName:"Aegis",LLHeroRole:"TANK",LLQName:"Bulwark",LLRName:"Unbroken",LLMintTower:3,LLCoralTower:3,LLMintCore:1200,LLCoralCore:1200,LLKills:0,...ye,LLAtBase:!0};for(const[a,r]of Object.entries(c)){const i=e.createVariable(a,typeof r=="boolean"?"boolean":typeof r=="string"?"string":"number",!1);e.updateVariable(i,{defaultValue:r})}const y=f("Rift units · Lanes, combat and animation",ae),G=f("Chosen hero · Commands and abilities",ae+Se),l=f("Rift match · Waves and victory",Ie),o=d("Lumen Lane · Match");me(o);const s={mint:"#62dcdb",coral:"#f37f89",dark:"#14262d",gold:"#edd58e",light:"#d1ffff"},p=(a,r,i=0)=>{const L=e.createMaterial(a,"Rift combat material.");return e.updateMaterial(L,{color:r,roughness:.5,emissiveColor:r,emissiveIntensity:i}),L},h={mint:p("Azure energy",s.mint,.7),coral:p("Crimson energy",s.coral,.7),dark:p("Obsidian",s.dark),gold:p("Selection gold",s.gold,.3),flash:p("Spell light",s.light,1.5)},k=(a,r,i,L,x)=>{const w=e.createObjectWithProps("sphere",{name:a,position:r,parentId:x});return e.updateTransform(w,"scale",i),e.setObjectMaterial(w,L),w},m=(a,r,i,L,x=1,w=!1)=>{const B=["#273842","#53636a","#bac4b8",r===1?"#43afbf":"#bb566f","#b69a62","#e6ddac","#182831"],O=w?e.createRoleObject("player",{kind:"empty",name:a,position:L}).objectId:d(a,L,o);w&&(e.updateCharacterController(O,{autoInputWithScript:!1,cameraFollow:!0,mouseLook:!1,cameraRelativeMovement:!1,gravity:0,groundLevel:0,turnInPlace:!1,moveSpeed:7,cameraOffset:[0,2,-26],cameraPitch:.98,cameraMinPitch:.98,cameraMaxPitch:.98,keyAttack:"Unbound",keyJump:"Unbound",keyRoll:"Unbound",keySprint:"Unbound",keyCrouch:"Unbound",keyCrawl:"Unbound",keyEmote:"Unbound",keySwapShoulder:"Unbound"}),e.updatePhysics(O,{enabled:!1}));let P=d(`${a} · Rig`,[0,0,0],O),U=P,W=P,q=P,Q=P;if(i===1){const z=w?R:[R[x===0?0:x===2?3:2]];for(const T of z){const A=he(O,T,r===-1);M(O,Object.fromEntries(Object.entries(A).map(([se,ne])=>[`hero${T.id}_${se}`,ne]))),w&&T.id!==1&&e.updateTransform(A.rig,"scale",[0,0,0]),(!w||T.id===1)&&({rig:P,arm:U,leg:W,leg2:q,offarm:Q}=A)}}else if(i===0){C(`${a} · Armored minion`,[t("hexprism",[0,.67,0],[.72,.75,.55],3),t("hexprism",[0,1.22,0],[.71,.49,.61],1),t("box",[0,1.24,.33],[.42,.08,.04],5),t("cone",[0,1.62,0],[.3,.36,.3],3),t("box",[-.47,.7,.05],[.14,.76,.61],3)],B,P),U=d(`${a} · Weapon`,[.43,.83,0],P),C(`${a} · Spear`,[t("cylinder",[0,0,.35],[.09,1.1,.09],4,[Math.PI/2,0,0]),t("cone",[0,0,.98],[.24,.5,.24],5,[Math.PI/2,0,0])],B,U),W=d(`${a} · Left stride`,[-.2,.35,0],P),q=d(`${a} · Right stride`,[.2,.35,0],P);for(const z of[W,q])C(`${a} · Boot`,[t("box",[0,-.14,.09],[.28,.42,.43],6)],B,z)}else if(i===4)C(`${a} · Moss sentinel`,[t("hexprism",[0,1,0],[2.2,1.8,1.6],1),t("hexprism",[0,2.15,0],[1.4,1.1,1.3],0),t("box",[0,2.3,.68],[.75,.15,.1],3),t("hexprism",[-1.25,1.3,0],[.8,1.8,.9],1,[0,0,-.2]),t("hexprism",[1.25,1.3,0],[.8,1.8,.9],1,[0,0,.2]),t("cone",[-.4,2.9,0],[.5,.8,.5],3),t("cone",[.4,2.9,0],[.5,.8,.5],3)],B,P);else{const z=[t("cylinder",[0,.25,0],[4,.5,4],0),t("hexprism",[0,.65,0],[3.2,.45,3.2],1),t("torus",[0,.93,0],[2.6,2.6,.15],4,[Math.PI/2,0,0])];if(i===2){z.push(t("hexprism",[0,1.8,0],[1.4,2.1,1.4],1),t("hexprism",[0,2.7,0],[2.1,.35,2.1],4),t("pyramid",[0,3.52,0],[1.3,1.5,1.3],3),t("pyramid",[0,4.38,0],[1.3,.6,1.3],3,[Math.PI,0,0]));for(let T=0;T<4;T++){const A=T*Math.PI/2;z.push(t("hexprism",[Math.cos(A)*1.05,1.45,Math.sin(A)*1.05],[.45,1.6,.45],0))}}else{z.push(t("pyramid",[0,2,0],[2.8,3,2.8],3),t("pyramid",[0,3.8,0],[2.8,1.4,2.8],3,[Math.PI,0,0]),t("torus",[0,1.7,0],[4.6,4.6,.2],4,[Math.PI/2,0,0]));for(let T=0;T<4;T++){const A=T*Math.PI/2;z.push(t("pyramid",[Math.cos(A)*2.1,1.5,Math.sin(A)*2.1],[.7,1.8,.7],5))}}C(`${a} · Runic stonework`,z,B,P),k(`${a} · Energy`,[0,i===2?3.6:2.9,0],[.62,1,.62],r===1?h.mint:h.coral,P)}const J=i===0?1.95:i===1?3.05:5,X=d(`${a} · Health backing`,[0,J,0],O);C(`${a} · Bar backing`,[t("box",[0,0,0],[i<2?1.8:3,.13,.17],0)],["#0b171c"],X);const Z=d(`${a} · Health fill pivot`,[0,J+.035,-.03],O);C(`${a} · Health fill`,[t("box",[0,0,0],[i<2?1.7:2.9,.1,.21],0)],[r===1?"#65d3ac":"#e96972"],Z);const F=d(`${a} · Attack flash`,[0,1,.8],P);k(`${a} · Strike`,[0,0,0],[1.3,.16,1.3],h.flash,F),e.updateTransform(F,"scale",[0,0,0]);const oe=k(`${a} · Arc projectile`,L,[0,0,0],r===1?h.mint:h.coral,o),ee=i===0?120:i===1?w?520:360:i===2?1e3:i===4?420:1200,le=r===1?D[x]:[...D[x]].reverse();return e.attachScript(O,w?G:y),M(O,{tags:"lumen-unit",team:r,kind:i,lane:x,controlled:w,home:L,rig:P,arm:U,offarm:Q,leg:W,leg2:q,bar:Z,backing:X,effect:F,bolt:oe,max_hp:ee,hp:i===0?0:ee,damage:i===0?18:i===1?w?32:30:55,reach:i===2?8:i===4?3:i===1?w?2.8:6:2,cadence:i===2?1.2:i===1?.7:1,pace:i===1?6:4.5,...Object.fromEntries(le.map((z,T)=>[`nav${T}`,z]))}),O},b=new Map,g=new Map;for(const a of[1,-1]){const r=a===1?"Mint":"Coral",i=fe.map((x,w)=>m(w===1?`${r} · Garden tower`:`${r} · ${w===0?"Top":"Bottom"} tower`,a,2,[x[0]*a,0,x[2]*a],w));b.set(a,i);const L=m(`${r} · Lumen core`,a,3,[a*30,0,a*30]);M(L,{guardian:i[1],guardian_top:i[0],guardian_bot:i[2]}),g.set(a,L)}const $=m("Lumen · Mint hero",1,1,[26,0,25],1,!0),I=m("Ember · Coral rival",-1,1,[-25,0,-26]);for(const a of[1,-1])for(const r of[0,2])m(`${a===1?"Mint":"Coral"} · ${r===0?"Top guardian":"Bottom ranger"}`,a,1,[a*(r===0?30:24),0,a*(r===0?24:30)],r);let v="";for(const a of[1,-1])for(let r=0;r<3;r++)for(let i=0;i<4;i++){const L=r*4+i+1,x=m(`${a===1?"Mint":"Coral"} · Sprout ${L}`,a,0,[a*(27+i%2*1.1),0,a*(27-i%2*1.1)],r);M(x,{slot:Math.floor(i/2)}),v||(v=x)}m("Jungle · North sentinel",0,4,[18,0,-18]),m("Jungle · South sentinel",0,4,[-18,0,18]);const S=C("Lumen · Command marker",[t("torus",[0,.45,0],[1.7,1.7,.12],0,[Math.PI/2,0,0]),t("cone",[0,.8,0],[.35,.45,.35],0,[Math.PI,0,0])],["#b8f3b6"],o);e.updateTransform(S,"scale",[0,0,0]);const _=C("Lumen · Spell sigil",[t("torus",[0,.5,0],[2,2,.07],0,[Math.PI/2,0,0]),t("torus",[0,.6,0],[1.4,1.4,.06],1,[Math.PI/2,0,0])],["#81deed","#fff0ba"],o);return e.updateTransform(_,"scale",[0,0,0]),M($,{marker:S,pulse_fx:_,pointerMoveEvent:"LLMove",pointerAimVariable:"aim_point",pointerAttackEvent:"LLTarget",pointerTargetTag:"lumen-unit",pointerPlayingVariable:"LLPlaying",pointerPausedVariable:"LLPaused",pointerBlockedVariable:"LLShopOpen",pointerCaptureEscape:!0,pointerBounds:35,pointerMapSpan:84,pointerMapPaths:JSON.stringify(D)}),e.attachScript(o,l),M(o,{mint_tower:b.get(1)[1],coral_tower:b.get(-1)[1],mint_core:g.get(1),coral_core:g.get(-1)}),e.createPrefabFromObject($,"Lumen · Five playable champions",u),e.createPrefabFromObject(I,"Ember · Rival guardian",u),e.createPrefabFromObject(v,"Sprout · Reusable lane minion",u),e.createPrefabFromObject(b.get(1)[1],"Beacon · Defensive tower",u),xe(o),e.selectObject($),$}export{Ce as createMobaTemplate};
