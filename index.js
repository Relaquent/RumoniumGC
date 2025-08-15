const mineflayer = require('mineflayer');
const axios = require('axios');

const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY; // API key ortam değişkeninden alınıyor
const HYPIXEL_HOST = 'mc.hypixel.net';
const MC_VERSION = '1.8.9';

function ratio(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d === 0) return n > 0 ? 'inf' : '0.00';
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
    wl: ratio(bw.wins_bedwars, bw.losses_bedwars)
  };
}

async function getPlayerStats(ign) {
  if (!HYPIXEL_API_KEY) throw new Error('HYPIXEL_API_KEY tanımlı değil.');
  const url = `https://api.hypixel.net/v2/player?key=${HYPIXEL_API_KEY}&name=${encodeURIComponent(ign)}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data?.success) throw new Error('API başarısız yanıt');
  if (!data?.player) throw new Error('Oyuncu bulunamadı');
  return parseBWStats(data.player);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function createBot() {
  const bot = mineflayer.createBot({
    host: HYPIXEL_HOST,
    version: MC_VERSION,
    auth: 'microsoft'
  });

  bot.once('spawn', () => {
    console.log('✅ Spawn oldu, Guild chat’e geçiliyor...');
    setTimeout(() => bot.chat('/chat g'), 1500);
  });

  bot.on('message', async (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (!msg.startsWith('Guild >')) return;

    // !bw komutu
    if (msg.toLowerCase().includes('!bw')) {
      const match = msg.match(/!bw\s+([A-Za-z0-9_]{1,16})/i);
      if (!match) return;

      const ign = match[1];
      await sleep(300);

      try {
        const stats = await getPlayerStats(ign);
        const line = `RumoGC - ${ign} | Star: ${stats.star} | FKDR: ${stats.fkdr} | KD: ${stats.kd} | WL: ${stats.wl} - by Relaquent`;
        bot.chat(line);
        console.log('Gönderildi:', line);
      } catch (err) {
        bot.chat(`BW Stats - ${ign} | no data found.`);
        console.log('⚠️ Hata:', err.message);
      }
      return;
    }

    // !about komutu
    if (msg.toLowerCase().includes('!about')) {
      await sleep(300);
      const aboutMsg = 'RumoniumGC is automated by Relaquent, v1.0.2';
      bot.chat(aboutMsg);
      console.log('Gönderildi:', aboutMsg);
    }
  });

  bot.on('kicked', (reason) => {
    console.log('❌ Atıldı:', reason);
    setTimeout(createBot, 3000);
  });

  bot.on('end', () => {
    console.log('🔌 Bağlantı kapandı, tekrar bağlanılıyor...');
    setTimeout(createBot, 3000);
  });
}

createBot();
