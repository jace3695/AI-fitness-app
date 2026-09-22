import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// No login/link/db-push, hosted URL, project credentials, or personal backups.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP) {
  throw new Error('This launcher is for a disposable GitHub Actions runner.');
}
const workdir = resolve('.e2e/stack');
const cli = resolve('node_modules/.bin/supabase');
const run = (...args) => execFileSync(cli, [...args, '--workdir', workdir], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
});
const redact = text => String(text).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-jwt]').replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]');
try {
  if (process.argv[2] === 'stop') {
    if (existsSync(`${workdir}/supabase/config.toml`)) run('stop', '--no-backup');
    rmSync('.e2e/stack', { recursive: true, force: true });
    rmSync('.e2e/stack-status.json', { force: true });
    console.log('Disposable Supabase containers/volumes and local keys removed.');
  } else if (process.argv[2] === 'start') {
    mkdirSync(workdir, { recursive: true });
    // Discover the pinned CLI's interface on the runner before invoking it.
    run('--help'); run('init', '--help'); run('start', '--help'); run('status', '--help');
    run('init');
    // All isolated test users share one runner IP. This fixture is not an Auth
    // rate-limit test; keep the hosted project's limits completely untouched.
    const configPath = `${workdir}/supabase/config.toml`;
    const config = readFileSync(configPath, 'utf8');
    if (!/^sign_in_sign_ups\s*=\s*\d+/m.test(config)) throw new Error('Pinned CLI rate-limit config changed');
    writeFileSync(configPath, config.replace(/^sign_in_sign_ups\s*=\s*\d+/m, 'sign_in_sign_ups = 600'));
    copyFileSync('tests/e2e/schema.sql', `${workdir}/supabase/seed.sql`);
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260901125340_add_fitness_ai_review_history.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260908233141_app_wide_reliability.sql', 'utf8').split('alter table public.assistant_items')[0]);
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260914113147_budget_category_history.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260914131417_budget_expense_fields.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260914225836_budget_payment_plans.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260915011629_zephyr_free_character_guard.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260915034857_assistant_task_command_history.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260915052413_chatgpt_scoped_connection.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916043619_assistant_language_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916045546_language_history_reset_triggers.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916094552_assistant_workout_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916104440_assistant_diet_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916113939_assistant_growth_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916131029_assistant_diet_meal_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916142043_assistant_diet_time_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260916232300_assistant_workout_cardio_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260918042857_assistant_workout_feedback_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260917031601_assistant_task_completion_commands.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260922051814_add_private_drawing_attempts.sql', 'utf8'));
    const growthSchema = readFileSync('supabase/migrations/20260902120000_add_growth_platform.sql', 'utf8');
    const resourceTable = growthSchema.slice(growthSchema.indexOf('create table if not exists public.growth_resources'), growthSchema.indexOf('create table if not exists public.growth_ai_reviews'));
    const resourcePolicies = growthSchema.slice(growthSchema.indexOf('drop policy if exists "Users can read own growth resources"'), growthSchema.indexOf('drop policy if exists "Users can read own growth AI reviews"'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + resourceTable + '\n' + `
      alter table public.growth_resources enable row level security;
      revoke all on public.growth_resources from anon, authenticated;
      grant select, insert, delete on public.growth_resources to authenticated;
      grant update (routine_id, title, category, classification, notes, updated_at) on public.growth_resources to authenticated;
      grant all on public.growth_resources to service_role;
    ` + resourcePolicies);
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260902223000_harden_growth_routine_links.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260917084426_growth_resource_usage.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260917114328_diet_meal_favorites.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + readFileSync('supabase/migrations/20260917133223_workout_actual_times.sql', 'utf8'));
    appendFileSync(`${workdir}/supabase/seed.sql`, '\n' + growthSchema.slice(growthSchema.indexOf('insert into storage.buckets')));
    console.log('Starting isolated Auth, PostgREST, Storage and Postgres…');
    run('start', '--exclude', 'studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor');
    const status = JSON.parse(run('status', '--output', 'json'));
    if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
      throw new Error('The disposable stack did not return the expected local credentials.');
    }
    writeFileSync('.e2e/stack-status.json', JSON.stringify(status), { mode: 0o600 });
    // The service-role key stays in the runner's ignored fixture file, never in
    // the Next/browser environment or uploaded reports. Public anon JWT only.
    console.log(`::add-mask::${status.ANON_KEY}`);
    console.log(`::add-mask::${status.SERVICE_ROLE_KEY}`);
    appendFileSync(process.env.GITHUB_ENV, `YEONI_E2E=1\nNEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`);
    console.log('Isolated stack ready; no hosted project was contacted.');
  } else throw new Error('Use start or stop.');
} catch (error) {
  console.error(redact(error.stderr || error.message));
  process.exitCode = 1;
}
