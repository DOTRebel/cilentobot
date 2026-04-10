const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs');

const SITES = [
  { name: 'Cilento Notizie', url: 'https://www.cilentonotizie.it/', selector: 'article h2 a, .post-title a, h3 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' },
  { name: 'Giornale del Cilento', url: 'https://www.giornaledelcilento.it/', selector: 'article h2 a, .post-title a, h3 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' },
  { name: 'Info Cilento', url: 'https://www.infocilento.it/', selector: 'article h2 a, .post-title a, h3 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' },
  { name: 'Cilento Time', url: 'https://www.cilentotime.it/', selector: 'article h2 a, .post-title a, h3 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' },
  { name: 'Cilento Reporter', url: 'https://cilentoreporter.it/', selector: 'article h2 a, .post-title a, h3 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' },
  { name: 'Dentro Salerno', url: 'https://www.dentrosalerno.it/', selector: 'article h2 a, .post-title a, h3 a, h2 a', imgSelector: 'article img, .post-thumbnail img, .entry-content img' }
];

const DATA_FILE = 'sent_news.json';
const CONFIG_FILE = 'config.json';

let config = loadConfig();
let sentNews = loadSentNews();
let bot = null;

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return { token: '', chatId: '' };
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadSentNews() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return {};
}

function saveSentNews() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(sentNews, null, 2));
}

function generateId(url, title) {
  return Buffer.from(url + title).toString('base64').substring(0, 32);
}

async function fetchNewsFromSite(site) {
  try {
    const response = await axios.get(site.url, { 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8'
      }
    });
    const $ = cheerio.load(response.data);
    const news = [];

    $(site.selector).each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      let img = null;
      
      const parent = $(el).closest('article') || $(el).closest('.post');
      if (parent.length) {
        img = parent.find(site.imgSelector).first().attr('src') || parent.find(site.imgSelector).first().attr('data-src');
      }
      
      if (title && title.length > 5 && link) {
        const fullUrl = link.startsWith('http') ? link : site.url + link;
        news.push({
          title,
          url: fullUrl,
          site: site.name,
          image: img,
          id: generateId(fullUrl, title)
        });
      }
    });

    return news;
  } catch (error) {
    console.error(`Errore fetching ${site.name}:`, error.message);
    return [];
  }
}

async function fetchAllNews() {
  const allNews = [];
  for (const site of SITES) {
    const news = await fetchNewsFromSite(site);
    allNews.push(...news);
  }
  return allNews;
}

function getNewNews(news) {
  const unique = [];
  const titles = new Set();
  
  for (const n of news) {
    const normalized = n.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
    if (!titles.has(normalized)) {
      titles.add(normalized);
      unique.push(n);
    }
  }
  
  return unique.filter(n => !sentNews[n.id]);
}

async function sendNews(newsItems) {
  if (!bot || !config.chatId) return;
  if (newsItems.length === 0) return;

  const n = newsItems[0];
  try {
    if (n.image) {
      await bot.telegram.sendPhoto(config.chatId, n.image, {
        caption: `<b>${n.title}</b>\n\n${n.url}\n\n📍 ${n.site}`,
        parse_mode: 'HTML'
      });
    } else {
      await bot.telegram.sendMessage(config.chatId, `<b>${n.title}</b>\n\n${n.url}\n\n📍 ${n.site}`, { parse_mode: 'HTML' });
    }
    console.log(`Inviata: ${n.title.substring(0, 50)}...`);
    
    sentNews[n.id] = { ...n, timestamp: Date.now() };
    saveSentNews();
  } catch (error) {
    console.error('Errore invio:', error.message);
  }
}

let pendingNews = [];
let lastSentTime = 0;
const MIN_INTERVAL = 300000;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function checkAndSend() {
  console.log('Controllo notizie...');
  const news = await fetchAllNews();
  const newItems = getNewNews(news);
  
  if (newItems.length === 0) return;
  
  pendingNews = [...pendingNews, ...newItems];
  pendingNews = shuffleArray(pendingNews);
  
  const now = Date.now();
  if (pendingNews.length > 0 && (now - lastSentTime) >= MIN_INTERVAL) {
    const toSend = pendingNews.slice(0, 1);
    pendingNews = pendingNews.slice(1);
    await sendNews(toSend);
    lastSentTime = now;
  }
}

function startBot() {
  if (!config.token) {
    console.log('Configura il bot con: node bot.js --set-token <TOKEN>');
    return;
  }

  bot = new Telegraf(config.token);

  bot.command('start', (ctx) => {
    if (!config.chatId) {
      config.chatId = ctx.from.id;
      saveConfig();
      ctx.reply('<b>✅ Chat configurata automaticamente!</b>\n\nRiceverai le notizie del Cilento ogni 15 minuti.', { parse_mode: 'HTML' });
    } else {
      ctx.reply('<b>Bot gia' + "' configurato!</b>\n\nUsa /notizie per vedere le notizie.', { parse_mode: 'HTML' });
    }
  });

  bot.command('notizie', async (ctx) => {
    const news = await fetchAllNews();
    if (news.length === 0) {
      ctx.reply('Nessuna notizia trovata.');
    } else {
      const items = news.slice(0, 10);
      for (const n of items) {
        try {
          if (n.image) {
            await ctx.replyWithPhoto(n.image, {
              caption: `<b>${n.title}</b>\n\n${n.url}\n\n📍 ${n.site}`,
              parse_mode: 'HTML'
            });
          } else {
            ctx.reply(`<b>${n.title}</b>\n\n${n.url}\n\n📍 ${n.site}`, { parse_mode: 'HTML' });
          }
        } catch(e) {
          ctx.reply(`<b>${n.title}</b>\n\n${n.url}\n\n📍 ${n.site}`, { parse_mode: 'HTML' });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  });

  bot.command('configura', (ctx) => {
    config.chatId = ctx.from.id;
    saveConfig();
    ctx.reply('✅ Chat configurata!', { parse_mode: 'HTML' });
  });

  bot.launch();
  console.log('Bot avviato!');
}

const args = process.argv.slice(2);
if (args[0] === '--set-token') {
  config.token = args[1];
  saveConfig();
  console.log('Token impostato!');
} else if (args[0] === '--set-chat') {
  config.chatId = args[1];
  saveConfig();
  console.log('Chat ID impostato!');
} else {
  cron.schedule('*/15 * * * *', checkAndSend);
  startBot();
  setTimeout(checkAndSend, 5000);
}

process.on('SIGINT', () => {
  if (bot) bot.stop();
  process.exit();
});