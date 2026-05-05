/// <reference types="@cloudflare/workers-types" />
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
import { isInAllowlist } from '../../messaging/telegram/auth.js';
import { getPendingState, setPendingState, clearPendingState } from './kv-state.js';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export class CloudflareAdapter implements MessagingAdapter {
  private config: Config;
  private kv: KVNamespace;
  private commandHandlers = new Map<string, CommandHandler>();
  private callbackHandlers = new Map<string, CallbackHandler>();
  private apiBase: string;

  constructor(config: Config, kv: KVNamespace) {
    this.config = config;
    this.kv = kv;
    this.apiBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
  }

  private async telegramPost(method: string, body: object): Promise<Response> {
    return fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async sendMessage(text: string, options?: SendOptions): Promise<void> {
    await this.telegramPost('sendMessage', {
      chat_id: this.config.telegram.groupId,
      text,
      parse_mode: options?.parseMode,
    });
  }

  async sendDocument(filename: string, content: Buffer, caption?: string): Promise<void> {
    const form = new FormData();
    form.append('chat_id', this.config.telegram.groupId);
    form.append('document', new Blob([new Uint8Array(content)]), filename);
    if (caption) form.append('caption', caption);
    await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: form });
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler);
  }

  onCallback(action: string, handler: CallbackHandler): void {
    this.callbackHandlers.set(action, handler);
  }

  async isAuthorized(userId: string, username: string): Promise<boolean> {
    if (isInAllowlist(username, this.config.telegram.allowedUsers)) return true;
    try {
      const res = await this.telegramPost('getChatMember', {
        chat_id: this.config.telegram.groupId,
        user_id: parseInt(userId, 10),
      });
      const data = await res.json() as { result?: { status?: string } };
      return ['administrator', 'creator'].includes(data.result?.status ?? '');
    } catch {
      return false;
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id.toString();
    if (chatId !== this.config.telegram.groupId) return;

    const text = message.text ?? '';
    if (!text.startsWith('/')) return;

    const commandMatch = text.match(/^\/(\w+)(@\w+)?/);
    if (!commandMatch) return;
    const command = commandMatch[1];
    const commandText = text.replace(/^\/\w+(@\w+)?\s*/, '');

    const handler = this.commandHandlers.get(command);
    if (!handler) return;

    const userId = message.from?.id?.toString() ?? '';
    const username = message.from?.username ?? message.from?.first_name ?? 'unknown';

    const pending = await getPendingState(this.kv, userId);
    let pendingText: string | undefined = pending?.text;
    let kvSetText: string | null = null;
    let kvClear = false;

    const replyFn = async (msg: string, opts?: SendOptions) => {
      await this.telegramPost('sendMessage', {
        chat_id: chatId,
        text: msg,
        parse_mode: opts?.parseMode,
      });
    };

    const adapterCtx: AdapterContext = {
      userId,
      username,
      text: commandText,
      replyText: replyFn,
      showOptions: async (msg: string, options: InlineOption[]) => {
        await this.telegramPost('sendMessage', {
          chat_id: chatId,
          text: msg,
          reply_markup: {
            inline_keyboard: options.map(o => [{ text: o.label, callback_data: o.callbackData }]),
          },
        });
      },
      setPendingNote: (t: string) => { pendingText = t; kvSetText = t; },
      getPendingNote: () => pendingText,
      clearPendingNote: () => { pendingText = undefined; kvClear = true; },
    };

    try {
      await handler(adapterCtx);
    } catch {
      await replyFn('An unexpected error occurred. Please try again.');
    }

    if (kvSetText !== null) {
      await setPendingState(this.kv, userId, { text: kvSetText });
    } else if (kvClear) {
      await clearPendingState(this.kv, userId);
    }
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const userId = query.from.id.toString();
    const username = query.from.username ?? query.from.first_name ?? 'unknown';
    const callbackData = query.data ?? '';
    const chatId = query.message?.chat.id.toString() ?? this.config.telegram.groupId;

    let matchedHandler: CallbackHandler | undefined;
    for (const [action, handler] of this.callbackHandlers) {
      if (callbackData.startsWith(`${action}:`)) {
        matchedHandler = handler;
        break;
      }
    }
    if (!matchedHandler) return;

    const pending = await getPendingState(this.kv, userId);
    let pendingText: string | undefined = pending?.text;
    let shouldClear = false;

    const replyFn = async (msg: string, opts?: SendOptions) => {
      await this.telegramPost('sendMessage', {
        chat_id: chatId,
        text: msg,
        parse_mode: opts?.parseMode,
      });
    };

    const callbackCtx: CallbackContext = {
      userId,
      username,
      callbackData,
      replyText: replyFn,
      answerCallback: async () => {
        await this.telegramPost('answerCallbackQuery', { callback_query_id: query.id });
      },
      getPendingNote: () => pendingText,
      clearPendingNote: () => { pendingText = undefined; shouldClear = true; },
    };

    try {
      await matchedHandler(callbackCtx);
    } catch {
      await this.telegramPost('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'An error occurred.',
      });
    }

    if (shouldClear) {
      await clearPendingState(this.kv, userId);
    }
  }

  async start(): Promise<void> {
    throw new Error('start() is not available in CF Workers mode — use handleUpdate() instead');
  }
}
