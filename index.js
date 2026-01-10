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
let gptSystemPrompt = `You are a Turkish nationalist uncle who answers in the user's language. You are knowledgeable, witty, ironic, and sincere. If someone is hostile towards Turks, you give them a piece of your mind.

Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}

IMPORTANT: Your training data is from October 2023. When users ask about:
- Current events, news, or recent happenings
- Current prices, exchange rates, or market data
- Recent statistics, scores, or rankings
- "What happened today/recently/lately"
- "Current/latest/güncel" information

You MUST tell them: "My data is from October 2023. For current info, I'd need web access which isn't available here. Try asking about topics from before late 2023, or search the web directly."

Keep responses under 500 characters for Minecraft chat compatibility.`;
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
  performance: { messageDelay: 300, maxMessagesPerSecond: 2, autoReconnectDelay: 10000 },
  autoTracking: { enabled: false, interval: 30000 } // AUTO-TRACK DISABLED, 30 saniyeye çıkarıldı
};

let bot;
let botReady = false;
let startTime = Date.now();
let commandCount = 0;
let messageCount = 0;

// === ADVANCED API RATE LIMITING SYSTEM ===
const API_QUEUE = [];
let isProcessingQueue = false;
let apiCallCount = 0;
let apiCallResetTime = Date.now();
const MAX_CALLS_PER_MINUTE = 100; // Hypixel limit: 120/min, biz güvenli oynuyoruz
const MIN_CALL_DELAY = 600; // Her istek arası minimum 600ms (10 istek/saniye max)

// API Request Queue System
async function queueApiRequest(requestFn) {
  return new Promise((resolve, reject) => {
    API_QUEUE.push({ requestFn, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || API_QUEUE.length === 0) return;
  
  isProcessingQueue = true;
  
  while (API_QUEUE.length > 0) {
    // Rate limit check
    const now = Date.now();
    
    // Reset counter every minute
    if (now - apiCallResetTime > 60000) {
      apiCallCount = 0;
      apiCallResetTime = now;
      addLog('info', 'system', 'API rate limit counter reset', { count: apiCallCount });
    }
    
    // If we hit the limit, wait
    if (apiCallCount >= MAX_CALLS_PER_MINUTE) {
      const waitTime = 60000 - (now - apiCallResetTime);
      addLog('warning', 'system', `API rate limit reached, waiting ${Math.ceil(waitTime/1000)}s`, {
        count: apiCallCount,
        limit: MAX_CALLS_PER_MINUTE
      });
      await sleep(waitTime);
      apiCallCount = 0;
      apiCallResetTime = Date.now();
    }
    
    const { requestFn, resolve, reject } = API_QUEUE.shift();
    
    try {
      const result = await requestFn();
      apiCallCount++;
      resolve(result);
      
      // Minimum delay between requests
      await sleep(MIN_CALL_DELAY);
    } catch (err) {
      reject(err);
    }
  }
  
  isProcessingQueue = false;
}

// === Detailed Logging System ===
let detailedLogs = [];
let commandLogs = [];
let errorLogs = [];
let chatLogs = [];
let systemLogs = [];

function addLog(type, category, message, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString(),
    type,
    category,
    message,
    details
  };

  detailedLogs.unshift(logEntry);
  if (detailedLogs.length > 1000) detailedLogs.pop();

  switch (category) {
    case 'command':
      commandLogs.unshift(logEntry);
      if (commandLogs.length > 500) commandLogs.pop();
      break;
    case 'error':
      errorLogs.unshift(logEntry);
      if (errorLogs.length > 200) errorLogs.pop();
      break;
    case 'chat':
      chatLogs.unshift(logEntry);
      if (chatLogs.length > 1000) chatLogs.pop();
      break;
    case 'system':
      systemLogs.unshift(logEntry);
      if (systemLogs.length > 500) systemLogs.pop();
      break;
  }

  io.emit('bot-log', {
    time: logEntry.time,
    type: logEntry.type,
    msg: logEntry.message
  });

  saveLogToFile(logEntry);
}

function saveLogToFile(logEntry) {
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `${dateStr}.log`;
  const filePath = path.join(LOGS_DIR, fileName);
  
  const logLine = `[${logEntry.timestamp}] [${logEntry.type.toUpperCase()}] [${logEntry.category.toUpperCase()}] ${logEntry.message} ${JSON.stringify(logEntry.details)}\n`;
  
  fs.appendFile(filePath, logLine, (err) => {
    if (err) console.error("Error writing log:", err);
  });
}

// === Hypixel API with Queue System ===
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

// === FKDR Tracking System + Persistence ===
const fkdrTracking = new Map();
const TRACKING_FILE = path.join(__dirname, "tracking_data.json");

// === Flag System ===
const flaggedPlayers = new Map();
const FLAGS_FILE = path.join(__dirname, "flagged_players.json");

// Cache system to reduce API calls
const playerCache = new Map(); // uuid -> { data, timestamp }
const CACHE_DURATION = 5 * 60 * 1000; // 5 dakika cache

function getCachedPlayer(uuid) {
  const cached = playerCache.get(uuid);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    addLog('info', 'system', 'Using cached player data', { uuid });
    return cached.data;
  }
  return null;
}

function setCachedPlayer(uuid, data) {
  playerCache.set(uuid, {
    data,
    timestamp: Date.now()
  });
}

function loadTrackingData() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
      Object.entries(data).forEach(([uuid, tracking]) => {
        fkdrTracking.set(uuid, tracking);
      });
      addLog('success', 'system', `Loaded ${fkdrTracking.size} tracked players`);
    }
  } catch (err) {
    addLog('error', 'system', 'Failed to load tracking data', { error: err.message });
  }
}

