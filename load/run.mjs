/**
 * Load test for CTF-Builder.
 *
 * Builds a throwaway event, fills it with teams and solves, then hammers the two paths that
 * decide whether a CTF survives its own final minutes:
 *
 *   - the write path: a flag submission, which inserts a row, rebuilds the whole leaderboard and
 *     pushes it to every connected client before answering;
 *   - the read path: the public scoreboard, which should be a Redis read and never touch Postgres.
 *
 * It speaks HTTP only, so it works against a local dev server or a deployed one.
 *
 *   node load/run.mjs                                  # defaults below
 *   node load/run.mjs --teams 50 --readers 100 --seconds 20
 *   node load/run.mjs --url https://ctf.example.com --keep
 *
 * The server's own brute-force limits will throttle a run of any size, which is the point of
 * having them. Raise AUTH_RATE_LIMIT_MAX and FLAG_RATE_LIMIT_MAX before testing, or the script
 * will stop and tell you it was rate limited.
 */

const options = {
  url: 'http://localhost:4000',
  user: process.env.LOAD_ADMIN_USER ?? 'admin',
  password: process.env.LOAD_ADMIN_PASSWORD ?? 'admin-demo-pass',
  teams: 25,
  challenges: 10,
  readers: 50,
  seconds: 15,
  keep: false,
};

for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options)) throw new Error(`Unknown option --${key}`);
  if (typeof options[key] === 'boolean') options[key] = true;
  else options[key] = typeof options[key] === 'number' ? Number(process.argv[++i]) : process.argv[++i];
}

const RUN = Math.random().toString(36).slice(2, 8);

class LoadError extends Error {}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${options.url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    throw new LoadError(
      `The server rate limited ${method} ${path}. Raise AUTH_RATE_LIMIT_MAX / FLAG_RATE_LIMIT_MAX ` +
        'on the server and run again.',
    );
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new LoadError(`${method} ${path} -> ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Runs `task` over `items` with at most `limit` in flight, which is what load actually means. */
async function pooled(items, limit, task) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
  };
}

const ms = (value) => `${value.toFixed(1)} ms`;

function report(title, summary, extra = {}) {
  console.log(`\n${title}`);
  console.log(`  requests  ${summary.count}`);
  console.log(`  mean      ${ms(summary.mean)}`);
  console.log(`  p50       ${ms(summary.p50)}`);
  console.log(`  p95       ${ms(summary.p95)}`);
  console.log(`  p99       ${ms(summary.p99)}`);
  console.log(`  max       ${ms(summary.max)}`);
  for (const [label, value] of Object.entries(extra)) console.log(`  ${label.padEnd(9)} ${value}`);
}

const timed = async (fn) => {
  const started = performance.now();
  await fn();
  return performance.now() - started;
};

// ---- Phases ----

async function setup() {
  console.log(`Target ${options.url}`);
  const { token } = await call('/api/auth/login', {
    method: 'POST',
    body: { username: options.user, password: options.password },
  });

  const startsAt = new Date(Date.now() - 60_000);
  const { event } = await call('/api/admin/events', {
    method: 'POST',
    token,
    body: {
      name: `Load Test ${RUN}`,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    },
  });

  const challenges = await pooled(
    Array.from({ length: options.challenges }, (_, i) => i),
    8,
    async (i) => {
      const flag = `CTF{load_${RUN}_${i}}`;
      const { challenge } = await call(`/api/admin/events/${event.id}/challenges`, {
        method: 'POST',
        token,
        body: {
          title: `Load ${RUN} #${i}`,
          category: 'misc',
          flag,
          isHidden: false,
          initialPoints: 500,
          minPoints: 100,
          decay: 25,
        },
      });
      return { id: challenge.id, flag };
    },
  );

  console.log(`Created event ${event.id} with ${challenges.length} challenges.`);
  return { adminToken: token, event, challenges };
}

async function makeTeams(event) {
  const registrations = await pooled(
    Array.from({ length: options.teams }, (_, i) => i),
    10,
    async (i) => {
      const username = `load_${RUN}_${i}`;
      const { token } = await call('/api/auth/register', {
        method: 'POST',
        body: { username, email: `${username}@load.test`, password: 'load-test-password' },
      });
      await call(`/api/events/${event.id}/teams`, { method: 'POST', token, body: { name: `Team ${RUN} ${i}` } });
      return token;
    },
  );
  console.log(`Registered ${registrations.length} players, each on their own team.`);
  return registrations;
}

/** Every team solves every challenge, which is the heaviest the write path ever gets. */
async function solvePhase(event, challenges, tokens) {
  const jobs = tokens.flatMap((token) => challenges.map((challenge) => ({ token, challenge })));
  const wrong = [];
  const samples = await pooled(jobs, 16, async ({ token, challenge }) => {
    let result;
    const elapsed = await timed(async () => {
      result = await call(`/api/events/${event.id}/challenges/${challenge.id}/submissions`, {
        method: 'POST',
        token,
        body: { flag: challenge.flag },
      });
    });
    if (result.result !== 'correct') wrong.push(result.result);
    return elapsed;
  });

  report('Flag submissions (insert + leaderboard rebuild + push)', stats(samples), {
    rejected: wrong.length === 0 ? 'none' : `${wrong.length} (${[...new Set(wrong)].join(', ')})`,
  });
  return samples;
}

async function readPhase(event) {
  const path = `/api/events/${event.id}/scoreboard`;
  const samples = [];
  let failures = 0;
  const until = performance.now() + options.seconds * 1000;

  const started = performance.now();
  await Promise.all(
    Array.from({ length: options.readers }, async () => {
      while (performance.now() < until) {
        try {
          samples.push(await timed(() => call(path)));
        } catch {
          failures++;
        }
      }
    }),
  );
  const totalSeconds = (performance.now() - started) / 1000;

  report(`Scoreboard reads (${options.readers} concurrent, ${options.seconds}s)`, stats(samples), {
    'req/s': (samples.length / totalSeconds).toFixed(0),
    failures: failures === 0 ? 'none' : failures,
  });
}

// ---- Run ----

let created;
try {
  created = await setup();
  const tokens = await makeTeams(created.event);
  await solvePhase(created.event, created.challenges, tokens);
  await readPhase(created.event);
} catch (err) {
  if (err instanceof LoadError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  if (created && !options.keep) {
    // Deleting the event cascades to its challenges, teams and submissions. The load accounts
    // stay: they own nothing now, and removing users is not something the API offers.
    await call(`/api/admin/events/${created.event.id}`, { method: 'DELETE', token: created.adminToken });
    console.log(`\nRemoved the load-test event. Pass --keep to leave it in place.`);
  }
}
