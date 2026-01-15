const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");
const OpenAI = require("openai");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

// === OpenAI Setup ===
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not found.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Urchin API Setup ===
if (!process.env.URCHIN_API_KEY) {
  console.error("❌ URCHIN_API_KEY not found.");
  process.exit(1);
}
const URCHIN_API_KEY = process.env.URCHIN_API_KEY;
const URCHIN_API_URL = "https://urchin-app-mnc2x.ondigitalocean.app/api/player";

// === Express + Socket.IO ===
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Logging Directory Setup ===
const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// === Global State ===
let chatHistory = [];
let gptSystemPrompt = `You are an uncle who answers in the user's language. You are knowledgeable, witty, ironic, and sincere. If someone is hostile towards Turks, you give them a piece of your mind.

Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}

IMPORTANT: Your training data is from October 2023. When users ask about current events, tell them your data is from October 2023.

Keep responses under 500 characters for Minecraft chat compatibility.`;

let botSettings = {
  autoReconnect: true,
  welcomeMessages: true,
  commandCooldown: 45,
  maxTokens: 100,
  performance: { messageDelay: 300, autoReconnectDelay: 15000 }
};

// === Command Permissions System ===
const commandPermissions = new Map();
const PERMISSIONS_FILE = path.join(__dirname, "command_permissions.json");

const AVAILABLE_COMMANDS = [
  'bw', 'gexp', 'stats', 'when', 'ask', 'about', 'help',
  'fkdr', 'nfkdr', 'view'
];

function loadCommandPermissions() {
  try {
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
      Object.entries(data).forEach(([username, perms]) => {
        commandPermissions.set(username.toLowerCase(), perms);
      });
      console.log(`✅ Loaded permissions for ${commandPermissions.size} users`);
    }
  } catch (err) {
    console.error('❌ Failed to load permissions:', err.message);
  }
}

function saveCommandPermissions() {
  try {
    const data = Object.fromEntries(commandPermissions);
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${commandPermissions.size} permission entries`);
  } catch (err) {
    console.error('❌ Failed to save permissions:', err.message);
  }
}

function hasCommandPermission(username, command) {
  const userPerms = commandPermissions.get(username.toLowerCase());
  if (!userPerms) return true;
  
  if (userPerms.bannedCommands && userPerms.bannedCommands.includes(command)) {
    return false;
  }
  
  if (userPerms.allowedCommands && userPerms.allowedCommands.length > 0) {
    return userPerms.allowedCommands.includes(command);
  }
  
  return true;
}

let bot;
let botReady = false;
let startTime = Date.now();
let commandCount = 0;
let messageCount = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// === API Rate Limiting ===
const API_QUEUE = [];
let isProcessingQueue = false;
let apiCallCount = 0;
let apiCallResetTime = Date.now();
const MAX_CALLS_PER_MINUTE = 100;
const MIN_CALL_DELAY = 600;

async function queueApiRequest(requestFn, retries = 3) {
  return new Promise((resolve, reject) => {
    API_QUEUE.push({ requestFn, resolve, reject, retries });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || API_QUEUE.length === 0) return;
  
  isProcessingQueue = true;
  
  while (API_QUEUE.length > 0) {
    const now = Date.now();
    
    if (now - apiCallResetTime > 60000) {
      apiCallCount = 0;
      apiCallResetTime = now;
    }
    
    if (apiCallCount >= MAX_CALLS_PER_MINUTE) {
      const waitTime = 60000 - (now - apiCallResetTime);
      await sleep(waitTime);
      apiCallCount = 0;
      apiCallResetTime = Date.now();
    }
    
    const { requestFn, resolve, reject, retries } = API_QUEUE.shift();
    
    try {
      const result = await requestFn();
      apiCallCount++;
      resolve(result);
      await sleep(MIN_CALL_DELAY);
    } catch (err) {
      if (retries > 0 && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        console.log(`⚠️ Retrying API call (${retries} attempts left)`);
        API_QUEUE.unshift({ requestFn, resolve, reject, retries: retries - 1 });
        await sleep(2000);
      } else {
        reject(err);
      }
    }
  }
  
  isProcessingQueue = false;
}

// === Detailed Logging ===
let detailedLogs = [];

function addLog(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    time: new Date().toLocaleTimeString(),
    type,
    message
  };

  detailedLogs.unshift(logEntry);
  if (detailedLogs.length > 500) detailedLogs.pop();

  io.emit('bot-log', {
    time: logEntry.time,
    type: logEntry.type,
    msg: logEntry.message
  });
}

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

// === FKDR Tracking System ===
const fkdrTracking = new Map();
const FKDR_TRACKING_FILE = path.join(__dirname, "fkdr_tracking.json");

function loadFkdrTracking() {
  try {
    if (fs.existsSync(FKDR_TRACKING_FILE)) {
      const data = JSON.parse(fs.readFileSync(FKDR_TRACKING_FILE, 'utf8'));
      Object.entries(data).forEach(([username, tracking]) => {
        fkdrTracking.set(username.toLowerCase(), tracking);
      });
      console.log(`✅ Loaded FKDR tracking for ${fkdrTracking.size} players`);
    }
  } catch (err) {
    console.error('❌ Failed to load FKDR tracking:', err.message);
  }
}

function saveFkdrTracking() {
  try {
    const data = Object.fromEntries(fkdrTracking);
    fs.writeFileSync(FKDR_TRACKING_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved FKDR tracking for ${fkdrTracking.size} players`);
  } catch (err) {
    console.error('❌ Failed to save FKDR tracking:', err.message);
  }
}

