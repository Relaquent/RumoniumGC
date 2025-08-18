// Hypixel Bedwars Stats Bot - Render 7/24 versiyon
const express = require("express");
const mineflayer = require("mineflayer");
const axios = require("axios");

// === 1. Express Web Server ===
const app = express();
const PORT = process.env.PORT || 3000; // Render için PORT ayarı
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

// === 4. Mineflayer Bot ===
function createBot() {
  const bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: "microsoft", // Microsoft hesabınla giriş yapar
  });

  bot.once("spawn", () => {
    console.log("✅ Bot Hypixel’e bağlandı, Guild chat’e geçiliyor...");
    setTimeout(() => bot.chat("/chat g"), 1500);

    // AFK kick yememesi için periyodik komut
    setInterval(() => {
      bot.chat("/locraw"); // zararsız komut, alive tutar
    }, 60 * 1000);
  });

  bot.on("message", async (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (!msg.startsWith("Guild >")) return;

    // !bw komutu
    if (msg.toLowerCase().includes("!bw")) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;

      const ign = match[1];
      await sleep(300);

      try {
        const stats = await getPlayerStats(ign);
        const line = `RumoGC - ${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl} - by Relaquent`;
        bot.chat(line);
        console.log("📤 Gönderildi:", line);

        // 🔥 Eğer NerdyWolf ise ekstra mesaj
        if (ign.toLowerCase() === "nerdywolf") {
          await sleep(300);
          bot.chat("This is NerdyWolf");
          console.log("📤 Gönderildi: This guy might be the lowest iq castle player with the 1.69 FKDR. It is worth mentioning.");
        }
      } catch (err) {
        bot.chat(`BW Stats - ${ign} | no data found.`);
        console.log("⚠️ Hata:", err.message);
      }
      return;
    }

    // !about komutu
    if (msg.toLowerCase().includes("!about")) {
      await sleep(300);
      const aboutMsg = "RumoniumGC is automated by Relaquent, v1.0.2";
      bot.chat(aboutMsg);
      console.log("📤 Gönderildi:", aboutMsg);
    }
  });

  bot.on("kicked", (reason) => {
    console.log("❌ Sunucudan atıldı:", reason);
    setTimeout(createBot, 10000); // Render için 10 sn bekle, IP blok riskini azalt
  });

  bot.on("end", () => {
    console.log("🔌 Bağlantı koptu, tekrar bağlanılıyor...");
    setTimeout(createBot, 10000);
  });
}

// === 5. Botu Başlat ===
createBot();