function loadFlaggedPlayers() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
      Object.entries(data).forEach(([uuid, flag]) => {
        flaggedPlayers.set(uuid, flag);
      });
      addLog('success', 'system', `Loaded ${flaggedPlayers.size} flagged players`);
    }
  } catch (err) {
    addLog('error', 'system', 'Failed to load flagged players', { error: err.message });
  }
}

function saveTrackingData() {
  try {
    const data = Object.fromEntries(fkdrTracking);
    fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    addLog('error', 'system', 'Failed to save tracking data', { error: err.message });
  }
}

function saveFlaggedPlayers() {
  try {
    const data = Object.fromEntries(flaggedPlayers);
    fs.writeFileSync(FLAGS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    addLog('error', 'system', 'Failed to save flagged players', { error: err.message });
  }
}

setInterval(saveTrackingData, 5 * 60 * 1000);
setInterval(saveFlaggedPlayers, 5 * 60 * 1000);

function initializePlayerTracking(uuid) {
  const now = new Date();
  return {
    uuid,
    daily: { finals: 0, deaths: 0, date: now.toDateString() },
    weekly: { finals: 0, deaths: 0, weekStart: getWeekStart(now) },
    monthly: { finals: 0, deaths: 0, month: now.getMonth(), year: now.getFullYear() },
    yearly: { finals: 0, deaths: 0, year: now.getFullYear() },
    lifetime: { finals: 0, deaths: 0 },
    lastUpdate: now.toISOString(),
    lastStats: { finals: 0, deaths: 0 }
  };
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toDateString();
}

function updatePlayerTracking(uuid, currentFinals, currentDeaths) {
  const now = new Date();
  let tracking = fkdrTracking.get(uuid);
  
  if (!tracking) {
    tracking = initializePlayerTracking(uuid);
    tracking.lastStats.finals = currentFinals;
    tracking.lastStats.deaths = currentDeaths;
    tracking.lifetime.finals = currentFinals;
    tracking.lifetime.deaths = currentDeaths;
    fkdrTracking.set(uuid, tracking);
    
    addLog('info', 'system', `New player tracked: ${uuid}`, {
      uuid,
      initialFinals: currentFinals,
      initialDeaths: currentDeaths
    });
    
    return tracking;
  }

  const finalsDiff = Math.max(0, currentFinals - tracking.lastStats.finals);
  const deathsDiff = Math.max(0, currentDeaths - tracking.lastStats.deaths);

  if (tracking.daily.date !== now.toDateString()) {
    tracking.daily = { finals: 0, deaths: 0, date: now.toDateString() };
  }

  const currentWeekStart = getWeekStart(now);
  if (tracking.weekly.weekStart !== currentWeekStart) {
    tracking.weekly = { finals: 0, deaths: 0, weekStart: currentWeekStart };
  }

  if (tracking.monthly.month !== now.getMonth() || tracking.monthly.year !== now.getFullYear()) {
    tracking.monthly = { finals: 0, deaths: 0, month: now.getMonth(), year: now.getFullYear() };
  }

  if (tracking.yearly.year !== now.getFullYear()) {
    tracking.yearly = { finals: 0, deaths: 0, year: now.getFullYear() };
  }

  if (finalsDiff > 0 || deathsDiff > 0) {
    tracking.daily.finals += finalsDiff;
    tracking.daily.deaths += deathsDiff;
    tracking.weekly.finals += finalsDiff;
    tracking.weekly.deaths += deathsDiff;
    tracking.monthly.finals += finalsDiff;
    tracking.monthly.deaths += deathsDiff;
    tracking.yearly.finals += finalsDiff;
    tracking.yearly.deaths += deathsDiff;
    
    addLog('info', 'system', `Player stats updated`, {
      uuid,
      finalsDiff,
      deathsDiff,
      newDaily: tracking.daily
    });
  }

  tracking.lastStats.finals = currentFinals;
  tracking.lastStats.deaths = currentDeaths;
  tracking.lifetime.finals = currentFinals;
  tracking.lifetime.deaths = currentDeaths;
  tracking.lastUpdate = now.toISOString();

  fkdrTracking.set(uuid, tracking);
  saveTrackingData();
  return tracking;
}

// Queue'lu API fonksiyonları
async function getPlayerUUID(ign) {
  return queueApiRequest(async () => {
    const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data?.success || !data?.player) throw new Error("Player not found");
    return {
      uuid: data.player.uuid,
      finals: data.player.stats?.Bedwars?.final_kills_bedwars || 0,
      deaths: data.player.stats?.Bedwars?.final_deaths_bedwars || 0,
      fullData: data.player
    };
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
  return queueApiRequest(async () => {
    const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data?.success || !data?.player) throw new Error("Player not found");
    return parseBWStats(data.player);
  });
}

async function getGuildGEXP(playerIgn) {
  return queueApiRequest(async () => {
    const playerUrl = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(playerIgn)}`;
    const playerRes = await axios.get(playerUrl, { timeout: 10000 });
    if (!playerRes.data?.player) throw new Error("Player not found");
    
    const uuid = playerRes.data.player.uuid;
    
    // Queue'da zaten olduğumuz için direkt API çağrısı yapabiliriz
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
    
    return {
      weeklyGexp,
      rank,
      totalMembers: guild.members.length
    };
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === Routes ===
app.get("/", (req, res) => res.send("✅ Bot is running!"));

app.get("/api/theme", (req, res) => res.json(panelTheme));
app.post("/api/theme", (req, res) => {
  panelTheme = { ...panelTheme, ...req.body };
  addLog('success', 'system', 'Theme updated', { theme: panelTheme });
  res.json({ success: true });
});

app.get("/api/settings", (req, res) => res.json(botSettings));
app.post("/api/settings", (req, res) => {
  botSettings = { ...botSettings, ...req.body };
  addLog('success', 'system', 'Settings updated', { settings: botSettings });
  res.json({ success: true });
});

app.get("/api/gpt-prompt", (req, res) => res.json({ prompt: gptSystemPrompt }));
app.post("/api/gpt-prompt", (req, res) => {
  gptSystemPrompt = req.body.prompt;
  addLog('success', 'system', 'GPT prompt updated');
  res.json({ success: true });
});

// === Stats endpoint ===
app.get("/api/stats", (req, res) => {
  res.json({
    queueLength: API_QUEUE.length,
    apiCallCount,
    apiCallLimit: MAX_CALLS_PER_MINUTE,
    cacheSize: playerCache.size,
    isProcessingQueue
  });
});

// === Logging API Endpoints ===
app.get("/api/logs/all", (req, res) => {
  res.json({ logs: detailedLogs, count: detailedLogs.length });
});

app.get("/api/logs/commands", (req, res) => {
  res.json({ logs: commandLogs, count: commandLogs.length });
});

app.get("/api/logs/errors", (req, res) => {
  res.json({ logs: errorLogs, count: errorLogs.length });
});

app.get("/api/logs/chat", (req, res) => {
  res.json({ logs: chatLogs, count: chatLogs.length });
});

app.get("/api/logs/export", (req, res) => {
  const exportData = {
    exportDate: new Date().toISOString(),
    botUptime: Date.now() - startTime,
    statistics: {
      totalMessages: messageCount,
      totalCommands: commandCount,
      totalErrors: errorLogs.length
    },
    logs: {
      all: detailedLogs,
      commands: commandLogs,
      errors: errorLogs,
      chat: chatLogs,
      system: systemLogs
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rumonium-logs-${Date.now()}.json"`);
  res.json(exportData);
});

