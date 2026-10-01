// Lightweight scheduled dispatcher; no sandbox or model calls run on the edge.
export default {
  async scheduled(_event, env, ctx) {
    const url = new URL(env.POCKET_API_URL);
    if (url.protocol !== 'https:') throw new Error('Pocket API must use HTTPS');
    const batch = Math.max(1, Math.min(25, Number(env.DISPATCH_BATCH ?? 4)));
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/jobs?status=eq.queued&select=id&limit=${batch}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error(`Queue inspection failed: ${response.status}`);
    const jobs = await response.json();
    // Each request holds compute only for one claimed job. PostgreSQL arbitrates claims.
    for (const _job of jobs)
      ctx.waitUntil(
        fetch(new URL('/internal/drain', url), {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.WORKER_DISPATCH_SECRET}` },
          signal: AbortSignal.timeout(720000),
        }).then((response) => {
          if (!response.ok) throw new Error(`Drain failed: ${response.status}`);
        }),
      );
  },
};
