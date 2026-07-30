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

// === Aurora API Setup ===
if (!process.env.AURORA_API_KEY) {
  console.error("❌ AURORA_API_KEY not found.");
  process.exit(1);
}
const AURORA_API_KEY = process.env.AURORA_API_KEY;
const AURORA_API_BASE = "https://bordic.xyz/api/v2/resources/ping";

// === Urchin API Setup ===
const URCHIN_ENABLED = !!process.env.URCHIN_API_KEY;
const URCHIN_API_KEY = process.env.URCHIN_API_KEY || null;
const URCHIN_API_BASE = "https://urchin.ws";
let WORKING_URCHIN_URL = null;

// === Urchin Admin (Tag) Setup ===
const URCHIN_ADMIN_API_KEY = process.env.URCHIN_ADMIN_API_KEY || URCHIN_API_KEY;
const TAG_ADMINS = ["relaquent"]; // sadece buradakiler !tag kullanabilir, küçük harf
const URCHIN_TAG_TYPES = ["account","info","caution","possible_sniper","sniper","legit_sniper","closet_cheater","blatant_cheater","confirmed_cheater"];

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
  for (const entry of localBlacklist.values()) {
    if (entry.id === id) {
      return generateBlacklistID();
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
  } catch (err) {
    console.error('❌ Failed to save blacklist:', err.message);
  }
}

function addToBlacklist(username, reason, addedBy) {
  const id = generateBlacklistID();
  const entry = {
    id,
    username,
    reason,
    addedBy,
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

// === Command Permissions ===
const commandPermissions = new Map();
const PERMISSIONS_FILE = path.join(__dirname, "command_permissions.json");

const AVAILABLE_COMMANDS = [
  'bw', 'gexp', 'stats', 'when', 'ask', 'about', 'help',
  'fkdr', 'nfkdr', 'view', 'weekly', 'monthly', 'yearly', 'tag', 'blacklist', 'ping', 'online'
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
  } catch (err) {
    console.error('❌ Failed to save permissions:', err.message);
  }
}

function hasCommandPermission(username, command) {
  const userPerms = commandPermissions.get(username.toLowerCase());
  if (!userPerms) return true;
  if (userPerms.bannedCommands && userPerms.bannedCommands.includes(command)) return false;
  if (userPerms.allowedCommands && userPerms.allowedCommands.length > 0) {
    return userPerms.allowedCommands.includes(command);
  }
  return true;
}

// === Bot State ===
let bot = null;
let botReady = false;
let startTime = Date.now();
let commandCount = 0;
let messageCount = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isReconnecting = false;

// BUG FIX: Removed hard MAX_RECONNECT_ATTEMPTS cap — bot now retries indefinitely
// with exponential backoff (max 5 minutes between attempts) for true 24/7 uptime.
const BASE_RECONNECT_DELAY = 15000;
const MAX_RECONNECT_DELAY = 5 * 60 * 1000; // 5 minutes cap

function getReconnectDelay() {
  // Exponential backoff: 15s, 30s, 60s, 120s, 240s, then caps at 300s
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, Math.min(reconnectAttempts, 5)),
    MAX_RECONNECT_DELAY
  );
  return delay;
}

// === Statistics Tracking ===
const commandStats = new Map();
const userStats = new Map();
const recentActivity = [];
const MAX_ACTIVITY = 100;

function addActivity(type, description, username = null) {
  const activity = { timestamp: new Date().toISOString(), type, description, username };
  recentActivity.unshift(activity);
  if (recentActivity.length > MAX_ACTIVITY) recentActivity.pop();
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
  io.emit('bot-log', { time: logEntry.time, type: logEntry.type, msg: logEntry.message });
}

// === Hypixel API ===
if (!process.env.HYPIXEL_API_KEY) {
  console.error("❌ HYPIXEL_API_KEY not found.");
  process.exit(1);
}
const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY;
const HYPIXEL_HOST = "mc.hypixel.net";
const MC_VERSION = "1.8.9";

// === Aurora API - Get Player Ping ===
async function getPlayerPing(ign) {
  const playerData = await getPlayerUUID(ign);
  const uuid = playerData.uuid;
  const url = `${AURORA_API_BASE}?key=${AURORA_API_KEY}&uuid=${uuid}`;

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'Accept': 'application/json', 'User-Agent': 'RumoniumGC-Bot/2.3' }
  });

  if (response.status === 200 && response.data?.success && response.data?.data) {
    const pingData = response.data.data;
    if (pingData.length > 0) {
      const latest = pingData[0];
      return {
        ping: latest.avg,
        max: latest.max,
        min: latest.min,
        timestamp: getTimeAgo(new Date(latest.timestamp))
      };
    }
    throw new Error('No ping data available');
  }
  throw new Error('Invalid API response');
}

function ratio(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d === 0) return n > 0 ? "inf" : "0.00";
  return (n / d).toFixed(2);
}

// === Hypixel API - Check Player Online Status ===
async function getPlayerOnlineStatus(ign) {
  const playerData = await getPlayerUUID(ign);
  const player = playerData.fullData;

  const isOnline = player?.lastLogin && player?.lastLogout
    ? player.lastLogin > player.lastLogout
    : false;

  const lastLoginTs = player?.lastLogin;
  const lastLogoutTs = player?.lastLogout;

  return {
    online: isOnline,
    lastLogin: lastLoginTs ? getTimeAgo(new Date(lastLoginTs)) : 'Unknown',
    lastLogout: lastLogoutTs ? getTimeAgo(new Date(lastLogoutTs)) : 'Unknown',
  };
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
  } catch (err) {
    console.error('❌ Failed to save FKDR tracking:', err.message);
  }
}

async function startFkdrTracking(username) {
  const playerData = await getPlayerUUID(username);
  const stats = parseBWStats(playerData.fullData);
  const now = new Date();
  const tracking = {
    username,
    uuid: playerData.uuid,
    startDate: now.toISOString(),
    snapshots: [{
      timestamp: now.toISOString(),
      finals: stats.finals,
      deaths: stats.deaths,
      fkdr: parseFloat(stats.fkdr)
    }]
  };
  fkdrTracking.set(username.toLowerCase(), tracking);
  saveFkdrTracking();
  return true;
}

async function updateFkdrSnapshot(username) {
  const tracking = fkdrTracking.get(username.toLowerCase());
  if (!tracking) return null;

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
}

function parseActivityScore(player) {
  const bw = player?.stats?.Bedwars || {};
  const sw = player?.stats?.SkyWars || {};
  const duels = player?.stats?.Duels || {};
  const uhc = player?.stats?.UHC || {};
  const mm = player?.stats?.MurderMystery || {};
  const bb = player?.stats?.BuildBattle || {};
  const arcade = player?.stats?.Arcade || {};
  const walls = player?.stats?.Walls || {};
  const paintball = player?.stats?.Paintball_PVP || {};
  const cw = player?.stats?.CrazyWalls || {};
  const speed = player?.stats?.SpeedUHC || {};
  const smash = player?.stats?.SuperSmash || {};
  const tnt = player?.stats?.TNTGames || {};
  const blitz = player?.stats?.HungerGames || {};
  const pit = player?.stats?.Pit?.profile || {};

  const sum = (...nums) => nums.reduce((a, b) => a + (Number(b) || 0), 0);

  return {
    bedwars:      sum(bw.kills_bedwars, bw.deaths_bedwars, bw.wins_bedwars, bw.losses_bedwars, bw.games_played_bedwars),
    skywars:      sum(sw.kills, sw.deaths, sw.wins, sw.losses, sw.games),
    duels:        sum(duels.kills, duels.deaths, duels.wins, duels.losses, duels.games_played_duels),
    uhc:          sum(uhc.kills, uhc.deaths, uhc.wins, uhc.losses, uhc.games),
    murdermystery:sum(mm.kills, mm.deaths, mm.wins, mm.games),
    buildbattle:  sum(bb.wins, bb.games_played, bb.score),
    arcade:       sum(arcade.wins, arcade.coins),
    walls:        sum(walls.kills, walls.deaths, walls.wins, walls.losses),
    speeduhc:     sum(speed.kills, speed.deaths, speed.wins, speed.losses),
    smash:        sum(smash.kills, smash.deaths, smash.wins, smash.losses, smash.games),
    tnt:          sum(tnt.wins_tntrun, tnt.record_tntrun, tnt.wins_pvprun, tnt.wins_bowspleef, tnt.wins_capture),
    blitz:        sum(blitz.kills, blitz.deaths, blitz.wins),
    pit:          sum(pit.kills, pit.deaths, pit.cash_earned),
    total:        0
  };
}

function calcTotalActivity(scores) {
  scores.total = Object.entries(scores)
    .filter(([k]) => k !== 'total')
    .reduce((a, [, v]) => a + v, 0);
  return scores;
}

function calculateFkdrProgress(tracking) {
  if (!tracking || tracking.snapshots.length < 2) return null;

  const now = new Date();
  const snapshots = tracking.snapshots;
  const latest = snapshots[snapshots.length - 1];

  const oneDayAgo = now.getTime() - (24 * 60 * 60 * 1000);
  const dailySnapshot = snapshots.filter(s => new Date(s.timestamp).getTime() >= oneDayAgo)[0];

  const oneWeekAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
  const weeklySnapshot = snapshots.filter(s => new Date(s.timestamp).getTime() >= oneWeekAgo)[0];

  const oneMonthAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);
  const monthlySnapshot = snapshots.filter(s => new Date(s.timestamp).getTime() >= oneMonthAgo)[0];

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

// === Activity Tracking System ===
const activityTracking = new Map();
const ACTIVITY_TRACKING_FILE = path.join(__dirname, "activity_tracking.json");

function loadActivityTracking() {
  try {
    if (fs.existsSync(ACTIVITY_TRACKING_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACTIVITY_TRACKING_FILE, 'utf8'));
      Object.entries(data).forEach(([username, tracking]) => {
        activityTracking.set(username.toLowerCase(), tracking);
      });
      console.log(`✅ Loaded activity tracking for ${activityTracking.size} players`);
    }
  } catch (err) {
    console.error('❌ Failed to load activity tracking:', err.message);
  }
}

function saveActivityTracking() {
  try {
    const data = Object.fromEntries(activityTracking);
    fs.writeFileSync(ACTIVITY_TRACKING_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Failed to save activity tracking:', err.message);
  }
}

async function startActivityTracking(username) {
  const playerData = await getPlayerUUID(username);
  const scores = calcTotalActivity(parseActivityScore(playerData.fullData));
  const now = new Date();
  const tracking = {
    username,
    uuid: playerData.uuid,
    startDate: now.toISOString(),
    snapshots: [{
      timestamp: now.toISOString(),
      scores
    }]
  };
  activityTracking.set(username.toLowerCase(), tracking);
  saveActivityTracking();
  return tracking;
}

async function updateActivitySnapshot(username) {
  const tracking = activityTracking.get(username.toLowerCase());
  if (!tracking) return null;
  // Force fresh data - bypass cache for activity checks
  const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(username)}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data?.success || !data?.player) throw new Error("Player not found");
  const scores = calcTotalActivity(parseActivityScore(data.player));
  const now = new Date();
  tracking.snapshots.push({
    timestamp: now.toISOString(),
    scores
  });
  // Keep last 90 days
  const ninetyDaysAgo = now.getTime() - (90 * 24 * 60 * 60 * 1000);
  tracking.snapshots = tracking.snapshots.filter(s =>
    new Date(s.timestamp).getTime() > ninetyDaysAgo
  );
  activityTracking.set(username.toLowerCase(), tracking);
  saveActivityTracking();
  return tracking;
}

function detectActivityFromSnapshots(tracking) {
  if (!tracking || tracking.snapshots.length < 2) return null;
  const snapshots = tracking.snapshots;
  const latest = snapshots[snapshots.length - 1];

  // Find the most recent snapshot where something changed
  let lastActiveSnapshot = null;
  let lastActiveGame = null;
  for (let i = snapshots.length - 2; i >= 0; i--) {
    const prev = snapshots[i];
    const games = Object.keys(latest.scores).filter(k => k !== 'total');
    for (const game of games) {
      if ((latest.scores[game] || 0) > (prev.scores[game] || 0)) {
        if (!lastActiveSnapshot || new Date(prev.timestamp) > new Date(lastActiveSnapshot.timestamp)) {
          lastActiveSnapshot = prev;
          lastActiveGame = game;
        }
      }
    }
    if (lastActiveSnapshot) break;
  }

  if (!lastActiveSnapshot) return { active: false, lastSeen: null, game: null };

  // Find the first snapshot AFTER the change to narrow the window
  const changeIdx = snapshots.indexOf(lastActiveSnapshot);
  const afterChange = snapshots[changeIdx + 1];

  return {
    active: true,
    // Activity happened between lastActiveSnapshot and afterChange
    windowStart: lastActiveSnapshot.timestamp,
    windowEnd: afterChange ? afterChange.timestamp : latest.timestamp,
    game: lastActiveGame,
    // Calculate time ago from midpoint of window for best estimate
    windowStartAgo: getTimeAgo(new Date(lastActiveSnapshot.timestamp)),
    windowEndAgo: afterChange ? getTimeAgo(new Date(afterChange.timestamp)) : 'now',
    totalChange: latest.scores.total - snapshots[0].scores.total
  };
}

