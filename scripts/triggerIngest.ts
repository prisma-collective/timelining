import axios from "axios";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import inquirer from "inquirer";

const argv = yargs(hideBin(process.argv)).options({
  url: { type: 'string', describe: 'Deployment URL' }
}).parseSync();

async function getDeploymentUrl(): Promise<string> {
  if (argv.url) return argv.url;

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "url",
      message: "Enter your deployment URL:",
      validate: (val) =>
        val.startsWith("https://") || "URL must start with https://",
    },
  ]);

  return answers.url;
}

(async () => {
  const baseUrl = await getDeploymentUrl();
  const fullUrl = `${baseUrl}/api/story/ingest`;

  const token = process.env.PRIVATE_API_TOKEN;
  if (!token) {
    console.error("❌ PRIVATE_API_TOKEN is not set");
    process.exit(1);
  }

  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }

  try {
    await axios.post(fullUrl, undefined, { headers });
    console.log("✅ Ingest cron triggered at", fullUrl);
  } catch (err: any) {
    console.error("❌ Error triggering ingest:", err?.message ?? err);
  }
})();
