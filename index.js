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

let panelTheme = {
  primaryColor: '#9333ea',
  secondaryColor: '#3b82f6',
  accentColor: '#ec4899'
};

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
  'flag_add', 'flag_remove', 'check'
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

// === Flag System ===
const flaggedPlayers = new Map();
const FLAGS_FILE = path.join(__dirname, "flagged_players.json");

function loadFlaggedPlayers() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
      Object.entries(data).forEach(([uuid, flag]) => {
        flaggedPlayers.set(uuid, flag);
      });
      console.log(`✅ Loaded ${flaggedPlayers.size} flagged players`);
    }
  } catch (err) {
    console.error('❌ Failed to load flags:', err.message);
  }
}

function saveFlaggedPlayers() {
  try {
    const data = Object.fromEntries(flaggedPlayers);
    fs.writeFileSync(FLAGS_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${flaggedPlayers.size} flags`);
  } catch (err) {
    console.error('❌ Failed to save flags:', err.message);
  }
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

// === Flags API ===
app.get("/api/flags", (req, res) => {
  const flags = Array.from(flaggedPlayers.entries()).map(([uuid, flag]) => ({
    uuid,
    ...flag
  }));
  res.json({ flags, count: flags.length });
});

app.post("/api/flags/add", async (req, res) => {
  const { ign, reason, flaggedBy } = req.body;
  
  try {
    const playerData = await getPlayerUUID(ign);
    flaggedPlayers.set(playerData.uuid, {
      ign: ign,
      uuid: playerData.uuid,
      reason: reason.trim(),
      flaggedBy: flaggedBy || 'Admin',
      timestamp: new Date().toISOString()
    });
    saveFlaggedPlayers();
    
    res.json({ success: true, message: `${ign} flagged successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/flags/remove", (req, res) => {
  const { uuid } = req.body;
  
  if (flaggedPlayers.has(uuid)) {
    const flag = flaggedPlayers.get(uuid);
    flaggedPlayers.delete(uuid);
    saveFlaggedPlayers();
    
    res.json({ success: true, message: `${flag.ign} unflagged successfully` });
  } else {
    res.status(404).json({ success: false, message: 'Player not found' });
  }
});

// === Permissions API ===
app.get("/api/permissions", (req, res) => {
  const perms = Array.from(commandPermissions.entries()).map(([username, perm]) => ({
    username,
    ...perm
  }));
  res.json({ 
    permissions: perms, 
    count: perms.length,
    availableCommands: AVAILABLE_COMMANDS 
  });
});

app.post("/api/permissions/set", (req, res) => {
  const { username, allowedCommands, bannedCommands } = req.body;
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ success: false, message: 'Username required' });
  }
  
  commandPermissions.set(username.toLowerCase(), {
    allowedCommands: allowedCommands || [],
    bannedCommands: bannedCommands || []
  });
  
  saveCommandPermissions();
  res.json({ success: true, message: `Permissions updated for ${username}` });
});

