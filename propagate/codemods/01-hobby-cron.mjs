/**
 * Throttle Vercel cron schedules to once daily on Hobby plans.
 *
 * @param {import('@propagate/core').CodemodContext} ctx
 * @param {import('@propagate/core').CodemodFs} fs
 */
export default async function apply(ctx, fs) {
  if (ctx.provider.vercel.plan !== 'hobby') return;

  const cfg = fs.readJson('vercel.json');
  if (!cfg.crons || !Array.isArray(cfg.crons)) return;

  const daily = '0 0 * * *';
  let changed = false;

  for (const cron of cfg.crons) {
    if (typeof cron.schedule === 'string' && cron.schedule !== daily) {
      cron.schedule = daily;
      changed = true;
    }
  }

  if (changed) {
    fs.writeJson('vercel.json', cfg, 4);
  }
}
