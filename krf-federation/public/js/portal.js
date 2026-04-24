// portal.js — KRF Member Portal
// Auth, role-based nav, live scoring, uploads, sign-off chain

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:      window.ENV_SUPABASE_URL      || 'https://eseffwgiogcbwnatrssz.supabase.co',
  SUPABASE_ANON_KEY: window.ENV_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZWZmd2dpb2djYnduYXRyc3N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzU0NzQsImV4cCI6MjA5MTA1MTQ3NH0.Qvf3AJJD2rr_fVasvB2ntE0_-LIfSiawEWTnQBKIXmg',
  API_BASE:          window.ENV_API_BASE           || '/api',
};

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let STATE = {
  user: null,
  token: null,
  currentPage: 'overview',
  sb: null,
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
  if (window.supabase) {
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
// AUTH
// ─────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const pass  = document.getElementById('loginPass')?.value;
  if (!email || !pass) { showToast('Please enter your credentials'); return; }

  showToast('Signing in...');
  const { data, error } = await STATE.sb.auth.signInWithPassword({ email, password: pass });
  if (error) { showToast(error.message); return; }

  const { data: profile } = await STATE.sb.from('users').select('*, teams(id,name,abbr,color)').eq('id', data.user.id).single();
  STATE.user = profile || { id: data.user.id, name: data.user.user_metadata?.name || email.split('@')[0], role: 'player', email };
  STATE.user.initials = (STATE.user.name || '').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  bootPortal();
}

async function doRegister() {
  const name     = document.getElementById('regName')?.value?.trim();
  const email    = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('regPass')?.value;
  if (!name || !email || !password) { showToast('Fill in all fields'); return; }
  if (password.length < 8) { showToast('Password must be at least 8 characters'); return; }

  showToast('Creating account...');
  const { data, error } = await STATE.sb.auth.signUp({ email, password, options: { data: { name } } });
  if (error) { showToast(error.message); return; }

  await STATE.sb.from('users').insert({ id: data.user.id, name, email, role: 'player', docs_status: 'incomplete', is_active: false });
  STATE.user = { id: data.user.id, name, email, role: 'player', docs_status: 'incomplete', is_active: false };
  STATE.user.initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  showToast('Welcome! Complete your registration.');
  bootPortal();
}

async function checkSavedSession() {
  const { data: { session } } = await STATE.sb.auth.getSession();
  if (!session?.user) return;
  const { data: profile } = await STATE.sb.from('users').select('*, teams(id,name,abbr,color)').eq('id', session.user.id).single();
  STATE.user = profile || { id: session.user.id, name: session.user.user_metadata?.name || 'User', role: 'player', email: session.user.email };
  STATE.user.initials = (STATE.user.name || '').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  bootPortal();
}

function doLogout() {
  STATE.sb.auth.signOut();
  STATE.user = null;
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

  document.getElementById('sbAv').textContent       = u.initials || '??';
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

// ─────────────────────────────────────────────────────────
// LOAD PORTAL DATA — real Supabase only, no mock
// ─────────────────────────────────────────────────────────
async function loadPortalData() {
  const [{ data: teams }, { data: schedules }] = await Promise.all([
    STATE.sb.from('teams').select('*, standings(points,played,won,drawn,lost,goals_for,goals_against)').eq('is_active', true).order('name'),
    STATE.sb.from('matches').select('*, home_team:teams!home_team_id(id,name,abbr,color), away_team:teams!away_team_id(id,name,abbr,color), tournament:tournaments(id,name)').order('match_date', { ascending: true }).limit(20),
  ]);
  if (teams)     STATE.teams     = teams;
  if (schedules) STATE.schedules = schedules;

  const live = schedules?.find(m => m.status === 'live');
  if (live) {
    STATE.liveMatch = live;
    STATE.liveH = live.home_score || 0;
    STATE.liveA = live.away_score || 0;
    STATE.period = live.current_period || 1;
    const pill = document.getElementById('sbLivePill');
    if (pill) pill.textContent = `LIVE — ${live.home_team?.abbr} ${STATE.liveH}:${STATE.liveA} ${live.away_team?.abbr}`;
    subscribeToLive(live.id);
  } else {
    const pill = document.getElementById('sbLivePill');
    if (pill) pill.textContent = 'No match live right now';
  }

  const { data: docs } = await STATE.sb.from('documents').select('*').eq('user_id', STATE.user.id);
  if (docs) STATE.docs = docs;
}

// ─────────────────────────────────────────────────────────
// ROLE CONFIG
// ─────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  admin:       { label: 'Administrator',     color: '#C8102E', icon: '⭐' },
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
    { sec: 'Admin', items: [{ id:'users',si:'◈',lbl:'Manage Users' },{ id:'teams_admin',si:'▣',lbl:'Teams & Rosters' },{ id:'tournaments',si:'◆',lbl:'Tournaments' },{ id:'gallery',si:'▨',lbl:'Gallery & Media' },{ id:'news',si:'📰',lbl:'News & Announcements' },{ id:'settings',si:'⚙',lbl:'Site Settings' }] },
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
  news:         ['NEWS & ANNOUNCEMENTS', 'Publish articles'],
  user_docs:    ['USER DOCUMENTS', 'Review & approve'],
};

function nav(id, extra) {
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  const el = document.getElementById('nav-' + id); if (el) el.classList.add('active');
  const meta = PAGE_META[id] || [id.toUpperCase(), ''];
  document.getElementById('tbTitle').textContent = meta[0];
  document.getElementById('tbSub').textContent   = meta[1];
  STATE.currentPage = id;
  STATE._navExtra = extra || null;
  renderPortalPage(id);
}

function renderPortalPage(id) {
  if (window.renderPortalPageById) window.renderPortalPageById(id);
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

  if (STATE.liveMatch) {
    await STATE.sb.from('matches').update({ home_score: STATE.liveH, away_score: STATE.liveA }).eq('id', STATE.liveMatch.id);
    await STATE.sb.from('match_events').insert({
      match_id: STATE.liveMatch.id, event_type: 'goal', minute: elapsed, period: STATE.period,
      description: `GOAL — Player (${team}) [${STATE.liveH}–${STATE.liveA}]`,
      logged_by: STATE.user.id, logged_by_role: STATE.user.role,
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
    await STATE.sb.from('matches').update({ home_score: STATE.liveH, away_score: STATE.liveA }).eq('id', STATE.liveMatch.id);
  }
  updateLiveDisplays();
  showToast('Goal removed');
}

async function nextPeriod() {
  if (STATE.period >= 4) { await endMatch(); return; }
  STATE.period++;
  STATE.matchTimer = 15 * 60;
  if (STATE.liveMatch) await STATE.sb.from('matches').update({ current_period: STATE.period }).eq('id', STATE.liveMatch.id);
  document.getElementById('periodBadge') && (document.getElementById('periodBadge').textContent = 'Q' + STATE.period);
  showToast('Q' + STATE.period + ' started!');
}

async function endMatch() {
  STATE.matchEnded = true;
  if (STATE.liveMatch) await STATE.sb.from('matches').update({ status: 'completed' }).eq('id', STATE.liveMatch.id);
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
    await STATE.sb.from('match_events').insert({
      match_id: STATE.liveMatch.id, event_type: type, minute: elapsed, period: STATE.period,
      player_name: player, description: `${type.replace('_',' ').toUpperCase()} — ${player} (${team})`,
      logged_by: STATE.user.id, logged_by_role: STATE.user.role,
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
  const { error } = await STATE.sb.from('match_reports').upsert({
    match_id: STATE.liveMatch.id, narrative,
    post_match_comments: comments, disciplinary_summary: disciplinary,
    referee_id: STATE.user.id, ref_submitted: true, ref_submitted_at: new Date().toISOString(),
  });
  if (!error) {
    STATE.reportState.refSubmitted = true;
    showToast('Report submitted! Linesman notified for sign-off.');
  } else showToast(error.message || 'Submit failed');
}

async function linemanSign() {
  if (!STATE.liveMatch) return;
  const { error } = await STATE.sb.from('match_reports')
    .update({ line_signed_off: true, line_signed_at: new Date().toISOString(), linesman_id: STATE.user.id })
    .eq('match_id', STATE.liveMatch.id);
  if (!error) {
    STATE.reportState.lineSignedOff = true;
    showToast('Event log signed! Commissioner notified.');
  } else showToast(error.message);
}

async function commCountersign(notes, recommendation) {
  if (!STATE.liveMatch) return;
  const { error } = await STATE.sb.from('match_reports')
    .update({ comm_countersigned: true, comm_notes: notes, comm_disciplinary: recommendation, comm_signed_at: new Date().toISOString(), commissioner_id: STATE.user.id })
    .eq('match_id', STATE.liveMatch.id);
  if (!error) {
    STATE.reportState.commCountersigned = true;
    showToast('Report countersigned and locked!');
  } else showToast(error.message);
}

// ─────────────────────────────────────────────────────────
// DOCUMENT UPLOAD
// ─────────────────────────────────────────────────────────
async function handleDocUpload(inputEl, docType) {
  const file = inputEl.files[0];
  if (!file) return;
  showToast('Uploading...');

  const isMedia = docType === 'photo' || docType === 'video' || docType === 'hero';
  const bucket  = isMedia ? 'media' : 'player-docs';
  const folder  = isMedia ? `${docType}s` : `documents/${STATE.user.id}`;
  const ext     = file.name.split('.').pop();
  const path    = `${folder}/${Date.now()}.${ext}`;

  const { error: uploadError } = await STATE.sb.storage.from(bucket).upload(path, file, { upsert: true });
  if (uploadError) { showToast('Upload failed: ' + uploadError.message); return; }

  const { data: { publicUrl } } = STATE.sb.storage.from(bucket).getPublicUrl(path);

  if (isMedia) {
    await STATE.sb.from('media').insert({
      title: file.name, media_type: docType, file_url: publicUrl,
      approved: true, visibility: 'public', uploaded_by: STATE.user.id,
    });
    showToast('Media uploaded and live on public site!');
  } else {
    await STATE.sb.from('documents').upsert({
      user_id: STATE.user.id, doc_type: docType, file_url: publicUrl,
      status: 'pending', uploaded_at: new Date().toISOString(),
    });
    const { data: docs } = await STATE.sb.from('documents').select('*').eq('user_id', STATE.user.id);
    if (docs) STATE.docs = docs;
    showToast(`${docType.replace('_', ' ')} uploaded! Pending admin review.`);
  }
}

// ─────────────────────────────────────────────────────────
// ADMIN — APPROVE / REJECT USERS
// ─────────────────────────────────────────────────────────

// Approve user account (set is_active = true)
async function approveUser(userId) {
  const { error } = await STATE.sb.from('users').update({ is_active: true }).eq('id', userId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('User approved and activated!');
  nav('users');
}

// Reject / deactivate user account
async function rejectUser(userId) {
  const { error } = await STATE.sb.from('users').update({ is_active: false }).eq('id', userId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('User deactivated.');
  nav('users');
}

// Change a user's role
async function setUserRole(userId, newRole) {
  const { error } = await STATE.sb.from('users').update({ role: newRole }).eq('id', userId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Role updated to ' + newRole);
  nav('users');
}

// ─────────────────────────────────────────────────────────
// ADMIN — APPROVE / REJECT DOCUMENTS
// ─────────────────────────────────────────────────────────

// Approve a single document
async function approveDoc(docId) {
  const { error } = await STATE.sb.from('documents')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: STATE.user.id })
    .eq('id', docId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Document approved ✓');
  // Refresh current view
  if (STATE._navExtra?.userId) {
    openUserDocs(STATE._navExtra.userId, STATE._navExtra.userName);
  } else {
    nav('users');
  }
}

// Flag / reject a document
async function flagDoc(docId, reason) {
  const { error } = await STATE.sb.from('documents')
    .update({ status: 'flagged', flag_reason: reason || 'Flagged by admin', reviewed_at: new Date().toISOString(), reviewed_by: STATE.user.id })
    .eq('id', docId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Document flagged.');
  if (STATE._navExtra?.userId) {
    openUserDocs(STATE._navExtra.userId, STATE._navExtra.userName);
  }
}

// After reviewing all docs, mark user docs_status as approved
async function clearUserDocs(userId) {
  const { error } = await STATE.sb.from('users').update({ docs_status: 'approved' }).eq('id', userId);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('All documents cleared — user fully approved!');
  nav('users');
}

// Open doc review panel for a specific user
async function openUserDocs(userId, userName) {
  STATE._navExtra = { userId, userName };
  document.getElementById('tbTitle').textContent = 'USER DOCUMENTS';
  document.getElementById('tbSub').textContent   = userName || userId;

  const { data: docs } = await STATE.sb.from('documents').select('*').eq('user_id', userId).order('uploaded_at', { ascending: false });
  const allDocs = docs || [];

  const DOC_LABELS = {
    national_id: '🪪 National ID', passport_photo: '📷 Passport Photo', player_status: '📋 Player Status',
    ministry_form: '📄 Ministry Form', officiating_licence: '🏅 Officiating Licence',
    police_clearance: '🏛️ Police Clearance', helb_clearance: '🎓 HELB Clearance',
    eacc_clearance: '⚖️ EACC Clearance', crb_clearance: '💳 CRB Clearance',
    tax_compliance: '🧾 Tax Compliance', kra_pin: '📌 KRA PIN',
  };

  const approved = allDocs.filter(d => d.status === 'approved').length;
  const flagged  = allDocs.filter(d => d.status === 'flagged').length;
  const pending  = allDocs.filter(d => d.status === 'pending').length;

  document.getElementById('mainContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
      <button class="btn-s" onclick="nav('users')">← Back to Users</button>
      <div style="font-size:.85rem;font-weight:600;color:var(--white)">${userName}</div>
      <span class="bdg bdg-green">${approved} approved</span>
      ${flagged ? `<span class="bdg bdg-red">${flagged} flagged</span>` : ''}
      ${pending ? `<span class="bdg bdg-amber">${pending} pending</span>` : ''}
    </div>

    ${allDocs.length === 0 ? `
      <div style="padding:2.5rem;text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:8px">
        <div style="font-size:2rem;opacity:.25;margin-bottom:.75rem">📂</div>
        <div style="color:var(--dim);font-size:.85rem">No documents uploaded yet by this user.</div>
      </div>` : `
      <div style="display:grid;gap:.6rem">
        ${allDocs.map(d => {
          const label = DOC_LABELS[d.doc_type] || ('📄 ' + d.doc_type.replace(/_/g,' '));
          const isImg = d.file_url && /\.(jpg|jpeg|png|webp|gif)$/i.test(d.file_url);
          const isPdf = d.file_url && /\.pdf$/i.test(d.file_url);
          return `
          <div style="background:var(--bg2);border:1px solid ${d.status==='approved'?'rgba(39,174,96,.35)':d.status==='flagged'?'rgba(200,16,46,.35)':'var(--border)'};border-radius:8px;padding:.85rem 1rem;display:flex;align-items:flex-start;gap:.85rem;flex-wrap:wrap">
            <div style="flex:1;min-width:180px">
              <div style="font-size:.82rem;font-weight:600;color:var(--white);margin-bottom:.2rem">${label}</div>
              <div style="font-size:.68rem;color:var(--dim)">Uploaded: ${d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
              ${d.flag_reason ? `<div style="font-size:.68rem;color:var(--red);margin-top:.2rem">⚠ ${d.flag_reason}</div>` : ''}
            </div>
            ${d.file_url ? `
              <div style="flex-shrink:0">
                ${isImg
                  ? `<a href="${d.file_url}" target="_blank"><img src="${d.file_url}" style="height:52px;width:auto;border-radius:4px;border:1px solid var(--border);object-fit:cover" onerror="this.style.display='none'"/></a>`
                  : `<a href="${d.file_url}" target="_blank" class="btn-s" style="font-size:.68rem;padding:.3rem .65rem">📎 View File</a>`}
              </div>` : '<div style="font-size:.7rem;color:var(--muted)">No file</div>'}
            <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0;margin-left:auto">
              <span class="bdg bdg-${d.status==='approved'?'green':d.status==='flagged'?'red':'amber'}" style="font-size:.65rem">${d.status}</span>
              ${d.status !== 'approved' ? `<button class="btn-s" style="font-size:.65rem;padding:.28rem .65rem;color:var(--green);border-color:rgba(39,174,96,.4)" onclick="approveDoc('${d.id}')">✓ Approve</button>` : ''}
              ${d.status !== 'flagged'  ? `<button class="btn-s" style="font-size:.65rem;padding:.28rem .65rem;color:var(--red);border-color:rgba(200,16,46,.4)"   onclick="promptFlagDoc('${d.id}')">⚑ Flag</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:1rem;display:flex;gap:.5rem">
        <button class="btn-p" onclick="clearUserDocs('${userId}')">✓ CLEAR ALL — Mark Fully Approved</button>
        <button class="btn-s" onclick="nav('users')">← Back to Users</button>
      </div>
    `}`;
}

// Prompt for a flag reason before flagging
function promptFlagDoc(docId) {
  const reason = prompt('Flag reason (shown to user):') || 'Document invalid or unclear';
  flagDoc(docId, reason);
}

// ─────────────────────────────────────────────────────────
// PROFILE UPDATE
// ─────────────────────────────────────────────────────────
async function saveProfile(data) {
  const { error } = await STATE.sb.from('users').update(data).eq('id', STATE.user.id);
  if (error) { showToast('Update failed: ' + error.message); return; }
  Object.assign(STATE.user, data);
  document.getElementById('sbName').textContent = STATE.user.name || STATE.user.email;
  showToast('Profile updated!');
}

// ─────────────────────────────────────────────────────────
// NEWS
// ─────────────────────────────────────────────────────────
async function publishNews() {
  const title   = document.getElementById('news-title')?.value?.trim();
  const content = document.getElementById('news-content')?.value?.trim();
  const tag     = document.getElementById('news-tag')?.value || 'News';
  const cover   = document.getElementById('news-cover')?.value?.trim() || null;
  const video   = document.getElementById('news-video')?.value?.trim() || null;
  if (!title || !content) { showToast('Please fill in title and content'); return; }

  showToast('Publishing...');
  const { error } = await STATE.sb.from('news').insert({
    title, content, tag,
    cover_image_url: cover, video_url: video,
    published: true, published_at: new Date().toISOString(), author_id: STATE.user.id,
  });
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Article published and live on site!');
  document.getElementById('newsForm').style.display = 'none';
  nav('news');
}

// ─────────────────────────────────────────────────────────
// SITE SETTINGS
// ─────────────────────────────────────────────────────────
async function saveSettings() {
  const fields = [
    ['hero_video_url',  document.getElementById('heroUrl')?.value],
    ['ticker_message', document.getElementById('tickerMsg')?.value],
    ['season_label',   document.getElementById('seasonLabel')?.value],
    ['facebook_url',   document.getElementById('fbUrl')?.value],
    ['instagram_url',  document.getElementById('igUrl')?.value],
    ['youtube_url',    document.getElementById('ytUrl')?.value],
    ['twitter_url',    document.getElementById('twUrl')?.value],
  ].filter(([, v]) => v !== null && v !== undefined);

  showToast('Saving...');
  for (const [key, value] of fields) {
    await STATE.sb.from('site_settings').upsert({ key, value });
  }
  showToast('Settings saved!');
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
