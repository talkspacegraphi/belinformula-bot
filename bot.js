require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN provided');
  process.exit(1);
}

const API_BASE_URL = process.env.API_BASE_URL || 'http://166.1.144.111:5001';

const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

// Обработка /start с параметром (логин или ID)
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match[1];

  try {
    if (param) {
      // Запрашиваем пользователя через API
      const response = await axios.get(`${API_BASE_URL}/api/user/${param}`);
      const user = response.data;

      if (!user) {
        return bot.sendMessage(chatId, '❌ Аккаунт не найден. Зайди на сайт и нажми «Подключить» еще раз.');
      }

      // Привязываем chatId к пользователю через отдельный эндпоинт
      await axios.post(`${API_BASE_URL}/api/user/link-telegram`, {
        login: user.login,
        telegramChatId: chatId.toString()
      });

      const keyboard = {
        reply_markup: {
          keyboard: [[{ text: '🆘 Помощь' }, { text: '👥 Мои аккаунты' }]],
          resize_keyboard: true
        }
      };

      await bot.sendMessage(
        chatId,
        `Привет, ${user.login}! 👋\n\nЯ успешно подключен! Буду оповещать тебя, когда тебе нужно зайти на сайт, выполнить задания и не потерять серию 🔥.`,
        keyboard
      );
    } else {
      const keyboard = {
        reply_markup: {
          keyboard: [[{ text: '🆘 Помощь' }]],
          resize_keyboard: true
        }
      };
      await bot.sendMessage(
        chatId,
        'Добро пожаловать в бота BELIMFORMULA! 🎓\n\nЧтобы привязать аккаунт, зайди в **настройки** на сайте и нажми кнопку «Подключить Telegram».',
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
  } catch (error) {
    console.error('Error in /start handler:', error.message);
    bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуй позже.');
  }
});

// Обработка кнопок
bot.on('message', async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (!text || text.startsWith('/')) return;

  try {
    if (text === '🆘 Помощь') {
      await bot.sendMessage(
        chatId,
        '🤖 **Как это работает?**\nЯ слежу за твоими аккаунтами и напоминаю, если огненная серия 🔥 может сгореть.\n\nКнопки в меню:\n👥 **Мои аккаунты** — покажет список всех привязанных аккаунтов и их статистику.\n🆘 **Помощь** — это сообщение.',
        { parse_mode: 'Markdown' }
      );
    } else if (text === '👥 Мои аккаунты') {
      // Запрашиваем список аккаунтов, привязанных к этому chatId
      const response = await axios.get(`${API_BASE_URL}/api/user/by-telegram/${chatId}`);
      const users = response.data;

      if (users.length === 0) {
        await bot.sendMessage(chatId, 'У тебя пока нет привязанных аккаунтов. Подключи их через сайт.');
      } else {
        let accountsText = '👥 *Твои привязанные аккаунты:*\n\n';
        for (const u of users) {
          accountsText += `👤 **${u.login}**\n🏆 Опыт: ${u.xp} XP\n🏅 Лига: ${u.league}\n🔥 Серия: ${u.streak} дн.\n❤️ Жизни: ${u.lives}/5\n\n`;
        }
        await bot.sendMessage(chatId, accountsText, { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    console.error('Error in message handler:', error.message);
    bot.sendMessage(chatId, '⚠️ Ошибка при обработке сообщения.');
  }
});

console.log('Telegram bot started');