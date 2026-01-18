/**
 * Rumonium Bot - Hypixel Guild Bot with AI Integration
 * 
 * Copyright 2026 Relaquent
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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

// === Urchin API Setup (FIXED) ===
const URCHIN_ENABLED = !!process.env.URCHIN_API_KEY;
const URCHIN_API_KEY = process.env.URCHIN_API_KEY || null;

// Urchin API - Official endpoint
const URCHIN_API_BASE = "https://urchin.ws";

let WORKING_URCHIN_URL = null;

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

// === Local Blacklist System ===
const localBlacklist = new Map();
const BLACKLIST_FILE = path.join(__dirname, "blacklist.json");

function generateBlacklistID() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Check if ID already exists
  for (const entry of localBlacklist.values()) {
    if (entry.id === id) {
      return generateBlacklistID(); // Regenerate if duplicate
    }
  }
  return id;
}

function loadBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'));
      Object.entries(data).forEach(([username, entry]) => {
        if (!entry.id) {
          entry.id = generateBlacklistID();
        }
        localBlacklist.set(username.toLowerCase(), entry);
      });
      console.log(`✅ Loaded ${localBlacklist.size} blacklist entries`);
    }
  } catch (err) {
    console.error('❌ Failed to load blacklist:', err.message);
  }
}

function saveBlacklist() {
  try {
    const data = Object.fromEntries(localBlacklist);
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${localBlacklist.size} blacklist entries`);
  } catch (err) {
    console.error('❌ Failed to save blacklist:', err.message);
  }
}

function addToBlacklist(username, reason, addedBy) {
  const id = generateBlacklistID();
  const entry = {
    id: id,
    username: username,
    reason: reason,
    addedBy: addedBy,
    addedOn: new Date().toISOString(),
    timestamp: Date.now()
  };
  
  localBlacklist.set(username.toLowerCase(), entry);
  saveBlacklist();
  return entry;
}

function removeFromBlacklist(username) {
  if (localBlacklist.has(username.toLowerCase())) {
    localBlacklist.delete(username.toLowerCase());
    saveBlacklist();
    return true;
  }
  return false;
}

function checkBlacklist(username) {
  return localBlacklist.get(username.toLowerCase());
}

function getBlacklistStats() {
  return {
    total: localBlacklist.size,
    entries: Array.from(localBlacklist.values()).sort((a, b) => b.timestamp - a.timestamp)
  };
}
const commandPermissions = new Map();
const PERMISSIONS_FILE = path.join(__dirname, "command_permissions.json");

const AVAILABLE_COMMANDS = [
  'bw', 'gexp', 'stats', 'when', 'ask', 'about', 'help',
  'fkdr', 'nfkdr', 'view', 'blacklist'
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

// === Statistics Tracking ===
const commandStats = new Map(); // command -> count
const userStats = new Map(); // username -> count
const recentActivity = [];
const MAX_ACTIVITY = 100;

function addActivity(type, description, username = null) {
  const activity = {
    timestamp: new Date().toISOString(),
    type,
    description,
    username
  };
  
  recentActivity.unshift(activity);
  if (recentActivity.length > MAX_ACTIVITY) {
    recentActivity.pop();
  }
}

function incrementCommandStat(command) {
  commandStats.set(command, (commandStats.get(command) || 0) + 1);
}

function incrementUserStat(username) {
  userStats.set(username, (userStats.get(username) || 0) + 1);
}

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

// === Urchin API (OFFICIAL - https://urchin.ws) ===
async function testUrchinConnection() {
  if (!URCHIN_ENABLED) {
    console.log('⚠️ Urchin API disabled - no API key provided');
    addLog('warning', 'Urchin API disabled - !view command unavailable');
    return false;
  }

  console.log('🔍 Testing Urchin API connection...');
  
  try {
    const params = new URLSearchParams({
      key: URCHIN_API_KEY,
      sources: 'GAME,PARTY,PARTY_INVITES,CHAT,CHAT_MENTIONS,MANUAL,ME'
    });
    
    const testUrl = `${URCHIN_API_BASE}/player/Technoblade?${params.toString()}`;
    
    console.log(`Testing: ${URCHIN_API_BASE}`);
    
    const response = await axios.get(testUrl, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RumoniumGC-Bot/2.2'
      },
      validateStatus: (status) => status < 500
    });
    
    console.log(`[Urchin] Response: ${response.status}`);
    
    // Success cases (200 = found, 404 = not found but API works)
    if (response.status === 200 || response.status === 404) {
      WORKING_URCHIN_URL = URCHIN_API_BASE;
      console.log(`✅ Urchin API connected successfully`);
      addLog('success', `Urchin API connected to ${URCHIN_API_BASE}`);
      
      // Log rate limit info
      const limit = response.headers['x-ratelimit-limit'];
      const remaining = response.headers['x-ratelimit-remaining'];
      if (limit && remaining) {
        console.log(`📊 Rate Limit: ${remaining}/${limit} requests remaining`);
      }
      
      return true;
    }
    
    // Error cases
    if (response.status === 401) {
      console.error('❌ Invalid Urchin API key');
      addLog('error', 'Invalid Urchin API key - check your URCHIN_API_KEY');
      return false;
    }
    
    if (response.status === 403) {
      console.error('❌ Urchin API key locked or forbidden');
      addLog('error', 'Urchin API key locked - contact Urchin support');
      return false;
    }
    
    console.error(`❌ Unexpected response: ${response.status}`);
    addLog('error', `Urchin API returned unexpected status: ${response.status}`);
    return false;
    
  } catch (err) {
    console.error('❌ Urchin API connection failed:', err.message);
    addLog('error', `Urchin connection failed: ${err.message}`);
    return false;
  }
}

async function checkUrchinBlacklist(username) {
  if (!URCHIN_ENABLED) {
    throw new Error('Urchin API not configured');
  }

  if (!WORKING_URCHIN_URL) {
    const connected = await testUrchinConnection();
    if (!connected) {
      throw new Error('Urchin API unavailable');
    }
  }
  
  try {
    const params = new URLSearchParams({
      key: URCHIN_API_KEY,
      sources: 'GAME,PARTY,PARTY_INVITES,CHAT,CHAT_MENTIONS,MANUAL,ME'
    });
    
    const url = `${WORKING_URCHIN_URL}/player/${encodeURIComponent(username)}?${params.toString()}`;
    
    console.log(`[Urchin] Checking: ${username}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RumoniumGC-Bot/2.2'
      },
      validateStatus: (status) => status < 500
    });

    console.log(`[Urchin] Status: ${response.status}`);
    
    // Log rate limit info
    const limit = response.headers['x-ratelimit-limit'];
    const remaining = response.headers['x-ratelimit-remaining'];
    if (limit && remaining) {
      console.log(`[Urchin] Rate: ${remaining}/${limit} requests remaining`);
    }

    // Handle responses based on official API spec
    if (response.status === 404) {
      return `${username} - Not in database (Clean)`;
    }
    
    if (response.status === 401) {
      WORKING_URCHIN_URL = null;
      throw new Error('Invalid API key');
    }
    
    if (response.status === 403) {
      WORKING_URCHIN_URL = null;
      throw new Error('API key locked - contact support');
    }
    
    if (response.status === 429) {
      throw new Error(`Rate limited - ${remaining || 0}/${limit || 600} remaining`);
    }
    
    if (response.status !== 200) {
      throw new Error(`API error: ${response.status}`);
    }

    // Parse successful response (200 OK)
    if (response.data && response.data.uuid) {
      const player = response.data;
      const shortUuid = player.uuid.substring(0, 8);
      
      // Tags are objects with type, reason, added_on, etc.
      if (player.tags && Array.isArray(player.tags) && player.tags.length > 0) {
        // Build detailed tag information
        const tagDetails = player.tags.slice(0, 3).map(tag => {
          const tagType = tag.type || 'Unknown';
          const addedBy = tag.hide_username ? 'Hidden' : (tag.added_by ? `User ${tag.added_by}` : 'Unknown');
          return `${tagType} (by ${addedBy})`;
        });
        
        const tagCount = player.tags.length;
        const tagWord = tagCount === 1 ? 'Tag' : 'Tags';
        const moreText = player.tags.length > 3 ? ` +${player.tags.length - 3} more` : '';
        
        // Format: username - uuid... then ⚠️ username X Tags: tag1 (by user), tag2 (by user)
        return `${username} - ${shortUuid}...\n⚠️ ${username} ${tagCount} ${tagWord}: ${tagDetails.join(', ')}${moreText}`;
      } else {
        // Format: username - uuid... then ✓ username Clean (No tags)
        return `${username} - ${shortUuid}...\n✓ ${username} Clean (No tags)`;
      }
      
      console.log(`[Urchin] ✓ ${username}: ${player.tags?.length || 0} tags found`);
    } else {
      return `${username} - Invalid response format`;
    }
  } catch (err) {
    console.error('[Urchin] Error:', err.message);
    
    // Connection errors - reset working URL
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      WORKING_URCHIN_URL = null;
      throw new Error('Connection failed - API down');
    }
    
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      throw new Error('Timeout - try again');
    }
    
    // Re-throw with original message
    throw err;
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
app.get("/", (req, res) => res.send("✅ RumoniumGC Bot v2.2 - Running!"));

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
  const uptime = Date.now() - startTime;
  
  // Get top commands
  const topCommands = Array.from(commandStats.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count);
  
  // Get top users
  const topUsers = Array.from(userStats.entries())
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json({
    queueLength: API_QUEUE.length,
    apiCallCount,
    cacheSize: cache.playerDataCache.size + cache.guildCache.size,
    urchinUrl: WORKING_URCHIN_URL || 'Not connected',
    urchinEnabled: URCHIN_ENABLED,
    commandCount,
    messageCount,
    uptimeMs: uptime,
    topCommands,
    topUsers
  });
});

app.get("/api/activity", (req, res) => {
  res.json({
    recent: recentActivity.slice(0, 50),
    total: recentActivity.length
  });
});

app.get("/api/blacklist", (req, res) => {
  const stats = getBlacklistStats();
  res.json(stats);
});

app.post("/api/blacklist/add", (req, res) => {
  const { username, reason, addedBy } = req.body;
  
  if (!username || !reason || !addedBy) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    const entry = addToBlacklist(username, reason, addedBy);
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/blacklist/remove", (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username required' });
  }
  
  const removed = removeFromBlacklist(username);
  if (removed) {
    res.json({ success: true, message: `${username} removed from blacklist` });
  } else {
    res.status(404).json({ success: false, message: 'User not found in blacklist' });
  }
});

app.post("/api/blacklist/update", (req, res) => {
  const { username, reason, addedBy } = req.body;
  
  if (!username || !reason || !addedBy) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    const entry = localBlacklist.get(username.toLowerCase());
    
    if (!entry) {
      return res.status(404).json({ success: false, message: 'User not found in blacklist' });
    }
    
    // Update entry
    entry.reason = reason;
    entry.addedBy = addedBy;
    entry.lastModified = new Date().toISOString();
    
    localBlacklist.set(username.toLowerCase(), entry);
    saveBlacklist();
    
    addLog('info', `Blacklist entry updated: ${username} (ID: ${entry.id})`);
    
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/blacklist", (req, res) => {
  const stats = getBlacklistStats();
  res.json(stats);
});

app.post("/api/blacklist/add", (req, res) => {
  const { username, reason, addedBy } = req.body;
  
  if (!username || !reason || !addedBy) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    const entry = addToBlacklist(username, reason, addedBy);
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/blacklist/remove", (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username required' });
  }
  
  const removed = removeFromBlacklist(username);
  if (removed) {
    res.json({ success: true, message: `${username} removed from blacklist` });
  } else {
    res.status(404).json({ success: false, message: 'User not found in blacklist' });
  }
});

// Permission management endpoints
app.get("/api/permissions", (req, res) => {
  const permissions = Array.from(commandPermissions.entries()).map(([username, perms]) => ({
    username,
    ...perms
  }));
  res.json({ permissions, availableCommands: AVAILABLE_COMMANDS });
});

app.post("/api/permissions/set", (req, res) => {
  const { username, allowedCommands, bannedCommands } = req.body;
  
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username required' });
  }
  
  try {
    const perms = {};
    if (allowedCommands && Array.isArray(allowedCommands)) {
      perms.allowedCommands = allowedCommands;
    }
    if (bannedCommands && Array.isArray(bannedCommands)) {
      perms.bannedCommands = bannedCommands;
    }
    
    commandPermissions.set(username.toLowerCase(), perms);
    saveCommandPermissions();
    
    res.json({ success: true, username, permissions: perms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/permissions/remove", (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username required' });
  }
  
  if (commandPermissions.has(username.toLowerCase())) {
    commandPermissions.delete(username.toLowerCase());
    saveCommandPermissions();
    res.json({ success: true, message: `Permissions reset for ${username}` });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

// Data export endpoints
app.get("/api/export/all", (req, res) => {
  try {
    const exportData = {
      exportDate: new Date().toISOString(),
      botVersion: '2.2',
      data: {
        permissions: Object.fromEntries(commandPermissions),
        fkdrTracking: Object.fromEntries(fkdrTracking),
        blacklist: Object.fromEntries(localBlacklist),
        settings: botSettings,
        gptPrompt: gptSystemPrompt
      }
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=rumonium-backup-${Date.now()}.json`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/export/permissions", (req, res) => {
  try {
    const data = Object.fromEntries(commandPermissions);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=permissions-${Date.now()}.json`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/export/fkdr", (req, res) => {
  try {
    const data = Object.fromEntries(fkdrTracking);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=fkdr-tracking-${Date.now()}.json`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/export/blacklist", (req, res) => {
  try {
    const data = Object.fromEntries(localBlacklist);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=blacklist-${Date.now()}.json`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Data import endpoints
app.post("/api/import/all", (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({ success: false, message: 'No data provided' });
    }
    
    let imported = 0;
    
    // Import permissions
    if (data.permissions) {
      commandPermissions.clear();
      Object.entries(data.permissions).forEach(([username, perms]) => {
        commandPermissions.set(username.toLowerCase(), perms);
      });
      saveCommandPermissions();
      imported++;
    }
    
    // Import FKDR tracking
    if (data.fkdrTracking) {
      fkdrTracking.clear();
      Object.entries(data.fkdrTracking).forEach(([username, tracking]) => {
        fkdrTracking.set(username.toLowerCase(), tracking);
      });
      saveFkdrTracking();
      imported++;
    }
    
    // Import blacklist
    if (data.blacklist) {
      localBlacklist.clear();
      Object.entries(data.blacklist).forEach(([username, entry]) => {
        localBlacklist.set(username.toLowerCase(), entry);
      });
      saveBlacklist();
      imported++;
    }
    
    // Import settings
    if (data.settings) {
      botSettings = { ...botSettings, ...data.settings };
      imported++;
    }
    
    // Import GPT prompt
    if (data.gptPrompt) {
      gptSystemPrompt = data.gptPrompt;
      imported++;
    }
    
    res.json({ success: true, message: `Imported ${imported} data categories` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/import/permissions", (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({ success: false, message: 'No data provided' });
    }
    
    commandPermissions.clear();
    Object.entries(data).forEach(([username, perms]) => {
      commandPermissions.set(username.toLowerCase(), perms);
    });
    saveCommandPermissions();
    
    res.json({ success: true, message: `Imported permissions for ${commandPermissions.size} users` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/import/fkdr", (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({ success: false, message: 'No data provided' });
    }
    
    fkdrTracking.clear();
    Object.entries(data).forEach(([username, tracking]) => {
      fkdrTracking.set(username.toLowerCase(), tracking);
    });
    saveFkdrTracking();
    
    res.json({ success: true, message: `Imported FKDR tracking for ${fkdrTracking.size} users` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/import/blacklist", (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({ success: false, message: 'No data provided' });
    }
    
    localBlacklist.clear();
    Object.entries(data).forEach(([username, entry]) => {
      localBlacklist.set(username.toLowerCase(), entry);
    });
    saveBlacklist();
    
    res.json({ success: true, message: `Imported ${localBlacklist.size} blacklist entries` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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
  <div class="max-w-7xl mx-auto">
    <!-- Header -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <h1 class="text-3xl font-bold mb-4 text-purple-400">RumoniumGC Control Panel v2.2</h1>
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

    <!-- Tabs -->
    <div class="mb-6">
      <div class="flex gap-2 border-b border-gray-700">
        <button onclick="showTab('chat')" id="tab-chat" class="px-4 py-2 font-bold text-purple-400 border-b-2 border-purple-400">CHAT</button>
        <button onclick="showTab('statistics')" id="tab-statistics" class="px-4 py-2 font-bold text-gray-400 hover:text-white">STATISTICS</button>
        <button onclick="showTab('permissions')" id="tab-permissions" class="px-4 py-2 font-bold text-gray-400 hover:text-white">PERMISSIONS</button>
        <button onclick="showTab('data')" id="tab-data" class="px-4 py-2 font-bold text-gray-400 hover:text-white">DATA MANAGEMENT</button>
        <button onclick="showTab('logs')" id="tab-logs" class="px-4 py-2 font-bold text-gray-400 hover:text-white">LOGS</button>
        <button onclick="showTab('blacklist')" id="tab-blacklist" class="px-4 py-2 font-bold text-gray-400 hover:text-white">BLACKLIST</button>
      </div>
    </div>

    <!-- Chat Tab -->
    <div id="content-chat" class="tab-content">
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

    <!-- Statistics Tab -->
    <div id="content-statistics" class="tab-content hidden">
      <!-- Command Stats -->
      <div class="grid grid-cols-3 gap-6 mb-6">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-4xl font-bold text-blue-400 mb-2" id="totalCommands">0</div>
          <div class="text-sm text-gray-400 mb-4">TOTAL COMMANDS</div>
          <div class="text-xs text-gray-500" id="commandsPerHour">0 per hour</div>
        </div>
        
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-4xl font-bold text-green-400 mb-2" id="totalMessages">0</div>
          <div class="text-sm text-gray-400 mb-4">TOTAL MESSAGES</div>
          <div class="text-xs text-gray-500" id="messagesPerHour">0 per hour</div>
        </div>
        
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-4xl font-bold text-purple-400 mb-2" id="apiCalls">0</div>
          <div class="text-sm text-gray-400 mb-4">API CALLS</div>
          <div class="text-xs text-gray-500" id="apiQueue">Queue: 0</div>
        </div>
      </div>

      <!-- Command Usage Chart -->
      <div class="grid grid-cols-2 gap-6 mb-6">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">TOP COMMANDS</h2>
          <div id="commandChart" class="space-y-3"></div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">TOP USERS</h2>
          <div id="userChart" class="space-y-3"></div>
        </div>
      </div>

      <!-- System Stats -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-sm text-gray-400 mb-2">CACHE SIZE</div>
          <div class="text-2xl font-bold text-cyan-400" id="cacheSize">0</div>
        </div>

        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-sm text-gray-400 mb-2">FKDR TRACKING</div>
          <div class="text-2xl font-bold text-yellow-400" id="fkdrTracking">0</div>
        </div>

        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-sm text-gray-400 mb-2">BLACKLISTED</div>
          <div class="text-2xl font-bold text-red-400" id="blacklistCount2">0</div>
        </div>

        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-sm text-gray-400 mb-2">PERMISSIONS SET</div>
          <div class="text-2xl font-bold text-orange-400" id="permissionsCount">0</div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">RECENT ACTIVITY</h2>
          <button onclick="loadStatistics()" class="text-sm px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">
            🔄 Refresh
          </button>
        </div>
        <div id="recentActivity" class="space-y-2 max-h-96 overflow-y-auto"></div>
      </div>
    </div>

    <!-- Permissions Tab -->
    <div id="content-permissions" class="tab-content hidden">
      <div class="grid grid-cols-2 gap-6">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">SET USER PERMISSIONS</h2>
          <div class="space-y-4">
            <input type="text" id="permUser" placeholder="Username" 
              class="w-full bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600 border border-gray-600">
            
            <div>
              <label class="block text-sm text-gray-400 mb-2">Mode</label>
              <select id="permMode" class="w-full bg-gray-700 rounded px-4 py-2 border border-gray-600" onchange="togglePermMode()">
                <option value="allow">Allow Only (Whitelist)</option>
                <option value="ban">Ban Specific (Blacklist)</option>
              </select>
            </div>

            <div>
              <label class="block text-sm text-gray-400 mb-2">Select Commands</label>
              <div id="commandsList" class="space-y-2 max-h-64 overflow-y-auto bg-gray-700 p-3 rounded"></div>
            </div>

            <div class="flex gap-2">
              <button onclick="savePermissions()" class="flex-1 px-4 py-2 rounded bg-green-600 font-bold hover:bg-green-700">SAVE</button>
              <button onclick="resetPermissions()" class="flex-1 px-4 py-2 rounded bg-red-600 font-bold hover:bg-red-700">RESET</button>
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">CURRENT PERMISSIONS</h2>
          <div id="permissionsList" class="space-y-2 max-h-96 overflow-y-auto"></div>
        </div>
      </div>
    </div>

        <!-- Blacklist Tab -->
    <div id="content-blacklist" class="tab-content hidden">
      <div class="grid grid-cols-2 gap-6">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">ADD TO BLACKLIST</h2>
          <div class="space-y-4">
            <input type="text" id="blacklistUser" placeholder="Username" 
              class="w-full bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600">
            
            <textarea id="blacklistReason" placeholder="Reason for blacklist..." 
              class="w-full bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600 h-24 resize-none"></textarea>
            
            <input type="text" id="blacklistAddedBy" placeholder="Your name (Added By)" 
              class="w-full bg-gray-700 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 border border-gray-600">

            <button onclick="addToBlacklistUI()" class="w-full px-4 py-2 rounded bg-red-600 font-bold hover:bg-red-700">
              ⚠️ ADD TO BLACKLIST
            </button>
          </div>

          <div class="mt-6 bg-yellow-900/30 border border-yellow-700 rounded p-4">
            <div class="font-bold text-yellow-300 mb-2">⚠️ Important</div>
            <div class="text-sm text-gray-300">
              Blacklisted users will be flagged when checked with !b check or !blacklist check command in-game.
              You can also use !b add and !b remove for short commands.
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold">BLACKLIST (<span id="blacklistCount">0</span>)</h2>
            <button onclick="loadBlacklistUI()" class="text-sm px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">
              🔄 Refresh
            </button>
          </div>
          <div id="blacklistList" class="space-y-2 max-h-[600px] overflow-y-auto"></div>
        </div>
      </div>
    </div>

        <!-- Edit Modal -->
    <div id="editModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 border border-gray-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Edit Blacklist Entry</h2>
          <button onclick="closeEditModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>

        <div class="flex gap-4 mb-4">
          <img id="editPlayerHead" src="" alt="Player Head" class="w-16 h-16 rounded border-2 border-gray-600">
          <div class="flex-1">
            <div class="text-xl font-bold text-red-400" id="editPlayerName"></div>
            <div class="text-xs text-gray-500 font-mono" id="editPlayerID"></div>
            <div class="text-xs text-gray-400" id="editPlayerDate"></div>
          </div>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-400 mb-2">Reason</label>
            <textarea id="editReason" class="w-full bg-gray-700 rounded px-4 py-2 border border-gray-600 h-24 resize-none"></textarea>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-2">Added By</label>
            <input type="text" id="editAddedBy" class="w-full bg-gray-700 rounded px-4 py-2 border border-gray-600">
          </div>

          <div class="flex gap-2">
            <button onclick="saveEdit()" class="flex-1 px-4 py-2 rounded bg-green-600 font-bold hover:bg-green-700">
              💾 SAVE
            </button>
            <button onclick="closeEditModal()" class="flex-1 px-4 py-2 rounded bg-gray-600 font-bold hover:bg-gray-700">
              CANCEL
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Data Management Tab -->
    <div id="content-data" class="tab-content hidden">
      <div class="grid grid-cols-2 gap-6">
        <!-- Export -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">📥 EXPORT DATA</h2>
          <div class="space-y-3">
            <button onclick="exportData('all')" class="w-full px-4 py-3 rounded bg-blue-600 font-bold hover:bg-blue-700 text-left">
              ⬇️ Export All Data (Full Backup)
            </button>
            <button onclick="exportData('permissions')" class="w-full px-4 py-3 rounded bg-gray-700 font-bold hover:bg-gray-600 text-left">
              ⬇️ Export Permissions Only
            </button>
            <button onclick="exportData('fkdr')" class="w-full px-4 py-3 rounded bg-gray-700 font-bold hover:bg-gray-600 text-left">
              ⬇️ Export FKDR Tracking Only
            </button>
            <button onclick="exportData('blacklist')" class="w-full px-4 py-3 rounded bg-gray-700 font-bold hover:bg-gray-600 text-left">
              ⬇️ Export Blacklist Only
            </button>
          </div>
        </div>

        <!-- Import -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-bold mb-4">📤 IMPORT DATA</h2>
          <div class="space-y-3">
            <div class="bg-yellow-900/30 border border-yellow-700 rounded p-3 text-sm">
              ⚠️ Importing will overwrite existing data. Make a backup first!
            </div>
            
            <div>
              <label class="block text-sm text-gray-400 mb-2">Import Type</label>
              <select id="importType" class="w-full bg-gray-700 rounded px-4 py-2 border border-gray-600">
                <option value="all">Full Backup (All Data)</option>
                <option value="permissions">Permissions Only</option>
                <option value="fkdr">FKDR Tracking Only</option>
                <option value="blacklist">Blacklist Only</option>
              </select>
            </div>

            <div>
              <label class="block text-sm text-gray-400 mb-2">Select File</label>
              <input type="file" id="importFile" accept=".json" 
                class="w-full bg-gray-700 rounded px-4 py-2 border border-gray-600 text-sm">
            </div>

            <button onclick="importData()" class="w-full px-4 py-3 rounded bg-green-600 font-bold hover:bg-green-700">
              📤 IMPORT DATA
            </button>

            <div id="importStatus" class="text-sm"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs Tab -->
    <div id="content-logs" class="tab-content hidden">
      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 class="text-xl font-bold mb-4">SYSTEM LOGS</h2>
        <div id="logs" class="space-y-2 max-h-screen overflow-y-auto"></div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    let availableCommands = [];

    // Tab management
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('text-purple-400', 'border-b-2', 'border-purple-400');
        el.classList.add('text-gray-400');
      });
      
      document.getElementById('content-' + tab).classList.remove('hidden');
      document.getElementById('tab-' + tab).classList.add('text-purple-400', 'border-b-2', 'border-purple-400');
      document.getElementById('tab-' + tab).classList.remove('text-gray-400');

      if (tab === 'statistics') loadStatistics();
      if (tab === 'permissions') loadPermissions();
      if (tab === 'blacklist') loadBlacklistUI();
    }

    // Chat functionality
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

    // Permissions management
    async function loadPermissions() {
      const res = await fetch('/api/permissions');
      const data = await res.json();
      
      availableCommands = data.availableCommands;
      renderCommandsList();
      renderPermissionsList(data.permissions);
    }

    function renderCommandsList() {
      const list = document.getElementById('commandsList');
      list.innerHTML = availableCommands.map(cmd => \`
        <label class="flex items-center gap-2 p-2 hover:bg-gray-600 rounded cursor-pointer">
          <input type="checkbox" value="\${cmd}" class="perm-checkbox">
          <span>\${cmd}</span>
        </label>
      \`).join('');
    }

    function togglePermMode() {
      // Just visual feedback, actual logic handled in save
    }

    function renderPermissionsList(permissions) {
      const list = document.getElementById('permissionsList');
      if (permissions.length === 0) {
        list.innerHTML = '<div class="text-gray-500">No custom permissions set. All users can use all commands.</div>';
        return;
      }

      list.innerHTML = permissions.map(p => {
        const mode = p.allowedCommands ? 'Whitelist' : 'Blacklist';
        const commands = p.allowedCommands || p.bannedCommands || [];
        return \`
          <div class="bg-gray-700 rounded p-3 border border-gray-600">
            <div class="flex justify-between items-center mb-2">
              <span class="font-bold">\${p.username}</span>
              <button onclick="removePermission('\${p.username}')" class="text-red-400 hover:text-red-300 text-sm">Remove</button>
            </div>
            <div class="text-sm text-gray-400">
              <span class="px-2 py-1 rounded bg-gray-600">\${mode}</span>
              <span class="ml-2">\${commands.join(', ')}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function savePermissions() {
      const username = document.getElementById('permUser').value.trim();
      if (!username) {
        alert('Please enter a username');
        return;
      }

      const mode = document.getElementById('permMode').value;
      const checkboxes = document.querySelectorAll('.perm-checkbox:checked');
      const commands = Array.from(checkboxes).map(cb => cb.value);

      if (commands.length === 0) {
        alert('Please select at least one command');
        return;
      }

      const payload = { username };
      if (mode === 'allow') {
        payload.allowedCommands = commands;
      } else {
        payload.bannedCommands = commands;
      }

      const res = await fetch('/api/permissions/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        alert('Permissions saved!');
        loadPermissions();
        document.getElementById('permUser').value = '';
        document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false);
      } else {
        alert('Error: ' + data.message);
      }
    }

    async function resetPermissions() {
      const username = document.getElementById('permUser').value.trim();
      if (!username) {
        alert('Please enter a username');
        return;
      }

      if (!confirm(\`Reset permissions for \${username}?\`)) return;

      const res = await fetch('/api/permissions/remove', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
      });

      const data = await res.json();
      alert(data.message);
      loadPermissions();
      document.getElementById('permUser').value = '';
    }

    async function removePermission(username) {
      if (!confirm(\`Remove permissions for \${username}?\`)) return;

      const res = await fetch('/api/permissions/remove', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
      });

      const data = await res.json();
      alert(data.message);
      loadPermissions();
    }

    // Data management
    async function exportData(type) {
      const url = \`/api/export/\${type}\`;
      window.location.href = url;
    }

    async function importData() {
      const type = document.getElementById('importType').value;
      const fileInput = document.getElementById('importFile');
      const file = fileInput.files[0];

      if (!file) {
        alert('Please select a file');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          
          const res = await fetch(\`/api/import/\${type}\`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data: type === 'all' ? data.data : data})
          });

          const result = await res.json();
          const status = document.getElementById('importStatus');
          
          if (result.success) {
            status.innerHTML = '<div class="bg-green-900/30 border border-green-700 rounded p-3 text-green-300">✓ ' + result.message + '</div>';
            setTimeout(() => status.innerHTML = '', 5000);
          } else {
            status.innerHTML = '<div class="bg-red-900/30 border border-red-700 rounded p-3 text-red-300">✗ ' + result.message + '</div>';
          }
        } catch (err) {
          alert('Invalid file format: ' + err.message);
        }
      };

      reader.readAsText(file);
    }

async function loadBlacklistUI() {
  try {
    const res = await fetch('/api/blacklist');
    const data = await res.json();
    
    document.getElementById('blacklistCount').textContent = data.total;
    
    // Update statistics tab counter too
    const blacklistCount2 = document.getElementById('blacklistCount2');
    if (blacklistCount2) {
      blacklistCount2.textContent = data.total;
    }
    
    const list = document.getElementById('blacklistList');
    
    if (data.total === 0) {
      list.innerHTML = '<div class="text-gray-500 text-center py-8">No users in blacklist</div>';
      return;
    }

    list.innerHTML = data.entries.map(entry => {
      const date = new Date(entry.addedOn).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      
      const timeAgo = getTimeAgo(entry.addedOn);
      const headUrl = \`https://mc-heads.net/avatar/\${entry.username}/64\`;
      
      return \`
        <div class="bg-gray-700 rounded-lg p-4 border border-gray-600 hover:border-red-500 transition-colors">
          <div class="flex gap-3 items-start mb-2">
            <img src="\${headUrl}" alt="\${entry.username}" 
              class="w-12 h-12 rounded border-2 border-gray-600"
              onerror="this.src='https://mc-heads.net/avatar/Steve/64'">
            
            <div class="flex-1">
              <div class="font-bold text-lg text-red-400">\${entry.username}</div>
              <div class="text-xs text-gray-500 font-mono">ID: \${entry.id || 'N/A'}</div>
              <div class="text-xs text-gray-400">\${timeAgo} • \${date}</div>
            </div>

            <div class="flex gap-2">
              <button onclick="editBlacklistEntry('\${entry.username}')" 
                class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-sm font-bold">
                ✏️ Edit
              </button>
              <button onclick="removeFromBlacklistUI('\${entry.username}')" 
                class="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-sm font-bold">
                🗑️
              </button>
            </div>
          </div>
          
          <div class="bg-gray-800 rounded p-3 mb-2">
            <div class="text-sm text-gray-300">\${entry.reason}</div>
          </div>
          
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span>Added by:</span>
            <span class="px-2 py-1 rounded bg-gray-600 font-medium">\${entry.addedBy}</span>
          </div>
        </div>
      \`;
    }).join('');

  } catch (err) {
    console.error('Failed to load blacklist:', err);
    alert('Failed to load blacklist: ' + err.message);
  }
}

    async function addToBlacklistUI() {
      const username = document.getElementById('blacklistUser').value.trim();
      const reason = document.getElementById('blacklistReason').value.trim();
      const addedBy = document.getElementById('blacklistAddedBy').value.trim();

      if (!username) {
        alert('Please enter a username');
        return;
      }

      if (!reason) {
        alert('Please enter a reason');
        return;
      }

      if (!addedBy) {
        alert('Please enter your name (Added By)');
        return;
      }

      if (!confirm(\`Add \${username} to blacklist?\\n\\nReason: \${reason}\`)) {
        return;
      }

      try {
        const res = await fetch('/api/blacklist/add', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username, reason, addedBy })
        });

        const data = await res.json();
        
        if (data.success) {
          alert(\`✓ \${username} added to blacklist\`);
          
          document.getElementById('blacklistUser').value = '';
          document.getElementById('blacklistReason').value = '';
          
          loadBlacklistUI();
        } else {
          alert('Error: ' + data.message);
        }
      } catch (err) {
        alert('Failed to add to blacklist: ' + err.message);
      }
    }

    async function removeFromBlacklistUI(username) {
      if (!confirm(\`Remove \${username} from blacklist?\`)) {
        return;
      }

      try {
        const res = await fetch('/api/blacklist/remove', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username })
        });

        const data = await res.json();
        alert(data.message);
        
        if (data.success) {
          loadBlacklistUI();
        }
      } catch (err) {
        alert('Failed to remove from blacklist: ' + err.message);
      }
    }

    function getTimeAgo(timestamp) {
      const now = Date.now();
      const then = new Date(timestamp).getTime();
      const diff = now - then;
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor(diff / (1000 * 60));
      
      if (days > 0) return \`\${days} day\${days > 1 ? 's' : ''} ago\`;
      if (hours > 0) return \`\${hours} hour\${hours > 1 ? 's' : ''} ago\`;
      if (minutes > 0) return \`\${minutes} minute\${minutes > 1 ? 's' : ''} ago\`;
      return 'just now';
    }

let currentEditingUser = null;

async function editBlacklistEntry(username) {
  try {
    const res = await fetch('/api/blacklist');
    const data = await res.json();
    const entry = data.entries.find(e => e.username.toLowerCase() === username.toLowerCase());
    
    if (!entry) {
      alert('Entry not found!');
      return;
    }

    currentEditingUser = username;
    
    document.getElementById('editPlayerHead').src = 'https://mc-heads.net/avatar/' + entry.username + '/64';
    document.getElementById('editPlayerName').textContent = entry.username;
    document.getElementById('editPlayerID').textContent = 'ID: ' + (entry.id || 'N/A');
    
    const date = new Date(entry.addedOn).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    document.getElementById('editPlayerDate').textContent = 'Added: ' + date;
    
    document.getElementById('editReason').value = entry.reason;
    document.getElementById('editAddedBy').value = entry.addedBy;
    
    document.getElementById('editModal').classList.remove('hidden');
  } catch (err) {
    alert('Failed to load entry: ' + err.message);
  }
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
  currentEditingUser = null;
}

async function saveEdit() {
  if (!currentEditingUser) return;

  const reason = document.getElementById('editReason').value.trim();
  const addedBy = document.getElementById('editAddedBy').value.trim();

  if (!reason) {
    alert('Reason cannot be empty!');
    return;
  }

  if (!addedBy) {
    alert('Added By cannot be empty!');
    return;
  }

  try {
    const res = await fetch('/api/blacklist/update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        username: currentEditingUser,
        reason: reason,
        addedBy: addedBy
      })
    });

    const data = await res.json();
    
    if (data.success) {
      alert('✓ ' + currentEditingUser + ' updated successfully!');
      closeEditModal();
      loadBlacklistUI();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Failed to save changes: ' + err.message);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeEditModal();
  }
});

        // Statistics management
    async function loadStatistics() {
      try {
        const [statsRes, blacklistRes, permissionsRes, fkdrRes, activityRes] = await Promise.all([
          fetch('/api/stats'),
          fetch('/api/blacklist'),
          fetch('/api/permissions'),
          fetch('/api/fkdr-tracking'),
          fetch('/api/activity')
        ]);

        const stats = await statsRes.json();
        const blacklist = await blacklistRes.json();
        const permissions = await permissionsRes.json();
        const fkdr = await fkdrRes.json();
        const activity = await activityRes.json();

        document.getElementById('totalCommands').textContent = stats.commandCount || 0;
        document.getElementById('totalMessages').textContent = stats.messageCount || 0;
        document.getElementById('apiCalls').textContent = stats.apiCallCount || 0;
        document.getElementById('apiQueue').textContent = \`Queue: \${stats.queueLength || 0}\`;

        const uptimeHours = stats.uptimeMs ? stats.uptimeMs / (1000 * 60 * 60) : 0;
        const commandsPerHour = uptimeHours > 0 ? Math.round((stats.commandCount || 0) / uptimeHours) : 0;
        const messagesPerHour = uptimeHours > 0 ? Math.round((stats.messageCount || 0) / uptimeHours) : 0;
        
        document.getElementById('commandsPerHour').textContent = \`\${commandsPerHour} per hour\`;
        document.getElementById('messagesPerHour').textContent = \`\${messagesPerHour} per hour\`;

        document.getElementById('cacheSize').textContent = stats.cacheSize || 0;
        document.getElementById('fkdrTracking').textContent = fkdr.count || 0;
        document.getElementById('blacklistCount2').textContent = blacklist.total || 0;
        document.getElementById('permissionsCount').textContent = permissions.permissions?.length || 0;

        renderCommandChart(stats.topCommands || []);
        renderUserChart(stats.topUsers || []);
        renderRecentActivity(activity.recent || []);

      } catch (err) {
        console.error('Failed to load statistics:', err);
      }
    }

    function renderCommandChart(topCommands) {
      const chart = document.getElementById('commandChart');
      
      if (!topCommands || topCommands.length === 0) {
        chart.innerHTML = '<div class="text-gray-500 text-center py-4">No command data yet</div>';
        return;
      }

      const maxCount = Math.max(...topCommands.map(c => c.count));
      
      chart.innerHTML = topCommands.slice(0, 10).map(cmd => {
        const percentage = maxCount > 0 ? (cmd.count / maxCount) * 100 : 0;
        return \`
          <div class="flex items-center gap-3">
            <div class="w-20 text-sm font-mono text-gray-400">!\${cmd.command}</div>
            <div class="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden">
              <div class="bg-gradient-to-r from-purple-500 to-blue-500 h-full flex items-center px-3" 
                style="width: \${percentage}%">
                <span class="text-xs font-bold text-white">\${cmd.count}</span>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderUserChart(topUsers) {
      const chart = document.getElementById('userChart');
      
      if (!topUsers || topUsers.length === 0) {
        chart.innerHTML = '<div class="text-gray-500 text-center py-4">No user data yet</div>';
        return;
      }

      const maxCount = Math.max(...topUsers.map(u => u.count));
      
      chart.innerHTML = topUsers.slice(0, 10).map(user => {
        const percentage = maxCount > 0 ? (user.count / maxCount) * 100 : 0;
        return \`
          <div class="flex items-center gap-3">
            <div class="w-24 text-sm font-medium text-gray-300 truncate">\${user.username}</div>
            <div class="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden">
              <div class="bg-gradient-to-r from-green-500 to-cyan-500 h-full flex items-center px-3" 
                style="width: \${percentage}%">
                <span class="text-xs font-bold text-white">\${user.count}</span>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderRecentActivity(activity) {
      const list = document.getElementById('recentActivity');
      
      if (!activity || activity.length === 0) {
        list.innerHTML = '<div class="text-gray-500 text-center py-4">No recent activity</div>';
        return;
      }

      list.innerHTML = activity.slice(0, 20).map(act => {
        const time = new Date(act.timestamp).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        const typeColors = {
          command: 'bg-blue-600',
          blacklist: 'bg-red-600',
          fkdr: 'bg-yellow-600',
          permission: 'bg-purple-600',
          system: 'bg-gray-600'
        };
        
        const icon = {
          command: '⚡',
          blacklist: '⚠️',
          fkdr: '📊',
          permission: '🔒',
          system: '⚙️'
        };

        return \`
          <div class="flex items-center gap-3 bg-gray-700 rounded p-3 border border-gray-600">
            <span class="text-xs text-gray-400 w-14">\${time}</span>
            <span class="px-2 py-1 rounded text-xs font-semibold \${typeColors[act.type] || 'bg-gray-600'}">
              \${icon[act.type] || '•'} \${act.type.toUpperCase()}
            </span>
            <span class="flex-1 text-sm text-gray-300">\${act.description}</span>
          </div>
        \`;
      }).join('');
    }

    setInterval(() => {
      const statsTab = document.getElementById('content-statistics');
      if (!statsTab.classList.contains('hidden')) {
        loadStatistics();
      }
    }, 10000);

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

server.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  if (URCHIN_ENABLED) {
    console.log(`🔑 Urchin API Key: ${URCHIN_API_KEY.substring(0, 10)}...`);
  } else {
    console.log('⚠️ Urchin API disabled - set URCHIN_API_KEY to enable !view command');
  }
  loadCommandPermissions();
  loadFkdrTracking();
  loadBlacklist();
  
  // Test Urchin connection
  if (URCHIN_ENABLED) {
    await testUrchinConnection();
  }
});

// === Bot Implementation ===
const askCooldowns = {};
const welcomeMessages = [
  "Hello! Welcome back {username}!",
  "Welcome, {username}! The legend returns!",
  "{username} joined, hey there!"
];

function createBot() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('❌ Max reconnection attempts reached. Stopping.');
    addLog('error', 'Max reconnection attempts exceeded');
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
          addLog('success', 'Bot ready');
        }, 2000);
      }
    }, 1500);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    io.emit('minecraft-chat', { time: new Date().toLocaleTimeString('en-US'), message: msg });
    messageCount++;

    if (!msg.startsWith("Guild >") || !botReady) return;

    const safeChat = async (m) => {
      if (!botReady || !bot?.chat) return;
      try { 
        bot.chat(m);
        await sleep(botSettings.performance.messageDelay);
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
        addLog('warning', `${requester} tried to use !gexp but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('gexp');
      incrementUserStat(requester);
      addActivity('command', `${requester} used !gexp for ${ign}`, requester);
      
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
        addLog('warning', `${username} tried to use !ask but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('ask');
      incrementUserStat(username);
      addActivity('command', `${username} asked: ${userMessage.substring(0, 50)}...`, username);

      if (username.toLowerCase() !== "relaquent") {
        const now = Date.now();
        const lastUsed = askCooldowns[username] || 0;
        const timePassed = now - lastUsed;
        if (timePassed < botSettings.commandCooldown * 1000) {
          const sec = Math.ceil((botSettings.commandCooldown * 1000 - timePassed) / 1000);
          await safeChat(`${username}, wait ${sec} seconds`);
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
          await safeChat("Welcome Caillou16, baldy.");
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
        addLog('warning', `${requester} tried to use !bw but was blocked`);
        return;
      }
      
commandCount++;
      incrementCommandStat('bw');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked BW stats for ${ign}`, requester);
      
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
        addLog('warning', `${requester} tried to use !stats but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('stats');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked detailed stats for ${ign}`, requester);
      
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
        addLog('warning', `${requester} tried to use !when but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('when');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked castle timer`, requester);
      
      const first = new Date("2026-01-16T00:08:00Z");
      const now = new Date();
      let diff = now - first;
      let cycles = Math.floor(diff / (56 * 86400000));
      if (diff < 0) cycles = -1;
      const next = new Date(first.getTime() + (cycles + 1) * 56 * 86400000);
      const days = Math.ceil((next - now) / 86400000);
      
      await safeChat(days > 0 ? `Castle in ${days} days (${next.toLocaleDateString('en-US')})` : "Castle today!");
      return;
    }

    // === !about ===
    if (msg.toLowerCase().includes("!about")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      if (!hasCommandPermission(requester, 'about')) {
        await safeChat(`${requester}, you don't have permission to use !about`);
        addLog('warning', `${requester} tried to use !about but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('about');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked bot info`, requester);
      await safeChat("RumoniumGC by Relaquent, v2.3 - Stellar Lumen Edition");
      return;
    }

    // === !help ===
    if (msg.toLowerCase().includes("!help")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      if (!hasCommandPermission(requester, 'help')) {
        await safeChat(`${requester}, you don't have permission to use !help`);
        addLog('warning', `${requester} tried to use !help but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('help');
      incrementUserStat(requester);
      addActivity('command', `${requester} requested help`, requester);
      
      const help = [
        "--- Rumonium ---",
        "bw <player> - Bedwars stats",
        "gexp <player> - Weekly GEXP",
        "stats <player> - Detailed stats",
        "when - Next Castle",
        "ask <message> - Ask AI",
        URCHIN_ENABLED ? "view <player> - Status check" : null,
        "fkdr start - Start tracking",
        "fkdr - View progress",
        "fkdr stop - Stop tracking",
        "nfkdr <player> - Calculate next FKDR",
        "about - Bot info",
        "----------------"
      ].filter(Boolean);
      
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
      
      if (!URCHIN_ENABLED) {
        await safeChat(`${requester}, Urchin API is disabled`);
        return;
      }
      
      if (!hasCommandPermission(requester, 'view')) {
        await safeChat(`${requester}, you don't have permission to use !view`);
        addLog('warning', `${requester} tried to use !view but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('view');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked Urchin for ${ign}`, requester);
      
      try {
        await safeChat(`Checking ${ign}...`);
        const result = await checkUrchinBlacklist(ign);
        const lines = result.split('\n');
        
        for (const line of lines) {
          if (line.trim()) {
            await safeChat(line.trim());
          }
        }
        
        addLog('info', `${requester} checked ${ign} on Urchin`);
      } catch (err) {
        await safeChat(`Urchin error: ${err.message}`);
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
        addLog('warning', `${requester} tried to use !fkdr but was blocked`);
        return;
      }
      
      commandCount++;
      
      if (matchStart) {
        try {
          if (fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, your FKDR is already being tracked!`);
            return;
          }
          
          await startFkdrTracking(requester);
          await safeChat(`✓ FKDR tracking started for ${requester}!`);
          await sleep(500);
          await safeChat(`Use !fkdr to view progress`);
          addLog('success', `FKDR tracking started for ${requester}`);
        } catch (err) {
          await safeChat(`Tracking start error: ${err.message}`);
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
          await safeChat(`✓ FKDR tracking stopped for ${requester}`);
          addLog('info', `FKDR tracking stopped for ${requester}`);
        } catch (err) {
          await safeChat(`Tracking stop error: ${err.message}`);
        }
        return;
      }
      
      if (matchStatus) {
        try {
          if (!fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, use !fkdr start to begin`);
            return;
          }
          
          const tracking = await updateFkdrSnapshot(requester);
          if (!tracking) {
            await safeChat(`Error updating FKDR data`);
            return;
          }
          
          const progress = calculateFkdrProgress(tracking);
          
          if (!progress) {
            await safeChat(`${requester}, not enough data yet. Try later!`);
            return;
          }
          
          await safeChat(`${requester} | Current FKDR: ${progress.current.fkdr}`);
          
          if (progress.daily) {
            const dailySign = progress.daily.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Daily: ${dailySign}${progress.daily.fkdr} FKDR | Session: ${progress.daily.sessionFkdr} | Finals: ${progress.daily.finals}`);
          }
          
          if (progress.weekly) {
            const weeklySign = progress.weekly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Weekly: ${weeklySign}${progress.weekly.fkdr} FKDR | Session: ${progress.weekly.sessionFkdr} | Finals: ${progress.weekly.finals}`);
          }
          
          if (progress.monthly) {
            const monthlySign = progress.monthly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Monthly: ${monthlySign}${progress.monthly.fkdr} FKDR | Session: ${progress.monthly.sessionFkdr} | Finals: ${progress.monthly.finals}`);
          }
          
          addLog('info', `${requester} checked FKDR progress`);
        } catch (err) {
          await safeChat(`Error: ${err.message}`);
          addLog('error', `FKDR status error for ${requester}: ${err.message}`);
        }
        return;
      }
    }


    // === !blacklist / !b ===
    if (msg.toLowerCase().includes("!blacklist") || msg.toLowerCase().includes("!b ")) {
      const matchAdd = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!(?:blacklist|b)\s+add\s+([A-Za-z0-9_]{1,16})\s+(.+)/i);
      const matchRemove = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!(?:blacklist|b)\s+remove\s+([A-Za-z0-9_]{1,16})/i);
      const matchCheck = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!(?:blacklist|b)\s+check\s+([A-Za-z0-9_]{1,16})/i);
      
      if (!matchAdd && !matchRemove && !matchCheck) return;
      
      const requester = (matchAdd || matchRemove || matchCheck)[1];
      
      if (!hasCommandPermission(requester, 'blacklist')) {
        await safeChat(`${requester}, you don't have permission to use !blacklist`);
        addLog('warning', `${requester} tried to use !blacklist but was blocked`);
        return;
      }
      
      commandCount++;
      
      // Add to blacklist
      if (matchAdd) {
        const [, , targetUser, reason] = matchAdd;
        
        try {
          const entry = addToBlacklist(targetUser, reason, requester);
          await safeChat(`✓ ${targetUser} added to blacklist`);
          await sleep(500);
          await safeChat(`ID: #${entry.id} | Reason: ${reason.substring(0, 60)}`);
          addLog('info', `${requester} added ${targetUser} to blacklist: ${reason}`);
          addActivity('blacklist', `${requester} added ${targetUser} to blacklist`, requester);
          incrementCommandStat('blacklist');
          incrementUserStat(requester);
        } catch (err) {
          await safeChat(`Error adding to blacklist: ${err.message}`);
          addLog('error', `Blacklist add failed: ${err.message}`);
        }
        return;
      }
      
      // Remove from blacklist
      if (matchRemove) {
        const [, , targetUser] = matchRemove;
        
        try {
          const removed = removeFromBlacklist(targetUser);
          if (removed) {
            await safeChat(`✓ ${targetUser} removed from blacklist`);
            addLog('info', `${requester} removed ${targetUser} from blacklist`);
          } else {
            await safeChat(`${targetUser} not found in blacklist`);
          }
        } catch (err) {
          await safeChat(`Error removing from blacklist: ${err.message}`);
          addLog('error', `Blacklist remove failed: ${err.message}`);
        }
        return;
      }
      
      // Check blacklist
      if (matchCheck) {
        const [, , targetUser] = matchCheck;
        
        commandCount++;
        incrementCommandStat('blacklist');
        incrementUserStat(requester);
        addActivity('command', `${requester} checked blacklist for ${targetUser}`, requester);
        
        try {
          const entry = checkBlacklist(targetUser);
          
          if (entry) {
  const date = new Date(entry.addedOn).toLocaleDateString('en-US');
  await safeChat(`⚠️ ${targetUser} is blacklisted`);
  await sleep(500);
  await safeChat(`ID: #${entry.id} | Added: ${date}`);
  await sleep(500);
  await safeChat(`Reason: ${entry.reason.substring(0, 60)}`);
  await sleep(500);
  await safeChat(`Added by: ${entry.addedBy}`);
  addLog('info', `${requester} checked blacklist for ${targetUser} - Found`);
} else {
            await safeChat(`✓ ${targetUser} not in blacklist`);
            addLog('info', `${requester} checked blacklist for ${targetUser} - Clean`);
          }
        } catch (err) {
          await safeChat(`Error checking blacklist: ${err.message}`);
          addLog('error', `Blacklist check failed: ${err.message}`);
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
        addLog('warning', `${requester} tried to use !nfkdr but was blocked`);
        return;
      }
      
      commandCount++;
      incrementCommandStat('nfkdr');
      incrementUserStat(requester);
      addActivity('command', `${requester} checked nfkdr for ${ign}`, requester);
      
      try {
        const stats = await getPlayerStats(ign);
        const currentFkdr = parseFloat(stats.fkdr);
        const currentFinals = stats.finals;
        const currentDeaths = stats.deaths;
        
        const nextWholeFkdr = Math.ceil(currentFkdr);
        const targetFkdr = currentFkdr % 1 === 0 ? currentFkdr + 1 : nextWholeFkdr;
        const finalsNeeded = Math.ceil((targetFkdr * currentDeaths) - currentFinals);
        
        if (finalsNeeded <= 0) {
          await safeChat(`${ign} already at ${currentFkdr} FKDR!`);
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
      console.log(`⏳ Reconnecting in ${delay/1000} seconds...`);
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
      console.log(`⏳ Reconnecting in ${delay/1000} seconds...`);
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
  saveBlacklist();
  if (bot) bot.quit();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, saving data...');
  saveCommandPermissions();
  saveFkdrTracking();
  saveBlacklist();
  if (bot) bot.quit();
  process.exit(0);
});

// Auto-save
setInterval(() => {
  saveCommandPermissions();
  saveFkdrTracking();
  saveBlacklist();
}, 5 * 60 * 1000);

// Update FKDR snapshots every 6 hours
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

