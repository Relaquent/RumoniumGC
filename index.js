const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");
const OpenAI = require("openai");
const http = require("http");
const { Server } = require("socket.io");

// === OpenAI Setup ===
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not found.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Express + Socket.IO ===
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Global State ===
let chatHistory = [];
let gptSystemPrompt = "You're like a Turkish nationalist uncle who answers in the user's language. You answer questions knowledgeably and in a nationalistic manner. If you get a question that's hostile towards Turks, you give them a piece of your mind. You're ironic and witty. You're sincere.";
let panelTheme = {
  primaryColor: '#9333ea',
  secondaryColor: '#3b82f6',
  accentColor: '#ec4899',
  bgStyle: 'gradient',
  glassEffect: true,
  animations: true
};

let botSettings = {
  autoReconnect: true,
  welcomeMessages: true,
  commandCooldown: 45,
  maxTokens: 100,
  chatFilter: { enabled: false, keywords: [], filterMode: 'blacklist' },
  autoResponses: { enabled: true, responses: [] },
  customCommands: [],
  chatLogs: { enabled: true, maxHistory: 500 },
  notifications: { onJoin: true, onLeave: true, onCommand: true },
  performance: { messageDelay: 300, maxMessagesPerSecond: 2, autoReconnectDelay: 10000 }
};

let bot;
let botReady = false;
let startTime = Date.now();
let commandCount = 0;
let messageCount = 0;

// === Hypixel API ===
if (!process.env.HYPIXEL_API_KEY) {
  console.error("❌ HYPIXEL_API_KEY not found.");
  process.exit(1);
}
const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY;
const HYPIXEL_HOST = "mc.hypixel.net";
const MC_VERSION = "1.8.9";

function ratio(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d === 0) return n > 0 ? "inf" : "0.00";
  return (n / d).toFixed(2);
}

function parseBWStats(player) {
  const bw = (player?.stats?.Bedwars) || {};
  const ach = player?.achievements || {};
  const star = ach.bedwars_level ?? Math.floor((bw.Experience || 0) / 5000);
  return {
    star,
    fkdr: ratio(bw.final_kills_bedwars, bw.final_deaths_bedwars),
    kd: ratio(bw.kills_bedwars, bw.deaths_bedwars),
    wl: ratio(bw.wins_bedwars, bw.losses_bedwars),
    finals: bw.final_kills_bedwars || 0,
    wins: bw.wins_bedwars || 0,
    beds: bw.beds_broken_bedwars || 0,
  };
}

async function getPlayerStats(ign) {
  const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data?.success || !data?.player) throw new Error("Player not found");
  return parseBWStats(data.player);
}

