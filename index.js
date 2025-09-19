// index.js

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
app.get("/", (req, res) => {
  res.send("✅ Bot is running and online! (Render)");
});
app.listen(PORT, () => {
  console.log(`🌐 Web server is running on port ${PORT} (Ready for UptimeRobot)`);
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
const ASK_COOLDOWN_MS = 3 * 60 * 1000; // 3 dakika

// === 5. Mineflayer Bot ===
function createBot() {
  const bot = mineflayer.createBot({
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

      // Cooldown kontrolü (Relaquent hariç)
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
                "You're like an uncle, sincere, witty, funny and ironic. Always keep answers short and concise: maximum 3–4 sentences. You are a big Turkiye fan."
            },
            { role: "user", content: userMessage }
          ],
          max_tokens: 40, // kısa cevap
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
        const specialMsg = "Relaquent | Star: 2394 | FKDR: 23.72 | KD: 2.32 | WL: 1.24";
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

      const firstEvent = new Date("2025-10-02T00:00:00Z");
      const cycleDays = 42;
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
        "ask <msg> → Ask ChatGPT.",
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

