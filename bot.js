require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express'); // Добавляем express для health check

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN provided');
  process.exit(1);
}

const API_BASE_URL = process.env.API_BASE_URL || 'https://b.zeroyt.ru'; // Меняем на ваш домен с HTTPS

// Создаем HTTP сервер для health check
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint для Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Запускаем HTTP сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check server listening on port ${PORT}`);
});

// Создаем бота с polling
const bot = new TelegramBot(token, { 
  polling: true,
  // Добавляем таймауты для избежания ошибок
  request: {
    timeout: 30000
  }
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  // Игнорируем ошибки связанные с таймаутом, они не критичны
  if (error.code === 'ETIMEDOUT' || error.code === 'EFATAL') {
    console.log('Polling timeout (normal)');
    return;
  }
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

// Обработка /start
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

      // Привязываем chatId
      await axios.post(`${API_BASE_URL}/api/user/link-telegram`, {
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
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
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
    const users = await axios.get(`${API_BASE_URL}/api/user/by-telegram/${chatId}`).then(res => res.data);

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
      await axios.post(`${API_BASE_URL}/api/user/unlink-telegram`, { login });
      await bot.sendMessage(chatId, `✅ Аккаунт **${login}** успешно отвязан.`, { parse_mode: 'Markdown' });
      // Обновляем клавиатуру (удаляем сообщение с кнопками)
      await bot.deleteMessage(chatId, callbackQuery.message.message_id);
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error('Unbind error:', err);
      await bot.sendMessage(chatId, `❌ Не удалось отвязать аккаунт ${login}. Попробуйте позже.`);
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  }
});

console.log('Telegram bot started with health check');