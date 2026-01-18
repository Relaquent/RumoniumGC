# Installation Guide - RumoniumGC Bot

This guide will walk you through setting up RumoniumGC Bot from scratch.

## 📋 Prerequisites

### Required
- **Node.js** 18.0.0 or higher ([Download](https://nodejs.org/))
- **NPM** (comes with Node.js)
- **Minecraft Account** (Java Edition, owned on Microsoft account)
- **Hypixel API Key** ([Get one](https://api.hypixel.net/))
- **OpenAI API Key** ([Get one](https://platform.openai.com/api-keys))

### Optional
- **Urchin API Key** for player reputation checking ([Request](https://urchin.ws/))
- **Git** for cloning the repository

---

## 🚀 Step-by-Step Installation

### Step 1: Download the Bot

#### Option A: Using Git (Recommended)
```bash
git clone https://github.com/yourusername/rumoniumgc-bot.git
cd rumoniumgc-bot
```

#### Option B: Download ZIP
1. Download the latest release from [Releases](https://github.com/yourusername/rumoniumgc-bot/releases)
2. Extract the ZIP file
3. Open terminal/command prompt in the extracted folder

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages:
- `mineflayer` - Minecraft bot framework
- `express` - Web server
- `socket.io` - Real-time communication
- `openai` - GPT integration
- `axios` - HTTP requests

**Note**: Installation may take 2-5 minutes depending on your internet speed.

### Step 3: Get Your API Keys

#### Hypixel API Key
1. Log into Hypixel (mc.hypixel.net)
2. Type `/api new` in chat
3. Copy the key (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

#### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to [API Keys](https://platform.openai.com/api-keys)
4. Click "Create new secret key"
5. Copy the key (starts with `sk-`)

**Important**: Keep your API keys secure! Never share them or commit them to Git.

#### Urchin API Key (Optional)
1. Visit [Urchin.ws](https://urchin.ws/)
2. Join their Discord or use their website to request an API key
3. Once received, save it for the next step

### Step 4: Configure Environment Variables

Create a file named `.env` in the root directory:

```env
# Required - Hypixel API
HYPIXEL_API_KEY=your_hypixel_api_key_here

# Required - OpenAI API
OPENAI_API_KEY=sk-your_openai_key_here

# Optional - Urchin API (for !view command)
URCHIN_API_KEY=your_urchin_key_here

# Optional - Server Port (default: 3000)
PORT=3000
```

**Example**:
```env
HYPIXEL_API_KEY=12345678-1234-1234-1234-123456789abc
OPENAI_API_KEY=sk-abc123def456ghi789
URCHIN_API_KEY=urchin_abc123xyz
PORT=3000
```

### Step 5: Start the Bot

```bash
npm start
```

You should see:
```
🌐 Server running on port 3000
🔑 Urchin API Key: urchin_abc...
✅ Loaded permissions for 0 users
✅ Loaded FKDR tracking for 0 players
✅ Loaded 0 blacklist entries
🔍 Testing Urchin API connection...
✅ Urchin API connected successfully
✅ Connected to Hypixel
```

### Step 6: Verify Bot is Working

1. The bot will automatically connect to Hypixel
2. Wait for "Bot ready" message in console
3. Join your guild on Hypixel
4. Type `!help` in guild chat
5. The bot should respond with command list

### Step 7: Access Control Panel

1. Open your web browser
2. Navigate to: `http://localhost:3000/control`
3. You should see the control panel dashboard

---

## ⚙️ Configuration

### Bot Settings

Default settings are optimized for most use cases, but you can customize:

```javascript
{
  autoReconnect: true,           // Auto-reconnect if bot disconnects
  welcomeMessages: true,          // Send welcome when players join
  commandCooldown: 45,            // Seconds between !ask uses (per user)
  maxTokens: 100,                 // Max GPT response length
  performance: {
    messageDelay: 300,            // Milliseconds between messages
    autoReconnectDelay: 15000     // Milliseconds before reconnecting
  }
}
```

Modify these via the control panel or in `index.js`.

### GPT System Prompt

Customize the AI personality:

1. Go to control panel
2. Navigate to Settings (if you add this tab)
3. Edit the system prompt
4. Or edit `gptSystemPrompt` in `index.js`

---

## 🐛 Troubleshooting

### Bot won't start

**Error**: `OPENAI_API_KEY not found`
- **Solution**: Make sure `.env` file exists and contains `OPENAI_API_KEY=...`

**Error**: `HYPIXEL_API_KEY not found`
- **Solution**: Add `HYPIXEL_API_KEY=...` to your `.env` file

**Error**: `Cannot find module`
- **Solution**: Run `npm install` again

### Bot can't connect to Hypixel

**Error**: Connection timeout
- **Solution**: Check if Hypixel is online at [status.hypixel.net](https://status.hypixel.net/)
- **Solution**: Verify your Microsoft account owns Minecraft Java Edition
- **Solution**: Make sure you're not running multiple Minecraft instances

**Error**: "Kicked: You are logged in from another location"
- **Solution**: Close any other Minecraft clients using this account
- **Solution**: Wait 60 seconds before restarting the bot

### Commands not responding

**Issue**: Bot online but not responding to commands

1. **Check guild chat**: Type `/chat g` to ensure bot is in guild chat
2. **Check permissions**: Verify user has permission for that command
3. **Check bot status**: Look at control panel - should show "online"
4. **Check console**: Look for error messages

### API Errors

**Error**: "Rate limited"
- **Solution**: The bot has built-in rate limiting, wait a few minutes
- **Solution**: Reduce command usage

**Error**: "Invalid API key"
- **Solution**: Verify your Hypixel/OpenAI API key is correct
- **Solution**: Check for extra spaces in `.env` file

**Error**: "Player not found"
- **Solution**: Check spelling of player name
- **Solution**: Player may have never joined Hypixel

### Urchin API Issues

**Error**: "Urchin API unavailable"
- **Solution**: Check if you have a valid Urchin API key
- **Solution**: Urchin.ws may be down, check their status

**If Urchin is optional**: Remove `URCHIN_API_KEY` from `.env` to disable

### Control Panel Issues

**Issue**: Can't access control panel

1. **Check port**: Make sure nothing else is using port 3000
2. **Try different port**: Change `PORT=3000` to `PORT=3001` in `.env`
3. **Check firewall**: Allow Node.js through firewall
4. **Try localhost**: Use `http://localhost:3000/control` instead of `127.0.0.1`

---

## 🔧 Advanced Setup

### Running on a VPS/Server

1. **Use PM2 for process management**:
```bash
npm install -g pm2
pm2 start index.js --name rumoniumgc
pm2 save
pm2 startup
```

2. **Enable auto-start on reboot**:
```bash
pm2 startup
# Follow the instructions shown
```

3. **View logs**:
```bash
pm2 logs rumoniumgc
```

### Running with Docker

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t rumoniumgc .
docker run -d -p 3000:3000 --env-file .env rumoniumgc
```

### Reverse Proxy (Nginx)

If you want to access via domain name:

```nginx
server {
    listen 80;
    server_name bot.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📊 Data Files

The bot creates these files automatically:

- `blacklist.json` - Blacklisted players
- `command_permissions.json` - User permissions
- `fkdr_tracking.json` - FKDR snapshots
- `logs/` - Log files (if configured)

**Backup**: Export via control panel → Data Management tab

---

## 🔒 Security Best Practices

1. **Never commit `.env` file**
   - Add `.env` to `.gitignore`
   
2. **Restrict control panel access**
   - Don't expose port 3000 to internet
   - Use VPN or SSH tunnel for remote access
   
3. **Regular backups**
   - Export data weekly
   - Keep backups in secure location
   
4. **Update dependencies**
   ```bash
   npm update
   npm audit fix
   ```

---

## 🆘 Getting Help

If you're still having issues:

1. Check [GitHub Issues](https://github.com/yourusername/rumoniumgc-bot/issues)
2. Search for similar problems
3. Create a new issue with:
   - Your OS and Node.js version
   - Error messages (remove API keys!)
   - Steps to reproduce

---

## ✅ Quick Checklist

Before asking for help, verify:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] All dependencies installed (`npm install`)
- [ ] `.env` file created with all required keys
- [ ] Hypixel API key is valid (test at [api.hypixel.net](https://api.hypixel.net/))
- [ ] OpenAI API key is valid and has credits
- [ ] Bot shows "Connected to Hypixel" in console
- [ ] Bot is in guild chat (shows "Guild >" messages)
- [ ] Control panel accessible at localhost:3000/control

---

**Installation complete! 🎉**

For usage instructions, see [README.md](README.md)
