require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const https = require('https');

// Создаем HTTPS агент с отключенной проверкой сертификатов
// ВНИМАНИЕ: это временное решение, пока не настроите HTTPS правильно
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN provided');
  process.exit(1);
}

// Используем HTTPS с отключенной проверкой сертификатов
const API_BASE_URL = process.env.API_BASE_URL || 'https://b.zeroyt.ru';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Запускаем HTTP сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Health check server listening on port ${PORT}`);
});

// Создаем бота с polling
const bot = new TelegramBot(token, {
  polling: true,
  polling_options: {
    timeout: 30,
    interval: 300
  },
  request: {
    timeout: 30000,
    agent: httpsAgent // Используем наш агент с отключенной проверкой
  }
});

// Создаем axios instance с отключенной проверкой SSL
const api = axios.create({
  baseURL: API_BASE_URL,
  httpsAgent: httpsAgent,
  timeout: 30000
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  if (error.code === 'ETIMEDOUT' || error.code === 'EFATAL') {
    console.log('Polling timeout (normal)');
    return;
  }
  if (error.message.includes('EPROTO') || error.message.includes('SSL')) {
    console.log('SSL Error (ignored):', error.message);
    return;
  }
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  if (error.message.includes('EPROTO') || error.message.includes('SSL')) {
    console.log('Bot SSL Error (ignored):', error.message);
    return;
  }
  console.error('Bot error:', error.message);
});

// Обработка /start
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match[1];

  try {
    console.log(`/start called with param: ${param}`);
    
    if (param) {
      // Запрашиваем пользователя через API
      const response = await api.get(`/api/user/${param}`);
      const user = response.data;

      if (!user) {
        return bot.sendMessage(chatId, '❌ Аккаунт не найден. Зайди на сайт и нажми «Подключить» еще раз.');
      }

      // Привязываем chatId
      await api.post('/api/user/link-telegram', {
        login: user.login,
        telegramChatId: chatId.toString()
      });

      const keyboard = {
        reply_markup: {
          keyboard: [
            [{ text: '🆘 Помощь' }, { text: '👥 Мои аккаунты' }],
            [{ text: '🔗 Отвязать аккаунт' }]
          ],
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
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    if (error.code === 'ECONNREFUSED') {
      return bot.sendMessage(chatId, '❌ Сервер временно недоступен. Попробуй позже.');
    }
    if (error.message.includes('EPROTO') || error.message.includes('SSL')) {
      console.log('SSL Error in /start (ignored):', error.message);
      return bot.sendMessage(chatId, '⚠️ Проблема с подключением. Пробуем снова...');
    }
    bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуй позже.');
  }
});

// Обработка обычных сообщений (кнопки)
bot.on('message', async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (!text || text.startsWith('/')) return;

  try {
    console.log(`Message from ${chatId}: ${text}`);
    
    const users = await api.get(`/api/user/by-telegram/${chatId}`).then(res => res.data);

    if (text === '🆘 Помощь') {
      await bot.sendMessage(
        chatId,
        '🤖 **Как это работает?**\nЯ слежу за твоими аккаунтами и напоминаю, если огненная серия 🔥 может сгореть.\n\nКнопки в меню:\n👥 **Мои аккаунты** — покажет список всех привязанных аккаунтов и их статистику.\n🔗 **Отвязать аккаунт** — отвяжет выбранный аккаунт от Telegram.\n🆘 **Помощь** — это сообщение.',
        { parse_mode: 'Markdown' }
      );
    } else if (text === '👥 Мои аккаунты') {
      if (users.length === 0) {
        await bot.sendMessage(chatId, 'У тебя пока нет привязанных аккаунтов. Подключи их через сайт.');
      } else {
        let accountsText = '👥 *Твои привязанные аккаунты:*\n\n';
        for (const u of users) {
          accountsText += `👤 **${u.login}**\n🏆 Опыт: ${u.xp} XP\n🏅 Лига: ${u.league}\n🔥 Серия: ${u.streak} дн.\n❤️ Жизни: ${u.lives}/5\n\n`;
        }
        await bot.sendMessage(chatId, accountsText, { parse_mode: 'Markdown' });
      }
    } else if (text === '🔗 Отвязать аккаунт') {
      if (users.length === 0) {
        return bot.sendMessage(chatId, 'У вас нет привязанных аккаунтов.');
      }
      // Предлагаем выбрать аккаунт через инлайн-кнопки
      const inlineKeyboard = {
        reply_markup: {
          inline_keyboard: users.map(u => [{
            text: `${u.login} (${u.xp} XP)`,
            callback_data: `unbind_${u.login}`
          }])
        }
      };
      await bot.sendMessage(chatId, 'Выберите аккаунт для отвязки:', inlineKeyboard);
    }
  } catch (error) {
    console.error('Error in message handler:', error.message);
    if (error.message.includes('EPROTO') || error.message.includes('SSL')) {
      console.log('SSL Error in message handler (ignored):', error.message);
      return;
    }
    bot.sendMessage(chatId, '⚠️ Ошибка при обработке сообщения.');
  }
});

// Обработка нажатий на инлайн-кнопки
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('unbind_')) {
    const login = data.replace('unbind_', '');
    try {
      await api.post('/api/user/unlink-telegram', { login });
      await bot.sendMessage(chatId, `✅ Аккаунт **${login}** успешно отвязан.`, { parse_mode: 'Markdown' });
      // Удаляем сообщение с кнопками
      await bot.deleteMessage(chatId, callbackQuery.message.message_id);
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error('Unbind error:', err.message);
      if (err.message.includes('EPROTO') || err.message.includes('SSL')) {
        console.log('SSL Error in unbind (ignored):', err.message);
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }
      await bot.sendMessage(chatId, `❌ Не удалось отвязать аккаунт ${login}. Попробуйте позже.`);
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  }
});

console.log('🤖 Telegram bot started with SSL bypass');