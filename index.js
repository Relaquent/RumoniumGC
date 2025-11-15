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

// Store chat messages, settings, and theme
let chatHistory = [];
let gptSystemPrompt = "You're like a uncle who answers in the user's language. You answer questions knowledgeably and in a nationalistic manner. If you get a question that's hostile towards Turks, you give them a piece of your mind. You're ironic and witty. You're sincere.";
let panelTheme = {
  primaryColor: '#9333ea',
  secondaryColor: '#3b82f6',
  accentColor: '#ec4899',
  bgStyle: 'gradient',
  glassEffect: true,
  animations: true
};

// Enhanced bot settings
let botSettings = {
  autoReconnect: true,
  welcomeMessages: true,
  commandCooldown: 45,
  maxTokens: 100,
  chatFilter: {
    enabled: false,
    keywords: [],
    filterMode: 'blacklist' // blacklist or whitelist
  },
  autoResponses: {
    enabled: true,
    responses: [
      { trigger: 'hello', response: 'Hey there!', delay: 1000 },
      { trigger: 'gg', response: 'Good game!', delay: 500 }
    ]
  },
  customCommands: [
    { name: '!discord', response: 'Join our Discord: discord.gg/example', cooldown: 30 },
    { name: '!rules', response: 'Check guild rules at: rumoniumgc.com/rules', cooldown: 60 }
  ],
  chatLogs: {
    enabled: true,
    maxHistory: 500,
    saveToFile: false
  },
  notifications: {
    onJoin: true,
    onLeave: true,
    onCommand: true,
    soundEnabled: false
  },
  performance: {
    messageDelay: 300,
    maxMessagesPerSecond: 2,
    autoReconnectDelay: 10000
  }
};

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
  <title>RumoniumGC Premium Control Panel v2.0</title>
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
    
    @keyframes slide-up {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px rgba(147, 51, 234, 0.3); }
      50% { box-shadow: 0 0 40px rgba(147, 51, 234, 0.6); }
    }

    @keyframes pulse-ring {
      0% { transform: scale(0.95); opacity: 1; }
      100% { transform: scale(1.4); opacity: 0; }
    }
    
    .animate-fade-in {
      animation: fade-in 0.5s ease-out;
    }
    
    .animate-slide-in {
      animation: slide-in 0.3s ease-out;
    }
    
    .animate-slide-up {
      animation: slide-up 0.3s ease-out;
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

    .pulse-ring {
      animation: pulse-ring 2s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite;
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
    
    .chat-input-container {
      position: sticky;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .chat-bubble {
      position: relative;
      overflow: hidden;
    }

    .chat-bubble::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      transition: left 0.5s;
    }

    .chat-bubble:hover::before {
      left: 100%;
    }

    .setting-card {
      transition: all 0.3s ease;
    }

    .setting-card:hover {
      transform: translateX(5px);
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
    
    const Palette = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r=".5"></circle>
        <circle cx="17.5" cy="10.5" r=".5"></circle>
        <circle cx="8.5" cy="7.5" r=".5"></circle>
        <circle cx="6.5" cy="12.5" r=".5"></circle>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
      </svg>
    );

    const Filter = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
      </svg>
    );

    const Command = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"></path>
      </svg>
    );

    const Bell = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
    );

    const Sliders = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="21" x2="4" y2="14"></line>
        <line x1="4" y1="10" x2="4" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12" y2="3"></line>
        <line x1="20" y1="21" x2="20" y2="16"></line>
        <line x1="20" y1="12" x2="20" y2="3"></line>
        <line x1="1" y1="14" x2="7" y2="14"></line>
        <line x1="9" y1="8" x2="15" y2="8"></line>
        <line x1="17" y1="16" x2="23" y2="16"></line>
      </svg>
    );

    const Plus = () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    );

    const Trash = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    );

    const Search = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
      </svg>
    );

    const Download = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    );

    function BotControlPanel() {
      const [activeTab, setActiveTab] = useState('chat');
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
        maxTokens: 100,
        chatFilter: {
          enabled: false,
          keywords: [],
          filterMode: 'blacklist'
        },
        autoResponses: {
          enabled: true,
          responses: []
        },
        customCommands: [],
        chatLogs: {
          enabled: true,
          maxHistory: 500,
          saveToFile: false
        },
        notifications: {
          onJoin: true,
          onLeave: true,
          onCommand: true,
          soundEnabled: false
        },
        performance: {
          messageDelay: 300,
          maxMessagesPerSecond: 2,
          autoReconnectDelay: 10000
        }
      });
      const [gptPrompt, setGptPrompt] = useState('');
      const [promptSaved, setPromptSaved] = useState(false);
      const [theme, setTheme] = useState({
        primaryColor: '#9333ea',
        secondaryColor: '#3b82f6',
        accentColor: '#ec4899',
        bgStyle: 'gradient',
        glassEffect: true,
        animations: true
      });
      const [themeSaved, setThemeSaved] = useState(false);
      const [settingsSaved, setSettingsSaved] = useState(false);
      const [chatSearch, setChatSearch] = useState('');
      const [filterActive, setFilterActive] = useState(false);
      
      const minecraftChatRef = useRef(null);
      const logsRef = useRef(null);

      useEffect(() => {
        // Fetch initial data
        fetch('/api/gpt-prompt')
          .then(res => res.json())
          .then(data => setGptPrompt(data.prompt));

        fetch('/api/theme')
          .then(res => res.json())
          .then(data => setTheme(data));

        fetch('/api/settings')
          .then(res => res.json())
          .then(data => setSettings(data));

        // Socket.IO listeners
        socket.on('minecraft-chat', (data) => {
          setMinecraftChat(prev => [...prev, data].slice(-500));
          setStats(prev => ({ ...prev, messages: prev.messages + 1 }));
        });

        socket.on('bot-log', (data) => {
          setLogs(prev => [data, ...prev].slice(0, 100));
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

      const saveTheme = async () => {
        try {
          const response = await fetch('/api/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(theme)
          });
          
          if (response.ok) {
            setThemeSaved(true);
            setTimeout(() => {
              setThemeSaved(false);
              window.location.reload();
            }, 1500);
          }
        } catch (err) {
          console.error('Failed to save theme:', err);
        }
      };

      const saveSettings = async () => {
        try {
          const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
          });
          
          if (response.ok) {
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 3000);
          }
        } catch (err) {
          console.error('Failed to save settings:', err);
        }
      };

      const exportChatLogs = () => {
        const dataStr = JSON.stringify(minecraftChat, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = \`chat-logs-\${new Date().toISOString()}.json\`;
        link.click();
      };

      const addCustomCommand = () => {
        setSettings({
          ...settings,
          customCommands: [...settings.customCommands, { name: '!newcmd', response: 'Response', cooldown: 30 }]
        });
      };

      const removeCustomCommand = (index) => {
        setSettings({
          ...settings,
          customCommands: settings.customCommands.filter((_, i) => i !== index)
        });
      };

      const updateCustomCommand = (index, field, value) => {
        const updated = [...settings.customCommands];
        updated[index][field] = value;
        setSettings({ ...settings, customCommands: updated });
      };

      const addFilterKeyword = () => {
        setSettings({
          ...settings,
          chatFilter: {
            ...settings.chatFilter,
            keywords: [...settings.chatFilter.keywords, '']
          }
        });
      };

      const removeFilterKeyword = (index) => {
        setSettings({
          ...settings,
          chatFilter: {
            ...settings.chatFilter,
            keywords: settings.chatFilter.keywords.filter((_, i) => i !== index)
          }
        });
      };

      const updateFilterKeyword = (index, value) => {
        const updated = [...settings.chatFilter.keywords];
        updated[index] = value;
        setSettings({
          ...settings,
          chatFilter: { ...settings.chatFilter, keywords: updated }
        });
      };

      const addAutoResponse = () => {
        setSettings({
          ...settings,
          autoResponses: {
            ...settings.autoResponses,
            responses: [...settings.autoResponses.responses, { trigger: '', response: '', delay: 1000 }]
          }
        });
      };

      const removeAutoResponse = (index) => {
        setSettings({
          ...settings,
          autoResponses: {
            ...settings.autoResponses,
            responses: settings.autoResponses.responses.filter((_, i) => i !== index)
          }
        });
      };

      const updateAutoResponse = (index, field, value) => {
        const updated = [...settings.autoResponses.responses];
        updated[index][field] = value;
        setSettings({
          ...settings,
          autoResponses: { ...settings.autoResponses, responses: updated }
        });
      };

      const filteredChat = minecraftChat.filter(msg => 
        !chatSearch || msg.message.toLowerCase().includes(chatSearch.toLowerCase())
      );

      const themePresets = [
        { name: 'Purple Dream', primary: '#9333ea', secondary: '#3b82f6', accent: '#ec4899' },
        { name: 'Ocean Blue', primary: '#0ea5e9', secondary: '#06b6d4', accent: '#14b8a6' },
        { name: 'Sunset Orange', primary: '#f97316', secondary: '#ef4444', accent: '#ec4899' },
        { name: 'Forest Green', primary: '#10b981', secondary: '#059669', accent: '#84cc16' },
        { name: 'Royal Purple', primary: '#7c3aed', secondary: '#8b5cf6', accent: '#a78bfa' },
        { name: 'Crimson Red', primary: '#dc2626', secondary: '#b91c1c', accent: '#f87171' }
      ];

      return (
        <div className={\`min-h-screen text-white p-4 md:p-6 overflow-hidden \${
          theme.bgStyle === 'gradient' ? 'bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950' :
          theme.bgStyle === 'solid' ? 'bg-slate-950' : 'bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950'
        }\`}>
          {/* Animated background effects */}
          {theme.animations && (
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float" style={{backgroundColor: theme.primaryColor}}></div>
              <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float" style={{backgroundColor: theme.secondaryColor, animationDelay: '2s'}}></div>
              <div className="absolute bottom-0 left-1/2 w-[600px] h-[600px] rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-float" style={{backgroundColor: theme.accentColor, animationDelay: '4s'}}></div>
            </div>
          )}

          <div className="max-w-[1800px] mx-auto relative z-10">
            {/* Ultra-modern Header */}
            <div className="mb-6 animate-fade-in">
              <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 neon-border\`}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className={\`text-5xl font-black bg-clip-text text-transparent \${theme.animations ? 'animate-gradient' : ''}\`} style={{backgroundImage: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.accentColor}, \${theme.secondaryColor})\`, backgroundSize: '200% 200%'}}>
                      RumoniumGC
                    </h1>
                    <p className="text-gray-400 font-medium">Premium Control Center v2.0</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl px-6 py-3 flex items-center gap-3\`}>
                      <div className="relative">
                        <div className={\`w-3 h-3 rounded-full \${botStatus === 'online' ? 'bg-green-400' : 'bg-red-400'}\`}></div>
                        {botStatus === 'online' && (
                          <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 pulse-ring"></div>
                        )}
                      </div>
                      <span className="text-sm font-bold uppercase tracking-wider">{botStatus}</span>
                    </div>
                    <button 
                      onClick={() => setBotStatus(botStatus === 'online' ? 'offline' : 'online')}
                      className={\`px-8 py-3 rounded-2xl font-bold transition-all duration-300 flex items-center gap-3 \${theme.animations ? 'hover:scale-105 animate-glow' : ''}\`}
                      style={{background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                    >
                      <Power />
                      TOGGLE
                    </button>
                  </div>
                </div>

                {/* Modern Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { Icon: Clock, label: 'UPTIME', value: stats.uptime, gradient: \`linear-gradient(to bottom right, \${theme.primaryColor}, \${theme.accentColor})\` },
                    { Icon: Zap, label: 'COMMANDS', value: stats.commands, gradient: \`linear-gradient(to bottom right, \${theme.secondaryColor}, \${theme.primaryColor})\` },
                    { Icon: MessageSquare, label: 'MESSAGES', value: stats.messages, gradient: \`linear-gradient(to bottom right, \${theme.accentColor}, \${theme.primaryColor})\` },
                    { Icon: Users, label: 'USERS', value: stats.users, gradient: \`linear-gradient(to bottom right, \${theme.secondaryColor}, \${theme.accentColor})\` }
                  ].map((stat, idx) => (
                    <div 
                      key={idx}
                      className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 \${theme.animations ? 'hover-lift' : ''} group cursor-pointer\`}
                    >
                      <div className={\`w-14 h-14 rounded-xl flex items-center justify-center mb-4 \${theme.animations ? 'group-hover:scale-110' : ''} transition-transform\`} style={{background: stat.gradient}}>
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
            <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-2 mb-6 flex gap-2 overflow-x-auto\`}>
              {[
                { id: 'chat', Icon: Monitor, label: 'Live Chat' },
                { id: 'commands', Icon: Terminal, label: 'Commands' },
                { id: 'gpt', Icon: Brain, label: 'GPT Config' },
                { id: 'advanced', Icon: Sliders, label: 'Advanced' },
                { id: 'customize', Icon: Palette, label: 'Customize' },
                { id: 'settings', Icon: Settings, label: 'Settings' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={\`flex-1 min-w-[120px] flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all duration-300 \${
                    activeTab === tab.id
                      ? ''
                      : 'hover:bg-white/5'
                  }\`}
                  style={activeTab === tab.id ? {background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`, boxShadow: \`0 20px 60px \${theme.primaryColor}50\`} : {}}
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
                {activeTab === 'chat' && (
                  <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl overflow-hidden animate-fade-in \${theme.animations ? 'hover-lift' : ''}\`}>
                    <div className="p-6 border-b border-white/10">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-black flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, #10b981, #059669)\`}}>
                          <Monitor />
                          LIVE MINECRAFT CHAT
                        </h2>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setFilterActive(!filterActive)}
                            className={\`p-3 rounded-xl transition-all \${filterActive ? 'bg-green-500/20 text-green-400' : 'bg-white/5'} \${theme.animations ? 'hover:scale-110' : ''}\`}
                          >
                            <Filter />
                          </button>
                          <button
                            onClick={exportChatLogs}
                            className={\`p-3 rounded-xl bg-white/5 transition-all \${theme.animations ? 'hover:scale-110' : ''}\`}
                          >
                            <Download />
                          </button>
                        </div>
                      </div>
                      
                      {/* Search Bar */}
                      <div className="relative">
                        <input
                          type="text"
                          value={chatSearch}
                          onChange={(e) => setChatSearch(e.target.value)}
                          placeholder="Search messages..."
                          className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 pl-12 focus:outline-none transition-all font-medium placeholder-gray-500"
                          style={{borderColor: \`\${theme.primaryColor}30\`}}
                        />
                        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                          <Search />
                        </div>
                      </div>
                    </div>
                    
                    {/* Chat Display */}
                    <div 
                      ref={minecraftChatRef}
                      className="h-[450px] overflow-y-auto custom-scrollbar space-y-2 bg-black/30 p-4"
                    >
                      {filteredChat.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          <div className="text-center">
                            <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
                            <p className="font-medium">{chatSearch ? 'No messages found' : 'Waiting for messages...'}</p>
                          </div>
                        </div>
                      ) : (
                        filteredChat.map((msg, idx) => {
                          const isCommand = msg.message.includes('!');
                          const isJoin = msg.message.includes('joined');
                          const isLeave = msg.message.includes('left');
                          
                          return (
                            <div
                              key={idx}
                              className={\`chat-bubble minecraft-message text-sm rounded-xl px-4 py-3 border-l-4 transition-all \${
                                isCommand ? 'bg-blue-500/10 border-blue-500/50 hover:bg-blue-500/20' :
                                isJoin ? 'bg-green-500/10 border-green-500/50 hover:bg-green-500/20' :
                                isLeave ? 'bg-red-500/10 border-red-500/50 hover:bg-red-500/20' :
                                'bg-black/40 border-purple-500/30 hover:bg-black/60'
                              } \${theme.animations ? 'animate-slide-up' : ''}\`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-gray-500 text-xs mr-2">[{msg.time}]</span>
                                  <span className="text-green-400 font-bold">{msg.message}</span>
                                </div>
                                {isCommand && <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full">CMD</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Chat Input - Sticky at bottom */}
                    <div className="chat-input-container p-4">
                      <div className="space-y-3">
                        <div className="flex gap-3">
                          <input
                            type="text"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            placeholder="Type your message..."
                            className="flex-1 bg-black/30 border-2 rounded-2xl px-6 py-4 focus:outline-none transition-all font-medium placeholder-gray-500"
                            style={{borderColor: \`\${theme.primaryColor}30\`}}
                          />
                          <button
                            onClick={sendMessage}
                            className={\`px-8 py-4 rounded-2xl font-bold transition-all duration-300 flex items-center gap-2 \${theme.animations ? 'hover:scale-105' : ''}\`}
                            style={{background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                          >
                            <Send />
                            SEND
                          </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {['Hello Guild!', 'GG WP!', 'Good Game!', 'Thanks!'].map(quick => (
                            <button
                              key={quick}
                              onClick={() => setMessage(quick)}
                              className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-xl px-4 py-2 text-sm font-bold transition-all border border-white/10 \${theme.animations ? 'hover:scale-105' : ''}\`}
                            >
                              {quick}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'commands' && (
                  <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 animate-fade-in \${theme.animations ? 'hover-lift' : ''}\`}>
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.accentColor})\`}}>
                      <Terminal />
                      QUICK COMMANDS
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { cmd: '!help', desc: 'Show help menu', color: theme.primaryColor },
                        { cmd: '!about', desc: 'Bot info', color: theme.secondaryColor },
                        { cmd: '!when', desc: 'Castle countdown', color: theme.accentColor },
                        { cmd: '/chat g', desc: 'Guild chat', color: theme.primaryColor },
                        { cmd: '/locraw', desc: 'Get location', color: theme.secondaryColor },
                        { cmd: '!bw Relaquent', desc: 'Check stats', color: theme.accentColor }
                      ].map(item => (
                        <button
                          key={item.cmd}
                          onClick={() => executeCommand(item.cmd)}
                          className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 text-left transition-all group border border-white/10 \${theme.animations ? 'hover-lift' : ''}\`}
                        >
                          <div className="inline-block px-3 py-1 rounded-lg font-mono font-bold text-sm mb-2" style={{backgroundColor: \`\${item.color}40\`, color: item.color}}>
                            {item.cmd}
                          </div>
                          <div className="text-xs text-gray-400 font-medium">{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'gpt' && (
                  <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 animate-fade-in \${theme.animations ? 'hover-lift' : ''}\`}>
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.accentColor}, \${theme.primaryColor})\`}}>
                      <Brain />
                      GPT SYSTEM PROMPT
                    </h2>
                    <div className="space-y-4">
                      <div className="bg-black/30 rounded-2xl p-4 border" style={{borderColor: \`\${theme.primaryColor}20\`}}>
                        <p className="text-sm text-gray-400 mb-2 font-medium">Configure how the AI responds to !ask commands:</p>
                      </div>
                      <textarea
                        value={gptPrompt}
                        onChange={(e) => setGptPrompt(e.target.value)}
                        rows="12"
                        className="w-full bg-black/30 border-2 rounded-2xl px-6 py-4 focus:outline-none transition-all font-medium custom-scrollbar resize-none"
                        style={{borderColor: \`\${theme.primaryColor}30\`}}
                        placeholder="Enter system prompt for GPT..."
                      />
                      <button
                        onClick={saveGptPrompt}
                        className={\`w-full px-6 py-4 rounded-2xl font-bold transition-all duration-300 flex items-center justify-center gap-3 \${theme.animations ? 'hover:scale-105' : ''}\`}
                        style={{background: promptSaved ? 'linear-gradient(to right, #10b981, #059669)' : \`linear-gradient(to right, \${theme.accentColor}, \${theme.primaryColor})\`}}
                      >
                        <Brain />
                        {promptSaved ? '✓ SAVED!' : 'SAVE PROMPT'}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'advanced' && (
                  <div className="space-y-6 animate-fade-in">
                    {/* Chat Filter */}
                    <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 \${theme.animations ? 'hover-lift' : ''}\`}>
                      <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}>
                        <Filter />
                        CHAT FILTER
                      </h2>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-lg">Enable Filter</div>
                            <div className="text-sm text-gray-400 mt-1">Filter messages by keywords</div>
                          </div>
                          <button
                            onClick={() => setSettings({...settings, chatFilter: {...settings.chatFilter, enabled: !settings.chatFilter.enabled}})}
                            className="relative w-16 h-8 rounded-full transition-all"
                            style={{backgroundColor: settings.chatFilter.enabled ? theme.primaryColor : '#374151'}}
                          >
                            <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${settings.chatFilter.enabled ? 'translate-x-8' : ''}\`}></div>
                          </button>
                        </div>

                        <div>
                          <label className="block font-bold text-lg mb-3">Filter Mode</label>
                          <div className="grid grid-cols-2 gap-3">
                            {['blacklist', 'whitelist'].map(mode => (
                              <button
                                key={mode}
                                onClick={() => setSettings({...settings, chatFilter: {...settings.chatFilter, filterMode: mode}})}
                                className={\`px-4 py-3 rounded-xl font-bold transition-all capitalize \${settings.chatFilter.filterMode === mode ? '' : 'bg-white/5'}\`}
                                style={settings.chatFilter.filterMode === mode ? {background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`} : {}}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <label className="block font-bold text-lg">Keywords</label>
                            <button
                              onClick={addFilterKeyword}
                              className={\`p-2 rounded-xl transition-all \${theme.animations ? 'hover:scale-110' : ''}\`}
                              style={{background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                            >
                              <Plus />
                            </button>
                          </div>
                          <div className="space-y-2">
                            {settings.chatFilter.keywords.map((keyword, index) => (
                              <div key={index} className="flex gap-2">
                                <input
                                  type="text"
                                  value={keyword}
                                  onChange={(e) => updateFilterKeyword(index, e.target.value)}
                                  placeholder="Enter keyword..."
                                  className="flex-1 bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-medium"
                                  style={{borderColor: \`\${theme.primaryColor}30\`}}
                                />
                                <button
                                  onClick={() => removeFilterKeyword(index)}
                                  className="p-3 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                                >
                                  <Trash />
                                </button>
                              </div>
                            ))}
                            {settings.chatFilter.keywords.length === 0 && (
                              <div className="text-center py-6 text-gray-500">
                                <p className="text-sm">No keywords added</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Custom Commands */}
                    <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 \${theme.animations ? 'hover-lift' : ''}\`}>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-black flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.secondaryColor}, \${theme.accentColor})\`}}>
                          <Command />
                          CUSTOM COMMANDS
                        </h2>
                        <button
                          onClick={addCustomCommand}
                          className={\`p-3 rounded-xl transition-all \${theme.animations ? 'hover:scale-110' : ''}\`}
                          style={{background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                        >
                          <Plus />
                        </button>
                      </div>
                      <div className="space-y-3">
                        {settings.customCommands.map((cmd, index) => (
                          <div key={index} className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-4 border border-white/10 space-y-3\`}>
                            <div className="flex items-center justify-between">
                              <div className="font-bold text-lg">Command #{index + 1}</div>
                              <button
                                onClick={() => removeCustomCommand(index)}
                                className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                              >
                                <Trash />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={cmd.name}
                              onChange={(e) => updateCustomCommand(index, 'name', e.target.value)}
                              placeholder="Command name (e.g., !mycommand)"
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-medium"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                            <textarea
                              value={cmd.response}
                              onChange={(e) => updateCustomCommand(index, 'response', e.target.value)}
                              placeholder="Response message"
                              rows="3"
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-medium custom-scrollbar resize-none"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                            <div>
                              <label className="block text-sm font-bold mb-2">Cooldown (seconds)</label>
                              <input
                                type="number"
                                value={cmd.cooldown}
                                onChange={(e) => updateCustomCommand(index, 'cooldown', parseInt(e.target.value) || 0)}
                                className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-bold"
                                style={{borderColor: \`\${theme.primaryColor}30\`}}
                              />
                            </div>
                          </div>
                        ))}
                        {settings.customCommands.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            <Command className="w-16 h-16 mx-auto mb-4 opacity-30" />
                            <p className="font-medium">No custom commands yet</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Auto Responses */}
                    <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 \${theme.animations ? 'hover-lift' : ''}\`}>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-black flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.accentColor}, \${theme.secondaryColor})\`}}>
                          <Zap />
                          AUTO RESPONSES
                        </h2>
                        <button
                          onClick={addAutoResponse}
                          className={\`p-3 rounded-xl transition-all \${theme.animations ? 'hover:scale-110' : ''}\`}
                          style={{background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                        >
                          <Plus />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mb-4 bg-black/30 rounded-2xl p-4">
                        <div>
                          <div className="font-bold text-lg">Enable Auto Responses</div>
                          <div className="text-sm text-gray-400 mt-1">Automatically reply to triggers</div>
                        </div>
                        <button
                          onClick={() => setSettings({...settings, autoResponses: {...settings.autoResponses, enabled: !settings.autoResponses.enabled}})}
                          className="relative w-16 h-8 rounded-full transition-all"
                          style={{backgroundColor: settings.autoResponses.enabled ? theme.primaryColor : '#374151'}}
                        >
                          <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${settings.autoResponses.enabled ? 'translate-x-8' : ''}\`}></div>
                        </button>
                      </div>
                      <div className="space-y-3">
                        {settings.autoResponses.responses.map((resp, index) => (
                          <div key={index} className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-4 border border-white/10 space-y-3\`}>
                            <div className="flex items-center justify-between">
                              <div className="font-bold text-lg">Response #{index + 1}</div>
                              <button
                                onClick={() => removeAutoResponse(index)}
                                className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                              >
                                <Trash />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={resp.trigger}
                              onChange={(e) => updateAutoResponse(index, 'trigger', e.target.value)}
                              placeholder="Trigger word"
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-medium"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                            <input
                              type="text"
                              value={resp.response}
                              onChange={(e) => updateAutoResponse(index, 'response', e.target.value)}
                              placeholder="Auto response"
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-medium"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                            <div>
                              <label className="block text-sm font-bold mb-2">Delay (ms)</label>
                              <input
                                type="number"
                                value={resp.delay}
                                onChange={(e) => updateAutoResponse(index, 'delay', parseInt(e.target.value) || 0)}
                                className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-bold"
                                style={{borderColor: \`\${theme.primaryColor}30\`}}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Save Button */}
                    <button
                      onClick={saveSettings}
                      className={\`w-full px-6 py-4 rounded-2xl font-bold transition-all duration-300 flex items-center justify-center gap-3 \${theme.animations ? 'hover:scale-105' : ''}\`}
                      style={{background: settingsSaved ? 'linear-gradient(to right, #10b981, #059669)' : \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                    >
                      <Settings />
                      {settingsSaved ? '✓ SETTINGS SAVED!' : 'SAVE ALL SETTINGS'}
                    </button>
                  </div>
                )}

                {activeTab === 'customize' && (
                  <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 animate-fade-in \${theme.animations ? 'hover-lift' : ''}\`}>
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}>
                      <Palette />
                      CUSTOMIZE PANEL
                    </h2>
                    <div className="space-y-6">
                      {/* Theme Presets */}
                      <div>
                        <label className="block font-bold text-lg mb-3">Quick Presets</label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {themePresets.map(preset => (
                            <button
                              key={preset.name}
                              onClick={() => setTheme({...theme, primaryColor: preset.primary, secondaryColor: preset.secondary, accentColor: preset.accent})}
                              className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-xl p-4 text-left transition-all border border-white/10 \${theme.animations ? 'hover:scale-105' : ''}\`}
                            >
                              <div className="flex gap-2 mb-2">
                                <div className="w-6 h-6 rounded-full" style={{backgroundColor: preset.primary}}></div>
                                <div className="w-6 h-6 rounded-full" style={{backgroundColor: preset.secondary}}></div>
                                <div className="w-6 h-6 rounded-full" style={{backgroundColor: preset.accent}}></div>
                              </div>
                              <div className="font-bold text-sm">{preset.name}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Color Pickers */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-4 border border-white/10\`}>
                          <label className="block font-bold text-sm mb-3">Primary Color</label>
                          <input
                            type="color"
                            value={theme.primaryColor}
                            onChange={(e) => setTheme({...theme, primaryColor: e.target.value})}
                            className="w-full h-16 rounded-xl cursor-pointer"
                          />
                        </div>
                        <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-4 border border-white/10\`}>
                          <label className="block font-bold text-sm mb-3">Secondary Color</label>
                          <input
                            type="color"
                            value={theme.secondaryColor}
                            onChange={(e) => setTheme({...theme, secondaryColor: e.target.value})}
                            className="w-full h-16 rounded-xl cursor-pointer"
                          />
                        </div>
                        <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-4 border border-white/10\`}>
                          <label className="block font-bold text-sm mb-3">Accent Color</label>
                          <input
                            type="color"
                            value={theme.accentColor}
                            onChange={(e) => setTheme({...theme, accentColor: e.target.value})}
                            className="w-full h-16 rounded-xl cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Background Style */}
                      <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <label className="block font-bold text-lg mb-3">Background Style</label>
                        <div className="grid grid-cols-3 gap-3">
                          {['gradient', 'solid', 'animated'].map(style => (
                            <button
                              key={style}
                              onClick={() => setTheme({...theme, bgStyle: style})}
                              className={\`px-4 py-3 rounded-xl font-bold transition-all capitalize \${theme.bgStyle === style ? '' : 'bg-white/5'}\`}
                              style={theme.bgStyle === style ? {background: \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`} : {}}
                            >
                              {style}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Toggle Options */}
                      <div className="space-y-3">
                        <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 flex items-center justify-between border border-white/10\`}>
                          <div>
                            <div className="font-bold text-lg">Glass Effect</div>
                            <div className="text-sm text-gray-400 mt-1">Frosted glass morphism</div>
                          </div>
                          <button
                            onClick={() => setTheme({...theme, glassEffect: !theme.glassEffect})}
                            className={\`relative w-16 h-8 rounded-full transition-all\`}
                            style={{backgroundColor: theme.glassEffect ? theme.primaryColor : '#374151'}}
                          >
                            <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${theme.glassEffect ? 'translate-x-8' : ''}\`}></div>
                          </button>
                        </div>

                        <div className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 flex items-center justify-between border border-white/10\`}>
                          <div>
                            <div className="font-bold text-lg">Animations</div>
                            <div className="text-sm text-gray-400 mt-1">Enable smooth animations</div>
                          </div>
                          <button
                            onClick={() => setTheme({...theme, animations: !theme.animations})}
                            className={\`relative w-16 h-8 rounded-full transition-all\`}
                            style={{backgroundColor: theme.animations ? theme.primaryColor : '#374151'}}
                          >
                            <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${theme.animations ? 'translate-x-8' : ''}\`}></div>
                          </button>
                        </div>
                      </div>

                      {/* Save Button */}
                      <button
                        onClick={saveTheme}
                        className={\`w-full px-6 py-4 rounded-2xl font-bold transition-all duration-300 flex items-center justify-center gap-3 \${theme.animations ? 'hover:scale-105' : ''}\`}
                        style={{background: themeSaved ? 'linear-gradient(to right, #10b981, #059669)' : \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                      >
                        <Palette />
                        {themeSaved ? '✓ SAVED! RELOADING...' : 'SAVE & APPLY THEME'}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 animate-fade-in \${theme.animations ? 'hover-lift' : ''}\`}>
                    <h2 className="text-2xl font-black mb-4 flex items-center gap-3 bg-clip-text text-transparent" style={{backgroundImage: \`linear-gradient(to right, \${theme.secondaryColor}, \${theme.primaryColor})\`}}>
                      <Settings />
                      BOT SETTINGS
                    </h2>
                    <div className="space-y-4">
                      {[
                        { key: 'autoReconnect', label: 'Auto Reconnect', desc: 'Automatically reconnect on disconnect' },
                        { key: 'welcomeMessages', label: 'Welcome Messages', desc: 'Send welcome messages to new members' }
                      ].map(setting => (
                        <div key={setting.key} className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 flex items-center justify-between border border-white/10\`}>
                          <div>
                            <div className="font-bold text-lg">{setting.label}</div>
                            <div className="text-sm text-gray-400 mt-1">{setting.desc}</div>
                          </div>
                          <button
                            onClick={() => setSettings({...settings, [setting.key]: !settings[setting.key]})}
                            className="relative w-16 h-8 rounded-full transition-all"
                            style={{backgroundColor: settings[setting.key] ? theme.primaryColor : '#374151'}}
                          >
                            <div className={\`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform shadow-lg \${settings[setting.key] ? 'translate-x-8' : ''}\`}></div>
                          </button>
                        </div>
                      ))}
                      
                      <div className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <label className="block font-bold text-lg mb-3">Command Cooldown (seconds)</label>
                        <input
                          type="number"
                          value={settings.commandCooldown}
                          onChange={(e) => setSettings({...settings, commandCooldown: parseInt(e.target.value)})}
                          className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-bold text-lg"
                          style={{borderColor: \`\${theme.primaryColor}30\`}}
                        />
                      </div>
                      
                      <div className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <label className="block font-bold text-lg mb-3">Max GPT Tokens</label>
                        <input
                          type="number"
                          value={settings.maxTokens}
                          onChange={(e) => setSettings({...settings, maxTokens: parseInt(e.target.value)})}
                          className="w-full bg-black/30 border-2 rounded-xl px-4 py-3 focus:outline-none font-bold text-lg"
                          style={{borderColor: \`\${theme.primaryColor}30\`}}
                        />
                      </div>

                      {/* Notifications */}
                      <div className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                          <Bell />
                          Notifications
                        </h3>
                        <div className="space-y-3">
                          {[
                            { key: 'onJoin', label: 'On Player Join' },
                            { key: 'onLeave', label: 'On Player Leave' },
                            { key: 'onCommand', label: 'On Command Use' },
                            { key: 'soundEnabled', label: 'Sound Alerts' }
                          ].map(notif => (
                            <div key={notif.key} className="flex items-center justify-between bg-black/30 rounded-xl p-3">
                              <span className="font-medium">{notif.label}</span>
                              <button
                                onClick={() => setSettings({...settings, notifications: {...settings.notifications, [notif.key]: !settings.notifications[notif.key]}})}
                                className="relative w-12 h-6 rounded-full transition-all"
                                style={{backgroundColor: settings.notifications[notif.key] ? theme.primaryColor : '#374151'}}
                              >
                                <div className={\`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-lg \${settings.notifications[notif.key] ? 'translate-x-6' : ''}\`}></div>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Performance */}
                      <div className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                          <Sliders />
                          Performance
                        </h3>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-bold mb-2">Message Delay (ms)</label>
                            <input
                              type="number"
                              value={settings.performance.messageDelay}
                              onChange={(e) => setSettings({...settings, performance: {...settings.performance, messageDelay: parseInt(e.target.value)}})}
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-2 focus:outline-none font-bold"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold mb-2">Max Messages/Second</label>
                            <input
                              type="number"
                              value={settings.performance.maxMessagesPerSecond}
                              onChange={(e) => setSettings({...settings, performance: {...settings.performance, maxMessagesPerSecond: parseInt(e.target.value)}})}
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-2 focus:outline-none font-bold"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold mb-2">Auto Reconnect Delay (ms)</label>
                            <input
                              type="number"
                              value={settings.performance.autoReconnectDelay}
                              onChange={(e) => setSettings({...settings, performance: {...settings.performance, autoReconnectDelay: parseInt(e.target.value)}})}
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-2 focus:outline-none font-bold"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Chat Logs */}
                      <div className={\`setting-card \${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-2xl p-5 border border-white/10\`}>
                        <h3 className="font-bold text-lg mb-4">Chat Logs</h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between bg-black/30 rounded-xl p-3">
                            <span className="font-medium">Enable Logging</span>
                            <button
                              onClick={() => setSettings({...settings, chatLogs: {...settings.chatLogs, enabled: !settings.chatLogs.enabled}})}
                              className="relative w-12 h-6 rounded-full transition-all"
                              style={{backgroundColor: settings.chatLogs.enabled ? theme.primaryColor : '#374151'}}
                            >
                              <div className={\`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-lg \${settings.chatLogs.enabled ? 'translate-x-6' : ''}\`}></div>
                            </button>
                          </div>
                          <div>
                            <label className="block text-sm font-bold mb-2">Max History</label>
                            <input
                              type="number"
                              value={settings.chatLogs.maxHistory}
                              onChange={(e) => setSettings({...settings, chatLogs: {...settings.chatLogs, maxHistory: parseInt(e.target.value)}})}
                              className="w-full bg-black/30 border-2 rounded-xl px-4 py-2 focus:outline-none font-bold"
                              style={{borderColor: \`\${theme.primaryColor}30\`}}
                            />
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={saveSettings}
                        className={\`w-full px-6 py-4 rounded-2xl font-bold transition-all duration-300 flex items-center justify-center gap-3 \${theme.animations ? 'hover:scale-105' : ''}\`}
                        style={{background: settingsSaved ? 'linear-gradient(to right, #10b981, #059669)' : \`linear-gradient(to right, \${theme.primaryColor}, \${theme.secondaryColor})\`}}
                      >
                        <Settings />
                        {settingsSaved ? '✓ SETTINGS SAVED!' : 'SAVE ALL SETTINGS'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Logs Sidebar */}
              <div className="lg:col-span-1">
                <div className={\`\${theme.glassEffect ? 'glass-morphism-strong' : 'bg-slate-900/80'} rounded-3xl p-6 sticky top-6 \${theme.animations ? 'hover-lift' : ''}\`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black flex items-center gap-2 bg-clip-text text-transparent" style={{backgroundImage: 'linear-gradient(to right, #10b981, #059669)'}}>
                      <Activity />
                      LIVE LOGS
                    </h2>
                    <button 
                      onClick={() => setLogs([])}
                      className={\`p-2 rounded-xl transition-all \${theme.animations ? 'hover:scale-110' : ''}\`} 
                      style={{backgroundColor: 'rgba(255,255,255,0.1)'}}
                    >
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
                          className={\`\${theme.glassEffect ? 'glass-morphism' : 'bg-slate-900/50'} rounded-xl p-4 text-sm border \${theme.animations ? 'animate-slide-in' : ''} \${
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

// API endpoint to get/set theme
app.get("/api/theme", (req, res) => {
  res.json(panelTheme);
});

app.post("/api/theme", (req, res) => {
  const newTheme = req.body;
  if (newTheme) {
    panelTheme = { ...panelTheme, ...newTheme };
    console.log("🎨 Panel theme updated");
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'success',
      msg: 'Panel theme customization saved'
    });
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false });
  }
});

// API endpoint to get/set bot settings
app.get("/api/settings", (req, res) => {
  res.json(botSettings);
});

app.post("/api/settings", (req, res) => {
  const newSettings = req.body;
  if (newSettings) {
    botSettings = { ...botSettings, ...newSettings };
    console.log("⚙️ Bot settings updated");
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'success',
      msg: 'Bot settings configuration saved'
    });
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false });
  }
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

    // Check chat filter
    if (botSettings.chatFilter.enabled && botSettings.chatFilter.keywords.length > 0) {
      const msgLower = msg.toLowerCase();
      const hasKeyword = botSettings.chatFilter.keywords.some(k => 
        k && msgLower.includes(k.toLowerCase())
      );
      
      if (botSettings.chatFilter.filterMode === 'blacklist' && hasKeyword) {
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'info',
          msg: `Message filtered (blacklist): ${msg.substring(0, 50)}...`
        });
        return;
      }
      
      if (botSettings.chatFilter.filterMode === 'whitelist' && !hasKeyword) {
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'info',
          msg: `Message filtered (whitelist): ${msg.substring(0, 50)}...`
        });
        return;
      }
    }

    // Check auto responses
    if (botSettings.autoResponses.enabled) {
      for (const resp of botSettings.autoResponses.responses) {
        if (resp.trigger && msg.toLowerCase().includes(resp.trigger.toLowerCase())) {
          await sleep(resp.delay || 1000);
          bot.chat(resp.response);
          io.emit('bot-log', {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            msg: `Auto response triggered: ${resp.trigger}`
          });
          break;
        }
      }
    }

    // Check custom commands
    for (const cmd of botSettings.customCommands) {
      if (cmd.name && msg.toLowerCase().includes(cmd.name.toLowerCase())) {
        commandCount++;
        await sleep(botSettings.performance.messageDelay);
        bot.chat(cmd.response);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `Custom command executed: ${cmd.name}`
        });
        return;
      }
    }

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

        if (timePassed < (botSettings.commandCooldown * 1000)) {
          const secondsLeft = Math.ceil(((botSettings.commandCooldown * 1000) - timePassed) / 1000);
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
          max_tokens: botSettings.maxTokens,
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
            await sleep(botSettings.performance.messageDelay);
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
      if (!botSettings.welcomeMessages) return;
      
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

        if (botSettings.notifications.onJoin) {
          io.emit('bot-log', {
            time: new Date().toLocaleTimeString(),
            type: 'success',
            msg: `Player joined: ${username}`
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
        await sleep(botSettings.performance.messageDelay);
        const specialMsg = "Relaquent | Star: 3628 | FKDR: 48.72 | KD: 2.32 | WL: 2.86";
        bot.chat(specialMsg);
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'command',
          msg: `!bw command executed for ${ign}`
        });
        return;
      }

      await sleep(botSettings.performance.messageDelay);
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
      await sleep(botSettings.performance.messageDelay);

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
      await sleep(botSettings.performance.messageDelay);

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
      await sleep(botSettings.performance.messageDelay);

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
      await sleep(botSettings.performance.messageDelay);
      const aboutMsg = "RumoniumGC is automated by Relaquent, v2.0 - Last Update 15/11/25";
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
      await sleep(botSettings.performance.messageDelay);
      const helpMsg = [
        "----- RumoniumGC v2.0 -----",
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

    if (botSettings.notifications.onCommand) {
      if (msg.includes("!")) {
        io.emit('bot-log', {
          time: new Date().toLocaleTimeString(),
          type: 'info',
          msg: `Command detected in message`
        });
      }
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
    
    if (botSettings.autoReconnect) {
      setTimeout(createBot, botSettings.performance.autoReconnectDelay);
    }
  });

  bot.on("end", () => {
    console.log("🔌 Disconnected, reconnecting...");
    io.emit('bot-status', 'offline');
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'info',
      msg: `Disconnected, reconnecting in ${botSettings.performance.autoReconnectDelay / 1000}s...`
    });
    
    if (botSettings.autoReconnect) {
      setTimeout(createBot, botSettings.performance.autoReconnectDelay);
    }
  });

  bot.on("error", (err) => {
    console.error("❌ Bot error:", err.message);
    io.emit('bot-log', {
      time: new Date().toLocaleTimeString(),
      type: 'error',
      msg: `Bot error: ${err.message}`
    });
  });
}

// === 6. Start Bot ===
createBot();

