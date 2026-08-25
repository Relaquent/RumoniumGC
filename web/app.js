
(() => {
  "use strict";

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const state = { page:"overview", socket:null, stats:null, logs:[], commands:[] };

  const pages = ["overview","bot","intelligence","tracking","access","ai","system"];
  const titles = {
    overview:"OVERVIEW", bot:"BOT CONTROL", intelligence:"PLAYER INTEL",
    tracking:"TRACKING", access:"ACCESS", ai:"AI CORE", system:"SYSTEM"
  };

  function escapeHtml(v){
    return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function toast(message, type="info"){
    const root=$("#toast-stack"); if(!root) return;
    const el=document.createElement("div");
    el.className="toast";
    el.textContent=`[${type.toUpperCase()}] ${message}`;
    root.appendChild(el);
    setTimeout(()=>el.remove(),3500);
  }

  async function api(url, options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await fetch(url,{
        ...options, signal:controller.signal,
        headers: {"Content-Type":"application/json",...(options.headers||{})}
      });
      const text=await res.text();
      let data={};
      try{data=text?JSON.parse(text):{};}catch{data={message:text};}
      if(!res.ok) throw new Error(data.message||data.error||`HTTP ${res.status}`);
      return data;
    }finally{clearTimeout(timer);}
  }

  function setPage(page){
    if(!pages.includes(page)) return;
    state.page=page;
    $$(".page").forEach(p=>p.classList.toggle("active",p.id===page));
    $$(".nav").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
    $("#page-title").textContent=titles[page];
    if(page==="overview") refreshCore();
    if(page==="bot") loadSettings();
    if(page==="tracking") loadTracking();
    if(page==="access") loadPermissions();
    if(page==="ai") loadPrompt();
    if(page==="system") loadSystem();
  }

  $$(".nav").forEach(btn=>btn.addEventListener("click",()=>setPage(btn.dataset.page)));
  $("#refresh")?.addEventListener("click",()=>refreshCore(true));

  function appendTerminal(text, type="INFO"){
    const t=$("#terminal"); if(!t) return;
    const line=document.createElement("div");
    const now=new Date().toLocaleTimeString([], {hour12:false});
    line.innerHTML=`<span style="color:#3d718c">[${now}]</span> <b style="color:#53e6ff">${escapeHtml(type)}</b> ${escapeHtml(text)}`;
    t.appendChild(line);
    t.scrollTop=t.scrollHeight;
    while(t.children.length>150)t.firstChild.remove();
  }

  function setStatus(status){
    const online=status==="online", connecting=status==="connecting";
    const label=online?"ONLINE":connecting?"CONNECTING":"OFFLINE";
    ["side-status","m-status","bot-state","hero-node"].forEach(id=>{
      const el=$("#"+id); if(el) el.textContent=label;
    });
    const dot=$("#side-dot"); if(dot) {
      dot.style.background=online?"var(--green)":connecting?"var(--yellow)":"var(--red)";
      dot.style.color=online?"var(--green)":connecting?"var(--yellow)":"var(--red)";
    }
    const sub=$("#m-status-sub"); if(sub) sub.textContent=online?"Connection established":connecting?"Establishing secure link":"Awaiting connection";
    const hb=$("#health-bot"); if(hb){hb.textContent=label;hb.style.color=online?"var(--green)":connecting?"var(--yellow)":"var(--red)";}
    const orb=$("#bot-orb"); if(orb) orb.style.boxShadow=online?"0 0 55px rgba(25,245,161,.25)":"0 0 45px rgba(0,168,255,.1)";
  }

  function renderStats(s){
    state.stats=s||{};
    $("#m-memory").textContent=s?.memory ?? s?.rss ?? "--";
    $("#m-queue").textContent=s?.queueLength ?? 0;
    $("#m-commands").textContent=(s?.commandCount ?? 0).toLocaleString();
    $("#hero-uptime").textContent="UPTIME "+formatUptime(s?.uptimeMs||0);
    $("#health-api").textContent=(s?.queueLength??0)===0?"CLEAR":`${s.queueLength} WAIT`;
    $("#health-cache").textContent=String(s?.cacheSize??"--");
    $("#health-urchin").textContent=s?.urchinEnabled?"ACTIVE":"OFFLINE";
    renderBars("#top-commands",s?.topCommands||[],"command");
    renderUsers("#top-users",s?.topUsers||[]);
  }

  function renderBars(sel,items){
    const el=$(sel); if(!el)return;
    if(!items.length){el.innerHTML='<div style="color:var(--dim);font:9px monospace;padding:18px 0">NO COMMAND TELEMETRY</div>';return;}
    const max=Math.max(1,...items.slice(0,8).map(x=>x.count||0));
    el.innerHTML=items.slice(0,8).map(x=>`<div class="bar-row"><span>!${escapeHtml(x.command)}</span><div class="bar"><i style="width:${Math.round((x.count/max)*100)}%"></i></div><b>${x.count}</b></div>`).join("");
  }
  function renderUsers(sel,items){
    const el=$(sel);if(!el)return;
    if(!items.length){el.innerHTML='<div style="color:var(--dim);font:9px monospace;padding:18px 0">NO OPERATOR ACTIVITY</div>';return;}
    el.innerHTML=items.slice(0,8).map((x,i)=>`<div class="rank-row"><span>${String(i+1).padStart(2,"0")} // ${escapeHtml(x.username)}</span><span>${x.count}</span></div>`).join("");
  }

  async function refreshCore(showToast=false){
    try{
      const [stats,activity]=await Promise.all([api("/api/stats"),api("/api/activity")]);
      renderStats(stats);
      $("#health").textContent=Math.max(0,Math.min(100,98-(stats.queueLength||0)*2));
      const feed=$("#feed");
      if(feed){
        const items=activity.recent||[];
        feed.innerHTML=items.slice(0,35).map(x=>{
          const text=typeof x==="string"?x:(x.message||x.text||JSON.stringify(x));
          return `<div><span style="color:#315a70">[${escapeHtml(x.time||x.timestamp||"LIVE")}]</span> ${escapeHtml(text)}</div>`;
        }).join("");
      }
      if(showToast) toast("Telemetry synchronized","success");
    }catch(e){toast("Telemetry request failed: "+e.message,"error");}
  }

  async function loadSettings(){
    try{
      const s=await api("/api/settings");
      $("#s-auto").checked=!!s.autoReconnect;
      $("#s-welcome").checked=!!s.welcomeMessages;
      $("#s-cooldown").value=s.commandCooldown??s.cooldown??0;
      $("#s-delay").value=s.messageDelay??s.delay??0;
      $("#s-reconnect").value=s.reconnectDelay??5000;
      $("#settings-state").textContent="SYNCED";
    }catch(e){toast("Settings unavailable: "+e.message,"error");}
  }

  async function saveSettings(){
    const payload={
      autoReconnect:$("#s-auto").checked,
      welcomeMessages:$("#s-welcome").checked,
      commandCooldown:Number($("#s-cooldown").value)||0,
      messageDelay:Number($("#s-delay").value)||0,
      reconnectDelay:Number($("#s-reconnect").value)||5000
    };
    try{
      $("#settings-state").textContent="SYNCING";
      await api("/api/settings",{method:"POST",body:JSON.stringify(payload)});
      $("#settings-state").textContent="SYNCED";
      toast("Runtime configuration applied","success");
    }catch(e){$("#settings-state").textContent="ERROR";toast(e.message,"error");}
  }
  ["s-auto","s-welcome","s-cooldown","s-delay","s-reconnect"].forEach(id=>{
    $("#"+id)?.addEventListener("change",saveSettings);
  });

  async function botAction(endpoint,label){
    try{appendTerminal(label+"…","CONTROL");await api(endpoint,{method:"POST"});toast(label,"success");setTimeout(refreshCore,500);}
    catch(e){toast(e.message,"error");appendTerminal(e.message,"ERROR");}
  }
  $("#bot-start")?.addEventListener("click",()=>botAction("/api/bot/start","Start requested"));
  $("#bot-reconnect")?.addEventListener("click",()=>botAction("/api/bot/reconnect","Reconnect requested"));
  $("#bot-stop")?.addEventListener("click",()=>botAction("/api/bot/disconnect","Disconnect requested"));

  $("#chat-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const input=$("#chat-input"), message=input.value.trim(); if(!message)return;
    input.value=""; appendTerminal("> "+message,"CHAT");
    try{await api("/chat",{method:"POST",body:JSON.stringify({message})});}
    catch(err){appendTerminal(err.message,"ERROR");toast(err.message,"error");}
  });

  async function loadTracking(){
    try{
      const [fk,act]=await Promise.all([api("/api/fkdr-tracking"),api("/api/activity-tracking")]);
      $("#fkdr-count").textContent=fk.count??fk.tracking?.length??0;
      $("#activity-count").textContent=act.count??act.tracking?.length??0;
      renderTracking("#fkdr-list",fk.tracking||[],"fkdr");
      renderTracking("#activity-list",act.tracking||[],"activity");
    }catch(e){toast("Tracking load failed: "+e.message,"error");}
  }
  function renderTracking(sel,items,type){
    const el=$(sel);if(!el)return;
    if(!items.length){el.innerHTML='<div style="color:var(--dim);font:9px monospace;padding:20px">NO ACTIVE RECORDS</div>';return;}
    el.innerHTML=items.map(x=>{
      const name=escapeHtml(x.username);
      const detail=type==="fkdr"?(x.progress?.current?`FKDR ${x.progress.current.fkdr}`:`${x.snapshots?.length||0} snapshots`):(x.detection?.active?`ACTIVE // ${x.detection.game||"unknown"}`:"IDLE");
      return `<div class="record"><div><b>${name}</b><small>${escapeHtml(detail)}</small></div><button data-stop="${type}" data-user="${name}">STOP</button></div>`;
    }).join("");
    $$(`[data-stop="${type}"]`,el).forEach(b=>b.addEventListener("click",async()=>{
      const endpoint=type==="fkdr"?"/api/fkdr-tracking/remove":"/api/activity-tracking/remove";
      try{await api(endpoint,{method:"POST",body:JSON.stringify({username:b.dataset.user})});toast("Tracking stopped","success");loadTracking();}
      catch(e){toast(e.message,"error");}
    }));
  }

  async function loadPermissions(){
    try{
      const d=await api("/api/permissions"); state.commands=d.availableCommands||[];
      const list=$("#perm-list");
      list.innerHTML=(d.permissions||[]).length?(d.permissions||[]).map(p=>{
        const cmds=p.allowedCommands||p.bannedCommands||[];
        const mode=p.allowedCommands?"ALLOW":"DENY";
        return `<div class="permission"><div class="permission-head"><b>${escapeHtml(p.username)}</b><button class="danger" data-remove-perm="${escapeHtml(p.username)}">RESET</button></div><small style="color:var(--dim);font:8px monospace">${mode}</small><div style="margin-top:7px">${cmds.map(c=>`<code>!${escapeHtml(c)}</code>`).join("")}</div></div>`;
      }).join(""):'<div style="color:var(--dim);font:9px monospace;padding:20px">NO CUSTOM ACCESS RULES</div>';
      $$("[data-remove-perm]",list).forEach(b=>b.addEventListener("click",async()=>{
        try{await api("/api/permissions/remove",{method:"POST",body:JSON.stringify({username:b.dataset.removePerm})});toast("Access rule reset","success");loadPermissions();}
        catch(e){toast(e.message,"error");}
      }));
    }catch(e){toast("Permission load failed: "+e.message,"error");}
  }
  $("#perm-save")?.addEventListener("click",async()=>{
    const username=$("#perm-user").value.trim();
    if(!username){toast("Username required","warning");return;}
    const split=s=>s.split(",").map(x=>x.trim().replace(/^!/,"")).filter(Boolean);
    try{
      await api("/api/permissions/set",{method:"POST",body:JSON.stringify({username,allowedCommands:split($("#perm-allow").value),bannedCommands:split($("#perm-ban").value)})});
      $("#perm-user").value=$("#perm-allow").value=$("#perm-ban").value="";
      toast("Access policy deployed","success");loadPermissions();
    }catch(e){toast(e.message,"error");}
  });

  async function loadPrompt(){
    try{const d=await api("/api/gpt-prompt");$("#ai-prompt").value=d.prompt||"";$("#ai-state").textContent="READY";}
    catch(e){toast("AI directive unavailable: "+e.message,"error");}
  }
  $("#ai-save")?.addEventListener("click",async()=>{
    try{
      $("#ai-state").textContent="DEPLOYING";
      await api("/api/gpt-prompt",{method:"POST",body:JSON.stringify({prompt:$("#ai-prompt").value})});
      $("#ai-state").textContent="DEPLOYED";toast("AI directive deployed","success");
    }catch(e){$("#ai-state").textContent="ERROR";toast(e.message,"error");}
  });

  async function loadSystem(){
    try{
      const d=await api("/api/system-info");
      $("#sys-node").textContent=d.nodeVersion||"—";
      $("#sys-platform").textContent=d.platform||"—";
      $("#sys-pid").textContent=d.pid??"—";
      $("#sys-rss").textContent=(d.rss??"—")+" MB";
      $("#sys-up").textContent=formatUptime((d.uptime||0)*1000);
    }catch(e){toast("System telemetry failed: "+e.message,"error");}
  }
  $("#clear-cache")?.addEventListener("click",async()=>{
    try{await api("/api/cache/clear",{method:"POST"});toast("Cache cleared","success");refreshCore();}
    catch(e){toast(e.message,"error");}
  });
  $("#export-backup")?.addEventListener("click",()=>{window.location.href="/api/export/all";});

  $("#lookup-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const username=$("#lookup").value.trim(); if(!username)return;
    toast("Player analysis endpoint is not exposed by the current backend","warning");
    $("#dossier").classList.remove("hidden");
    $("#d-name").textContent=username;
    $("#d-meta").textContent="Backend player endpoint required";
    $("#d-risk").textContent="UNAVAILABLE";
    $("#d-urchin").textContent="No public /api/player endpoint exists in the current bot.";
  });

  function formatUptime(ms){
    let s=Math.max(0,Math.floor(ms/1000)),d=Math.floor(s/86400);s%=86400;
    let h=Math.floor(s/3600);s%=3600;let m=Math.floor(s/60);
    return d?`${d}d ${h}h ${m}m`:`${h}h ${m}m`;
  }

  function initSocket(){
    if(typeof io!=="function"){appendTerminal("Socket.IO client unavailable","ERROR");return;}
    state.socket=io({transports:["websocket","polling"],reconnection:true,reconnectionAttempts:Infinity});
    state.socket.on("connect",()=>{appendTerminal("Realtime channel established","LINK");toast("Realtime link established","success");});
    state.socket.on("disconnect",()=>appendTerminal("Realtime channel disconnected","LINK"));
    state.socket.on("connect_error",e=>appendTerminal("Socket error: "+e.message,"ERROR"));
    state.socket.on("bot-status",setStatus);
    state.socket.on("minecraft-chat",d=>appendTerminal(typeof d==="string"?d:(d.message||JSON.stringify(d)),"MC"));
    state.socket.on("bot-log",d=>appendTerminal(d.message||d.text||JSON.stringify(d),String(d.type||"LOG").toUpperCase()));
    state.socket.on("stats-update",s=>{
      if(s?.uptime)$("#hero-uptime").textContent="UPTIME "+s.uptime;
      if(s?.commands!=null)$("#m-commands").textContent=Number(s.commands).toLocaleString();
    });
  }

  function palette(){
    const modal=$("#palette"), input=$("#palette-input"), items=$("#palette-items");
    if(!modal||!input||!items)return;
    const actions=[
      ["Open Overview","overview"],["Open Bot Control","bot"],["Open Player Intel","intelligence"],
      ["Open Tracking","tracking"],["Open Access","access"],["Open AI Core","ai"],["Open System","system"]
    ];
    function render(q=""){
      const a=actions.filter(x=>x[0].toLowerCase().includes(q.toLowerCase()));
      items.innerHTML=a.map(x=>`<button data-p="${x[1]}">${x[0]}</button>`).join("");
      $$("button[data-p]",items).forEach(b=>b.onclick=()=>{modal.classList.remove("open");setPage(b.dataset.p);});
    }
    $("#open-palette")?.addEventListener("click",()=>{modal.classList.add("open");input.value="";render();setTimeout(()=>input.focus(),0);});
    modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("open")});
    input.addEventListener("input",()=>render(input.value));
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();modal.classList.add("open");input.focus();render();}
      if(e.key==="Escape")modal.classList.remove("open");
    });
  }

  // Initial UI wiring
  document.addEventListener("DOMContentLoaded",()=>{
    setPage("overview");
    initSocket();
    palette();
    refreshCore();
    loadSystem();
  });
})();
