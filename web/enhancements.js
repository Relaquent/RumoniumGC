
(() => {
  const root = document.body;
  const canvas = document.createElement("canvas");
  canvas.id = "matrix-rain";
  Object.assign(canvas.style,{position:"fixed",inset:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"0",opacity:".13"});
  root.prepend(canvas);
  const ctx=canvas.getContext("2d");
  const chars="01アイウエオ<>[]{}//\\\\#$%";
  let w=0,h=0,cols=[],font=13;
  function resize(){
    const d=devicePixelRatio||1;w=innerWidth;h=innerHeight;
    canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);
    const n=Math.ceil(w/font);cols=Array.from({length:n},()=>Math.random()*-h/font);
  }
  function draw(){
    ctx.fillStyle="rgba(2,5,10,.13)";ctx.fillRect(0,0,w,h);
    ctx.font=font+"px monospace";
    for(let i=0;i<cols.length;i++){
      const y=cols[i]*font, c=chars[(Math.random()*chars.length)|0];
      ctx.fillStyle=Math.random()<.08?"#7cecff":"#008fcb";
      ctx.fillText(c,i*font,y);
      if(y>h && Math.random()>.975)cols[i]=0;
      cols[i]+=.65;
    }
    requestAnimationFrame(draw);
  }
  resize();addEventListener("resize",resize);draw();

  // Tiny "static/circuit" particles in the corners.
  const dust=document.createElement("div");
  dust.id="cyber-dust";
  Object.assign(dust.style,{position:"fixed",inset:"0",pointerEvents:"none",zIndex:"2",overflow:"hidden"});
  for(let i=0;i<70;i++){
    const p=document.createElement("i");
    Object.assign(p.style,{position:"absolute",left:(Math.random()*100)+"%",top:(Math.random()*100)+"%",width:(Math.random()<.8?1:2)+"px",height:(Math.random()<.8?1:2)+"px",background:"#16bfff",opacity:(.08+Math.random()*.3).toFixed(2),boxShadow:"0 0 7px #00a8ff",animation:`dust ${2+Math.random()*7}s linear ${-Math.random()*7}s infinite`});
    dust.appendChild(p);
  }
  const style=document.createElement("style");
  style.textContent="@keyframes dust{0%{transform:translate3d(0,0,0);opacity:.05}50%{opacity:.35}100%{transform:translate3d("+(Math.random()*30-15)+"px,"+(Math.random()*80-40)+"px,0);opacity:.02}}";
  document.head.appendChild(style);root.appendChild(dust);

  // Make the cyber UI feel alive without blocking interaction.
  setInterval(()=>{
    document.documentElement.style.setProperty("--cyber-pulse",Math.random()>.5?"1":".96");
  },1400);
})();
