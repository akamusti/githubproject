const $ = (id) => document.getElementById(id);
let langChart, actChart;

async function api(path) {
  const r = await fetch(path);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

async function analyze(username) {
  username = (username || '').trim();
  if (!username) return;
  hide('hero'); hide('error'); show('loading'); hide('dashboard');
  try {
    const [user, stats] = await Promise.all([
      api(`/api/user/${encodeURIComponent(username)}`),
      api(`/api/stats/${encodeURIComponent(username)}`)
    ]);
    renderProfile(user);
    renderStats(stats);
    renderLanguages(stats.languages);
    renderActivity(stats.activity);
    renderTopRepos(stats.topRepos);
    renderEmbed(username);
    hide('loading'); show('dashboard');
  } catch (e) {
    hide('loading'); show('error');
    $('error').textContent = 'Hata: ' + e.message;
  }
}

function renderProfile(u) {
  $('profile').innerHTML = `
    <img src="${u.avatar_url}" alt="${u.login}">
    <div class="info">
      <h2>${escape(u.name || u.login)}</h2>
      <p>@${escape(u.login)}${u.location ? ' · ' + escape(u.location) : ''}</p>
      ${u.bio ? `<p>${escape(u.bio)}</p>` : ''}
      <p><a href="${u.html_url}" target="_blank">GitHub profili ↗</a></p>
    </div>`;
}

function renderStats(s) {
  const u = s.user;
  const items = [
    { label: 'Public Repos', value: u.public_repos },
    { label: 'Followers', value: u.followers },
    { label: 'Following', value: u.following },
    { label: 'Total Stars', value: s.totals.stars },
    { label: 'Total Forks', value: s.totals.forks },
    { label: 'Gists', value: u.public_gists },
    { label: 'Current Streak', value: s.streaks.current + ' gün' },
    { label: 'Longest Streak', value: s.streaks.longest + ' gün' },
  ];
  $('stats').innerHTML = items.map(i => `
    <div class="stat"><div class="label">${i.label}</div><div class="value">${i.value}</div></div>
  `).join('');
}

function renderLanguages(langs) {
  const entries = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);
  const colors = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#79c0ff','#56d364','#e3b341','#ff7b72','#d2a8ff','#8b949e','#f0883e'];
  if (langChart) langChart.destroy();
  langChart = new Chart($('langChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'right', labels: { color: '#c9d1d9', font: { size: 12 } } } } }
  });
}

function renderActivity(buckets) {
  const days = Object.keys(buckets).sort();
  const data = days.map(d => buckets[d]);
  const labels = days.map(d => d.slice(5));
  if (actChart) actChart.destroy();
  actChart = new Chart($('actChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Events', data, backgroundColor: '#58a6ff', borderRadius: 2 }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, beginAtZero: true }
      }
    }
  });
}

function renderTopRepos(repos) {
  $('topRepos').innerHTML = repos.map(r => `
    <div class="repo">
      <a class="name" href="${r.url}" target="_blank">${escape(r.name)}</a>
      <div class="desc">${escape(r.description || 'Açıklama yok')}</div>
      <div class="meta">
        <span>⭐ ${r.stars || 0}</span>
        <span>🍴 ${r.forks || 0}</span>
        <span>${escape(r.language || '')}</span>
        <span>güncellendi: ${new Date(r.updated).toLocaleDateString('tr-TR')}</span>
      </div>
    </div>
  `).join('') || '<p class="muted">Repo bulunamadı.</p>';
}

function renderEmbed(username) {
  const url = `${location.origin}/api/card/${encodeURIComponent(username)}.svg`;
  $('embedCode').textContent = `[![GitPulse](${url})](https://github.com/${username})`;
  $('cardPreview').innerHTML = `<img src="${url}" alt="stats card">`;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// wire up
window.addEventListener('DOMContentLoaded', () => {
  // Auth state
  fetch('/api/me').then(r => r.json()).then(d => {
    if (d.authenticated) {
      $('loginBtn').classList.add('hidden');
      $('userBadge').classList.remove('hidden');
      $('userAvatar').src = d.user.avatar_url;
      $('userName').textContent = d.user.name || d.user.login;
      $('authStatus').textContent = '✓ OAuth oturumu açık';
    } else {
      $('loginBtn').classList.remove('hidden');
      $('userBadge').classList.add('hidden');
      fetch('/api/health').then(r => r.json()).then(h => {
        $('authStatus').textContent = h.authenticated ? '✓ Token (5000 req/hr)' : '⚠ Anonim (60 req/hr)';
      }).catch(() => {});
    }
  }).catch(() => {});

  // Error from OAuth callback
  const params = new URLSearchParams(location.search);
  if (params.has('error')) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = 'Giriş hatası: ' + params.get('error');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
    history.replaceState({}, '', '/');
  }

  $('go').addEventListener('click', () => analyze($('username').value));
  $('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze($('username').value); });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => analyze(c.dataset.user)));
});