app.post("/api/permissions/remove", (req, res) => {
  const { username } = req.body;
  
  if (commandPermissions.has(username.toLowerCase())) {
    commandPermissions.delete(username.toLowerCase());
    saveCommandPermissions();
    res.json({ success: true, message: `Permissions removed for ${username}` });
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
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white min-h-screen p-6">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect } = React;
    const socket = io();

    function App() {
      const [tab, setTab] = useState('chat');
      const [msg, setMsg] = useState('');
      const [chat, setChat] = useState([]);
      const [logs, setLogs] = useState([]);
      const [stats, setStats] = useState({ uptime: '0h', commands: 0, messages: 0 });
      const [flags, setFlags] = useState([]);
      const [permissions, setPermissions] = useState([]);
      const [availableCommands, setAvailableCommands] = useState([]);
      
      // Flag form
      const [flagIgn, setFlagIgn] = useState('');
      const [flagReason, setFlagReason] = useState('');
      const [flaggedBy, setFlaggedBy] = useState('Admin');
      
      // Permission form
      const [permUsername, setPermUsername] = useState('');
      const [selectedAllowed, setSelectedAllowed] = useState([]);
      const [selectedBanned, setSelectedBanned] = useState([]);
      
      useEffect(() => {
        socket.on('minecraft-chat', d => setChat(p => [...p, d].slice(-100)));
        socket.on('bot-log', d => setLogs(p => [d, ...p].slice(0, 50)));
        socket.on('stats-update', setStats);
        
        fetchFlags();
        fetchPermissions();
        
        return () => {
          socket.off('minecraft-chat');
          socket.off('bot-log');
          socket.off('stats-update');
        };
      }, []);

      const fetchFlags = async () => {
        try {
          const res = await fetch('/api/flags');
          const data = await res.json();
          setFlags(data.flags || []);
        } catch (err) {
          console.error('Failed to fetch flags:', err);
        }
      };

      const fetchPermissions = async () => {
        try {
          const res = await fetch('/api/permissions');
          const data = await res.json();
          setPermissions(data.permissions || []);
          setAvailableCommands(data.availableCommands || []);
        } catch (err) {
          console.error('Failed to fetch permissions:', err);
        }
      };

      const send = async () => {
        if (!msg.trim()) return;
        await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        setMsg('');
      };

      const addFlag = async (e) => {
        e.preventDefault();
        if (!flagIgn.trim() || !flagReason.trim()) {
          alert('IGN and Reason are required!');
          return;
        }
        
        try {
          const res = await fetch('/api/flags/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ign: flagIgn, reason: flagReason, flaggedBy })
          });
          
          const data = await res.json();
          if (data.success) {
            setFlagIgn('');
            setFlagReason('');
            fetchFlags();
            alert('Player flagged successfully!');
          } else {
            alert('Error: ' + data.message);
          }
        } catch (err) {
          alert('Error flagging player');
        }
      };

      const removeFlag = async (uuid) => {
        if (!confirm('Remove this flag?')) return;
        
        try {
          await fetch('/api/flags/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid })
          });
          fetchFlags();
        } catch (err) {
          alert('Error removing flag');
        }
      };

      const setPermission = async (e) => {
        e.preventDefault();
        if (!permUsername.trim()) {
          alert('Username is required!');
          return;
        }
        
        try {
          const res = await fetch('/api/permissions/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: permUsername,
              allowedCommands: selectedAllowed,
              bannedCommands: selectedBanned
            })
          });
          
          const data = await res.json();
          if (data.success) {
            setPermUsername('');
            setSelectedAllowed([]);
            setSelectedBanned([]);
            fetchPermissions();
            alert('Permissions updated successfully!');
          } else {
            alert('Error: ' + data.message);
          }
        } catch (err) {
          alert('Error updating permissions');
        }
      };

      const removePermission = async (username) => {
        if (!confirm(\`Remove permissions for \${username}?\`)) return;
        
        try {
          await fetch('/api/permissions/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
          });
          fetchPermissions();
        } catch (err) {
          alert('Error removing permissions');
        }
      };

      const toggleCommand = (command, type) => {
        if (type === 'allowed') {
          setSelectedAllowed(prev => 
            prev.includes(command) 
              ? prev.filter(c => c !== command)
              : [...prev, command]
          );
        } else {
          setSelectedBanned(prev => 
            prev.includes(command) 
              ? prev.filter(c => c !== command)
              : [...prev, command]
          );
        }
      };

      return (
        <div className="max-w-7xl mx-auto">
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h1 className="text-3xl font-bold mb-4">RumoniumGC Control Panel</h1>
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-700 rounded p-4">
                <div className="text-2xl font-bold">{stats.uptime}</div>
                <div className="text-sm text-gray-400">UPTIME</div>
              </div>
              <div className="bg-gray-700 rounded p-4">
                <div className="text-2xl font-bold">{stats.commands}</div>
                <div className="text-sm text-gray-400">COMMANDS</div>
              </div>
              <div className="bg-gray-700 rounded p-4">
                <div className="text-2xl font-bold">{stats.messages}</div>
                <div className="text-sm text-gray-400">MESSAGES</div>
              </div>
              <div className="bg-gray-700 rounded p-4">
                <div className="text-2xl font-bold">{flags.length}</div>
                <div className="text-sm text-gray-400">FLAGS</div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-2 mb-6 flex gap-2">
            {['chat', 'logs', 'flags', 'permissions'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={\`flex-1 px-4 py-2 rounded font-bold transition-colors \${tab === t ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}\`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              {tab === 'chat' && (
                <div className="bg-gray-800 rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold">LIVE CHAT</h2>
                  </div>
                  <div className="h-96 overflow-y-auto p-4 space-y-2 bg-gray-900">
                    {chat.map((m, i) => (
                      <div key={i} className="bg-gray-800 rounded px-3 py-2 text-sm">
                        <span className="text-gray-500">[{m.time}]</span> {m.message}
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-gray-700">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={msg}
                        onChange={e => setMsg(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && send()}
                        placeholder="Type message..."
                        className="flex-1 bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600"
                      />
                      <button onClick={send} className="px-6 py-2 rounded bg-purple-600 font-bold hover:bg-purple-700">
                        SEND
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'logs' && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-xl font-bold mb-4">LOGS</h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {logs.map((log, i) => (
                      <div key={i} className="bg-gray-700 rounded p-3 text-sm">
                        <span className="text-gray-400">{log.time}</span> - 
                        <span className={\`ml-2 px-2 py-1 rounded text-xs \${
                          log.type === 'error' ? 'bg-red-600' :
                          log.type === 'success' ? 'bg-green-600' :
                          log.type === 'warning' ? 'bg-yellow-600' : 'bg-blue-600'
                        }\`}>{log.type}</span>
                        <div className="mt-1">{log.msg}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'flags' && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-xl font-bold mb-4">FLAGGED PLAYERS</h2>
                  
                  <form onSubmit={addFlag} className="bg-gray-700 rounded-lg p-4 mb-4">
                    <h3 className="font-bold mb-3">Add New Flag</h3>
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Player IGN"
                        value={flagIgn}
                        onChange={e => setFlagIgn(e.target.value)}
                        className="w-full bg-gray-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600"
                      />
                      <input
                        type="text"
                        placeholder="Reason"
                        value={flagReason}
                        onChange={e => setFlagReason(e.target.value)}
                        className="w-full bg-gray-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600"
                      />
                      <input
                        type="text"
                        placeholder="Flagged By (optional)"
                        value={flaggedBy}
                        onChange={e => setFlaggedBy(e.target.value)}
                        className="w-full bg-gray-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600"
                      />
                      <button type="submit" className="w-full bg-purple-600 rounded px-4 py-2 font-bold hover:bg-purple-700">
                        Add Flag
                      </button>
                    </div>
                  </form>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {flags.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">No flagged players</div>
                    ) : (
                      flags.map((flag, i) => (
                        <div key={i} className="bg-gray-700 rounded-lg p-4 border-l-4 border-red-500">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="font-bold text-lg">{flag.ign}</div>
                              <div className="text-xs text-gray-400">UUID: {flag.uuid}</div>
                            </div>
                            <button
                              onClick={() => removeFlag(flag.uuid)}
                              className="px-3 py-1 bg-red-600 rounded text-sm font-bold hover:bg-red-700"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="text-sm mb-1">
                            <span className="text-gray-400">Reason:</span> {flag.reason}
                          </div>
                          <div className="text-xs text-gray-400">
                            Flagged by: {flag.flaggedBy} • {new Date(flag.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'permissions' && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-xl font-bold mb-4">COMMAND PERMISSIONS</h2>
                  
                  <form onSubmit={setPermission} className="bg-gray-700 rounded-lg p-4 mb-4">
                    <h3 className="font-bold mb-3">Set Player Permissions</h3>
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Player Username"
                        value={permUsername}
                        onChange={e => setPermUsername(e.target.value)}
                        className="w-full bg-gray-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm font-bold mb-2 text-green-400">✓ Allowed Commands</div>
                          <div className="bg-gray-600 rounded p-3 space-y-1 max-h-48 overflow-y-auto">
                            {availableCommands.map(cmd => (
                              <label key={cmd} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={selectedAllowed.includes(cmd)}
                                  onChange={() => toggleCommand(cmd, 'allowed')}
                                  className="w-4 h-4 accent-green-500"
                                />
                                <span className="text-sm">{cmd}</span>
                              </label>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-2">
                            If any command is selected here, ONLY these commands will be allowed for this user
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm font-bold mb-2 text-red-400">✗ Banned Commands</div>
                          <div className="bg-gray-600 rounded p-3 space-y-1 max-h-48 overflow-y-auto">
                            {availableCommands.map(cmd => (
                              <label key={cmd} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={selectedBanned.includes(cmd)}
                                  onChange={() => toggleCommand(cmd, 'banned')}
                                  className="w-4 h-4 accent-red-500"
                                />
                                <span className="text-sm">{cmd}</span>
                              </label>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-2">
                            Selected commands will be blocked for this user
                          </div>
                        </div>
                      </div>
                      
                      <button type="submit" className="w-full bg-blue-600 rounded px-4 py-2 font-bold hover:bg-blue-700">
                        Save Permissions
                      </button>
                    </div>
                  </form>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {permissions.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        No custom permissions set
                        <div className="text-sm mt-2">All players can use all commands by default</div>
                      </div>
                    ) : (
                      permissions.map((perm, i) => (
                        <div key={i} className="bg-gray-700 rounded-lg p-4 border-l-4 border-blue-500">
                          <div className="flex justify-between items-start mb-3">
                            <div className="font-bold text-lg">{perm.username}</div>
                            <button
                              onClick={() => removePermission(perm.username)}
                              className="px-3 py-1 bg-red-600 rounded text-sm font-bold hover:bg-red-700"
                            >
                              Remove
                            </button>
                          </div>
                          
                          {perm.allowedCommands && perm.allowedCommands.length > 0 && (
                            <div className="mb-2">
                              <div className="text-xs text-green-400 mb-1 font-semibold">✓ Allowed Commands:</div>
                              <div className="flex flex-wrap gap-1">
                                {perm.allowedCommands.map(cmd => (
                                  <span key={cmd} className="text-xs px-2 py-1 bg-green-600 bg-opacity-30 border border-green-500 rounded">
                                    {cmd}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {perm.bannedCommands && perm.bannedCommands.length > 0 && (
                            <div>
                              <div className="text-xs text-red-400 mb-1 font-semibold">✗ Banned Commands:</div>
                              <div className="flex flex-wrap gap-1">
                                {perm.bannedCommands.map(cmd => (
                                  <span key={cmd} className="text-xs px-2 py-1 bg-red-600 bg-opacity-30 border border-red-500 rounded">
                                    {cmd}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {(!perm.allowedCommands || perm.allowedCommands.length === 0) && 
                           (!perm.bannedCommands || perm.bannedCommands.length === 0) && (
                            <div className="text-sm text-gray-400">No restrictions set</div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">RECENT ACTIVITY</h2>
              <div className="space-y-2 max-h-screen overflow-y-auto">
                {logs.slice(0, 20).map((log, i) => (
                  <div key={i} className="bg-gray-700 rounded p-3 text-xs">
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
  loadFlaggedPlayers();
  loadCommandPermissions();
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
      await safeChat("RumoniumGC by Relaquent, v2.1");
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
        "flag add <user> <reason>",
        "flag remove <user>",
        "check <user>",
        "about - Bot info",
        "----------------"
      ];
      for (const h of help) {
        await safeChat(h);
        await sleep(500);
      }
      return;
    }

    // === !flag add ===
    if (msg.toLowerCase().includes("!flag add")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!flag add\s+([A-Za-z0-9_]{1,16})\s+(.+)/i);
      if (!match) return;
      const [, flagger, ign, reason] = match;
      
      if (!hasCommandPermission(flagger, 'flag_add')) {
        await safeChat(`${flagger}, you don't have permission to use !flag add`);
        addLog('warning', `${flagger} tried to use !flag add but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const playerData = await getPlayerUUID(ign);
        flaggedPlayers.set(playerData.uuid, {
          ign: ign,
          uuid: playerData.uuid,
          reason: reason.trim(),
          flaggedBy: flagger,
          timestamp: new Date().toISOString()
        });
        saveFlaggedPlayers();
        
        await safeChat(`✓ ${ign} flagged: ${reason}`);
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
      }
      return;
    }

    // === !flag remove ===
    if (msg.toLowerCase().includes("!flag remove")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!flag remove\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, remover, ign] = match;
      
      if (!hasCommandPermission(remover, 'flag_remove')) {
        await safeChat(`${remover}, you don't have permission to use !flag remove`);
        addLog('warning', `${remover} tried to use !flag remove but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        let found = false;
        for (const [uuid, flag] of flaggedPlayers.entries()) {
          if (flag.ign?.toLowerCase() === ign.toLowerCase()) {
            flaggedPlayers.delete(uuid);
            saveFlaggedPlayers();
            await safeChat(`✓ ${ign} unflagged`);
            found = true;
            break;
          }
        }
        
        if (!found) {
          await safeChat(`${ign} is not flagged`);
        }
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
      }
      return;
    }

    // === !check ===
    if (msg.toLowerCase().includes("!check")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!check\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, checker, ign] = match;
      
      if (!hasCommandPermission(checker, 'check')) {
        await safeChat(`${checker}, you don't have permission to use !check`);
        addLog('warning', `${checker} tried to use !check but was denied`);
        return;
      }
      
      commandCount++;
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const playerData = await getPlayerUUID(ign);
        const stats = parseBWStats(playerData.fullData);
        
        const flag = flaggedPlayers.get(playerData.uuid);
        
        if (flag) {
          await safeChat(`${ign} | ⭐${stats.star} | FKDR: ${stats.fkdr}`);
          await sleep(500);
          await safeChat(`⚠️ FLAGGED: ${flag.reason} (by ${flag.flaggedBy})`);
        } else {
          await safeChat(`${ign} | ⭐${stats.star} | FKDR: ${stats.fkdr} | ✓ Clean`);
        }
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
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
  saveFlaggedPlayers();
  saveCommandPermissions();
  if (bot) bot.quit();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, saving data...');
  saveFlaggedPlayers();
  saveCommandPermissions();
  if (bot) bot.quit();
  process.exit(0);
});

// Auto-save interval
setInterval(() => {
  saveFlaggedPlayers();
  saveCommandPermissions();
}, 5 * 60 * 1000);

createBot();

