import { Telegraf } from 'telegraf';
import type { Logger } from 'pino';
import type {
  MessagingAdapter,
  AdapterContext,
  CallbackContext,
  CommandHandler,
  CallbackHandler,
  SendOptions,
  InlineOption,
  Config,
} from '../../types.js';
import { isInAllowlist } from './auth.js';

export class TelegramAdapter implements MessagingAdapter {
  private bot: Telegraf;
  private config: Config;
  private log: Logger;
  private pendingNotes = new Map<string, string>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(config: Config, log: Logger) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.config = config;
    this.log = log;
    this.bot.use((ctx, next) => {
      if (ctx.chat?.id?.toString() !== config.telegram.groupId) return;
      return next();
    });
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    if (entry.count >= this.config.behavior.rateLimitPerMin) return true;
    entry.count++;
    return false;
  }

  async isAuthorized(userId: string, username: string): Promise<boolean> {
    if (isInAllowlist(username, this.config.telegram.allowedUsers)) return true;
    try {
      const member = await this.bot.telegram.getChatMember(
        this.config.telegram.groupId,
        parseInt(userId, 10),
      );
      return ['administrator', 'creator'].includes(member.status);
    } catch {
      return false;
    }
  }

  async sendMessage(text: string, options?: SendOptions): Promise<void> {
    const preview = text.replace(/\n/g, ' ').slice(0, 120);
    this.log.info({ preview }, 'bot → group');
    await this.bot.telegram.sendMessage(this.config.telegram.groupId, text, {
      parse_mode: options?.parseMode,
    });
  }

  async sendDocument(filename: string, content: Buffer, caption?: string): Promise<void> {
    this.log.info({ filename, bytes: content.length, caption }, 'bot → group (document)');
    await this.bot.telegram.sendDocument(
      this.config.telegram.groupId,
      { source: content, filename },
      { caption },
    );
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.bot.command(command, async (ctx) => {
      const userId = ctx.from?.id?.toString() ?? '';
      const username = ctx.from?.username ?? ctx.from?.first_name ?? 'unknown';

      if (this.checkRateLimit(userId)) {
        this.log.warn({ userId, username, command }, 'rate limit exceeded');
        await ctx.reply('Rate limit exceeded. Please wait a minute before trying again.');
        return;
      }

      const fullText = (ctx.message as { text?: string }).text ?? '';
      const commandText = fullText.replace(/^\/\w+(@\w+)?\s*/, '');

      this.log.info({ userId, username, command, args: commandText || '(none)' }, `← /${command}`);

      const pending = this.pendingNotes;
      const adapterCtx: AdapterContext = {
        userId,
        username,
        text: commandText,
        replyText: async (msg, opts) => {
          const preview = msg.replace(/\n/g, ' ').slice(0, 120);
          this.log.info({ to: username, preview }, `bot → @${username}`);
          await ctx.reply(msg, { parse_mode: opts?.parseMode });
        },
        showOptions: async (msg, options: InlineOption[]) => {
          this.log.info({ to: username, optionCount: options.length }, `bot → @${username} (inline keyboard)`);
          await ctx.reply(msg, {
            reply_markup: {
              inline_keyboard: [options.map(o => ({ text: o.label, callback_data: o.callbackData }))],
            },
          });
        },
        setPendingNote: (text) => { pending.set(userId, text); },
        getPendingNote: () => pending.get(userId),
        clearPendingNote: () => { pending.delete(userId); },
      };

      try {
        await handler(adapterCtx);
      } catch (err) {
        this.log.error({ err }, `Error in /${command} handler`);
        await ctx.reply('An unexpected error occurred. Please try again.');
      }
    });
  }

  onCallback(action: string, handler: CallbackHandler): void {
    this.bot.action(new RegExp(`^${action}:`), async (ctx) => {
      const userId = ctx.from?.id?.toString() ?? '';
      const username = ctx.from?.username ?? ctx.from?.first_name ?? 'unknown';
      const callbackData = (ctx.callbackQuery as { data?: string }).data ?? '';
      const pending = this.pendingNotes;

      this.log.info({ userId, username, callbackData }, `← callback`);

      const callbackCtx: CallbackContext = {
        userId,
        username,
        callbackData,
        replyText: async (msg, opts) => {
          const preview = msg.replace(/\n/g, ' ').slice(0, 120);
          this.log.info({ to: username, preview }, `bot → @${username}`);
          await ctx.reply(msg, { parse_mode: opts?.parseMode });
        },
        answerCallback: async () => { await ctx.answerCbQuery(); },
        getPendingNote: () => pending.get(userId),
        clearPendingNote: () => { pending.delete(userId); },
      };

      try {
        await handler(callbackCtx);
      } catch (err) {
        this.log.error({ err }, `Error in callback ${action}`);
        await ctx.answerCbQuery('An error occurred.');
      }
    });
  }

  async start(): Promise<void> {
    this.log.info('Starting Telegram bot (long polling)...');
    await this.bot.launch();
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}