async function startFkdrTracking(username) {
  try {
    const playerData = await getPlayerUUID(username);
    const stats = parseBWStats(playerData.fullData);
    
    const now = new Date();
    const tracking = {
      username: username,
      uuid: playerData.uuid,
      startDate: now.toISOString(),
      snapshots: [
        {
          timestamp: now.toISOString(),
          finals: stats.finals,
          deaths: stats.deaths,
          fkdr: parseFloat(stats.fkdr)
        }
      ]
    };
    
    fkdrTracking.set(username.toLowerCase(), tracking);
    saveFkdrTracking();
    return true;
  } catch (err) {
    console.error('Failed to start FKDR tracking:', err);
    throw err;
  }
}

async function updateFkdrSnapshot(username) {
  const tracking = fkdrTracking.get(username.toLowerCase());
  if (!tracking) return null;
  
  try {
    const playerData = await getPlayerUUID(username);
    const stats = parseBWStats(playerData.fullData);
    
    const now = new Date();
    tracking.snapshots.push({
      timestamp: now.toISOString(),
      finals: stats.finals,
      deaths: stats.deaths,
      fkdr: parseFloat(stats.fkdr)
    });
    
    const ninetyDaysAgo = now.getTime() - (90 * 24 * 60 * 60 * 1000);
    tracking.snapshots = tracking.snapshots.filter(s => 
      new Date(s.timestamp).getTime() > ninetyDaysAgo
    );
    
    fkdrTracking.set(username.toLowerCase(), tracking);
    saveFkdrTracking();
    return tracking;
  } catch (err) {
    console.error('Failed to update FKDR snapshot:', err);
    return null;
  }
}

