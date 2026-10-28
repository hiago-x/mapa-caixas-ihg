import express from 'express'
import mysql from 'mysql2/promise'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT || 3000)
const pool = mysql.createPool(process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL || '')
const adminPassword = process.env.ADMIN_PASSWORD || ''
const adminCookie = 'ihg_admin_session'

app.set('trust proxy', 1)
app.use(express.json({ limit: '100kb' }))

async function ensureSchema() {
  if (!process.env.DATABASE_URL && !process.env.DRIZZLE_DATABASE_URL) throw new Error('DATABASE_URL não configurada')
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
function requireAdmin(req, res, next) {
  if (cookieValue(req, adminCookie) === sessionToken()) return next()
  return res.status(401).json({ error: 'Faça login de administrador para alterar o inventário.' })
}
function passwordMatches(value) {
  const received = crypto.createHash('sha256').update(String(value || '')).digest()
  const expected = crypto.createHash('sha256').update(adminPassword).digest()
  return crypto.timingSafeEqual(received, expected)
}

app.get('/_app/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }) } catch (error) { res.status(503).json({ ok: false, error: error.message }) }
})

app.get('/api/inventory', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM boxes ORDER BY armario, posicao, duplicate_index, record_id')
    const grouped = new Map()
    for (const row of rows) {
      const armario = String(row.armario).padStart(2, '0')
      if (!grouped.has(armario)) grouped.set(armario, { id: armario, positions: [] })
      grouped.get(armario).positions.push(normalize(row))
    }
    res.json({ version: 3, source: 'caixa5anda-verificadas.pdf', locationRule: 'página = armário; quadrado = posição', armarios: [...grouped.values()] })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/admin/login', (req, res) => {
  if (!passwordMatches(req.body?.password)) return res.status(401).json({ error: 'Senha de administrador inválida.' })
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `${adminCookie}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; Max-Age=28800; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`)
  res.json({ ok: true })
})

app.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${adminCookie}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`)
  res.json({ ok: true })
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

app.post('/api/boxes/:recordId/move', requireAdmin, async (req, res) => {
  const armario = String(req.body?.armario || '').replace(/\D/g, '').padStart(2, '0'); const posicao = String(req.body?.posicao || '').replace(/\D/g, '').padStart(2, '0')
  if (!/^\d{2}$/.test(armario) || !/^\d{2}$/.test(posicao)) return res.status(400).json({ error: 'Informe armário e posição com dois números.' })
  try {
    const [[current]] = await pool.query('SELECT record_id, armario, posicao FROM boxes WHERE record_id = ?', [req.params.recordId])
    if (!current) return res.status(404).json({ error: 'Registro não encontrado.' })
    if (String(current.armario).padStart(2, '0') === armario && String(current.posicao).padStart(2, '0') === posicao) return res.json({ ok: true, armario, posicao })
    const [[dup]] = await pool.query('SELECT COALESCE(MAX(duplicate_index), 0) AS max_index FROM boxes WHERE armario = ? AND posicao = ? AND record_id <> ?', [armario, posicao, req.params.recordId])
    await pool.query('UPDATE boxes SET armario = ?, posicao = ?, duplicate_index = ? WHERE record_id = ?', [armario, posicao, Number(dup.max_index) + 1, req.params.recordId])
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