function stopActivityTracking(username) {
  if (activityTracking.has(username.toLowerCase())) {
    activityTracking.delete(username.toLowerCase());
    saveActivityTracking();
    return true;
  }
  return false;
}

// === Urchin API ===
async function testUrchinConnection() {
  if (!URCHIN_ENABLED) {
    addLog('warning', 'Urchin API disabled - !view command unavailable');
    return false;
  }

  try {
    const params = new URLSearchParams({
      key: URCHIN_API_KEY,
      sources: 'GAME,PARTY,PARTY_INVITES,CHAT,CHAT_MENTIONS,MANUAL,ME'
    });
    const testUrl = `${URCHIN_API_BASE}/player/Technoblade?${params.toString()}`;
    const response = await axios.get(testUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'RumoniumGC-Bot/2.3' },
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 || response.status === 404) {
      WORKING_URCHIN_URL = URCHIN_API_BASE;
      addLog('success', `Urchin API connected`);
      return true;
    }
    if (response.status === 401) {
      addLog('error', 'Invalid Urchin API key');
      return false;
    }
    addLog('error', `Urchin unexpected status: ${response.status}`);
    return false;
  } catch (err) {
    addLog('error', `Urchin connection failed: ${err.message}`);
    return false;
  }
}

async function checkUrchinBlacklist(username) {
  if (!URCHIN_ENABLED) throw new Error('Urchin API not configured');
  if (!WORKING_URCHIN_URL) {
    const connected = await testUrchinConnection();
    if (!connected) throw new Error('Urchin API unavailable');
  }

  async function addUrchinTag(uuid, tagType, reason, overwrite = false) {
  if (!URCHIN_ENABLED) throw new Error('Urchin API not configured');
  const url = `https://urchin.ws/admin/add-tag?key=${URCHIN_ADMIN_API_KEY}`;
  const response = await axios.post(url,
    { uuid, tag_type: tagType, reason, hide_username: false, overwrite },
    { timeout: 10000, headers: { 'Content-Type': 'application/json' }, validateStatus: s => s < 500 }
  );
  if (response.status === 200) return response.data.message || 'Tag added';
  if (response.status === 400) throw new Error(`Invalid tag type. Valid: ${URCHIN_TAG_TYPES.join(', ')}`);
  if (response.status === 401) throw new Error('Invalid admin API key');
  if (response.status === 403) throw new Error('Admin access required (key not authorized)');
  if (response.status === 409) throw new Error('Tag already exists (overwrite=false)');
  throw new Error(`Urchin error: ${response.status}`);
}

  const params = new URLSearchParams({
    key: URCHIN_API_KEY,
    sources: 'GAME,PARTY,PARTY_INVITES,CHAT,CHAT_MENTIONS,MANUAL,ME'
  });
  const url = `${WORKING_URCHIN_URL}/player/${encodeURIComponent(username)}?${params.toString()}`;

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'Accept': 'application/json', 'User-Agent': 'RumoniumGC-Bot/2.3' },
    validateStatus: (status) => status < 500
  });

  if (response.status === 404) return `${username} - Not in database (Clean)`;
  if (response.status === 401) { WORKING_URCHIN_URL = null; throw new Error('Invalid API key'); }
  if (response.status === 403) { WORKING_URCHIN_URL = null; throw new Error('API key locked'); }
  if (response.status === 429) throw new Error('Rate limited - try again later');
  if (response.status !== 200) throw new Error(`API error: ${response.status}`);

  if (response.data && response.data.uuid) {
    const player = response.data;
    const shortUuid = player.uuid.substring(0, 8);
    if (player.tags && Array.isArray(player.tags) && player.tags.length > 0) {
      const tagDetails = player.tags.slice(0, 3).map(tag => {
        const tagType = tag.type || 'Unknown';
        const addedBy = tag.hide_username ? 'Hidden' : (tag.added_by ? `User ${tag.added_by}` : 'Unknown');
        return `${tagType} (by ${addedBy})`;
      });
      const tagCount = player.tags.length;
      const moreText = player.tags.length > 3 ? ` +${player.tags.length - 3} more` : '';
      return `${username} - ${shortUuid}...\n⚠️ ${username} ${tagCount} Tag${tagCount !== 1 ? 's' : ''}: ${tagDetails.join(', ')}${moreText}`;
    }
    return `${username} - ${shortUuid}...\n✓ ${username} Clean (No tags)`;
  }
  return `${username} - Invalid response format`;
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
    if (cached && (Date.now() - cached.timestamp) < this.PLAYER_CACHE_DURATION) return cached.data;
    return null;
  }
  setPlayer(ign, data) {
    this.playerDataCache.set(ign.toLowerCase(), { data, timestamp: Date.now() });
  }
  getGuild(ign) {
    const cached = this.guildCache.get(ign.toLowerCase());
    if (cached && (Date.now() - cached.timestamp) < this.GUILD_CACHE_DURATION) return cached.data;
    return null;
  }
  setGuild(ign, data) {
    this.guildCache.set(ign.toLowerCase(), { data, timestamp: Date.now() });
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
    const result = { uuid: data.player.uuid, fullData: data.player };
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
  if (cachedPlayer && cachedPlayer.fullData) return parseBWStats(cachedPlayer.fullData);

  return queueApiRequest(async () => {
    const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data?.success || !data?.player) throw new Error("Player not found");
    cache.setPlayer(ign, { uuid: data.player.uuid, fullData: data.player });
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

    const leaderboard = guild.members.map(m => ({
      uuid: m.uuid,
      gexp: Object.values(m.expHistory || {}).reduce((sum, exp) => sum + exp, 0)
    })).sort((a, b) => b.gexp - a.gexp);

    const rank = leaderboard.findIndex(m => m.uuid === uuid) + 1;
    const result = { weeklyGexp, rank, totalMembers: guild.members.length };
    cache.setGuild(playerIgn, result);
    return result;
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === API Routes ===
app.get("/", (req, res) => res.send("✅ RumoniumGC Bot v2.3 - Running!"));

app.get("/api/settings", (req, res) => res.json(botSettings));
app.post("/api/settings", (req, res) => {
  botSettings = { ...botSettings, ...req.body };
  res.json({ success: true });
});

app.get("/api/activity-tracking", (req, res) => {
  const tracking = Array.from(activityTracking.entries()).map(([username, data]) => ({
    username, ...data, detection: detectActivityFromSnapshots(data)
  }));
  res.json({ tracking, count: tracking.length });
});

app.post("/api/activity-tracking/remove", (req, res) => {
  const { username } = req.body;
  if (activityTracking.has(username?.toLowerCase())) {
    stopActivityTracking(username);
    res.json({ success: true, message: `Activity tracking removed for ${username}` });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

app.get("/api/gpt-prompt", (req, res) => res.json({ prompt: gptSystemPrompt }));
app.post("/api/gpt-prompt", (req, res) => {
  gptSystemPrompt = req.body.prompt;
  res.json({ success: true });
});

app.get("/api/stats", (req, res) => {
  const uptime = Date.now() - startTime;
  const topCommands = Array.from(commandStats.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count);
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
    reconnectAttempts,
    botReady,
    topCommands,
    topUsers
  });
});

app.get("/api/activity", (req, res) => {
  res.json({ recent: recentActivity.slice(0, 50), total: recentActivity.length });
});

// BUG FIX: Removed duplicate route definitions for /api/blacklist GET and POST
app.get("/api/blacklist", (req, res) => {
  res.json(getBlacklistStats());
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
  if (!username) return res.status(400).json({ success: false, message: 'Username required' });
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
  const entry = localBlacklist.get(username.toLowerCase());
  if (!entry) return res.status(404).json({ success: false, message: 'User not found' });

  entry.reason = reason;
  entry.addedBy = addedBy;
  entry.lastModified = new Date().toISOString();
  localBlacklist.set(username.toLowerCase(), entry);
  saveBlacklist();
  addLog('info', `Blacklist entry updated: ${username}`);
  res.json({ success: true, entry });
});

app.get("/api/permissions", (req, res) => {
  const permissions = Array.from(commandPermissions.entries()).map(([username, perms]) => ({
    username, ...perms
  }));
  res.json({ permissions, availableCommands: AVAILABLE_COMMANDS });
});

app.post("/api/permissions/set", (req, res) => {
  const { username, allowedCommands, bannedCommands } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'Username required' });
  const perms = {};
  if (allowedCommands && Array.isArray(allowedCommands)) perms.allowedCommands = allowedCommands;
  if (bannedCommands && Array.isArray(bannedCommands)) perms.bannedCommands = bannedCommands;
  commandPermissions.set(username.toLowerCase(), perms);
  saveCommandPermissions();
  res.json({ success: true, username, permissions: perms });
});

app.post("/api/permissions/remove", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'Username required' });
  if (commandPermissions.has(username.toLowerCase())) {
    commandPermissions.delete(username.toLowerCase());
    saveCommandPermissions();
    res.json({ success: true, message: `Permissions reset for ${username}` });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

// Export endpoints
app.get("/api/export/all", (req, res) => {
  const exportData = {
    exportDate: new Date().toISOString(),
    botVersion: '2.3',
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
});

app.get("/api/export/permissions", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=permissions-${Date.now()}.json`);
  res.json(Object.fromEntries(commandPermissions));
});

app.get("/api/export/fkdr", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=fkdr-tracking-${Date.now()}.json`);
  res.json(Object.fromEntries(fkdrTracking));
});