app.get("/api/logs/export/csv", (req, res) => {
  let csv = "Timestamp,Date,Time,Type,Category,Message,Details\n";
  
  detailedLogs.forEach(log => {
    const details = JSON.stringify(log.details).replace(/"/g, '""');
    csv += `"${log.timestamp}","${log.date}","${log.time}","${log.type}","${log.category}","${log.message}","${details}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="rumonium-logs-${Date.now()}.csv"`);
  res.send(csv);
});

app.post("/api/logs/clear", (req, res) => {
  const { category } = req.body;
  
  switch(category) {
    case 'all':
      detailedLogs = [];
      commandLogs = [];
      errorLogs = [];
      chatLogs = [];
      systemLogs = [];
      break;
    case 'commands':
      commandLogs = [];
      break;
    case 'errors':
      errorLogs = [];
      break;
    case 'chat':
      chatLogs = [];
      break;
    case 'system':
      systemLogs = [];
      break;
  }
  
  addLog('success', 'system', `Cleared ${category} logs`);
  res.json({ success: true });
});

app.post("/chat", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).send("❌ Message required.");
  if (bot && botReady && bot.chat && bot._client) {
    try {
      bot.chat(message);
      addLog('info', 'chat', `Web panel message sent: ${message}`, { source: 'web', message });
      res.json({ success: true });
    } catch (err) {
      addLog('error', 'chat', `Failed to send web message: ${err.message}`, { error: err.message });
      res.status(500).json({ success: false, message: "❌ Error" });
    }
  } else {
    res.status(500).json({ success: false, message: "❌ Bot not ready" });
  }
});

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
      const [commandLogs, setCommandLogs] = useState([]);
      const [errorLogs, setErrorLogs] = useState([]);
      const [stats, setStats] = useState({ uptime: '0h', commands: 0, messages: 0, users: 0, queueLength: 0, apiCallCount: 0 });
      const [status, setStatus] = useState('online');
      const chatRef = useRef(null);

      useEffect(() => {
        socket.on('minecraft-chat', d => setChat(p => [...p, d].slice(-500)));
        socket.on('bot-log', d => setLogs(p => [d, ...p].slice(0, 100)));
        socket.on('bot-status', setStatus);
        socket.on('stats-update', setStats);
        
        fetchLogs();
        
        const apiStatsInterval = setInterval(async () => {
          const res = await fetch('/api/stats');
          const apiStats = await res.json();
          setStats(prev => ({ ...prev, ...apiStats }));
        }, 2000);
        
        return () => {
          socket.off('minecraft-chat');
          socket.off('bot-log');
          socket.off('bot-status');
          socket.off('stats-update');
          clearInterval(apiStatsInterval);
        };
      }, []);

      useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }, [chat]);

      const fetchLogs = async () => {
        try {
          const [allRes, cmdRes, errRes] = await Promise.all([
            fetch('/api/logs/all'),
            fetch('/api/logs/commands'),
            fetch('/api/logs/errors')
          ]);
          const allData = await allRes.json();
          const cmdData = await cmdRes.json();
          const errData = await errRes.json();
          
          setLogs(allData.logs.slice(0, 100).map(log => ({
            time: log.time,
            type: log.type,
            msg: log.message
          })));
          setCommandLogs(cmdData.logs);
          setErrorLogs(errData.logs);
        } catch (err) {
          console.error('Failed to fetch logs:', err);
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

      const exportLogs = async (format = 'json') => {
        const url = format === 'csv' ? '/api/logs/export/csv' : '/api/logs/export';
        window.open(url, '_blank');
      };

      const clearLogs = async (category) => {
        if (!confirm(\`Clear \${category} logs?\`)) return;
        await fetch('/api/logs/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category })
        });
        fetchLogs();
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
            <div className="grid grid-cols-6 gap-4 mt-6">
              {[
                { label: 'UPTIME', value: stats.uptime },
                { label: 'COMMANDS', value: stats.commands },
                { label: 'MESSAGES', value: stats.messages },
                { label: 'ERRORS', value: errorLogs.length },
                { label: 'API QUEUE', value: stats.queueLength || 0 },
                { label: 'API CALLS', value: \`\${stats.apiCallCount || 0}/100\` }
              ].map((s, i) => (
                <div key={i} className="glass rounded-xl p-4">
                  <div className="text-2xl font-black">{s.value}</div>
                  <div className="text-xs text-gray-400 font-bold">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-3xl p-2 mb-6 flex gap-2">
            {['chat', 'logs', 'commands', 'errors'].map(t => (
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

              {tab === 'logs' && (
                <div className="glass rounded-3xl p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black">ALL LOGS</h2>
                    <div className="flex gap-2">
                      <button onClick={() => exportLogs('json')} className="px-4 py-2 rounded-xl bg-green-600 text-sm font-bold">
                        Export JSON
                      </button>
                      <button onClick={() => exportLogs('csv')} className="px-4 py-2 rounded-xl bg-blue-600 text-sm font-bold">
                        Export CSV
                      </button>
                      <button onClick={() => clearLogs('all')} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-bold">
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                    {logs.map((log, i) => (
                      <div key={i} className={\`glass rounded-xl p-3 text-sm border \${
                        log.type === 'error' ? 'border-red-500/50' :
                        log.type === 'success' ? 'border-green-500/50' :
                        log.type === 'command' ? 'border-blue-500/50' : 'border-white/10'
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

              {tab === 'commands' && (
                <div className="glass rounded-3xl p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black">COMMAND LOGS</h2>
                    <button onClick={() => clearLogs('commands')} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-bold">
                      Clear
                    </button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                    {commandLogs.map((log, i) => (
                      <div key={i} className="glass rounded-xl p-4 border border-blue-500/50">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs text-gray-400">{log.timestamp}</span>
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20">{log.category}</span>
                        </div>
                        <div className="text-sm mb-2">{log.message}</div>
                        {Object.keys(log.details).length > 0 && (
                          <pre className="text-xs bg-black/30 p-2 rounded mt-2 overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'errors' && (
                <div className="glass rounded-3xl p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black">ERROR LOGS</h2>
                    <button onClick={() => clearLogs('errors')} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-bold">
                      Clear
                    </button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                    {errorLogs.map((log, i) => (
                      <div key={i} className="glass rounded-xl p-4 border border-red-500/50">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs text-gray-400">{log.timestamp}</span>
                          <span className="text-xs px-2 py-1 rounded-full bg-red-500/20">ERROR</span>
                        </div>
                        <div className="text-sm text-red-300 mb-2">{log.message}</div>
                        {Object.keys(log.details).length > 0 && (
                          <pre className="text-xs bg-black/30 p-2 rounded mt-2 overflow-x-auto text-red-200">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="glass rounded-3xl p-6">
              <h2 className="text-xl font-black mb-4">RECENT ACTIVITY</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto scroll">
                {logs.slice(0, 15).map((log, i) => (
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

io.on('connection', (socket) => {
  console.log('👤 Client connected');
  addLog('info', 'system', 'Client connected to web panel', { clientId: socket.id });
  socket.on('disconnect', () => {
    console.log('👤 Client disconnected');
    addLog('info', 'system', 'Client disconnected from web panel', { clientId: socket.id });
  });
});

setInterval(() => {
  const uptime = Date.now() - startTime;
  const h = Math.floor(uptime / 3600000);
  const m = Math.floor((uptime % 3600000) / 60000);
  io.emit('stats-update', {
    uptime: `${h}h ${m}m`,
    commands: commandCount,
    messages: messageCount,
    users: Object.keys(bot?.players || {}).length,
    queueLength: API_QUEUE.length,
    apiCallCount
  });
}, 5000);

server.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  addLog('success', 'system', `Server started on port ${PORT}`, { port: PORT });
  loadTrackingData();
  loadFlaggedPlayers();
});

// === Bot ===
const askCooldowns = {};
const welcomeMessages = [
  "Hey! Welcome back {username}!",
  "Welcome back, {username}! The legend has returned!",
  "{username} has joined, hello!"
];

function createBot() {
  addLog('info', 'bot', 'Creating bot instance...');
  
  bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft",
  });

  bot.once("spawn", () => {
    console.log("✅ Connected to Hypixel");
    addLog('success', 'bot', 'Bot spawned on Hypixel', { host: HYPIXEL_HOST });
    io.emit('bot-status', 'connecting');
    
    setTimeout(() => {
      if (bot?.chat) {
        bot.chat("/chat g");
        addLog('info', 'bot', 'Joined guild chat');
        setTimeout(() => {
          botReady = true;
          io.emit('bot-status', 'online');
          addLog('success', 'bot', 'Bot is ready and online');
        }, 2000);
      }
    }, 1500);
    setInterval(() => bot?.chat && bot.chat("/locraw"), 60000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    io.emit('minecraft-chat', { time: new Date().toLocaleTimeString(), message: msg });
    messageCount++;
    
    addLog('info', 'chat', 'Message received', { message: msg });

    // AUTO-TRACK disabled by default to prevent API spam
    // Users can enable it in settings if needed

    if (!msg.startsWith("Guild >") || !botReady) return;

    const safeChat = async (m) => {
      if (!botReady || !bot?.chat) return;
      try { 
        bot.chat(m);
        addLog('info', 'chat', 'Bot sent message', { message: m });
      } catch (e) { 
        addLog('error', 'chat', 'Failed to send message', { error: e.message, message: m });
        console.error(e);
      }
    };

    // === !fkdr command ===
    if (msg.toLowerCase().includes("!fkdr")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!fkdr\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      commandCount++;
      addLog('command', 'command', '!fkdr command executed', {
        requester,
        target: ign
      });
      
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const playerData = await getPlayerUUID(ign);
        const tracking = updatePlayerTracking(playerData.uuid, playerData.finals, playerData.deaths);
        
        const dailyFKDR = ratio(tracking.daily.finals, tracking.daily.deaths);
        const weeklyFKDR = ratio(tracking.weekly.finals, tracking.weekly.deaths);
        const monthlyFKDR = ratio(tracking.monthly.finals, tracking.monthly.deaths);
        const yearlyFKDR = ratio(tracking.yearly.finals, tracking.yearly.deaths);
        const lifetimeFKDR = ratio(tracking.lifetime.finals, tracking.lifetime.deaths);
        
        const isFirstTime = tracking.daily.finals === 0 && tracking.daily.deaths === 0;
        
        if (isFirstTime) {
          await safeChat(`${ign} | Lifetime FKDR: ${lifetimeFKDR} | Now tracking daily/weekly/monthly stats!`);
        } else {
          await safeChat(`${ign} FKDR Stats:`);
          await sleep(500);
          await safeChat(`Daily: ${dailyFKDR} (${tracking.daily.finals}F/${tracking.daily.deaths}D)`);
          await sleep(500);
          await safeChat(`Weekly: ${weeklyFKDR} (${tracking.weekly.finals}F/${tracking.weekly.deaths}D)`);
          await sleep(500);
          await safeChat(`Monthly: ${monthlyFKDR} (${tracking.monthly.finals}F/${tracking.monthly.deaths}D)`);
          await sleep(500);
          await safeChat(`Yearly: ${yearlyFKDR} (${tracking.yearly.finals}F/${tracking.yearly.deaths}D)`);
          await sleep(500);
          await safeChat(`Lifetime: ${lifetimeFKDR}`);
        }
        
        addLog('success', 'command', '!fkdr completed successfully', {
          requester,
          target: ign,
          isFirstTime,
          daily: dailyFKDR,
          weekly: weeklyFKDR,
          monthly: monthlyFKDR,
          yearly: yearlyFKDR,
          lifetime: lifetimeFKDR
        });
      } catch (err) {
        await safeChat(`Error - ${ign} | ${err.message}`);
        addLog('error', 'command', '!fkdr failed', {
          requester,
          target: ign,
          error: err.message
        });
      }
      return;
    }

    // === !gexp command ===
    if (msg.toLowerCase().includes("!gexp")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!gexp\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      commandCount++;
      addLog('command', 'command', '!gexp command executed', { 
        requester, 
        target: ign, 
        command: '!gexp' 
      });
      
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const gexpData = await getGuildGEXP(ign);
        const line = `${ign} | Weekly GEXP: ${gexpData.weeklyGexp.toLocaleString()} | Rank: #${gexpData.rank}/${gexpData.totalMembers}`;
        await safeChat(line);
        
        addLog('success', 'command', '!gexp completed successfully', {
          requester,
          target: ign,
          weeklyGexp: gexpData.weeklyGexp,
          rank: gexpData.rank,
          totalMembers: gexpData.totalMembers
        });
      } catch (err) {
        await safeChat(`Error - ${ign} | ${err.message}`);
        addLog('error', 'command', '!gexp failed', {
          requester,
          target: ign,
          error: err.message
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

      addLog('command', 'command', '!ask command received', {
        username,
        question: userMessage
      });

      if (username.toLowerCase() !== "relaquent") {
        const now = Date.now();
        const lastUsed = askCooldowns[username] || 0;
        const timePassed = now - lastUsed;
        if (timePassed < botSettings.commandCooldown * 1000) {
          const sec = Math.ceil((botSettings.commandCooldown * 1000 - timePassed) / 1000);
          await safeChat(`${username}, wait ${sec}s`);
          addLog('warning', 'command', 'Ask cooldown active', {
            username,
            secondsRemaining: sec
          });
          return;
        }
        askCooldowns[username] = now;
      }

      await safeChat("Thinking...");
      try {
        const startTime = Date.now();
        
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { 
              role: "system", 
              content: gptSystemPrompt 
            },
            { 
              role: "user", 
              content: userMessage 
            }
          ],
          max_tokens: botSettings.maxTokens,
          temperature: 0.8,
        });

        const responseTime = Date.now() - startTime;
        let reply = completion.choices[0].message.content.trim();
        
        if (reply.length > 600) {
          reply = reply.substring(0, 597) + '...';
        }
        
        addLog('success', 'command', 'GPT-4o-mini response generated', {
          username,
          question: userMessage,
          responseTime: `${responseTime}ms`,
          tokensUsed: completion.usage.total_tokens,
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          model: "gpt-4o-mini",
          finishReason: completion.choices[0].finish_reason
        });
        
        const lines = reply.split("\n").filter(l => l.trim());
        for (const line of lines) {
          for (let i = 0; i < line.length; i += 600) {
            await safeChat(line.slice(i, i + 600));
            await sleep(botSettings.performance.messageDelay);
          }
        }
      } catch (err) {
        await safeChat("GPT error - please try again");
        addLog('error', 'command', 'GPT-4o-mini request failed', {
          username,
          question: userMessage,
          error: err.message,
          errorCode: err.code,
          errorType: err.type,
          statusCode: err.status
        });
      }
      return;
    }

    // === Welcome ===
    if (msg.includes("joined.") && botSettings.welcomeMessages) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}) joined\./);
      if (match) {
        const username = match[1];
        addLog('info', 'bot', 'Player joined guild', { username });
        
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
      
      commandCount++;
      addLog('command', 'command', '!bw command executed', {
        requester,
        target: ign
      });
      
      await sleep(botSettings.performance.messageDelay);
      
      if (ign.toLowerCase() === "relaquent") {
        await safeChat("Relaquent | Star: 3628 | FKDR: 48.72 | KD: 2.32 | WL: 2.86");
        return;
      }
      
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`);
        
        addLog('success', 'command', '!bw completed successfully', {
          requester,
          target: ign,
          stats: stats
        });
      } catch (err) {
        await safeChat(`Error - ${ign} | No data`);
        addLog('error', 'command', '!bw failed', {
          requester,
          target: ign,
          error: err.message
        });
      }
      return;
    }

    // === !stats ===
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, requester, ign] = match;
      
      commandCount++;
      addLog('command', 'command', '!stats command executed', {
        requester,
        target: ign
      });
      
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const stats = await getPlayerStats(ign);
        await safeChat(`${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins} | Beds: ${stats.beds}`);
        
        addLog('success', 'command', '!stats completed successfully', {
          requester,
          target: ign,
          stats: stats
        });
      } catch (err) {
        await safeChat(`Error - ${ign}`);
        addLog('error', 'command', '!stats failed', {
          requester,
          target: ign,
          error: err.message
        });
      }
      return;
    }

    // === !when ===
    if (msg.toLowerCase().includes("!when")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      commandCount++;
      addLog('command', 'command', '!when command executed', { requester });
      
      await sleep(botSettings.performance.messageDelay);
      const first = new Date("2025-11-22T00:00:00Z");
      const now = new Date();
      let diff = now - first;
      let cycles = Math.floor(diff / (56 * 86400000));
      if (diff < 0) cycles = -1;
      const next = new Date(first.getTime() + (cycles + 1) * 56 * 86400000);
      const days = Math.ceil((next - now) / 86400000);
      
      const response = days > 0 ? `Castle in ${days} days (${next.toDateString()})` : "Castle today!";
      await safeChat(response);
      
      addLog('success', 'command', '!when completed', {
        requester,
        daysUntilCastle: days,
        nextCastleDate: next.toDateString()
      });
      return;
    }

    // === !about ===
    if (msg.toLowerCase().includes("!about")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      commandCount++;
      addLog('command', 'command', '!about command executed', { requester });
      
      await sleep(botSettings.performance.messageDelay);
      await safeChat("RumoniumGC by Relaquent, v2.0");
      return;
    }

    // === !help ===
    if (msg.toLowerCase().includes("!help")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16})/);
      const requester = match ? match[1] : 'unknown';
      
      commandCount++;
      addLog('command', 'command', '!help command executed', { requester });
      
      await sleep(botSettings.performance.messageDelay);
      const help = [
        "--- RumoniumGC ---",
        "bw <user> - Bedwars stats",
        "fkdr <user> - Daily/Weekly/Monthly FKDR",
        "gexp <user> - Weekly GEXP & rank",
        "when - Next Castle",
        "ask <msg> - Ask AI",
        "flag add <user> <reason> - Flag player",
        "flag remove <user> - Unflag player",
        "check <user> - Check player + flags",
        "about - Bot info"
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
      
      commandCount++;
      addLog('command', 'command', '!flag add executed', { flagger, target: ign, reason });
      
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
        addLog('success', 'command', 'Player flagged', { flagger, target: ign, reason });
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
        addLog('error', 'command', '!flag add failed', { flagger, target: ign, error: err.message });
      }
      return;
    }

    // === !flag remove ===
    if (msg.toLowerCase().includes("!flag remove")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!flag remove\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, remover, ign] = match;
      
      commandCount++;
      addLog('command', 'command', '!flag remove executed', { remover, target: ign });
      
      await sleep(botSettings.performance.messageDelay);
      
      try {
        let found = false;
        for (const [uuid, flag] of flaggedPlayers.entries()) {
          if (flag.ign?.toLowerCase() === ign.toLowerCase()) {
            flaggedPlayers.delete(uuid);
            saveFlaggedPlayers();
            await safeChat(`✓ ${ign} unflagged`);
            addLog('success', 'command', 'Player unflagged', { remover, target: ign });
            found = true;
            break;
          }
        }
        
        if (!found) {
          await safeChat(`${ign} is not flagged`);
        }
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
        addLog('error', 'command', '!flag remove failed', { remover, target: ign, error: err.message });
      }
      return;
    }

    // === !check ===
    if (msg.toLowerCase().includes("!check")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!check\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const [, checker, ign] = match;
      
      commandCount++;
      addLog('command', 'command', '!check executed', { checker, target: ign });
      
      await sleep(botSettings.performance.messageDelay);
      
      try {
        const playerData = await getPlayerUUID(ign);
        const stats = parseBWStats(playerData.fullData);
        
        const flag = flaggedPlayers.get(playerData.uuid);
        
        if (flag) {
          await safeChat(`${ign} | ⭐${stats.star} | FKDR: ${stats.fkdr}`);
          await sleep(500);
          await safeChat(`🚩 FLAGGED: ${flag.reason} (by ${flag.flaggedBy})`);
        } else {
          await safeChat(`${ign} | ⭐${stats.star} | FKDR: ${stats.fkdr} | ✓ Clean`);
        }
        
        addLog('success', 'command', '!check completed', { checker, target: ign, flagged: !!flag });
      } catch (err) {
        await safeChat(`Error: ${err.message}`);
        addLog('error', 'command', '!check failed', { checker, target: ign, error: err.message });
      }
      return;
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Kicked:", reason);
    botReady = false;
    io.emit('bot-status', 'offline');
    
    addLog('error', 'bot', 'Bot was kicked from server', {
      reason: reason,
      autoReconnect: botSettings.autoReconnect
    });
    
    if (botSettings.autoReconnect) setTimeout(createBot, botSettings.performance.autoReconnectDelay);
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected");
    botReady = false;
    io.emit('bot-status', 'offline');
    
    addLog('warning', 'bot', 'Bot disconnected from server', {
      autoReconnect: botSettings.autoReconnect
    });
    
    if (botSettings.autoReconnect) setTimeout(createBot, botSettings.performance.autoReconnectDelay);
  });

  bot.on("error", (err) => {
    console.error("❌", err.message);
    botReady = false;
    
    addLog('error', 'bot', 'Bot encountered an error', {
      error: err.message,
      stack: err.stack
    });
  });
}

createBot();