function calculateFkdrProgress(tracking) {
  if (!tracking || tracking.snapshots.length < 2) {
    return null;
  }
  
  const now = new Date();
  const snapshots = tracking.snapshots;
  const latest = snapshots[snapshots.length - 1];
  
  const oneDayAgo = now.getTime() - (24 * 60 * 60 * 1000);
  const dailySnapshot = snapshots.filter(s => 
    new Date(s.timestamp).getTime() >= oneDayAgo
  )[0];
  
  const oneWeekAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
  const weeklySnapshot = snapshots.filter(s => 
    new Date(s.timestamp).getTime() >= oneWeekAgo
  )[0];
  
  const oneMonthAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);
  const monthlySnapshot = snapshots.filter(s => 
    new Date(s.timestamp).getTime() >= oneMonthAgo
  )[0];
  
  const calculateChange = (old, current) => {
    if (!old) return null;
    const finalsDiff = current.finals - old.finals;
    const deathsDiff = current.deaths - old.deaths;
    const fkdrChange = current.fkdr - old.fkdr;
    
    return {
      finals: finalsDiff,
      deaths: deathsDiff,
      fkdr: fkdrChange.toFixed(2),
      sessionFkdr: deathsDiff > 0 ? (finalsDiff / deathsDiff).toFixed(2) : finalsDiff > 0 ? 'inf' : '0.00'
    };
  };
  
  return {
    current: latest,
    daily: calculateChange(dailySnapshot, latest),
    weekly: calculateChange(weeklySnapshot, latest),
    monthly: calculateChange(monthlySnapshot, latest)
  };
}

function stopFkdrTracking(username) {
  if (fkdrTracking.has(username.toLowerCase())) {
    fkdrTracking.delete(username.toLowerCase());
    saveFkdrTracking();
    return true;
  }
  return false;
}

