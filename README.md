# 🌟 Rumonium Advanced Bot v2.2.1 - Stellar Lumen Edition

<div align="center">

![Version](https://img.shields.io/badge/version-2.2.1-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![License](https://img.shields.io/badge/license-Apache-2.0-green.svg)

**A powerful, feature-rich Minecraft guild bot for Hypixel with AI integration, advanced statistics tracking, and comprehensive management tools.**

[Features](#-features) • [Installation](#-installation) • [Commands](#-commands) • [Configuration](#-configuration) • [Support](#-support)

</div>

---

## ✨ Features

### 🎮 Core Functionality
- **Hypixel Integration** - Full Hypixel API support for player statistics
- **Guild Chat Bot** - Automated responses and commands in guild chat
- **AI-Powered Chat** - GPT-4 integration for intelligent conversations
- **Real-time Statistics** - Live player stats, GEXP tracking, and Bedwars data

### 📊 Advanced Tracking
- **FKDR Progress Tracking** - Monitor your Final K/D ratio with daily/weekly/monthly snapshots
- **Player Statistics** - Comprehensive Bedwars stats (Star, FKDR, KD, WL)
- **Guild GEXP Tracking** - Weekly GEXP and guild ranking
- **Activity Analytics** - Command usage statistics and user activity logs

### 🛡️ Management Tools
- **Blacklist System** - Manage blacklisted players with reasons and timestamps
- **Command Permissions** - Granular permission control per user/command
- **Urchin API Integration** - Player reputation checking (optional)
- **Data Import/Export** - Full backup and restore capabilities

### 🎨 Web Control Panel
- **Modern Dashboard** - Beautiful Tailwind CSS interface
- **Real-time Updates** - Live chat monitoring via Socket.IO
- **Statistics Dashboard** - Visual charts and analytics
- **User Management** - Easy permission and blacklist management

---

## 📦 Installation

### Prerequisites
- Node.js 18.0.0 or higher
- Microsoft account with Minecraft
- Hypixel API key
- OpenAI API key
- (Optional) Urchin API key

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/relaquent/rumoniumgc.git
cd rumoniumgc
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create a `.env` file in the root directory:

```env
# Required
HYPIXEL_API_KEY=your_hypixel_api_key

# Optional
OPENAI_API_KEY=your_openai_api_key
URCHIN_API_KEY=your_urchin_api_key
PORT=3000
```

4. **Start the bot**
```bash
npm start
```

5. **Access the control panel**

Open your browser and navigate to:
```
http://localhost:3000/control
```

---

## 🎯 Commands

### Player Statistics
| Command | Description | Example |
|---------|-------------|---------|
| `!bw <player>` | Show Bedwars stats | `!bw Technoblade` |
| `!stats <player>` | Detailed player statistics | `!stats Relaquent` |
| `!gexp <player>` | Weekly GEXP and rank | `!gexp Dream` |
| `!nfkdr [player]` | Calculate finals needed for next FKDR | `!nfkdr` |

### FKDR Tracking
| Command | Description |
|---------|-------------|
| `!fkdr start` | Start tracking your FKDR |
| `!fkdr` | View your FKDR progress |
| `!fkdr stop` | Stop FKDR tracking |

### Blacklist Management
| Command | Description | Example |
|---------|-------------|---------|
| `!b check <player>` | Check if player is blacklisted | `!b check Player123` |
| `!b add <player> <reason>` | Add player to blacklist | `!b add Player123 Scammer` |
| `!b remove <player>` | Remove from blacklist | `!b remove Player123` |

### Utility
| Command | Description |
|---------|-------------|
| `!when` | Next guild castle timer |
| `!ask <message>` | Ask AI a question (45s cooldown) |
| `!view <player>` | Check Urchin reputation (if enabled) |
| `!about` | Bot information |
| `!help` | Show all commands |

---

## ⚙️ Configuration

### Bot Settings

Access via control panel or edit directly:

```javascript
{
  autoReconnect: true,           // Auto-reconnect on disconnect
  welcomeMessages: true,          // Send welcome messages
  commandCooldown: 45,            // Cooldown in seconds for !ask
  maxTokens: 100,                 // Max GPT response tokens
  performance: {
    messageDelay: 300,            // Delay between messages (ms)
    autoReconnectDelay: 15000     // Delay before reconnect (ms)
  }
}
```

### GPT System Prompt

Customize the AI personality in the control panel or modify `gptSystemPrompt` in the code.

### Command Permissions

Set permissions via the control panel:
- **Whitelist Mode**: User can only use specified commands
- **Blacklist Mode**: User cannot use specified commands

---

## 🌐 Web Control Panel

### Features

**📊 Statistics Tab**
- Real-time command and message counters
- Top commands and users charts
- Recent activity feed
- System performance metrics

**🔐 Permissions Tab**
- Set user-specific command permissions
- Whitelist/blacklist command modes
- Easy permission management interface

**🗃️ Data Management Tab**
- Export all data (full backup)
- Export individual datasets
- Import from backup files
- Safe data migration

**🛡️ Blacklist Tab**
- Add/remove blacklisted players
- Edit blacklist entries
- View detailed blacklist history
- Player head previews

**💬 Chat Tab**
- Live guild chat monitoring
- Send messages directly from panel
- Real-time message feed

**📝 Logs Tab**
- Categorized system logs
- Error tracking
- Success/warning notifications

---

## 📊 Data Storage

The bot automatically creates and manages these files:

- `blacklist.json` - Blacklisted players database
- `command_permissions.json` - User permission settings
- `fkdr_tracking.json` - FKDR tracking snapshots
- `logs/` - System log directory

**Auto-save**: Data is saved every 5 minutes and on graceful shutdown.

---

## 🔧 API Integration

### Hypixel API
- Player statistics
- Guild information
- Experience tracking

### OpenAI API
- GPT-4 Turbo Mini for chat responses
- Customizable system prompts
- Token usage optimization

### Urchin API (Optional)
- Player reputation checking
- Community blacklist integration
- Rate limit handling

---

## 🐛 Troubleshooting

### Bot won't connect to Hypixel
- Ensure your Microsoft account owns Minecraft
- Check if your API keys are valid
- Verify Hypixel isn't in maintenance

### Commands not working
- Check command permissions in control panel
- Verify bot is in guild chat (`/chat g`)
- Check if user is blacklisted

### API rate limits
- The bot has built-in rate limiting
- Reduce command usage if hitting limits
- Check API queue status in statistics

### Data not saving
- Ensure write permissions in directory
- Check disk space
- Verify JSON file syntax

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

📝 License
This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

---

## 🙏 Credits

**Created by Relaquent**

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/relaquent/rumoniumgc/issues)

---

<div align="center">

If you find this bot useful, please consider giving it a ⭐ on GitHub!

</div>

---

## 📋 Additional Files

This release includes:
- `README.md` - This file
- `INSTALL.md` - Detailed installation guide
- `LICENSE` - Apache 2.0 License
