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
  'flag_add', 'flag_remove', 'check', 'fkdr', 'nfkdr'
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

// === Cache System ===
class SmartCache {
  constructor() {
    this.playerDataCache = new Map();
    this.guildCache = new Map();
    this.guildMembersCache = null;
    this.guildMembersCacheTime = 0;
    this.PLAYER_CACHE_DURATION = 10 * 60 * 1000;
    this.GUILD_CACHE_DURATION = 5 * 60 * 1000;
    this.GUILD_MEMBERS_CACHE_DURATION = 15 * 60 * 1000;
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

  getGuildMembers() {
    if (this.guildMembersCache && (Date.now() - this.guildMembersCacheTime) < this.GUILD_MEMBERS_CACHE_DURATION) {
      return this.guildMembersCache;
    }
    return null;
  }

  setGuildMembers(members) {
    this.guildMembersCache = members;
    this.guildMembersCacheTime = Date.now();
  }

  clearAll() {
    this.playerDataCache.clear();
    this.guildCache.clear();
    this.guildMembersCache = null;
    this.guildMembersCacheTime = 0;
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
    losses: bw.losses_bedwars || 0,
    beds: bw.beds_broken_bedwars || 0,
    kills: bw.kills_bedwars || 0,
    bedwarsDeaths: bw.deaths_bedwars || 0,
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
  const cached = cache.getGuildMembers();
  if (cached) {
    console.log('✅ Using cached guild members');
    return cached;
  }

  try {
    console.log('🔄 Fetching guild members from API...');
    const guildUrl = `https://api.hypixel.net/v2/guild?key=${HYPIXEL_API_KEY}&name=Rumonium`;
    const { data } = await axios.get(guildUrl, { timeout: 15000 });
    
    if (!data?.guild) return [];
    
    console.log(`📊 Found ${data.guild.members.length} members, fetching details...`);
    
    const members = [];
    const batchSize = 10;
    
    for (let i = 0; i < data.guild.members.length; i += batchSize) {
      const batch = data.guild.members.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (member) => {
        try {
          const playerUrl = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&uuid=${member.uuid}`;
          const playerRes = await axios.get(playerUrl, { timeout: 5000 });
          
          if (playerRes.data?.player) {
            const stats = parseBWStats(playerRes.data.player);
            const expHistory = member.expHistory || {};
            const weeklyGexp = Object.values(expHistory).reduce((sum, exp) => sum + exp, 0);
            
            return {
              uuid: member.uuid,
              username: playerRes.data.player.displayname || 'Unknown',
              rank: member.rank || 'Member',
              joined: member.joined,
              weeklyGexp: weeklyGexp,
              stats: stats
            };
          }
        } catch (err) {
          console.error(`Failed to fetch player ${member.uuid}:`, err.message);
        }
        return null;
      });
      
      const batchResults = await Promise.all(batchPromises);
      members.push(...batchResults.filter(m => m !== null));
      
      await sleep(1000);
      console.log(`✅ Processed ${Math.min(i + batchSize, data.guild.members.length)}/${data.guild.members.length} members`);
    }
    
    console.log(`✅ Successfully loaded ${members.length} guild members`);
    cache.setGuildMembers(members);
    return members;
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
    cacheSize: cache.playerDataCache.size + cache.guildCache.size,
    detailedStats: {
      uptime: Date.now() - startTime,
      commands: commandCount,
      messages: messageCount,
      reconnects: reconnectAttempts,
      flags: flaggedPlayers.size,
      tracking: fkdrTracking.size,
      permissions: commandPermissions.size
    }
  });
});

// === Guild Members API ===
app.get("/api/guild-members", async (req, res) => {
  try {
    const members = await getGuildMembers();
    res.json({ 
      members, 
      count: members.length,
      cached: cache.guildMembersCache !== null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/guild-members/refresh", async (req, res) => {
  try {
    cache.guildMembersCache = null;
    cache.guildMembersCacheTime = 0;
    const members = await getGuildMembers();
    res.json({ success: true, count: members.length });
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

// === Logs API ===
app.get("/api/logs", (req, res) => {
  res.json({ logs: detailedLogs, count: detailedLogs.length });
});

app.get("/api/logs/download", (req, res) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `rumonium-logs-${timestamp}.json`;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    exportDate: new Date().toISOString(),
    totalLogs: detailedLogs.length,
    logs: detailedLogs
  });
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
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RumoniumGC Control Panel</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    
    * {
      font-family: 'Inter', sans-serif;
    }
    
    .minecraft-head {
      image-rendering: pixelated;
      image-rendering: -moz-crisp-edges;
      image-rendering: crisp-edges;
    }
    
    .glass-effect {
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .stat-card {
      transition: all 0.3s ease;
    }
    
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
    }
    
    .glow-purple {
      box-shadow: 0 0 20px rgba(147, 51, 234, 0.3);
    }
    
    .glow-blue {
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
    }
    
    .glow-green {
      box-shadow: 0 0 20px rgba(34, 197, 94, 0.3);
    }
    
    .glow-red {
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
    }
    
    .pulse {
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    
    .gradient-bg {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .custom-scrollbar::-webkit-scrollbar {
      width: 8px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-track {
      background: rgba(31, 41, 55, 0.5);
      border-radius: 4px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(147, 51, 234, 0.5);
      border-radius: 4px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(147, 51, 234, 0.7);
    }
  </style>
</head>
<body class="bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white min-h-screen p-4">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect } = React;
    const socket = io();

    function MinecraftHead({ username, size = 48 }) {
      return (
        <img 
          src={`https://mc-heads.net/avatar/${username}/${size}`}
          alt={username}
          className="minecraft-head rounded-lg border-2 border-purple-500/30 shadow-lg"
          width={size}
          height={size}
        />
      );
    }

    function App() {
      const [tab, setTab] = useState('overview');
      const [msg, setMsg] = useState('');
      const [chat, setChat] = useState([]);
      const [logs, setLogs] = useState([]);
      const [stats, setStats] = useState({ uptime: '0h', commands: 0, messages: 0 });
      const [flags, setFlags] = useState([]);
      const [permissions, setPermissions] = useState([]);
      const [availableCommands, setAvailableCommands] = useState([]);
      const [guildMembers, setGuildMembers] = useState([]);
      const [fkdrTracking, setFkdrTracking] = useState([]);
      const [loading, setLoading] = useState(false);
      const [detailedStats, setDetailedStats] = useState(null);
      
      const [flagIgn, setFlagIgn] = useState('');
      const [flagReason, setFlagReason] = useState('');
      const [flaggedBy, setFlaggedBy] = useState('Admin');
      const [flagSearch, setFlagSearch] = useState('');
      
      const [permSearch, setPermSearch] = useState('');
      const [memberSearch, setMemberSearch] = useState('');
      const [fkdrSearch, setFkdrSearch] = useState('');
      
      useEffect(() => {
        socket.on('minecraft-chat', d => setChat(p => [...p, d].slice(-100)));
        socket.on('bot-log', d => setLogs(p => [d, ...p].slice(0, 100)));
        socket.on('stats-update', setStats);
        
        fetchAll();
        
        const interval = setInterval(fetchDetailedStats, 5000);
        
        return () => {
          socket.off('minecraft-chat');
          socket.off('bot-log');
          socket.off('stats-update');
          clearInterval(interval);
        };
      }, []);

      const fetchAll = () => {
        fetchFlags();
        fetchPermissions();
        fetchGuildMembers();
        fetchFkdrTracking();
        fetchDetailedStats();
      };

      const fetchDetailedStats = async () => {
        try {
          const res = await fetch('/api/stats');
          const data = await res.json();
          setDetailedStats(data);
        } catch (err) {
          console.error('Failed to fetch detailed stats:', err);
        }
      };

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
        setLoading(true);
        try {
          const res = await fetch('/api/guild-members');
          const data = await res.json();
          setGuildMembers(data.members || []);
        } catch (err) {
          console.error('Failed to fetch guild members:', err);
        } finally {
          setLoading(false);
        }
      };

      const refreshGuildMembers = async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/guild-members/refresh', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            await fetchGuildMembers();
            alert('Guild members yenilendi!');
          }
        } catch (err) {
          alert('Yenileme başarısız');
        } finally {
          setLoading(false);
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

      const downloadLogs = async () => {
        try {
          const res = await fetch('/api/logs/download');
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`rumonium-logs-\${new Date().toISOString()}.json\`;
          a.click();
        } catch (err) {
          alert('Log indirme hatası');
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
          alert('IGN ve Sebep gerekli!');
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
            alert('Oyuncu işaretlendi!');
          } else {
            alert('Hata: ' + data.message);
          }
        } catch (err) {
          alert('İşaretleme hatası');
        }
      };

      const removeFlag = async (uuid) => {
        if (!confirm('Bu işareti kaldır?')) return;
        
        try {
          await fetch('/api/flags/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid })
          });
          fetchFlags();
        } catch (err) {
          alert('Silme hatası');
        }
      };

      const removeFkdrTracking = async (username) => {
        if (!confirm(\`\${username} için FKDR takibini kaldır?\`)) return;
        
        try {
          await fetch('/api/fkdr-tracking/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
          });
          fetchFkdrTracking();
        } catch (err) {
          alert('Silme hatası');
        }
      };

      const toggleCommandBan = async (username, command) => {
        const member = guildMembers.find(m => m.username === username);
        if (!member) return;
        
        const currentPerms = commandPermissions.get(username.toLowerCase()) || { bannedCommands: [] };
        const bannedCmds = currentPerms.bannedCommands || [];
        const isBanned = bannedCmds.includes(command);
        
        const newBanned = isBanned 
          ? bannedCmds.filter(c => c !== command)
          : [...bannedCmds, command];
        
        try {
          await fetch('/api/permissions/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: username,
              allowedCommands: [],
              bannedCommands: newBanned
            })
          });
          fetchPermissions();
        } catch (err) {
          alert('İzin güncelleme hatası');
        }
      };

      const filteredFlags = flags.filter(flag => 
        flag.ign?.toLowerCase().includes(flagSearch.toLowerCase()) ||
        flag.reason?.toLowerCase().includes(flagSearch.toLowerCase())
      );

      const filteredMembers = guildMembers.filter(member =>
        member.username.toLowerCase().includes(memberSearch.toLowerCase())
      );

      const tabs = [
        { id: 'overview', name: 'Genel Bakış', icon: '📊' },
        { id: 'chat', name: 'Canlı Sohbet', icon: '💬' },
        { id: 'members', name: 'Üyeler', icon: '👥' },
        { id: 'flags', name: 'İşaretliler', icon: '🚩' },
        { id: 'fkdr', name: 'FKDR Takip', icon: '📈' },
        { id: 'logs', name: 'Loglar', icon: '📋' }
      ];

      return (
        <div className="max-w-[1800px] mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="glass-effect rounded-2xl p-8 glow-purple">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  RumoniumGC Control Panel
                </h1>
                <p className="text-gray-400">Gelişmiş Bot Yönetim Sistemi</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-4 py-2 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full pulse"></div>
                  <span className="text-green-400 font-semibold">Çevrimiçi</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-effect rounded-2xl p-6 stat-card glow-purple">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-500/20 rounded-xl">
                  <span className="text-3xl">⏱️</span>
                </div>
                <span className="text-purple-400 text-sm font-semibold">UPTIME</span>
              </div>
              <div className="text-3xl font-bold text-white">{stats.uptime}</div>
              <div className="text-gray-400 text-sm mt-2">Bot Çalışma Süresi</div>
            </div>

            <div className="glass-effect rounded-2xl p-6 stat-card glow-blue">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-blue-500/20 rounded-xl">
                  <span className="text-3xl">⚡</span>
                </div>
                <span className="text-blue-400 text-sm font-semibold">KOMUTLAR</span>
              </div>
              <div className="text-3xl font-bold text-white">{stats.commands}</div>
              <div className="text-gray-400 text-sm mt-2">Toplam Komut Sayısı</div>
            </div>

            <div className="glass-effect rounded-2xl p-6 stat-card glow-green">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-500/20 rounded-xl">
                  <span className="text-3xl">💬</span>
                </div>
                <span className="text-green-400 text-sm font-semibold">MESAJLAR</span>
              </div>
              <div className="text-3xl font-bold text-white">{stats.messages}</div>
              <div className="text-gray-400 text-sm mt-2">İşlenen Mesaj Sayısı</div>
            </div>

            <div className="glass-effect rounded-2xl p-6 stat-card glow-red">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-red-500/20 rounded-xl">
                  <span className="text-3xl">🚩</span>
                </div>
                <span className="text-red-400 text-sm font-semibold">İŞARETLİLER</span>
              </div>
              <div className="text-3xl font-bold text-white">{flags.length}</div>
              <div className="text-gray-400 text-sm mt-2">Flaglı Oyuncu Sayısı</div>
            </div>
          </div>

          {/* Detailed Stats */}
          {detailedStats && (
            <div className="glass-effect rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-4 text-purple-400">📊 Detaylı İstatistikler</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-400 text-sm mb-1">API Kuyruğu</div>
                  <div className="text-2xl font-bold text-cyan-400">{detailedStats.queueLength}</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-400 text-sm mb-1">API Çağrıları</div>
                  <div className="text-2xl font-bold text-yellow-400">{detailedStats.apiCallCount}/100</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-400 text-sm mb-1">Cache Boyutu</div>
                  <div className="text-2xl font-bold text-green-400">{detailedStats.cacheSize}</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-400 text-sm mb-1">FKDR Takip</div>
                  <div className="text-2xl font-bold text-purple-400">{detailedStats.detailedStats?.tracking || 0}</div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="glass-effect rounded-2xl p-2 flex gap-2 overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={\`flex-1 min-w-[140px] px-6 py-3 rounded-xl font-bold transition-all duration-300 \${
                  tab === t.id 
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg glow-purple' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
                }\`}
              >
                <span className="mr-2">{t.icon}</span>
                {t.name}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {/* Overview Tab */}
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="glass-effect rounded-2xl p-6">
                    <h2 className="text-2xl font-bold mb-4 text-purple-400">🎮 Guild Özet</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-4 border border-purple-500/30">
                        <div className="text-gray-400 text-sm mb-1">Toplam Üye</div>
                        <div className="text-3xl font-bold text-white">{guildMembers.length}</div>
                      </div>
                      <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-4 border border-blue-500/30">
                        <div className="text-gray-400 text-sm mb-1">İzinli Üyeler</div>
                        <div className="text-3xl font-bold text-white">{permissions.length}</div>
                      </div>
                      <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-4 border border-green-500/30">
                        <div className="text-gray-400 text-sm mb-1">Aktif Takip</div>
                        <div className="text-3xl font-bold text-white">{fkdrTracking.length}</div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-effect rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-2xl font-bold text-blue-400">🏆 En İyi Performans</h2>
                      <button onClick={refreshGuildMembers} className="px-4 py-2 bg-blue-600 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all">
                        Yenile
                      </button>
                    </div>
                    <div className="space-y-3">
                      {guildMembers
                        .filter(m => m.stats)
                        .sort((a, b) => parseFloat(b.stats.fkdr) - parseFloat(a.stats.fkdr))
                        .slice(0, 5)
                        .map((member, i) => (
                          <div key={i} className="flex items-center gap-4 bg-gray-800/50 rounded-xl p-4">
                            <div className="text-2xl font-bold text-yellow-400">#{i + 1}</div>
                            <MinecraftHead username={member.username} size={48} />
                            <div className="flex-1">
                              <div className="font-bold text-white">{member.username}</div>
                              <div className="text-sm text-gray-400">⭐ {member.stats.star} Yıldız</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-purple-400">{member.stats.fkdr}</div>
                              <div className="text-xs text-gray-400">FKDR</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Chat Tab */}
              {tab === 'chat' && (
                <div className="glass-effect rounded-2xl overflow-hidden">
                  <div className="p-6 border-b border-gray-700/50 bg-gradient-to-r from-purple-900/30 to-pink-900/30">
                    <h2 className="text-2xl font-bold text-purple-400">💬 Canlı Sohbet</h2>
                  </div>
                  <div className="h-[500px] overflow-y-auto p-6 space-y-2 bg-gray-900/30 custom-scrollbar">
                    {chat.map((m, i) => (
                      <div key={i} className="bg-gray-800/70 rounded-xl px-4 py-3 text-sm border border-gray-700/50 hover:border-purple-500/30 transition-all">
                        <span className="text-gray-500 font-mono">[{m.time}]</span> 
                        <span className="ml-2 text-gray-200">{m.message}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-6 border-t border-gray-700/50 bg-gray-800/30">
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={msg}
                        onChange={e => setMsg(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && send()}
                        placeholder="Mesaj yaz..."
                        className="flex-1 bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-600 border border-gray-600/50"
                      />
                      <button onClick={send} className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 font-bold hover:from-purple-700 hover:to-pink-700 shadow-lg glow-purple transition-all">
                        Gönder
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Members Tab */}
              {tab === 'members' && (
                <div className="glass-effect rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-cyan-400">👥 Guild Üyeleri</h2>
                    <button 
                      onClick={refreshGuildMembers} 
                      disabled={loading}
                      className="px-4 py-2 bg-cyan-600 rounded-xl text-sm font-semibold hover:bg-cyan-700 transition-all disabled:opacity-50"
                    >
                      {loading ? '⏳ Yükleniyor...' : '🔄 Yenile'}
                    </button>
                  </div>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 Üye ara..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-600 border border-gray-600/50"
                    />
                  </div>

                  <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
                    {loading ? (
                      <div className="text-center py-12 text-gray-400">
                        <div className="text-4xl mb-4">⏳</div>
                        <div>Guild üyeleri yükleniyor...</div>
                      </div>
                    ) : filteredMembers.length === 0 ? (
                      <div className="text-center text-gray-400 py-12">
                        <div className="text-4xl mb-4">😕</div>
                        <div>{memberSearch ? 'Eşleşen oyuncu bulunamadı' : 'Üye bulunamadı'}</div>
                      </div>
                    ) : (
                      filteredMembers.map((member, i) => {
                        const userPerms = commandPermissions.get(member.username.toLowerCase()) || {};
                        const bannedCmds = userPerms.bannedCommands || [];
                        
                        return (
                          <div key={i} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50 hover:border-cyan-500/30 transition-all">
                            <div className="flex items-center gap-4 mb-3">
                              <MinecraftHead username={member.username} size={56} />
                              <div className="flex-1">
                                <div className="font-bold text-lg text-white">{member.username}</div>
                                <div className="flex items-center gap-3 text-sm text-gray-400">
                                  <span className="bg-purple-500/20 px-2 py-1 rounded">{member.rank}</span>
                                  {member.stats && (
                                    <>
                                      <span>⭐ {member.stats.star}</span>
                                      <span className="text-yellow-400">FKDR: {member.stats.fkdr}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-gray-400">Haftalık GEXP</div>
                                <div className="text-xl font-bold text-green-400">{member.weeklyGexp?.toLocaleString() || '0'}</div>
                              </div>
                            </div>

                            {member.stats && (
                              <div className="grid grid-cols-4 gap-3 mt-3 p-3 bg-gray-900/50 rounded-lg">
                                <div className="text-center">
                                  <div className="text-xs text-gray-400">Wins</div>
                                  <div className="font-bold text-green-400">{member.stats.wins}</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-xs text-gray-400">Kills</div>
                                  <div className="font-bold text-red-400">{member.stats.kills}</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-xs text-gray-400">Finals</div>
                                  <div className="font-bold text-purple-400">{member.stats.finals}</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-xs text-gray-400">Beds</div>
                                  <div className="font-bold text-cyan-400">{member.stats.beds}</div>
                                </div>
                              </div>
                            )}

                            <div className="mt-3">
                              <div className="text-xs text-gray-400 mb-2 font-semibold">Komut İzinleri:</div>
                              <div className="flex flex-wrap gap-1">
                                {availableCommands.map(cmd => {
                                  const isBanned = bannedCmds.includes(cmd);
                                  return (
                                    <button
                                      key={cmd}
                                      onClick={() => toggleCommandBan(member.username, cmd)}
                                      className={\`text-xs px-2 py-1 rounded font-mono transition-all \${
                                        isBanned 
                                          ? 'bg-red-600 hover:bg-red-700 text-white' 
                                          : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                                      }\`}
                                    >
                                      {cmd}
                                    </button>
                                  );
                                })}
                              </div>
                              {bannedCmds.length > 0 && (
                                <div className="mt-2 text-xs text-red-400">
                                  🚫 Yasaklı: {bannedCmds.length} komut
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Flags Tab */}
              {tab === 'flags' && (
                <div className="glass-effect rounded-2xl p-6">
                  <h2 className="text-2xl font-bold mb-6 text-red-400">🚩 İşaretli Oyuncular</h2>
                  
                  <form onSubmit={addFlag} className="bg-gradient-to-br from-red-500/10 to-orange-500/10 rounded-xl p-6 mb-6 border border-red-500/30">
                    <h3 className="font-bold mb-4 text-red-400">Yeni Oyuncu İşaretle</h3>
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Oyuncu İsmi (IGN)"
                        value={flagIgn}
                        onChange={e => setFlagIgn(e.target.value)}
                        className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600/50"
                      />
                      <input
                        type="text"
                        placeholder="Sebep"
                        value={flagReason}
                        onChange={e => setFlagReason(e.target.value)}
                        className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600/50"
                      />
                      <input
                        type="text"
                        placeholder="İşaretleyen (opsiyonel)"
                        value={flaggedBy}
                        onChange={e => setFlaggedBy(e.target.value)}
                        className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600/50"
                      />
                      <button type="submit" className="w-full bg-gradient-to-r from-red-600 to-orange-600 rounded-xl px-4 py-3 font-bold hover:from-red-700 hover:to-orange-700 shadow-lg glow-red transition-all">
                        ➕ İşaretle
                      </button>
                    </div>
                  </form>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 İşaretli oyuncu ara..."
                      value={flagSearch}
                      onChange={e => setFlagSearch(e.target.value)}
                      className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600/50"
                    />
                  </div>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {filteredFlags.length === 0 ? (
                      <div className="text-center text-gray-400 py-12">
                        <div className="text-4xl mb-4">✅</div>
                        <div>{flagSearch ? 'Eşleşen oyuncu bulunamadı' : 'İşaretli oyuncu yok'}</div>
                      </div>
                    ) : (
                      filteredFlags.map((flag, i) => (
                        <div key={i} className="bg-gray-800/50 rounded-xl p-4 border-l-4 border-red-500 shadow-lg hover:shadow-red-500/20 transition-all">
                          <div className="flex items-start gap-4">
                            <MinecraftHead username={flag.ign} size={64} />
                            <div className="flex-1">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <div className="font-bold text-xl text-white">{flag.ign}</div>
                                  <div className="text-xs text-gray-500 font-mono mt-1">UUID: {flag.uuid}</div>
                                </div>
                                <button
                                  onClick={() => removeFlag(flag.uuid)}
                                  className="px-4 py-2 bg-red-600 rounded-xl text-sm font-bold hover:bg-red-700 shadow-md transition-all"
                                >
                                  🗑️ Kaldır
                                </button>
                              </div>
                              <div className="bg-gray-900/50 rounded-lg p-3 border border-red-500/20 mb-2">
                                <span className="text-gray-400 text-sm">Sebep:</span> 
                                <span className="ml-2 text-red-300 font-semibold">{flag.reason}</span>
                              </div>
                              <div className="text-xs text-gray-400">
                                <span className="text-purple-400 font-semibold">{flag.flaggedBy}</span> tarafından işaretlendi
                                <span className="ml-2">• {new Date(flag.timestamp).toLocaleString('tr-TR')}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* FKDR Tab */}
              {tab === 'fkdr' && (
                <div className="glass-effect rounded-2xl p-6">
                  <h2 className="text-2xl font-bold mb-6 text-yellow-400">📈 FKDR Takip Sistemi</h2>
                  
                  <div className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 rounded-xl p-6 mb-6 border border-yellow-500/30">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-3xl">📊</div>
                      <div>
                        <div className="text-sm text-gray-300 font-semibold">Aktif Takip</div>
                        <div className="text-2xl font-bold text-yellow-400">{fkdrTracking.length} oyuncu</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">
                      Oyuncular <span className="font-mono bg-gray-700 px-2 py-1 rounded">!fkdr start</span> komutuyla takip başlatabilir.
                      İstatistikler her 6 saatte bir otomatik güncellenir.
                    </div>
                  </div>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="🔍 Takip edilen oyuncu ara..."
                      value={fkdrSearch}
                      onChange={e => setFkdrSearch(e.target.value)}
                      className="w-full bg-gray-700/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-yellow-600 border border-gray-600/50"
                    />
                  </div>

                  <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {fkdrTracking
                      .filter(track => track.username.toLowerCase().includes(fkdrSearch.toLowerCase()))
                      .length === 0 ? (
                      <div className="text-center text-gray-400 py-12">
                        <div className="text-4xl mb-4">📊</div>
                        <div>{fkdrSearch ? 'Eşleşen oyuncu bulunamadı' : 'Aktif FKDR takibi yok'}</div>
                      </div>
                    ) : (
                      fkdrTracking
                        .filter(track => track.username.toLowerCase().includes(fkdrSearch.toLowerCase()))
                        .map((track, i) => {
                          const progress = track.progress;
                          const hasData = progress && (progress.daily || progress.weekly || progress.monthly);
                          
                          return (
                            <div key={i} className="bg-gray-800/50 rounded-xl p-5 border-l-4 border-yellow-500 shadow-lg hover:shadow-yellow-500/20 transition-all">
                              <div className="flex items-start gap-4">
                                <MinecraftHead username={track.username} size={64} />
                                <div className="flex-1">
                                  <div className="flex justify-between items-start mb-4">
                                    <div>
                                      <div className="font-bold text-xl text-white">{track.username}</div>
                                      <div className="text-xs text-gray-400 mt-1">
                                        Başlangıç: {new Date(track.startDate).toLocaleDateString('tr-TR')}
                                      </div>
                                      {progress?.current && (
                                        <div className="text-sm mt-2 bg-yellow-500/20 px-3 py-1 rounded-lg inline-block">
                                          Güncel FKDR: <span className="font-bold text-yellow-400">{progress.current.fkdr}</span>
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => removeFkdrTracking(track.username)}
                                      className="px-4 py-2 bg-red-600 rounded-xl text-sm font-bold hover:bg-red-700 shadow-md transition-all"
                                    >
                                      🗑️ Kaldır
                                    </button>
                                  </div>
                                  
                                  {hasData ? (
                                    <div className="space-y-3">
                                      {progress.daily && (
                                        <div className="bg-blue-900/20 rounded-xl p-3 border border-blue-600/30">
                                          <div className="text-xs font-semibold text-blue-400 mb-2">📈 Günlük İlerleme</div>
                                          <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">FKDR Değişim</div>
                                              <div className={\`font-bold text-lg \${progress.daily.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.daily.fkdr >= 0 ? '+' : ''}{progress.daily.fkdr}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Oturum FKDR</div>
                                              <div className="font-bold text-lg text-cyan-400">{progress.daily.sessionFkdr}</div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Finaller</div>
                                              <div className="font-bold text-lg text-purple-400">+{progress.daily.finals}</div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      
                                      {progress.weekly && (
                                        <div className="bg-green-900/20 rounded-xl p-3 border border-green-600/30">
                                          <div className="text-xs font-semibold text-green-400 mb-2">📊 Haftalık İlerleme</div>
                                          <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">FKDR Değişim</div>
                                              <div className={\`font-bold text-lg \${progress.weekly.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.weekly.fkdr >= 0 ? '+' : ''}{progress.weekly.fkdr}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Oturum FKDR</div>
                                              <div className="font-bold text-lg text-cyan-400">{progress.weekly.sessionFkdr}</div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Finaller</div>
                                              <div className="font-bold text-lg text-purple-400">+{progress.weekly.finals}</div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      
                                      {progress.monthly && (
                                        <div className="bg-purple-900/20 rounded-xl p-3 border border-purple-600/30">
                                          <div className="text-xs font-semibold text-purple-400 mb-2">📅 Aylık İlerleme</div>
                                          <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">FKDR Değişim</div>
                                              <div className={\`font-bold text-lg \${progress.monthly.fkdr >= 0 ? 'text-green-400' : 'text-red-400'}\`}>
                                                {progress.monthly.fkdr >= 0 ? '+' : ''}{progress.monthly.fkdr}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Oturum FKDR</div>
                                              <div className="font-bold text-lg text-cyan-400">{progress.monthly.sessionFkdr}</div>
                                            </div>
                                            <div className="bg-gray-900/50 rounded-lg p-2">
                                              <div className="text-xs text-gray-400">Finaller</div>
                                              <div className="font-bold text-lg text-purple-400">+{progress.monthly.finals}</div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-sm text-gray-400 italic bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
                                      📊 Henüz yeterli veri yok. Birkaç oyun oynadıktan sonra tekrar kontrol edin!
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

              {/* Logs Tab */}
              {tab === 'logs' && (
                <div className="glass-effect rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-indigo-400">📋 Sistem Logları</h2>
                    <button 
                      onClick={downloadLogs}
                      className="px-4 py-2 bg-indigo-600 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all flex items-center gap-2"
                    >
                      <span>📥</span>
                      <span>Logları İndir</span>
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                    {logs.length === 0 ? (
                      <div className="text-center text-gray-400 py-12">
                        <div className="text-4xl mb-4">📋</div>
                        <div>Henüz log kaydı yok</div>
                      </div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className="bg-gray-800/50 rounded-xl p-4 text-sm border border-gray-700/50 hover:border-indigo-500/30 transition-all">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="text-gray-400 font-mono text-xs">{log.time}</div>
                            <span className={\`px-3 py-1 rounded-lg text-xs font-bold \${
                              log.type === 'error' ? 'bg-red-600' :
                              log.type === 'success' ? 'bg-green-600' :
                              log.type === 'warning' ? 'bg-yellow-600' : 'bg-blue-600'
                            }\`}>
                              {log.type === 'error' ? '❌' : log.type === 'success' ? '✅' : log.type === 'warning' ? '⚠️' : 'ℹ️'}
                              {' '}{log.type.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-gray-200 pl-2 border-l-2 border-gray-600">{log.msg}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Sidebar */}
            <div className="space-y-6">
              <div className="glass-effect rounded-2xl p-6">
                <h3 className="text-xl font-bold mb-4 text-cyan-400">🔔 Son Aktiviteler</h3>
                <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {logs.slice(0, 10).map((log, i) => (
                    <div key={i} className="bg-gray-800/50 rounded-lg p-3 text-xs border border-gray-700/30">
                      <div className="text-gray-400 mb-1 font-mono">{log.time}</div>
                      <div className="text-gray-300">{log.msg}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-effect rounded-2xl p-6">
                <h3 className="text-xl font-bold mb-4 text-purple-400">⚡ Hızlı Erişim</h3>
                <div className="space-y-2">
                  <button 
                    onClick={() => setTab('chat')}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl px-4 py-3 font-semibold hover:from-purple-700 hover:to-pink-700 transition-all text-left"
                  >
                    💬 Sohbete Git
                  </button>
                  <button 
                    onClick={() => setTab('members')}
                    className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl px-4 py-3 font-semibold hover:from-blue-700 hover:to-cyan-700 transition-all text-left"
                  >
                    👥 Üyeleri Gör
                  </button>
                  <button 
                    onClick={refreshGuildMembers}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 rounded-xl px-4 py-3 font-semibold hover:from-green-700 hover:to-emerald-700 transition-all text-left"
                  >
                    🔄 Verileri Yenile
                  </button>
                  <button 
                    onClick={downloadLogs}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl px-4 py-3 font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all text-left"
                  >
                    📥 Logları İndir
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="glass-effect rounded-2xl p-6 text-center">
            <div className="text-gray-400 text-sm">
              <span className="font-semibold text-purple-400">RumoniumGC</span> Control Panel v2.1 
              <span className="mx-2">•</span>
              Made by <span className="font-semibold text-pink-400">Relaquent</span>
              <span className="mx-2">•</span>
              <span className="text-green-400">🟢 System Online</span>
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
        "nfkdr [user] - Next FKDR calc",
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
          await safeChat(`${ign} - Finals needed: ${finalsNeeded} (no deaths)`);
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

setInterval(() => {
  saveFlaggedPlayers();
  saveCommandPermissions();
  saveFkdrTracking();
}, 5 * 60 * 1000);

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
