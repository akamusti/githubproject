require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieSession({
  name: 'gitpulse',
  keys: [process.env.SESSION_SECRET || 'gitpulse-dev-secret-change-in-prod'],
  maxAge: 1000 * 60 * 60 * 24 * 7,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));
const GH_TOKEN = process.env.GITHUB_TOKEN || '';

const GH_API = 'https://api.github.com';

function ghHeaders(token) {
  const t = token || GH_TOKEN;
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GitPulse-Dashboard'
  };
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function ghFetch(endpoint, token) {
  const res = await fetch(`${GH_API}${endpoint}`, { headers: ghHeaders(token) });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Fetch all pages of a paginated endpoint (up to `max` items)
async function ghFetchAll(endpoint, token, max = 200) {
  const out = [];
  let page = 1;
  while (out.length < max) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await ghFetch(`${endpoint}${sep}per_page=100&page=${page}`, token);
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < 100) break;
    page++;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

function sessionToken(req) { return req.session?.ghToken || GH_TOKEN; }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, authenticated: !!GH_TOKEN });
});

// User profile
app.get('/api/user/:username', async (req, res) => {
  try {
    const data = await ghFetch(`/users/${encodeURIComponent(req.params.username)}`, sessionToken(req));
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// User repos (all, sorted by stars)
app.get('/api/repos/:username', async (req, res) => {
  try {
    const repos = await ghFetchAll(`/users/${encodeURIComponent(req.params.username)}/repos?sort=updated`, sessionToken(req));
    repos.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
    res.json(repos);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Aggregated stats + languages + top repos + recent events
app.get('/api/stats/:username', async (req, res) => {
  try {
    const username = encodeURIComponent(req.params.username);
    const tok = sessionToken(req);
    const [user, repos, events] = await Promise.all([
      ghFetch(`/users/${username}`, tok),
      ghFetchAll(`/users/${username}/repos?sort=updated`, tok, 300),
      ghFetch(`/users/${username}/events/public?per_page=100`, tok).catch(() => [])
    ]);

    // Language aggregation by repo size (bytes-ish via language endpoint per top repo)
    const langBytes = {};
    // Fetch languages for top 12 repos by stars to stay within rate limits
    const topRepos = [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).slice(0, 12);
    await Promise.all(topRepos.map(async (r) => {
      try {
        const langs = await ghFetch(`/repos/${username}/${encodeURIComponent(r.name)}/languages`, tok);
        for (const [lang, bytes] of Object.entries(langs)) {
          langBytes[lang] = (langBytes[lang] || 0) + bytes;
        }
      } catch (_) { /* ignore */ }
    }));

    const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
    const totalForks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);
    const totalWatchers = repos.reduce((s, r) => s + (r.watchers_count || 0), 0);
    const totalSize = repos.reduce((s, r) => s + (r.size || 0), 0);

    // Activity: commits/events per day (last 90 days from events)
    const now = Date.now();
    const dayMs = 86400000;
    const buckets = {};
    for (let i = 0; i < 90; i++) {
      const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
      buckets[d] = 0;
    }
    (Array.isArray(events) ? events : []).forEach((ev) => {
      const day = (ev.created_at || '').slice(0, 10);
      if (day in buckets) buckets[day] += 1;
    });

    // Streak calculation from activity buckets
    const days = Object.keys(buckets).sort();
    let currentStreak = 0, longestStreak = 0, running = 0;
    for (const d of days) {
      if (buckets[d] > 0) { running += 1; longestStreak = Math.max(longestStreak, running); }
      else { running = 0; }
    }
    // current streak = trailing consecutive active days
    for (let i = days.length - 1; i >= 0; i--) {
      if (buckets[days[i]] > 0) currentStreak += 1; else break;
    }

    res.json({
      user,
      totals: {
        repos: repos.length,
        stars: totalStars,
        forks: totalForks,
        watchers: totalWatchers,
        sizeKB: totalSize
      },
      languages: langBytes,
      topRepos: topRepos.slice(0, 8).map((r) => ({
        name: r.name,
        description: r.description,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        url: r.html_url,
        updated: r.updated_at
      })),
      activity: buckets,
      streaks: { current: currentStreak, longest: longestStreak }
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// SVG stats card (embeddable, like github-readme-stats)
app.get('/api/card/:username.svg', async (req, res) => {
  try {
    const username = encodeURIComponent(req.params.username);
    const tok = sessionToken(req);
    const data = await ghFetch(`/users/${username}`, tok);
    const repos = await ghFetchAll(`/users/${username}/repos?sort=updated`, tok, 200);
    const stars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
    const forks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="495" height="195" viewBox="0 0 495 195" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitPulse stats for ${data.login}">
  <title>GitPulse stats for ${data.login}</title>
  <style>
    .bg { fill: #0d1117; }
    .title { font: 600 18px 'Segoe UI', Ubuntu, sans-serif; fill: #58a6ff; }
    .stat { font: 400 14px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .val { font: 700 14px 'Segoe UI', Ubuntu, sans-serif; fill: #f0f6fc; }
    .muted { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; }
  </style>
  <rect class="bg" x="0.5" y="0.5" width="494" height="194" rx="10" stroke="#30363d"/>
  <text x="25" y="35" class="title">${escapeXml(data.name || data.login)}</text>
  <text x="25" y="55" class="muted">@${escapeXml(data.login)}</text>
  <g transform="translate(25, 85)">
    <text class="stat">Public Repos</text><text x="180" class="val">${data.public_repos}</text>
  </g>
  <g transform="translate(25, 110)">
    <text class="stat">Followers</text><text x="180" class="val">${data.followers}</text>
  </g>
  <g transform="translate(25, 135)">
    <text class="stat">Total Stars</text><text x="180" class="val">${stars}</text>
  </g>
  <g transform="translate(25, 160)">
    <text class="stat">Total Forks</text><text x="180" class="val">${forks}</text>
  </g>
  <g transform="translate(260, 85)">
    <text class="stat">Following</text><text x="180" class="val">${data.following}</text>
  </g>
  <g transform="translate(260, 110)">
    <text class="stat">Gists</text><text x="180" class="val">${data.public_gists}</text>
  </g>
</svg>`;
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (e) {
    res.status(e.status || 500).send(`<svg><text>${escapeXml(e.message)}</text></svg>`);
  }
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// ----- OAuth (Login with GitHub) -----
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';

app.get('/api/me', (req, res) => {
  if (req.session?.ghUser) {
    res.json({ authenticated: true, user: req.session.ghUser });
  } else {
    res.json({ authenticated: false });
  }
});

app.get('/auth/github', (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured. See .env.example');
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: 'read:user user:email',
    redirect_uri: redirectUri
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=no_code');
  if (!CLIENT_ID || !CLIENT_SECRET) return res.redirect('/?error=oauth_not_configured');
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/github/callback`;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'token exchange failed');
    }
    req.session.ghToken = tokenData.access_token;
    const user = await ghFetch('/user', tokenData.access_token);
    req.session.ghUser = { login: user.login, avatar_url: user.avatar_url, name: user.name };
    res.redirect('/');
  } catch (e) {
    res.redirect('/?error=' + encodeURIComponent(e.message));
  }
});

app.get('/auth/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GitPulse running at http://localhost:${PORT}`);
    console.log(`GitHub API: ${GH_TOKEN ? 'authenticated' : 'unauthenticated (60 req/hr limit)'}`);
  });
}

module.exports = app;