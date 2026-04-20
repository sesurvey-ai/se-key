import express from 'express';
import cors from 'cors';
import ExcelJS from 'exceljs';
import { db, initSchema } from './db.js';
import { sendRecordToIsurvey } from './send-isurvey.js';
import { startRetryLoop } from './retry.js';
import { log } from './logger.js';

initSchema();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.SE_KEY_API_KEY || '';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request log — one line per response, with status + duration.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info('http', {
      method: req.method,
      path:   req.path,
      status: res.statusCode,
      ms:     Date.now() - start,
      ip:     req.ip,
    });
  });
  next();
});

// API-key auth — shared header X-API-Key. Off if SE_KEY_API_KEY is empty
// (backwards-compat: existing deployments keep working until the key is set).
if (API_KEY) {
  app.use((req, res, next) => {
    if (req.headers['x-api-key'] === API_KEY) return next();
    log.warn('auth.reject', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'unauthorized' });
  });
  log.info('auth.enabled');
} else {
  log.warn('auth.disabled', { reason: 'SE_KEY_API_KEY not set' });
}

app.get('/api/health', (_req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM records').get();
  res.json({ ok: true, rows: count });
});

// List records (supports ?claim_no=, ?survey_no=, ?limit=, ?offset=, ?since_id=, ?q=, ?work_type=)
// Extension uses ?claim_no=&survey_no= for duplicate checks;
// records.html uses ?q=&offset=&limit= for the browse table.
app.get('/api/records', (req, res) => {
  const { claim_no, survey_no, since_id, q, work_type, isurvey_sent } = req.query;
  const limit  = Math.min(Number(req.query.limit)  || 100, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = {};
  if (claim_no)  { where.push('claim_no = @claim_no');   params.claim_no = String(claim_no); }
  if (survey_no) { where.push('survey_no = @survey_no'); params.survey_no = String(survey_no); }
  if (since_id)  { where.push('id > @since_id');         params.since_id = Number(since_id); }
  if (work_type) { where.push('work_type = @work_type'); params.work_type = String(work_type); }
  if (isurvey_sent === '0' || isurvey_sent === '1') {
    where.push('isurvey_sent = @isurvey_sent');
    params.isurvey_sent = Number(isurvey_sent);
  }
  // Date range (inclusive) on created_at — client sends YYYY-MM-DD, we extend
  // to_date to end-of-day so rows stamped "YYYY-MM-DD HH:MM:SS" are included.
  if (req.query.from_date) {
    where.push('created_at >= @from_date');
    params.from_date = String(req.query.from_date);
  }
  if (req.query.to_date) {
    where.push('created_at <= @to_date');
    params.to_date = String(req.query.to_date) + ' 23:59:59.999999';
  }
  if (q) {
    where.push('(claim_no LIKE @q OR survey_no LIKE @q OR keyer LIKE @q OR invoice_mix LIKE @q)');
    params.q = `%${String(q)}%`;
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const sql = `
    SELECT id, created_at, claim_no, survey_no, keyer, work_type, invoice_mix,
           isurvey_sent, retry_count, last_retry_at, retry_error
    FROM records
    ${whereSql}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `;
  const rows = db.prepare(sql).all({ ...params, limit, offset });

  const total = db.prepare(`SELECT COUNT(*) AS c FROM records ${whereSql}`).get(params).c;

  const claim_count       = claim_no  ? db.prepare('SELECT COUNT(*) AS c FROM records WHERE claim_no  = ?').get(String(claim_no)).c  : null;
  const claim_sent_count  = claim_no  ? db.prepare('SELECT COUNT(*) AS c FROM records WHERE claim_no  = ? AND isurvey_sent = 1').get(String(claim_no)).c  : null;
  const survey_count      = survey_no ? db.prepare('SELECT COUNT(*) AS c FROM records WHERE survey_no = ?').get(String(survey_no)).c : null;
  const survey_sent_count = survey_no ? db.prepare('SELECT COUNT(*) AS c FROM records WHERE survey_no = ? AND isurvey_sent = 1').get(String(survey_no)).c : null;

  res.json({
    rows, total, limit, offset,
    claim_count,  claim_sent_count,
    survey_count, survey_sent_count,
  });
});

// Excel (.xlsx) export — reuses the same filters as GET /api/records but
// ignores limit/offset. Uses ExcelJS streaming writer so large exports don't
// balloon memory. Columns are typed: created_at → real Date, claim_no +
// survey_no → text (avoids scientific notation on long numeric claim codes).
app.get('/api/records/export', async (req, res) => {
  const where = [];
  const params = {};
  if (req.query.claim_no)  { where.push('claim_no = @claim_no');   params.claim_no = String(req.query.claim_no); }
  if (req.query.survey_no) { where.push('survey_no = @survey_no'); params.survey_no = String(req.query.survey_no); }
  if (req.query.work_type) { where.push('work_type = @work_type'); params.work_type = String(req.query.work_type); }
  if (req.query.isurvey_sent === '0' || req.query.isurvey_sent === '1') {
    where.push('isurvey_sent = @isurvey_sent');
    params.isurvey_sent = Number(req.query.isurvey_sent);
  }
  if (req.query.from_date) {
    where.push('created_at >= @from_date');
    params.from_date = String(req.query.from_date);
  }
  if (req.query.to_date) {
    where.push('created_at <= @to_date');
    params.to_date = String(req.query.to_date) + ' 23:59:59.999999';
  }
  if (req.query.q) {
    where.push('(claim_no LIKE @q OR survey_no LIKE @q OR keyer LIKE @q OR invoice_mix LIKE @q)');
    params.q = `%${String(req.query.q)}%`;
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT id, created_at, claim_no, survey_no, keyer, work_type, invoice_mix,
           isurvey_sent
    FROM records
    ${whereSql}
    ORDER BY id DESC
  `;

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}-${pad(today.getHours())}${pad(today.getMinutes())}`;
  const filename = `se-records-${stamp}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  // Frozen top row — must be set at worksheet creation for the streaming
  // writer; you can't assign `ws.views` after construction.
  const ws = wb.addWorksheet('Records', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'id',             key: 'id',           width: 8,  style: { numFmt: '0' } },
    { header: 'เวลา',           key: 'created_at',   width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
    { header: 'เลขเคลม',        key: 'claim_no',     width: 22, style: { numFmt: '@' } },
    { header: 'เลขเซอร์เวย์',   key: 'survey_no',    width: 22, style: { numFmt: '@' } },
    { header: 'ผู้คีย์',         key: 'keyer',        width: 22 },
    { header: 'ประเภทงาน',      key: 'work_type',    width: 12 },
    { header: 'invoice_mix',    key: 'invoice_mix',  width: 22, style: { numFmt: '@' } },
    { header: 'สถานะ',          key: 'status',       width: 10 },
  ];
  // Bold + background for the header row.
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E6EA' } };
  hdr.commit();

  // DB stores "YYYY-MM-DD HH:MM:SS.ffffff" in localtime (Thailand). XLSX
  // serial numbers are naive (no timezone). If we Date.parse() and pass the
  // Date to exceljs, it serializes using UTC components — which shifts the
  // wall-clock by -7h on a Bangkok host. Trick: build the Date from UTC
  // components matching the local-time stamp, so UTC components == wall-clock.
  const parseLocal = (s) => {
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    if (!m) return null;
    const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
  };

  let count = 0;
  for (const row of db.prepare(sql).iterate(params)) {
    ws.addRow({
      id:          row.id,
      created_at:  parseLocal(row.created_at),
      claim_no:    row.claim_no,
      survey_no:   row.survey_no,
      keyer:       row.keyer,
      work_type:   row.work_type,
      invoice_mix: row.invoice_mix,
      status:      row.isurvey_sent ? 'ส่งแล้ว' : 'รอส่ง',
    }).commit();
    count++;
  }
  await ws.commit();
  await wb.commit();
  log.info('export.xlsx', { count, filename });
});

const insertStmt = db.prepare(`
  INSERT INTO records (claim_no, survey_no, keyer, work_type, invoice_mix, isurvey_sent)
  VALUES (@claim_no, @survey_no, @keyer, @work_type, @invoice_mix, 0)
`);

// Used by upsert_pending: grab the latest pending row for this (claim, survey).
const selectLatestPendingStmt = db.prepare(`
  SELECT id FROM records
  WHERE claim_no = ? AND survey_no = ? AND isurvey_sent = 0
  ORDER BY id DESC LIMIT 1
`);

const updatePendingStmt = db.prepare(`
  UPDATE records
  SET keyer       = @keyer,
      work_type   = @work_type,
      invoice_mix = @invoice_mix,
      retry_count = 0,
      last_retry_at = NULL,
      retry_error   = NULL
  WHERE id = @id
`);

app.post('/api/records', (req, res) => {
  const {
    claim_no = '',
    survey_no = '',
    keyer = '',
    work_type = '',
    invoice_mix = '',
    upsert_pending = false,
  } = req.body ?? {};

  if (!claim_no.trim()) {
    return res.status(400).json({ error: 'claim_no is required' });
  }

  const clean = {
    claim_no:    String(claim_no).trim(),
    survey_no:   String(survey_no).trim(),
    keyer:       String(keyer).trim(),
    work_type:   String(work_type).trim(),
    invoice_mix: String(invoice_mix).trim(),
  };

  // upsert_pending = true (update path from #btnSurvey_Update): if there's
  // already a pending row for this (claim, survey), UPDATE it in place so the
  // same "edit" doesn't accumulate duplicate pending rows. Retry fields are
  // reset so the loop picks it up again.
  if (upsert_pending) {
    const existing = selectLatestPendingStmt.get(clean.claim_no, clean.survey_no);
    if (existing) {
      updatePendingStmt.run({ ...clean, id: existing.id });
      const row = db.prepare('SELECT * FROM records WHERE id = ?').get(existing.id);
      return res.status(200).json({ record: row, upserted: 'updated' });
    }
  }

  const result = insertStmt.run(clean);
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ record: row, upserted: 'inserted' });
});

app.post('/api/send-isurvey', async (req, res) => {
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const result = await sendRecordToIsurvey(id);
  if (result.notFound) return res.status(404).json({ error: 'record not found' });

  if (result.sent && result.alreadySent) return res.json(result);
  if (result.skipped) return res.json(result);
  if (result.sent)    return res.json(result);

  // upstream 5xx or network error
  res.status(502).json({
    error:        result.error,
    status:       result.upstreamStatus,
    upstreamBody: result.upstreamBody,
  });
});

app.use((err, _req, res, _next) => {
  log.error('unhandled', { error: err.message || String(err), stack: err.stack });
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, HOST, () => {
  log.info('server.start', { host: HOST, port: PORT, pid: process.pid });
  startRetryLoop();
});
