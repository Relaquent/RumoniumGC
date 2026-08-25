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
const URCHIN_API_BASE = "https://api.urchin.gg";
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
      const raw = fs.readFileSync(BLACKLIST_FILE, 'utf8').trim();
      const data = raw ? JSON.parse(raw) : {};
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
  'fkdr', 'nfkdr', 'view', 'cweekly', 'cmonthly', 'cyearly', 'tag', 'cdaily', 'blacklist', 'ping', 'online'
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
    const response = await axios.get(`${URCHIN_API_BASE}/health`, {
      timeout: 10000,
      headers: {
        'X-API-Key': URCHIN_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'RumoniumGC-Bot/2.3'
      },
      validateStatus: status => status < 500
    });

    if (response.status === 200) {
      WORKING_URCHIN_URL = URCHIN_API_BASE;
      addLog('success', 'Urchin API connected');
      return true;
    }
    if (response.status === 401) {
      addLog('error', 'Invalid Urchin API key');
      return false;
    }
    if (response.status === 403) {
      addLog('error', 'Urchin API key is locked or lacks permission');
      return false;
    }
    addLog('error', `Urchin health check failed: ${response.status}`);
    return false;
  } catch (err) {
    addLog('error', `Urchin connection failed: ${err.message}`);
    return false;
  }
}

async function getUrchinSessionStats(period, ign) {
  if (!URCHIN_ENABLED) throw new Error('Urchin API not configured');
  const url = `https://api.urchin.gg/v3/player/sessions/${period}?player=${encodeURIComponent(ign)}`;
  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'X-API-Key': URCHIN_API_KEY, 'Accept': 'application/json' },
    validateStatus: s => s < 500
  });
  if (response.status === 404) throw new Error('No session data for this player');
  if (response.status !== 200) throw new Error(`Urchin session error: ${response.status}`);
  return response.data; // { delta, displayname, from, from_readable, uuid }
}

function numDelta(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') return (v.new || 0) - (v.old || 0);
  return 0;
}

function extractBwSession(delta) {
  const bw = delta?.stats?.Bedwars;
  if (!bw) return { finals: 0, deaths: 0, wins: 0, losses: 0, beds: 0 };
  return {
    finals: numDelta(bw.final_kills_bedwars),
    deaths: numDelta(bw.final_deaths_bedwars),
    wins: numDelta(bw.wins_bedwars),
    losses: numDelta(bw.losses_bedwars),
    beds: numDelta(bw.beds_broken_bedwars),
  };
}

async function checkUrchinBlacklist(username) {
  if (!URCHIN_ENABLED) throw new Error('Urchin API not configured');

  if (!WORKING_URCHIN_URL) {
    const connected = await testUrchinConnection();
    if (!connected) throw new Error('Urchin API unavailable');
  }

  const url = `${WORKING_URCHIN_URL}/v3/player/tags`;
  const response = await axios.get(url, {
    timeout: 10000,
    params: { player: username },
    headers: {
      'X-API-Key': URCHIN_API_KEY,
      'Accept': 'application/json',
      'User-Agent': 'RumoniumGC-Bot/2.3'
    },
    validateStatus: status => status < 500
  });

  // IMPORTANT: Never treat a 404 as CLEAN. The Coral API documents 404 as
  // "no resource matches the request"; a clean player should be represented
  // by a successful response with an empty tags array.
  if (response.status === 400) throw new Error('Invalid player lookup request');
  if (response.status === 401) { WORKING_URCHIN_URL = null; throw new Error('Invalid API key'); }
  if (response.status === 403) { WORKING_URCHIN_URL = null; throw new Error('API key locked or insufficient permission'); }
  if (response.status === 404) return `${username} - Player not found in Urchin`;
  if (response.status === 429) throw new Error('Rate limited - try again later');
  if (response.status === 502 || response.status === 503) throw new Error(`Urchin service unavailable (${response.status})`);
  if (response.status !== 200) throw new Error(`API error: ${response.status}`);

  const data = response.data || {};
  const tags = Array.isArray(data) ? data : (Array.isArray(data.tags) ? data.tags : []);

  if (tags.length === 0) {
    return `${username} - CLEAN\n✓ No Urchin tags found`;
  }

  const tagDetails = tags.slice(0, 5).map(tag => {
    const type = tag.tag_type || tag.type || tag.name || 'Unknown';
    const reason = tag.reason ? `: ${tag.reason}` : '';
    const addedBy = tag.hide_username ? 'Hidden' : (tag.added_by ? ` by ${tag.added_by}` : '');
    return `${type}${reason}${addedBy}`;
  });

  const moreText = tags.length > 5 ? ` +${tags.length - 5} more` : '';
  return `${username} - TAGGED\n⚠ ${tags.length} Urchin tag${tags.length !== 1 ? 's' : ''}: ${tagDetails.join(' | ')}${moreText}`;
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
const WEB_DIR = path.join(__dirname, "web");

app.use("/control", express.static(WEB_DIR));

app.get("/control", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "index.html"));
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

    // === !cdaily / !cweekly / !cmonthly / !cyearly (Urchin session stats) ===
const cPeriodMatch = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!c(daily|weekly|monthly|yearly)\s+([A-Za-z0-9_]{1,16})/i);
if (cPeriodMatch) {
  const [, requester, period, ign] = cPeriodMatch;
  const cmdName = 'c' + period.toLowerCase();
  if (!URCHIN_ENABLED) { await safeChat(`${requester}, Urchin API is disabled`); return; }
  if (!hasCommandPermission(requester, cmdName)) {
    await safeChat(`${requester}, you don't have permission to use !${cmdName}`); return;
  }
  commandCount++; incrementCommandStat(cmdName); incrementUserStat(requester);
  addActivity('command', `${requester} checked ${cmdName} for ${ign}`, requester);
  try {
    const session = await getUrchinSessionStats(period.toLowerCase(), ign);
    const bw = extractBwSession(session.delta);
    const fkdr = bw.deaths > 0 ? (bw.finals / bw.deaths).toFixed(2) : (bw.finals > 0 ? 'inf' : '0.00');
    await safeChat(`${ign} | ${period} Finals: ${bw.finals>=0?'+':''}${bw.finals} | Deaths: ${bw.deaths>=0?'+':''}${bw.deaths} | FKDR: ${fkdr}`);
    await sleep(500);
    await safeChat(`Wins: ${bw.wins>=0?'+':''}${bw.wins} | Losses: ${bw.losses>=0?'+':''}${bw.losses} | Beds: ${bw.beds>=0?'+':''}${bw.beds} | Since: ${session.from_readable || 'N/A'}`);
  } catch (err) {
    await safeChat(`Error - ${ign} | ${err.message}`);
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
