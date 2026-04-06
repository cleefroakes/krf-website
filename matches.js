// api/matches.js — KRF Match Management
// GET  /api/matches?action=list|get|live|standings|events
// POST /api/matches?action=create|score|event|report|sign|countersign|publish

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'krf-dev-secret-change-in-prod';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function verifyToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function requireRole(user, ...roles) {
  return user && roles.includes(user.role);
}

// ── GET HANDLERS ─────────────────────────────────────────

async function listMatches(query) {
  let q = supabase.from('matches').select(`
    *, 
    home_team:teams!home_team_id(id,name,abbr,color),
    away_team:teams!away_team_id(id,name,abbr,color),
    tournament:tournaments(id,name),
    referee:users!referee_id(id,name),
    commissioner:users!commissioner_id(id,name)
  `).order('match_date', { ascending: false });

  if (query.status)        q = q.eq('status', query.status);
  if (query.tournament_id) q = q.eq('tournament_id', query.tournament_id);
  if (query.team_id)       q = q.or(`home_team_id.eq.${query.team_id},away_team_id.eq.${query.team_id}`);
  if (query.limit)         q = q.limit(parseInt(query.limit));

  const { data, error } = await q;
  return { data, error };
}

async function getLiveMatches() {
  const { data, error } = await supabase.from('matches').select(`
    *,
    home_team:teams!home_team_id(id,name,abbr,color),
    away_team:teams!away_team_id(id,name,abbr,color),
    tournament:tournaments(name)
  `).eq('status', 'live');
  return { data, error };
}

async function getMatchEvents(match_id) {
  const { data, error } = await supabase.from('match_events').select(`
    *, player:users!player_id(name,jersey_number),
    team:teams!team_id(name,abbr,color),
    logged_by_user:users!logged_by(name,role)
  `).eq('match_id', match_id).order('minute', { ascending: true });
  return { data, error };
}

async function getStandings(tournament_id) {
  const { data, error } = await supabase.from('standings').select(`
    *, team:teams(id,name,abbr,color)
  `).eq('tournament_id', tournament_id).order('points', { ascending: false });
  return { data, error };
}

// ── POST HANDLERS ─────────────────────────────────────────

async function createMatch(body, user) {
  if (!requireRole(user, 'admin'))
    return { error: 'Admin only', status: 403 };

  const { data, error } = await supabase.from('matches').insert({
    tournament_id: body.tournament_id,
    home_team_id: body.home_team_id,
    away_team_id: body.away_team_id,
    venue: body.venue,
    match_date: body.match_date,
    round_number: body.round_number,
    referee_id: body.referee_id,
    linesman_id: body.linesman_id,
    commissioner_id: body.commissioner_id,
    score_official_id: body.score_official_id,
    status: 'upcoming'
  }).select().single();

  if (!error && data) {
    // Create pre-match checklist row
    await supabase.from('pre_match_checklists').insert({ match_id: data.id, commissioner_id: body.commissioner_id });
    // Init standings rows if needed
    await initStandings(body.tournament_id, [body.home_team_id, body.away_team_id]);
  }
  return { data, error };
}

async function initStandings(tournament_id, team_ids) {
  for (const team_id of team_ids) {
    await supabase.from('standings').upsert(
      { tournament_id, team_id },
      { onConflict: 'tournament_id,team_id', ignoreDuplicates: true }
    );
  }
}

async function updateScore(body, user) {
  if (!requireRole(user, 'admin', 'referee', 'official'))
    return { error: 'Not authorized to update scores', status: 403 };

  const { match_id, home_score, away_score, current_period, status } = body;
  const updates = { updated_at: new Date().toISOString() };
  if (home_score !== undefined) updates.home_score = home_score;
  if (away_score !== undefined) updates.away_score = away_score;
  if (current_period !== undefined) updates.current_period = current_period;
  if (status !== undefined) updates.status = status;

  const { data, error } = await supabase.from('matches').update(updates).eq('id', match_id).select().single();

  // If match completed, update standings
  if (status === 'completed' && data) {
    await updateStandings(data);
  }
  return { data, error };
}

async function logEvent(body, user) {
  if (!requireRole(user, 'admin', 'referee', 'linesman', 'official'))
    return { error: 'Not authorized to log events', status: 403 };

  const { data, error } = await supabase.from('match_events').insert({
    match_id: body.match_id,
    event_type: body.event_type,
    minute: body.minute,
    period: body.period,
    player_id: body.player_id,
    player_name: body.player_name,
    team_id: body.team_id,
    description: body.description,
    logged_by: user.id,
    logged_by_role: user.role
  }).select().single();

  // Auto-update player stats for goals/assists
  if (!error && body.event_type === 'goal' && body.player_id) {
    await supabase.rpc('increment_player_goals', {
      p_player_id: body.player_id,
      p_tournament_id: body.tournament_id
    }).catch(() => {});
  }
  return { data, error };
}

