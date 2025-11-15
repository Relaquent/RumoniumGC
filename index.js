const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");
const OpenAI = require("openai");
const http = require("http");
const { Server } = require("socket.io");

// === 0. OpenAI Setup ===
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not found. Please add it in Render Environment Variables.");
  process.exit(1);
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// === 1. Express Web Server + Socket.IO ===
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store chat messages and settings
let chatHistory = [];
let gptSystemPrompt = "You're like a Turkish nationalist uncle who answers in the user's language. You answer questions knowledgeably and in a nationalistic manner. If you get a question that's hostile towards Turks, you give them a piece of your mind. You're ironic and witty. You're sincere.";

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
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    
    * {
      font-family: 'Inter', sans-serif;
    }
    
    @keyframes gradient-shift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-20px); }
    }
    
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes slide-in {
      from { opacity: 0; transform: translateX(-10px); }
      to { opacity: 1; transform: translateX(0); }
    }
    
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px rgba(147, 51, 234, 0.3); }
      50% { box-shadow: 0 0 40px rgba(147, 51, 234, 0.6); }
    }
    
    .animate-fade-in {
      animation: fade-in 0.5s ease-out;
    }
    
    .animate-slide-in {
      animation: slide-in 0.3s ease-out;
    }
    
    .animate-gradient {
      background-size: 200% 200%;
      animation: gradient-shift 8s ease infinite;
    }
    
    .animate-float {
      animation: float 6s ease-in-out infinite;
    }
    
    .animate-glow {
      animation: glow 3s ease-in-out infinite;
    }
    
    .glass-morphism {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .glass-morphism-strong {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(30px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .custom-scrollbar::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
    }
    
    .minecraft-message {
      font-family: 'Courier New', monospace;
      text-shadow: 2px 2px 0px rgba(0, 0, 0, 0.3);
    }
    
    .neon-border {
      box-shadow: 0 0 10px rgba(147, 51, 234, 0.5), 0 0 20px rgba(59, 130, 246, 0.3);
    }
    
    .hover-lift {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .hover-lift:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 30px rgba(147, 51, 234, 0.3);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script type="text/babel" data-type="module">
    const { useState, useEffect, useRef } = React;
    const socket = io();
    
    // Modern Icons as SVG components
    const Activity = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
    );
    
    const MessageSquare = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    );
    
    const Users = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    );
    
    const Zap = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    );
    
    const Settings = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6m0 6v6m8.66-15.66l-4.24 4.24M9.17 14.83l-4.24 4.24M23 12h-6m-6 0H1m19.07 7.07l-4.24-4.24M9.17 9.17L4.93 4.93"></path>
      </svg>
    );
    
    const Terminal = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>
    );
    
    const Send = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    );
    
    const Power = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
        <line x1="12" y1="2" x2="12" y2="12"></line>
      </svg>
    );
    
    const RefreshCw = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    );
    
    const Clock = () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    );
    
    const Brain = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
      </svg>
    );
    
    const Monitor = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    );

    function BotControlPanel() {
      const [activeTab, setActiveTab] = useState('minecraft');
      const [message, setMessage] = useState('');
      const [minecraftChat, setMinecraftChat] = useState([]);
      const [logs, setLogs] = useState([]);
      const [stats, setStats] = useState({
        uptime: '0h 0m',
        commands: 0,
        messages: 0,
        users: 0
      });
      const [botStatus, setBotStatus] = useState('online');
      const [settings, setSettings] = useState({
        autoReconnect: true,
        welcomeMessages: true,
        commandCooldown: 45,
        maxTokens: 100
      });
      const [gptPrompt, setGptPrompt] = useState('');
      const [promptSaved, setPromptSaved] = useState(false);
      
      const minecraftChatRef = useRef(null);
      const logsRef = useRef(null);

      useEffect(() => {
        // Fetch initial GPT prompt
        fetch('/api/gpt-prompt')
          .then(res => res.json())
          .then(data => setGptPrompt(data.prompt));

        // Socket.IO listeners
        socket.on('minecraft-chat', (data) => {
          setMinecraftChat(prev => [...prev, data].slice(-100));
          setStats(prev => ({ ...prev, messages: prev.messages + 1 }));
        });

        socket.on('bot-log', (data) => {
          setLogs(prev => [data, ...prev].slice(0, 50));
        });

        socket.on('bot-status', (status) => {
          setBotStatus(status);
        });

        socket.on('stats-update', (newStats) => {
          setStats(newStats);
        });

        return () => {
          socket.off('minecraft-chat');
          socket.off('bot-log');
          socket.off('bot-status');
          socket.off('stats-update');
        };
      }, []);

      useEffect(() => {
        if (minecraftChatRef.current) {
          minecraftChatRef.current.scrollTop = minecraftChatRef.current.scrollHeight;
        }
      }, [minecraftChat]);

      const sendMessage = async () => {
        if (!message.trim()) return;
        
        try {
          const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          if (response.ok) {
            setMessage('');
          }
        } catch (err) {
          console.error('Failed to send message:', err);
        }
      };

      const executeCommand = (cmd) => {
        fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: cmd })
        });
      };

      const saveGptPrompt = async () => {
        try {
          const response = await fetch('/api/gpt-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: gptPrompt })
          });
          
          if (response.ok) {
            setPromptSaved(true);
            setTimeout(() => setPromptSaved(false), 3000);
          }
        } catch (err) {
          console.error('Failed to save prompt:', err);
        }
      };

      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white p-4 md:p-6 overflow-hidden">
          {/* Ultra-modern animated background */}
          <div className="fixed inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float"></div>
            <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-blue-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float" style={{animationDelay: '2s'}}></div>
            <div className="absolute bottom-0 left-1/2 w-[600px] h-[600px] bg-indigo-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float" style={{animationDelay: '4s'}}></div>
          </div>

          <div className="max-w-[1800px] mx-auto relative z-10">
            {/* Ultra-modern Header */}
            <div className="mb-6 animate-fade-in">
              <div className="glass-morphism-strong rounded-3xl p-6 neon-border">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-5xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent animate-gradient mb-2">
                      RumoniumGC
                    </h1>
                    <p className="text-gray-400 font-medium">Premium Control Center v1.2.0</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="glass-morphism rounded-2xl px-6 py-3 flex items-center gap-3">
                      <div className={\`w-3 h-3 rounded-full \${botStatus === 'online' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}\`}></div>
                      <span className="text-sm font-bold uppercase tracking-wider">{botStatus}</span>
                    </div>
                    <button 
                      onClick={() => setBotStatus(botStatus === 'online' ? 'offline' : 'online')}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 px-8 py-3 rounded-2xl font-bold transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-purple-500/50 flex items-center gap-3 animate-glow"
                    >
                      <Power />
                      TOGGLE
                    </button>
                  </div>
                </div>

                {/* Modern Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { Icon: Clock, label: 'UPTIME', value: stats.uptime, gradient: 'from-purple-500 via-purple-600 to-pink-500' },
                    { Icon: Zap, label: 'COMMANDS', value: stats.commands, gradient: 'from-blue-500 via-blue-600 to-cyan-500' },
                    { Icon: MessageSquare, label: 'MESSAGES', value: stats.messages, gradient: 'from-indigo-500 via-indigo-600 to-purple-500' },
                    { Icon: Users, label: 'USERS', value: stats.users, gradient: 'from-cyan-500 via-cyan-600 to-blue-500' }
                  ].map((stat, idx) => (
                    <div 
                      key={idx}
                      className="glass-morphism rounded-2xl p-5 hover-lift group cursor-pointer"
                    >
                      <div className={\`w-14 h-14 rounded-xl bg-gradient-to-br \${stat.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform\`}>
                        <stat.Icon />
                      </div>
                      <div className="text-3xl font-black mb-1">{stat.value}</div>
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modern Navigation */}
            <div className="glass-morphism-strong rounded-3xl p-2 mb-6 flex gap-2 overflow-x-auto">
              {[
                { id: 'minecraft', Icon: Monitor, label: 'Minecraft Chat' },
                { id: 'chat', Icon: MessageSquare, label: 'Send Message' },
                { id: 'commands', Icon: Terminal, label: 'Commands' },
                { id: 'gpt', Icon: Brain, label: 'GPT Config' },
                { id: 'settings', Icon: Settings, label: 'Settings' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={\`flex-1 min-w-[140px] flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all duration-300 \${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-purple-600 to-blue-600 shadow-2xl shadow-purple-500/50 scale-105'
                      : 'hover:bg-white/5'
                  }\`}
                >
                  <tab.Icon />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-6">
                {activeTab === 'minecraft' && (
                  <div className="glass-morphism-strong rounded-3xl p-6 animate-fade-in hover-lift">
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                      <Monitor />
                      LIVE MINECRAFT CHAT
                    </h2>
                    <div 
                      ref={minecraftChatRef}
                      className="h-[500px] overflow-y-auto custom-scrollbar space-y-2 bg-black/30 rounded-2xl p-4 border border-green-500/20"
                    >
                      {minecraftChat.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          <div className="text-center">
                            <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
                            <p className="font-medium">Waiting for messages...</p>
                          </div>
                        </div>
                      ) : (
                        minecraftChat.map((msg, idx) => (
                          <div
                            key={idx}
                            className="minecraft-message text-sm bg-black/40 rounded-lg px-4 py-2 border-l-4 border-green-500/50 hover:bg-black/60 transition-colors animate-slide-in"
                          >
                            <span className="text-gray-500 text-xs mr-2">[{msg.time}]</span>
                            <span className="text-green-400 font-bold">{msg.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'chat' && (
                  <div className="glass-morphism-strong rounded-3xl p-6 animate-fade-in hover-lift">
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                      <MessageSquare />
                      SEND MESSAGE
                    </h2>
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                          placeholder="Type your message..."
                          className="flex-1 bg-black/30 border-2 border-purple-500/30 rounded-2xl px-6 py-4 focus:outline-none focus:border-purple-500 transition-all font-medium placeholder-gray-500"
                        />
                        <button
                          onClick={sendMessage}
                          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 px-8 py-4 rounded-2xl font-bold transition-all duration-300 hover:scale-105 hover:shadow-2xl flex items-center gap-2"
                        >
                          <Send />
                          SEND
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {['Hello Guild!', 'GG WP!', 'Good Game!', 'Thanks!'].map(quick => (
                          <button
                            key={quick}
                            onClick={() => setMessage(quick)}
                            className="glass-morphism hover:glass-morphism-strong rounded-xl px-4 py-3 text-sm font-bold transition-all hover:scale-105 border border-white/10 hover:border-purple-500/50"
                          >
                            {quick}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'commands' && (
                  <div className="glass-morphism-strong rounded-3xl p-6 animate-fade-in hover-lift">
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                      <Terminal />
                      QUICK COMMANDS
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { cmd: '!help', desc: 'Show help menu', color: 'from-purple-600 to-pink-600' },
                        { cmd: '!about', desc: 'Bot info', color: 'from-blue-600 to-cyan-600' },
                        { cmd: '!when', desc: 'Castle countdown', color: 'from-indigo-600 to-purple-600' },
                        { cmd: '/chat g', desc: 'Guild chat', color: 'from-cyan-600 to-blue-600' },
                        { cmd: '/locraw', desc: 'Get location', color: 'from-green-600 to-emerald-600' },
                        { cmd: '!bw Relaquent', desc: 'Check stats', color: 'from-orange-600 to-red-600' }
                      ].map(item => (
                        <button
                          key={item.cmd}
                          onClick={() => executeCommand(item.cmd)}
                          className="glass-morphism rounded-2xl p-5 text-left transition-all hover-lift group border border-white/10 hover:border-white/30"
                        >
                          <div className={\`inline-block px-3 py-1 rounded-lg bg-gradient-to-r \${item.color} font-mono font-bold text-sm mb-2\`}>
                            {item.cmd}
                          </div>
                          <div className="text-xs text-gray-400 font-medium">{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'gpt' && (
                  <div className="glass-morphism-strong rounded-3xl p-6 animate-fade-in hover-lift">
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                      <Brain />
                      GPT SYSTEM PROMPT
                    </h2>
                    <div className="space-y-4">
                      <div className="bg-black/30 rounded-2xl p-4 border border-purple-500/20">
                        <p className="text-sm text-gray-400 mb-2 font-medium">Configure how the AI responds to !ask commands:</p>
                      </div>
                      <textarea
                        value={gptPrompt}
                        onChange={(e) => setGptPrompt(e.target.value)}
                        rows="12"
                        className="w-full bg-black/30 border-2 border-purple-500/30 rounded-2xl px-6 py-4 focus:outline-none focus:border-purple-500 transition-all font-medium custom-scrollbar resize-none"
                        placeholder="Enter system prompt for GPT..."
                      />
                      <button
                        onClick={saveGptPrompt}
                        className={\`w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 px-6 py-4 rounded-2xl font-bold transition-all duration-300 hover:scale-105 hover:shadow-2xl flex items-center justify-center gap-3 \${promptSaved ? 'from-green-600 to-emerald-600' : ''}\`}
                      >
                        <Brain />
                        {promptSaved ? '✓ SAVED!' : 'SAVE PROMPT'}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="glass-morphism-strong rounded-3xl p-6 animate-fade-in hover-lift">
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                      <Settings />
                      BOT SETTINGS
                    </h2>
                    <div className="space-y-4">
                      {[
                        { key: 'autoReconnect', label: 'Auto Reconnect', desc: 'Automatically reconnect on disconnect' },
                        { key: 'welcomeMessages', label: 'Welcome Messages', desc: 'Send welcome messages to new members' }
                      ].map(setting => (
                        <div key={setting.key} className="glass-morphism rounded-2xl p-5 flex items-center justify-between border border-white/10 hover:border-purple-500/50 transition-all">
                          <div>
                            <div className="font-bold text-lg">{setting.label}</div>
                            <div className="text-sm text-gray-400 mt-1">{setting.desc}</div>
                          </div>
                          <button
                            onClick={() => setSettings({...settings, [setting.key]: !settings[setting.key]})}
                            className={\`relative w-16 h-8 rounded-full transition-all \${settings[setting.key] ? 'bg-gradient-to-r from-purple-600 to-blue-600' : 'bg-gray-700'}\`}
                          >
                            <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${settings[setting.key] ? 'translate-x-8' : ''}\`}></div>
                          </button>
                        </div>
                      ))}
                      <div className="glass-morphism rounded-2xl p-5 border border-white/10">
                        <label className="block font-bold text-lg mb-3">Command Cooldown (seconds)</label>
                        <input
                          type="number"
                          value={settings.commandCooldown}
                          onChange={(e) => setSettings({...settings, commandCooldown: parseInt(e.target.value)})}
                          className="w-full bg-black/30 border-2 border-purple-500/30 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 font-bold text-lg"
                        />
                      </div>
                      <div className="glass-morphism rounded-2xl p-5 border border-white/10">
                        <label className="block font-bold text-lg mb-3">Max GPT Tokens</label>
                        <input
                          type="number"
                          value={settings.maxTokens}
                          onChange={(e) => setSettings({...settings, maxTokens: parseInt(e.target.value)})}
                          className="w-full bg-black/30 border-2 border-purple-500/30 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 font-bold text-lg"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Logs Sidebar */}
              <div className="lg:col-span-1">
                <div className="glass-morphism-strong rounded-3xl p-6 sticky top-6 hover-lift">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black flex items-center gap-2 bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                      <Activity />
                      LIVE LOGS
                    </h2>
                    <button className="p-2 hover:bg-white/10 rounded-xl transition-all hover:scale-110">
                      <RefreshCw />
                    </button>
                  </div>
                  <div ref={logsRef} className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                    {logs.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium">No logs yet</p>
                      </div>
                    ) : (
                      logs.map((log, idx) => (
                        <div
                          key={idx}
                          className={\`glass-morphism rounded-xl p-4 text-sm animate-slide-in border \${
                            log.type === 'error' ? 'border-red-500/50 bg-red-500/10' :
                            log.type === 'success' ? 'border-green-500/50 bg-green-500/10' :
                            log.type === 'command' ? 'border-blue-500/50 bg-blue-500/10' :
                            'border-white/10'
                          }\`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-400 font-mono">{log.time}</span>
                            <span className={\`text-xs px-2 py-1 rounded-full font-bold uppercase \${
                              log.type === 'error' ? 'bg-red-500/30 text-red-300' :
                              log.type === 'success' ? 'bg-green-500/30 text-green-300' :
                              log.type === 'command' ? 'bg-blue-500/30 text-blue-300' :
                              'bg-gray-500/30 text-gray-300'
                            }\`}>
                              {log.type}
                            </span>
                          </div>
                          <div className="text-gray-200 font-medium">{log.msg}</div>
                        </div>
                      ))
                    )}
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

// API endpoint to get GPT prompt
app.get("/api/gpt-prompt", (req, res) => {
  res.json({ prompt: gptSystemPrompt });
});

// API endpoint to update GPT prompt
app.post("/api/gpt-prompt", (req, res) => {
  const { prompt } = req.body;
  if (prompt) {
    gptSystemPrompt = prompt;
    console.log("📝 GPT System Prompt updated");
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'success',
      msg: 'GPT prompt configuration updated'
    });
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false });
  }
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
let startTime = Date.now();
let commandCount = 0;
let messageCount = 0;

app.post("/chat", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).send("❌ Message required.");

  if (bot && bot.chat) {
    bot.chat(message);
    console.log(`🌐 Web chat sent: ${message}`);
    
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'info',
      msg: `Web message sent: ${message}`
    });
    
    res.json({ success: true, message: `✅ Sent: ${message}` });
  } else {
    res.status(500).json({ success: false, message: "❌ Bot not connected yet." });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('👤 Client connected to control panel');
  
  socket.on('disconnect', () => {
    console.log('👤 Client disconnected');
  });
});

// Update stats periodically
setInterval(() => {
  const uptime = Date.now() - startTime;
  const hours = Math.floor(uptime / (1000 * 60 * 60));
  const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
  
  io.emit('stats-update', {
    uptime: `${hours}h ${minutes}m`,
    commands: commandCount,
    messages: messageCount,
    users: Object.keys(bot?.players || {}).length
  });
}, 5000);

server.listen(PORT, () => {
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
    io.emit('bot-status', 'online');
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'success',
      msg: 'Bot connected to Hypixel'
    });
    
    setTimeout(() => bot.chat("/chat g"), 1500);

    setInterval(() => {
      bot.chat("/locraw");
    }, 60 * 1000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    
    // Emit all messages to web panel
    io.emit('minecraft-chat', {
      time: new Date().toLocaleTimeString(),
      message: msg
    });
    messageCount++;
    
    if (!msg.startsWith("Guild >")) return;

    // === !ask command (ChatGPT) ===
    if (msg.toLowerCase().includes("!ask")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}).*!ask\s+(.+)/i);
      if (!match) return;
      const username = match[1];
      const userMessage = match[2];

      commandCount++;

      // Cooldown check (except for Relaquent)
      if (username.toLowerCase() !== "relaquent") {
        const now = Date.now();
        const lastUsed = askCooldowns[username] || 0;
        const timePassed = now - lastUsed;

        if (timePassed < ASK_COOLDOWN_MS) {
          const secondsLeft = Math.ceil((ASK_COOLDOWN_MS - timePassed) / 1000);
          bot.chat(`${username}, you must wait ${secondsLeft}s before using "ask" command again.`);
          io.emit('bot-log', {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            msg: `Cooldown: ${username} tried !ask too soon`
          });
          return;
        }

        askCooldowns[username] = now;
      }

      bot.chat("Thinking...");
      io.emit('bot-log', {
        time: new Date().toLocaleTimeString(),
        type: 'command',
        msg: `ChatGPT request from ${username}: ${userMessage}`
      });

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: gptSystemPrompt
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
            io.emit('bot-log', {
              time: new Date().toLocaleTimeString(),
              type: 'success',
              msg: `GPT reply: ${chunk.substring(0, 50)}...`
            });
            await sleep(1000);
          }
        }

      } catch (err) {
        console.error("⚠️ OpenAI API error:", err.message);
        bot.chat("Error: Could not get response from GPT.");
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'error',
          msg: `OpenAI API error: ${err.message}`
        });
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
          io.emit('bot-log', {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            msg: `Special welcome sent to Caillou16`
          });
        } else {
          const randomMsg = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
          const finalMsg = randomMsg.replace("{username}", username);
          bot.chat(finalMsg);
          io.emit('bot-log', {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            msg: `Welcome message sent to ${username}`
          });
        }
      }
      return;
    }

    // === !bw command ===
    if (msg.toLowerCase().includes("!bw")) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];

      commandCount++;

      if (ign.toLowerCase() === "relaquent") {
        await sleep(300);
        const specialMsg = "Relaquent | Star: 3628 | FKDR: 48.72 | KD: 2.32 | WL: 2.86";
        bot.chat(specialMsg);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!bw command executed for ${ign}`
        });
        return;
      }

      await sleep(300);
      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`;
        bot.chat(line);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!bw command executed for ${ign}`
        });
      } catch (err) {
        bot.chat(`Error - ${ign} | No data found.`);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'error',
          msg: `!bw error for ${ign}: ${err.message}`
        });
      }
      return;
    }

    // === !stats command ===
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      
      commandCount++;
      await sleep(300);

      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins} | Beds: ${stats.beds}`;
        bot.chat(line);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!stats command executed for ${ign}`
        });
      } catch (err) {
        bot.chat(`Error - ${ign} | No data found.`);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'error',
          msg: `!stats error for ${ign}: ${err.message}`
        });
      }
      return;
    }

    // === !ping command ===
    if (msg.toLowerCase().includes("!ping")) {
      const match = msg.match(/!ping\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      
      commandCount++;
      await sleep(300);

      const playerObj = bot.players[ign];
      if (playerObj && typeof playerObj.ping === "number") {
        const line = `RumoGC - ${ign}: ${playerObj.ping}ms`;
        bot.chat(line);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!ping command executed for ${ign}`
        });
      } else {
        const line = `Error - ${ign}: I can only check my ping for now.`;
        bot.chat(line);
      }
      return;
    }

    // === !when command (Castle countdown) ===
    if (msg.toLowerCase().includes("!when")) {
      commandCount++;
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
      io.emit('bot-log', {
        time: new Date().toLocaleTimeString(),
        type: 'command',
        msg: `!when command executed`
      });
      return;
    }

    // === !about command ===
    if (msg.toLowerCase().includes("!about")) {
      commandCount++;
      await sleep(300);
      const aboutMsg = "RumoniumGC is automated by Relaquent, v1.2.0 - Last Update 15/11/25";
      bot.chat(aboutMsg);
      io.emit('bot-log', {
        time: new Date().toLocaleTimeString(),
        type: 'command',
        msg: `!about command executed`
      });
      return;
    }

    // === !help command ===
    if (msg.toLowerCase().includes("!help")) {
      commandCount++;
      await sleep(300);
      const helpMsg = [
        "----- RumoniumGC v1.2.0 -----",
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
      io.emit('bot-log', {
        time: new Date().toLocaleTimeString(),
        type: 'command',
        msg: `!help command executed`
      });
      return;
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Kicked from server:", reason);
    io.emit('bot-status', 'offline');
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'error',
      msg: `Kicked from server: ${reason}`
    });
    setTimeout(createBot, 10000);
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected, reconnecting...");
    io.emit('bot-status', 'offline');
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'info',
      msg: 'Disconnected, reconnecting in 10s...'
    });
    setTimeout(createBot, 10000);
  });
}

// === 6. Start Bot ===
createBot();
