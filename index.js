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
  'flag_add', 'flag_remove', 'check', 'fkdr'
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
    
    // Keep only last 90 days of snapshots
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
  
  // Daily (24 hours ago)
  const oneDayAgo = now.getTime() - (24 * 60 * 60 * 1000);
  const dailySnapshot = snapshots.filter(s => 
    new Date(s.timestamp).getTime() >= oneDayAgo
  )[0];
  
  // Weekly (7 days ago)
  const oneWeekAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
  const weeklySnapshot = snapshots.filter(s => 
    new Date(s.timestamp).getTime() >= oneWeekAgo
  )[0];
  
  // Monthly (30 days ago)
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

// === Get Guild Members ===
async function getGuildMembers() {
  try {
    const guildUrl = `https://api.hypixel.net/v2/guild?key=${HYPIXEL_API_KEY}&name=Rumonium`;
    const { data } = await axios.get(guildUrl, { timeout: 10000 });
    
    if (!data?.guild) return [];
    
    // Get member names from UUID
    const members = await Promise.all(
      data.guild.members.slice(0, 50).map(async (member) => {
        try {
          const playerUrl = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&uuid=${member.uuid}`;
          const playerRes = await axios.get(playerUrl, { timeout: 5000 });
          return {
            uuid: member.uuid,
            username: playerRes.data?.player?.displayname || 'Unknown'
          };
        } catch {
          return { uuid: member.uuid, username: 'Unknown' };
        }
      })
    );
    
    return members.filter(m => m.username !== 'Unknown');
  } catch (err) {
    console.error('Failed to fetch guild members:', err.message);
    return [];
  }
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

// === Guild Members API ===
app.get("/api/guild-members", async (req, res) => {
  try {
    const members = await getGuildMembers();
    res.json({ members, count: members.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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

// === FKDR Tracking API ===
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
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .minecraft-head {
      image-rendering: pixelated;
      image-rendering: -moz-crisp-edges;
      image-rendering: crisp-edges;
    }
    .player-card {
      transition: all 0.2s ease;
    }
    .player-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(0,0,0,0.3);
    }
    .search-input {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
    }
  </style>
</head>
<body class="bg-gray-900 text-white min-h-screen p-6">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect } = React;
    const socket = io();

    // Minecraft Head Component
    function MinecraftHead({ username, size = 48 }) {
      return (
        <img 
          src={\`https://mc-heads.net/avatar/\${username}/\${size}\`}
          alt={username}
          className="minecraft-head rounded border-2 border-gray-600"
          width={size}
          height={size}
        />
      );
    }

    function App() {
      const [tab, setTab] = useState('chat');
      const [msg, setMsg] = useState('');
      const [chat, setChat] = useState([]);
      const [logs, setLogs] = useState([]);
      const [stats, setStats] = useState({ uptime: '0h', commands: 0, messages: 0 });
      const [flags, setFlags] = useState([]);
      const [permissions, setPermissions] = useState([]);
      const [availableCommands, setAvailableCommands] = useState([]);
      const [guildMembers, setGuildMembers] = useState([]);
      const [fkdrTracking, setFkdrTracking] = useState([]);
      
      // Flag form
      const [flagIgn, setFlagIgn] = useState('');
      const [flagReason, setFlagReason] = useState('');
      const [flaggedBy, setFlaggedBy] = useState('Admin');
      const [flagSearch, setFlagSearch] = useState('');
      
      // Permission form
      const [permUsername, setPermUsername] = useState('');
      const [selectedAllowed, setSelectedAllowed] = useState([]);
      const [selectedBanned, setSelectedBanned] = useState([]);
      const [permSearch, setPermSearch] = useState('');
      const [showGuildMembers, setShowGuildMembers] = useState(false);
      
      // FKDR tracking
      const [fkdrSearch, setFkdrSearch] = useState('');
      
      useEffect(() => {
        socket.on('minecraft-chat', d => setChat(p => [...p, d].slice(-100)));
        socket.on('bot-log', d => setLogs(p => [d, ...p].slice(0, 50)));
        socket.on('stats-update', setStats);
        
        fetchFlags();
        fetchPermissions();
        fetchGuildMembers();
        fetchFkdrTracking();
        
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

      const fetchGuildMembers = async () => {
        try {
          const res = await fetch('/api/guild-members');
          const data = await res.json();
          setGuildMembers(data.members || []);
        } catch (err) {
          console.error('Failed to fetch guild members:', err);
        }
      };

      const fetchFkdrTracking = async () => {
        try {
          const res = await fetch('/api/fkdr-tracking');
          const data = await res.json();
          setFkdrTracking(data.tracking || []);
        } catch (err) {
          console.error('Failed to fetch FKDR tracking:', err);
        }
      };

      const removeFkdrTracking = async (username) => {
        if (!confirm(\`Remove FKDR tracking for \${username}?\`)) return;
        
        try {
          await fetch('/api/fkdr-tracking/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
          });
          fetchFkdrTracking();
        } catch (err) {
          alert('Error removing FKDR tracking');
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
            setShowGuildMembers(false);
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

      const selectMember = (username) => {
        setPermUsername(username);
        setShowGuildMembers(false);
      };

      const filteredFlags = flags.filter(flag => 
        flag.ign.toLowerCase().includes(flagSearch.toLowerCase()) ||
        flag.reason.toLowerCase().includes(flagSearch.toLowerCase())
      );

      const filteredPermissions = permissions.filter(perm =>
        perm.username.toLowerCase().includes(permSearch.toLowerCase())
      );

      const filteredMembers = guildMembers.filter(member =>
        member.username.toLowerCase().includes(permUsername.toLowerCase())
      );

      return (
        <div className="max-w-7xl mx-auto">
          <div className="bg-gradient-to-br from-purple-900 via-gray-800 to-gray-900 rounded-lg p-6 mb-6 border border-purple-500/30">
            <h1 className="text-3xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              RumoniumGC Control Panel
            </h1>
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-800/80 backdrop-blur rounded-lg p-4 border border-gray-700/50">
                <div className="text-2xl font-bold text-purple-400">{stats.uptime}</div>
                <div className="text-sm text-gray-400">UPTIME</div>
              </div>
              <div className="bg-gray-800/80 backdrop-blur rounded-lg p-4 border border-gray-700/50">
                <div className="text-2xl font-bold text-blue-400">{stats.commands}</div>
                <div className="text-sm text-gray-400">COMMANDS</div>
              </div>
              <div className="bg-gray-800/80 backdrop-blur rounded-lg p-4 border border-gray-700/50">
                <div className="text-2xl font-bold text-green-400">{stats.messages}</div>
                <div className="text-sm text-gray-400">MESSAGES</div>
              </div>
              <div className="bg-gray-800/80 backdrop-blur rounded-lg p-4 border border-gray-700/50">
                <div className="text-2xl font-bold text-red-400">{flags.length}</div>
                <div className="text-sm text-gray-400">FLAGS</div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800/80 backdrop-blur rounded-lg p-2 mb-6 flex gap-2 border border-gray-700/50">
            {['chat', 'logs', 'flags', 'permissions', 'fkdr'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={\`flex-1 px-4 py-2 rounded font-bold transition-all \${
                  tab === t 
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg' 
                    : 'bg-gray-700/50 hover:bg-gray-600/50'
                }\`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              {tab === 'chat' && (
                <div className="bg-gray-800/80 backdrop-blur rounded-lg overflow-hidden border border-gray-700/50">
                  <div className="p-4 border-b border-gray-700 bg-gradient-to-r from-purple-900/50 to-gray-800">
                    <h2 className="text-xl font-bold">LIVE CHAT</h2>
                  </div>
                  <div className="h-96 overflow-y-auto p-4 space-y-2 bg-gray-900/50">
                    {chat.map((m, i) => (
                      <div key={i} className="bg-gray-800/80 backdrop-blur rounded px-3 py-2 text-sm border border-gray-700/30">
                        <span className="text-gray-500">[{m.time}]</span> {m.message}
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-gray-700 bg-gray-800/50">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={msg}
                        onChange={e => setMsg(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && send()}
                        placeholder="Type message..."
                        className="flex-1 bg-gray-700/80 backdrop-blur rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600 border border-gray-600"
                      />
                      <button onClick={send} className="px-6 py-2 rounded bg-gradient-to-r from-purple-600 to-pink-600 font-bold hover:from-purple-700 hover:to-pink-700 shadow-lg">
                        SEND
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'logs' && (
                <div className="bg-gray-800/80 backdrop-blur rounded-lg p-6 border border-gray-700/50">
                  <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">LOGS</h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {logs.map((log, i) => (
                      <div key={i} className="bg-gray-700/80 backdrop-blur rounded p-3 text-sm border border-gray-600/30">
                        <span className="text-gray-400">{log.time}</span> - 
                        <span className={\`ml-2 px-2 py-1 rounded text-xs font-semibold \${
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
                <div className="bg-gray-800/80 backdrop-blur rounded-lg p-6 border border-gray-700/50">
                  <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
                    FLAGGED PLAYERS
                  </h2>
                  
                  <form onSubmit={addFlag} className="bg-gray-700/80 backdrop-blur rounded-lg p-4 mb-4 border border-gray-600/50">
                    <h3 className="font-bold mb-3">Add New Flag</h3>
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Player IGN"
                        value={flagIgn}
                        onChange={e => setFlagIgn(e.target.value)}
                        className="w-full bg-gray-600/80 backdrop-blur rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-500"
                      />
                      <input
                        type="text"
                        placeholder="Reason"
                        value={flagReason}
                        onChange={e => setFlagReason(e.target.value)}
                        className="w-full bg-gray-600/80 backdrop-blur rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-500"
                      />
                      <input
                        type="text"
                        placeholder="Flagged By (optional)"
                        value={flaggedBy}
                        onChange={e => setFlaggedBy(e.target.value)}
                        className="w-full bg-gray-600/80 backdrop-blur rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-500"
                      />
                      <button type="submit" className="w-full bg-gradient-to-r from-red-600 to-orange-600 rounded px-4 py-2 font-bold hover:from-red-700 hover:to-orange-700 shadow-lg">
                        Add Flag
                      </button>
                    </div>
                  </form>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 Search flagged players..."
                      value={flagSearch}
                      onChange={e => setFlagSearch(e.target.value)}
                      className="w-full search-input rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600"
                    />
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {filteredFlags.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        {flagSearch ? 'No matching players found' : 'No flagged players'}
                      </div>
                    ) : (
                      filteredFlags.map((flag, i) => (
                        <div key={i} className="player-card bg-gray-700/80 backdrop-blur rounded-lg p-4 border-l-4 border-red-500 shadow-lg">
                          <div className="flex items-start gap-4">
                            <MinecraftHead username={flag.ign} size={64} />
                            <div className="flex-1">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="font-bold text-lg">{flag.ign}</div>
                                  <div className="text-xs text-gray-400 font-mono">UUID: {flag.uuid}</div>
                                </div>
                                <button
                                  onClick={() => removeFlag(flag.uuid)}
                                  className="px-3 py-1 bg-red-600 rounded text-sm font-bold hover:bg-red-700 shadow-md"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="text-sm mb-1 bg-gray-800/50 rounded p-2 border border-gray-600/30">
                                <span className="text-gray-400">Reason:</span> 
                                <span className="ml-2 text-red-300">{flag.reason}</span>
                              </div>
                              <div className="text-xs text-gray-400">
                                Flagged by: <span className="text-purple-400">{flag.flaggedBy}</span> • 
                                <span className="ml-1">{new Date(flag.timestamp).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'permissions' && (
                <div className="bg-gray-800/80 backdrop-blur rounded-lg p-6 border border-gray-700/50">
                  <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                    COMMAND PERMISSIONS
                  </h2>
                  
                  <form onSubmit={setPermission} className="bg-gray-700/80 backdrop-blur rounded-lg p-4 mb-4 border border-gray-600/50">
                    <h3 className="font-bold mb-3">Set Player Permissions</h3>
                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Player Username (type to search guild members)"
                          value={permUsername}
                          onChange={e => {
                            setPermUsername(e.target.value);
                            setShowGuildMembers(e.target.value.length > 0);
                          }}
                          onFocus={() => permUsername && setShowGuildMembers(true)}
                          className="w-full bg-gray-600/80 backdrop-blur rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600 border border-gray-500"
                        />
                        
                        {showGuildMembers && filteredMembers.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-gray-700 rounded-lg border border-gray-600 shadow-xl max-h-60 overflow-y-auto">
                            {filteredMembers.slice(0, 10).map(member => (
                              <button
                                key={member.uuid}
                                type="button"
                                onClick={() => selectMember(member.username)}
                                className="w-full flex items-center gap-3 p-3 hover:bg-gray-600 transition-colors text-left"
                              >
                                <MinecraftHead username={member.username} size={32} />
                                <span className="font-semibold">{member.username}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm font-bold mb-2 text-green-400">✓ Allowed Commands</div>
                          <div className="bg-gray-600/80 backdrop-blur rounded p-3 space-y-1 max-h-48 overflow-y-auto border border-gray-500">
                            {availableCommands.map(cmd => (
                              <label key={cmd} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-2 rounded transition-colors">
                                <input
                                  type="checkbox"
                                  checked={selectedAllowed.includes(cmd)}
                                  onChange={() => toggleCommand(cmd, 'allowed')}
                                  className="w-4 h-4 accent-green-500"
                                />
                                <span className="text-sm font-mono">{cmd}</span>
                              </label>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-2">
                            If any command is selected, ONLY these will be allowed
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm font-bold mb-2 text-red-400">✗ Banned Commands</div>
                          <div className="bg-gray-600/80 backdrop-blur rounded p-3 space-y-1 max-h-48 overflow-y-auto border border-gray-500">
                            {availableCommands.map(cmd => (
                              <label key={cmd} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-2 rounded transition-colors">
                                <input
                                  type="checkbox"
                                  checked={selectedBanned.includes(cmd)}
                                  onChange={() => toggleCommand(cmd, 'banned')}
                                  className="w-4 h-4 accent-red-500"
                                />
                                <span className="text-sm font-mono">{cmd}</span>
                              </label>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-2">
                            Selected commands will be blocked
                          </div>
                        </div>
                      </div>
                      
                      <button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 rounded px-4 py-2 font-bold hover:from-blue-700 hover:to-purple-700 shadow-lg">
                        Save Permissions
                      </button>
                    </div>
                  </form>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 Search permissions..."
                      value={permSearch}
                      onChange={e => setPermSearch(e.target.value)}
                      className="w-full search-input rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600 border border-gray-600"
                    />
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {filteredPermissions.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        {permSearch ? 'No matching players found' : 
                          <div>
                            <div>No custom permissions set</div>
                            <div className="text-sm mt-2">All players can use all commands by default</div>
                          </div>
                        }
                      </div>
                    ) : (
                      filteredPermissions.map((perm, i) => (
                        <div key={i} className="player-card bg-gray-700/80 backdrop-blur rounded-lg p-4 border-l-4 border-blue-500 shadow-lg">
                          <div className="flex items-start gap-4">
                            <MinecraftHead username={perm.username} size={56} />
                            <div className="flex-1">
                              <div className="flex justify-between items-start mb-3">
                                <div className="font-bold text-lg">{perm.username}</div>
                                <button
                                  onClick={() => removePermission(perm.username)}
                                  className="px-3 py-1 bg-red-600 rounded text-sm font-bold hover:bg-red-700 shadow-md"
                                >
                                  Remove
                                </button>
                              </div>
                              
                              {perm.allowedCommands && perm.allowedCommands.length > 0 && (
                                <div className="mb-2 bg-green-900/20 rounded p-2 border border-green-600/30">
                                  <div className="text-xs text-green-400 mb-1 font-semibold">✓ Allowed Commands:</div>
                                  <div className="flex flex-wrap gap-1">
                                    {perm.allowedCommands.map(cmd => (
                                      <span key={cmd} className="text-xs px-2 py-1 bg-green-600/30 border border-green-500 rounded font-mono">
                                        {cmd}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {perm.bannedCommands && perm.bannedCommands.length > 0 && (
                                <div className="bg-red-900/20 rounded p-2 border border-red-600/30">
                                  <div className="text-xs text-red-400 mb-1 font-semibold">✗ Banned Commands:</div>
                                  <div className="flex flex-wrap gap-1">
                                    {perm.bannedCommands.map(cmd => (
                                      <span key={cmd} className="text-xs px-2 py-1 bg-red-600/30 border border-red-500 rounded font-mono">
                                        {cmd}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {(!perm.allowedCommands || perm.allowedCommands.length === 0) && 
                               (!perm.bannedCommands || perm.bannedCommands.length === 0) && (
                                <div className="text-sm text-gray-400 italic">No restrictions set</div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'fkdr' && (
                <div className="bg-gray-800/80 backdrop-blur rounded-lg p-6 border border-gray-700/50">
                  <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                    FKDR TRACKING
                  </h2>
                  
                  <div className="bg-gray-700/80 backdrop-blur rounded-lg p-4 mb-4 border border-gray-600/50">
                    <div className="text-sm text-gray-300 mb-2">
                      📊 Active Tracking: <span className="font-bold text-yellow-400">{fkdrTracking.length}</span> players
                    </div>
                    <div className="text-xs text-gray-400">
                      Players can use <span className="font-mono bg-gray-600 px-2 py-1 rounded">!fkdr start</span> in game to begin tracking their FKDR progress.
                      Stats are automatically updated every 6 hours.
                    </div>
                  </div>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 Search tracked players..."
                      value={fkdrSearch}
                      onChange={e => setFkdrSearch(e.target.value)}
                      className="w-full search-input rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-600 border border-gray-600"
                    />
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {fkdrTracking
                      .filter(track => track.username.toLowerCase().includes(fkdrSearch.toLowerCase()))
                      .length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        {fkdrSearch ? 'No matching players found' : 'No active FKDR tracking'}
                      </div>
                    ) : (
                      fkdrTracking
                        .filter(track => track.username.toLowerCase().includes(fkdrSearch.toLowerCase()))
                        .map((track, i) => {
                          const progress = track.progress;
                          const hasData = progress && (progress.daily || progress.weekly || progress.monthly);
                          
                          return (
                            <div key={i} className="player-card bg-gray-700/80 backdrop-blur rounded-lg p-4 border-l-4 border-yellow-500 shadow-lg">
                              <div className="flex items-start gap-4">
                                <MinecraftHead username={track.username} size={64} />
                                <div className="flex-1">
                                  <div className="flex justify-between items-start mb-3">
                                    <div>
                                      <div className="font-bold text-lg">{track.username}</div>
                                      <div className="text-xs text-gray-400">
                                        Started: {new Date(track.startDate).toLocaleDateString()}
                                      </div>
                                      {progress?.current && (
                                        <div className="text-sm mt-1">
                                          Current FKDR: <span className="font-bold text-yellow-400">{progress.current.fkdr}</span>
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => removeFkdrTracking(track.username)}
                                      className="px-3 py-1 bg-red-600 rounded text-sm font-bold hover:bg-red-700 shadow-md"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                  
                                  {hasData ? (
                                    <div className="space-y-2">
                                      {progress.daily && (
                                        <div className="bg-blue-900/20 rounded p-2 border border-blue-600/30">
                                          <div className="text-xs font-semibold text-blue-400 mb-1">📈 Daily Progress</div>
                                          <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div>
                                              <span className="text-gray-400">FKDR:</span>
                                              <span className={\`ml-1 font-bold \${progress.daily.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.daily.fkdr >= 0 ? '+' : ''}{progress.daily.fkdr}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Session:</span>
                                              <span className="ml-1 font-bold text-cyan-400">{progress.daily.sessionFkdr}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Finals:</span>
                                              <span className="ml-1 font-bold text-purple-400">+{progress.daily.finals}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      
                                      {progress.weekly && (
                                        <div className="bg-green-900/20 rounded p-2 border border-green-600/30">
                                          <div className="text-xs font-semibold text-green-400 mb-1">📊 Weekly Progress</div>
                                          <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div>
                                              <span className="text-gray-400">FKDR:</span>
                                              <span className={\`ml-1 font-bold \${progress.weekly.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.weekly.fkdr >= 0 ? '+' : ''}{progress.weekly.fkdr}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Session:</span>
                                              <span className="ml-1 font-bold text-cyan-400">{progress.weekly.sessionFkdr}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Finals:</span>
                                              <span className="ml-1 font-bold text-purple-400">+{progress.weekly.finals}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      
                                      {progress.monthly && (
                                        <div className="bg-purple-900/20 rounded p-2 border border-purple-600/30">
                                          <div className="text-xs font-semibold text-purple-400 mb-1">📅 Monthly Progress</div>
                                          <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div>
                                              <span className="text-gray-400">FKDR:</span>
                                              <span className={\`ml-1 font-bold \${progress.monthly.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.monthly.fkdr >= 0 ? '+' : ''}{progress.monthly.fkdr}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Session:</span>
                                              <span className="ml-1 font-bold text-cyan-400">{progress.monthly.sessionFkdr}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-400">Finals:</span>
                                              <span className="ml-1 font-bold text-purple-400">+{progress.monthly.finals}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-sm text-gray-400 italic bg-gray-800/50 rounded p-2">
                                      Not enough data yet. Check back after playing some games!
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gray-800/80 backdrop-blur rounded-lg p-6 border border-gray-700/50">
              <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                RECENT ACTIVITY
              </h2>
              <div className="space-y-2 max-h-screen overflow-y-auto">
                {logs.slice(0, 20).map((log, i) => (
                  <div key={i} className="bg-gray-700/80 backdrop-blur rounded p-3 text-xs border border-gray-600/30">
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
        "fkdr start - Start tracking",
        "fkdr - View progress",
        "fkdr stop - Stop tracking",
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
      
      // !fkdr start
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
      
      // !fkdr stop
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
      
      // !fkdr (status)
      if (matchStatus) {
        try {
          if (!fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, use !fkdr start to begin tracking`);
            return;
          }
          
          // Update snapshot before showing stats
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
  saveFkdrTracking();
  if (bot) bot.quit();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, saving data...');
  saveFlaggedPlayers();
  saveCommandPermissions();
  saveFkdrTracking();
  if (bot) bot.quit();
  process.exit(0);
});

// Auto-save interval
setInterval(() => {
  saveFlaggedPlayers();
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
      await sleep(2000); // Rate limiting
    } catch (err) {
      console.error(`Failed to update FKDR for ${username}:`, err.message);
    }
  }
  
  console.log(`✅ Updated ${updated} FKDR snapshots`);
  addLog('info', `Updated ${updated} FKDR snapshots`);
}, 6 * 60 * 60 * 1000); // Every 6 hours

createBot();
