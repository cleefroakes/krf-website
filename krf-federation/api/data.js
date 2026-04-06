// api/data.js — KRF Data CRUD
// GET  /api/data?resource=teams|players|tournaments|standings|news|sponsors|settings|media
// POST /api/data?resource=...&action=create|update|delete|approve

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

// ── GET HANDLERS ─────────────────────────────────────────

const GET_HANDLERS = {

  teams: async (q) => supabase.from('teams').select(`
    *, manager:users!manager_id(id,name,passport_photo_url),
    standings(played,won,drawn,lost,goals_for,goals_against,points,form,tournament_id)
  `).eq('is_active', true).order('name'),

  players: async (q) => {
    let query = supabase.from('users').select(`
      id, name, initials, position, jersey_number, player_status, age_category,
      passport_photo_url, docs_status, county,
      team:teams(id,name,abbr,color),
      player_stats(goals,assists,games_played,yellow_cards,red_cards,tournament_id)
    `).eq('role', 'player').eq('is_active', true);
    if (q.team_id) query = query.eq('team_id', q.team_id);
    return query.order('name');
  },

  officials: async (q) => supabase.from('users').select(`
    id, name, initials, role, passport_photo_url, docs_status,
    team:teams(id,name)
  `).in('role', ['referee','linesman','commissioner','official']).eq('is_active', true),

  tournaments: async (q) => supabase.from('tournaments').select(`
    *, tournament_teams(team:teams(id,name,abbr,color))
  `).order('created_at', { ascending: false }),

  standings: async (q) => supabase.from('standings').select(`
    *, team:teams(id,name,abbr,color,city),
    tournament:tournaments(id,name)
  `).eq('tournament_id', q.tournament_id).order('points', { ascending: false }),

  news: async (q) => {
    let query = supabase.from('news').select('*, author:users!author_id(name)');
    if (!q.all) query = query.eq('published', true);
    return query.order('created_at', { ascending: false }).limit(parseInt(q.limit) || 20);
  },

  sponsors: async () => supabase.from('sponsors').select('*').eq('is_active', true).order('display_order'),

  media: async (q) => {
    let query = supabase.from('media').select(`
      *, uploaded_by_user:users!uploaded_by(name,role),
      match:matches(id,home_team:teams!home_team_id(name),away_team:teams!away_team_id(name))
    `);
    if (q.type) query = query.eq('media_type', q.type);
    if (!q.all) query = query.eq('approved', true).eq('visibility', 'public');
    if (q.match_id) query = query.eq('match_id', q.match_id);
    return query.order('created_at', { ascending: false }).limit(parseInt(q.limit) || 50);
  },

  settings: async () => supabase.from('site_settings').select('*'),

  documents: async (q, user) => {
    if (!user) return { data: null, error: { message: 'Auth required' } };
    let query = supabase.from('documents').select('*');
    if (user.role === 'admin') {
      if (q.user_id) query = query.eq('user_id', q.user_id);
      if (q.status)  query = query.eq('status', q.status);
    } else {
      query = query.eq('user_id', user.id);
    }
    return query.order('uploaded_at', { ascending: false });
  },

  registrations: async (q, user) => {
    if (!user || user.role !== 'admin') return { data: null, error: { message: 'Admin only' } };
    return supabase.from('users').select(`
      id, name, email, role, docs_status, created_at,
      team:teams(name), documents(doc_type,status)
    `).eq('docs_status', q.status || 'submitted').order('created_at', { ascending: false });
  },

  stats: async (q) => supabase.from('player_stats').select(`
    *, player:users!player_id(id,name,initials,position,jersey_number,passport_photo_url,team:teams(name,abbr,color)),
    tournament:tournaments(name)
  `).eq('tournament_id', q.tournament_id)
    .order(q.sort || 'goals', { ascending: false })
    .limit(parseInt(q.limit) || 20),
};

// ── POST HANDLERS ─────────────────────────────────────────