// === NEW: Guild GEXP Function ===
async function getGuildGEXP(playerIgn) {
  try {
    // Get player UUID first
    const playerUrl = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(playerIgn)}`;
    const playerRes = await axios.get(playerUrl, { timeout: 10000 });
    if (!playerRes.data?.player) throw new Error("Player not found");
    
    const uuid = playerRes.data.player.uuid;
    
    // Get guild data
    const guildUrl = `https://api.hypixel.net/v2/guild?key=${HYPIXEL_API_KEY}&player=${uuid}`;
    const guildRes = await axios.get(guildUrl, { timeout: 10000 });
    if (!guildRes.data?.guild) throw new Error("Player not in a guild");
    
    const guild = guildRes.data.guild;
    const member = guild.members.find(m => m.uuid === uuid);
    if (!member) throw new Error("Member not found in guild");
    
    // Calculate weekly GEXP
    const expHistory = member.expHistory || {};
    const weeklyGexp = Object.values(expHistory).reduce((sum, exp) => sum + exp, 0);
    
    // Create leaderboard for this week
    const leaderboard = guild.members.map(m => {
      const memberWeeklyGexp = Object.values(m.expHistory || {}).reduce((sum, exp) => sum + exp, 0);
      return { uuid: m.uuid, gexp: memberWeeklyGexp };
    }).sort((a, b) => b.gexp - a.gexp);
    
    const rank = leaderboard.findIndex(m => m.uuid === uuid) + 1;
    
    return {
      weeklyGexp,
      rank,
      totalMembers: guild.members.length
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === Routes ===
app.get("/", (req, res) => res.send("✅ Bot is running!"));

app.get("/api/theme", (req, res) => res.json(panelTheme));
app.post("/api/theme", (req, res) => {
  panelTheme = { ...panelTheme, ...req.body };
  io.emit('bot-log', { time: new Date().toLocaleTimeString(), type: 'success', msg: 'Theme updated' });
  res.json({ success: true });
});

app.get("/api/settings", (req, res) => res.json(botSettings));
app.post("/api/settings", (req, res) => {
  botSettings = { ...botSettings, ...req.body };
  io.emit('bot-log', { time: new Date().toLocaleTimeString(), type: 'success', msg: 'Settings updated' });
  res.json({ success: true });
});

app.get("/api/gpt-prompt", (req, res) => res.json({ prompt: gptSystemPrompt }));
app.post("/api/gpt-prompt", (req, res) => {
  gptSystemPrompt = req.body.prompt;
  io.emit('bot-log', { time: new Date().toLocaleTimeString(), type: 'success', msg: 'GPT prompt updated' });
  res.json({ success: true });
});

app.post("/chat", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).send("❌ Message required.");
  if (bot && botReady && bot.chat && bot._client) {
    try {
      bot.chat(message);
      io.emit('bot-log', { time: new Date().toLocaleTimeString(), type: 'info', msg: `Web: ${message}` });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: "❌ Error" });
    }
  } else {
    res.status(500).json({ success: false, message: "❌ Bot not ready" });
  }
});

// === Optimized Control Panel ===
app.get("/control", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RumoniumGC Control Panel</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
    * { font-family: 'Inter', sans-serif; }
    .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); }
    .scroll::-webkit-scrollbar { width: 6px; }
    .scroll::-webkit-scrollbar-thumb { background: #9333ea; border-radius: 10px; }
  </style>
</head>
<body class="bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white min-h-screen p-6">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;
    const socket = io();

    function App() {
      const [tab, setTab] = useState('chat');
      const [msg, setMsg] = useState('');
      const [chat, setChat] = useState([]);
      const [logs, setLogs] = useState([]);
      const [stats, setStats] = useState({ uptime: '0h', commands: 0, messages: 0, users: 0 });
      const [status, setStatus] = useState('online');
      const chatRef = useRef(null);

      useEffect(() => {
        socket.on('minecraft-chat', d => setChat(p => [...p, d].slice(-500)));
        socket.on('bot-log', d => setLogs(p => [d, ...p].slice(0, 100)));
        socket.on('bot-status', setStatus);
        socket.on('stats-update', setStats);
        return () => {
          socket.off('minecraft-chat');
          socket.off('bot-log');
          socket.off('bot-status');
          socket.off('stats-update');
        };
      }, []);

      useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }, [chat]);

      const send = async () => {
        if (!msg.trim()) return;
        await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        setMsg('');
      };

      return (
        <div className="max-w-7xl mx-auto">
          <div className="glass rounded-3xl p-6 mb-6">
            <div className="flex items-center justify-between">
              <h1 className="text-4xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                RumoniumGC
              </h1>
              <div className="flex items-center gap-4">
                <div className="glass rounded-xl px-4 py-2 flex items-center gap-2">
                  <div className={\`w-2 h-2 rounded-full \${status === 'online' ? 'bg-green-400' : 'bg-red-400'}\`}></div>
                  <span className="text-sm font-bold uppercase">{status}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-6">
              {[
                { label: 'UPTIME', value: stats.uptime },
                { label: 'COMMANDS', value: stats.commands },
                { label: 'MESSAGES', value: stats.messages },
                { label: 'USERS', value: stats.users }
              ].map((s, i) => (
                <div key={i} className="glass rounded-xl p-4">
                  <div className="text-2xl font-black">{s.value}</div>
                  <div className="text-xs text-gray-400 font-bold">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-3xl p-2 mb-6 flex gap-2">
            {['chat', 'settings', 'logs'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={\`flex-1 px-6 py-3 rounded-xl font-bold transition-all \${tab === t ? 'bg-gradient-to-r from-purple-600 to-blue-600' : 'hover:bg-white/5'}\`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              {tab === 'chat' && (
                <div className="glass rounded-3xl overflow-hidden">
                  <div className="p-4 border-b border-white/10">
                    <h2 className="text-xl font-black">LIVE CHAT</h2>
                  </div>
                  <div ref={chatRef} className="h-96 overflow-y-auto scroll p-4 space-y-2 bg-black/30">
                    {chat.map((m, i) => (
                      <div key={i} className="glass rounded-xl px-4 py-2 text-sm">
                        <span className="text-gray-500 mr-2">[{m.time}]</span>
                        <span className="text-green-400">{m.message}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-white/10">
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={msg}
                        onChange={e => setMsg(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && send()}
                        placeholder="Type message..."
                        className="flex-1 bg-black/30 border-2 border-purple-500/30 rounded-xl px-4 py-3 focus:outline-none"
                      />
                      <button
                        onClick={send}
                        className="px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600"
                      >
                        SEND
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'settings' && (
                <div className="glass rounded-3xl p-6">
                  <h2 className="text-2xl font-black mb-4">SETTINGS</h2>
                  <p className="text-gray-400">Configure bot settings via API endpoints</p>
                </div>
              )}

              {tab === 'logs' && (
                <div className="glass rounded-3xl p-6">
                  <h2 className="text-2xl font-black mb-4">LOGS</h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                    {logs.map((log, i) => (
                      <div key={i} className={\`glass rounded-xl p-3 text-sm border \${
                        log.type === 'error' ? 'border-red-500/50' :
                        log.type === 'success' ? 'border-green-500/50' : 'border-white/10'
                      }\`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-400">{log.time}</span>
                          <span className="text-xs px-2 py-1 rounded-full bg-white/10">{log.type}</span>
                        </div>
                        <div>{log.msg}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="glass rounded-3xl p-6">
              <h2 className="text-xl font-black mb-4">ACTIVITY</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                {logs.slice(0, 10).map((log, i) => (
                  <div key={i} className="glass rounded-xl p-3 text-xs">
                    <div className="text-gray-400 mb-1">{log.time}</div>
                    <div className="text-gray-200">{log.msg}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</body>
</html>`);
});

