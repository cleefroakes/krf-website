// public.js — KRF Public Fan Site
// SPA navigation, live ticker, Supabase realtime, all page renders

// ─────────────────────────────────────────────────────────
// CONFIG — replace with your actual values after Supabase setup
// ─────────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:      window.ENV_SUPABASE_URL      || 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: window.ENV_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY',
  API_BASE:          window.ENV_API_BASE           || '/api',
};

// ─────────────────────────────────────────────────────────
// SUPABASE CLIENT (CDN — loaded in HTML)
// ─────────────────────────────────────────────────────────
let sb = null;
function initSupabase() {
  if (window.supabase && CONFIG.SUPABASE_URL !== 'https://YOUR_PROJECT.supabase.co') {
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    initRealtime();
  }
}

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
const STATE = {
  currentPage: 'home',
  teams: [], tournaments: [], matches: [], news: [],
  standings: {}, sponsors: [], settings: {},
  liveMatch: null, galleryPhotos: [], galleryVideos: [],
  activeTournament: null,
};

// ─────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────
async function api(resource, params = {}) {
  const qs = new URLSearchParams({ resource, ...params }).toString();
  try {
    const res = await fetch(`${CONFIG.API_BASE}/data?${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function apiMatches(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  try {
    const res = await fetch(`${CONFIG.API_BASE}/matches?${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────
// DATA LOADERS
// ─────────────────────────────────────────────────────────
async function loadAll() {
  const [teams, tournaments, matches, news, sponsors, settings] = await Promise.all([
    api('teams'),
    api('tournaments'),
    apiMatches('list', { limit: 20 }),
    api('news', { limit: 10 }),
    api('sponsors'),
    api('settings'),
  ]);

  if (teams)       STATE.teams       = teams;
  if (tournaments) STATE.tournaments = tournaments;
  if (matches)     STATE.matches     = matches;
  if (news)        STATE.news        = news;
  if (sponsors)    STATE.sponsors    = sponsors;
  if (settings)    STATE.settings    = Object.fromEntries((settings || []).map(s => [s.key, s.value]));

  // Load standings for first active tournament
  const active = STATE.tournaments.find(t => t.status === 'ongoing');
  if (active) {
    STATE.standings[active.id] = await apiMatches('standings', { tournament_id: active.id });
  }

  // Live match
  const live = STATE.matches?.filter(m => m.status === 'live');
  if (live?.length) STATE.liveMatch = live[0];

  // Hero video/wallpaper from settings
  applyHeroBackground();
  initTicker();
  renderPage(STATE.currentPage);
}

function applyHeroBackground() {
  const videoUrl = STATE.settings.hero_video_url;
  const vid = document.getElementById('heroBgVideo');
  if (vid && videoUrl) { vid.src = videoUrl; vid.load(); }
}

// ─────────────────────────────────────────────────────────
// REALTIME (Supabase)
// ─────────────────────────────────────────────────────────
function initRealtime() {
  if (!sb) return;

  // Subscribe to live score changes
  sb.channel('live-matches')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, payload => {
      const updated = payload.new;
      STATE.matches = STATE.matches.map(m => m.id === updated.id ? { ...m, ...updated } : m);
      if (STATE.liveMatch?.id === updated.id) STATE.liveMatch = { ...STATE.liveMatch, ...updated };
      updateLiveScoreDisplays(updated);
      updateTicker();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events' }, payload => {
      updateEventFeed(payload.new);
    })
    .subscribe();
}

function updateLiveScoreDisplays(match) {
  const score = `${match.home_score} — ${match.away_score}`;
  document.querySelectorAll('[data-live-score]').forEach(el => el.textContent = score);
  document.querySelectorAll('[data-live-home]').forEach(el => el.textContent = match.home_score);
  document.querySelectorAll('[data-live-away]').forEach(el => el.textContent = match.away_score);
}

function updateEventFeed(event) {
  const feed = document.getElementById('liveEventFeed');
  if (!feed) return;
  const icons = { goal: '⚽', yellow: '🟨', red_card: '🟥', foul: '🔴', boundary: '🚩' };
  const div = document.createElement('div');
  div.className = 'ev-feed-item';
  div.innerHTML = `<span class="ef-min">${event.minute}'</span><span class="ef-icon">${icons[event.event_type] || '◉'}</span><span class="ef-desc">${event.description || event.event_type}</span>`;
  feed.prepend(div);
}

// ─────────────────────────────────────────────────────────
// TICKER
// ─────────────────────────────────────────────────────────
function initTicker() {
  const items = buildTickerItems();
  const el = document.getElementById('tickerInner');
  if (!el) return;
  const doubled = [...items, ...items];
  el.innerHTML = doubled.map(t => `<span class="ticker-item">${t}<span class="ticker-sep"> | </span></span>`).join('');
}

function buildTickerItems() {
  const items = [];
  if (STATE.settings.ticker_message) items.push(STATE.settings.ticker_message);
  if (STATE.liveMatch) {
    items.push(`● LIVE: ${STATE.liveMatch.home_team?.name} ${STATE.liveMatch.home_score} — ${STATE.liveMatch.away_score} ${STATE.liveMatch.away_team?.name}`);
  }
  STATE.matches?.filter(m => m.status === 'completed').slice(0, 3).forEach(m => {
    items.push(`${m.home_team?.name} ${m.home_score} — ${m.away_score} ${m.away_team?.name} · ${m.tournament?.name}`);
  });
  STATE.matches?.filter(m => m.status === 'upcoming').slice(0, 3).forEach(m => {
    const d = m.match_date ? new Date(m.match_date).toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short'}) : 'TBC';
    items.push(`Upcoming: ${m.home_team?.name} vs ${m.away_team?.name} · ${d}`);
  });
  return items.length ? items : ['Welcome to Kenya Rollball Federation — Official Site'];
}

function updateTicker() { initTicker(); }

// ─────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.classList.add('active'); }
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.nav-btn[data-page="${id}"]`)?.classList.add('active');
  window.scrollTo(0, 0);
  STATE.currentPage = id;
  if (id !== 'tournaments') deactivateTournamentBg();
  renderPage(id);
}

function renderPage(id) {
  const renders = {
    home:        renderHome,
    tournaments: renderTournaments,
    fixtures:    renderFixtures,
    teams:       renderTeams,
    standings:   renderStandings,
    news:        renderNews,
    gallery:     renderGallery,
  };
  renders[id]?.();
}

// ─────────────────────────────────────────────────────────
// RENDER: HOME
// ─────────────────────────────────────────────────────────
function renderHome() {
  // Featured tournaments
  const tGrid = document.getElementById('homeTournaments');
  if (tGrid) tGrid.innerHTML = STATE.tournaments.filter(t => t.status === 'ongoing').map(tournamentCardHTML).join('');

  // Standings mini
  const activeTour = STATE.tournaments.find(t => t.status === 'ongoing');
  if (activeTour && STATE.standings[activeTour.id]) {
    const sb = document.getElementById('homeStandingsBody');
    if (sb) sb.innerHTML = STATE.standings[activeTour.id].slice(0, 5).map((s, i) => standingRowHTML(s, i, true)).join('');
  }

  // Recent results
  const results = document.getElementById('homeResults');
  if (results) {
    const recent = STATE.matches?.filter(m => m.status === 'completed').slice(0, 3) || [];
    results.innerHTML = recent.map(matchCardHTML).join('') || '<p style="color:var(--dim);padding:1rem">No recent results</p>';
  }

  // Live match strip
  updateLiveStrip();

  // News
  const newsEl = document.getElementById('homeNews');
  if (newsEl) renderNewsGrid(newsEl, STATE.news);

  // Sponsors
  const sponsEl = document.getElementById('homeSponsors');
  if (sponsEl) sponsEl.innerHTML = STATE.sponsors.map(s =>
    `<div class="sponsor-logo ${s.tier}" onclick="window.open('${s.website_url||'#'}','_blank')">${s.logo_url ? `<img src="${s.logo_url}" alt="${s.name}" style="max-height:40px;max-width:120px;object-fit:contain">` : s.name}</div>`
  ).join('');
}

function updateLiveStrip() {
  const strip = document.getElementById('liveStrip');
  if (!strip) return;
  if (STATE.liveMatch) {
    strip.style.display = 'block';
    const m = STATE.liveMatch;
    strip.querySelector('[data-home]')?.textContent && (strip.querySelector('[data-home]').textContent = m.home_team?.name || '');
    strip.querySelector('[data-away]')?.textContent && (strip.querySelector('[data-away]').textContent = m.away_team?.name || '');
    const scoreEl = strip.querySelector('[data-live-score]');
    if (scoreEl) scoreEl.textContent = `${m.home_score} — ${m.away_score}`;
    strip.querySelector('[data-tour]') && (strip.querySelector('[data-tour]').textContent = m.tournament?.name || '');
  } else {
    strip.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────────────
// RENDER: TOURNAMENTS
// ─────────────────────────────────────────────────────────
function tournamentCardHTML(t) {
  return `<div class="t-card" onclick="openTournament('${t.id}')">
    <div class="t-card-bg" style="background:${t.gradient || 'linear-gradient(135deg,#1a0008,#0d0d0d)'}"></div>
    ${t.video_trailer_url ? `<div class="t-card-video"><video autoplay muted loop playsinline><source src="${t.video_trailer_url}" type="video/mp4"/></video></div>` : ''}
    <div class="t-card-overlay"></div>
    <div class="t-play-hint">▶ Hover for trailer</div>
    <div class="t-card-body">
      <span class="t-status ${t.status}">${t.status === 'ongoing' ? '● Live' : t.status === 'upcoming' ? 'Upcoming' : 'Completed'}</span>
      <h3>${t.name}</h3>
      <div class="t-card-meta">
        <span>${t.max_teams || 0} Teams</span>
        <span>${t.venue || 'TBC'}</span>
        <span>${t.start_date ? new Date(t.start_date).toLocaleDateString('en-KE',{month:'short',year:'numeric'}) : ''}</span>
      </div>
    </div>
  </div>`;
}

let tournamentFilter = 'all';
function renderTournaments() {
  const list = tournamentFilter === 'all' ? STATE.tournaments : STATE.tournaments.filter(t => t.status === tournamentFilter);
  const grid = document.getElementById('allTournaments');
  if (grid) grid.innerHTML = list.map(tournamentCardHTML).join('');
}

function filterTournaments(f, btn) {
  tournamentFilter = f;
  document.querySelectorAll('#tournaments .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTournaments();
}

function openTournament(id) {
  const t = STATE.tournaments.find(x => x.id === id);
  if (!t) return;
  STATE.activeTournament = t;
  activateTournamentBg(t);

  // Load standings for this tournament
  if (!STATE.standings[t.id]) {
    apiMatches('standings', { tournament_id: t.id }).then(data => {
      STATE.standings[t.id] = data;
      renderTournamentDetail(t);
    });
  } else {
    renderTournamentDetail(t);
  }

  const detail = document.getElementById('tournamentDetail');
  if (detail) { detail.style.display = 'block'; detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function renderTournamentDetail(t) {
  const body = document.getElementById('tournamentDetailBody');
  if (!body) return;
  const teams = t.tournament_teams?.map(tt => tt.team) || [];
  const standings = STATE.standings[t.id] || [];

  body.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem">
      <div>
        <span class="t-status ${t.status}" style="margin-bottom:.5rem;display:inline-block">${t.status}</span>
        <h2 style="font-family:var(--font-display);font-size:2rem;letter-spacing:2px">${t.name}</h2>
        <p style="color:var(--dim);font-size:.85rem;margin-top:.4rem;max-width:500px;line-height:1.7">${t.description || ''}</p>
      </div>
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
        ${[['Teams', t.max_teams], ['Rounds', t.rounds], ['Venue', t.venue]].map(([l, v]) => `
          <div style="text-align:center"><div style="font-family:var(--font-display);font-size:1.6rem;color:var(--gold)">${v || '—'}</div><div style="font-size:.6rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px">${l}</div></div>`).join('')}
      </div>
    </div>
    ${standings.length ? `
    <h3 style="font-family:var(--font-display);font-size:1rem;letter-spacing:1.5px;margin-bottom:.75rem">STANDINGS</h3>
    <div style="background:var(--dark2);border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:1.25rem">
      <table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${standings.map((s, i) => standingRowHTML(s, i, true)).join('')}</tbody></table>
    </div>` : ''}
    <h3 style="font-family:var(--font-display);font-size:1rem;letter-spacing:1.5px;margin-bottom:.75rem">PARTICIPATING TEAMS</h3>
    <div style="display:flex;flex-wrap:wrap;gap:.4rem">
      ${teams.map(t => `<span style="background:${t.color}22;border:1px solid ${t.color}44;color:${t.color};font-size:.7rem;padding:3px 10px;border-radius:2px;font-family:var(--font-ui);cursor:pointer" onclick="openTeamModal('${t.id}')">${t.name}</span>`).join('')}
    </div>`;
}

function activateTournamentBg(t) {
  const bg = document.getElementById('tournamentBg');
  const vid = document.getElementById('tBgVideo');
  if (!bg) return;
  if (t.video_trailer_url && vid) { vid.src = t.video_trailer_url; vid.load(); }
  bg.classList.add('active');
}
function deactivateTournamentBg() {
  document.getElementById('tournamentBg')?.classList.remove('active');
}

// ─────────────────────────────────────────────────────────
// RENDER: FIXTURES
// ─────────────────────────────────────────────────────────
let fixtureFilter = 'all';
function renderFixtures() {
  const list = fixtureFilter === 'all' ? STATE.matches : STATE.matches?.filter(m => m.status === fixtureFilter);
  const el = document.getElementById('fixturesList');
  if (!el) return;
  el.innerHTML = (list || []).map(matchCardHTML).join('') || '<p style="color:var(--dim);padding:1rem">No matches found</p>';
}
function filterFixtures(f, btn) {
  fixtureFilter = f;
  document.querySelectorAll('#fixtures .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFixtures();
}

function matchCardHTML(m) {
  const isLive = m.status === 'live', isUp = m.status === 'upcoming';
  const date = m.match_date ? new Date(m.match_date).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) : 'TBC';
  const time = m.match_date ? new Date(m.match_date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="fixture-card">
    <div class="fc-top"><span class="fc-tour">${m.tournament?.name || ''} · ${m.venue || ''}</span><span class="fc-date">${date} ${time}</span></div>
    <div class="fc-main">
      <div class="fc-team home"><div class="fc-team-name" style="color:${m.home_team?.color || 'var(--white)'}">${m.home_team?.name || 'TBC'}</div></div>
      <div class="fc-score-wrap">
        <div class="fc-score ${isLive ? 'live' : isUp ? 'vs' : ''}" ${isLive ? 'data-live-score' : ''}>${isUp ? 'VS' : `${m.home_score} — ${m.away_score}`}</div>
        <div class="fc-badge ${m.status}">${isLive ? '● LIVE' : isUp ? `${time}` : m.status}</div>
      </div>
      <div class="fc-team away"><div class="fc-team-name" style="color:${m.away_team?.color || 'var(--white)'}">${m.away_team?.name || 'TBC'}</div></div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// RENDER: TEAMS
// ─────────────────────────────────────────────────────────
function renderTeams() {
  const grid = document.getElementById('teamsGrid');
  if (!grid) return;
  grid.innerHTML = STATE.teams.map(t => {
    const s = t.standings?.[0] || {};
    const pts = (s.points || 0), p = (s.played || 0);
    return `<div class="team-card" onclick="openTeamModal('${t.id}')">
      <div class="team-card-banner" style="background:${t.bg_color || '#111'}">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.12;font-family:var(--font-display);font-size:5rem;color:${t.color}">${t.abbr}</div>
        ${t.logo_url ? `<img src="${t.logo_url}" alt="${t.name}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:1rem;opacity:.6">` : ''}
        <div class="team-card-badge" style="background:${t.color}22;color:${t.color};border-color:${t.color}44;bottom:-18px">${t.abbr}</div>
      </div>
      <div class="team-card-body">
        <h3>${t.name}</h3>
        <div class="team-card-city">📍 ${t.city}</div>
        <div class="team-card-stats">
          <div class="tcs"><span class="v">${p}</span><span class="l">Played</span></div>
          <div class="tcs"><span class="v">${s.won || 0}</span><span class="l">Wins</span></div>
          <div class="tcs"><span class="v" style="color:var(--white)">${pts}</span><span class="l">Points</span></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openTeamModal(id) {
  const t = STATE.teams.find(x => x.id === id);
  if (!t) return;
  const s = t.standings?.[0] || {};
  const gd = (s.goals_for || 0) - (s.goals_against || 0);

  document.getElementById('teamModalBody').innerHTML = `
    <div class="tm-banner" style="background:${t.bg_color || '#111'}">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.1;font-family:var(--font-display);font-size:8rem;color:${t.color}">${t.abbr}</div>
      ${t.logo_url ? `<img src="${t.logo_url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:2rem;opacity:.5">` : ''}
      <div class="tm-overlay"></div>
    </div>
    <button class="pm-close" onclick="closeModals()" style="position:absolute;top:1rem;right:1rem;z-index:5">✕</button>
    <div class="tm-head">
      <div class="tm-badge-lg" style="background:${t.color}22;color:${t.color};border-color:${t.color}55">${t.abbr}</div>
      <div><div class="tm-name">${t.name}</div><div class="tm-city">📍 ${t.city}${t.home_ground ? ' · ' + t.home_ground : ''}</div></div>
    </div>
    <div class="tm-stats-bar">
      ${[['Played',s.played||0],['Won',s.won||0],['Drawn',s.drawn||0],['Lost',s.lost||0],['GF',s.goals_for||0],['GA',s.goals_against||0],['GD',(gd>0?'+':'')+gd],['Pts',s.points||0]].map(([l,v]) =>
        `<div class="tm-stat"><span class="v" ${l==='GD'?`style="color:${gd>=0?'var(--gold)':'var(--red)'}"`:''}>${v}</span><span class="l">${l}</span></div>`).join('')}
    </div>
    <div class="tm-body">
      ${t.bio ? `<p style="font-size:.84rem;color:var(--dim);line-height:1.7;margin-bottom:1.25rem">${t.bio}</p>` : ''}
      ${t.manager ? `<div style="margin-bottom:1rem;font-size:.8rem;color:var(--dim)">Manager: <strong style="color:var(--white)">${t.manager.name}</strong></div>` : ''}
    </div>`;
  document.getElementById('teamModal').classList.add('open');
}

// ─────────────────────────────────────────────────────────
// RENDER: STANDINGS
// ─────────────────────────────────────────────────────────
function standingRowHTML(s, i, compact = false) {
  const t = s.team || {};
  const gd = (s.goals_for || 0) - (s.goals_against || 0);
  const rankCls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
  const form = (s.form || []).slice(-5).map(f => `<span class="fb ${f.toLowerCase()}">${f}</span>`).join('');
  if (compact) return `<tr>
    <td><span class="st-rank ${rankCls}">${i + 1}</span></td>
    <td><div class="st-team"><div class="st-dot" style="background:${t.color || '#888'}"></div>${t.name || '—'}</div></td>
    <td>${s.played || 0}</td><td>${s.won || 0}</td><td>${s.drawn || 0}</td><td>${s.lost || 0}</td>
    <td style="color:${gd > 0 ? '#27ae60' : gd < 0 ? 'var(--red)' : 'var(--dim)'}">${gd > 0 ? '+' : ''}${gd}</td>
    <td style="font-weight:700;color:${i === 0 ? 'var(--gold)' : 'inherit'}">${s.points || 0}</td>
  </tr>`;
  return `<tr>
    <td><span class="st-rank ${rankCls}">${i + 1}</span></td>
    <td><div class="st-team"><div class="st-dot" style="background:${t.color || '#888'}"></div>${t.name || '—'}</div></td>
    <td>${s.played||0}</td><td>${s.won||0}</td><td>${s.drawn||0}</td><td>${s.lost||0}</td>
    <td>${s.goals_for||0}</td><td>${s.goals_against||0}</td>
    <td style="color:${gd>0?'#27ae60':gd<0?'var(--red)':'var(--dim)'}">${gd>0?'+':''}${gd}</td>
    <td style="font-weight:700;color:${i===0?'var(--gold)':'inherit'}">${s.points||0}</td>
    <td>${form}</td>
  </tr>`;
}

let standingsFilter = null;
function renderStandings() {
  const activeTour = STATE.tournaments.find(t => t.status === 'ongoing');
  const tourId = standingsFilter || activeTour?.id;
  if (!tourId) return;

  const body = document.getElementById('standingsBody');
  if (!body) return;

  if (STATE.standings[tourId]) {
    body.innerHTML = STATE.standings[tourId].map((s, i) => standingRowHTML(s, i)).join('');
  } else {
    apiMatches('standings', { tournament_id: tourId }).then(data => {
      STATE.standings[tourId] = data || [];
      body.innerHTML = (data || []).map((s, i) => standingRowHTML(s, i)).join('');
    });
  }
}

function filterStandings(id, btn) {
  standingsFilter = id;
  document.querySelectorAll('#standings .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStandings();
}

// ─────────────────────────────────────────────────────────
// RENDER: NEWS
// ─────────────────────────────────────────────────────────
function renderNewsGrid(el, news) {
  if (!news?.length) { el.innerHTML = '<p style="color:var(--dim);padding:1rem">No news yet</p>'; return; }
  const feat = news[0], rest = news.slice(1, 5);
  el.innerHTML = `
    <div class="news-grid">
      <div class="news-featured" onclick="showToast('${feat.title}')">
        <div class="news-featured-img" style="background:linear-gradient(135deg,${feat.hero_color||'#C8102E'},#0d0d0d)"></div>
        <div class="news-featured-overlay"></div>
        <div class="news-featured-body">
          <span class="nf-tag">${feat.tag || 'News'}</span>
          <div class="nf-title">${feat.title}</div>
          <div class="nf-meta">${feat.published_at ? new Date(feat.published_at).toLocaleDateString('en-KE') : ''}</div>
        </div>
      </div>
      <div class="news-list">${rest.map(n => `
        <div class="news-item" onclick="showToast('${n.title}')">
          <div class="ni-tag">${n.tag || 'News'}</div>
          <div class="ni-title">${n.title}</div>
          <div class="ni-meta">${n.published_at ? new Date(n.published_at).toLocaleDateString('en-KE') : ''}</div>
        </div>`).join('')}
      </div>
    </div>`;
}

function renderNews() {
  const el = document.getElementById('newsGrid');
  if (el) renderNewsGrid(el, STATE.news);
}

// ─────────────────────────────────────────────────────────
// RENDER: GALLERY
// ─────────────────────────────────────────────────────────
async function renderGallery() {
  const tab = STATE.galleryActiveTab || 'photos';
  if (tab === 'photos') await loadPhotos();
  else await loadVideos();
}

async function loadPhotos() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  const photos = await api('media', { type: 'photo', limit: 40 });
  const fallbackEmojis = ['⚽','🏆','👟','🎽','🏃','💪','🤝','🔥','🌟','⚡','🎯','🏅','🤾','📸'];
  const items = photos?.length ? photos : fallbackEmojis.map((e, i) => ({ id: i, file_url: null, emoji: e, title: '' }));
  const heights = [140,200,160,180,220,150,190,170,210,155,185,175,230,145,195,165,215,185,160,200];
  grid.innerHTML = items.map((p, i) => `
    <div class="gallery-tile" onclick="showToast('${p.title || 'Photo viewer'}')">
      <div class="gallery-tile-inner" style="height:${heights[i % heights.length]}px;${p.file_url ? `background:url('${p.file_url}') center/cover no-repeat` : `background:linear-gradient(135deg,var(--dark3),var(--dark2));display:flex;align-items:center;justify-content:center;font-size:3rem`}">
        ${p.file_url ? '' : (p.emoji || '📸')}
      </div>
      <div class="gallery-tile-overlay"></div>
    </div>`).join('');
}

async function loadVideos() {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  const videos = await api('media', { type: 'video', limit: 20 });
  const fallback = ['KPL Round 9 Highlights','Nairobi Bulls Training','KRF Cup Semifinal','Best Goals January','Championship Final 2024'];
  const items = videos?.length ? videos : fallback.map((t, i) => ({ id: i, title: t, file_url: null, views: Math.floor(Math.random()*2000000) }));
  grid.innerHTML = items.map(v => `
    <div class="video-tile" onclick="showToast('Playing: ${v.title}')">
      <div class="video-thumb">${v.thumbnail_url ? `<img src="${v.thumbnail_url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : '🎬'}<div class="play-icon">▶</div></div>
      <div class="video-info"><h4>${v.title || 'Match Video'}</h4><small>${v.views ? (v.views/1000).toFixed(0)+'K views' : ''}</small></div>
    </div>`).join('');
}

function setGalleryTab(tab, btn) {
  STATE.galleryActiveTab = tab;
  document.querySelectorAll('#gallery .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['photosPanel','videosPanel'].forEach(p => { const el = document.getElementById(p); if (el) el.style.display = 'none'; });
  const active = document.getElementById(tab === 'photos' ? 'photosPanel' : 'videosPanel');
  if (active) active.style.display = 'block';
  renderGallery();
}

// ─────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────
function closeModals() {
  document.querySelectorAll('.overlay-bg').forEach(m => m.classList.remove('open'));
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.overlay-bg').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  loadAll();
});
