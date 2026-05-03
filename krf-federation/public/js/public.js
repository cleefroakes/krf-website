// public.js — KRF Public Fan Site
// SPA navigation, live ticker, Supabase realtime, all page renders

// ─────────────────────────────────────────────────────────
// CONFIG — replace with your actual values after Supabase setup
// ─────────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://eseffwgiogcbwnatrssz.supabase.co',
  SUPABASE_ANON_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZWZmd2dpb2djYnduYXRyc3N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzU0NzQsImV4cCI6MjA5MTA1MTQ3NH0.Qvf3AJJD2rr_fVasvB2ntE0_-LIfSiawEWTnQBKIXmg',
  API_BASE:'/api',
};

// ─────────────────────────────────────────────────────────
// SUPABASE CLIENT (CDN — loaded in HTML)
// ─────────────────────────────────────────────────────────
let sb = null;
function initSupabase() {
  if (window.supabase && CONFIG.SUPABASE_URL) {
    console.log('Supabase URL:',CONFIG.SUPABASE_URL);
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
  if (!sb) return null;
  try {
    if (resource === 'teams') {
      const { data } = await sb.from('teams').select('*, standings(*)').eq('is_active', true).order('name');
      return data;
    }
    if (resource === 'tournaments') {
      const { data } = await sb.from('tournaments').select('*, tournament_teams(team:teams(id,name,abbr,color))').order('created_at', { ascending: false });
      return data;
    }
    if (resource === 'news') {
      const { data } = await sb.from('news').select('*').eq('published', true).order('created_at', { ascending: false }).limit(10);
      return data;
    }
    if (resource === 'sponsors') {
      const { data } = await sb.from('sponsors').select('*').eq('is_active', true);
      return data;
    }
    if (resource === 'settings') {
      const { data } = await sb.from('site_settings').select('*');
      return data;
    }
    if (resource === 'media') {
      const { data } = await sb.from('media').select('*').eq('approved', true).eq('media_type', params.type || 'photo').limit(parseInt(params.limit) || 40);
      return data;
    }
    return null;
  } catch { return null; }
}

async function apiMatches(action, params = {}) {
  if (!sb) return null;
  try {
    if (action === 'list') {
      const { data } = await sb.from('matches').select('*, home_team:teams!home_team_id(id,name,abbr,color), away_team:teams!away_team_id(id,name,abbr,color), tournament:tournaments(id,name)').order('match_date', { ascending: false }).limit(parseInt(params.limit) || 20);
      return data;
    }
    if (action === 'standings') {
      const { data } = await sb.from('standings').select('*, team:teams(id,name,abbr,color)').eq('tournament_id', params.tournament_id).order('points', { ascending: false });
      return data;
    }
    return null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────
// DATA LOADERS
// ─────────────────────────────────────────────────────────
async function loadAll() {
  const [teams, tournaments, matches, news, sponsors, settings] = await Promise.all([
    api('teams'),
    api('tournaments'),
    apiMatches('list', { limit: 50 }),
    api('news', { limit: 10 }),
    api('sponsors'),
    api('settings'),
  ]);

  if (teams)       STATE.teams       = teams;
  if (tournaments) STATE.tournaments = tournaments;
  if (matches)     STATE.matches     = matches;
  if (news)        STATE.news        = news;
  if (sponsors)    STATE.sponsors    = sponsors;
  if (settings)    STATE.settings    = Object.fromEntries((settings||[]).map(s=>[s.key,s.value]));

  // Real hero stats
  const [{ count: playerCount }, { count: matchCount }] = await Promise.all([
    sb.from('users').select('*',{count:'exact',head:true}).eq('role','player').eq('is_active',true),
    sb.from('matches').select('*',{count:'exact',head:true}),
  ]);
  const el = id => document.getElementById(id);
  if (el('heroTeams'))   el('heroTeams').textContent   = STATE.teams?.length || 0;
  if (el('heroPlayers')) el('heroPlayers').textContent = playerCount || 0;
  if (el('heroTours'))   el('heroTours').textContent   = STATE.tournaments?.length || 0;
  if (el('heroMatches')) el('heroMatches').textContent = matchCount || 0;

  // Standings for first active tournament
  const active = STATE.tournaments.find(t => t.status === 'ongoing' || t.status === 'active');
  if (active) {
    STATE.standings[active.id] = await apiMatches('standings', { tournament_id: active.id });
  }

  // Live match
  const live = STATE.matches?.filter(m => m.status === 'live');
  if (live?.length) STATE.liveMatch = live[0];

  applyHeroBackground();
  initTicker();
  renderPage(STATE.currentPage);
  window.dispatchEvent(new Event('krf-data-loaded'));
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
  const imageUrl = STATE.settings.hero_image_url;
  const vid = document.getElementById('heroBgVideo');

  if (videoUrl) {
    if (vid) { vid.src = videoUrl; vid.load(); }
  } else if (imageUrl) {
    // Use image as background instead
    const heroBg = document.getElementById('heroBg');
    if (heroBg) heroBg.style.backgroundImage = `url('${imageUrl}')`;
    if (vid) vid.style.display = 'none';
  }
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
       <span>${t.start_date ? new Date(t.start_date).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'}) : ''}</span>
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
let fixtureSlideTimer = null;
let fixtureSlideIndex = 0;

async function renderFixtures() {
  // Slideshow
  const photos = await api('media', { type: 'photo', limit: 12 });
  const slides = document.getElementById('fhSlides');
  const dots   = document.getElementById('fhDots');

  if (slides && photos?.length) {
    slides.innerHTML = photos.map((p, i) =>
      `<div class="fh-slide ${i===0?'active':''}" style="background-image:url('${p.file_url}');position:absolute;inset:0;background-size:cover;background-position:center;opacity:${i===0?1:0};transition:opacity .8s ease"></div>`
    ).join('');
    if (dots) dots.innerHTML = photos.map((_, i) =>
      `<div class="fh-dot ${i===0?'active':''}" onclick="goToSlide(${i})" style="width:6px;height:6px;border-radius:50%;background:${i===0?'var(--gold)':'rgba(255,255,255,.35)'};cursor:pointer;transition:background .3s"></div>`
    ).join('');
    clearInterval(fixtureSlideTimer);
    fixtureSlideIndex = 0;
    fixtureSlideTimer = setInterval(() => {
      fixtureSlideIndex = (fixtureSlideIndex + 1) % photos.length;
      goToSlide(fixtureSlideIndex);
    }, 4000);
  } else if (slides) {
    slides.innerHTML = `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#1a0008,#0d0d1a,#0a1a0a)"></div>`;
  }

  // Fixture cards
  const list = fixtureFilter === 'all' ? STATE.matches : STATE.matches?.filter(m => m.status === fixtureFilter);
  const el = document.getElementById('fixturesList');
  if (!el) return;
  el.innerHTML = (list||[]).map(matchCardHTML).join('') || '<p style="color:var(--dim);padding:1rem">No matches found</p>';
}

function goToSlide(index) {
  const slides = document.querySelectorAll('.fh-slide');
  const dots   = document.querySelectorAll('.fh-dot');
  slides.forEach((s, i) => {
    s.style.opacity = i === index ? '1' : '0';
    s.classList.toggle('active', i === index);
  });
  dots.forEach((d, i) => {
    d.style.background = i === index ? 'var(--gold)' : 'rgba(255,255,255,.35)';
    d.classList.toggle('active', i === index);
  });
  fixtureSlideIndex = index;
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

function renderNewsGrid(el, news) {
  if (!news?.length) { el.innerHTML = '<p style="color:var(--dim);padding:1rem">No news yet</p>'; return; }
  const feat = news[0], rest = news.slice(1, 5);
  el.innerHTML = `
    <div class="news-grid">
      <div class="news-featured" onclick="openArticle('${feat.id}')">
        <div class="news-featured-img" style="${feat.cover_image_url ? `background:url('${feat.cover_image_url}') center/cover no-repeat` : `background:linear-gradient(135deg,${feat.hero_color||'#C8102E'},#0d0d0d)`}"></div>
        <div class="news-featured-overlay"></div>
        <div class="news-featured-body">
          <span class="nf-tag">${feat.tag || 'News'}</span>
          <div class="nf-title">${feat.title}</div>
          <div class="nf-meta">${feat.published_at ? new Date(feat.published_at).toLocaleDateString('en-KE') : ''}</div>
        </div>
      </div>
      <div class="news-list">${rest.map(n => `
        <div class="news-item" onclick="openArticle('${n.id}')">
          <div class="ni-tag">${n.tag || 'News'}</div>
          <div class="ni-title">${n.title}</div>
          <div class="ni-meta">${n.published_at ? new Date(n.published_at).toLocaleDateString('en-KE') : ''}</div>
        </div>`).join('')}
      </div>
    </div>
    <div id="articleModal" class="overlay-bg" onclick="if(event.target===this)this.classList.remove('open')">
      <div class="team-modal" id="articleModalBody" style="max-width:720px;padding:0;overflow-y:auto;max-height:90vh"></div>
    </div>`;
}

function openArticle(id) {
  const article = STATE.news.find(n => n.id === id);
  if (!article) return;
  const modal = document.getElementById('articleModal') || (() => {
    const m = document.createElement('div');
    m.id = 'articleModal';
    m.className = 'overlay-bg';
    m.onclick = e => { if (e.target === m) m.classList.remove('open'); };
    document.body.appendChild(m);
    return m;
  })();
  modal.innerHTML = `
    <div style="background:var(--dark2);border:1px solid var(--border);border-radius:8px;max-width:720px;width:100%;margin:2rem auto;overflow:hidden;max-height:90vh;overflow-y:auto">
      ${article.cover_image_url ? `<div style="aspect-ratio:16/9;background:url('${article.cover_image_url}') center/cover no-repeat"></div>` : `<div style="aspect-ratio:16/9;background:linear-gradient(135deg,${article.hero_color||'#C8102E22'},#0d0d0d)"></div>`}
      <div style="padding:2rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <span style="background:rgba(200,16,46,.15);color:var(--red);border:1px solid rgba(200,16,46,.3);font-size:.62rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:3px 10px;border-radius:2px">${article.tag||'News'}</span>
          <button onclick="document.getElementById('articleModal').classList.remove('open')" style="background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer">✕</button>
        </div>
        <h2 style="font-family:var(--font-display);font-size:1.8rem;letter-spacing:2px;margin-bottom:.5rem">${article.title}</h2>
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:1.5rem">${article.published_at ? new Date(article.published_at).toLocaleDateString('en-KE',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : ''}</div>
        ${article.video_url ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;margin-bottom:1.5rem"><iframe src="${article.video_url.includes('youtube')?article.video_url.replace('watch?v=','embed/'):article.video_url}" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>` : ''}
        <div style="font-size:.88rem;color:var(--soft);line-height:1.9;white-space:pre-wrap">${article.content || ''}</div>
      </div>
    </div>`;
  modal.classList.add('open');
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
  if (!videos?.length) {
    grid.innerHTML = '<p style="color:var(--dim);padding:1rem;font-size:.85rem">No videos yet — upload from the Admin Portal</p>';
    return;
  }
  grid.innerHTML = videos.map(v => {
    // Detect YouTube URL and convert to embed
    let embedUrl = null;
    if (v.file_url?.includes('youtube.com/watch')) {
      const videoId = new URL(v.file_url).searchParams.get('v');
      embedUrl = `https://www.youtube.com/embed/${videoId}`;
    } else if (v.file_url?.includes('youtu.be/')) {
      const videoId = v.file_url.split('youtu.be/')[1].split('?')[0];
      embedUrl = `https://www.youtube.com/embed/${videoId}`;
    }
    const thumb = v.thumbnail_url || (embedUrl ? embedUrl.replace('embed/','vi/') + '/hqdefault.jpg' : null);
    return `<div class="video-tile" onclick="playVideo('${v.id}')">
      <div class="video-thumb" id="vthumb-${v.id}">
        ${thumb ? `<img src="${thumb}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : '🎬'}
        <div class="play-icon">▶</div>
      </div>
      <div class="video-info">
        <h4>${v.title || 'Match Video'}</h4>
        <small>${v.category || ''} ${v.views ? '· ' + (v.views/1000).toFixed(0) + 'K views' : ''}</small>
      </div>
      <div class="video-player" id="vplayer-${v.id}" style="display:none;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;margin-top:.5rem">
        ${embedUrl
          ? `<iframe src="${embedUrl}" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen allow="autoplay"></iframe>`
          : `<video controls style="position:absolute;inset:0;width:100%;height:100%" src="${v.file_url}"></video>`
        }
      </div>
    </div>`;
  }).join('');
}

function playVideo(id) {
  const thumb = document.getElementById('vthumb-' + id);
  const player = document.getElementById('vplayer-' + id);
  if (!player) return;
  const isOpen = player.style.display !== 'none';
  // Close all other players first
  document.querySelectorAll('[id^="vplayer-"]').forEach(p => p.style.display = 'none');
  document.querySelectorAll('[id^="vthumb-"]').forEach(t => t.style.display = 'block');
  if (!isOpen) {
    player.style.display = 'block';
    if (thumb) thumb.style.display = 'none';
  }
}

function setGalleryTab(tab, btn) {
  STATE.galleryActiveTab = tab;
  document.querySelectorAll('#gallery .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const panelMap = { photos:'photosPanel', highlights:'highlightsPanel', goalrush:'goalrushPanel', live:'livePanel' };
  ['photosPanel','highlightsPanel','goalrushPanel','livePanel'].forEach(p => {
    const el = document.getElementById(p); if (el) el.style.display = 'none';
  });
  const active = document.getElementById(panelMap[tab]);
  if (active) active.style.display = 'block';
  renderGallery();
}

async function renderGallery() {
  const tab = STATE.galleryActiveTab || 'photos';
  if      (tab === 'photos')     await loadPhotos();
  else if (tab === 'highlights') await loadVideosByCategory('Match Highlights', 'highlightsGrid', 'highlights');
  else if (tab === 'goalrush')   await loadVideosByCategory('Goal Rush', 'goalrushGrid', 'goalrush');
  else if (tab === 'live')       renderLiveStream();
}

async function loadPhotos() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--dim);padding:1rem;font-size:.82rem">Loading photos...</div>';
  const photos = await api('media', { type: 'photo', limit: 40 });
  const heights = [140,200,160,180,220,150,190,170,210,155,185,175,230,145,195,165,215,185,160,200];

  if (!photos?.length) {
    grid.innerHTML = '<p style="color:var(--dim);padding:1rem;font-size:.85rem">No photos yet — upload from the Admin Portal</p>';
    return;
  }
  grid.innerHTML = photos.map((p, i) => `
    <div class="gallery-tile" onclick="openLightbox('${p.file_url}','${(p.title||'').replace(/'/g,"\\'")}')"
      style="cursor:zoom-in">
      <div class="gallery-tile-inner" style="height:${heights[i%heights.length]}px;background:url('${p.file_url}') center/cover no-repeat;position:relative">
        ${p.title ? `<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));padding:.5rem .6rem;font-size:.7rem;color:var(--white)">${p.title}</div>` : ''}
      </div>
      <div class="gallery-tile-overlay"></div>
    </div>`).join('');
}

function openLightbox(url, caption) {
  if (!url) return;
  const lb = document.getElementById('photoLightbox');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (!lb || !img) return;
  img.src = url;
  if (cap) cap.textContent = caption || '';
  lb.classList.add('open');
  lb.style.display = 'flex';
}

async function loadVideosByCategory(categoryLabel, gridId, badgeClass) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--dim);padding:1rem;font-size:.82rem">Loading...</div>';

  const { data: videos } = await sb.from('media')
    .select('*')
    .eq('approved', true)
    .eq('media_type', 'video')
    .ilike('category', `%${categoryLabel}%`)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!videos?.length) {
    grid.innerHTML = `<p style="color:var(--dim);padding:1rem;font-size:.85rem">No ${categoryLabel} videos yet — upload from the Admin Portal</p>`;
    return;
  }
  grid.innerHTML = videos.map(v => buildVideoCard(v, badgeClass)).join('');
}

async function loadVideos() {
  // kept for backwards compat — routes to highlights
  await loadVideosByCategory('Match Highlights', 'highlightsGrid', 'highlights');
}

function buildVideoCard(v, badgeClass) {
  let embedUrl = null;
  if (v.file_url?.includes('youtube.com/watch')) {
    const videoId = new URL(v.file_url).searchParams.get('v');
    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  } else if (v.file_url?.includes('youtu.be/')) {
    const videoId = v.file_url.split('youtu.be/')[1].split('?')[0];
    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  }
  const thumbBase = embedUrl ? embedUrl.replace('embed/','vi/').replace('?autoplay=1','') : null;
  const thumb = v.thumbnail_url || (thumbBase ? thumbBase + '/hqdefault.jpg' : null);
  const catColors = { highlights:'background:rgba(26,111,196,.2);color:#4d9fe8;border:1px solid rgba(26,111,196,.3)', goalrush:'background:rgba(200,16,46,.2);color:#e84d4d;border:1px solid rgba(200,16,46,.3)', live:'background:rgba(39,174,96,.2);color:#4cd97b;border:1px solid rgba(39,174,96,.3)' };
  return `<div class="video-tile">
    <div class="video-thumb" id="vthumb-${v.id}" onclick="playVideoCard('${v.id}')" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;background:var(--dark2);cursor:pointer">
      ${thumb ? `<img src="${thumb}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2.5rem">🎬</div>`}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <div style="width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:1.2rem">▶</div>
      </div>
    </div>
    <div class="video-info" style="padding:.6rem 0">
      <span style="display:inline-block;font-size:.55rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 7px;border-radius:2px;margin-bottom:.35rem;${catColors[badgeClass]||''}">${v.category||badgeClass}</span>
      <h4 style="margin:.2rem 0 .15rem;font-size:.88rem;color:var(--white)">${v.title||'Match Video'}</h4>
      <small style="color:var(--muted);font-size:.68rem">${v.created_at?new Date(v.created_at).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'}):''}</small>
    </div>
    <div class="video-player" id="vplayer-${v.id}" style="display:none;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;margin-top:.35rem">
      ${embedUrl
        ? `<iframe src="${embedUrl}" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen allow="autoplay"></iframe>`
        : `<video controls autoplay style="position:absolute;inset:0;width:100%;height:100%" src="${v.file_url}"></video>`}
    </div>
  </div>`;
}

function playVideoCard(id) {
  const thumb  = document.getElementById('vthumb-'  + id);
  const player = document.getElementById('vplayer-' + id);
  if (!player) return;
  const isOpen = player.style.display !== 'none';
  document.querySelectorAll('[id^="vplayer-"]').forEach(p => p.style.display = 'none');
  document.querySelectorAll('[id^="vthumb-"]').forEach(t => t.style.display = 'block');
  if (!isOpen) { player.style.display = 'block'; if (thumb) thumb.style.display = 'none'; }
}

function renderLiveStream() {
  const wrap = document.getElementById('liveStreamWrap');
  if (!wrap) return;
  const streamUrl = STATE.settings.live_stream_url || null;
  const rtmpUrl   = STATE.settings.live_rtmp_url   || 'rtmp://stream.krfkenya.co.ke/live';
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(39,174,96,.08),transparent);border:1px solid rgba(39,174,96,.2);border-radius:8px;padding:1.25rem;margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
      <div>
        <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#4cd97b;margin-bottom:.3rem">📡 Live Stream</div>
        <div style="font-size:.82rem;color:var(--dim)">${STATE.liveMatch?`● LIVE NOW: ${STATE.liveMatch.home_team?.name} vs ${STATE.liveMatch.away_team?.name}`:'No match live right now — stream will appear when a match goes live'}</div>
      </div>
      ${STATE.liveMatch?`<div style="display:flex;align-items:center;gap:.4rem"><div class="live-dot"></div><span style="font-size:.75rem;color:#4cd97b;font-weight:600">BROADCASTING</span></div>`:''}
    </div>
    ${streamUrl ? `
    <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;margin-bottom:1.25rem;border:1px solid var(--border)">
      ${streamUrl.includes('youtube')||streamUrl.includes('youtu.be')
        ? `<iframe src="${streamUrl.replace('watch?v=','embed/').replace('youtu.be/','youtube.com/embed/')}?autoplay=1" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen allow="autoplay"></iframe>`
        : `<video controls autoplay style="position:absolute;inset:0;width:100%;height:100%" src="${streamUrl}"></video>`}
    </div>` : `
    <div style="position:relative;padding-bottom:56.25%;height:0;background:var(--dark2);border:1px solid var(--border);border-radius:8px;margin-bottom:1.25rem;overflow:hidden">
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem">
        <div style="font-size:3rem;opacity:.2">📡</div>
        <div style="font-size:.85rem;color:var(--dim)">Stream offline</div>
        <div style="font-size:.7rem;color:var(--muted)">Set stream URL in Site Settings via Admin Portal</div>
      </div>
    </div>`}
    <div style="background:var(--dark2);border:1px solid var(--border);border-radius:6px;padding:.85rem 1.1rem">
      <div style="font-size:.6rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:.5rem">BROADCAST INFO</div>
      <div style="font-size:.75rem;color:var(--dim);margin-bottom:.3rem">RTMP Ingest: <span style="font-family:monospace;color:var(--gold)">${rtmpUrl}</span></div>
      <div style="font-size:.72rem;color:var(--muted)">Stream key provided to official broadcasters only.</div>
    </div>`;
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