// === Urchin API ===
async function checkUrchinBlacklist(username) {
  try {
    const response = await axios.get(`${URCHIN_API_URL}/${username}`, {
      headers: {
        'Authorization': `Bearer ${URCHIN_API_KEY}`
      },
      timeout: 10000
    });

    if (response.data && response.data.player) {
      const player = response.data.player;
      
      if (player.blacklisted) {
        let result = `${username} - ${player.status || 'Blacklisted'}`;
        
        if (player.reason) {
          result += `\n"${player.reason}"`;
        }
        
        if (player.addedBy) {
          const timeAgo = player.addedAt ? getTimeAgo(player.addedAt) : '';
          result += `\n* Added by ${player.addedBy}${timeAgo ? ' ' + timeAgo : ''}`;
        }
        
        return result;
      } else {
        return `${username} is not in the blacklist.`;
      }
    } else {
      return `${username} is not in the blacklist.`;
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return `${username} is not in the blacklist.`;
    }
    throw new Error('Urchin API error');
  }
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// === Cache System ===
class SmartCache {
  constructor() {
    this.playerDataCache = new Map();
    this.guildCache = new Map();
    this.PLAYER_CACHE_DURATION = 10 * 60 * 1000;
    this.GUILD_CACHE_DURATION = 5 * 60 * 1000;
  }

  getPlayer(ign) {
    const cached = this.playerDataCache.get(ign.toLowerCase());
    if (cached && (Date.now() - cached.timestamp) < this.PLAYER_CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  setPlayer(ign, data) {
    this.playerDataCache.set(ign.toLowerCase(), {
      data,
      timestamp: Date.now()
    });
  }

  getGuild(ign) {
    const cached = this.guildCache.get(ign.toLowerCase());
    if (cached && (Date.now() - cached.timestamp) < this.GUILD_CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  setGuild(ign, data) {
    this.guildCache.set(ign.toLowerCase(), {
      data,
      timestamp: Date.now()
    });
  }

  clearAll() {
    this.playerDataCache.clear();
    this.guildCache.clear();
  }
}

const cache = new SmartCache();

async function getPlayerUUID(ign) {
  const cachedPlayer = cache.getPlayer(ign);
  if (cachedPlayer) return cachedPlayer;

  return queueApiRequest(async () => {
    const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data?.success || !data?.player) throw new Error("Player not found");
    
    const result = {
      uuid: data.player.uuid,
      fullData: data.player
    };
    
    cache.setPlayer(ign, result);
    return result;
  });
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
    deaths: bw.final_deaths_bedwars || 0,
    wins: bw.wins_bedwars || 0,
    beds: bw.beds_broken_bedwars || 0,
  };
}

async function getPlayerStats(ign) {
  const cachedPlayer = cache.getPlayer(ign);
  if (cachedPlayer && cachedPlayer.fullData) {
    return parseBWStats(cachedPlayer.fullData);
  }

  return queueApiRequest(async () => {
    const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data?.success || !data?.player) throw new Error("Player not found");
    
    const playerData = {
      uuid: data.player.uuid,
      fullData: data.player
    };
    cache.setPlayer(ign, playerData);
    
    return parseBWStats(data.player);
  });
}

async function getGuildGEXP(playerIgn) {
  const cachedGuild = cache.getGuild(playerIgn);
  if (cachedGuild) return cachedGuild;

  return queueApiRequest(async () => {
    const playerUrl = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(playerIgn)}`;
    const playerRes = await axios.get(playerUrl, { timeout: 10000 });
    if (!playerRes.data?.player) throw new Error("Player not found");
    
    const uuid = playerRes.data.player.uuid;
    await sleep(MIN_CALL_DELAY);
    
    const guildUrl = `https://api.hypixel.net/v2/guild?key=${HYPIXEL_API_KEY}&player=${uuid}`;
    const guildRes = await axios.get(guildUrl, { timeout: 10000 });
    if (!guildRes.data?.guild) throw new Error("Player not in a guild");
    
    const guild = guildRes.data.guild;
    const member = guild.members.find(m => m.uuid === uuid);
    if (!member) throw new Error("Member not found in guild");
    
    const expHistory = member.expHistory || {};
    const weeklyGexp = Object.values(expHistory).reduce((sum, exp) => sum + exp, 0);
    
    const leaderboard = guild.members.map(m => {
      const memberWeeklyGexp = Object.values(m.expHistory || {}).reduce((sum, exp) => sum + exp, 0);
      return { uuid: m.uuid, gexp: memberWeeklyGexp };
    }).sort((a, b) => b.gexp - a.gexp);
    
    const rank = leaderboard.findIndex(m => m.uuid === uuid) + 1;
    
    const result = {
      weeklyGexp,
      rank,
      totalMembers: guild.members.length
    };
    
    cache.setGuild(playerIgn, result);
    return result;
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === API Routes ===
app.get("/", (req, res) => res.send("✅ Bot is running!"));

app.get("/api/settings", (req, res) => res.json(botSettings));
app.post("/api/settings", (req, res) => {
  botSettings = { ...botSettings, ...req.body };
  res.json({ success: true });
});

app.get("/api/gpt-prompt", (req, res) => res.json({ prompt: gptSystemPrompt }));
app.post("/api/gpt-prompt", (req, res) => {
  gptSystemPrompt = req.body.prompt;
  res.json({ success: true });
});

app.get("/api/stats", (req, res) => {
  res.json({
    queueLength: API_QUEUE.length,
    apiCallCount,
    cacheSize: cache.playerDataCache.size + cache.guildCache.size
  });
});

app.get("/api/fkdr-tracking", (req, res) => {
  const tracking = Array.from(fkdrTracking.entries()).map(([username, data]) => ({
    username,
    ...data,
    progress: calculateFkdrProgress(data)
  }));
  res.json({ tracking, count: tracking.length });
});

app.post("/api/fkdr-tracking/remove", (req, res) => {
  const { username } = req.body;
  
  if (fkdrTracking.has(username.toLowerCase())) {
    stopFkdrTracking(username);
    res.json({ success: true, message: `FKDR tracking removed for ${username}` });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

app.post("/chat", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).send("❌ Message required.");
  if (bot && botReady && bot.chat) {
    try {
      bot.chat(message);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: "❌ Error" });
    }
  } else {
    res.status(500).json({ success: false, message: "❌ Bot not ready" });
  }
});

// === Web Panel ===
app.get("/control", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RumoniumGC Control</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white min-h-screen p-6">
  <div class="max-w-6xl mx-auto">
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <h1 class="text-3xl font-bold mb-4 text-purple-400">RumoniumGC Control Panel</h1>
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-2xl font-bold text-purple-400" id="uptime">0h 0m</div>
          <div class="text-sm text-gray-400">UPTIME</div>
        </div>
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-2xl font-bold text-blue-400" id="commands">0</div>
          <div class="text-sm text-gray-400">COMMANDS</div>
        </div>
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-2xl font-bold text-green-400" id="messages">0</div>
          <div class="text-sm text-gray-400">MESSAGES</div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <div class="col-span-2">
        <div class="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
          <div class="p-4 border-b border-gray-700">
            <h2 class="text-xl font-bold">LIVE CHAT</h2>
          </div>
          <div id="chat" class="h-96 overflow-y-auto p-4 space-y-2 bg-gray-900/50"></div>
          <div class="p-4 border-t border-gray-700">
            <div class="flex gap-2">
              <input type="text" id="msgInput" placeholder="Type message..." 
                class="flex-1 bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600 border border-gray-600">
              <button onclick="sendMsg()" class="px-6 py-2 rounded bg-purple-600 font-bold hover:bg-purple-700">SEND</button>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 class="text-xl font-bold mb-4">LOGS</h2>
        <div id="logs" class="space-y-2 max-h-screen overflow-y-auto"></div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    
    socket.on('minecraft-chat', d => {
      const chat = document.getElementById('chat');
      const div = document.createElement('div');
      div.className = 'bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700';
      div.innerHTML = \`<span class="text-gray-500">[\${d.time}]</span> \${d.message}\`;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    });
    
    socket.on('bot-log', d => {
      const logs = document.getElementById('logs');
      const div = document.createElement('div');
      div.className = 'bg-gray-700 rounded p-3 text-xs border border-gray-600';
      const colors = {error: 'bg-red-600', success: 'bg-green-600', warning: 'bg-yellow-600', info: 'bg-blue-600'};
      div.innerHTML = \`
        <span class="text-gray-400">\${d.time}</span>
        <span class="ml-2 px-2 py-1 rounded text-xs font-semibold \${colors[d.type] || 'bg-blue-600'}">\${d.type}</span>
        <div class="mt-1">\${d.msg}</div>
      \`;
      logs.insertBefore(div, logs.firstChild);
      if (logs.children.length > 20) logs.removeChild(logs.lastChild);
    });
    
    socket.on('stats-update', s => {
      document.getElementById('uptime').textContent = s.uptime;
      document.getElementById('commands').textContent = s.commands;
      document.getElementById('messages').textContent = s.messages;
    });
    
    async function sendMsg() {
      const input = document.getElementById('msgInput');
      const msg = input.value.trim();
      if (!msg) return;
      
      await fetch('/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg})
      });
      
      input.value = '';
    }
    
    document.getElementById('msgInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMsg();
    });
  </script>
</body>
</html>`);
});

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
    messages: messageCount
  });
}, 5000);