async function handlePost(resource, action, body, user, res) {
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  // ── Teams ──
  if (resource === 'teams') {
    if (action === 'create') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data, error } = await supabase.from('teams').insert(body).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
    if (action === 'update') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { id, ...updates } = body;
      const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
  }

  // ── Players / Users ──
  if (resource === 'players') {
    if (action === 'assign_team') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data, error } = await supabase.from('users').update({ team_id: body.team_id }).eq('id', body.player_id).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
    if (action === 'assign_random') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data: players } = await supabase.from('users').select('id').eq('role', 'player');
      const { data: teams }   = await supabase.from('teams').select('id').eq('is_active', true);
      if (!players || !teams) return res.status(500).json({ error: 'Could not fetch data' });
      const shuffled = players.sort(() => Math.random() - 0.5);
      const updates = shuffled.map((p, i) => ({ id: p.id, team_id: teams[i % teams.length].id }));
      for (const u of updates) await supabase.from('users').update({ team_id: u.team_id }).eq('id', u.id);
      return res.json({ message: `${updates.length} players randomly assigned to ${teams.length} teams` });
    }
  }

  // ── Documents (admin review) ──
  if (resource === 'documents') {
    if (action === 'review') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { doc_id, status, admin_note } = body;
      const { data, error } = await supabase.from('documents').update({
        status, admin_note, reviewed_by: user.id, reviewed_at: new Date().toISOString()
      }).eq('id', doc_id).select().single();

      // Update user docs_status if all approved
      if (!error) await updateUserDocsStatus(data.user_id);
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
  }

  // ── Tournaments ──
  if (resource === 'tournaments') {
    if (action === 'create') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { teams, ...tData } = body;
      const { data: tournament, error } = await supabase.from('tournaments').insert({ ...tData, created_by: user.id }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      if (teams?.length) {
        await supabase.from('tournament_teams').insert(teams.map(t => ({ tournament_id: tournament.id, team_id: t })));
      }
      return res.json(tournament);
    }
    if (action === 'update') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { id, ...updates } = body;
      const { data, error } = await supabase.from('tournaments').update(updates).eq('id', id).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
  }

  // ── News ──
  if (resource === 'news') {
    if (!['admin'].includes(user.role)) return res.status(403).json({ error: 'Admin only' });
    if (action === 'create') {
      const { data, error } = await supabase.from('news').insert({ ...body, author_id: user.id }).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
    if (action === 'publish') {
      const { data, error } = await supabase.from('news').update({ published: true, published_at: new Date().toISOString() }).eq('id', body.id).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
  }

  // ── Sponsors ──
  if (resource === 'sponsors') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (action === 'create') {
      const { data, error } = await supabase.from('sponsors').insert(body).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
    if (action === 'update') {
      const { id, ...updates } = body;
      const { data, error } = await supabase.from('sponsors').update(updates).eq('id', id).select().single();
      return error ? res.status(500).json({ error: error.message }) : res.json(data);
    }
    if (action === 'delete') {
      await supabase.from('sponsors').update({ is_active: false }).eq('id', body.id);
      return res.json({ message: 'Sponsor removed' });
    }
  }

  // ── Site Settings ──
  if (resource === 'settings') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    for (const [key, value] of Object.entries(body)) {
      await supabase.from('site_settings').upsert({ key, value, updated_by: user.id, updated_at: new Date().toISOString() });
    }
    return res.json({ message: 'Settings updated' });
  }

  return res.status(404).json({ error: 'Unknown resource or action' });
}

async function updateUserDocsStatus(user_id) {
  const { data: docs } = await supabase.from('documents').select('status').eq('user_id', user_id);
  if (!docs) return;
  const hasFlag = docs.some(d => d.status === 'flagged');
  const allDone = docs.every(d => d.status === 'approved');
  const hasPending = docs.some(d => d.status === 'pending');
  const newStatus = hasFlag ? 'flagged' : allDone ? 'approved' : hasPending ? 'submitted' : 'incomplete';
  await supabase.from('users').update({ docs_status: newStatus }).eq('id', user_id);
}

// ── MAIN ─────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resource = req.query.resource;
  const action   = req.query.action;
  const user     = verifyToken(req);

  try {
    if (req.method === 'GET') {
      const handler = GET_HANDLERS[resource];
      if (!handler) return res.status(404).json({ error: 'Unknown resource' });
      const { data, error } = await handler(req.query, user);
      if (error) return res.status(error.message?.includes('Auth') ? 401 : 500).json({ error: error.message });
      return res.json(data);
    }

    if (req.method === 'POST') {
      return await handlePost(resource, action, req.body || {}, user, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[data]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
