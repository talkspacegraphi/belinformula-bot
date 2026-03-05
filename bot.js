require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const https = require('https');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN provided');
  process.exit(1);
}

const API_BASE_URL = process.env.API_BASE_URL || 'https://b.zeroyt.ru';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Health check server listening on port ${PORT}`);
});

const bot = new TelegramBot(token, {
  polling: true,
  polling_options: {
    timeout: 30,
    interval: 300
  },
  request: {
    timeout: 30000,
    agent: httpsAgent
  }
});

const api = axios.create({
  baseURL: API_BASE_URL,
  httpsAgent: httpsAgent,
  timeout: 30000
});

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

// Полная клавиатура со всеми кнопками
const fullKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: '🆘 Помощь' }, { text: '👥 Мои аккаунты' }],
      [{ text: '🔗 Отвязать аккаунт' }]
    ],
    resize_keyboard: true
  }
};

// Минимальная клавиатура (только помощь)
const minimalKeyboard = {
  reply_markup: {
    keyboard: [[{ text: '🆘 Помощь' }]],
    resize_keyboard: true
  }
};

// Обработка /start
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match[1];

  try {
    if (param) {
      console.log(`🔗 Привязка с параметром: ${param}`);
      
      if (param.startsWith('user_')) {
        // Безопасная привязка по ID
        const userId = param.replace('user_', '');
        
        const response = await api.post('/api/user/secure-link-telegram', {
          userId: userId,
          telegramChatId: chatId.toString()
        });
        
        const user = response.data;
        
        // Отправляем сообщение с ПОЛНОЙ клавиатурой
        await bot.sendMessage(
          chatId,
          `✅ Аккаунт **${user.login}** успешно привязан! 👋\n\nТеперь я буду оповещать тебя, когда тебе нужно зайти на сайт, выполнить задания и не потерять серию 🔥.`,
          { parse_mode: 'Markdown', ...fullKeyboard }
        );
        
        console.log(`✅ Пользователь ${user.login} привязал Telegram`);
      } else {
        // Старый небезопасный метод - показываем сообщение об ошибке
        await bot.sendMessage(
          chatId,
          '❌ Устаревший метод привязки. Пожалуйста, используйте кнопку на сайте для подключения.'
        );
      }
    } else {
      // Обычный /start без параметра
      console.log(`📱 Новый пользователь: ${chatId}`);
      
      // Проверяем, есть ли уже привязанные аккаунты у этого chatId
      try {
        const users = await api.get(`/api/user/by-telegram/${chatId}`).then(res => res.data);
        
        if (users && users.length > 0) {
          // У пользователя уже есть привязанные аккаунты - показываем полную клавиатуру
          await bot.sendMessage(
            chatId,
            `👋 С возвращением! У вас привязано ${users.length} аккаунт(ов).`,
            fullKeyboard
          );
        } else {
          // Новый пользователь - показываем минимальную клавиатуру
          await bot.sendMessage(
            chatId,
            'Добро пожаловать в бота BELIMFORMULA! 🎓\n\nЧтобы привязать аккаунт, зайди в **настройки** на сайте и нажми кнопку «Подключить Telegram».',
            { parse_mode: 'Markdown', ...minimalKeyboard }
          );
        }
      } catch (error) {
        // Если ошибка при проверке, показываем минимальную клавиатуру
        console.error('Ошибка при проверке пользователей:', error.message);
        await bot.sendMessage(
          chatId,
          'Добро пожаловать в бота BELIMFORMULA! 🎓\n\nЧтобы привязать аккаунт, зайди в **настройки** на сайте и нажми кнопку «Подключить Telegram».',
          { parse_mode: 'Markdown', ...minimalKeyboard }
        );
      }
    }
  } catch (error) {
    console.error('❌ Error in /start handler:', error.message);
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
    console.log(`📨 Сообщение от ${chatId}: ${text}`);
    
    const users = await api.get(`/api/user/by-telegram/${chatId}`).then(res => res.data);
    const hasAccounts = users && users.length > 0;

    if (text === '🆘 Помощь') {
      let helpText = '🤖 **Как это работает?**\n\n';
      helpText += 'Я слежу за твоими аккаунтами и напоминаю, если огненная серия 🔥 может сгореть.\n\n';
      helpText += '**Кнопки в меню:**\n';
      helpText += '• 👥 **Мои аккаунты** — покажет список всех привязанных аккаунтов и их статистику.\n';
      helpText += '• 🔗 **Отвязать аккаунт** — отвяжет выбранный аккаунт от Telegram.\n';
      helpText += '• 🆘 **Помощь** — это сообщение.\n\n';
      
      if (!hasAccounts) {
        helpText += '💡 **У вас пока нет привязанных аккаунтов.**\n';
        helpText += 'Зайдите в настройки на сайте и нажмите кнопку «Подключить Telegram».';
      }
      
      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
      
    } else if (text === '👥 Мои аккаунты') {
      if (!hasAccounts) {
        await bot.sendMessage(chatId, 'У тебя пока нет привязанных аккаунтов. Подключи их через сайт.');
      } else {
        let accountsText = '👥 **Твои привязанные аккаунты:**\n\n';
        for (const u of users) {
          accountsText += `👤 **${u.login}**\n`;
          accountsText += `🏆 Опыт: ${u.xp} XP\n`;
          accountsText += `🏅 Лига: ${u.league || 'Бронза'}\n`;
          accountsText += `🔥 Серия: ${u.streak || 0} дн.\n`;
          accountsText += `❤️ Жизни: ${u.lives}/5\n\n`;
        }
        await bot.sendMessage(chatId, accountsText, { parse_mode: 'Markdown' });
      }
      
    } else if (text === '🔗 Отвязать аккаунт') {
      if (!hasAccounts) {
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
      await api.post('/api/user/unlink-telegram', { login });
      
      // После успешной отвязки отправляем подтверждение
      await bot.sendMessage(chatId, `✅ Аккаунт **${login}** успешно отвязан.`, { parse_mode: 'Markdown' });
      
      // Удаляем сообщение с кнопками
      await bot.deleteMessage(chatId, callbackQuery.message.message_id);
      
      // Проверяем, остались ли у пользователя привязанные аккаунты
      const users = await api.get(`/api/user/by-telegram/${chatId}`).then(res => res.data);
      
      if (users.length === 0) {
        // Если аккаунтов не осталось, предлагаем обновить клавиатуру
        await bot.sendMessage(
          chatId,
          'У вас больше нет привязанных аккаунтов. Чтобы привязать новый, зайдите в настройки на сайте.',
          minimalKeyboard
        );
      } else {
        // Если остались, показываем актуальную клавиатуру
        await bot.sendMessage(
          chatId,
          `У вас осталось ${users.length} привязанных аккаунтов.`,
          fullKeyboard
        );
      }
      
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error('Unbind error:', err);
      await bot.sendMessage(chatId, `❌ Не удалось отвязать аккаунт ${login}. Попробуйте позже.`);
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  }
});

console.log('🤖 Telegram bot started with full keyboard support');