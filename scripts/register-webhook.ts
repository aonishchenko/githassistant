import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = process.env.CF_WORKER_URL;

if (!token || !workerUrl) {
  console.error('Error: TELEGRAM_BOT_TOKEN and CF_WORKER_URL must be set in your .env');
  console.error('  CF_WORKER_URL example: https://githassistant.<subdomain>.workers.dev');
  process.exit(1);
}

const webhookUrl = `${workerUrl.replace(/\/$/, '')}/webhook`;
const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

console.log(`Registering Telegram webhook → ${webhookUrl}`);

const res = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl }),
});

const data = await res.json() as { ok: boolean; description?: string };
console.log('Telegram response:', JSON.stringify(data, null, 2));

if (!data.ok) {
  console.error(`Failed: ${data.description ?? 'unknown error'}`);
  process.exit(1);
}

console.log('Webhook registered successfully.');
