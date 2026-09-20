import { mkdirSync, writeFileSync } from 'node:fs';

// Original 70-second score and weather sound design, generated without recordings or music samples.
const rate=48000,duration=70,frames=rate*duration,pcm=new Float32Array(frames*2),tau=2*Math.PI;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const chords=[[55,82.407,110,130.813],[51.913,77.782,103.826,130.813],[48.999,73.416,97.999,123.471],[55,82.407,110,130.813]];
let seed=8142,low=0,wind=0,rain=0;
for(let i=0;i<frames;i++){
 const t=i/rate,fade=smooth(t/3)*smooth((70-t)/3),storm=smooth((t-16)/16)*(1-smooth((t-57)/10)*.7);
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 const noise=seed/4294967296*2-1;
 low=low*.997+noise*.003;wind=wind*.984+noise*.016;rain=rain*.76+noise*.24;
 const section=Math.floor(t/16)%4,blend=smooth(t%16/4),a=chords[(section+3)%4],b=chords[section];
 let thunder=0;
 for(const hit of [26.36,39.27,42.08]){
  const age=t-hit;
  if(age>=0&&age<7)thunder+=(Math.sin(tau*(34*age+3*(1-Math.exp(-age*8))))*.35+low*10+rain*.1)*Math.exp(-age*.75)*smooth(age/.018);
 }
 for(let channel=0;channel<2;channel++){
  let value=0;
  for(let n=0;n<4;n++){
   const wave=f=>Math.sin(tau*f*t*(1+(channel?1:-1)*.00065))+.22*Math.sin(tau*f*2*t)+.07*Math.sin(tau*f*3*t);
   value+=(wave(a[n])*(1-blend)+wave(b[n])*blend)*.018;
  }
  const beat=t%2,drum=Math.sin(tau*(44*beat+3*(1-Math.exp(-beat*14))))*Math.exp(-beat*8)*smooth(beat/.008);
  value+=drum*.08*smooth((t-8)/16)*(t<42?1:.35);
  const motifAge=t%4,motif=[220,196,164.814,146.832,164.814,130.813,146.832,110][Math.floor(t/4)%8];
  value+=(Math.sin(tau*motif*motifAge)+.14*Math.sin(tau*motif*2.007*motifAge))*Math.exp(-motifAge*1.35)*smooth(motifAge/.05)*.027;
  value+=wind*(.22+storm*.9)*(1+.12*Math.sin(t*.31+channel))+rain*storm*.025+thunder*.28;
  const rise=smooth((t-37)/5)*(1-smooth((t-42)/.3));
  value+=Math.sin(tau*(88*t+.09*t*t))*rise*.025;
  // A short, decaying stereo echo opens the score without making the weather indistinct.
  const delay=Math.round((channel?.43:.31)*rate)*2;
  pcm[i*2+channel]=(value+(i*2>delay?pcm[i*2+channel-delay]*.17:0))*fade;
 }
}
let peak=0;for(const v of pcm)peak=Math.max(peak,Math.abs(v));
const wav=Buffer.alloc(44+pcm.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length*2,40);
for(let i=0;i<pcm.length;i++)wav.writeInt16LE(Math.round(pcm[i]/peak*.74*32767),44+i*2);
mkdirSync('public/templates/blackthorn',{recursive:true});writeFileSync('public/templates/blackthorn/blackthorn-score.wav',wav);
console.log('Blackthorn: original 70-second stereo score, wind, rain and three synchronized thunder cues.');
