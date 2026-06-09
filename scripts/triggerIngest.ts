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

  try {
    await axios.post(fullUrl);
    console.log("✅ Ingest cron triggered at", fullUrl);
  } catch (err: any) {
    console.error("❌ Error triggering ingest:", err?.message ?? err);
  }
})();
