// Hypixel Bedwars Stats Bot - Render 7/24 versiyon
const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");

// === 1. Express Web Server ===
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send("✅ Bot çalışıyor ve online! (Render)");
});
app.listen(PORT, () => {
  console.log(`🌐 Web server ${PORT} portunda çalışıyor (UptimeRobot için hazır)`);
});

// === 2. Hypixel API Key Kontrolü ===
if (!process.env.HYPIXEL_API_KEY) {
  console.error("❌ HYPIXEL_API_KEY bulunamadı. Lütfen Render Environment Variables kısmına ekleyin.");
  process.exit(1);
}
const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY;

// === 3. Bot Ayarları ===
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
  };
}

async function getPlayerStats(ign) {
  const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(
    ign
  )}`;
  const { data } = await axios.get(url, { timeout: 10000 });

  if (data?.cause === "Invalid API key") throw new Error("Geçersiz API key (403)");
  if (!data?.success) throw new Error("API başarısız yanıt");
  if (!data?.player) throw new Error("Oyuncu bulunamadı");

  return parseBWStats(data.player);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// === 4. Hoşgeldin Mesajları ===
const welcomeMessages = [
  "Hey! Welcome back {username}!",
  "Greetings, {username}!",
  "{username} has joined, hello!",
  "{username} is ready to camp again!",
  "{username} the GOAT is back!"
];

// === 5. Mineflayer Bot ===
function createBot() {
  const bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft",
  });

  bot.once("spawn", () => {
    console.log("✅ Bot Hypixel’e bağlandı, Guild chat’e geçiliyor...");
    setTimeout(() => bot.chat("/chat g"), 1500);

    setInterval(() => {
      bot.chat("/locraw");
    }, 60 * 1000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (!msg.startsWith("Guild >")) return;

    // === Oyuncu guild’e katıldığında hoşgeldin mesajı ===
    if (msg.includes("joined.")) {
      const match = msg.match(/Guild > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}) joined\./);
      if (match) {
        const username = match[1];
        const randomMsg = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
        const finalMsg = randomMsg.replace("{username}", username);
        await sleep(500);
        bot.chat(finalMsg);
        console.log(`👋 Hoşgeldin mesajı gönderildi: ${finalMsg}`);
      }
      return;
    }

    // !bw komutu
    if (msg.toLowerCase().includes("!bw")) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];

      if (ign.toLowerCase() === "relaquent") {
        await sleep(300);
        const specialMsg = "Relaquent | Star: 2394 | FKDR: 23.72 | KD: 2.32 | WL: 1.24";
        bot.chat(specialMsg);
        console.log("📤 Gönderildi (özel):", specialMsg);
        return;
      }

      await sleep(300);
      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl}`;
        bot.chat(line);
        console.log("📤 Gönderildi:", line);
      } catch (err) {
        bot.chat(`RumoGC - ${ign} | no data found.`);
        console.log("⚠️ Hata:", err.message);
      }
      return;
    }

    // !stats komutu
    if (msg.toLowerCase().includes("!stats")) {
      const match = msg.match(/!stats\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      await sleep(300);

      try {
        const stats = await getPlayerStats(ign);
        const line = `${ign} | Star: ${stats.star} | Finals: ${stats.finals} | Wins: ${stats.wins}`;
        bot.chat(line);
        console.log("📤 Gönderildi:", line);
      } catch (err) {
        bot.chat(`RumoGC - ${ign} | no data found.`);
        console.log("⚠️ Hata (!stats):", err.message);
      }
      return;
    }

    // !ping komutu
    if (msg.toLowerCase().includes("!ping")) {
      const match = msg.match(/!ping\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;
      const ign = match[1];
      await sleep(300);

      const playerObj = bot.players[ign];
      if (playerObj && typeof playerObj.ping === "number") {
        const line = `RumoGC - ${ign}: ${playerObj.ping}ms`;
        bot.chat(line);
        console.log("📤 Gönderildi:", line);
      } else {
        const line = `RumoGC - ${ign}: They are offline.`;
        bot.chat(line);
        console.log("⚠️ Ping alınamadı, oyuncu bulunamadı:", ign);
      }
      return;
    }

    // !about komutu
    if (msg.toLowerCase().includes("!about")) {
      await sleep(300);
      const aboutMsg = "RumoniumGC is automated by Relaquent, v1.0.6";
      bot.chat(aboutMsg);
      console.log("📤 Gönderildi:", aboutMsg);
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Sunucudan atıldı:", reason);
    setTimeout(createBot, 10000);
  });

  bot.on("end", () => {
    console.log("🔌 Bağlantı koptu, tekrar bağlanılıyor...");
    setTimeout(createBot, 10000);
  });
}

// === 6. Botu Başlat ===
createBot();
