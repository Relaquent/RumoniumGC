(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const state = JSON.parse(localStorage.getItem('rumonium-ui') || '{}');
  const save = () => localStorage.setItem('rumonium-ui', JSON.stringify(state));

  // Cyber ambience: canvas rain + tiny "ant" particles. No external dependency.
  const canvas = document.createElement('canvas'); canvas.id='cyber-rain'; document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d'); let drops=[];
  function resize(){canvas.width=innerWidth;canvas.height=innerHeight;drops=Array.from({length:Math.max(35,Math.floor(innerWidth/22))},()=>({x:Math.random()*canvas.width,y:Math.random()*canvas.height,s:8+Math.random()*14,v:.5+Math.random()*2}))}
  addEventListener('resize',resize); resize();
  function rain(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.font='10px monospace';ctx.fillStyle='rgba(50,190,255,.35)';for(const d of drops){ctx.fillText(Math.random()>.5?'1':'0',d.x,d.y);d.y+=d.v;if(d.y>canvas.height+20)d.y=-10;}requestAnimationFrame(rain)} rain();

  const ants=document.createElement('div'); ants.className='ant-field';
  for(let i=0;i<38;i++){const a=document.createElement('i');a.className='ant';a.style.left=Math.random()*100+'%';a.style.top=Math.random()*100+'%';a.style.animationDuration=(3+Math.random()*7)+'s';a.style.animationDelay=(-Math.random()*8)+'s';ants.appendChild(a)} document.body.appendChild(ants);
  const scan=document.createElement('div');scan.className='scanline';document.body.appendChild(scan);

  // Live status micro HUD.
  const hud=document.createElement('div');hud.className='cyber-status';hud.id='cyber-hud';hud.style.cssText='position:fixed;left:92px;bottom:10px;z-index:5;pointer-events:none';hud.textContent='SECURE LINK // STANDBY';document.body.appendChild(hud);
  setInterval(()=>{const s=($('#side-status')?.textContent||'OFFLINE').toUpperCase();hud.textContent=`RUMONIUM // ${s} // ${new Date().toLocaleTimeString([], {hour12:false})}`},1000);

  // Runtime customization drawer. Visual settings are local; bot settings are sent to existing API.
  const wrap=document.createElement('div');wrap.id='operator-tools';wrap.innerHTML=`<button class="tool-toggle" title="Operator preferences">⚙</button><div id="custom-drawer"><h3>OPERATOR / VISUAL CORE</h3><label>Rain intensity <input id="rain-range" type="range" min="0" max="30" value="${state.rain??12}"></label><label>Noise <input id="noise-range" type="range" min="0" max="12" value="${state.noise??3}"></label><label>Scanline <input id="scan-toggle" type="checkbox" ${state.scan!==false?'checked':''}></label><label>Particles <input id="ants-toggle" type="checkbox" ${state.ants!==false?'checked':''}></label><label>Compact mode <input id="compact-toggle" type="checkbox" ${state.compact?'checked':''}></label><div style="margin-top:12px;color:#59758d;font:10px monospace;line-height:1.5">UI preferences stay in this browser. Bot runtime controls continue using the existing control API.</div></div>`;document.body.appendChild(wrap);
  const drawer=$('#custom-drawer');$('.tool-toggle',wrap).onclick=()=>drawer.classList.toggle('open');
  $('#rain-range').oninput=e=>{state.rain=+e.target.value;save();canvas.style.opacity=(state.rain/100).toFixed(2)};
  $('#noise-range').oninput=e=>{state.noise=+e.target.value;save();$('.noise').style.opacity=(state.noise/100).toFixed(3)};
  $('#scan-toggle').onchange=e=>{state.scan=e.target.checked;save();scan.style.display=state.scan?'block':'none'};
  $('#ants-toggle').onchange=e=>{state.ants=e.target.checked;save();ants.style.display=state.ants?'block':'none'};
  $('#compact-toggle').onchange=e=>{state.compact=e.target.checked;save();document.body.classList.toggle('compact-ui',state.compact)};
  canvas.style.opacity=((state.rain??12)/100).toFixed(2);$('.noise').style.opacity=((state.noise??3)/100).toFixed(3);scan.style.display=state.scan===false?'none':'block';ants.style.display=state.ants===false?'none':'block';document.body.classList.toggle('compact-ui',!!state.compact);

  // Make page headings feel like a terminal without touching existing functionality.
  document.querySelectorAll('.page-heading h1,.hero h1').forEach(el=>{el.classList.add('glitch');el.dataset.text=el.textContent.trim()});

  // Add harmless keyboard shortcuts: Ctrl+Shift+R refreshes data through existing button; Ctrl+Shift+T focuses chat.
  addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='r'){e.preventDefault();$('#refresh')?.click()}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='t'){e.preventDefault();$('#chat-input')?.focus()}});
})();
