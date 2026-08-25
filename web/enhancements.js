(()=>{
"use strict";
const root=document.documentElement;
const saved=JSON.parse(localStorage.getItem("rumonium-ui")||"{}");
const settings={rain:saved.rain!==false,noise:saved.noise!==false,scan:saved.scan!==false,particles:saved.particles!==false};
const c=document.createElement("canvas"); c.id="cyber-rain"; c.style.cssText="position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:.10"; document.body.prepend(c);
const ctx=c.getContext("2d"); let drops=[]; function resize(){c.width=innerWidth;c.height=innerHeight;drops=Array.from({length:Math.max(18,Math.floor(innerWidth/18))},()=>Math.random()*c.height)} resize(); addEventListener("resize",resize);
function rain(){if(!settings.rain){ctx.clearRect(0,0,c.width,c.height);return}ctx.fillStyle="rgba(2,6,11,.12)";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#159be8";ctx.font="10px monospace";drops.forEach((y,i)=>{const x=i*18;ctx.fillText(Math.random()>.5?"1":"0",x,y);drops[i]=y>c.height+20?Math.random()*-300:y+7+Math.random()*7});requestAnimationFrame(rain)} rain();
const style=document.createElement("style"); style.textContent=`body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,rgba(255,255,255,.012) 0,rgba(255,255,255,.012) 1px,transparent 1px,transparent 4px);mix-blend-mode:screen;opacity:${settings.scan?1:0}}`; document.head.appendChild(style);
window.addEventListener("keydown",e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==="r"){e.preventDefault();location.reload()}});
})();