app.get("/api/export/blacklist", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=blacklist-${Date.now()}.json`);
  res.json(Object.fromEntries(localBlacklist));
});

// Import endpoints
app.post("/api/import/all", (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ success: false, message: 'No data provided' });
  let imported = 0;
  if (data.permissions) {
    commandPermissions.clear();
    Object.entries(data.permissions).forEach(([u, p]) => commandPermissions.set(u.toLowerCase(), p));
    saveCommandPermissions(); imported++;
  }
  if (data.fkdrTracking) {
    fkdrTracking.clear();
    Object.entries(data.fkdrTracking).forEach(([u, t]) => fkdrTracking.set(u.toLowerCase(), t));
    saveFkdrTracking(); imported++;
  }
  if (data.blacklist) {
    localBlacklist.clear();
    Object.entries(data.blacklist).forEach(([u, e]) => localBlacklist.set(u.toLowerCase(), e));
    saveBlacklist(); imported++;
  }
  if (data.settings) { botSettings = { ...botSettings, ...data.settings }; imported++; }
  if (data.gptPrompt) { gptSystemPrompt = data.gptPrompt; imported++; }
  res.json({ success: true, message: `Imported ${imported} data categories` });
});

app.post("/api/import/permissions", (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ success: false, message: 'No data provided' });
  commandPermissions.clear();
  Object.entries(data).forEach(([u, p]) => commandPermissions.set(u.toLowerCase(), p));
  saveCommandPermissions();
  res.json({ success: true, message: `Imported permissions for ${commandPermissions.size} users` });
});

app.post("/api/import/fkdr", (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ success: false, message: 'No data provided' });
  fkdrTracking.clear();
  Object.entries(data).forEach(([u, t]) => fkdrTracking.set(u.toLowerCase(), t));
  saveFkdrTracking();
  res.json({ success: true, message: `Imported FKDR tracking for ${fkdrTracking.size} users` });
});

app.post("/api/import/blacklist", (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ success: false, message: 'No data provided' });
  localBlacklist.clear();
  Object.entries(data).forEach(([u, e]) => localBlacklist.set(u.toLowerCase(), e));
  saveBlacklist();
  res.json({ success: true, message: `Imported ${localBlacklist.size} blacklist entries` });
});

app.get("/api/fkdr-tracking", (req, res) => {
  const tracking = Array.from(fkdrTracking.entries()).map(([username, data]) => ({
    username, ...data, progress: calculateFkdrProgress(data)
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

// === Bot Control Routes ===
app.post("/api/bot/reconnect", (req, res) => {
  if (bot) {
    try { bot.quit(); } catch (e) {}
    bot = null;
  }
  botReady = false;
  io.emit('bot-status', 'connecting');
  addLog('info', 'Manual reconnect triggered from admin panel');
  setTimeout(() => createBot(), 2000);
  res.json({ success: true, message: 'Reconnect initiated' });
});

app.post("/api/bot/disconnect", (req, res) => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  botSettings.autoReconnect = false;
  if (bot) {
    try { bot.quit(); } catch (e) {}
    bot = null;
  }
  botReady = false;
  io.emit('bot-status', 'offline');
  addLog('info', 'Bot manually disconnected from admin panel');
  res.json({ success: true, message: 'Bot disconnected' });
});

app.post("/api/bot/start", (req, res) => {
  botSettings.autoReconnect = true;
  if (!botReady && !bot) {
    addLog('info', 'Bot manually started from admin panel');
    createBot();
    res.json({ success: true, message: 'Bot starting...' });
  } else {
    res.json({ success: false, message: 'Bot already running' });
  }
});

app.post("/api/cache/clear", (req, res) => {
  cache.clearAll();
  addLog('info', 'Cache cleared from admin panel');
  res.json({ success: true, message: 'Cache cleared' });
});

app.get("/api/welcome-messages", (req, res) => {
  res.json({ messages: welcomeMessages });
});

app.post("/api/welcome-messages", (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ success: false, message: 'messages must be an array' });
  welcomeMessages.length = 0;
  messages.forEach(m => welcomeMessages.push(m));
  addLog('info', `Welcome messages updated (${messages.length} messages)`);
  res.json({ success: true, messages: welcomeMessages });
});

app.get("/api/system-info", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    memoryUsed: Math.round(mem.heapUsed / 1024 / 1024),
    memoryTotal: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024),
    pid: process.pid,
    uptime: process.uptime(),
    logCount: detailedLogs.length,
    urchinEnabled: URCHIN_ENABLED,
    urchinUrl: WORKING_URCHIN_URL || null,
  });
});


// === Web Panel ===
app.get("/control", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rumonium Admin Panel</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --bg2: #10101a;
      --bg3: #16162a;
      --card: #1a1a2e;
      --card2: #1f1f38;
      --border: #2a2a4a;
      --border2: #3a3a5a;
      --accent: #7c3aed;
      --accent2: #6d28d9;
      --accent3: #8b5cf6;
      --blue: #2563eb;
      --green: #059669;
      --red: #dc2626;
      --yellow: #d97706;
      --cyan: #0891b2;
      --text: #e2e8f0;
      --text2: #94a3b8;
      --text3: #64748b;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; overflow-x: hidden; }
    body::before { content:''; position:fixed; top:0; left:0; right:0; height:1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); z-index:100; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg2); }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--accent3); }

    /* Layout */
    .sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 220px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; z-index: 50; }
    .main { margin-left: 220px; padding: 24px; min-height: 100vh; }

    /* Sidebar */
    .sidebar-logo { padding: 20px 16px; border-bottom: 1px solid var(--border); }
    .sidebar-logo h1 { font-size: 16px; font-weight: 800; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 1px; }
    .sidebar-logo .ver { font-size: 11px; color: var(--text3); margin-top: 2px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-top: 8px; }
    .status-badge.online { background: rgba(5,150,105,0.15); color: #34d399; border: 1px solid rgba(5,150,105,0.3); }
    .status-badge.offline { background: rgba(220,38,38,0.15); color: #f87171; border: 1px solid rgba(220,38,38,0.3); }
    .status-badge.connecting { background: rgba(217,119,6,0.15); color: #fbbf24; border: 1px solid rgba(217,119,6,0.3); }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

    .nav-section { padding: 12px 8px 4px; font-size: 10px; font-weight: 700; color: var(--text3); letter-spacing: 1.5px; text-transform: uppercase; }
    .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin: 1px 8px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--text2); transition: all 0.15s; border: 1px solid transparent; }
    .nav-item:hover { background: var(--bg3); color: var(--text); }
    .nav-item.active { background: rgba(124,58,237,0.15); color: var(--accent3); border-color: rgba(124,58,237,0.3); }
    .nav-item .icon { font-size: 15px; width: 20px; text-align: center; }
    .nav-item .badge { margin-left: auto; background: var(--accent); color: white; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }

    .sidebar-footer { margin-top: auto; padding: 12px; border-top: 1px solid var(--border); }
    .sys-stat { font-size: 11px; color: var(--text3); margin-bottom: 4px; display: flex; justify-content: space-between; }
    .sys-stat span:last-child { color: var(--text2); }

    /* Cards */
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .card-sm { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .card-title { font-size: 13px; font-weight: 700; color: var(--text2); letter-spacing: 0.5px; text-transform: uppercase; }

    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px; position: relative; overflow: hidden; transition: border-color 0.2s; }
    .stat-card:hover { border-color: var(--border2); }
    .stat-card::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; }
    .stat-card.purple::before { background: linear-gradient(90deg, var(--accent), var(--accent3)); }
    .stat-card.blue::before { background: linear-gradient(90deg, var(--blue), #60a5fa); }
    .stat-card.green::before { background: linear-gradient(90deg, var(--green), #34d399); }
    .stat-card.red::before { background: linear-gradient(90deg, var(--red), #f87171); }
    .stat-card.yellow::before { background: linear-gradient(90deg, var(--yellow), #fbbf24); }
    .stat-card.cyan::before { background: linear-gradient(90deg, var(--cyan), #22d3ee); }
    .stat-value { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
    .stat-label { font-size: 11px; color: var(--text3); font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
    .stat-sub { font-size: 11px; color: var(--text3); margin-top: 4px; }
    .purple .stat-value { color: var(--accent3); }
    .blue .stat-value { color: #60a5fa; }
    .green .stat-value { color: #34d399; }
    .red .stat-value { color: #f87171; }
    .yellow .stat-value { color: #fbbf24; }
    .cyan .stat-value { color: #22d3ee; }

    /* Tabs */
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; outline: none; }
    .btn-sm { padding: 5px 12px; font-size: 12px; border-radius: 6px; }
    .btn-lg { padding: 10px 20px; font-size: 14px; }
    .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: white; }
    .btn-primary:hover { background: linear-gradient(135deg, var(--accent3), var(--accent)); box-shadow: 0 4px 15px rgba(124,58,237,0.3); }
    .btn-blue { background: rgba(37,99,235,0.2); color: #60a5fa; border: 1px solid rgba(37,99,235,0.3); }
    .btn-blue:hover { background: rgba(37,99,235,0.35); }
    .btn-green { background: rgba(5,150,105,0.2); color: #34d399; border: 1px solid rgba(5,150,105,0.3); }
    .btn-green:hover { background: rgba(5,150,105,0.35); }
    .btn-red { background: rgba(220,38,38,0.2); color: #f87171; border: 1px solid rgba(220,38,38,0.3); }
    .btn-red:hover { background: rgba(220,38,38,0.35); }
    .btn-yellow { background: rgba(217,119,6,0.2); color: #fbbf24; border: 1px solid rgba(217,119,6,0.3); }
    .btn-yellow:hover { background: rgba(217,119,6,0.35); }
    .btn-ghost { background: rgba(255,255,255,0.05); color: var(--text2); border: 1px solid var(--border); }
    .btn-ghost:hover { background: rgba(255,255,255,0.1); color: var(--text); }
    .btn-full { width: 100%; justify-content: center; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Inputs */
    input, textarea, select { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 9px 14px; font-size: 13px; width: 100%; outline: none; transition: border-color 0.15s; font-family: inherit; }
    input:focus, textarea:focus, select:focus { border-color: var(--accent3); box-shadow: 0 0 0 3px rgba(124,58,237,0.1); }
    textarea { resize: vertical; min-height: 80px; }
    select option { background: var(--bg3); }
    label { font-size: 12px; color: var(--text2); font-weight: 600; display: block; margin-bottom: 6px; }

    /* Chat */
    #chat { height: 380px; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; background: var(--bg); border-radius: 8px; }
    .chat-msg { padding: 8px 12px; border-radius: 8px; font-size: 13px; background: var(--bg3); border: 1px solid var(--border); animation: fadeIn 0.2s; }
    .chat-msg .time { color: var(--text3); font-size: 11px; margin-right: 6px; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }

    /* Log entries */
    .log-entry { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-radius: 8px; background: var(--bg3); border-left: 3px solid; font-size: 12px; }
    .log-entry.error { border-color: var(--red); }
    .log-entry.warning { border-color: var(--yellow); }
    .log-entry.info { border-color: var(--blue); }
    .log-entry.success { border-color: var(--green); }
    .log-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
    .log-badge.error { background: rgba(220,38,38,0.2); color: #f87171; }
    .log-badge.warning { background: rgba(217,119,6,0.2); color: #fbbf24; }
    .log-badge.info { background: rgba(37,99,235,0.2); color: #60a5fa; }
    .log-badge.success { background: rgba(5,150,105,0.2); color: #34d399; }

    /* Progress bars */
    .prog-bar { height: 8px; background: var(--bg2); border-radius: 4px; overflow: hidden; }
    .prog-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }

    /* Toggle */
    .toggle-wrap { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border); }
    .toggle-wrap:last-child { border-bottom: none; }
    .toggle-info .toggle-label { font-size: 13px; font-weight: 600; color: var(--text); }
    .toggle-info .toggle-desc { font-size: 11px; color: var(--text3); margin-top: 2px; }
    .toggle { position: relative; width: 42px; height: 24px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider { position: absolute; inset: 0; background: var(--bg2); border: 1px solid var(--border2); border-radius: 24px; cursor: pointer; transition: all 0.2s; }
    .toggle-slider::before { content:''; position:absolute; width:16px; height:16px; left:3px; top:3px; background: var(--text3); border-radius: 50%; transition: all 0.2s; }
    .toggle input:checked + .toggle-slider { background: rgba(124,58,237,0.3); border-color: var(--accent); }
    .toggle input:checked + .toggle-slider::before { transform: translateX(18px); background: var(--accent3); }

    /* Range */
    input[type=range] { padding: 0; height: 6px; cursor: pointer; background: var(--bg2); border: none; border-radius: 3px; }
    input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--accent3); border-radius: 50%; cursor: pointer; border: 2px solid var(--accent); }

    /* Blacklist player card */
    .bl-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 14px; transition: border-color 0.15s; }
    .bl-card:hover { border-color: rgba(220,38,38,0.4); }
    .bl-card .mc-head { width: 44px; height: 44px; border-radius: 6px; border: 2px solid var(--border2); image-rendering: pixelated; }

    /* Modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); z-index: 200; display: none; align-items: center; justify-content: center; }
    .modal-overlay.open { display: flex; }
    .modal { background: var(--card); border: 1px solid var(--border2); border-radius: 14px; padding: 24px; width: 100%; max-width: 520px; margin: 16px; }
    .modal-title { font-size: 17px; font-weight: 800; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }

    /* Toast */
    #toast-container { position: fixed; top: 20px; right: 20px; z-index: 999; display: flex; flex-direction: column; gap: 8px; }
    .toast { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px; font-size: 13px; font-weight: 500; animation: slideIn 0.3s; max-width: 320px; border: 1px solid; }
    .toast.success { background: rgba(5,150,105,0.2); border-color: rgba(5,150,105,0.4); color: #34d399; }
    .toast.error { background: rgba(220,38,38,0.2); border-color: rgba(220,38,38,0.4); color: #f87171; }
    .toast.info { background: rgba(37,99,235,0.2); border-color: rgba(37,99,235,0.4); color: #60a5fa; }
    .toast.warning { background: rgba(217,119,6,0.2); border-color: rgba(217,119,6,0.4); color: #fbbf24; }
    @keyframes slideIn { from{transform:translateX(40px);opacity:0} to{transform:none;opacity:1} }
    @keyframes slideOut { from{transform:none;opacity:1} to{transform:translateX(40px);opacity:0} }

    /* Grid helpers */
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .flex-row { display: flex; gap: 10px; align-items: center; }
    .flex-row.wrap { flex-wrap: wrap; }
    .space-y > * + * { margin-top: 12px; }
    .space-y-sm > * + * { margin-top: 8px; }

    /* Bot control buttons */
    .control-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px; border-radius: 10px; cursor: pointer; border: 1px solid; transition: all 0.15s; background: transparent; color: inherit; }
    .control-btn .ctrl-icon { font-size: 20px; }
    .control-btn .ctrl-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
    .control-btn.green-ctrl { border-color: rgba(5,150,105,0.3); color: #34d399; }
    .control-btn.green-ctrl:hover { background: rgba(5,150,105,0.15); }
    .control-btn.red-ctrl { border-color: rgba(220,38,38,0.3); color: #f87171; }
    .control-btn.red-ctrl:hover { background: rgba(220,38,38,0.15); }
    .control-btn.yellow-ctrl { border-color: rgba(217,119,6,0.3); color: #fbbf24; }
    .control-btn.yellow-ctrl:hover { background: rgba(217,119,6,0.15); }
    .control-btn.blue-ctrl { border-color: rgba(37,99,235,0.3); color: #60a5fa; }
    .control-btn.blue-ctrl:hover { background: rgba(37,99,235,0.15); }

    /* Separator */
    hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

    /* Fkdr badge */
    .fkdr-badge { padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; }
    .fkdr-pos { background: rgba(5,150,105,0.2); color: #34d399; }
    .fkdr-neg { background: rgba(220,38,38,0.2); color: #f87171; }

    /* Code / monospace */
    code { font-family: 'Fira Code', 'Consolas', monospace; background: var(--bg2); padding: 1px 6px; border-radius: 4px; font-size: 12px; color: var(--accent3); }

    /* Scrollable */
    .scroll-list { overflow-y: auto; max-height: 420px; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }

    /* Activity icon */
    .act-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }

    /* Search */
    .search-wrap { position: relative; }
    .search-wrap input { padding-left: 36px; }
    .search-wrap .search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: 14px; color: var(--text3); pointer-events: none; }

    /* Welcome msg items */
    .wm-item { display: flex; gap: 8px; align-items: center; }
    .wm-item input { flex: 1; }

    @media (max-width: 1100px) {
      .stats-grid { grid-template-columns: repeat(2,1fr); }
      .grid3 { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 768px) {
      .sidebar { width: 60px; }
      .sidebar .nav-item span, .sidebar-logo h1, .sidebar-logo .ver, .nav-section, .sidebar-footer .sys-stat span { display: none; }
      .main { margin-left: 60px; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .grid2, .grid3 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<div id="toast-container"></div>

<!-- Sidebar -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <h1>⚡ RUMONIUM</h1>
    <div class="ver">Control Panel v3.0</div>
    <span class="status-badge connecting" id="sidebarStatus">
      <span class="status-dot"></span>
      <span id="sidebarStatusText">CONNECTING</span>
    </span>
  </div>

  <div style="overflow-y:auto; flex:1;">
    <div class="nav-section">Dashboard</div>
    <div class="nav-item active" onclick="showTab('dashboard')" id="nav-dashboard">
      <span class="icon">🏠</span><span>Overview</span>
    </div>
    <div class="nav-item" onclick="showTab('chat')" id="nav-chat">
      <span class="icon">💬</span><span>Live Chat</span>
    </div>

    <div class="nav-section">Management</div>
    <div class="nav-item" onclick="showTab('blacklist')" id="nav-blacklist">
      <span class="icon">🚫</span><span>Blacklist</span>
      <span class="badge" id="navBlacklistCount">0</span>
    </div>
    <div class="nav-item" onclick="showTab('permissions')" id="nav-permissions">
      <span class="icon">🔒</span><span>Permissions</span>
    </div>
    <div class="nav-item" onclick="showTab('fkdr')" id="nav-fkdr">
      <span class="icon">📊</span><span>FKDR Tracking</span>
    </div>

    <div class="nav-section">System</div>
    <div class="nav-item" onclick="showTab('settings')" id="nav-settings">
      <span class="icon">⚙️</span><span>Bot Settings</span>
    </div>
    <div class="nav-item" onclick="showTab('statistics')" id="nav-statistics">
      <span class="icon">📈</span><span>Statistics</span>
    </div>
    <div class="nav-item" onclick="showTab('logs')" id="nav-logs">
      <span class="icon">📋</span><span>Logs</span>
    </div>
    <div class="nav-item" onclick="showTab('data')" id="nav-data">
      <span class="icon">💾</span><span>Data</span>
    </div>
  </div>

  <div class="sidebar-footer">
    <div class="sys-stat"><span>Memory</span><span id="sysMemory">— MB</span></div>
    <div class="sys-stat"><span>PID</span><span id="sysPid">—</span></div>
    <div class="sys-stat"><span>Node</span><span id="sysNode">—</span></div>
  </div>
</aside>

<!-- Main Content -->
<main class="main">

  <!-- DASHBOARD TAB -->
  <div class="tab-content active" id="content-dashboard">
    <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2 style="font-size:22px; font-weight:800;">Dashboard</h2>
        <p style="color:var(--text3); font-size:13px; margin-top:4px;">Real-time overview & bot control</p>
      </div>
      <div style="font-size:12px; color:var(--text3);" id="lastRefresh">—</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card purple">
        <div class="stat-value" id="uptime">0h 0m</div>
        <div class="stat-label">Uptime</div>
        <div class="stat-sub" id="reconnectCount">0 reconnects</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-value" id="commands">0</div>
        <div class="stat-label">Commands</div>
        <div class="stat-sub" id="commandsPerHour">0/hr</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value" id="messages">0</div>
        <div class="stat-label">Messages</div>
        <div class="stat-sub" id="messagesPerHour">0/hr</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-value" id="apiCallsStat">0</div>
        <div class="stat-label">API Calls</div>
        <div class="stat-sub" id="apiQueueStat">Queue: 0</div>
      </div>
    </div>

    <div class="grid2">
      <!-- Bot Control -->
      <div class="card">
        <div class="card-header"><span class="card-title">🤖 Bot Control</span></div>
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button class="control-btn green-ctrl" onclick="botAction('start')">
            <span class="ctrl-icon">▶️</span><span class="ctrl-label">Start</span>
          </button>
          <button class="control-btn red-ctrl" onclick="botAction('disconnect')">
            <span class="ctrl-icon">⏹️</span><span class="ctrl-label">Stop</span>
          </button>
          <button class="control-btn yellow-ctrl" onclick="botAction('reconnect')">
            <span class="ctrl-icon">🔄</span><span class="ctrl-label">Reconnect</span>
          </button>
          <button class="control-btn blue-ctrl" onclick="clearCache()">
            <span class="ctrl-icon">🗑️</span><span class="ctrl-label">Clear Cache</span>
          </button>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div style="background:var(--bg3); border-radius:8px; padding:12px; border:1px solid var(--border);">
            <div style="font-size:11px; color:var(--text3); margin-bottom:4px;">STATUS</div>
            <div id="botStatusLabel" style="font-size:15px; font-weight:700; color:#fbbf24;">CONNECTING</div>
          </div>
          <div style="background:var(--bg3); border-radius:8px; padding:12px; border:1px solid var(--border);">
            <div style="font-size:11px; color:var(--text3); margin-bottom:4px;">CACHE</div>
            <div style="font-size:15px; font-weight:700; color:#22d3ee;" id="cacheSize">0 items</div>
          </div>
        </div>
      </div>

      <!-- Quick Send -->
      <div class="card">
        <div class="card-header"><span class="card-title">📤 Quick Chat</span></div>
        <textarea id="msgInput" placeholder="Send a message to guild chat..." style="height:70px; margin-bottom:10px;"></textarea>
        <button class="btn btn-primary btn-full" onclick="sendMsg()">Send to Guild Chat</button>
      </div>
    </div>

    <div class="grid2" style="margin-top:16px;">
      <!-- Top Commands -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">⚡ Top Commands</span>
          <button class="btn btn-ghost btn-sm" onclick="loadDashboard()">↻ Refresh</button>
        </div>
        <div id="dashCommandChart" class="space-y-sm"></div>
      </div>

      <!-- Recent Activity -->
      <div class="card">
        <div class="card-header"><span class="card-title">🕐 Recent Activity</span></div>
        <div class="scroll-list" style="max-height:250px;" id="dashActivity"></div>
      </div>
    </div>
  </div>

  <!-- CHAT TAB -->
  <div class="tab-content" id="content-chat">
    <div style="margin-bottom:16px;">
      <h2 style="font-size:22px; font-weight:800;">Live Chat</h2>
      <p style="color:var(--text3); font-size:13px; margin-top:4px;">Real-time guild chat monitor</p>
    </div>
    <div class="card" style="padding:0; overflow:hidden;">
      <div id="chat"></div>
      <div style="padding:14px; border-top:1px solid var(--border); display:flex; gap:8px;">
        <input type="text" id="chatMsgInput" placeholder="Type and send to guild chat..." style="flex:1;">
        <button class="btn btn-primary" onclick="sendChatMsg()">Send</button>
      </div>
    </div>
  </div>

  <!-- BLACKLIST TAB -->
  <div class="tab-content" id="content-blacklist">
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2 style="font-size:22px; font-weight:800;">Blacklist</h2>
        <p style="color:var(--text3); font-size:13px; margin-top:4px;"><span id="blacklistCount">0</span> entries</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadBlacklistUI()">↻ Refresh</button>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-header"><span class="card-title">➕ Add Entry</span></div>
        <div class="space-y">
          <div><label>Minecraft Username</label><input type="text" id="blacklistUser" placeholder="Username"></div>
          <div><label>Reason</label><textarea id="blacklistReason" placeholder="Why is this player blacklisted?"></textarea></div>
          <div><label>Added By</label><input type="text" id="blacklistAddedBy" placeholder="Your name"></div>
          <button class="btn btn-red btn-full" onclick="addToBlacklistUI()">🚫 Add to Blacklist</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📋 Blacklisted Players</span>
        </div>
        <div class="search-wrap" style="margin-bottom:12px;">
          <span class="search-icon">🔍</span>
          <input type="text" id="blacklistSearch" placeholder="Search players..." oninput="filterBlacklist(this.value)">
        </div>
        <div class="scroll-list" id="blacklistList"></div>
      </div>
    </div>
  </div>

  <!-- PERMISSIONS TAB -->
  <div class="tab-content" id="content-permissions">
    <div style="margin-bottom:16px;">
      <h2 style="font-size:22px; font-weight:800;">Command Permissions</h2>
      <p style="color:var(--text3); font-size:13px; margin-top:4px;">Control which commands each player can use</p>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-header"><span class="card-title">✏️ Set Permissions</span></div>
        <div class="space-y">
          <div><label>Username</label><input type="text" id="permUser" placeholder="Minecraft username"></div>
          <div>
            <label>Mode</label>
            <select id="permMode">
              <option value="allow">Allow Only (Whitelist)</option>
              <option value="ban">Ban Specific (Blacklist)</option>
            </select>
          </div>
          <div>
            <label>Select Commands</label>
            <div id="commandsList" style="background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:10px; display:grid; grid-template-columns:1fr 1fr; gap:4px; max-height:220px; overflow-y:auto;"></div>
          </div>
          <div class="flex-row">
            <button class="btn btn-green" style="flex:1;" onclick="savePermissions()">💾 Save</button>
            <button class="btn btn-red" style="flex:1;" onclick="resetPermissions()">🗑️ Reset</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">👥 Current Permissions</span></div>
        <div class="scroll-list" id="permissionsList"></div>
      </div>
    </div>
  </div>

  <!-- FKDR TRACKING TAB -->
  <div class="tab-content" id="content-fkdr">
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2 style="font-size:22px; font-weight:800;">FKDR Tracking</h2>
        <p style="color:var(--text3); font-size:13px; margin-top:4px;">Track player Final Kill Death Ratio progress over time</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadFkdrTab()">↻ Refresh</button>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">📊 Tracked Players (<span id="fkdrCount">0</span>)</span></div>
      <div class="scroll-list" id="fkdrList" style="max-height:600px;"></div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div class="tab-content" id="content-settings">
    <div style="margin-bottom:16px;">
      <h2 style="font-size:22px; font-weight:800;">Bot Settings</h2>
      <p style="color:var(--text3); font-size:13px; margin-top:4px;">Change settings live — no restart needed</p>
    </div>
    <div class="grid2">
      <div class="space-y">
        <!-- Behavior toggles -->
        <div class="card">
          <div class="card-header"><span class="card-title">🔧 Behavior</span></div>
          <div class="toggle-wrap">
            <div class="toggle-info"><div class="toggle-label">Auto Reconnect</div><div class="toggle-desc">Automatically reconnect after disconnect</div></div>
            <label class="toggle"><input type="checkbox" id="tog-autoReconnect" onchange="saveBoolSetting('autoReconnect', this.checked)"><span class="toggle-slider"></span></label>
          </div>
          <div class="toggle-wrap">
            <div class="toggle-info"><div class="toggle-label">Welcome Messages</div><div class="toggle-desc">Send welcome message when player joins</div></div>
            <label class="toggle"><input type="checkbox" id="tog-welcomeMessages" onchange="saveBoolSetting('welcomeMessages', this.checked)"><span class="toggle-slider"></span></label>
          </div>
        </div>

        <!-- Numeric settings -->
        <div class="card">
          <div class="card-header"><span class="card-title">🎚️ Tuning</span></div>
          <div class="space-y">
            <div>
              <label>Command Cooldown: <span id="val-cooldown">45</span>s</label>
              <input type="range" id="rng-commandCooldown" min="5" max="120" step="5" oninput="document.getElementById('val-cooldown').textContent=this.value" onchange="saveRangeSetting('commandCooldown', this.value)">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text3); margin-top:3px;"><span>5s</span><span>120s</span></div>
            </div>
            <div>
              <label>GPT Max Tokens: <span id="val-tokens">100</span></label>
              <input type="range" id="rng-maxTokens" min="50" max="300" step="10" oninput="document.getElementById('val-tokens').textContent=this.value" onchange="saveRangeSetting('maxTokens', this.value)">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text3); margin-top:3px;"><span>50</span><span>300</span></div>
            </div>
            <div>
              <label>Message Delay: <span id="val-delay">300</span>ms</label>
              <input type="range" id="rng-messageDelay" min="100" max="2000" step="50" oninput="document.getElementById('val-delay').textContent=this.value" onchange="savePerfSetting('messageDelay', this.value)">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text3); margin-top:3px;"><span>100ms</span><span>2000ms</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y">
        <!-- GPT System Prompt -->
        <div class="card">
          <div class="card-header"><span class="card-title">🤖 GPT System Prompt</span></div>
          <textarea id="gptPromptInput" style="height:180px; font-size:12px; line-height:1.5;" placeholder="Enter AI system prompt..."></textarea>
          <button class="btn btn-primary btn-full" style="margin-top:10px;" onclick="saveGptPrompt()">💾 Save Prompt</button>
        </div>

        <!-- Welcome Messages -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">👋 Welcome Messages</span>
            <button class="btn btn-ghost btn-sm" onclick="addWelcomeMsg()">+ Add</button>
          </div>
          <p style="font-size:11px; color:var(--text3); margin-bottom:10px;">Use <code>{username}</code> as placeholder</p>
          <div id="welcomeMsgList" class="space-y-sm"></div>
          <button class="btn btn-green btn-full" style="margin-top:12px;" onclick="saveWelcomeMessages()">💾 Save Messages</button>
        </div>
      </div>
    </div>
  </div>

  <!-- STATISTICS TAB -->
  <div class="tab-content" id="content-statistics">
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2 style="font-size:22px; font-weight:800;">Statistics</h2>
        <p style="color:var(--text3); font-size:13px; margin-top:4px;">Usage analytics and system performance</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadStatistics()">↻ Refresh</button>
    </div>

    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px;">
      <div class="stat-card blue"><div class="stat-value" id="totalCommands">0</div><div class="stat-label">Total Commands</div><div class="stat-sub" id="stat-cmdhr">0/hr</div></div>
      <div class="stat-card green"><div class="stat-value" id="totalMessages">0</div><div class="stat-label">Total Messages</div><div class="stat-sub" id="stat-msghr">0/hr</div></div>
      <div class="stat-card cyan"><div class="stat-value" id="apiCalls">0</div><div class="stat-label">API Calls</div><div class="stat-sub" id="apiQueue">Queue: 0</div></div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
      <div class="card-sm"><div style="font-size:11px;color:var(--text3);margin-bottom:6px;">CACHE</div><div style="font-size:20px;font-weight:800;color:#22d3ee;" id="statCache">0</div></div>
      <div class="card-sm"><div style="font-size:11px;color:var(--text3);margin-bottom:6px;">FKDR TRACKED</div><div style="font-size:20px;font-weight:800;color:#fbbf24;" id="statFkdr">0</div></div>
      <div class="card-sm"><div style="font-size:11px;color:var(--text3);margin-bottom:6px;">BLACKLISTED</div><div style="font-size:20px;font-weight:800;color:#f87171;" id="statBlacklist">0</div></div>
      <div class="card-sm"><div style="font-size:11px;color:var(--text3);margin-bottom:6px;">RECONNECTS</div><div style="font-size:20px;font-weight:800;color:#fb923c;" id="statReconnects">0</div></div>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="card-header"><span class="card-title">⚡ Top Commands</span></div>
        <div id="commandChart" class="space-y-sm"></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">👥 Top Users</span></div>
        <div id="userChart" class="space-y-sm"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">🕐 Recent Activity</span></div>
      <div class="scroll-list" id="recentActivity" style="max-height:350px;"></div>
    </div>
  </div>

  <!-- LOGS TAB -->
  <div class="tab-content" id="content-logs">
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <h2 style="font-size:22px; font-weight:800;">System Logs</h2>
        <p style="color:var(--text3); font-size:13px; margin-top:4px;">Live log stream from bot</p>
      </div>
      <div class="flex-row">
        <select id="logFilter" onchange="filterLogs()" style="width:140px;">
          <option value="all">All Types</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="clearLogs()">🗑️ Clear</button>
      </div>
    </div>
    <div class="card" style="padding:12px;">
      <div id="logs" style="display:flex; flex-direction:column; gap:6px; max-height:700px; overflow-y:auto;"></div>
    </div>
  </div>

  <!-- DATA TAB -->
  <div class="tab-content" id="content-data">
    <div style="margin-bottom:16px;">
      <h2 style="font-size:22px; font-weight:800;">Data Management</h2>
      <p style="color:var(--text3); font-size:13px; margin-top:4px;">Export and import bot data</p>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-header"><span class="card-title">📥 Export</span></div>
        <div class="space-y">
          <button class="btn btn-blue btn-full btn-lg" onclick="exportData('all')">⬇️ Full Backup (All Data)</button>
          <button class="btn btn-ghost btn-full" onclick="exportData('permissions')">⬇️ Permissions Only</button>
          <button class="btn btn-ghost btn-full" onclick="exportData('fkdr')">⬇️ FKDR Tracking Only</button>
          <button class="btn btn-ghost btn-full" onclick="exportData('blacklist')">⬇️ Blacklist Only</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">📤 Import</span></div>
        <div class="space-y">
          <div style="background:rgba(217,119,6,0.1); border:1px solid rgba(217,119,6,0.3); border-radius:8px; padding:10px; font-size:12px; color:#fbbf24;">⚠️ Importing will overwrite existing data. Make a backup first!</div>
          <div><label>Import Type</label>
            <select id="importType">
              <option value="all">Full Backup</option>
              <option value="permissions">Permissions Only</option>
              <option value="fkdr">FKDR Tracking Only</option>
              <option value="blacklist">Blacklist Only</option>
            </select>
          </div>
          <div><label>Select File</label>
            <input type="file" id="importFile" accept=".json">
          </div>
          <button class="btn btn-green btn-full" onclick="importData()">📤 Import Data</button>
          <div id="importStatus"></div>
        </div>
      </div>
    </div>
  </div>

</main>

<!-- Edit Blacklist Modal -->
<div class="modal-overlay" id="editModal">
  <div class="modal">
    <div class="modal-title">
      <span>Edit Blacklist Entry</span>
      <button class="btn btn-ghost btn-sm" onclick="closeEditModal()">✕</button>
    </div>
    <div style="display:flex; gap:12px; align-items:center; margin-bottom:16px;">
      <img id="editPlayerHead" src="" style="width:52px;height:52px;border-radius:8px;border:2px solid var(--border2);image-rendering:pixelated;" onerror="this.src='https://mc-heads.net/avatar/Steve/64'">
      <div>
        <div style="font-size:18px;font-weight:800;color:#f87171;" id="editPlayerName"></div>
        <div style="font-size:11px;color:var(--text3);font-family:monospace;" id="editPlayerID"></div>
        <div style="font-size:11px;color:var(--text3);" id="editPlayerDate"></div>
      </div>
    </div>
    <div class="space-y">
      <div><label>Reason</label><textarea id="editReason" style="height:80px;"></textarea></div>
      <div><label>Added By</label><input type="text" id="editAddedBy"></div>
      <div class="flex-row">
        <button class="btn btn-green" style="flex:1;" onclick="saveEdit()">💾 Save</button>
        <button class="btn btn-ghost" style="flex:1;" onclick="closeEditModal()">Cancel</button>
      </div>
    </div>
  </div>
</div>

<script>
  const socket = io();
  let availableCommands = [];
  let allBlacklistEntries = [];
  let currentEditingUser = null;
  let allLogs = [];

  // ========== Navigation ==========
  function showTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('[id^="nav-"]').forEach(el => el.classList.remove('active'));
    document.getElementById('content-' + tab).classList.add('active');
    document.getElementById('nav-' + tab).classList.add('active');
    if (tab === 'statistics') loadStatistics();
    if (tab === 'permissions') loadPermissions();
    if (tab === 'blacklist') loadBlacklistUI();
    if (tab === 'settings') loadSettings();
    if (tab === 'fkdr') loadFkdrTab();
    if (tab === 'dashboard') loadDashboard();
  }

  // ========== Toast Notifications ==========
  function toast(msg, type='info') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    const icons = {success:'✅', error:'❌', info:'ℹ️', warning:'⚠️'};
    t.innerHTML = \`<span>\${icons[type]||'ℹ️'}</span><span>\${msg}</span>\`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'slideOut 0.3s forwards';
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  // ========== Socket Events ==========
  socket.on('minecraft-chat', d => {
    const chat = document.getElementById('chat');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = \`<span class="time">[\${d.time}]</span>\${escapeHtml(d.message)}\`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    if (chat.children.length > 200) chat.removeChild(chat.firstChild);
  });

  socket.on('bot-log', d => {
    const entry = { time: d.time, type: d.type, msg: d.msg };
    allLogs.unshift(entry);
    if (allLogs.length > 200) allLogs.pop();
    renderLogs();
    updateNavBlacklistBadge();
  });

  socket.on('stats-update', s => {
    document.getElementById('uptime').textContent = s.uptime;
    document.getElementById('commands').textContent = s.commands;
    document.getElementById('messages').textContent = s.messages;
  });

  socket.on('bot-status', status => {
    const el = document.getElementById('botStatusLabel');
    const sb = document.getElementById('sidebarStatus');
    const sbText = document.getElementById('sidebarStatusText');
    const colors = { online:'#34d399', offline:'#f87171', connecting:'#fbbf24' };
    const labels = { online:'ONLINE', offline:'OFFLINE', connecting:'CONNECTING' };
    el.style.color = colors[status] || '#fbbf24';
    el.textContent = labels[status] || status.toUpperCase();
    sb.className = 'status-badge ' + (status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'connecting');
    sbText.textContent = labels[status] || status.toUpperCase();
  });

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ========== Chat ==========
  async function sendMsg() {
    const input = document.getElementById('msgInput');
    const msg = input.value.trim();
    if (!msg) return;
    const res = await fetch('/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
    const d = await res.json();
    if (d.success) { input.value = ''; toast('Message sent!', 'success'); }
    else toast('Bot not ready: ' + d.message, 'error');
  }

  async function sendChatMsg() {
    const input = document.getElementById('chatMsgInput');
    const msg = input.value.trim();
    if (!msg) return;
    const res = await fetch('/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
    const d = await res.json();
    if (d.success) { input.value = ''; toast('Sent!', 'success'); }
    else toast('Bot not ready', 'error');
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeEditModal();
    if (e.key === 'Enter' && document.activeElement.id === 'msgInput') sendMsg();
    if (e.key === 'Enter' && document.activeElement.id === 'chatMsgInput') sendChatMsg();
  });

  // ========== Bot Control ==========
  async function botAction(action) {
    const labels = { start:'Starting bot...', disconnect:'Disconnecting...', reconnect:'Reconnecting...' };
    toast(labels[action] || action, 'info');
    const res = await fetch('/api/bot/' + action, { method:'POST' });
    const d = await res.json();
    if (d.success) toast(d.message, 'success');
    else toast(d.message, 'error');
  }

  async function clearCache() {
    const res = await fetch('/api/cache/clear', { method:'POST' });
    const d = await res.json();
    toast('Cache cleared', 'success');
    document.getElementById('cacheSize').textContent = '0 items';
  }

  // ========== Dashboard ==========
  async function loadDashboard() {
    document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
    try {
      const [statsRes, activityRes, sysRes] = await Promise.all([
        fetch('/api/stats'), fetch('/api/activity'), fetch('/api/system-info')
      ]);
      const stats = await statsRes.json();
      const activity = await activityRes.json();
      const sys = await sysRes.json();

      document.getElementById('cacheSize').textContent = (stats.cacheSize || 0) + ' items';
      document.getElementById('reconnectCount').textContent = (stats.reconnectAttempts || 0) + ' reconnects';
      document.getElementById('apiCallsStat').textContent = stats.apiCallCount || 0;
      document.getElementById('apiQueueStat').textContent = 'Queue: ' + (stats.queueLength || 0);

      const upHrs = stats.uptimeMs ? stats.uptimeMs / 3600000 : 0;
      document.getElementById('commandsPerHour').textContent = (upHrs > 0 ? Math.round(stats.commandCount / upHrs) : 0) + '/hr';
      document.getElementById('messagesPerHour').textContent = (upHrs > 0 ? Math.round(stats.messageCount / upHrs) : 0) + '/hr';

      renderMiniCommandChart(stats.topCommands || []);
      renderActivityList(activity.recent || [], 'dashActivity', 8);

      document.getElementById('sysMemory').textContent = sys.memoryUsed + ' MB';
      document.getElementById('sysPid').textContent = sys.pid;
      document.getElementById('sysNode').textContent = sys.nodeVersion;
    } catch(err) { console.error(err); }
  }

  function renderMiniCommandChart(topCmds) {
    const el = document.getElementById('dashCommandChart');
    if (!topCmds.length) { el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:12px;">No data yet</div>'; return; }
    const max = Math.max(...topCmds.map(c => c.count));
    el.innerHTML = topCmds.slice(0, 7).map(cmd => \`
      <div style="display:flex;align-items:center;gap:8px;">
        <code style="width:70px;text-align:right;">!\${cmd.command}</code>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:\${max>0?(cmd.count/max)*100:0}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:30px;text-align:right;">\${cmd.count}</span>
      </div>
    \`).join('');
  }

  function renderActivityList(activity, containerId, limit=15) {
    const list = document.getElementById(containerId);
    if (!activity.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:12px;">No activity yet</div>'; return; }
    const typeColors = {command:'rgba(37,99,235,0.2)',blacklist:'rgba(220,38,38,0.2)',fkdr:'rgba(217,119,6,0.2)',permission:'rgba(124,58,237,0.2)',system:'rgba(100,116,139,0.2)'};
    const icons = {command:'⚡',blacklist:'🚫',fkdr:'📊',permission:'🔒',system:'⚙️'};
    list.innerHTML = activity.slice(0, limit).map(act => {
      const time = new Date(act.timestamp).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
      return \`<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
        <div class="act-icon" style="background:\${typeColors[act.type]||'rgba(100,116,139,0.2)'}">\${icons[act.type]||'•'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${escapeHtml(act.description)}</div>
          <div style="font-size:10px;color:var(--text3);">\${time}</div>
        </div>
      </div>\`;
    }).join('');
  }

  // ========== Settings ==========
  async function loadSettings() {
    try {
      const [settingsRes, promptRes, welcomeRes] = await Promise.all([
        fetch('/api/settings'), fetch('/api/gpt-prompt'), fetch('/api/welcome-messages')
      ]);
      const settings = await settingsRes.json();
      const prompt = await promptRes.json();
      const welcome = await welcomeRes.json();

      document.getElementById('tog-autoReconnect').checked = !!settings.autoReconnect;
      document.getElementById('tog-welcomeMessages').checked = !!settings.welcomeMessages;

      const cooldown = settings.commandCooldown || 45;
      document.getElementById('rng-commandCooldown').value = cooldown;
      document.getElementById('val-cooldown').textContent = cooldown;

      const tokens = settings.maxTokens || 100;
      document.getElementById('rng-maxTokens').value = tokens;
      document.getElementById('val-tokens').textContent = tokens;

      const delay = (settings.performance && settings.performance.messageDelay) || 300;
      document.getElementById('rng-messageDelay').value = delay;
      document.getElementById('val-delay').textContent = delay;

      document.getElementById('gptPromptInput').value = prompt.prompt || '';

      renderWelcomeMessages(welcome.messages || []);
    } catch(err) { toast('Failed to load settings', 'error'); }
  }

  function renderWelcomeMessages(msgs) {
    const list = document.getElementById('welcomeMsgList');
    list.innerHTML = msgs.map((msg, i) => \`
      <div class="wm-item" id="wm-\${i}">
        <input type="text" value="\${escapeHtml(msg)}" id="wmInput-\${i}" placeholder="Welcome message...">
        <button class="btn btn-red btn-sm" onclick="removeWelcomeMsg(\${i})">✕</button>
      </div>
    \`).join('') || '<div style="color:var(--text3);font-size:13px;">No welcome messages set</div>';
  }

  function addWelcomeMsg() {
    const list = document.getElementById('welcomeMsgList');
    const idx = list.querySelectorAll('.wm-item').length;
    const div = document.createElement('div');
    div.className = 'wm-item'; div.id = 'wm-' + idx;
    div.innerHTML = \`<input type="text" id="wmInput-\${idx}" placeholder="Welcome message... use {username}"><button class="btn btn-red btn-sm" onclick="this.parentElement.remove()">✕</button>\`;
    list.appendChild(div);
  }

  function removeWelcomeMsg(idx) { document.getElementById('wm-' + idx)?.remove(); }

  async function saveWelcomeMessages() {
    const inputs = document.querySelectorAll('[id^="wmInput-"]');
    const messages = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    const res = await fetch('/api/welcome-messages', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({messages}) });
    const d = await res.json();
    if (d.success) { toast('Welcome messages saved!', 'success'); renderWelcomeMessages(d.messages); }
    else toast('Error saving', 'error');
  }

  async function saveGptPrompt() {
    const prompt = document.getElementById('gptPromptInput').value.trim();
    if (!prompt) { toast('Prompt cannot be empty', 'warning'); return; }
    const res = await fetch('/api/gpt-prompt', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt}) });
    const d = await res.json();
    if (d.success) toast('GPT prompt saved!', 'success');
    else toast('Error saving prompt', 'error');
  }

  async function saveBoolSetting(key, value) {
    const body = { [key]: value };
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast(key + ' ' + (value ? 'enabled' : 'disabled'), 'info');
  }

  async function saveRangeSetting(key, value) {
    const body = { [key]: parseInt(value) };
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast(key + ' set to ' + value, 'info');
  }

  async function savePerfSetting(key, value) {
    const res = await fetch('/api/settings');
    const s = await res.json();
    const perf = s.performance || {};
    perf[key] = parseInt(value);
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ performance: perf }) });
    toast(key + ' set to ' + value + 'ms', 'info');
  }

  // ========== Logs ==========
  function renderLogs() {
    const filter = document.getElementById('logFilter')?.value || 'all';
    const logs = document.getElementById('logs');
    const filtered = filter === 'all' ? allLogs : allLogs.filter(l => l.type === filter);
    if (!filtered.length) { logs.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">No logs</div>'; return; }
    logs.innerHTML = filtered.slice(0, 150).map(d => \`
      <div class="log-entry \${d.type}">
        <span style="color:var(--text3);font-size:10px;white-space:nowrap;">\${d.time}</span>
        <span class="log-badge \${d.type}">\${d.type.toUpperCase()}</span>
        <span style="flex:1;color:var(--text2);">\${escapeHtml(d.msg)}</span>
      </div>
    \`).join('');
  }

  function filterLogs() { renderLogs(); }
  function clearLogs() { allLogs = []; renderLogs(); toast('Logs cleared', 'info'); }

  // socket pushes into allLogs and calls renderLogs - override the socket handler to batch
  socket.off('bot-log');
  socket.on('bot-log', d => {
    allLogs.unshift({ time: d.time, type: d.type, msg: d.msg });
    if (allLogs.length > 300) allLogs.pop();
    if (!document.getElementById('content-logs').classList.contains('active')) return;
    renderLogs();
  });

  // ========== Statistics ==========
  async function loadStatistics() {
    try {
      const [statsRes, blRes, permsRes, fkdrRes, actRes] = await Promise.all([
        fetch('/api/stats'), fetch('/api/blacklist'), fetch('/api/permissions'),
        fetch('/api/fkdr-tracking'), fetch('/api/activity')
      ]);
      const stats = await statsRes.json();
      const bl = await blRes.json();
      const fkdr = await fkdrRes.json();
      const activity = await actRes.json();

      document.getElementById('totalCommands').textContent = stats.commandCount || 0;
      document.getElementById('totalMessages').textContent = stats.messageCount || 0;
      document.getElementById('apiCalls').textContent = stats.apiCallCount || 0;
      document.getElementById('apiQueue').textContent = 'Queue: ' + (stats.queueLength || 0);

      const upHrs = stats.uptimeMs ? stats.uptimeMs / 3600000 : 0;
      document.getElementById('stat-cmdhr').textContent = (upHrs > 0 ? Math.round(stats.commandCount / upHrs) : 0) + '/hr';
      document.getElementById('stat-msghr').textContent = (upHrs > 0 ? Math.round(stats.messageCount / upHrs) : 0) + '/hr';
      document.getElementById('statCache').textContent = stats.cacheSize || 0;
      document.getElementById('statFkdr').textContent = fkdr.count || 0;
      document.getElementById('statBlacklist').textContent = bl.total || 0;
      document.getElementById('statReconnects').textContent = stats.reconnectAttempts || 0;

      renderCommandChart(stats.topCommands || []);
      renderUserChart(stats.topUsers || []);
      renderActivityList(activity.recent || [], 'recentActivity', 20);
    } catch(err) { console.error('Failed to load statistics:', err); }
  }

  function renderCommandChart(topCmds) {
    const chart = document.getElementById('commandChart');
    if (!topCmds.length) { chart.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px;">No command data yet</div>'; return; }
    const max = Math.max(...topCmds.map(c => c.count));
    chart.innerHTML = topCmds.slice(0, 10).map(cmd => \`
      <div style="display:flex;align-items:center;gap:10px;">
        <code style="width:70px;text-align:right;font-size:11px;">!\${cmd.command}</code>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:\${max>0?(cmd.count/max)*100:0}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:28px;text-align:right;">\${cmd.count}</span>
      </div>
    \`).join('');
  }

  function renderUserChart(topUsers) {
    const chart = document.getElementById('userChart');
    if (!topUsers.length) { chart.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px;">No user data yet</div>'; return; }
    const max = Math.max(...topUsers.map(u => u.count));
    chart.innerHTML = topUsers.slice(0, 10).map(user => \`
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--text2);width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${escapeHtml(user.username)}</span>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:\${max>0?(user.count/max)*100:0}%;background:linear-gradient(90deg,#059669,#34d399);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:28px;text-align:right;">\${user.count}</span>
      </div>
    \`).join('');
  }

  // ========== Permissions ==========
  async function loadPermissions() {
    const res = await fetch('/api/permissions');
    const data = await res.json();
    availableCommands = data.availableCommands;
    renderCommandCheckboxes();
    renderPermissionsList(data.permissions);
  }

  function renderCommandCheckboxes() {
    const list = document.getElementById('commandsList');
    list.innerHTML = availableCommands.map(cmd => \`
      <label style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);font-weight:400;">
        <input type="checkbox" value="\${cmd}" class="perm-checkbox" style="width:auto;cursor:pointer;">
        <code>!\${cmd}</code>
      </label>
    \`).join('');
  }

  function renderPermissionsList(permissions) {
    const list = document.getElementById('permissionsList');
    if (!permissions.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">No custom permissions set</div>'; return; }
    list.innerHTML = permissions.map(p => {
      const mode = p.allowedCommands ? '✅ Whitelist' : '🚫 Blacklist';
      const commands = p.allowedCommands || p.bannedCommands || [];
      const modeColor = p.allowedCommands ? '#34d399' : '#f87171';
      return \`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;font-size:14px;">\${escapeHtml(p.username)}</span>
          <button onclick="removePermission('\${escapeHtml(p.username)}')" class="btn btn-red btn-sm">Remove</button>
        </div>
        <div style="font-size:11px;color:\${modeColor};margin-bottom:4px;">\${mode}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">\${commands.map(c => '<code>' + c + '</code>').join('')}</div>
      </div>\`;
    }).join('');
  }

  async function savePermissions() {
    const username = document.getElementById('permUser').value.trim();
    if (!username) { toast('Enter a username', 'warning'); return; }
    const mode = document.getElementById('permMode').value;
    const checked = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value);
    if (!checked.length) { toast('Select at least one command', 'warning'); return; }
    const payload = { username };
    if (mode === 'allow') payload.allowedCommands = checked;
    else payload.bannedCommands = checked;
    const res = await fetch('/api/permissions/set', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const d = await res.json();
    if (d.success) { toast('Permissions saved for ' + username, 'success'); loadPermissions(); document.getElementById('permUser').value = ''; document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false); }
    else toast('Error: ' + d.message, 'error');
  }

  async function resetPermissions() {
    const username = document.getElementById('permUser').value.trim();
    if (!username) { toast('Enter a username', 'warning'); return; }
    if (!confirm('Reset all permissions for ' + username + '?')) return;
    const res = await fetch('/api/permissions/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    loadPermissions();
    document.getElementById('permUser').value = '';
  }

  async function removePermission(username) {
    if (!confirm('Remove permissions for ' + username + '?')) return;
    const res = await fetch('/api/permissions/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    loadPermissions();
  }

  // ========== Blacklist ==========
  async function loadBlacklistUI() {
    try {
      const res = await fetch('/api/blacklist');
      const data = await res.json();
      allBlacklistEntries = data.entries || [];
      updateBlacklistCount(data.total);
      renderBlacklist(allBlacklistEntries);
    } catch(err) { toast('Failed to load blacklist', 'error'); }
  }

  function updateBlacklistCount(n) {
    const el = document.getElementById('blacklistCount');
    if (el) el.textContent = n;
    const badge = document.getElementById('navBlacklistCount');
    if (badge) badge.textContent = n;
  }

  async function updateNavBlacklistBadge() {
    try {
      const res = await fetch('/api/blacklist');
      const d = await res.json();
      updateBlacklistCount(d.total);
    } catch(e) {}
  }

  function getTimeAgo(ts) {
    const d = Date.now() - new Date(ts).getTime();
    const days=Math.floor(d/86400000),hours=Math.floor(d/3600000),mins=Math.floor(d/60000);
    if(days>0)return days+'d ago';if(hours>0)return hours+'h ago';if(mins>0)return mins+'m ago';return 'just now';
  }

  function renderBlacklist(entries) {
    const list = document.getElementById('blacklistList');
    if (!entries.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:30px;">No users in blacklist</div>'; return; }
    list.innerHTML = entries.map(entry => {
      const date = new Date(entry.addedOn).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
      return \`<div class="bl-card">
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <img class="mc-head" src="https://mc-heads.net/avatar/\${entry.username}/64" onerror="this.src='https://mc-heads.net/avatar/Steve/64'" alt="\${entry.username}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
              <span style="font-weight:700;color:#f87171;">\${escapeHtml(entry.username)}</span>
              <div style="display:flex;gap:4px;">
                <button onclick="editBlacklistEntry('\${escapeHtml(entry.username)}')" class="btn btn-blue btn-sm">✏️</button>
                <button onclick="removeFromBlacklistUI('\${escapeHtml(entry.username)}')" class="btn btn-red btn-sm">🗑️</button>
              </div>
            </div>
            <div style="font-size:10px;color:var(--text3);font-family:monospace;">ID: \${entry.id||'N/A'} • \${getTimeAgo(entry.addedOn)} • \${date}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:6px;background:var(--bg2);padding:6px 8px;border-radius:6px;">\${escapeHtml(entry.reason)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:5px;">Added by <code>\${escapeHtml(entry.addedBy)}</code></div>
          </div>
        </div>
      </div>\`;
    }).join('');
  }

  function filterBlacklist(q) {
    const filtered = q ? allBlacklistEntries.filter(e =>
      e.username.toLowerCase().includes(q.toLowerCase()) ||
      e.reason.toLowerCase().includes(q.toLowerCase()) ||
      (e.addedBy||'').toLowerCase().includes(q.toLowerCase())
    ) : allBlacklistEntries;
    renderBlacklist(filtered);
  }

  async function addToBlacklistUI() {
    const username = document.getElementById('blacklistUser').value.trim();
    const reason = document.getElementById('blacklistReason').value.trim();
    const addedBy = document.getElementById('blacklistAddedBy').value.trim();
    if (!username || !reason || !addedBy) { toast('All fields required', 'warning'); return; }
    if (!confirm('Add ' + username + ' to blacklist?\\n\\nReason: ' + reason)) return;
    const res = await fetch('/api/blacklist/add', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,reason,addedBy}) });
    const d = await res.json();
    if (d.success) {
      toast(username + ' added to blacklist', 'success');
      document.getElementById('blacklistUser').value = '';
      document.getElementById('blacklistReason').value = '';
      loadBlacklistUI();
    } else toast('Error: ' + d.message, 'error');
  }

  async function removeFromBlacklistUI(username) {
    if (!confirm('Remove ' + username + ' from blacklist?')) return;
    const res = await fetch('/api/blacklist/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    if (d.success) loadBlacklistUI();
  }

  async function editBlacklistEntry(username) {
    const res = await fetch('/api/blacklist');
    const data = await res.json();
    const entry = data.entries.find(e => e.username.toLowerCase() === username.toLowerCase());
    if (!entry) { toast('Entry not found', 'error'); return; }
    currentEditingUser = username;
    document.getElementById('editPlayerHead').src = 'https://mc-heads.net/avatar/' + entry.username + '/64';
    document.getElementById('editPlayerName').textContent = entry.username;
    document.getElementById('editPlayerID').textContent = 'ID: ' + (entry.id || 'N/A');
    document.getElementById('editPlayerDate').textContent = 'Added: ' + new Date(entry.addedOn).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    document.getElementById('editReason').value = entry.reason;
    document.getElementById('editAddedBy').value = entry.addedBy;
    document.getElementById('editModal').classList.add('open');
  }

  function closeEditModal() {
    document.getElementById('editModal').classList.remove('open');
    currentEditingUser = null;
  }

  async function saveEdit() {
    if (!currentEditingUser) return;
    const reason = document.getElementById('editReason').value.trim();
    const addedBy = document.getElementById('editAddedBy').value.trim();
    if (!reason || !addedBy) { toast('Fields cannot be empty', 'warning'); return; }
    const res = await fetch('/api/blacklist/update', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:currentEditingUser,reason,addedBy}) });
    const d = await res.json();
    if (d.success) { toast('Updated!', 'success'); closeEditModal(); loadBlacklistUI(); }
    else toast('Error: ' + d.message, 'error');
  }

  // ========== FKDR Tracking ==========
  async function loadFkdrTab() {
    try {
      const res = await fetch('/api/fkdr-tracking');
      const data = await res.json();
      document.getElementById('fkdrCount').textContent = data.count || 0;
      const list = document.getElementById('fkdrList');
      if (!data.tracking || !data.tracking.length) {
        list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:30px;">No players tracked yet. Use !fkdr start [player] in guild chat.</div>';
        return;
      }
      list.innerHTML = data.tracking.map(t => {
        const progress = t.progress;
        const latest = progress ? progress.current : null;
        return \`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="https://mc-heads.net/avatar/\${t.username}/48" style="width:36px;height:36px;border-radius:6px;image-rendering:pixelated;" onerror="this.src='https://mc-heads.net/avatar/Steve/48'">
              <div>
                <span style="font-size:15px;font-weight:700;">\${escapeHtml(t.username)}</span>
                <div style="font-size:11px;color:var(--text3);">Tracking since \${new Date(t.startDate).toLocaleDateString()}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              \${latest ? \`<span style="font-size:18px;font-weight:800;color:#a78bfa;">\${latest.fkdr} FKDR</span>\` : ''}
              <button onclick="removeFkdrTracking('\${escapeHtml(t.username)}')" class="btn btn-red btn-sm">Remove</button>
            </div>
          </div>
          \${progress ? \`
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            \${renderFkdrPeriod('Daily', progress.daily)}
            \${renderFkdrPeriod('Weekly', progress.weekly)}
            \${renderFkdrPeriod('Monthly', progress.monthly)}
          </div>\` : '<div style="font-size:12px;color:var(--text3);">Need more snapshots for progress data</div>'}
        </div>\`;
      }).join('');
    } catch(err) { toast('Failed to load FKDR data', 'error'); }
  }

  function renderFkdrPeriod(label, data) {
    if (!data) return \`<div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:10px;color:var(--text3);">\${label.toUpperCase()}</div><div style="font-size:12px;color:var(--text3);margin-top:4px;">No data</div></div>\`;
    const fkdrNum = parseFloat(data.fkdr);
    const isPos = fkdrNum >= 0;
    return \`<div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:10px;color:var(--text3);">\${label.toUpperCase()}</div>
      <span class="fkdr-badge \${isPos?'fkdr-pos':'fkdr-neg'}" style="margin-top:4px;display:inline-block;">\${isPos?'+':''}\${data.fkdr} FKDR</span>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">\${data.finals} finals</div>
    </div>\`;
  }

  async function removeFkdrTracking(username) {
    if (!confirm('Stop tracking FKDR for ' + username + '?')) return;
    const res = await fetch('/api/fkdr-tracking/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    if (d.success) loadFkdrTab();
  }

  // ========== Data Management ==========
  async function exportData(type) { window.location.href = '/api/export/' + type; }

  async function importData() {
    const type = document.getElementById('importType').value;
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];
    if (!file) { toast('Please select a file', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const res = await fetch('/api/import/' + type, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data: type === 'all' ? data.data : data})
        });
        const result = await res.json();
        const status = document.getElementById('importStatus');
        if (result.success) {
          toast(result.message, 'success');
          status.innerHTML = \`<div style="background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.3);border-radius:8px;padding:10px;color:#34d399;font-size:12px;">✅ \${result.message}</div>\`;
          setTimeout(() => status.innerHTML = '', 5000);
        } else {
          toast(result.message, 'error');
          status.innerHTML = \`<div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:10px;color:#f87171;font-size:12px;">❌ \${result.message}</div>\`;
        }
      } catch(err) { toast('Invalid file: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
  }

  // ========== Auto-refresh ==========
  setInterval(() => {
    const active = document.querySelector('.tab-content.active');
    if (!active) return;
    const id = active.id.replace('content-', '');
    if (id === 'statistics') loadStatistics();
    if (id === 'dashboard') loadDashboard();
  }, 15000);

  // ========== Init ==========
  loadDashboard();
  updateNavBlacklistBadge();

  // System info interval
  setInterval(async () => {
    try {
      const res = await fetch('/api/system-info');
      const sys = await res.json();
      document.getElementById('sysMemory').textContent = sys.memoryUsed + ' MB';
    } catch(e) {}
  }, 30000);
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
  loadCommandPermissions();
  loadFkdrTracking();
  loadActivityTracking();
  loadBlacklist();
  loadBwStatsTracking();
  if (URCHIN_ENABLED) await testUrchinConnection();
});

// === Bot Implementation ===
const askCooldowns = {};
const welcomeMessages = [
  "Hello! Welcome back {username}!",
  "Welcome, {username}! The legend returns!",
  "{username} joined, hey there!"
];

// BUG FIX: scheduleReconnect is now the single, central reconnection function.
// Old code had multiple scattered setTimeout(createBot, ...) calls that could
// stack up and create duplicate bot instances. Now all reconnection goes through here.
function scheduleReconnect(reason = '') {
  // Clear any existing reconnect timer to prevent stacking
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!botSettings.autoReconnect) {
    addLog('warning', 'Auto-reconnect is disabled. Not reconnecting.');
    return;
  }

  if (isReconnecting) {
    addLog('warning', 'Reconnect already scheduled, skipping duplicate.');
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  const delay = getReconnectDelay();
  const delaySeconds = Math.round(delay / 1000);

  console.log(`⏳ Reconnecting in ${delaySeconds}s (attempt ${reconnectAttempts})${reason ? ` - ${reason}` : ''}`);
  addLog('warning', `Reconnecting in ${delaySeconds}s (attempt ${reconnectAttempts})${reason ? ` - Reason: ${reason}` : ''}`);
  io.emit('bot-status', 'connecting');

  reconnectTimer = setTimeout(() => {
    isReconnecting = false;
    reconnectTimer = null;
    createBot();
  }, delay);
}

function createBot() {
  // BUG FIX: Destroy existing bot cleanly before creating a new one
  if (bot) {
    try {
      bot.removeAllListeners();
      bot.quit();
    } catch (e) {
      // Ignore errors during cleanup
    }
    bot = null;
  }

  botReady = false;
  addLog('info', `Creating bot instance (attempt ${reconnectAttempts + 1})`);

  try {
    bot = mineflayer.createBot({
      host: HYPIXEL_HOST,
      version: MC_VERSION,
      auth: "microsoft",
      checkTimeoutInterval: 30000,
      hideErrors: false
    });
  } catch (err) {
    addLog('error', `Failed to create bot: ${err.message}`);
    scheduleReconnect('create failed');
    return;
  }

  // BUG FIX: Use once() for spawn to avoid duplicate guild chat joins on reconnect
  bot.once("spawn", () => {
    console.log("✅ Connected to Hypixel");
    addLog('success', 'Bot spawned on Hypixel');
    // Reset reconnect counter on successful connection
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
    }, 3000); // BUG FIX: Increased from 1500ms to 3000ms — Hypixel needs more time before accepting commands
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
        return;
      }
      commandCount++; incrementCommandStat('gexp'); incrementUserStat(requester);
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
        return;
      }
      commandCount++; incrementCommandStat('ask'); incrementUserStat(username);
      addActivity('command', `${username} asked: ${userMessage.substring(0, 50)}`, username);

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
        await safeChat(`${requester}, you don't have permission to use !bw`); return;
      }
      commandCount++; incrementCommandStat('bw'); incrementUserStat(requester);
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
        await safeChat(`${requester}, you don't have permission to use !stats`); return;
      }
      commandCount++; incrementCommandStat('stats'); incrementUserStat(requester);
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
        await safeChat(`${requester}, you don't have permission to use !when`); return;
      }
      commandCount++; incrementCommandStat('when'); incrementUserStat(requester);
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
        await safeChat(`${requester}, you don't have permission to use !about`); return;
      }
      commandCount++; incrementCommandStat('about'); incrementUserStat(requester);
      await safeChat("RumoniumGC by Relaquent, v2.3 - Stellar Lumen Edition");
      return;
    }

    // === !help ===
    if (msg.toLowerCase().includes("!help")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      if (!hasCommandPermission(requester, 'help')) {
        await safeChat(`${requester}, you don't have permission to use !help`); return;
      }
      commandCount++; incrementCommandStat('help'); incrementUserStat(requester);
      const help = [
        "--- Rumonium ---",
        "bw <player> - Bedwars stats",
        "gexp <player> - Weekly GEXP",
        "stats <player> - Detailed stats",
        "when - Next Castle",
        "ask <message> - Ask AI",
        "ping <player> - Check player ping",
        "weekly/monthly/yearly <player> - Period stats",
        TAG_ADMINS.length ? "tag <player> <type> <reason> - Tag player (admin)" : null,
        URCHIN_ENABLED ? "view <player> - Status check" : null,
        "fkdr start - Start tracking",
        "fkdr - View progress",
        "fkdr stop - Stop tracking",
        "nfkdr <player> - Calculate next FKDR",
        "about - Bot info",
        "----------------"
      ].filter(Boolean);
      for (const h of help) { await safeChat(h); await sleep(500); }
      return;
    }

    // === !view ===
    if (msg.toLowerCase().includes("!view")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!view\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      if (!URCHIN_ENABLED) { await safeChat(`${requester}, Urchin API is disabled`); return; }
      if (!hasCommandPermission(requester, 'view')) {
        await safeChat(`${requester}, you don't have permission to use !view`); return;
      }
      commandCount++; incrementCommandStat('view'); incrementUserStat(requester);
      addActivity('command', `${requester} checked Urchin for ${ign}`, requester);
      try {
        await safeChat(`Checking ${ign}...`);
        const result = await checkUrchinBlacklist(ign);
        for (const line of result.split('\n')) {
          if (line.trim()) await safeChat(line.trim());
        }
      } catch (err) {
        await safeChat(`Urchin error: ${err.message}`);
      }
      return;
    }

    // === !fkdr ===
    if (msg.toLowerCase().includes("!fkdr")) {
      const matchStart = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr\s+start/i);
      const matchStop = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr\s+stop/i);
      // BUG FIX: The original regex had a broken end anchor "$" with the "i" flag placement
      // which could fail to match on some inputs. Fixed with a cleaner pattern.
      const matchStatus = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})[^!]*!fkdr\s*$/i);

      if (!matchStart && !matchStop && !matchStatus) return;
      const requester = (matchStart || matchStop || matchStatus)[1];
      if (!hasCommandPermission(requester, 'fkdr')) {
        await safeChat(`${requester}, you don't have permission to use !fkdr`); return;
      }
      commandCount++; incrementCommandStat('fkdr'); incrementUserStat(requester);

      if (matchStart) {
        try {
          if (fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, your FKDR is already being tracked!`); return;
          }
          await startFkdrTracking(requester);
          await safeChat(`✓ FKDR tracking started for ${requester}! Use !fkdr to view progress`);
          addLog('success', `FKDR tracking started for ${requester}`);
        } catch (err) {
          await safeChat(`Tracking start error: ${err.message}`);
        }
        return;
      }

      if (matchStop) {
        if (!fkdrTracking.has(requester.toLowerCase())) {
          await safeChat(`${requester}, you don't have active FKDR tracking!`); return;
        }
        stopFkdrTracking(requester);
        await safeChat(`✓ FKDR tracking stopped for ${requester}`);
        return;
      }

      if (matchStatus) {
        try {
          if (!fkdrTracking.has(requester.toLowerCase())) {
            await safeChat(`${requester}, use !fkdr start to begin`); return;
          }
          const tracking = await updateFkdrSnapshot(requester);
          if (!tracking) { await safeChat(`Error updating FKDR data`); return; }
          const progress = calculateFkdrProgress(tracking);
          if (!progress) { await safeChat(`${requester}, not enough data yet. Try later!`); return; }
          await safeChat(`${requester} | Current FKDR: ${progress.current.fkdr}`);
          if (progress.daily) {
            const s = progress.daily.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Daily: ${s}${progress.daily.fkdr} FKDR | Session: ${progress.daily.sessionFkdr} | Finals: ${progress.daily.finals}`);
          }
          if (progress.weekly) {
            const s = progress.weekly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Weekly: ${s}${progress.weekly.fkdr} FKDR | Session: ${progress.weekly.sessionFkdr} | Finals: ${progress.weekly.finals}`);
          }
          if (progress.monthly) {
            const s = progress.monthly.fkdr >= 0 ? '+' : '';
            await safeChat(`📊 Monthly: ${s}${progress.monthly.fkdr} FKDR | Session: ${progress.monthly.sessionFkdr} | Finals: ${progress.monthly.finals}`);
          }
        } catch (err) {
          await safeChat(`Error: ${err.message}`);
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
        await safeChat(`${requester}, you don't have permission to use !blacklist`); return;
      }
      commandCount++;

      if (matchAdd) {
        const [, , targetUser, reason] = matchAdd;
        try {
          const entry = addToBlacklist(targetUser, reason, requester);
          await safeChat(`✓ ${targetUser} added to blacklist`);
          await sleep(500);
          await safeChat(`ID: #${entry.id} | Reason: ${reason.substring(0, 60)}`);
          addLog('info', `${requester} added ${targetUser} to blacklist`);
          addActivity('blacklist', `${requester} added ${targetUser} to blacklist`, requester);
          incrementCommandStat('blacklist'); incrementUserStat(requester);
        } catch (err) {
          await safeChat(`Error adding to blacklist: ${err.message}`);
        }
        return;
      }

      if (matchRemove) {
        const [, , targetUser] = matchRemove;
        const removed = removeFromBlacklist(targetUser);
        if (removed) {
          await safeChat(`✓ ${targetUser} removed from blacklist`);
          addLog('info', `${requester} removed ${targetUser} from blacklist`);
        } else {
          await safeChat(`${targetUser} not found in blacklist`);
        }
        return;
      }

      if (matchCheck) {
        const [, , targetUser] = matchCheck;
        commandCount++; incrementCommandStat('blacklist'); incrementUserStat(requester);
        addActivity('command', `${requester} checked blacklist for ${targetUser}`, requester);
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
        } else {
          await safeChat(`✓ ${targetUser} not in blacklist`);
        }
        return;
      }
    }

    // === !ping ===
    if (msg.toLowerCase().includes("!ping")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!ping\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      if (!hasCommandPermission(requester, 'ping')) {
        await safeChat(`${requester}, you don't have permission to use !ping`); return;
      }
      commandCount++; incrementCommandStat('ping'); incrementUserStat(requester);
      addActivity('command', `${requester} checked ping for ${ign}`, requester);
      try {
        await safeChat(`Checking ${ign}'s ping...`);
        const pingData = await getPlayerPing(ign);
        await safeChat(`${ign} | Ping: ${pingData.ping}ms | Min: ${pingData.min}ms | Max: ${pingData.max}ms`);
        await sleep(500);
        await safeChat(`Last measured: ${pingData.timestamp}`);
      } catch (err) {
        await safeChat(`Error checking ping: ${err.message}`);
      }
      return;
    }

    // === !online ===
    if (msg.toLowerCase().includes("!online")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!online\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      if (!hasCommandPermission(requester, 'online')) {
        await safeChat(`${requester}, you don't have permission to use !online`);
        return;
      }
      commandCount++; incrementCommandStat('online'); incrementUserStat(requester);
      addActivity('command', `${requester} checked online status for ${ign}`, requester);
      try {
        await safeChat(`Checking ${ign}'s status...`);
        const status = await getPlayerOnlineStatus(ign);
        if (status.online) {
          await safeChat(`${ign} | 🟢 ONLINE | Last login: ${status.lastLogin}`);
        } else {
          if (status.lastLogout === 'Unknown') {
            await safeChat(`${ign} | ❓ Status hidden (privacy mode)`);
          } else {
            await safeChat(`${ign} | 🔴 OFFLINE | Last seen: ${status.lastLogout}`);
          }
        }
      } catch (err) {
        await safeChat(`Error checking status: ${err.message}`);
      }
      return;
    }

    // === !nfkdr ===
    if (msg.toLowerCase().includes("!nfkdr")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!nfkdr(?:\s+([A-Za-z0-9_]{1,16}))?/i);
      if (!match) return;
      const [, requester, targetIgn] = match;
      const ign = targetIgn || requester;
      if (!hasCommandPermission(requester, 'nfkdr')) {
        await safeChat(`${requester}, you don't have permission to use !nfkdr`); return;
      }
      commandCount++; incrementCommandStat('nfkdr'); incrementUserStat(requester);
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
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
      }
      return;
    }

    // === !weekly / !monthly / !yearly ===
    const periodMatch = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!(weekly|monthly|yearly)\s+([A-Za-z0-9_]{1,16})/i);
    if (periodMatch) {
      const [, requester, periodWord, ign] = periodMatch;
      const periodDays = { weekly: 7, monthly: 30, yearly: 365 }[periodWord.toLowerCase()];
      if (!hasCommandPermission(requester, periodWord.toLowerCase())) {
        await safeChat(`${requester}, you don't have permission to use !${periodWord}`); return;
      }
      commandCount++; incrementCommandStat(periodWord.toLowerCase()); incrementUserStat(requester);
      addActivity('command', `${requester} checked ${periodWord} stats for ${ign}`, requester);
      try {
        let tracking = bwStatsTracking.get(ign.toLowerCase());
        if (!tracking) {
          await startBwStatsTracking(ign);
          await safeChat(`${ign} için izleme başlatıldı, daha sonra tekrar dene`);
          return;
        }
        tracking = await updateBwStatsSnapshot(ign);
        const diff = calcBwPeriodStats(tracking, periodDays);
        if (!diff) { await safeChat(`${ign}, henüz yeterli veri yok`); return; }
        await safeChat(`${ign} | ${periodWord} Finals: ${diff.finals} | Deaths: ${diff.fdeaths} | FKDR: ${diff.fkdr}`);
        await sleep(500);
        await safeChat(`Wins: ${diff.wins} | Losses: ${diff.losses} | Beds: ${diff.beds}${diff.partial ? ` | (sadece ${diff.trackedDays} günlük veri)` : ''}`);
      } catch (err) { await safeChat(`Error: ${err.message}`); }
      return;
    }

    // === !tag ===
    if (msg.toLowerCase().includes("!tag")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!tag\s+([A-Za-z0-9_]{1,16})\s+([a-z_]+)\s+(.+)/i);
      if (!match) return;
      const [, requester, targetIgn, tagType, reason] = match;
      if (!TAG_ADMINS.includes(requester.toLowerCase())) {
        await safeChat(`${requester}, !tag komutunu kullanma yetkin yok`); return;
      }
      commandCount++; incrementCommandStat('tag'); incrementUserStat(requester);
      try {
        const playerData = await getPlayerUUID(targetIgn);
        const normalizedType = tagType.toLowerCase();
        await addUrchinTag(playerData.uuid, normalizedType, reason);
        await safeChat(`✓ ${targetIgn} etiketlendi: ${normalizedType}`);
        addLog('success', `${requester} tagged ${targetIgn} as ${normalizedType}: ${reason}`);
        addActivity('blacklist', `${requester} tagged ${targetIgn} (${normalizedType})`, requester);
      } catch (err) { await safeChat(`Tag error: ${err.message}`); }
      return;
    }

      // === !activity ===
    if (msg.toLowerCase().includes("!activity")) {
      const matchStart = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!activity\s+start\s+([A-Za-z0-9_]{1,16})/i);
      const matchStop  = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!activity\s+stop\s+([A-Za-z0-9_]{1,16})/i);
      const matchCheck = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!activity\s+([A-Za-z0-9_]{1,16})$/i);

      if (!matchStart && !matchStop && !matchCheck) return;
      const requester = (matchStart || matchStop || matchCheck)[1];

      if (matchStart) {
        const targetIgn = matchStart[2];
        try {
          if (activityTracking.has(targetIgn.toLowerCase())) {
            await safeChat(`${targetIgn} is already being tracked!`);
            return;
          }
          await safeChat(`Starting activity tracking for ${targetIgn}...`);
          await startActivityTracking(targetIgn);
          await safeChat(`✓ Now tracking ${targetIgn} | Snapshots every 6h | Use !activity ${targetIgn} to check`);
          addLog('success', `Activity tracking started for ${targetIgn} by ${requester}`);
        } catch (err) {
          await safeChat(`Error: ${err.message}`);
        }
        return;
      }

      if (matchStop) {
        const targetIgn = matchStop[2];
        const stopped = stopActivityTracking(targetIgn);
        await safeChat(stopped
          ? `✓ Activity tracking stopped for ${targetIgn}`
          : `${targetIgn} is not being tracked`
        );
        return;
      }

      if (matchCheck) {
        const targetIgn = matchCheck[2];
        try {
          if (!activityTracking.has(targetIgn.toLowerCase())) {
            await safeChat(`${targetIgn} is not tracked. Use !activity start ${targetIgn} first`);
            return;
          }
          await safeChat(`Updating snapshot for ${targetIgn}...`);
          const tracking = await updateActivitySnapshot(targetIgn);
          const detection = detectActivityFromSnapshots(tracking);

          if (!detection) {
            await safeChat(`${targetIgn} | Not enough data yet, check back later`);
            return;
          }

          if (!detection.active) {
            await safeChat(`${targetIgn} | No game activity detected since tracking started`);
            return;
          }

          const gameNames = {
            bedwars: 'BedWars', skywars: 'SkyWars', duels: 'Duels',
            uhc: 'UHC', murdermystery: 'Murder Mystery', buildbattle: 'Build Battle',
            arcade: 'Arcade', walls: 'Walls', speeduhc: 'Speed UHC',
            smash: 'Smash Heroes', tnt: 'TNT Games', blitz: 'Blitz SG', pit: 'The Pit'
          };
          const gameName = gameNames[detection.game] || detection.game;

          await safeChat(`${targetIgn} | 🟡 Last seen: ${detection.windowStartAgo} - ${detection.windowEndAgo}`);
          await sleep(500);
          await safeChat(`Game: ${gameName} | Total activity score change: +${detection.totalChange}`);
        } catch (err) {
          await safeChat(`Error: ${err.message}`);
        }
        return;
      }
    }  
  });

  // BUG FIX: kicked and end events now both call scheduleReconnect()
  // instead of direct setTimeout(createBot) to prevent duplicate instances
  bot.on("kicked", (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log("❌ Kicked:", reasonStr);
    botReady = false;
    bot = null;
    io.emit('bot-status', 'offline');
    addLog('error', `Kicked: ${reasonStr.substring(0, 100)}`);
    scheduleReconnect(`kicked: ${reasonStr.substring(0, 50)}`);
  });

  bot.on("end", (reason) => {
    console.log("🔌 Disconnected:", reason || 'unknown');
    botReady = false;
    bot = null;
    io.emit('bot-status', 'offline');
    addLog('warning', `Disconnected: ${reason || 'unknown'}`);
    scheduleReconnect(reason || 'disconnected');
  });

  bot.on("error", (err) => {
    console.error("❌ Bot error:", err.message);
    // Don't set botReady=false here - "end" event will fire after an error
    // and handle the reconnection. Setting it here can cause double-reconnects.
    addLog('error', `Bot error: ${err.message}`);
  });
}