server.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  loadCommandPermissions();
  loadFkdrTracking();
});

// === Bot Implementation ===
const askCooldowns = {};
const welcomeMessages = [
  "Hey! Welcome back {username}!",
  "Welcome back, {username}! The legend has returned!",
  "{username} has joined, hello!"
];

function createBot() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('❌ Max reconnection attempts reached. Stopping.');
    addLog('error', 'Max reconnection attempts reached');
    return;
  }
  
  reconnectAttempts++;
  addLog('info', `Creating bot (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  
  bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft",
    checkTimeoutInterval: 30000,
    hideErrors: false
  });

  bot.once("spawn", () => {
    console.log("✅ Connected to Hypixel");
    addLog('success', 'Bot spawned on Hypixel');
    reconnectAttempts = 0;
    io.emit('bot-status', 'connecting');
    
    setTimeout(() => {
      if (bot?.chat) {
        bot.chat("/chat g");
        addLog('info', 'Joined guild chat');
        setTimeout(() => {
          botReady = true;
          io.emit('bot-status', 'online');
          addLog('success', 'Bot is ready');
        }, 2000);
      }
    }, 1500);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    io.emit('minecraft-chat', { time: new Date().toLocaleTimeString(), message: msg });
    messageCount++;

    if (!msg.startsWith("Guild >") || !botReady) return;

    const safeChat = async (m) => {
      if (!botReady || !bot?.chat) return;
      try { 
        bot.chat(m);
      } catch (e) { 
        console.error('Chat error:', e.message);
      }
    };

    // === !gexp ===
    if (msg.toLowerCase().includes("!gexp")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!gexp\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      if (!hasCommandPermission(requester, 'gexp')) {
        await safeChat(`${requester}, you don't have permission to use !gexp`);
        addLog('warning', `${requester} tried to use !gexp but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const gexpData = await getGuildGEXP(ign);
        await safeChat(`${ign} | Weekly GEXP: ${gexpData.weeklyGexp.toLocaleString()} | Rank: #${gexpData.rank}/${gexpData.totalMembers}`);
      } catch (err) {
        await safeChat(`Error - ${ign} | ${err.message}`);
      }
      return;
    }

    // === !ask ===
    if (msg.toLowerCase().includes("!ask")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!ask\s+(.+)/i);
      if (!match) return;
      const [, username, userMessage] = match;
      
      if (!hasCommandPermission(username, 'ask')) {
        await safeChat(`${username}, you don't have permission to use !ask`);
        addLog('warning', `${username} tried to use !ask but was denied`);
        return;
      }
      
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
          temperature: 0.8,
        });

        let reply = completion.choices[0].message.content.trim();
        if (reply.length > 600) reply = reply.substring(0, 597) + '...';
        
        const lines = reply.split("\n").filter(l => l.trim());
        for (const line of lines) {
          for (let i = 0; i < line.length; i += 600) {
            await safeChat(line.slice(i, i + 600));
            await sleep(botSettings.performance.messageDelay);
          }
        }
      } catch (err) {
        await safeChat("GPT error - try again");
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
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      if (!hasCommandPermission(requester, 'bw')) {
        await safeChat(`${requester}, you don't have permission to use !bw`);
        addLog('warning', `${requester} tried to use !bw but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`);
      } catch (err) {
        await safeChat(`Error - ${ign}`);
      }
      return;
    }

    // === !stats ===
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      if (!hasCommandPermission(requester, 'stats')) {
        await safeChat(`${requester}, you don't have permission to use !stats`);
        addLog('warning', `${requester} tried to use !stats but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins} | Beds: ${stats.beds}`);
      } catch (err) {
        await safeChat(`Error - ${ign}`);
      }
      return;
    }

    // === !when ===
    if (msg.toLowerCase().includes("!when")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      if (!hasCommandPermission(requester, 'when')) {
        await safeChat(`${requester}, you don't have permission to use !when`);
        addLog('warning', `${requester} tried to use !when but was denied`);
        return;
      }
      
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
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      if (!hasCommandPermission(requester, 'about')) {
        await safeChat(`${requester}, you don't have permission to use !about`);
        addLog('warning', `${requester} tried to use !about but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      await safeChat("RumoniumGC by Relaquent, v2.2 - Urchin Integration");
      return;
    }

    // === !help ===
    if (msg.toLowerCase().includes("!help")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      if (!hasCommandPermission(requester, 'help')) {
        await safeChat(`${requester}, you don't have permission to use !help`);
        addLog('warning', `${requester} tried to use !help but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      const help = [
        "--- Rumonium ---",
        "bw <user> - Bedwars stats",
        "gexp <user> - Weekly GEXP",
        "stats <user> - Detailed stats",
        "when - Next Castle",
        "ask <msg> - Ask AI",
        "view <user> - Check Urchin",
        "fkdr start - Start tracking",
        "fkdr - View progress",
        "fkdr stop - Stop tracking",
        "nfkdr [user] - Next FKDR calc",
        "about - Bot info",
        "----------------"
      ];
      for (const h of help) {
        await safeChat(h);
        await sleep(500);
      }
      return;
    }

    // === !view ===
    if (msg.toLowerCase().includes("!view")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!view\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      if (!hasCommandPermission(requester, 'view')) {
        await safeChat(`${requester}, you don't have permission to use !view`);
        addLog('warning', `${requester} tried to use !view but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const result = await checkUrchinBlacklist(ign);
        const lines = result.split('\n');
        
        for (const line of lines) {
          if (line.trim()) {
            await safeChat(line.trim());
            await sleep(500);
          }
        }
        
        addLog('info', `${requester} checked ${ign} on Urchin`);
      } catch (err) {
        await safeChat(`Error checking Urchin: ${err.message}`);
        addLog('error', `Urchin check failed for ${ign}: ${err.message}`);
      }
      return;
    }

    // === !fkdr ===
    if (msg.toLowerCase().includes("!fkdr")) {
      const matchStart = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr\s+start/i);
      const matchStop = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr\s+stop/i);
      const matchStatus = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr(?:\s+)?$/i);
      
      if (!matchStart && !matchStop && !matchStatus) return;
      
      const requester = (matchStart || matchStop || matchStatus)[1];
      
      if (!hasCommandPermission(requester, 'fkdr')) {
        await safeChat(`${requester}, you don't have permission to use !fkdr`);
        addLog('warning', `${requester} tried to use !fkdr but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      if (matchStart) {
        try {
          if (fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, your FKDR is already being tracked!`);
            return;
          }
          
          await startFkdrTracking(requester);
          await safeChat(`✓ Started tracking FKDR for ${requester}!`);
          await sleep(500);
          await safeChat(`Use !fkdr to view your progress anytime`);
          addLog('success', `Started FKDR tracking for ${requester}`);
        } catch (err) {
          await safeChat(`Error starting tracking: ${err.message}`);
          addLog('error', `Failed to start FKDR tracking for ${requester}: ${err.message}`);
        }
        return;
      }
      
      if (matchStop) {
        try {
          if (!fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, you don't have active FKDR tracking!`);
            return;
          }
          
          stopFkdrTracking(requester);
          await safeChat(`✓ Stopped FKDR tracking for ${requester}`);
          addLog('info', `Stopped FKDR tracking for ${requester}`);
        } catch (err) {
          await safeChat(`Error stopping tracking: ${err.message}`);
        }
        return;
      }
      
      if (matchStatus) {
        try {
          if (!fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, use !fkdr start to begin tracking`);
            return;
          }
          
          const tracking = await updateFkdrSnapshot(requester);
          if (!tracking) {
            await safeChat(`Error updating FKDR data`);
            return;
          }
          
          const progress = calculateFkdrProgress(tracking);
          
          if (!progress) {
            await safeChat(`${requester}, not enough data yet. Try again later!`);
            return;
          }
          
          await safeChat(`${requester} | Current FKDR: ${progress.current.fkdr}`);
          await sleep(500);
          
          if (progress.daily) {
            const dailySign = progress.daily.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Daily: ${dailySign}${progress.daily.fkdr} FKDR | Session: ${progress.daily.sessionFkdr} | Finals: ${progress.daily.finals}`);
            await sleep(500);
          }
          
          if (progress.weekly) {
            const weeklySign = progress.weekly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Weekly: ${weeklySign}${progress.weekly.fkdr} FKDR | Session: ${progress.weekly.sessionFkdr} | Finals: ${progress.weekly.finals}`);
            await sleep(500);
          }
          
          if (progress.monthly) {
            const monthlySign = progress.monthly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Monthly: ${monthlySign}${progress.monthly.fkdr} FKDR | Session: ${progress.monthly.sessionFkdr} | Finals: ${progress.monthly.finals}`);
          }
          
          addLog('info', `${requester} checked their FKDR progress`);
        } catch (err) {
          await safeChat(`Error: ${err.message}`);
          addLog('error', `FKDR status error for ${requester}: ${err.message}`);
        }
        return;
      }
    }

    // === !nfkdr ===
    if (msg.toLowerCase().includes("!nfkdr")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!nfkdr(?:\s+([A-Za-z0-9_]{1,16}))?/i);
      if (!match) return;
      const [, requester, targetIgn] = match;
      const ign = targetIgn || requester;
      
      if (!hasCommandPermission(requester, 'nfkdr')) {
        await safeChat(`${requester}, you don't have permission to use !nfkdr`);
        addLog('warning', `${requester} tried to use !nfkdr but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const stats = await getPlayerStats(ign);
        const currentFkdr = parseFloat(stats.fkdr);
        const currentFinals = stats.finals;
        const currentDeaths = stats.deaths;
        
        const nextWholeFkdr = Math.ceil(currentFkdr);
        const targetFkdr = currentFkdr % 1 === 0 ? currentFkdr + 1 : nextWholeFkdr;
        const finalsNeeded = Math.ceil((targetFkdr * currentDeaths) - currentFinals);
        
        if (finalsNeeded <= 0) {
          await safeChat(`${ign} is already at ${currentFkdr} FKDR!`);
        } else {
          await safeChat(`${ign} | Current: ${currentFkdr} FKDR | Target: ${targetFkdr}.00`);
          await sleep(500);
          await safeChat(`Finals needed: ${finalsNeeded} (no deaths)`);
        }
        
        addLog('info', `${requester} checked nfkdr for ${ign}`);
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
        addLog('error', `NFKDR error for ${ign}: ${err.message}`);
      }
      return;
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Kicked:", reason);
    botReady = false;
    io.emit('bot-status', 'offline');
    addLog('error', `Kicked: ${reason}`);
    
    if (botSettings.autoReconnect) {
      const delay = botSettings.performance.autoReconnectDelay;
      console.log(`⏳ Reconnecting in ${delay/1000}s...`);
      setTimeout(createBot, delay);
    }
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected");
    botReady = false;
    io.emit('bot-status', 'offline');
    addLog('warning', 'Bot disconnected');
    
    if (botSettings.autoReconnect) {
      const delay = botSettings.performance.autoReconnectDelay;
      console.log(`⏳ Reconnecting in ${delay/1000}s...`);
      setTimeout(createBot, delay);
    }
  });

  bot.on("error", (err) => {
    console.error("❌", err.message);
    botReady = false;
    addLog('error', `Bot error: ${err.message}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, saving data...');
  saveCommandPermissions();
  saveFkdrTracking();
  if (bot) bot.quit();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, saving data...');
  saveCommandPermissions();
  saveFkdrTracking();
  if (bot) bot.quit();
  process.exit(0);
});

// Auto-save interval
setInterval(() => {
  saveCommandPermissions();
  saveFkdrTracking();
}, 5 * 60 * 1000);

// Auto-update FKDR snapshots every 6 hours
setInterval(async () => {
  console.log('📊 Updating FKDR snapshots...');
  let updated = 0;
  
  for (const [username, tracking] of fkdrTracking.entries()) {
    try {
      await updateFkdrSnapshot(username);
      updated++;
      await sleep(2000);
    } catch (err) {
      console.error(`Failed to update FKDR for ${username}:`, err.message);
    }
  }
  
  console.log(`✅ Updated ${updated} FKDR snapshots`);
  addLog('info', `Updated ${updated} FKDR snapshots`);
}, 6 * 60 * 60 * 1000);

createBot();

