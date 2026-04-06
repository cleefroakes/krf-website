// api/auth.js — KRF Authentication
// POST /api/auth?action=login|register|me|logout

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'krf-dev-secret-change-in-prod';

// ── CORS headers ──────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── JWT helpers ───────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// ── HANDLERS ─────────────────────────────────────────────
async function login(body, res) {
  const { email, password } = body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  // Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) return res.status(401).json({ error: 'Invalid credentials' });

  // Fetch profile
  const { data: user, error: userError } = await supabase
    .from('users').select('*').eq('id', authData.user.id).single();
  if (userError || !user) return res.status(404).json({ error: 'User profile not found' });
  if (!user.is_active) return res.status(403).json({ error: 'Account suspended. Contact KRF admin.' });

  const token = signToken(user);
  return res.status(200).json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      initials: user.initials, team_id: user.team_id,
      jersey_number: user.jersey_number, position: user.position,
      docs_status: user.docs_status, passport_photo_url: user.passport_photo_url
    }
  });
}

async function register(body, res) {
  const { email, password, name, role = 'player', phone, national_id, county } = body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Name, email and password required' });

  // Only players can self-register; officials are created by admin
  if (!['player'].includes(role))
    return res.status(403).json({ error: 'Only players can self-register. Contact KRF admin for official roles.' });

  // Create Supabase Auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  });
  if (authError) return res.status(400).json({ error: authError.message });

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Create profile
  const { data: user, error: profileError } = await supabase.from('users').insert({
    id: authData.user.id, email, name, initials, role, phone, national_id, county,
    docs_status: 'incomplete', is_active: true
  }).select().single();

  if (profileError) return res.status(500).json({ error: profileError.message });

  const token = signToken(user);
  return res.status(201).json({ token, user, message: 'Registration successful. Complete your profile and upload documents.' });
}

async function me(req, res) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });

  const { data: user, error } = await supabase
    .from('users').select('*, teams(name, color, abbr)').eq('id', decoded.id).single();
  if (error) return res.status(404).json({ error: 'User not found' });

  return res.status(200).json({ user });
}

async function updateProfile(body, req, res) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  const allowed = ['name','phone','county','position','jersey_number','player_status','age_category','team_id'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('users').update(updates).eq('id', decoded.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ user: data, message: 'Profile updated' });
}

// ── MAIN ─────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.method === 'POST' ? 'login' : 'me');
  const body = req.body || {};

  try {
    if (action === 'login')   return await login(body, res);
    if (action === 'register') return await register(body, res);
    if (action === 'me')      return await me(req, res);
    if (action === 'update')  return await updateProfile(body, req, res);
    return res.status(404).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};