// === Graceful Shutdown ===
function gracefulShutdown(signal) {
  console.log(`📴 ${signal} received, saving data...`);
  saveCommandPermissions();
  saveFkdrTracking();
  saveBlacklist();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (bot) { try { bot.quit(); } catch (e) {} }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// BUG FIX: Catch unhandled promise rejections to prevent process crashes
// that would kill the bot permanently instead of triggering a reconnect
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  addLog('error', `Uncaught exception: ${err.message}`);
  // Don't exit - let the bot continue running
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('❌ Unhandled Rejection:', msg);
  addLog('error', `Unhandled rejection: ${msg}`);
  // Don't exit - let the bot continue running
});

// Auto-save every 5 minutes
setInterval(() => {
  saveCommandPermissions();
  saveFkdrTracking();
  saveBlacklist();
}, 5 * 60 * 1000);

// Update FKDR snapshots every 6 hours
setInterval(async () => {
  if (fkdrTracking.size === 0) return;
  console.log('📊 Updating FKDR snapshots...');
  let updated = 0;
  for (const [username] of fkdrTracking.entries()) {
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

// Update Activity snapshots every 6 hours
setInterval(async () => {
  if (activityTracking.size === 0) return;
  console.log('👁️ Updating Activity snapshots...');
  let updated = 0;
  for (const [username] of activityTracking.entries()) {
    try {
      await updateActivitySnapshot(username);
      updated++;
      await sleep(3000);
    } catch (err) {
      console.error(`Failed to update activity for ${username}:`, err.message);
    }
  }
  console.log(`✅ Updated ${updated} activity snapshots`);
  addLog('info', `Updated ${updated} activity snapshots`);
}, 6 * 60 * 60 * 1000);

createBot();