async function submitReport(body, user) {
  if (!requireRole(user, 'referee', 'admin'))
    return { error: 'Only referee can submit match report', status: 403 };

  const { data, error } = await supabase.from('match_reports').upsert({
    match_id: body.match_id,
    referee_id: user.id,
    narrative: body.narrative,
    post_match_comments: body.post_match_comments,
    disciplinary_summary: body.disciplinary_summary,
    referee_submitted_at: new Date().toISOString()
  }, { onConflict: 'match_id' }).select().single();

  if (!error) {
    await supabase.from('matches').update({ report_status: 'referee_submitted' }).eq('id', body.match_id);
  }
  return { data, error, message: 'Report submitted. Linesman notified for sign-off.' };
}

async function linemanSignOff(body, user) {
  if (!requireRole(user, 'linesman', 'admin'))
    return { error: 'Only linesman can sign off event log', status: 403 };

  const { data, error } = await supabase.from('match_reports')
    .update({ linesman_id: user.id, linesman_signed_at: new Date().toISOString() })
    .eq('match_id', body.match_id).select().single();

  if (!error) {
    await supabase.from('matches').update({ report_status: 'linesman_signed' }).eq('id', body.match_id);
  }
  return { data, error, message: 'Event log signed. Commissioner notified for countersign.' };
}

async function commissionerCountersign(body, user) {
  if (!requireRole(user, 'commissioner', 'admin'))
    return { error: 'Only commissioner can countersign', status: 403 };

  const { data, error } = await supabase.from('match_reports').update({
    commissioner_id: user.id,
    commissioner_notes: body.commissioner_notes,
    disciplinary_recommendations: body.disciplinary_recommendations,
    result_confirmation: body.result_confirmation || 'confirmed',
    commissioner_countersigned_at: new Date().toISOString()
  }).eq('match_id', body.match_id).select().single();

  if (!error) {
    await supabase.from('matches').update({
      report_status: 'commissioner_countersigned',
      report_locked: true
    }).eq('id', body.match_id);
  }
  return { data, error, message: 'Report countersigned and locked. Admin can now publish result.' };
}

async function publishResult(body, user) {
  if (!requireRole(user, 'admin'))
    return { error: 'Admin only', status: 403 };

  const { data: report } = await supabase.from('match_reports')
    .select('*').eq('match_id', body.match_id).single();

  if (!report?.commissioner_countersigned_at)
    return { error: 'Report must be countersigned before publishing', status: 400 };

  await supabase.from('match_reports').update({ published_at: new Date().toISOString() }).eq('match_id', body.match_id);
  const { data, error } = await supabase.from('matches').update({ status: 'completed' }).eq('id', body.match_id).select().single();
  return { data, error, message: 'Result published to public site.' };
}

async function updateStandings(match) {
  const homeWin = match.home_score > match.away_score;
  const awayWin = match.away_score > match.home_score;
  const draw    = match.home_score === match.away_score;

  async function applyResult(team_id, won, drawn, lost, gf, ga) {
    const pts = won ? 3 : drawn ? 1 : 0;
    const form = won ? 'W' : drawn ? 'D' : 'L';
    const { data: current } = await supabase.from('standings')
      .select('*').eq('tournament_id', match.tournament_id).eq('team_id', team_id).single();
    if (!current) return;
    const newForm = [...(current.form || []), form].slice(-5);
    await supabase.from('standings').update({
      played:        current.played + 1,
      won:           current.won + (won ? 1 : 0),
      drawn:         current.drawn + (drawn ? 1 : 0),
      lost:          current.lost + (lost ? 1 : 0),
      goals_for:     current.goals_for + gf,
      goals_against: current.goals_against + ga,
      points:        current.points + pts,
      form:          newForm,
      updated_at:    new Date().toISOString()
    }).eq('tournament_id', match.tournament_id).eq('team_id', team_id);
  }

  await applyResult(match.home_team_id, homeWin, draw, awayWin, match.home_score, match.away_score);
  await applyResult(match.away_team_id, awayWin, draw, homeWin, match.away_score, match.home_score);
}

// ── MAIN ─────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  const action = req.query.action;
  const body = req.body || {};

  try {
    // GET routes — mostly public
    if (req.method === 'GET') {
      if (action === 'list')       { const r = await listMatches(req.query);          return r.error ? res.status(500).json(r) : res.json(r.data); }
      if (action === 'live')       { const r = await getLiveMatches();                return r.error ? res.status(500).json(r) : res.json(r.data); }
      if (action === 'events')     { const r = await getMatchEvents(req.query.match_id); return r.error ? res.status(500).json(r) : res.json(r.data); }
      if (action === 'standings')  { const r = await getStandings(req.query.tournament_id); return r.error ? res.status(500).json(r) : res.json(r.data); }
    }

    // POST routes — auth required
    if (req.method === 'POST') {
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const handlers = {
        create:       () => createMatch(body, user),
        score:        () => updateScore(body, user),
        event:        () => logEvent(body, user),
        report:       () => submitReport(body, user),
        sign:         () => linemanSignOff(body, user),
        countersign:  () => commissionerCountersign(body, user),
        publish:      () => publishResult(body, user),
      };
      if (handlers[action]) {
        const result = await handlers[action]();
        if (result.status) return res.status(result.status).json({ error: result.error });
        return result.error ? res.status(500).json({ error: result.error.message }) : res.json(result);
      }
    }
    return res.status(404).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[matches]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};