require('dotenv').config();

const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI не задан в переменных окружения');
  process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не задан в переменных окружения');
  process.exit(1);
}

const UserSchema = new mongoose.Schema({
  login: String,
  xp: Number,
  lives: Number,
  streak: Number,
  lastLogin: Date,
  lastStreakRefresh: Date,
  lastTelegramReminder: Date,
  telegramChatId: String,
  telegramEnabled: Boolean,
  telegramLinkRequested: Date
});

const User = mongoose.model('User', UserSchema, 'users');

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected for Telegram bot');

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  const findUserByChat = async (chatId) => {
    return await User.findOne({ telegramChatId: String(chatId) });
  };

  bot.setMyCommands([
    { command: 'status', description: 'Мой прогресс и серия' },
    { command: 'streak', description: 'Проверить серию' },
    { command: 'unlink', description: 'Отвязать Telegram от аккаунта' },
    { command: 'help', description: 'Помощь по боту' }
  ]);

  bot.onText(/^\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const payload = match && match[1] ? match[1].trim() : '';

    try {
      if (payload && payload.startsWith('user_')) {
        const userId = payload.replace('user_', '');
        const user = await User.findById(userId);
        if (!user) {
          return bot.sendMessage(chatId, 'Аккаунт не найден. Открой сайт и попробуй ещё раз.');
        }

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        if (!user.telegramLinkRequested || user.telegramLinkRequested < tenMinutesAgo) {
          return bot.sendMessage(chatId, 'Ссылка устарела. Переходи из сайта ещё раз, чтобы подключить бота.');
        }

        const existingUser = await User.findOne({
          telegramChatId: String(chatId),
          _id: { $ne: userId }
        });
        if (existingUser) {
          return bot.sendMessage(chatId, 'Этот Telegram уже привязан к другому аккаунту.');
        }

        user.telegramChatId = String(chatId);
        user.telegramEnabled = true;
        user.telegramLinkRequested = null;
        await user.save();

        return bot.sendMessage(chatId, `✅ Telegram успешно привязан к аккаунту ${user.login}!`, {
          reply_markup: {
            keyboard: [
              [{ text: '📊 Мой статус' }],
              [{ text: '🔥 Моя серия' }],
              [{ text: '🔓 Отвязать Telegram' }],
              [{ text: '❓ Помощь' }]
            ],
            resize_keyboard: true
          }
        });
      }

      const user = await findUserByChat(chatId);
      if (!user) {
        return bot.sendMessage(
          chatId,
          'Привет! Чтобы подключить бота, зайди в настройки на сайте BELIMFORMULA и нажми кнопку "Подключить Telegram-бота".'
        );
      }

      bot.sendMessage(chatId, `Привет, ${user.login}! Бот уже подключён ✅`, {
        reply_markup: {
          keyboard: [
            [{ text: '📊 Мой статус' }],
            [{ text: '🔥 Моя серия' }],
            [{ text: '🔓 Отвязать Telegram' }],
            [{ text: '❓ Помощь' }]
          ],
          resize_keyboard: true
        }
      });
    } catch (err) {
      console.error('Telegram /start error:', err);
      bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
  });

  const sendStatus = async (chatId) => {
    const user = await findUserByChat(chatId);
    if (!user) {
      return bot.sendMessage(
        chatId,
        'Telegram ещё не привязан к аккаунту. Зайди в настройки на сайте и нажми "Подключить бота".'
      );
    }
    const todayStr = new Date().toDateString();
    const lastStreak = user.lastStreakRefresh ? user.lastStreakRefresh.toDateString() : '—';
    const seriesToday = user.lastStreakRefresh && lastStreak === todayStr;

    let text = `👤 Аккаунт: ${user.login}\n`;
    text += `⭐ XP: ${user.xp}\n`;
    text += `❤️ Жизни: ${user.lives ?? 5}/5\n`;
    text += `🔥 Серия: ${user.streak || 0} дней\n`;
    text += seriesToday ? '✅ На сегодня серия уже обновлена.\n' : '⚠️ Сегодня серия ещё не обновлена!\n';

    bot.sendMessage(chatId, text);
  };

  bot.onText(/^\/status$/, async (msg) => {
    await sendStatus(msg.chat.id);
  });

  bot.onText(/^\/streak$/, async (msg) => {
    await sendStatus(msg.chat.id);
  });

  bot.onText(/^\/unlink$/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await findUserByChat(chatId);
      if (!user) {
        return bot.sendMessage(chatId, 'Нет привязанного аккаунта.');
      }

      user.telegramChatId = null;
      user.telegramEnabled = false;
      await user.save();

      bot.sendMessage(chatId, `Аккаунт ${user.login} отвязан от Telegram.`, {
        reply_markup: { remove_keyboard: true }
      });
    } catch (err) {
      console.error('Telegram unlink error:', err);
      bot.sendMessage(msg.chat.id, 'Ошибка при отвязке. Попробуйте позже.');
    }
  });

  bot.onText(/^\/help$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'Я напомню, когда серия может сгореть и если ты давно не заходил.\n\n' +
        'Команды:\n' +
        '/status — твой прогресс и жизни\n' +
        '/streak — состояние серии\n' +
        '/unlink — отвязать Telegram\n' +
        '/help — помощь по боту'
    );
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (text === '📊 Мой статус') return sendStatus(chatId);
    if (text === '🔥 Моя серия') return sendStatus(chatId);
    if (text === '🔓 Отвязать Telegram') return bot.emit('text', { ...msg, text: '/unlink' });
    if (text === '❓ Помощь') return bot.emit('text', { ...msg, text: '/help' });
  });

  setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toDateString();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      const users = await User.find({ telegramEnabled: true }).select(
        'login telegramChatId lastLogin lastStreakRefresh lastTelegramReminder streak'
      );
      for (const user of users) {
        if (!user.telegramChatId) continue;

        const lastReminderStr = user.lastTelegramReminder
          ? user.lastTelegramReminder.toDateString()
          : null;
        if (lastReminderStr === todayStr) continue;

        const messages = [];

        if (!user.lastStreakRefresh || user.lastStreakRefresh.toDateString() !== todayStr) {
          messages.push(
            '⚠️ Сегодня ты ещё не обновил свою серию в BELIMFORMULA. Зайди в приложение, чтобы серия не сгорела!'
          );
        }

        if (!user.lastLogin || user.lastLogin < threeDaysAgo) {
          messages.push(
            'Мы давно тебя не видели! Загляни в BELIMFORMULA, чтобы продолжить прогресс и не потерять навыки.'
          );
        }

        if (messages.length > 0) {
          await bot.sendMessage(user.telegramChatId, messages.join('\n\n'));
          user.lastTelegramReminder = now;
          await user.save();
        }
      }
    } catch (err) {
      console.error('Telegram reminder error:', err);
    }
  }, 1000 * 60 * 60 * 6); // каждые 6 часов
}

main().catch((e) => {
  console.error('❌ Bot fatal error:', e);
  process.exit(1);
});

