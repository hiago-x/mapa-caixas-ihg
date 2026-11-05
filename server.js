import express from 'express'
import mysql from 'mysql2/promise'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)
const app = express()
const port = Number(process.env.PORT || 3000)
const pool = mysql.createPool(process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL || '')
const adminUsername = process.env.ADMIN_USERNAME || ''
const adminPassword = process.env.ADMIN_PASSWORD || ''
const adminCookie = 'ihg_admin_session'

app.set('trust proxy', 1)
app.use(express.json({ limit: '25mb' }))
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '')
  if (origin === 'https://hiago-x.github.io') {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

async function ensureSchema() {
  if (!process.env.DATABASE_URL && !process.env.DRIZZLE_DATABASE_URL) throw new Error('DATABASE_URL não configurada')
  if (!adminUsername) throw new Error('ADMIN_USERNAME não configurada')
  if (!adminPassword) throw new Error('ADMIN_PASSWORD não configurada')
  await pool.query(`CREATE TABLE IF NOT EXISTS boxes (
    record_id VARCHAR(80) PRIMARY KEY,
    armario VARCHAR(8) NOT NULL,
    posicao VARCHAR(8) NOT NULL,
    duplicate_index INT NOT NULL DEFAULT 1,
    titulo TEXT,
    convenio TEXT,
    nome TEXT,
    data_text TEXT,
    parte TEXT,
    raw_text TEXT,
    source_page INT,
    source_position INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_armario (armario),
    INDEX idx_posicao (posicao)
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS cabinets (
    armario VARCHAR(8) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)
  const [[count]] = await pool.query('SELECT COUNT(*) AS count FROM boxes')
  if (Number(count.count) === 0) {
    const source = await fs.readFile(path.join(__dirname, 'public', 'inventory.json'), 'utf8')
    const inventory = JSON.parse(source)
    const rows = inventory.armarios.flatMap(armario => armario.positions.map(box => [
      box.recordId, armario.id, box.id, box.duplicateIndex || 1,
      box.raw.titulo || '', box.raw.convenio || '', box.raw.nome || '', box.raw.data || '', box.raw.parte || '',
      box.rawText || '', box.sourcePage || Number(armario.id), box.sourcePosition || Number(box.id)
    ]))
    if (rows.length) await pool.query(`INSERT INTO boxes
      (record_id, armario, posicao, duplicate_index, titulo, convenio, nome, data_text, parte, raw_text, source_page, source_position)
      VALUES ?`, [rows])
  }
  await pool.query(`INSERT IGNORE INTO cabinets (armario, nome)
    SELECT DISTINCT armario, CONCAT('Armário ', armario) FROM boxes`)
}

function normalize(row) {
  return {
    id: String(row.posicao).padStart(2, '0'), recordId: row.record_id, duplicateIndex: Number(row.duplicate_index || 1),
    raw: { titulo: row.titulo || '', convenio: row.convenio || '', nome: row.nome || '', data: row.data_text || '', parte: row.parte || '' },
    rawText: row.raw_text || '', sourcePage: Number(row.source_page || row.armario), sourcePosition: Number(row.source_position || row.posicao), armario: String(row.armario).padStart(2, '0')
  }
}

function sessionToken() { return crypto.createHmac('sha256', adminPassword).update('centro-oncologia-ihg-admin').digest('hex') }
function cookieValue(req, name) {
  const item = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.slice(name.length + 1)) : ''
}
function bearerValue(req) {
  const value = String(req.headers.authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}
function requireAdmin(req, res, next) {
  if (cookieValue(req, adminCookie) === sessionToken() || bearerValue(req) === sessionToken()) return next()
  return res.status(401).json({ error: 'Faça login de administrador para alterar o inventário.' })
}
function passwordMatches(value) {
  const received = crypto.createHash('sha256').update(String(value || '')).digest()
  const expected = crypto.createHash('sha256').update(adminPassword).digest()
  return crypto.timingSafeEqual(received, expected)
}
function usernameMatches(value) {
  const received = crypto.createHash('sha256').update(String(value || '').trim()).digest()
  const expected = crypto.createHash('sha256').update(adminUsername).digest()
  return crypto.timingSafeEqual(received, expected)
}

function parseImportedPdf(text, armario, startPosition = 1) {
  const pages = String(text).split('\f')
  const records = []
  let fallbackPosition = Math.max(0, Number(startPosition || 1) - 1)
  for (const pageText of pages) {
    const footer = pageText.match(/Origem:\s*p[áa]gina\s*(\d+)\s*,\s*quadrado\s*(\d+)/i)
    const beforeFooter = footer ? pageText.slice(0, footer.index) : pageText
    const lines = beforeFooter.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (!lines.length) continue
    const convIndex = lines.findIndex(line => /^CONV[ÊE]NIO\s*:/i.test(line))
    const dataIndex = lines.findIndex(line => /^DATA\b/i.test(line))
    const parteIndex = lines.findIndex(line => /^PARTE\s*:/i.test(line))
    const stops = [convIndex, dataIndex, parteIndex].filter(index => index >= 0)
    const firstStop = stops.length ? Math.min(...stops) : lines.length
    const titulo = lines.slice(0, firstStop).join(' ').trim()
    const nextAfter = index => [dataIndex, parteIndex].filter(value => value > index).sort((a, b) => a - b)[0] ?? lines.length
    const convenio = convIndex >= 0 ? lines.slice(convIndex + 1, nextAfter(convIndex)).join(' ').trim().replace(/^:\s*/, '') : ''
    const dataLine = dataIndex >= 0 ? lines[dataIndex].replace(/^DATA\s*:?\s*/i, '').trim() : ''
    const parte = parteIndex >= 0 ? [lines[parteIndex].replace(/^PARTE\s*:?\s*/i, '').trim(), ...lines.slice(parteIndex + 1)].filter(Boolean).join(' ').trim() : ''
    const sourcePage = footer ? Number(footer[1]) : Number(armario)
    const sourcePosition = footer ? Number(footer[2]) : ++fallbackPosition
    records.push({ armario, posicao: String(sourcePosition).padStart(2, '0'), titulo, convenio, nome: '', data: dataLine, parte, rawText: lines.join('\n'), sourcePage, sourcePosition })
  }
  return records
}

async function extractPdfText(base64) {
  const match = String(base64 || '').match(/^data:application\/pdf;base64,(.+)$/s)
  const encoded = match ? match[1] : String(base64 || '')
  if (!encoded || encoded.length > 24 * 1024 * 1024) throw new Error('PDF ausente ou maior que o limite de 18 MB.')
  const tempPath = path.join('/tmp', `ihg-import-${crypto.randomUUID()}.pdf`)
  try {
    await fs.writeFile(tempPath, Buffer.from(encoded, 'base64'))
    const result = await execFileAsync('pdftotext', ['-layout', tempPath, '-'], { maxBuffer: 20 * 1024 * 1024 })
    return result.stdout
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {})
  }
}

app.get('/_app/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }) } catch (error) { res.status(503).json({ ok: false, error: error.message }) }
})

app.get('/api/inventory', async (_req, res) => {
  try {
    const [rows] = await pool.query(`SELECT c.armario AS cabinet_armario, c.nome AS cabinet_name,
      b.* FROM cabinets c LEFT JOIN boxes b ON b.armario = c.armario
      ORDER BY c.armario, b.posicao, b.duplicate_index, b.record_id`)
    if (!rows.length) {
      const source = await fs.readFile(path.join(__dirname, 'public', 'inventory.json'), 'utf8')
      return res.json(JSON.parse(source))
    }
    const grouped = new Map()
    for (const row of rows) {
      const armario = String(row.cabinet_armario).padStart(2, '0')
      if (!grouped.has(armario)) grouped.set(armario, { id: armario, name: row.cabinet_name || `Armário ${armario}`, positions: [] })
      if (row.record_id) grouped.get(armario).positions.push(normalize(row))
    }
    res.json({ version: 4, source: 'caixa5anda-verificadas.pdf', locationRule: 'página = armário; quadrado = posição', armarios: [...grouped.values()] })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/admin/diagnostics', requireAdmin, async (_req, res) => {
  try {
    const [[database]] = await pool.query('SELECT 1 AS ready')
    const [[summary]] = await pool.query('SELECT COUNT(*) AS records, COUNT(DISTINCT armario) AS armarios, MAX(updated_at) AS last_update FROM boxes')
    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      authentication: 'ok',
      database: database.ready === 1 ? 'ok' : 'error',
      inventory: { records: Number(summary.records), armarios: Number(summary.armarios), lastUpdate: summary.last_update },
      movement: 'endpoint disponível; destinos ocupados retornam 409',
      serverUptimeSeconds: Math.round(process.uptime())
    })
  } catch (error) { res.status(503).json({ ok: false, authentication: 'ok', database: 'error', error: error.message }) }
})

app.post('/api/admin/login', (req, res) => {
  if (!usernameMatches(req.body?.username) || !passwordMatches(req.body?.password)) return res.status(401).json({ error: 'Nome de usuário ou senha inválidos.' })
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `${adminCookie}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; Max-Age=28800; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`)
  res.json({ ok: true, token: sessionToken() })
})

app.post('/api/admin/logout', (req, res) => {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `${adminCookie}=; Path=/; HttpOnly; Max-Age=0; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`)
  res.json({ ok: true })
})

app.post('/api/armarios', requireAdmin, async (req, res) => {
  const rawId = String(req.body?.id || '').replace(/\D/g, '')
  const name = String(req.body?.name || '').trim()
  if (!/^\d{1,3}$/.test(rawId) || !name) return res.status(400).json({ error: 'Informe o número e o nome do armário.' })
  const id = rawId.padStart(2, '0')
  try {
    await pool.query('INSERT INTO cabinets (armario, nome) VALUES (?, ?)', [id, name])
    res.status(201).json({ ok: true, armario: { id, name, positions: [] } })
  } catch (error) {
    res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: error.code === 'ER_DUP_ENTRY' ? `O armário ${id} já existe.` : error.message })
  }
})

app.put('/api/armarios/:id', requireAdmin, async (req, res) => {
  const oldId = String(req.params.id).replace(/\D/g, '').padStart(2, '0')
  const rawNewId = String(req.body?.id ?? oldId).replace(/\D/g, '')
  const newId = rawNewId.padStart(2, '0')
  const name = String(req.body?.name || '').trim()
  if (!/^\d{1,3}$/.test(rawNewId) || !name) return res.status(400).json({ error: 'Informe um número e o nome do armário.' })
  if (newId === oldId) {
    try {
      const [result] = await pool.query('UPDATE cabinets SET nome = ? WHERE armario = ?', [name, oldId])
      if (!result.affectedRows) return res.status(404).json({ error: 'Armário não encontrado.' })
      return res.json({ ok: true, id: newId, name })
    } catch (error) { return res.status(500).json({ error: error.message }) }
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.query('SELECT armario FROM cabinets WHERE armario = ?', [oldId])
    if (!existing) { await connection.rollback(); return res.status(404).json({ error: 'Armário não encontrado.' }) }
    const [[conflict]] = await connection.query('SELECT armario FROM cabinets WHERE armario = ?', [newId])
    if (conflict) { await connection.rollback(); return res.status(409).json({ error: `O armário ${newId} já existe.` }) }
    await connection.query('UPDATE cabinets SET armario = ?, nome = ? WHERE armario = ?', [newId, name, oldId])
    await connection.query('UPDATE boxes SET armario = ?, source_page = ? WHERE armario = ?', [newId, Number(newId), oldId])
    await connection.commit()
    res.json({ ok: true, id: newId, name })
  } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }) } finally { connection.release() }
})

app.delete('/api/armarios/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id).replace(/\D/g, '').padStart(2, '0')
  const deleteBoxes = req.body?.deleteBoxes === true
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM boxes WHERE armario = ?', [id])
    if (Number(count.total) && !deleteBoxes) { await connection.rollback(); return res.json({ ok: false, confirmationRequired: true, code: 'has_boxes', boxes: Number(count.total), message: `Este armário possui ${count.total} caixa(s).` }) }
    if (deleteBoxes) await connection.query('DELETE FROM boxes WHERE armario = ?', [id])
    const [result] = await connection.query('DELETE FROM cabinets WHERE armario = ?', [id])
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: 'Armário não encontrado.' }) }
    await connection.commit()
    res.json({ ok: true, deletedBoxes: Number(count.total) })
  } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }) } finally { connection.release() }
})

app.post('/api/armarios/:id/import-pdf', requireAdmin, async (req, res) => {
  const armario = String(req.params.id).replace(/\D/g, '').padStart(2, '0')
  try {
    const [[cabinet]] = await pool.query('SELECT armario FROM cabinets WHERE armario = ?', [armario])
    if (!cabinet) return res.status(404).json({ error: 'Armário não encontrado. Crie o armário antes de importar o PDF.' })
    const text = await extractPdfText(req.body?.data)
    const parsed = parseImportedPdf(text, armario, req.body?.startPosition)
    if (!parsed.length) return res.status(422).json({ error: 'Não encontrei páginas com conteúdo no PDF.' })
    const positions = [...new Set(parsed.map(item => item.posicao))]
    const [occupiedRows] = await pool.query(`SELECT record_id, posicao FROM boxes WHERE armario = ? AND posicao IN (${positions.map(() => '?').join(',')})`, [armario, ...positions])
    if (occupiedRows.length && !req.body?.replace) return res.status(409).json({ code: 'occupied', conflicts: occupiedRows.map(row => row.posicao), error: `Já existem caixas nas posições: ${occupiedRows.map(row => row.posicao).join(', ')}. Marque substituir para importar por cima.` })
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      if (req.body?.replace && occupiedRows.length) await connection.query(`DELETE FROM boxes WHERE armario = ? AND posicao IN (${positions.map(() => '?').join(',')})`, [armario, ...positions])
      const indexes = new Map()
      for (const item of parsed) {
        const next = (indexes.get(item.posicao) || 0) + 1
        indexes.set(item.posicao, next)
        const recordId = `${armario}-${item.posicao}-imp-${crypto.randomUUID().slice(0, 8)}`
        await connection.query(`INSERT INTO boxes (record_id, armario, posicao, duplicate_index, titulo, convenio, nome, data_text, parte, raw_text, source_page, source_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [recordId, armario, item.posicao, next, item.titulo, item.convenio, item.nome, item.data, item.parte, item.rawText, item.sourcePage, item.sourcePosition])
      }
      await connection.commit()
      res.json({ ok: true, imported: parsed.length, positions: positions.length, armario })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }) }
})

