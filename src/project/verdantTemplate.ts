import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { biomeSurfaceAssets, biomeTreeAssets } from '../terrain/biomes';
import type { AssetItem, CinematicAction } from '../types';
import { verdantSceneryAssets, verdantRocks, verdantFernBanks } from './verdantScenery';
import { VERDANT_DURATION, verdantShotPlan, verdantTerrain } from './verdantLayout';
export { VERDANT_DURATION } from './verdantLayout';
export const VERDANT_AUDIO_ASSETS = ['verdant-mix.wav','verdant-score.mp3','woodland-ambience.mp3'] as const;

async function embeddedAudio(name: string): Promise<AssetItem> {
  const response = await fetch(`templates/verdant/${name}`);
  if (!response.ok) throw new Error(`Missing Verdant audio: ${name}`);
  const blob = await response.blob();
  const data = await new Promise<string>((resolve,reject)=>{
    const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(new Blob([blob],{type:name.endsWith('.wav')?'audio/wav':'audio/mpeg'}));
  });
  return { id:`verdant-${name}`, name, type:'audio', size:blob.size, data, createdAt:0 };
}

/** A complete, remixable landscape film. All referenced art and sound travels in the project package. */
export async function createVerdantTemplate(): Promise<string | undefined> {
  const s=useEditorStore.getState(), scene=s.activeScene();
  if (!scene) return undefined;
  // Finish all fallible asset loading before touching the user's scene.
  const [surfaces,models,audio,scenery] = await Promise.all([biomeSurfaceAssets(),biomeTreeAssets('woodland'),Promise.all(VERDANT_AUDIO_ASSETS.map(embeddedAudio)),verdantSceneryAssets()]);
  if (useEditorStore.getState().activeSceneId !== scene.id) return undefined;
  const terrain=verdantTerrain(), plan=verdantShotPlan(terrain);
  const folder=s.createFolder('Verdant · landscape and sound');
  const all=[...surfaces,...models,...audio,...scenery];
  const existing=new Set(useEditorStore.getState().assets.map(a=>a.id));
  s.addAssetItems(all.filter(a=>!existing.has(a.id)).map(a=>({...a,folderId:folder})));
  for (const id of ['obj-player','obj-ground','obj-enemy','obj-light','obj-camera']) if(selectActiveObjects(useEditorStore.getState()).some(o=>o.id===id))s.deleteObject(id);
  s.renameScene(scene.id,'Verdant · A Woodland Study');
  s.createObjectWithProps('terrain',{name:'01 · Woodland / editable terrain, trees and forest floor',terrain});
  const rocks=verdantRocks(terrain);
  const banks=verdantFernBanks(terrain,rocks,plan.shots.flatMap(shot=>shot.keys.map(k=>k.position)));
  banks.push({assetId:'verdant-fern-bank',position:[plan.fern[0]-.4,plan.fern[1],plan.fern[2]-.5],
    scale:[1.5,1.3,1.5],yaw:1.7,radius:1.5,top:plan.fern[1]+1});
  for (const [i,prop] of [...rocks,...banks].entries()) {
    const object=s.createObjectWithProps('cube',{
      name:`04 · ${prop.assetId.includes('rock')?'Mossy outcrop':prop.assetId==='verdant-shrub'?'Low broadleaf shrub':'Fern bank'} / ${i+1}`,position:prop.position,
    });
    s.updateTransform(object,'scale',prop.scale);
    s.updateTransform(object,'rotation',[0,prop.yaw,0]);
    s.updateRenderer(object,{modelAssetId:prop.assetId,color:'#ffffff',metalness:0,roughness:.95,overrideMaterial:false});
  }
  const camera=s.createObjectWithProps('camera',{name:'02 · Overview / reusable landscape camera',position:plan.shots[5].keys[0].position});
  const pose=new THREE.PerspectiveCamera();pose.position.fromArray(plan.shots[5].keys[0].position);pose.lookAt(new THREE.Vector3().fromArray(plan.shots[5].keys[0].lookAt!));
  s.updateTransform(camera,'rotation',[pose.rotation.x,pose.rotation.y,pose.rotation.z]);
  s.applyRenderPreset(scene.id,'realistic');
  s.updateSceneEnvironment(scene.id,{skyMode:'procedural',skyLighting:'sky',skyTopColor:'#7494ab',skyHorizonColor:'#d1d7cd',skyGroundColor:'#465039',
    ambientMode:'hemisphere',ambientIntensity:.42,environmentIntensity:.85,toneMapping:'agx',toneMappingExposure:1.12,
    sunColor:'#ffe2b5',sunIntensity:4.6,sunAzimuth:238,sunElevation:19,sunShadowExtent:70,
    fogEnabled:true,atmosphericFog:false,fogColor:'#bdccc9',fogNear:85,fogFar:240,
    volumetricFogEnabled:true,volumetricFogDensity:.0017,volumetricFogColor:'#c6cfc5',volumetricFogHeight:1.8,
    volumetricFogFalloff:.22,volumetricScattering:.42,volumetricSunStrength:1.35,volumetricLocalStrength:0,volumetricMaxDistance:135,
    cloudCoverage:.24,cloudSpeed:.12,wind:[1.3,0,.65],windTurbulence:.22,contactShadows:false,
    rainIntensity:0,surfaceWetness:0,puddleCoverage:0,lux:{enabled:false}});
  s.updateRenderSettings({quality:'Epic',autoQuality:false,ambientOcclusionEnabled:true,ambientOcclusionIntensity:.65,ambientOcclusionRadius:.4,
    bloomEnabled:false,vignetteEnabled:false,colorGrade:{grade:'none',gradeIntensity:0}});
  const id=s.createCinematic('Verdant · A Woodland Study',VERDANT_DURATION);
  s.updateCinematic(id,{autoplay:true,skippable:false,frameRate:24});
  s.setCinematicLook(id,{letterbox:2,grade:'custom',gradeIntensity:1,contrast:.025,saturation:-.035,temperature:.025,grain:.004,vignette:.07,motionBlur:0});
  const beat=(action:Omit<CinematicAction,'id'>)=>s.addCinematicAction(id,action);
  for(const shot of plan.shots) {
    beat({type:'camera',label:shot.label,time:shot.start,duration:shot.end-shot.start,interpolation:'linear',ease:'linear',keyframes:shot.keys});
    s.addCinematicMarker(id,{time:shot.start,label:shot.label,color:'#b8cd9b',determinismFence:true});
  }
  beat({type:'fade',time:0,duration:1.4,fadeFrom:1,fadeTo:0,fadeColor:'#08100b',label:'Dawn / opening fade'});
  beat({type:'text',time:1.45,duration:1.65,text:'A FEATHER ENGINE FILM',textStyle:'credit',textColor:'#edf0d9'});
  for (const [time,text] of [
    [3.45,'FOREST FLOOR\nferns, moss and leaf litter'],
    [10.25,'NATURAL TREES\ndetailed bark and wind-driven foliage'],
    [18.75,'LIVING LANDSCAPES\nclustered groves and blade grass'],
    [27.75,'VOLUMETRIC LIGHT\nsunlight through canopy mist'],
    [36.75,'EDITABLE WORLDS\nterrain, foliage and six camera shots'],
  ] as const) beat({type:'text',time,duration:3.2,text,textStyle:'lowerThird',textColor:'#eef2de'});
  beat({type:'text',time:43.4,duration:3.1,text:'V E R D A N T',textStyle:'title',textColor:'#f1f1df'});
  beat({type:'text',time:43.8,duration:2.7,text:'A WOODLAND STUDY  ·  FEATHER ENGINE',textStyle:'credit',textColor:'#d7dfc9'});
  beat({type:'fade',time:46.5,duration:1.5,fadeFrom:0,fadeTo:1,fadeColor:'#08100b',label:'Quiet / closing fade'});
  beat({type:'sound',time:0,soundId:audio[0].id,label:'Verdant / original score and forest ambience · 48 s'});
  // Separate non-autoplay audition sequences keep the editable stems referenced in portable packages.
  for(const [index,title,duration] of [[1,'Music stem · isolated score',48],[2,'Ambience stem · woodland loop',24]] as const) {
    const stem=s.createCinematic(title,duration);s.updateCinematic(stem,{autoplay:false,skippable:true});
    s.addCinematicAction(stem,{type:'sound',time:0,soundId:audio[index].id,label:title});
  }
  const director=s.createObjectWithProps('empty',{name:'03 · Director / replay with R'});
  const {blueprintId}=s.createBlueprintNamed('Verdant · Replay film','Press R to restart the scene and its film. Cameras and sound are editable in Cinematic; terrain in Foliage.');
  s.attachScript(director,blueprintId);
  const key=s.addGraphNodeToBlueprint(blueprintId,'Key Down','Events',{keyCode:'KeyR',keyTriggerMode:'pressed'},{x:0,y:0});
  const replay=s.addGraphNodeToBlueprint(blueprintId,'Load Scene','Runtime',{restartScene:true},{x:330,y:0});
  s.connectGraphNodes(blueprintId,key,replay,'exec-out','exec-in');
  s.setActiveCinematic(id);s.selectObject(director);return id;
}