// === Socket.IO ===
io.on('connection', (socket) => {
  console.log('👤 Client connected');
  socket.on('disconnect', () => console.log('👤 Client disconnected'));
});

setInterval(() => {
  const uptime = Date.now() - startTime;
  const h = Math.floor(uptime / 3600000);
  const m = Math.floor((uptime % 3600000) / 60000);
  io.emit('stats-update', {
    uptime: `${h}h ${m}m`,
    commands: commandCount,
    messages: messageCount,
    users: Object.keys(bot?.players || {}).length
  });
}, 5000);

server.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// === Bot ===
const askCooldowns = {};
const welcomeMessages = [
  "Hey! Welcome back {username}!",
  "Welcome back, {username}! The legend has returned!",
  "{username} has joined, hello!"
];

function createBot() {
  bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft",
  });

  bot.once("spawn", () => {
    console.log("✅ Connected to Hypixel");
    io.emit('bot-status', 'connecting');
    setTimeout(() => {
      if (bot?.chat) {
        bot.chat("/chat g");
        setTimeout(() => {
          botReady = true;
          io.emit('bot-status', 'online');
        }, 2000);
      }
    }, 1500);
    setInterval(() => bot?.chat && bot.chat("/locraw"), 60000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    io.emit('minecraft-chat', { time: new Date().toLocaleTimeString(), message: msg });
    messageCount++;

    if (!msg.startsWith("Guild >") || !botReady) return;

    const safeChat = async (m) => {
      if (!botReady || !bot?.chat) return;
      try { bot.chat(m); } catch (e) { console.error(e); }
    };

    // === !gexp command ===
    if (msg.toLowerCase().includes("!gexp")) {
      const match = msg.match(/!gexp\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const gexpData = await getGuildGEXP(ign);
        const line = `${ign} | Weekly GEXP: ${gexpData.weeklyGexp.toLocaleString()} | Rank: #${gexpData.rank}/${gexpData.totalMembers}`;
        await safeChat(line);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!gexp executed for ${ign}`
        });
      } catch (err) {
        await safeChat(`Error - ${ign} | ${err.message}`);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'error',
          msg: `!gexp error: ${err.message}`
        });
      }
      return;
    }

    // === !ask command ===
    if (msg.toLowerCase().includes("!ask")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!ask\s+(.+)/i);
      if (!match) return;
      const [, username, userMessage] = match;
      commandCount++;

      if (username.toLowerCase() !== "relaquent") {
        const now = Date.now();
        const lastUsed = askCooldowns[username] || 0;
        const timePassed = now - lastUsed;
        if (timePassed < botSettings.commandCooldown * 1000) {
          const sec = Math.ceil((botSettings.commandCooldown * 1000 - timePassed) / 1000);
          await safeChat(`${username}, wait ${sec}s`);
          return;
        }
        askCooldowns[username] = now;
      }

      await safeChat("Thinking...");
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: gptSystemPrompt },
            { role: "user", content: userMessage }
          ],
          max_tokens: botSettings.maxTokens,
        });
        const reply = completion.choices[0].message.content.trim();
        const lines = reply.split("\n").filter(l => l.trim());
        for (const line of lines) {
          for (let i = 0; i < line.length; i += 600) {
            await safeChat(line.slice(i, i + 600));
            await sleep(botSettings.performance.messageDelay);
          }
        }
      } catch (err) {
        await safeChat("GPT error");
      }
      return;
    }

    // === Welcome ===
    if (msg.includes("joined.") && botSettings.welcomeMessages) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}) joined\./);
      if (match) {
        const username = match[1];
        await sleep(2000);
        if (username.toLowerCase() === "caillou16") {
          await safeChat("Welcome back Caillou16 the bald.");
        } else {
          const m = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
          await safeChat(m.replace("{username}", username));
        }
      }
      return;
    }

    // === !bw ===
    if (msg.toLowerCase().includes("!bw")) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      if (ign.toLowerCase() === "relaquent") {
        await safeChat("Relaquent | Star: 3628 | FKDR: 48.72 | KD: 2.32 | WL: 2.86");
        return;
      }
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`);
      } catch {
        await safeChat(`Error - ${ign} | No data`);
      }
      return;
    }

    // === !stats ===
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins} | Beds: ${stats.beds}`);
      } catch {
        await safeChat(`Error - ${ign}`);
      }
      return;
    }

    // === !when ===
    if (msg.toLowerCase().includes("!when")) {
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      const first = new Date("2025-11-22T00:00:00Z");
      const now = new Date();
      let diff = now - first;
      let cycles = Math.floor(diff / (56 * 86400000));
      if (diff < 0) cycles = -1;
      const next = new Date(first.getTime() + (cycles + 1) * 56 * 86400000);
      const days = Math.ceil((next - now) / 86400000);
      await safeChat(days > 0 ? `Castle in ${days} days (${next.toDateString()})` : "Castle today!");
      return;
    }

    // === !about ===
    if (msg.toLowerCase().includes("!about")) {
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      await safeChat("RumoniumGC by Relaquent, v2.0");
      return;
    }

    // === !help ===
    if (msg.toLowerCase().includes("!help")) {
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      const help = [
        "--- RumoniumGC ---",
        "bw <user> - Bedwars stats",
        "gexp <user> - Weekly GEXP & rank",
        "when - Next Castle",
        "ask <msg> - Ask AI",
        "about - Bot info"
      ];
      for (const h of help) {
        await safeChat(h);
        await sleep(500);
      }
      return;
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Kicked:", reason);
    botReady = false;
    io.emit('bot-status', 'offline');
    if (botSettings.autoReconnect) setTimeout(createBot, botSettings.performance.autoReconnectDelay);
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected");
    botReady = false;
    io.emit('bot-status', 'offline');
    if (botSettings.autoReconnect) setTimeout(createBot, botSettings.performance.autoReconnectDelay);
  });

  bot.on("error", (err) => {
    console.error("❌", err.message);
    botReady = false;
  });
}

createBot();