app.put('/api/boxes/:recordId', requireAdmin, async (req, res) => {
  const fields = req.body || {}; const allowed = ['titulo', 'convenio', 'nome', 'data', 'parte', 'rawText']; const updates = []; const values = []
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(fields, key)) { updates.push(`${key === 'rawText' ? 'raw_text' : key === 'data' ? 'data_text' : key} = ?`); values.push(String(fields[key] ?? '')) }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' })
  values.push(req.params.recordId)
  try {
    const [result] = await pool.query(`UPDATE boxes SET ${updates.join(', ')} WHERE record_id = ?`, values)
    if (!result.affectedRows) return res.status(404).json({ error: 'Registro não encontrado.' })
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/boxes', requireAdmin, async (req, res) => {
  const body = req.body || {}
  const rawArmario = String(body.armario || '').replace(/\D/g, ''); const rawPosicao = String(body.posicao || '').replace(/\D/g, '')
  if (!/^\d{1,2}$/.test(rawArmario) || !/^\d{1,2}$/.test(rawPosicao)) return res.status(400).json({ error: 'Informe armário e posição com um ou dois números.' })
  const armario = rawArmario.padStart(2, '0'); const posicao = rawPosicao.padStart(2, '0')
  const recordId = `${armario}-${posicao}-m${Date.now()}`
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[occupied]] = await connection.query('SELECT record_id FROM boxes WHERE armario = ? AND posicao = ? LIMIT 1', [armario, posicao])
    if (occupied && !body.replace) { await connection.rollback(); return res.status(409).json({ code: 'occupied', occupiedRecordId: occupied.record_id, error: `Destino ocupado: armário ${armario}, posição ${posicao}.` }) }
    if (occupied) await connection.query('DELETE FROM boxes WHERE record_id = ?', [occupied.record_id])
    await connection.query(`INSERT INTO boxes (record_id, armario, posicao, duplicate_index, titulo, convenio, nome, data_text, parte, raw_text, source_page, source_position) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`, [recordId, armario, posicao, String(body.titulo || ''), String(body.convenio || ''), String(body.nome || ''), String(body.data || ''), String(body.parte || ''), String(body.rawText || ''), Number(armario), Number(posicao)])
    await connection.commit(); res.json({ ok: true, recordId, armario, posicao })
  } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }) } finally { connection.release() }
})

