// portal.js — KRF Member Portal
// Auth, role-based nav, live scoring, uploads, sign-off chain

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:      window.ENV_SUPABASE_URL      || 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: window.ENV_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY',
  API_BASE:          window.ENV_API_BASE           || '/api',
};

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let STATE = {
  user: null,
  token: null,
  currentPage: 'overview',
  sb: null,                  // Supabase client
  liveMatch: null,
  liveH: 0, liveA: 0,
  period: 1, matchTimer: 0,
  matchEnded: false,
  events: [],
  reportState: { refSubmitted: false, lineSignedOff: false, commCountersigned: false },
  precheck: [],
  teams: [], players: [], tournaments: [], schedules: [],
  docs: [], teamDocs: [],
  standings: {},
};

// ─────────────────────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────────────────────
function initSupabase() {
  if (window.supabase && CONFIG.SUPABASE_URL !== 'https://YOUR_PROJECT.supabase.co') {
    STATE.sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
}

function subscribeToLive(matchId) {
  if (!STATE.sb || !matchId) return;
  STATE.sb.channel(`match-${matchId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, payload => {
      const m = payload.new;
      STATE.liveH = m.home_score; STATE.liveA = m.away_score;
      STATE.period = m.current_period; STATE.matchEnded = m.status === 'completed';
      updateLiveDisplays();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, payload => {
      STATE.events.unshift(formatEvent(payload.new));
      const list = document.getElementById('evList');
      if (list) list.innerHTML = renderEventItems(STATE.events);
    })
    .subscribe();
}

// ─────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────
async function api(endpoint, params = {}, method = 'GET', body = null) {
  const qs = new URLSearchParams(params).toString();
  const url = `${CONFIG.API_BASE}/${endpoint}${qs ? '?' + qs : ''}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(STATE.token ? { Authorization: `Bearer ${STATE.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  };
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) { console.error(e); return null; }
}

async function uploadFile(file, docType, extraFields = {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('doc_type', docType);
  Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));
  const type = docType === 'video' ? 'video' : docType === 'photo' ? 'photo' : 'document';
  const res = await fetch(`${CONFIG.API_BASE}/upload?type=${type}`, {
    method: 'POST',
    headers: STATE.token ? { Authorization: `Bearer ${STATE.token}` } : {},
    body: form
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const pass  = document.getElementById('loginPass')?.value;
  if (!email || !pass) { showToast('Please enter your credentials'); return; }

  showToast('Signing in...');
  const result = await api('auth', { action: 'login' }, 'POST', { email, password: pass });

  if (result?.token) {
    STATE.token = result.token;
    STATE.user  = result.user;
    localStorage.setItem('krf_token', result.token);
    bootPortal();
  } else {
    showToast(result?.error || 'Login failed. Check your credentials.');
  }
}

async function doRegister() {
  const name     = document.getElementById('regName')?.value?.trim();
  const email    = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('regPass')?.value;
  if (!name || !email || !password) { showToast('Fill in all fields'); return; }

  const result = await api('auth', { action: 'register' }, 'POST', { name, email, password, role: 'player' });
  if (result?.token) {
    STATE.token = result.token; STATE.user = result.user;
    localStorage.setItem('krf_token', result.token);
    showToast('Welcome! Complete your registration.');
    bootPortal();
  } else {
    showToast(result?.error || 'Registration failed');
  }
}

async function checkSavedSession() {
  const saved = localStorage.getItem('krf_token');
  if (!saved) return;
  STATE.token = saved;
  const result = await api('auth', { action: 'me' });
  if (result?.user) { STATE.user = result.user; bootPortal(); }
  else { localStorage.removeItem('krf_token'); }
}

function doLogout() {
  STATE.token = null; STATE.user = null;
  localStorage.removeItem('krf_token');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').classList.remove('show');
}

// ─────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────
async function bootPortal() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('show');

  const u = STATE.user;
  const r = ROLE_CONFIG[u.role] || ROLE_CONFIG.player;

  document.getElementById('sbAv').textContent       = u.initials || u.name.split(' ').map(n=>n[0]).join('');
  document.getElementById('sbAv').style.background  = r.color + '18';
  document.getElementById('sbAv').style.color       = r.color;
  document.getElementById('sbAv').style.borderColor = r.color + '44';
  document.getElementById('sbName').textContent     = u.name;
  document.getElementById('sbRole').textContent     = r.label;
  document.getElementById('tbRole').textContent     = r.label;
  document.getElementById('app').style.setProperty('--role-color', r.color);

  buildNav();
  await loadPortalData();
  nav('overview');
}

async function loadPortalData() {
  const [teams, schedules] = await Promise.all([
    api('data', { resource: 'teams' }),
    api('matches', { action: 'list', limit: 10 }),
  ]);
  if (teams)     STATE.teams     = teams;
  if (schedules) STATE.schedules = schedules;

  // Live match
  const live = STATE.schedules?.find(m => m.status === 'live');
  if (live) {
    STATE.liveMatch = live;
    STATE.liveH = live.home_score; STATE.liveA = live.away_score;
    STATE.period = live.current_period;
    const sbPill = document.getElementById('sbLivePill');
    if (sbPill) sbPill.textContent = `LIVE — ${live.home_team?.abbr} ${STATE.liveH}:${STATE.liveA} ${live.away_team?.abbr}`;
    subscribeToLive(live.id);
  }

  // Load user docs
  const docsRes = await api('data', { resource: 'documents' });
  if (docsRes) STATE.docs = docsRes;
}

// ─────────────────────────────────────────────────────────
// ROLE CONFIG
// ─────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  admin:       { label: 'Administrator',    color: '#C8102E', icon: '⭐' },
  commissioner:{ label: 'Match Commissioner',color: '#0d8a6e', icon: '🏛️' },
  referee:     { label: 'Referee',           color: '#1a6fc4', icon: '🟥' },
  linesman:    { label: 'Linesman',          color: '#d4920a', icon: '🚩' },
  official:    { label: 'Score Official',    color: '#6d3fc4', icon: '🎯' },
  player:      { label: 'Player',            color: '#27ae60', icon: '🏃' },
};

const NAV_MAP = {
  admin: [
    { sec: 'Dashboard', items: [{ id:'overview',si:'▦',lbl:'Overview' },{ id:'schedule',si:'◷',lbl:'Schedule' }] },
    { sec: 'Match Day', items: [{ id:'live',si:'●',lbl:'Live Score Entry',badge:'LIVE' },{ id:'lineup',si:'◈',lbl:'Lineups' },{ id:'events',si:'◉',lbl:'Event Log' },{ id:'report',si:'◎',lbl:'Match Report' }] },
    { sec: 'Registration', items: [{ id:'playerreg',si:'◻',lbl:'Player Registration' },{ id:'teamreg',si:'◼',lbl:'Team Registration' }] },
    { sec: 'Admin', items: [{ id:'users',si:'◈',lbl:'Manage Users' },{ id:'teams_admin',si:'▣',lbl:'Teams & Rosters' },{ id:'tournaments',si:'◆',lbl:'Tournaments' },{ id:'gallery',si:'▨',lbl:'Gallery & Media' },{ id:'settings',si:'⚙',lbl:'Site Settings' }] },
  ],
  commissioner: [
    { sec: 'Dashboard', items: [{ id:'overview',si:'▦',lbl:'Overview' },{ id:'schedule',si:'◷',lbl:'Assignments' }] },
    { sec: 'Match Day', items: [{ id:'commlive',si:'●',lbl:'Match Monitor',badge:'LIVE' },{ id:'precheck',si:'✓',lbl:'Pre-Match Checklist' },{ id:'incidents',si:'⚠',lbl:'Incidents & Protests' },{ id:'countersign',si:'✍',lbl:'Countersign Report' }] },
    { sec: 'Documents', items: [{ id:'mydocs',si:'◻',lbl:'My Clearances' }] },
  ],
  referee: [
    { sec: 'Dashboard', items: [{ id:'overview',si:'▦',lbl:'Overview' },{ id:'schedule',si:'◷',lbl:'Assignments' }] },
    { sec: 'Match Day', items: [{ id:'live',si:'●',lbl:'Live Score Entry',badge:'LIVE' },{ id:'lineup',si:'◈',lbl:'Lineups' },{ id:'events',si:'◉',lbl:'Event Log' },{ id:'report',si:'◎',lbl:'File Match Report' }] },
    { sec: 'Documents', items: [{ id:'mydocs',si:'◻',lbl:'My Clearances' }] },
  ],
  linesman: [
    { sec: 'Dashboard', items: [{ id:'overview',si:'▦',lbl:'Overview' },{ id:'schedule',si:'◷',lbl:'Assignments' }] },
    { sec: 'Match Day', items: [{ id:'lineview',si:'●',lbl:'Match View',badge:'LIVE' },{ id:'boundary',si:'🚩',lbl:'Boundary Log' },{ id:'linesign',si:'✍',lbl:'Sign Event Log' }] },
    { sec: 'Documents', items: [{ id:'mydocs',si:'◻',lbl:'My Clearances' }] },
  ],
  official: [
    { sec: 'Dashboard', items: [{ id:'overview',si:'▦',lbl:'Overview' },{ id:'schedule',si:'◷',lbl:'Schedule' }] },
    { sec: 'Match Day', items: [{ id:'live',si:'●',lbl:'Score Entry',badge:'LIVE' },{ id:'events',si:'◉',lbl:'Event Log' }] },
    { sec: 'Documents', items: [{ id:'mydocs',si:'◻',lbl:'My Clearances' }] },
  ],
  player: [
    { sec: 'My Portal', items: [{ id:'overview',si:'▦',lbl:'Dashboard' },{ id:'profile',si:'◉',lbl:'My Profile' },{ id:'mystats',si:'▣',lbl:'My Stats' },{ id:'schedule',si:'◷',lbl:'Schedule' }] },
    { sec: 'Registration', items: [{ id:'playerreg',si:'◻',lbl:'Registration & Docs' }] },
  ],
};

// ─────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────
function buildNav() {
  const sections = NAV_MAP[STATE.user.role] || NAV_MAP.player;
  document.getElementById('sideNav').innerHTML = sections.map(s => `
    <div class="sb-sec">${s.sec}</div>
    ${s.items.map(i => `
      <div class="sb-item" id="nav-${i.id}" onclick="nav('${i.id}')">
        <span class="si">${i.si}</span>${i.lbl}
        ${i.badge ? `<span class="sb-badge-pill">${i.badge}</span>` : ''}
      </div>`).join('')}`).join('');
}

const PAGE_META = {
  overview:     ['OVERVIEW', 'Dashboard'],
  live:         ['LIVE SCORE ENTRY', 'Real-time match scoring'],
  lineup:       ['TEAM LINEUP', 'Starting XI & positions'],
  events:       ['EVENT LOG', 'Goals, cards, fouls'],
  report:       ['MATCH REPORT', 'File & submit'],
  playerreg:    ['PLAYER REGISTRATION', 'Profile & documents'],
  teamreg:      ['TEAM REGISTRATION', 'Club & official docs'],
  users:        ['MANAGE USERS', 'Accounts & roles'],
  teams_admin:  ['TEAMS & ROSTERS', 'Club management'],
  tournaments:  ['TOURNAMENTS', 'Competition management'],
  gallery:      ['GALLERY & MEDIA', 'Photos, videos & streaming'],
  settings:     ['SITE SETTINGS', 'Public site configuration'],
  profile:      ['MY PROFILE', 'Personal info & photo'],
  mystats:      ['MY STATISTICS', 'Season performance'],
  schedule:     ['SCHEDULE', 'Fixtures & assignments'],
  commlive:     ['MATCH MONITOR', 'Commissioner · Read-only'],
  precheck:     ['PRE-MATCH CHECKLIST', 'Venue & eligibility'],
  incidents:    ['INCIDENTS & PROTESTS', 'Official log'],
  countersign:  ['COUNTERSIGN REPORT', 'Final approval'],
  boundary:     ['BOUNDARY LOG', 'Decisions & calls'],
  lineview:     ['MATCH VIEW', 'Linesman live overview'],
  linesign:     ['SIGN EVENT LOG', 'Review & sign-off'],
  mydocs:       ['MY CLEARANCES', 'Document uploads'],
};

function nav(id) {
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  const el = document.getElementById('nav-' + id); if (el) el.classList.add('active');
  const meta = PAGE_META[id] || [id.toUpperCase(), ''];
  document.getElementById('tbTitle').textContent = meta[0];
  document.getElementById('tbSub').textContent   = meta[1];
  STATE.currentPage = id;
  renderPortalPage(id);
}

// ─────────────────────────────────────────────────────────
// PAGE ROUTER — delegates to portal-pages.js helpers
// All page renders are defined inline here for single-file deployment
// ─────────────────────────────────────────────────────────
function renderPortalPage(id) {
  // Dispatch to the portal HTML's own render functions (defined in portal.html inline script)
  if (window.PORTAL_RENDERS && window.PORTAL_RENDERS[id]) {
    window.PORTAL_RENDERS[id]();
  } else if (window.renderPortalPageById) {
    window.renderPortalPageById(id);
  }
}

// ─────────────────────────────────────────────────────────
// LIVE SCORE
// ─────────────────────────────────────────────────────────
async function addGoal(side) {
  if (STATE.matchEnded) { showToast('Match has ended'); return; }
  if (side === 'home') STATE.liveH++; else STATE.liveA++;
  updateLiveDisplays();

  const team = side === 'home' ? STATE.liveMatch?.home_team?.name : STATE.liveMatch?.away_team?.name;
  const elapsed = Math.max(1, STATE.period * 15 - Math.floor(STATE.matchTimer / 60));

  // Push to API
  if (STATE.liveMatch) {
    await api('matches', { action: 'score' }, 'POST', {
      match_id: STATE.liveMatch.id,
      home_score: STATE.liveH,
      away_score: STATE.liveA,
    });
    await api('matches', { action: 'event' }, 'POST', {
      match_id: STATE.liveMatch.id,
      event_type: 'goal',
      minute: elapsed,
      period: STATE.period,
      description: `GOAL — Player (${team}) [${STATE.liveH}–${STATE.liveA}]`,
      tournament_id: STATE.liveMatch?.tournament_id,
    });
  }

  STATE.events.unshift({ min: elapsed + "'", type: 'goal', icon: '⚽', desc: `<strong>GOAL</strong> — Player (${team}) [${STATE.liveH}–${STATE.liveA}]`, by: STATE.user.role });
  refreshEventList();
  showToast(`GOAL! ${team} — ${STATE.liveH}:${STATE.liveA}`);
}

async function undoGoal(side) {
  if (side === 'home' && STATE.liveH > 0) STATE.liveH--;
  else if (side === 'away' && STATE.liveA > 0) STATE.liveA--;
  if (STATE.liveMatch) {
    await api('matches', { action: 'score' }, 'POST', { match_id: STATE.liveMatch.id, home_score: STATE.liveH, away_score: STATE.liveA });
  }
  updateLiveDisplays();
  showToast('Goal removed');
}

async function nextPeriod() {
  if (STATE.period >= 4) { await endMatch(); return; }
  STATE.period++;
  STATE.matchTimer = 15 * 60;
  if (STATE.liveMatch) await api('matches', { action: 'score' }, 'POST', { match_id: STATE.liveMatch.id, current_period: STATE.period });
  document.getElementById('periodBadge') && (document.getElementById('periodBadge').textContent = 'Q' + STATE.period);
  showToast('Q' + STATE.period + ' started!');
}

async function endMatch() {
  STATE.matchEnded = true;
  if (STATE.liveMatch) await api('matches', { action: 'score' }, 'POST', { match_id: STATE.liveMatch.id, status: 'completed' });
  document.getElementById('periodBadge') && (document.getElementById('periodBadge').textContent = 'FT');
  showToast(`Full Time! ${STATE.liveH}:${STATE.liveA}`);
}

async function logEvent() {
  const type   = document.getElementById('evType')?.value;
  const player = document.getElementById('evPlayer')?.value || 'Player';
  const team   = document.getElementById('evTeam')?.value;
  const icons  = { goal: '⚽', yellow: '🟨', red_card: '🟥', foul: '🔴', sub: '🔄', injury: '🩹', boundary: '🚩', offside: '⛔' };
  const elapsed = Math.max(1, STATE.period * 15 - Math.floor(STATE.matchTimer / 60));

  if (STATE.liveMatch) {
    await api('matches', { action: 'event' }, 'POST', {
      match_id: STATE.liveMatch.id, event_type: type,
      minute: elapsed, period: STATE.period,
      player_name: player, description: `${type.replace('_',' ').toUpperCase()} — ${player} (${team})`,
    });
  }

  STATE.events.unshift({ min: elapsed + "'", type, icon: icons[type] || '◉', desc: `<strong>${type.replace('_', ' ').toUpperCase()}</strong> — ${player} (${team})`, by: STATE.user.role });
  refreshEventList();
  const evPlayer = document.getElementById('evPlayer'); if (evPlayer) evPlayer.value = '';
  showToast('Event logged');
}

function formatEvent(e) {
  const icons = { goal:'⚽', yellow:'🟨', red_card:'🟥', foul:'🔴', sub:'🔄', injury:'🩹', boundary:'🚩', offside:'⛔' };
  return { min: (e.minute || 0) + "'", type: e.event_type, icon: icons[e.event_type] || '◉', desc: e.description || e.event_type, by: e.logged_by_role || '' };
}

function renderEventItems(events) {
  return events.map(e => `
    <div class="ev-item">
      <span class="ev-min">${e.min}</span>
      <div class="ev-ico ${e.type}">${e.icon}</div>
      <span class="ev-desc">${e.desc}</span>
      <span class="ev-by">${e.by || ''}</span>
    </div>`).join('');
}

function refreshEventList() {
  const list = document.getElementById('evList');
  if (list) list.innerHTML = renderEventItems(STATE.events);
  const pg = document.querySelector('.ev-head .pg');
  if (pg) pg.textContent = `${STATE.events.length} events · Live`;
}

function updateLiveDisplays() {
  ['liveH','liveA'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.textContent = [STATE.liveH, STATE.liveA][i]; });
  const ms = document.getElementById('miniScore'); if (ms) ms.textContent = `${STATE.liveH} — ${STATE.liveA}`;
  const sb = document.getElementById('sbLivePill');
  if (sb && STATE.liveMatch) sb.textContent = `LIVE — ${STATE.liveMatch.home_team?.abbr} ${STATE.liveH}:${STATE.liveA} ${STATE.liveMatch.away_team?.abbr}`;
}

// Live timer
setInterval(() => {
  if (STATE.matchEnded || STATE.matchTimer <= 0) return;
  STATE.matchTimer--;
  const m = Math.floor(STATE.matchTimer / 60), s = STATE.matchTimer % 60;
  const str = `Q${STATE.period} · ${m}:${s.toString().padStart(2, '0')} remaining`;
  const el = document.getElementById('liveTimerEl'); if (el) el.textContent = str;
  const mt = document.getElementById('miniTimer'); if (mt) mt.textContent = str;
}, 1000);

// ─────────────────────────────────────────────────────────
// REPORT SIGN-OFF
// ─────────────────────────────────────────────────────────
async function submitReport(narrative, comments, disciplinary) {
  if (!STATE.liveMatch) { showToast('No active match'); return; }
  const result = await api('matches', { action: 'report' }, 'POST', {
    match_id: STATE.liveMatch.id, narrative, post_match_comments: comments, disciplinary_summary: disciplinary
  });
  if (result && !result.error) {
    STATE.reportState.refSubmitted = true;
    showToast('Report submitted! Linesman notified for sign-off.');
    updateSignoffUI();
  } else showToast(result?.error || 'Submit failed');
}

async function linemanSign() {
  if (!STATE.liveMatch) return;
  const result = await api('matches', { action: 'sign' }, 'POST', { match_id: STATE.liveMatch.id });
  if (result && !result.error) {
    STATE.reportState.lineSignedOff = true;
    showToast('Event log signed! Commissioner notified.');
    updateSignoffUI();
  } else showToast(result?.error || 'Sign-off failed');
}

async function commCountersign(notes, recommendation) {
  if (!STATE.liveMatch) return;
  const result = await api('matches', { action: 'countersign' }, 'POST', {
    match_id: STATE.liveMatch.id, commissioner_notes: notes, disciplinary_recommendations: recommendation
  });
  if (result && !result.error) {
    STATE.reportState.commCountersigned = true;
    showToast('Report countersigned and locked!');
    updateSignoffUI();
  } else showToast(result?.error || 'Countersign failed');
}

function updateSignoffUI() {
  document.querySelectorAll('[data-signoff]').forEach(el => {
    const step = el.dataset.signoff;
    const done = { ref: STATE.reportState.refSubmitted, line: STATE.reportState.lineSignedOff, comm: STATE.reportState.commCountersigned };
    el.className = el.className.replace(/sof-step \w+/, '') + ` sof-step ${done[step] ? 'done' : 'current'}`;
  });
}

// ─────────────────────────────────────────────────────────
// DOCUMENT UPLOAD
// ─────────────────────────────────────────────────────────
async function handleDocUpload(inputEl, docType) {
  const file = inputEl.files[0];
  if (!file) return;
  showToast('Uploading...');
  const result = await uploadFile(file, docType);
  if (result && !result.error) {
    showToast(`${docType.replace('_', ' ')} uploaded!`);
    // Refresh docs
    const docsRes = await api('data', { resource: 'documents' });
    if (docsRes) { STATE.docs = docsRes; }
  } else showToast(result?.error || 'Upload failed');
}

function getDocStatus(docType) {
  const doc = STATE.docs.find(d => d.doc_type === docType);
  return doc?.status || 'pending';
}

// ─────────────────────────────────────────────────────────
// PROFILE UPDATE
// ─────────────────────────────────────────────────────────
async function saveProfile(data) {
  const result = await api('auth', { action: 'update' }, 'POST', data);
  if (result?.user) { STATE.user = result.user; showToast('Profile updated!'); }
  else showToast(result?.error || 'Update failed');
}

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  checkSavedSession();
});