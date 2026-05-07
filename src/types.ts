export interface Config {
  telegram: {
    botToken: string;
    groupId: string;
    allowedUsers: string[];
  };
  github: {
    token: string;
    owner: string;
    repo: string;
    defaultBranch: string;
  };
  note: {
    allowedPaths: string[];
    excludedPaths: string[];
    shortcuts: Record<string, string>;
    allowedExtensions: string[];
  };
  meeting: {
    notesFolder: string;
  };
  ai: {
    provider: string;
    anthropicApiKey: string;
    anthropicModel: string;
    openaiApiKey: string;
    openaiModel: string;
  };
  scheduler: {
    nightlyCron: string;
    timezone: string;
  };
  behavior: {
    summaryMaxDays: number;
    squashEnabled: boolean;
    summaryLanguage: string;
    logLevel: string;
    rateLimitPerMin: number;
  };
}

export interface SendOptions {
  parseMode?: 'Markdown' | 'HTML';
}

export interface InlineOption {
  label: string;
  callbackData: string;
}

export interface AdapterContext {
  userId: string;
  username: string;
  text: string;
  replyText(text: string, options?: SendOptions): Promise<void>;
  showOptions(text: string, options: InlineOption[]): Promise<void>;
  setPendingNote(text: string): void;
  getPendingNote(): string | undefined;
  clearPendingNote(): void;
}

export interface CallbackContext {
  userId: string;
  username: string;
  callbackData: string;
  replyText(text: string, options?: SendOptions): Promise<void>;
  answerCallback(): Promise<void>;
  getPendingNote(): string | undefined;
  clearPendingNote(): void;
}

export type CommandHandler = (ctx: AdapterContext) => Promise<void>;
export type CallbackHandler = (ctx: CallbackContext) => Promise<void>;

export interface MessagingAdapter {
  sendMessage(text: string, options?: SendOptions): Promise<void>;
  sendDocument(filename: string, content: Buffer, caption?: string): Promise<void>;
  onCommand(command: string, handler: CommandHandler): void;
  onCallback(action: string, handler: CallbackHandler): void;
  isAuthorized(userId: string, username: string): Promise<boolean>;
  start(): Promise<void>;
}

export interface CommandPlugin {
  command: string;
  description: string;
  requiresAuth: boolean;
  handler: CommandHandler;
}

export interface JobPlugin {
  name: string;
  cronExpression?: string;
  handler: () => Promise<void>;
}

export interface UsageContext {
  trigger: string;  // e.g. 'summary', 'meetingsummary', 'cron:daily'
  username: string; // e.g. '@alice' or 'cron'
}

export type UsageTracker = (record: {
  trigger: string;
  username: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}) => Promise<void>;

export interface AIProvider {
  summarise(prompt: string, content: string, maxTokens?: number, ctx?: UsageContext): Promise<string>;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorLogin: string;
  date: string;
  treeSha: string;
  parentShas: string[];
}

export interface AuthorCommitGroup {
  authorLogin: string;
  commits: GitHubCommit[];
}
