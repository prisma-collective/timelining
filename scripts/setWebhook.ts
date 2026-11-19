import axios from "axios";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import inquirer from "inquirer";
import { isValidSecretToken } from "../src/lib/telegram-webhook-auth";

async function promptForMissingInput(token?: string, url?: string) {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "token",
      message: "Enter your Telegram bot token:",
      when: () => !token,
      validate: (val) => val.startsWith("bot") || val.length > 30 || "Invalid token",
    },
    {
      type: "input",
      name: "url",
      message: "Enter your webhook URL:",
      when: () => !url,
      validate: (val) => val.startsWith("https://") || "URL must start with https://",
    },
  ]);

  return {
    token: token || answers.token,
    url: url || answers.url,
  };
}

async function getCurrentWebhook(token: string) {
  const endpoint = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const response = await axios.get(endpoint);
  return response.data.result?.url || null;
}

async function setWebhook(token: string, url: string, secret: string) {
  const endpoint = `https://api.telegram.org/bot${token}/setWebhook`;
  const response = await axios.post(endpoint, { 
    url, 
    // Telegram sends it back on every update; the webhook refuses updates without it.
    secret_token: secret,
    allowed_updates: [
      "message",
    ],
   });
  return response.data;
}

async function main() {
    const argv = yargs(hideBin(process.argv))
        .option("token", {
        type: "string",
        description: "Telegram bot token",
        })
        .option("url", {
        type: "string",
        description: "Webhook URL",
        })
        .option("secret", {
        type: "string",
        description: "secret_token: the same value as TELEGRAM_WEBHOOK_SECRET on the deployment (defaults to that env var)",
        })
        .help()
        .parseSync();

  const { token, url } = await promptForMissingInput(argv.token, argv.url);
  const secret = argv.secret ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!isValidSecretToken(secret)) {
    console.error("❌ Give --secret (or TELEGRAM_WEBHOOK_SECRET): 1-256 characters, A-Z a-z 0-9 _ -. The webhook refuses updates without it.");
    process.exit(1);
  }

  try {
    const currentWebhook = await getCurrentWebhook(token);

    if (currentWebhook) {
      console.log(`📍 Existing webhook is set to: ${currentWebhook}`);
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Do you want to overwrite the current webhook?",
          default: false,
        },
      ]);

      if (!confirm) {
        console.log("❌ Aborted. Webhook not changed.");
        return;
      }
    } else {
      console.log("ℹ️ No existing webhook found.");
    }

    const result = await setWebhook(token, url, secret);
    console.log("✅ Webhook set:", result);
  } catch (error: any) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
}

main();