app.post('/api/boxes/:recordId/move', requireAdmin, async (req, res) => {
  const rawArmario = String(req.body?.armario || '').replace(/\D/g, ''); const rawPosicao = String(req.body?.posicao || '').replace(/\D/g, '')
  if (!/^\d{1,2}$/.test(rawArmario) || !/^\d{1,2}$/.test(rawPosicao)) return res.status(400).json({ error: 'Informe armário e posição com um ou dois números.' })
  const armario = rawArmario.padStart(2, '0'); const posicao = rawPosicao.padStart(2, '0')
  try {
    const [[current]] = await pool.query('SELECT record_id, armario, posicao FROM boxes WHERE record_id = ?', [req.params.recordId])
    if (!current) return res.status(404).json({ error: 'Registro não encontrado.' })
    if (String(current.armario).padStart(2, '0') === armario && String(current.posicao).padStart(2, '0') === posicao) return res.json({ ok: true, armario, posicao })
    const [[occupied]] = await pool.query('SELECT record_id FROM boxes WHERE armario = ? AND posicao = ? AND record_id <> ? LIMIT 1', [armario, posicao, req.params.recordId])
    if (occupied && !req.body?.replace) return res.status(409).json({ code: 'occupied', occupiedRecordId: occupied.record_id, error: `Destino ocupado: armário ${armario}, posição ${posicao}.` })
    const connection = await pool.getConnection()
    try { await connection.beginTransaction(); if (occupied) await connection.query('DELETE FROM boxes WHERE record_id = ?', [occupied.record_id]); await connection.query('UPDATE boxes SET armario = ?, posicao = ?, duplicate_index = 1 WHERE record_id = ?', [armario, posicao, req.params.recordId]); await connection.commit() } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    res.json({ ok: true, armario, posicao })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.delete('/api/boxes/:recordId', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM boxes WHERE record_id = ?', [req.params.recordId])
    if (!result.affectedRows) return res.status(404).json({ error: 'Registro não encontrado.' })
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))

ensureSchema().then(() => app.listen(port, '0.0.0.0', () => console.log(`Servidor do mapa ouvindo na porta ${port}`))).catch(error => { console.error(error); process.exit(1) })
