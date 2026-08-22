const router = require('express').Router();
const multer = require('multer');
const db = require('../config/database');
const auth = require('../middleware/auth');

db.prepare(`CREATE TABLE IF NOT EXISTS shared_files (id TEXT PRIMARY KEY,owner_account_id TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT 'default',name TEXT NOT NULL,mime_type TEXT,size INTEGER NOT NULL DEFAULT 0,data BLOB NOT NULL,created_by TEXT,created_at TEXT DEFAULT (datetime('now')))` ).run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_shared_files_owner ON shared_files(owner_account_id,workspace_id)').run();
const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:12*1024*1024,files:1} });
const workspaceId = value => (/^[a-zA-Z0-9_-]{1,80}$/.test(String(value||'')) ? String(value) : 'default');
function canAccess(req,owner,workspace){if(String(req.user.id)===String(owner)||req.user.role==='admin')return true;const email=String(req.user.email||'').trim().toLowerCase();return !!email&&!!db.prepare(`SELECT 1 FROM team_access_grants WHERE owner_account_id=? AND workspace_id=? AND lower(trim(member_email))=? AND status='active' LIMIT 1`).get(owner,workspace,email);}
const MIME_TOKEN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const INLINE_SAFE_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/avif','image/bmp',
  'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/aac',
  'video/mp4','video/webm','video/ogg','application/pdf','text/plain',
]);
function normalizeMime(raw) {
  const mime = String(raw || '').split(';')[0].trim().toLowerCase();
  return MIME_TOKEN.test(mime) ? mime : 'application/octet-stream';
}
function servedMime(raw) {
  const mime = normalizeMime(raw);
  return INLINE_SAFE_MIME.has(mime) ? mime : 'application/octet-stream';
}
function contentDisposition(name, mime) {
  const encoded = encodeURIComponent(String(name || 'file').replace(/[\r\n]/g, '')).slice(0, 240);
  const mode = INLINE_SAFE_MIME.has(mime) ? 'inline' : 'attachment';
  return `${mode}; filename*=UTF-8''${encoded}`;
}

router.post('/',auth,upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'file_required'});
  const owner=String(req.body.owner_account_id||req.user.id);
  const workspace=workspaceId(req.body.workspace_id);
  const id=String(req.body.id||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,120);
  if(!canAccess(req,owner,workspace))return res.status(403).json({error:'forbidden'});
  if(!id)return res.status(400).json({error:'invalid_file_id'});
  const result=db.prepare(`INSERT INTO shared_files(id,owner_account_id,workspace_id,name,mime_type,size,data,created_by) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,mime_type=excluded.mime_type,size=excluded.size,data=excluded.data
    WHERE shared_files.owner_account_id=excluded.owner_account_id AND shared_files.workspace_id=excluded.workspace_id`).run(
    id,owner,workspace,String(req.file.originalname||'file'),normalizeMime(req.file.mimetype),req.file.size,req.file.buffer,req.user.id
  );
  if(!result.changes)return res.status(409).json({error:'file_id_conflict'});
  res.json({success:true,id});
});
router.get('/:id',auth,(req,res)=>{
  const row=db.prepare('SELECT * FROM shared_files WHERE id=?').get(String(req.params.id));
  if(!row)return res.status(404).json({error:'file_not_found'});
  if(!canAccess(req,row.owner_account_id,row.workspace_id))return res.status(403).json({error:'forbidden'});
  const mime=servedMime(row.mime_type);
  res.setHeader('Content-Type',mime);
  res.setHeader('Content-Disposition',contentDisposition(row.name,mime));
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cache-Control','private, max-age=300');
  res.send(row.data);
});
router.delete('/:id',auth,(req,res)=>{const row=db.prepare('SELECT owner_account_id,workspace_id FROM shared_files WHERE id=?').get(String(req.params.id));if(!row)return res.json({success:true});if(!canAccess(req,row.owner_account_id,row.workspace_id))return res.status(403).json({error:'forbidden'});db.prepare('DELETE FROM shared_files WHERE id=?').run(String(req.params.id));res.json({success:true});});
module.exports=router;
