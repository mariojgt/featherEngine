import{t as _,I as Y,v as K,w as W,x as Q}from"./player-Cq6YWe60.js";function q(t){const r=_.getState(),l=r.createFolder("Cinderfall · Interface"),m=r.createUIDocument("Cinderfall · Expedition interface","screen",l);r.updateUIDocument(m,{visibleOnStart:!0,renderMode:"dom",css:J}),r.attachUI(t,m);const f=_.getState().uiDocuments.find(R=>R.id===m).root.id;r.updateUIElement(m,f,{name:"Cinderfall interface",className:"cf-ui",anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0},style:{width:"100%",height:"100%",padding:"0",display:"block"}});const s=(R,y,I,S={},O)=>{const T=r.addUIElement(m,R,y);return r.updateUIElement(m,T,{name:I,style:{},states:{},...S}),O&&r.setUIBinding(m,T,"visible",O),T},a=(R,y,I,S,O)=>{const T=s(R,"text",y,{text:I,className:S});return O&&r.setUIBinding(m,T,"text",O),T},x=(R,y,I,S=!1)=>s(R,"button",y,{text:y,onClickEvent:I,className:`cf-button${S?" cf-secondary":""}`}),h=s(f,"panel","Expedition HUD",{className:"cf-hud",anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0},style:{width:"100%",height:"100%",display:"block"}},"CFStage > 0 && CFStage < 3 && !CFPaused"),c=s(h,"panel","Expedition identity",{className:"cf-brand",anchor:{h:"left",v:"top",offsetX:28,offsetY:24}});a(c,"Sector","SURVEY DIVISION  /  SECTOR 07","cf-eyebrow"),a(c,"Expedition name","CINDERFALL","cf-wordmark"),a(c,"Task","Recover aetherite. Return alive.","cf-muted","CFStage == 2 ? 'QUOTA MET — return to the amber rig' : 'Recover aetherite. Return alive.'");const i=s(h,"panel","Cargo tracker",{className:"cf-cargo",anchor:{h:"right",v:"top",offsetX:28,offsetY:24}});a(i,"Cargo eyebrow","AETHERITE CARGO","cf-eyebrow"),a(i,"Cargo units","00 / 16","cf-cargo-count","CFOre + ' / ' + CFQuota");const C=s(i,"bar","Cargo progress",{className:"cf-progress"});r.setUIBinding(m,C,"fill","CFOre / CFQuota"),a(i,"Extraction clock","MINING PHASE","cf-muted","CFStage == 2 ? 'RIG DEPARTURE IN ' + CFTimeLeft + 's' : 'MINING PHASE'");const u=s(h,"panel","Suit integrity",{className:"cf-integrity",anchor:{h:"left",v:"bottom",offsetX:28,offsetY:28}});a(u,"Integrity value","100","cf-integrity-number","Health + '%'"),a(u,"Integrity label","SUIT INTEGRITY","cf-eyebrow");const g=s(u,"bar","Integrity bar",{className:"cf-progress cf-health-progress"});r.setUIBinding(m,g,"fill","Health / 100"),r.setUIBinding(m,g,"color","Health <= 30 ? '#ff7f6c' : '#81dbc2'");const v=s(h,"panel","Rifle status",{className:"cf-weapon",anchor:{h:"right",v:"bottom",offsetX:28,offsetY:28}});a(v,"Rifle name","VX–24  /  SURVEY RIFLE","cf-eyebrow"),a(v,"Magazine","24","cf-ammo","CFReload > 0 ? 'RELOADING' : CFAmmo + ' / 24'"),a(v,"Lamp indicator","LAMP ON","cf-muted","CFHeadlamp ? 'F  HEADLAMP ON' : 'F  HEADLAMP OFF'");const k=s(h,"panel","Contextual task",{className:"cf-context",anchor:{h:"center",v:"bottom",offsetX:0,offsetY:42}});a(k,"Context prompt","","cf-context-title","CFPrompt"),a(k,"Context detail","","cf-muted","CFHint");const w=s(h,"panel","Radio notification",{className:"cf-radio",anchor:{h:"center",v:"top",offsetX:0,offsetY:116}},"CFToastTime > 0");a(w,"Radio eyebrow","RIG CONTROL","cf-eyebrow"),a(w,"Radio message","","cf-radio-message","CFToast");const L=s(h,"panel","Critical integrity",{className:"cf-warning",anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0},style:{width:"100%",height:"100%",display:"block"}},"Health > 0 && Health < 30");a(L,"Critical warning","CRITICAL INTEGRITY","cf-critical");const P=(R,y,I="")=>{const S=s(f,"panel",R,{className:`cf-overlay ${I}`,anchor:{h:"stretch",v:"stretch",offsetX:0,offsetY:0},style:{width:"100%",height:"100%",display:"flex"}},y);return s(S,"panel",`${R} content`,{className:"cf-modal"})},F=P("Expedition briefing","CFStage == 0","cf-brief");a(F,"Brief eyebrow","A FEATHER ENGINE FIELD EXPEDITION","cf-eyebrow"),a(F,"Brief title","CINDERFALL","cf-title"),a(F,"Brief subheading","Below the surface. Beyond the quota.","cf-subtitle"),a(F,"Brief description","The rig has found a seam of aetherite beneath Sector 07. Recover sixteen units from the glowing veins. When your cargo is full, make it back to the amber extraction rig. The cave is not empty.","cf-body"),a(F,"Brief controls",`WASD  MOVE   ·   SHIFT  SPRINT   ·   SPACE  JUMP
MOUSE  AIM   ·   LMB  FIRE   ·   R  RELOAD
HOLD E  MINE / EXTRACT   ·   F  HEADLAMP   ·   P  PAUSE`,"cf-controls"),x(F,"Begin expedition  ↵","CFStart"),a(F,"Brief footer","Single-player · one complete mission · all systems editable","cf-footnote");const G=P("Pause menu","CFPaused && CFStage > 0 && CFStage < 3");a(G,"Pause eyebrow","EXPEDITION ON HOLD","cf-eyebrow"),a(G,"Pause title","Take a breath.","cf-heading"),a(G,"Pause help","Click the viewport after resuming to capture the mouse. Escape releases it.","cf-body"),x(G,"Resume expedition","CFPause"),x(G,"Restart expedition","CFReplay",!0);const M=P("Expedition results","CFStage >= 3");return a(M,"Result eyebrow","EXPEDITION REPORT  /  SECTOR 07","cf-eyebrow"),a(M,"Result title","Cargo secured.","cf-heading","CFStage == 3 ? 'Cargo secured.' : 'Expedition lost.'"),a(M,"Result explanation","","cf-body","CFStage == 3 ? 'You brought the aetherite home. The rig crew thanks you.' : CFHint"),a(M,"Result cargo","","cf-result-stat","CFOre + ' AETHERITE  ·  ' + CFKills + ' CREATURES CLEARED'"),a(M,"Result time","","cf-muted","'EXPEDITION TIME  ' + CFDisplaySeconds + 's'"),x(M,"Run another expedition  ↵","CFReplay"),a(M,"Editing hint","Stop Play to edit the cave, creatures, weapon, and mission Blueprints.","cf-footnote"),m}const J=`
.cf-ui { font-family: Inter, system-ui, sans-serif; color: #eef2e9; pointer-events: none; }
.cf-ui * { box-sizing: border-box; }
.cf-hud { background: linear-gradient(#050d123d, transparent 22%, transparent 76%, #050d1259); }
.cf-brand { display: flex; flex-direction: column; gap: 8px; }
.cf-eyebrow { font: 600 10px ui-monospace, SFMono-Regular, Consolas, monospace; color: #b9c6b8; letter-spacing: 2px; }
.cf-wordmark { font-size: 24px; font-weight: 900; letter-spacing: 5px; }
.cf-muted { color: #acbebd; font-size: 11px; white-space: normal; line-height: 1.5; }
.cf-cargo { width: 216px; padding: 17px 20px; background: #071116bf; border: 1px solid #7eb1a733; border-top: 2px solid #73debd; display: flex; flex-direction: column; gap: 10px; }
.cf-cargo-count { color: #a9ecd6; font: 700 33px ui-monospace, monospace; letter-spacing: -2px; }
.cf-progress { height: 4px; width: 100%; color: #7adebf; background: #45655b4d; border: 0; border-radius: 1px; }
.cf-integrity { width: 174px; display: flex; flex-direction: column; gap: 8px; }
.cf-integrity-number { font: 700 28px ui-monospace, monospace; }
.cf-weapon { text-align: right; display: flex; flex-direction: column; gap: 10px; }
.cf-ammo { font: 600 34px ui-monospace, monospace; letter-spacing: -2px; color: #ffe1a1; }
.cf-context { display: flex; flex-direction: column; gap: 7px; align-items: center; text-align: center; max-width: 440px; padding: 10px 18px; background: #071116ac; border: 1px solid #8eae9d2b; }
.cf-context-title { font-size: 13px; font-weight: 700; letter-spacing: .5px; color: #f4dfb3; }
.cf-radio { background: #071116e3; border-left: 3px solid #d6aa55; padding: 12px 20px; max-width: 470px; text-align: center; display: flex; flex-direction: column; gap: 6px; }
.cf-radio-message { font-size: 12px; line-height: 1.5; white-space: normal; }
.cf-warning { box-shadow: inset 0 0 95px 15px #bd3a2940; }
.cf-critical { position: absolute; top: 28%; width: 100%; text-align: center; color: #ff917b; font: 600 11px ui-monospace, monospace; letter-spacing: 3px; }
.cf-overlay { align-items: center; justify-content: center; background: #030a0fcc; backdrop-filter: blur(5px); pointer-events: auto; padding: 26px; }
.cf-modal { width: min(520px, 100%); display: flex; flex-direction: column; gap: 20px; background: #0d1a20f2; border: 1px solid #8ab7a431; border-top: 3px solid #d8b567; padding: 36px; box-shadow: 0 30px 90px #0006; }
.cf-brief { justify-content: flex-start; background: linear-gradient(90deg, #031018eb 5%, #03101890 53%, #03101805); backdrop-filter: none; padding: 6vw; }
.cf-brief .cf-modal { background: transparent; border: 0; box-shadow: none; padding: 0; max-width: 490px; }
.cf-title { font-size: clamp(40px, 6vw, 68px); font-weight: 900; letter-spacing: -3px; line-height: .97; color: #f8e4b7; }
.cf-subtitle { font-size: 18px; font-weight: 650; color: #e3ede7; white-space: normal; }
.cf-body { font-size: 14px; line-height: 1.8; color: #b2c3c4; white-space: normal; }
.cf-controls { font: 10px/2.3 ui-monospace, monospace; letter-spacing: .8px; color: #8da5a5; white-space: pre-wrap; }
.cf-button { pointer-events: auto; min-height: 46px; padding: 12px 18px; background: #d3af62; color: #142028; border: 1px solid #f0d38e; border-radius: 3px; font-size: 13px; font-weight: 800; cursor: pointer; text-align: center; }
.cf-button:hover { background: #f1cc7c; }
.cf-button:focus-visible { outline: 2px solid #93f2d6; outline-offset: 4px; }
.cf-secondary { background: transparent; border-color: #88a79b59; color: #c4d6d2; }
.cf-secondary:hover { background: #8ab7a41c; }
.cf-footnote { font-size: 10px; line-height: 1.6; color: #829b9c; white-space: normal; }
.cf-heading { font-size: 34px; font-weight: 800; letter-spacing: -1px; white-space: normal; }
.cf-result-stat { font: 600 12px ui-monospace, monospace; color: #ecd396; white-space: normal; line-height: 1.8; }
@media(max-width:700px) { .cf-brief { padding: 28px; } .cf-title { font-size: 43px; } .cf-modal { padding: 24px; gap: 15px; } .cf-brand .cf-muted { max-width: 160px; } .cf-wordmark { font-size: 17px; letter-spacing: 2px; } .cf-eyebrow { font-size: 8px; letter-spacing: 1px; } .cf-cargo { width: 142px; padding: 10px; } .cf-cargo-count { font-size: 26px; } .cf-integrity { width: 110px; } .cf-ammo { font-size: 24px; } .cf-context { max-width: 220px; bottom: 95px; padding: 8px; } .cf-radio { max-width: 270px; } }
`;function Z(){return Object.fromEntries(Object.entries({shot:.16,reload:1.25,mine:.3,hurt:.2,step:.09,success:1.5,alert:.8,ambient:6}).map(([r,l])=>{const f=Math.floor(22050*l),s=new Uint8Array(44+f*2),a=new DataView(s.buffer),x=(i,C)=>[...C].forEach((u,g)=>a.setUint8(i+g,u.charCodeAt(0)));x(0,"RIFF"),a.setUint32(4,s.length-8,!0),x(8,"WAVE"),x(12,"fmt "),a.setUint32(16,16,!0),a.setUint16(20,1,!0),a.setUint16(22,1,!0),a.setUint32(24,22050,!0),a.setUint32(28,22050*2,!0),a.setUint16(32,2,!0),a.setUint16(34,16,!0),x(36,"data"),a.setUint32(40,f*2,!0);let h=8041;for(let i=0;i<f;i++){h=Math.imul(h,1664525)+1013904223>>>0;const C=h/2147483648-1,u=i/22050,g=k=>Math.sin(u*Math.PI*2*k);let v=0;if(r==="shot"&&(v=(C*.46+Math.sin(2*Math.PI*(180*u-330*u*u))*.48)*Math.exp(-u*37)),r==="reload"&&(v=C*(Math.exp(-Math.abs(u-.08)*110)*.5+Math.exp(-Math.abs(u-.85)*95)*.65+Math.exp(-Math.abs(u-1.12)*140)*.5)),r==="mine"&&(v=(g(740)*.27+g(1109)*.17+C*.2)*Math.exp(-u*16)),r==="hurt"&&(v=(g(72)*.4+C*.25)*Math.exp(-u*15)),r==="step"&&(v=C*.32*Math.exp(-u*44)),r==="alert"&&(v=(g(146)*.25+g(293)*.12)*Math.sin(Math.PI*u/l)**2),r==="success"){const k=[262,330,392,524][Math.min(3,Math.floor(u*3))];v=(g(k)*.2+g(k*2)*.08)*Math.sin(Math.PI*u/l)**2}r==="ambient"&&(v=g(44)*.07+g(66)*.04+g(88)*.025+C*.012),a.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*32767,!0)}let c="";for(let i=0;i<s.length;i+=8192)c+=String.fromCharCode(...s.subarray(i,i+8192));return[r,{id:`cinderfall-audio-${r}`,name:`Cinderfall · ${r}.wav`,type:"audio",size:s.length,data:`data:audio/wav;base64,${btoa(c)}`,createdAt:0}]}))}const p=(t,r,l,m,f,s=[0,0,0])=>({id:t.toLowerCase().replace(/[^a-z0-9]+/g,"-"),name:t,shape:r,position:l,scale:m,colorSlot:f,rotation:s,collider:"none"});function $(t){const r=new Y(.5,0),l=r.getAttribute("position"),m=[];for(let f=0;f<l.count;f++){const s=l.getX(f),a=l.getY(f),x=l.getZ(f),h=.9+Math.sin(s*37+a*29+x*17+t)*.16;m.push([s*h,a*h,x*h])}return r.dispose(),{vertices:m,indices:m.map((f,s)=>s)}}const ee=()=>{const t=[[0,.7,0],[0,-.5,0]];for(let l=0;l<6;l++)t.push([Math.cos(l*Math.PI/3)*.28,.15,Math.sin(l*Math.PI/3)*.28]);for(let l=0;l<6;l++)t.push([Math.cos(l*Math.PI/3)*.25,-.32,Math.sin(l*Math.PI/3)*.25]);const r=[];for(let l=0;l<6;l++){const m=2+l,f=2+(l+1)%6,s=m+6,a=f+6;r.push(0,f,m,m,f,s,f,a,s,1,s,a)}return{vertices:t,indices:r}};function te(){const t=[0,1,2].map(r=>({name:`Cinderfall · Basalt ${r+1}`,palette:["#3c4653","#455164","#303c4c"],parts:[{...p("Fractured basalt","mesh",[0,0,0],[1,1,1],r),mesh:$(r*17+3)}],style:{finish:"flat",bevel:0,roughness:.94}}));return t.push({name:"Cinderfall · Aetherite vein",palette:["#4bddc1","#96f3dd","#236c73","#343f4d"],parts:[{...p("Vein bed","mesh",[0,-.17,0],[2.3,.6,1.6],3),mesh:$(4)},...[[-.6,.1,0,.85],[0,.35,0,1.5],[.57,.02,.18,.85],[.18,.1,-.5,.7]].map(([r,l,m,f],s)=>({...p(`Crystal ${s+1}`,"mesh",[r,l,m],[1,f,1],s%2,[.12,s*.7,s%2?-.2:.2]),mesh:ee()}))],style:{finish:"flat",bevel:0,roughness:.25}}),t.push({name:"Cinderfall · VX-24 Survey Rifle",palette:["#d9aa47","#26333c","#bac7c6","#17242c","#70e7ce","#835c2f"],parts:[p("Receiver","box",[0,0,0],[.17,.17,.5],0),p("Upper receiver","box",[0,.085,-.035],[.14,.065,.43],1),p("Reinforced barrel","cylinder",[0,.026,-.4],[.07,.45,.07],2,[Math.PI/2,0,0]),p("Muzzle shroud","hexprism",[0,.026,-.62],[.095,.12,.095],1,[Math.PI/2,0,0]),p("Foregrip","box",[0,-.07,-.22],[.18,.11,.22],5),p("Pistol grip","box",[0,-.145,.095],[.09,.19,.12],3,[.15,0,0]),p("Magazine","box",[0,-.16,-.08],[.115,.23,.115],2,[-.12,0,0]),p("Buttstock","box",[0,-.015,.35],[.15,.15,.2],1),p("Sight bridge","box",[0,.155,.04],[.07,.07,.14],3),p("Sight glass","box",[0,.185,-.015],[.045,.023,.013],4),p("Power indicator","box",[.089,.008,-.04],[.009,.025,.19],4),p("Armoured right glove","box",[.01,-.21,.12],[.13,.095,.15],5),p("Right sleeve","capsule",[.035,-.27,.26],[.14,.24,.15],1,[.75,0,0]),p("Armoured left glove","box",[-.025,-.15,-.22],[.13,.08,.14],5),p("Left sleeve","capsule",[-.065,-.22,-.1],[.14,.25,.15],1,[.8,0,-.2])],style:{finish:"smooth",bevel:.008,roughness:.47}}),t.push({name:"Cinderfall · Cavewarden shell",palette:["#9a6242","#cb9a58","#354751","#72ddbc","#26313a"],parts:[{...p("Abdomen","mesh",[0,.66,-.22],[1.4,.8,1.3],0),mesh:$(12)},{...p("Carapace plate","mesh",[0,.89,-.25],[1.24,.5,1.1],1),mesh:$(21)},{...p("Head armour","mesh",[0,.47,.59],[.82,.55,.72],2),mesh:$(2)},p("Left compound eye","sphere",[-.25,.59,.84],[.2,.14,.12],3),p("Right compound eye","sphere",[.25,.59,.84],[.2,.14,.12],3),p("Left mandible","cone",[-.23,.29,.96],[.17,.42,.16],4,[1.1,0,.3]),p("Right mandible","cone",[.23,.29,.96],[.17,.42,.16],4,[1.1,0,-.3]),...[-.65,-.25,.15].map((r,l)=>p(`Dorsal ridge ${l+1}`,"cone",[0,1.02,r],[.22,.38,.24],1,[-.3,0,0]))],style:{finish:"flat",bevel:0,roughness:.55}}),t.push({name:"Cinderfall · Articulated leg",palette:["#a7754e","#26343b"],parts:[p("Coxa","box",[.3,0,0],[.62,.12,.14],0,[0,0,-.3]),p("Knee","sphere",[.62,-.1,0],[.2,.2,.2],1),p("Tibia","box",[.78,-.32,0],[.14,.62,.13],1,[0,0,-.5])],style:{finish:"flat",bevel:0,roughness:.68}}),t}const ae=16,oe=[[-6.2,.55,-1],[6.8,.55,10],[-6,.55,24],[6.2,.55,37],[-2,.55,45]],re=[[-3,.1,17],[4.5,.1,22],[-5,.1,31],[4,.1,39],[-8.5,.1,8],[8,.1,18],[-6,.1,43],[5,.1,47]];async function ie(){const t=_.getState(),r=t.activeSceneId;for(const e of["obj-player","obj-ground","obj-enemy","obj-light","obj-camera"])K(_.getState()).some(n=>n.id===e)&&t.deleteObject(e);t.renameScene(r,"Cinderfall · Sector 07"),t.updateSceneEnvironment(r,{skyMode:"color",backgroundColor:"#08131b",environmentIntensity:.72,ambientMode:"hemisphere",ambientIntensity:.32,sunColor:"#9cb8c9",sunIntensity:.7,sunAzimuth:220,sunElevation:42,fogEnabled:!0,fogColor:"#0c2029",fogNear:12,fogFar:70,toneMapping:"agx",toneMappingExposure:1.1,wind:[.3,0,.2],gravity:[0,-9.81,0],contactShadows:!1}),t.updateRenderSettings({quality:"High",autoQuality:!0,bloomEnabled:!0,bloomIntensity:.32,bloomThreshold:1,bloomRadius:.5,vignetteEnabled:!0});const l=t.createFolder("Cinderfall · Original materials"),m=t.createFolder("Cinderfall · Editable gameplay"),f=t.createFolder("Cinderfall · Reusable field equipment"),s=t.createFolder("Cinderfall · Original synthesized audio"),a=Z();t.addAssetItems(Object.values(a).map(e=>({...e,folderId:s}))),t.setSceneAudio(r,{ambientSoundId:a.ambient.id});const x=(e,n)=>_.setState(o=>Q(o,d=>d.map(b=>b.id===e?{...b,...n}:b))),h=(e,n,o={})=>{const d=t.createMaterial(e,"Original Cinderfall surface.",l);return t.updateMaterial(d,{color:n,roughness:.78,metalness:.05,...o}),d},c={floor:h("Basalt dust","#303d49"),dark:h("Rig graphite","#1d2c35",{roughness:.48,metalness:.65}),yellow:h("Survey ochre","#bd9141",{roughness:.55,metalness:.28}),steel:h("Brushed field alloy","#708b91",{roughness:.35,metalness:.7}),lamp:h("Amber work lights","#fff0bb",{emissiveColor:"#ffd482",emissiveIntensity:2.5}),teal:h("Aetherite glow","#66d9bc",{emissiveColor:"#40d2b7",emissiveIntensity:1.6}),coral:h("Hazard marks","#d67045"),moss:h("Cave lichen","#37594f")},i=(e,n,o,d,b="cube",E,A=!1,N)=>{const H=t.createObjectWithProps(b,{name:e,position:n,parentId:E,...A?{physics:{enabled:!0,bodyType:"fixed",collider:b==="sphere"?"sphere":"box",isTrigger:!1,friction:.85}}:{}});return t.updateTransform(H,"scale",o),N&&t.updateTransform(H,"rotation",N),b!=="empty"&&b!=="light"&&t.setObjectMaterial(H,d),H},C=(e,n=[0,0,0],o)=>i(e,n,[1,1,1],c.dark,"empty",o),u=(e,n,o,d,b,E)=>{const A=C(e,n,E),N={type:"point",color:o,intensity:d,distance:b,castShadow:!1,angle:Math.PI/5};return x(A,{kind:"light",light:N}),A},g=(e,n,o)=>{const{blueprintId:d}=t.createBlueprintNamed(e,n,m),b=t.applyBlueprintFeatherSource(d,o.trim());if(!b.ok||b.diagnostics.length)throw new Error(`${e}: ${b.diagnostics.map(E=>E.message).join("; ")}`);return d},v=te(),k=new Map;for(const e of v){const n=t.createModelSpec("blank",e.name);if(!n)throw new Error(`Could not create ${e.name}.`);t.updateModelSpec(n,e),k.set(e.name,n)}const w=(e,n,o,d=[1,1,1],b,E)=>{const A=t.createModelFromSpec(k.get(`Cinderfall · ${n}`),{position:o,name:e});if(!A)throw new Error(`Could not place ${e}.`);return b&&(t.setObjectParent(A,b),t.updateTransform(A,"position",o)),t.updateTransform(A,"scale",d),E&&t.updateTransform(A,"rotation",E),A},L=[["CFStage","number",0],["CFStarted","boolean",!1],["CFPaused","boolean",!1],["CFOre","number",0],["CFQuota","number",ae],["CFSeconds","number",0],["CFDisplaySeconds","number",0],["CFTimeLeft","number",75],["CFAmmo","number",24],["CFReload","number",0],["CFKills","number",0],["CFHeadlamp","boolean",!0],["CFToast","string",""],["CFToastTime","number",0],["CFPrompt","string","Find a glowing aetherite vein"],["CFHint","string","WASD move · Shift sprint · P pause"],["Health","number",100]];for(const[e,n,o]of L){const d=t.createVariable(e,n,!1);t.updateVariable(d,{defaultValue:o})}const P=C("Cinderfall · Authored cave"),F=C("01 · Basalt cavern",[0,0,0],P),G=C("02 · Survey infrastructure",[0,0,0],P),M=C("03 · Aetherite seams",[0,0,0],P),R=C("04 · Cavewardens",[0,0,0],P);i("Continuous cave floor",[0,-.35,15],[27,.7,72],c.floor,"cube",F,!0),i("West cave collision",[-13.5,3,15],[1.3,6,72],c.floor,"cube",F,!0),i("East cave collision",[13.5,3,15],[1.3,6,72],c.floor,"cube",F,!0),i("Far cave collision",[0,3,50],[27,6,1.4],c.floor,"cube",F,!0),i("Rig bay collision",[0,3,-20],[27,6,1.4],c.floor,"cube",F,!0);for(let e=0;e<15;e++){const n=-19+e*4.8;for(const o of[-1,1]){const d=o*(11.2+Math.sin(e*1.7)*.8);w(`Basalt wall ${o<0?"W":"E"}${e+1}`,`Basalt ${e%3+1}`,[d,2.3,n],[5.4,7.5+Math.sin(e)*1.3,6.8],F,[.12,e*.71,o*.13]),w(`Basalt roof haunch ${o<0?"W":"E"}${e+1}`,`Basalt ${(e+1)%3+1}`,[o*6.8,6.8,n],[8.5,3.4,6.8],F,[0,e*.37,o*.35])}}for(let e=0;e<12;e++)w(`Roof ridge ${e+1}`,`Basalt ${e%3+1}`,[Math.sin(e)*1.7,8.3,-17+e*6],[8.5,3.3,7.4],F,[.12,e,.1]);for(let e=0;e<24;e++){const n=e%2?-1:1,o=-14+e*2.7;w(`Floor scree ${e+1}`,`Basalt ${e%3+1}`,[n*(8.8+Math.sin(e*2)*1.1),.15,o],[.7+e%3*.2,.4,1.1],F,[.1,e*.9,0]),e%3===0&&i(`Lichen patch ${e+1}`,[n*10.4,.08,o],[2,.09,1],c.moss,"sphere",F)}for(const[e,n,o]of[[1,-6.8,12],[2,6.4,28]])w(`Basalt buttress ${e}`,"Basalt 2",[n,2.35,o],[4.8,6.8,5],F),i(`Buttress ${e} collision`,[n,2,o],[2.7,4,3.2],c.floor,"cube",F,!0);const y=C("Amber extraction rig",[0,0,-16],G);i("Rig footing",[0,.08,0],[5.6,.16,4.2],c.dark,"cube",y),i("Cargo hatch",[0,.19,0],[3.7,.14,2.8],c.steel,"cube",y);for(const e of[-1,1])i(`Rig support ${e}`,[e*2.25,1.5,1],[.65,3,.7],c.yellow,"cube",y),i(`Rig tower rail ${e}`,[e*2.58,1.5,1],[.14,3.3,.3],c.steel,"cube",y),i(`Rig inset lamp ${e}`,[e*2.25,1.8,.57],[.38,.2,.05],c.lamp,"cube",y);i("Rig canopy",[0,3,1],[5.4,.65,1.9],c.yellow,"cube",y),i("Rig signal mast",[-2.7,2.65,0],[.12,5.3,.12],c.steel,"cube",y),i("Rig signal bulb",[-2.7,5.4,0],[.35,.35,.35],c.lamp,"sphere",y);for(let e=0;e<5;e++)i(`Hatch chevron ${e+1}`,[-1.55+e*.76,.275,0],[.4,.015,2.4],e%2?c.dark:c.yellow,"cube",y,!1,[0,-.2,0]);u("Rig floodlight",[0,3.4,-1.2],"#ffd9a1",35,15,y);for(let e=0;e<6;e++){const n=-9+e*9,o=e%2?-8.6:8.6,d=C(`Survey beacon ${e+1}`,[o,0,n],G);i("Beacon pole",[0,.75,0],[.11,1.5,.11],c.steel,"cube",d),i("Beacon housing",[0,1.58,0],[.4,.18,.35],c.yellow,"cube",d),i("Beacon light",[0,1.51,0],[.21,.07,.25],c.lamp,"cube",d),u("Warm survey pool",[0,2.1,0],"#ffd196",23,16,d)}for(const[e,n,o]of[[1,-4,-9],[2,5,4],[3,-3,30]]){const d=C(`Field cargo ${e}`,[n,0,o],G);i("Reinforced cargo case",[0,.55,0],[1.3,1.1,1],c.dark,"cube",d,!0),i("Cargo ochre cover",[0,1.16,0],[1.4,.16,1.1],c.yellow,"cube",d),i("Cargo latch",[0,.76,-.52],[.22,.3,.05],c.steel,"cube",d),t.createPrefabFromObject(d,`Cinderfall · Field cargo ${e}`,f)}t.createPrefabFromObject(y,"Cinderfall · Extraction rig",f);const I=t.createRoleObject("player",{kind:"empty",name:"Surveyor · First-person pawn",position:[0,.05,-12]});if(!I.ok||!I.objectId)throw new Error("Could not create the surveyor.");const S=I.objectId;t.updateCharacterController(S,{cameraMode:"firstPerson",cameraFollow:!0,mouseLook:!0,autoInputWithScript:!1,cameraOffset:[0,1.68,0],cameraPitch:0,cameraMinPitch:-1.25,cameraMaxPitch:1.25,moveSpeed:5.2,sprintMultiplier:1.45,acceleration:32,deceleration:38,jumpStrength:5.7,gravity:18,stepHeight:.35,keyAttack:"Unbound",keyReload:"Unbound",keyRoll:"Unbound",keyEmote:"Unbound",keyCrouch:"KeyC",footstepSoundId:a.step.id,hurtSoundId:a.hurt.id,groundLevel:-4}),t.setObjectVariable(S,"health",100);const O=u("Surveyor headlamp",[0,1.6,.2],"#d5f4e7",14,16,S),T=w("VX-24 · Editable camera weapon","VX-24 Survey Rifle",[.28,-.34,-.52]);x(T,{viewModel:{ownerObjectId:S}}),t.attachScript(T,g("Cinderfall · Weapon presentation","Recoil and a real reload dip. The camera weapon is a live-linked Model Forge asset.",`blueprint Cinderfall_Weapon
var kick: number = 0
on event CFShot(payload):
    self.kick = 0.07
on update(dt):
    self.kick = max(0, self.kick - dt * 0.65)
    set_position(self, vec3(0.28, -0.34 + self.kick * 0.4 - min(Game.CFReload, 0.28), -0.52 + self.kick))
    set_rotation(self, vec3(0 - min(Game.CFReload, 0.28) * 45, 0, self.kick * -25))`));const U=g("Cinderfall · Surveyor controller","Ground movement, bounded magazine, timed reload, headlamp and pause. Tune walk_speed, fire_interval and reload_seconds here.",`blueprint Cinderfall_Surveyor
var walk_speed: number = 5.2
var fire_interval: number = 0.14
var reload_seconds: number = 1.25
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and Game.Health > 0:
        self.move(Input.move(), speed: self.walk_speed)
        if Game.CFReload > 0:
            Game.CFReload = max(0, Game.CFReload - dt)
            if Game.CFReload <= 0:
                Game.CFAmmo = 24
on key_down("Mouse0"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and Game.Health > 0:
        if Game.CFReload <= 0 and Game.CFAmmo > 0:
            if cooldown(self.fire_interval):
                Game.CFAmmo = Game.CFAmmo - 1
                spawn_projectile(speed: 115, damage: 28)
                Audio.play("${a.shot.id}")
                Camera.shake(0.05)
                fire_event("CFShot")
on key_pressed("KeyR"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        if Game.CFAmmo < 24 and Game.CFReload <= 0:
            Game.CFReload = self.reload_seconds
            Audio.play("${a.reload.id}")
on key_pressed("Space"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        self.jump()
on key_pressed("KeyF"):
    if Game.CFStage > 0 and Game.CFStage < 3:
        if Game.CFHeadlamp:
            Game.CFHeadlamp = false
            set_visible("${O}", false)
        else:
            Game.CFHeadlamp = true
            set_visible("${O}", true)`);t.attachScript(S,U);const B=_.getState().graphs.find(e=>e.id===_.getState().blueprints.find(n=>n.id===U).graphId);for(const e of B.nodes.filter(n=>n.data.nodeKind==="action.spawnProjectile"))t.updateGraphNodeData(e.id,{projectileSize:.075,projectileColor:"#ffd391",projectileLife:1.2,projectileKnockback:.45,projectileMuzzle:[.28,-.29,1.1]});const D=g("Cinderfall · Aetherite mining","Hold E within 2.8 metres. Each vein yields four units; quota stops mining at sixteen.",`blueprint Cinderfall_Aetherite
var remaining: number = 4
on key_down("KeyE"):
    if Game.CFStage == 1 and Game.CFPaused == false and self.remaining > 0:
        if distance(position(self), Player.location) < 2.8:
            if cooldown(0.35):
                self.remaining = self.remaining - 1
                Game.CFOre = min(Game.CFQuota, Game.CFOre + 1)
                Audio.play("${a.mine.id}")
                Camera.shake(0.035)
                if self.remaining <= 0:
                    set_visible(self, false)
                else:
                    set_scale(self, vec3(0.65 + self.remaining * 0.09, 0.6 + self.remaining * 0.1, 0.65 + self.remaining * 0.09))`);for(const[e,n]of oe.entries()){const o=w(`Aetherite vein ${e+1}`,"Aetherite vein",n,[1,1,1],M,[0,e*.7,0]);t.setObjectVariable(o,"tags","cf-vein"),t.attachScript(o,D),u(`Aetherite light ${e+1}`,[n[0],1.5,n[2]],"#6be3c1",22,12,M),e===0&&t.createPrefabFromObject(o,"Cinderfall · Mineable aetherite vein",f)}const z=g("Cinderfall · Cavewarden behaviour","A normal character controller and editable chase/contact rules. Alert thresholds spread the pressure across the expedition.",`blueprint Cinderfall_Cavewarden
var alert_at: number = 0
var speed: number = 2
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and self.health > 0:
        if Game.CFOre >= self.alert_at and AI.distance_to_player() < 23:
            self.move_to(Player.location, speed: self.speed)
            self.face_player()
            if AI.distance_to_player() < 1.65:
                if cooldown(1.1):
                    apply_damage("$player", 12)`),V=g("Cinderfall · Cavewarden gait","Reusable phase-shifted leg motion, parented to the creature. Change cadence and sweep to restyle it.",`blueprint Cinderfall_Gait
var phase: number = 0
var t: number = 0
var owner: object = ""
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and get_var(self.owner, "health") > 0:
        self.t = self.t + dt
        set_rotation(self, vec3(0, sin(self.t * 8 + self.phase) * 16, sin(self.t * 8 + self.phase) * 8))`);for(const[e,n]of re.entries()){const o=w(`Cavewarden ${e+1}`,"Cavewarden shell",n,[1,1,1],R);x(o,{character:{...W(),enabled:!0,cameraFollow:!1,autoInputWithScript:!1,moveSpeed:2,jumpStrength:0,keyAttack:"Unbound",keyRoll:"Unbound",keyEmote:"Unbound",groundLevel:-4}}),t.setObjectVariable(o,"health",84),t.setObjectVariable(o,"tags","cf-creature"),t.setObjectVariable(o,"alert_at",e<4?0:e<6?6:16),t.setObjectVariable(o,"speed",e<4?1.7:2.1),t.attachScript(o,z);for(let d=0;d<3;d++)for(const b of[-1,1]){const E=w(`Cavewarden ${e+1} · leg ${d+1}${b<0?"L":"R"}`,"Articulated leg",[b*.42,.55,-.45+d*.39],[b,1,1],o);t.attachScript(E,V),t.setObjectVariable(E,"phase",d*2+(b<0?Math.PI:0)),t.setObjectVariable(E,"owner",o)}e===0&&t.createPrefabFromObject(o,"Cinderfall · Cavewarden creature",f)}const j=C("Cinderfall · Expedition director");t.attachScript(j,g("Cinderfall · Expedition rules","Complete brief → mine sixteen units → return within 75 seconds → extract. Replay reloads the authored scene, restoring every enemy and vein.",`blueprint Cinderfall_Expedition
on start:
    Game.CFOre = 0
    Game.CFAmmo = 24
    Game.CFReload = 0
    Game.CFSeconds = 0
    Game.CFDisplaySeconds = 0
    Game.CFTimeLeft = 75
    Game.CFKills = 0
    Game.CFPaused = false
    Game.CFHeadlamp = true
    Game.Health = 100
    Game.CFToastTime = 0
    if Game.CFStarted:
        Game.CFStage = 1
    else:
        Game.CFStage = 0
on event CFStart(payload):
    Game.CFStarted = true
    Game.CFStage = 1
    Game.CFToast = "Survey link online. Four veins fill the cargo. Watch the shadows."
    Game.CFToastTime = 4
on key_pressed("Enter"):
    if Game.CFStage == 0:
        fire_event("CFStart")
    elif Game.CFStage >= 3:
        fire_event("CFReplay")
on key_pressed("KeyP"):
    fire_event("CFPause")
on event CFPause(payload):
    if Game.CFStage > 0 and Game.CFStage < 3:
        if Game.CFPaused:
            Game.CFPaused = false
            Time.scale = 1
        else:
            Game.CFPaused = true
            Time.scale = 0
on event CFReplay(payload):
    Game.CFStarted = true
    Scene.load("${r}")
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        Game.CFSeconds = Game.CFSeconds + dt
        Game.CFDisplaySeconds = floor(Game.CFSeconds)
        Game.CFToastTime = max(0, Game.CFToastTime - dt)
        Game.CFPrompt = "Find a glowing aetherite vein"
        Game.CFHint = "WASD move · Shift sprint · P pause"
        if Game.CFStage == 1:
            for vein in find_actors(tag: "cf-vein"):
                if get_var(vein, "remaining") > 0 and distance(position(vein), Player.location) < 2.8:
                    Game.CFPrompt = "HOLD E  /  EXTRACT AETHERITE"
                    Game.CFHint = "Four units per vein · rifle ammunition does not mine"
            if Game.CFOre >= Game.CFQuota:
                Game.CFStage = 2
                Game.CFToast = "Cargo secured. The rig leaves in 75 seconds. Return to the amber lights!"
                Game.CFToastTime = 5
                Audio.play("${a.alert.id}")
        if Game.CFStage == 2:
            Game.CFPrompt = "RETURN TO THE AMBER EXTRACTION RIG"
            Game.CFHint = "Follow the warm survey beacons back toward your starting point"
            if distance(Player.location, vec3(0, 0, -16)) < 3.4:
                Game.CFPrompt = "HOLD E  /  SECURE CARGO AND EXTRACT"
                Game.CFHint = "Your expedition is ready to leave"
            if Game.CFTimeLeft <= 0:
                Game.CFStage = 4
                Game.CFHint = "The rig departed before you returned. Recover the quota, then head straight for the amber lights."
        Game.CFKills = 8
        for creature in find_actors(tag: "cf-creature"):
            if get_var(creature, "health") > 0:
                Game.CFKills = Game.CFKills - 1
            else:
                if get_var(creature, "fallen") != true:
                    set_rotation(creature, vec3(0, 0, 82))
                    set_var(creature, "fallen", true)
        if Game.Health <= 0:
            Game.CFStage = 4
            Game.CFHint = "Suit integrity failed. Reload between encounters and use the basalt buttresses as cover."
on timer(1):
    if Game.CFStage == 2 and Game.CFPaused == false:
        Game.CFTimeLeft = Game.CFTimeLeft - 1
on key_down("KeyE"):
    if Game.CFStage == 2 and Game.CFPaused == false:
        if distance(Player.location, vec3(0, 0, -16)) < 3.4:
            Game.CFStage = 3
            Audio.play("${a.success.id}")`)),q(j),i("Survey rifle service bench",[4,.66,-15],[1.6,1.3,1],c.dark,"cube",G,!0),i("Service bench ochre top",[4,1.37,-15],[1.7,.12,1.1],c.yellow,"cube",G);const X=w("VX-24 · Reusable field rifle","VX-24 Survey Rifle",[4,1.49,-15],[1.2,1.2,1.2],G,[0,Math.PI/2,Math.PI/2]);return t.createPrefabFromObject(X,"Cinderfall · Editable survey rifle",f),t.selectObject(S),S}export{re as CINDERFALL_CREATURES,ae as CINDERFALL_QUOTA,oe as CINDERFALL_VEINS,ie as createCinderfallTemplate};
