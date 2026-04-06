// api/upload.js — KRF File Upload Handler
// POST /api/upload?type=document|photo|video|logo

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { Readable } = require('stream');
const Busboy = require('busboy');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'krf-dev-secret-change-in-prod';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function verifyToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ── UPLOAD CONFIG ─────────────────────────────────────────
const UPLOAD_CONFIG = {
  document: {
    bucket: 'documents',
    maxSizeMB: 10,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    public: false   // signed URLs only — sensitive docs
  },
  photo: {
    bucket: 'gallery',
    maxSizeMB: 20,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
    public: true
  },
  video: {
    bucket: 'videos',
    maxSizeMB: 2048,
    allowedTypes: ['video/mp4', 'video/quicktime', 'video/avi', 'video/webm'],
    public: true
  },
  logo: {
    bucket: 'logos',
    maxSizeMB: 5,
    allowedTypes: ['image/png', 'image/svg+xml', 'image/webp'],
    public: true
  },
  hero: {
    bucket: 'site-assets',
    maxSizeMB: 500,
    allowedTypes: ['video/mp4', 'video/webm', 'image/jpeg', 'image/png'],
    public: true
  }
};

// ── PARSE MULTIPART ───────────────────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: 2048 * 1024 * 1024 }
    });
    const fields = {};
    const files = [];

    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('close', () => {
        files.push({ fieldname: name, buffer: Buffer.concat(chunks), ...info });
      });
    });
    busboy.on('finish', () => resolve({ fields, files }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

// ── UPLOAD DOCUMENT ──────────────────────────────────────
async function uploadDocument(req, user) {
  if (!user) return { error: 'Authentication required', status: 401 };

  const { fields, files } = await parseForm(req);
  if (!files.length) return { error: 'No file provided', status: 400 };

  const file = files[0];
  const docType = fields.doc_type;
  const config = UPLOAD_CONFIG.document;

  if (!config.allowedTypes.includes(file.mimeType))
    return { error: 'Invalid file type. Allowed: PDF, JPG, PNG', status: 400 };

  if (file.buffer.length > config.maxSizeMB * 1024 * 1024)
    return { error: `File too large. Max ${config.maxSizeMB}MB`, status: 400 };

  const ext = file.filename.split('.').pop().toLowerCase();
  const path = `${user.id}/${docType}_${Date.now()}.${ext}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(config.bucket).upload(path, file.buffer, {
      contentType: file.mimeType, upsert: true
    });

  if (uploadError) return { error: uploadError.message, status: 500 };

  // Get signed URL (1 year expiry — admin can generate new ones)
  const { data: signedUrl } = await supabase.storage
    .from(config.bucket).createSignedUrl(path, 365 * 24 * 3600);

  // Save to documents table
  const { data: doc, error: dbError } = await supabase.from('documents').upsert({
    user_id: user.id,
    doc_type: docType,
    file_url: signedUrl?.signedUrl || '',
    file_name: file.filename,
    file_size: file.buffer.length,
    status: 'pending',
    uploaded_at: new Date().toISOString()
  }, { onConflict: 'user_id,doc_type' }).select().single();

  if (dbError) return { error: dbError.message, status: 500 };
  return { data: doc, message: 'Document uploaded. Admin will review within 48 hours.' };
}

// ── UPLOAD MEDIA ─────────────────────────────────────────
async function uploadMedia(req, user, type = 'photo') {
  if (!user) return { error: 'Authentication required', status: 401 };

  const allowedRoles = ['admin', 'official', 'referee', 'commissioner', 'linesman'];
  if (!allowedRoles.includes(user.role))
    return { error: 'Media uploads restricted to officials and admins', status: 403 };

  const { fields, files } = await parseForm(req);
  if (!files.length) return { error: 'No file provided', status: 400 };

  const config = UPLOAD_CONFIG[type] || UPLOAD_CONFIG.photo;
  const results = [];

  for (const file of files) {
    if (!config.allowedTypes.includes(file.mimeType)) continue;
    if (file.buffer.length > config.maxSizeMB * 1024 * 1024) continue;

    const ext = file.filename.split('.').pop().toLowerCase();
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(config.bucket).upload(path, file.buffer, { contentType: file.mimeType });

    if (uploadError) continue;

    const { data: { publicUrl } } = supabase.storage.from(config.bucket).getPublicUrl(path);

    // Save metadata
    const { data: media } = await supabase.from('media').insert({
      title: fields.title || file.filename,
      media_type: type === 'video' ? 'video' : 'photo',
      file_url: publicUrl,
      album: fields.album || '',
      match_id: fields.match_id || null,
      tournament_id: fields.tournament_id || null,
      category: fields.category || 'gallery',
      visibility: fields.visibility || 'public',
      approved: user.role === 'admin',
      uploaded_by: user.id
    }).select().single();

    results.push(media);
  }

  return { data: results, message: `${results.length} file(s) uploaded${user.role !== 'admin' ? ' — pending admin approval' : ' and published'}` };
}

// ── APPROVE MEDIA ────────────────────────────────────────
async function approveMedia(body, user) {
  if (user?.role !== 'admin') return { error: 'Admin only', status: 403 };
  const { data, error } = await supabase.from('media')
    .update({ approved: body.approved })
    .eq('id', body.media_id).select().single();
  return { data, error };
}

// ── UPLOAD HERO VIDEO (admin) ────────────────────────────
async function uploadHero(req, user) {
  if (user?.role !== 'admin') return { error: 'Admin only', status: 403 };
  const { fields, files } = await parseForm(req);
  if (!files.length) return { error: 'No file', status: 400 };

  const file = files[0];
  const config = UPLOAD_CONFIG.hero;
  if (!config.allowedTypes.includes(file.mimeType))
    return { error: 'Invalid file type', status: 400 };

  const ext = file.filename.split('.').pop();
  const path = `hero_${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(config.bucket).upload(path, file.buffer, { contentType: file.mimeType, upsert: true });

  if (uploadError) return { error: uploadError.message, status: 500 };

  const { data: { publicUrl } } = supabase.storage.from(config.bucket).getPublicUrl(path);

  // Update site settings
  const key = file.mimeType.startsWith('video') ? 'hero_video_url' : 'hero_wallpaper_url';
  await supabase.from('site_settings').update({ value: publicUrl, updated_by: user.id, updated_at: new Date().toISOString() }).eq('key', key);

  return { data: { url: publicUrl, type: key }, message: 'Hero background updated on public site.' };
}

// ── GET SIGNED URL (for sensitive docs) ──────────────────
async function getSignedUrl(req, user) {
  if (!user) return { error: 'Auth required', status: 401 };
  const { doc_id } = req.query;

  const { data: doc } = await supabase.from('documents').select('*').eq('id', doc_id).single();
  if (!doc) return { error: 'Document not found', status: 404 };

  // Only owner or admin can access
  if (doc.user_id !== user.id && user.role !== 'admin')
    return { error: 'Access denied', status: 403 };

  // Extract bucket path from existing URL
  const path = doc.file_url.split('/documents/')[1]?.split('?')[0];
  if (!path) return { error: 'Invalid document path', status: 500 };

  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
  return { data: { url: data?.signedUrl }, expires_in: 3600 };
}

// ── MAIN ─────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  const type = req.query.type || 'document';

  try {
    if (req.method === 'POST') {
      let result;
      if (type === 'document')      result = await uploadDocument(req, user);
      else if (type === 'hero')     result = await uploadHero(req, user);
      else if (type === 'approve')  result = await approveMedia(req.body || {}, user);
      else                          result = await uploadMedia(req, user, type);

      if (result.status) return res.status(result.status).json({ error: result.error });
      return res.status(200).json(result);
    }

    if (req.method === 'GET' && type === 'signed') {
      const result = await getSignedUrl(req, user);
      if (result.status) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
};
