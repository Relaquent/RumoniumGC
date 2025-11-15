const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");
const OpenAI = require("openai");

// === 0. OpenAI Setup ===
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not found. Please add it in Render Environment Variables.");
  process.exit(1);
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// === 1. Express Web Server ===
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("✅ Bot is running and online! (Render)");
});

// === PREMIUM CONTROL PANEL ===
app.get("/control", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RumoniumGC Premium Control Panel</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slide-in {
      from { opacity: 0; transform: translateX(-10px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .animate-fade-in {
      animation: fade-in 0.5s ease-out;
    }
    .animate-slide-in {
      animation: slide-in 0.3s ease-out;
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(147, 51, 234, 0.5);
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(147, 51, 234, 0.7);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script type="text/babel" data-type="module">
    const { useState, useEffect } = React;
    
    // Lucide Icons as SVG components
    const Activity = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
    );
    
    const MessageSquare = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    );
    
    const Users = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    );
    
    const Zap = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    );
    
    const Settings = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6m0 6v6m8.66-15.66l-4.24 4.24M9.17 14.83l-4.24 4.24M23 12h-6m-6 0H1m19.07 7.07l-4.24-4.24M9.17 9.17L4.93 4.93"></path>
      </svg>
    );
    
    const Terminal = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>
    );
    
    const BarChart3 = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18"></path>
        <path d="M18 17V9"></path>
        <path d="M13 17V5"></path>
        <path d="M8 17v-3"></path>
      </svg>
    );
    
    const Send = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    );
    
    const Power = () => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
        <line x1="12" y1="2" x2="12" y2="12"></line>
      </svg>
    );
    
    const RefreshCw = () => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    );
    
    const Clock = () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    );

    function BotControlPanel() {
      const [activeTab, setActiveTab] = useState('dashboard');
      const [message, setMessage] = useState('');
      const [logs, setLogs] = useState([
        { time: new Date().toLocaleTimeString(), type: 'info', msg: 'Bot connected to Hypixel' },
        { time: new Date().toLocaleTimeString(), type: 'success', msg: 'Switched to Guild chat' },
        { time: new Date().toLocaleTimeString(), type: 'command', msg: 'User executed !bw command' },
      ]);
      const [stats, setStats] = useState({
        uptime: '2h 34m',
        commands: 147,
        messages: 523,
        users: 89
      });
      const [botStatus, setBotStatus] = useState('online');
      const [settings, setSettings] = useState({
        autoReconnect: true,
        welcomeMessages: true,
        commandCooldown: 45,
        maxTokens: 100
      });

      useEffect(() => {
        const interval = setInterval(() => {
          const types = ['info', 'success', 'command'];
          const messages = ['Heartbeat check', 'Player joined guild', 'Command processed'];
          const newLog = {
            time: new Date().toLocaleTimeString(),
            type: types[Math.floor(Math.random() * types.length)],
            msg: messages[Math.floor(Math.random() * messages.length)]
          };
          setLogs(prev => [newLog, ...prev].slice(0, 50));
        }, 5000);
        return () => clearInterval(interval);
      }, []);

      const sendMessage = async () => {
        if (!message.trim()) return;
        
        try {
          const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          if (response.ok) {
            setLogs(prev => [{
              time: new Date().toLocaleTimeString(),
              type: 'success',
              msg: \`Sent: \${message}\`
            }, ...prev]);
            setMessage('');
          }
        } catch (err) {
          setLogs(prev => [{
            time: new Date().toLocaleTimeString(),
            type: 'error',
            msg: 'Failed to send message'
          }, ...prev]);
        }
      };

      const executeCommand = (cmd) => {
        fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: cmd })
        }).then(() => {
          setLogs(prev => [{
            time: new Date().toLocaleTimeString(),
            type: 'command',
            msg: \`Executed: \${cmd}\`
          }, ...prev]);
        });
      };

      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-6 overflow-hidden">
          {/* Animated background effects */}
          <div className="fixed inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
            <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{animationDelay: '2s'}}></div>
            <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{animationDelay: '4s'}}></div>
          </div>

          <div className="max-w-7xl mx-auto relative z-10">
            {/* Header */}
            <div className="mb-8 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                    RumoniumGC Control Panel
                  </h1>
                  <p className="text-gray-300 mt-2">v1.1.2 - Advanced Bot Management System</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-lg rounded-full px-4 py-2 border border-white/20">
                    <div className={\`w-3 h-3 rounded-full \${botStatus === 'online' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}\`}></div>
                    <span className="text-sm font-medium">{botStatus === 'online' ? 'Online' : 'Offline'}</span>
                  </div>
                  <button 
                    onClick={() => setBotStatus(botStatus === 'online' ? 'offline' : 'online')}
                    className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 px-6 py-2 rounded-full font-semibold transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/50 flex items-center gap-2"
                  >
                    <Power />
                    Toggle Bot
                  </button>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {[
                  { Icon: Clock, label: 'Uptime', value: stats.uptime, color: 'from-purple-500 to-pink-500' },
                  { Icon: Zap, label: 'Commands', value: stats.commands, color: 'from-blue-500 to-cyan-500' },
                  { Icon: MessageSquare, label: 'Messages', value: stats.messages, color: 'from-indigo-500 to-purple-500' },
                  { Icon: Users, label: 'Active Users', value: stats.users, color: 'from-cyan-500 to-blue-500' }
                ].map((stat, idx) => (
                  <div 
                    key={idx}
                    className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 hover:border-white/40 transition-all duration-300 hover:scale-105 hover:shadow-xl"
                  >
                    <div className={\`w-12 h-12 rounded-xl bg-gradient-to-br \${stat.color} flex items-center justify-center mb-3\`}>
                      <stat.Icon />
                    </div>
                    <div className="text-2xl font-bold">{stat.value}</div>
                    <div className="text-sm text-gray-300">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 mb-6 bg-white/5 backdrop-blur-lg rounded-2xl p-2 border border-white/20">
              {[
                { id: 'dashboard', Icon: Activity, label: 'Dashboard' },
                { id: 'chat', Icon: MessageSquare, label: 'Chat Control' },
                { id: 'commands', Icon: Terminal, label: 'Commands' },
                { id: 'settings', Icon: Settings, label: 'Settings' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={\`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all duration-300 \${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-purple-500 to-blue-500 shadow-lg shadow-purple-500/50'
                      : 'hover:bg-white/10'
                  }\`}
                >
                  <tab.Icon />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-6">
                {activeTab === 'dashboard' && (
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 animate-fade-in">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                      <BarChart3 />
                      System Overview
                    </h2>
                    <div className="space-y-4">
                      {[
                        { label: 'CPU Usage', value: 45, color: 'from-purple-500 to-blue-500' },
                        { label: 'Memory Usage', value: 62, color: 'from-blue-500 to-cyan-500' },
                        { label: 'Network Activity', value: 78, color: 'from-indigo-500 to-purple-500' }
                      ].map((item, idx) => (
                        <div key={idx} className="bg-white/5 rounded-xl p-4 border border-white/10">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-gray-300">{item.label}</span>
                            <span className="text-sm font-semibold">{item.value}%</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-2">
                            <div className={\`bg-gradient-to-r \${item.color} h-2 rounded-full\`} style={{width: \`\${item.value}%\`}}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'chat' && (
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 animate-fade-in">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                      <MessageSquare />
                      Chat Control
                    </h2>
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                          placeholder="Type a message to send to guild chat..."
                          className="flex-1 bg-white/5 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                        <button
                          onClick={sendMessage}
                          className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 px-6 py-3 rounded-xl font-semibold transition-all duration-300 hover:scale-105 hover:shadow-lg flex items-center"
                        >
                          <Send />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {['Hello Guild!', 'Good Game!', 'GG WP', 'Thanks!'].map(quick => (
                          <button
                            key={quick}
                            onClick={() => setMessage(quick)}
                            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-sm transition-all"
                          >
                            {quick}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'commands' && (
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 animate-fade-in">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                      <Terminal />
                      Quick Commands
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { cmd: '!help', desc: 'Show help menu' },
                        { cmd: '!about', desc: 'Bot information' },
                        { cmd: '!when', desc: 'Castle countdown' },
                        { cmd: '/chat g', desc: 'Switch to guild' },
                        { cmd: '/locraw', desc: 'Get location' },
                        { cmd: '/gc Hello!', desc: 'Guild chat' }
                      ].map(item => (
                        <button
                          key={item.cmd}
                          onClick={() => executeCommand(item.cmd)}
                          className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 text-left transition-all hover:scale-105 hover:border-purple-500/50"
                        >
                          <div className="font-mono text-purple-300 font-semibold">{item.cmd}</div>
                          <div className="text-xs text-gray-400 mt-1">{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 animate-fade-in">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                      <Settings />
                      Bot Settings
                    </h2>
                    <div className="space-y-4">
                      {[
                        { key: 'autoReconnect', label: 'Auto Reconnect', desc: 'Automatically reconnect on disconnect' },
                        { key: 'welcomeMessages', label: 'Welcome Messages', desc: 'Send welcome messages to new members' }
                      ].map(setting => (
                        <div key={setting.key} className="bg-white/5 rounded-xl p-4 border border-white/10 flex items-center justify-between">
                          <div>
                            <div className="font-semibold">{setting.label}</div>
                            <div className="text-sm text-gray-400">{setting.desc}</div>
                          </div>
                          <button
                            onClick={() => setSettings({...settings, [setting.key]: !settings[setting.key]})}
                            className={\`relative w-14 h-7 rounded-full transition-all \${settings[setting.key] ? 'bg-gradient-to-r from-purple-500 to-blue-500' : 'bg-white/20'}\`}
                          >
                            <div className={\`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform \${settings[setting.key] ? 'translate-x-7' : ''}\`}></div>
                          </button>
                        </div>
                      ))}
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <label className="block font-semibold mb-2">Command Cooldown (seconds)</label>
                        <input
                          type="number"
                          value={settings.commandCooldown}
                          onChange={(e) => setSettings({...settings, commandCooldown: parseInt(e.target.value)})}
                          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <label className="block font-semibold mb-2">Max GPT Tokens</label>
                        <input
                          type="number"
                          value={settings.maxTokens}
                          onChange={(e) => setSettings({...settings, maxTokens: parseInt(e.target.value)})}
                          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Logs Sidebar */}
              <div className="lg:col-span-1">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 sticky top-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Activity />
                      Live Logs
                    </h2>
                    <button className="p-2 hover:bg-white/10 rounded-lg transition-all">
                      <RefreshCw />
                    </button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                    {logs.map((log, idx) => (
                      <div
                        key={idx}
                        className={\`bg-white/5 rounded-lg p-3 border border-white/10 text-sm animate-slide-in \${
                          log.type === 'error' ? 'border-red-500/30' :
                          log.type === 'success' ? 'border-green-500/30' :
                          log.type === 'command' ? 'border-blue-500/30' : ''
                        }\`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-400">{log.time}</span>
                          <span className={\`text-xs px-2 py-0.5 rounded-full \${
                            log.type === 'error' ? 'bg-red-500/20 text-red-300' :
                            log.type === 'success' ? 'bg-green-500/20 text-green-300' :
                            log.type === 'command' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-gray-500/20 text-gray-300'
                          }\`}>
                            {log.type}
                          </span>
                        </div>
                        <div className="text-gray-200">{log.msg}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<BotControlPanel />);
  </script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</body>
</html>
  `);
});

// Basic Web Panel (Legacy)
app.get("/panel", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>RumoniumGC Panel</title>
      </head>
      <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2>RumoniumGC Chat Panel</h2>
        <form method="POST" action="/chat">
          <input type="text" name="message" placeholder="Type your message" style="width:300px; padding:8px;" required />
          <button type="submit" style="padding:8px 15px;">Send</button>
        </form>
        <br><br>
        <a href="/control" style="padding: 10px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          🚀 Open Premium Control Panel
        </a>
      </body>
    </html>
  `);
});

// POST /chat -> send message to bot
let bot; // global bot
app.post("/chat", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).send("❌ Message required.");

  if (bot && bot.chat) {
    bot.chat(message);
    console.log(`🌐 Web chat sent: ${message}`);
    res.json({ success: true, message: `✅ Sent: ${message}` });
  } else {
    res.status(500).json({ success: false, message: "❌ Bot not connected yet." });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Web server is running on port ${PORT} (Ready for UptimeRobot & Panel)`);
});

// === 2. Hypixel API Key Check ===
if (!process.env.HYPIXEL_API_KEY) {
  console.error("❌ HYPIXEL_API_KEY not found. Please add it in Render Environment Variables.");
  process.exit(1);
}
const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY;

// === 3. Bot Settings ===
const HYPIXEL_HOST = "mc.hypixel.net";
const MC_VERSION = "1.8.9";

function ratio(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d === 0) return n > 0 ? "inf" : "0.00";
  return (n / d).toFixed(2);
}

function parseBWStats(player) {
  const bw = (player?.stats && player.stats.Bedwars) || {};
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
  const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(
    ign
  )}`;
  const { data } = await axios.get(url, { timeout: 10000 });

  if (data?.cause === "Invalid API key") throw new Error("Invalid API key (403)");
  if (!data?.success) throw new Error("API request failed");
  if (!data?.player) throw new Error("Player not found");

  return parseBWStats(data.player);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === 4. Welcome Messages ===
const welcomeMessages = [
  "Hey! Welcome back {username}!",
  "Welcome back, {username}! The legend has returned!",
  "Greetings, {username}!",
  "{username} has joined, hello!",
  "{username} the GOAT is back!"
];

// === Cooldown Tracker for !ask ===
const askCooldowns = {};
const ASK_COOLDOWN_MS = 1 * 45 * 1000; // 45 seconds

// === 5. Mineflayer Bot ===
function createBot() {
  bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft",
  });

  bot.once("spawn", () => {
    console.log("✅ Bot connected to Hypixel, switching to Guild chat...");
    setTimeout(() => bot.chat("/chat g"), 1500);

    setInterval(() => {
      bot.chat("/locraw");
    }, 60 * 1000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (!msg.startsWith("Guild >")) return;

    // === !ask command (ChatGPT) ===
    if (msg.toLowerCase().includes("!ask")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!ask\s+(.+)/i);
      if (!match) return;
      const username = match[1];
      const userMessage = match[2];

      // Cooldown check (except for Relaquent)
      if (username.toLowerCase() !== "relaquent") {
        const now = Date.now();
        const lastUsed = askCooldowns[username] || 0;
        const timePassed = now - lastUsed;

        if (timePassed < ASK_COOLDOWN_MS) {
          const secondsLeft = Math.ceil((ASK_COOLDOWN_MS - timePassed) / 1000);
          bot.chat(`${username}, you must wait ${secondsLeft}s before using "ask" command again.`);
          console.log(`⏳ Cooldown: ${username} tried !ask too soon`);
          return;
        }

        askCooldowns[username] = now;
      }

      bot.chat("Thinking...");
      console.log(`🤖 ChatGPT request from ${username}:`, userMessage);

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You're like a Turkish nationalist uncle who answers in the user's language. You answer questions knowledgeably and in a nationalistic manner. If you get a question that's hostile towards Turks, you give them a piece of your mind. You're ironic and witty. You're sincere."
            },
            { role: "user", content: userMessage }
          ],
          max_tokens: 100,
        });

        let reply = completion.choices[0].message.content.trim();

        function splitMessage(msg, limit = 600) {
          const parts = [];
          for (let i = 0; i < msg.length; i += limit) {
            parts.push(msg.slice(i, i + limit));
          }
          return parts;
        }

        const lines = reply.split("\n").filter(l => l.trim().length > 0);

        for (const line of lines) {
          const chunks = splitMessage(line);
          for (const chunk of chunks) {
            bot.chat(chunk);
            console.log("📤 GPT reply:", chunk);
            await sleep(1000);
          }
        }

      } catch (err) {
        console.error("⚠️ OpenAI API error:", err.message);
        bot.chat("Error: Could not get response from GPT.");
      }
      return;
    }

    // === Welcome message ===
    if (msg.includes("joined.")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}) joined\./);
      if (match) {
        const username = match[1];

        await sleep(2000);

        if (username.toLowerCase() === "caillou16") {
          const specialMsg = "Welcome back Caillou16 the bald.";
          bot.chat(specialMsg);
          console.log(`👑 Special welcome sent to Caillou16: ${specialMsg}`);
        } else {
          const randomMsg = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
          const finalMsg = randomMsg.replace("{username}", username);
          bot.chat(finalMsg);
          console.log(`👋 Welcome message sent: ${finalMsg}`);
        }
      }
      return;
    }

    // === !bw command ===
    if (msg.toLowerCase().includes("!bw")) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];

      if (ign.toLowerCase() === "relaquent") {
        await sleep(300);
        const specialMsg = "Relaquent | Star: 3628 | FKDR: 48.72 | KD: 2.32 | WL: 2.86";
        bot.chat(specialMsg);
        console.log("📤 Sent (special):", specialMsg);
        return;
      }

      await sleep(300);
      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`;
        bot.chat(line);
        console.log("📤 Sent:", line);
      } catch (err) {
        bot.chat(`Error - ${ign} | No data found.`);
        console.log("⚠️ Error:", err.message);
      }
      return;
    }

    // === !stats command ===
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      await sleep(300);

      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins} | Beds: ${stats.beds}`;
        bot.chat(line);
        console.log("📤 Sent:", line);
      } catch (err) {
        bot.chat(`Error - ${ign} | No data found.`);
        console.log("⚠️ Error (!stats):", err.message);
      }
      return;
    }

    // === !ping command ===
    if (msg.toLowerCase().includes("!ping")) {
      const match = msg.match(/!ping\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      await sleep(300);

      const playerObj = bot.players[ign];
      if (playerObj && typeof playerObj.ping === "number") {
        const line = `RumoGC - ${ign}: ${playerObj.ping}ms`;
        bot.chat(line);
        console.log("📤 Sent:", line);
      } else {
        const line = `Error - ${ign}: I can only check my ping for now.`;
        bot.chat(line);
        console.log("⚠️ Ping not found, player not online:", ign);
      }
      return;
    }

    // === !when command (Castle countdown) ===
    if (msg.toLowerCase().includes("!when")) {
      await sleep(300);

      const firstEvent = new Date("2025-11-22T00:00:00Z");
      const cycleDays = 56;
      const now = new Date();

      let diffMs = now.getTime() - firstEvent.getTime();
      let cyclesPassed = Math.floor(diffMs / (cycleDays * 24 * 60 * 60 * 1000));

      if (diffMs < 0) {
        cyclesPassed = -1;
      }

      const nextEvent = new Date(firstEvent.getTime() + (cyclesPassed + 1) * cycleDays * 24 * 60 * 60 * 1000);
      const msInDay = 24 * 60 * 60 * 1000;
      const daysLeft = Math.ceil((nextEvent - now) / msInDay);

      let response;
      if (daysLeft > 0) {
        response = `Castle will return in ${daysLeft} days (${nextEvent.toDateString()}) 5:30 PM EST.`;
      } else if (daysLeft === 0) {
        response = "Castle starts today!";
      } else {
        response = "Castle might be currently active!";
      }

      bot.chat(response);
      console.log("📤 Sent (!when):", response);
      return;
    }

    // === !about command ===
    if (msg.toLowerCase().includes("!about")) {
      await sleep(300);
      const aboutMsg = "RumoniumGC is automated by Relaquent, v1.1.2 - Last Update 19/10/25";
      bot.chat(aboutMsg);
      console.log("📤 Sent:", aboutMsg);
      return;
    }

    // === !help command ===
    if (msg.toLowerCase().includes("!help")) {
      await sleep(300);
      const helpMsg = [
        "----- RumoniumGC v1.1.2 -----",
        "bw <user> → Shows Bedwars stats.",
        "stats <user> → Shows detailed stats.",
        "when → Next Castle date.",
        "ask <msg> → Ask LumenRM.",
        "about → Information about the bot.",
        "help → Displays this page.",
        "----- Powered by Relaquent -----"
      ];
      for (const line of helpMsg) {
        bot.chat(line);
        await sleep(500);
      }
      console.log("📤 Sent: !help command list");
      return;
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Kicked from server:", reason);
    setTimeout(createBot, 10000);
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected, reconnecting...");
    setTimeout(createBot, 10000);
  });
}

// === 6. Start Bot ===
createBot();
