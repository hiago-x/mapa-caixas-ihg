import QRCode from 'qrcode'
import './styles.css'

const app = document.querySelector('#app')
const ASSET_BASE = import.meta.env.BASE_URL
const isStaticPages = window.location.hostname.endsWith('.github.io')
const primarySite = 'https://mapacaixas-2hg8dwsy.manus.space'
let inventory = { armarios: [] }
let homeState = { q: '', armario: 'todos', filtro: 'todos', periodo: '' }
let adminSessionValid = false
let adminToken = ''
let adminUsername = ''

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const allBoxes = () => inventory.armarios.flatMap(armario => armario.positions.map(position => ({ armario, position })))
const getArmario = id => inventory.armarios.find(item => item.id === String(id).padStart(2, '0'))
const getBox = (armId, recordId) => {
  const armario = getArmario(armId)
  return armario?.positions.find(position => position.recordId === recordId)
}
const rawText = box => Object.values(box.raw).filter(Boolean).join(' ')
const categoryText = box => [box.raw.titulo, box.raw.convenio, box.raw.nome].filter(Boolean).join(' / ')
const tone = box => {
  const value = rawText(box).toUpperCase()
  if (value.includes('IMAS')) return 'tone-blue'
  if (value.includes('IPASGO') || value.includes('IPAGO')) return 'tone-orange'
  if (value.includes('UNIMED')) return 'tone-green'
  if (value.includes('TIRA FOTO') || value.includes('ILEGÍVEL')) return 'tone-yellow'
  if (value.includes('PRESCRI') || value.includes('FATUR') || value.includes('GUIAS')) return 'tone-purple'
  return 'tone-neutral'
}
const shortLabel = box => box.raw.nome || box.raw.convenio || box.raw.titulo || 'Sem identificação'
const assetUrl = name => `${ASSET_BASE}${name}`
const armarioName = armario => armario?.name || `Armário ${armario?.id || ''}`
const route = path => `#${path}`
const armRoute = id => route(`/armario/${id}`)
const boxRoute = (armId, recordId) => route(`/caixa/${recordId}`)
const formatCount = value => new Intl.NumberFormat('pt-BR').format(value)

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}), ...(options.headers || {}) }, ...options })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) { adminSessionValid = false; adminToken = '' }
  if (!response.ok) { const error = new Error(data.error || 'Não foi possível concluir a operação.'); error.status = response.status; error.code = data.code; throw error }
  return data
}

async function ensureAdmin() {
  if (adminSessionValid) return true
  const username = window.prompt('Digite o nome de usuário de administrador:')
  if (!username) return false
  const password = window.prompt('Digite a senha de administrador para editar o inventário:')
  if (!password) return false
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) })
    adminToken = result.token || ''
    adminUsername = username.trim()
    if (!adminToken) throw new Error('O servidor não retornou uma sessão administrativa válida.')
    adminSessionValid = true
    return true
  } catch (error) { adminSessionValid = false; adminToken = ''; adminUsername = ''; window.alert(error.message); return false }
}

async function confirmAdminPassword() {
  const password = window.prompt('Digite novamente a senha de administrador para confirmar a exclusão:')
  if (!password) return false
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: adminUsername, password }) })
    adminToken = result.token || adminToken
    adminSessionValid = true
    return true
  } catch (error) { window.alert(error.message); return false }
}

function shell(content, active = 'inicio') {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand-wrap">
        <img src="${assetUrl('logo_ihg.png')}" alt="Centro de Oncologia IHG" class="brand-logo" />
        <div>
          <p class="eyebrow">CENTRO DE ONCOLOGIA IHG</p>
          <h1>Mapa de caixas</h1>
          <p class="brand-subtitle">Controle visual do 5º andar</p>
        </div>
      </div>
      <nav class="main-nav" aria-label="Navegação principal">
        <a class="nav-link ${active === 'inicio' ? 'active' : ''}" href="#/">Visão geral</a>
        <a class="nav-link ${active === 'mapa' ? 'active' : ''}" href="#/mapa">Mapa dos armários</a>
        <a class="nav-link ${active === 'qr' ? 'active' : ''}" href="#/qrcodes">QR Codes</a>
        <a class="nav-link ${active === 'admin' ? 'active' : ''}" href="${isStaticPages ? `${primarySite}/#/admin` : '#/admin'}" ${isStaticPages ? 'target="_blank" rel="noreferrer"' : ''}>Administração${isStaticPages ? ' (site principal)' : ''}</a>
      </nav>
    </header>
    <main class="page-content">${content}</main>
    <footer class="footer"><span>Inventário verificado do 5º andar · <a href="${assetUrl('caixa5anda-verificadas.pdf')}" target="_blank" rel="noreferrer">PDF-base</a></span><span>${formatCount(inventory.armarios.length)} armários · ${formatCount(allBoxes().length)} registros</span></footer>
  `
}

function statCard(value, label, accent) {
  return `<div class="stat-card ${accent}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`
}

function positionCard(armId, box, draggable = false) {
  const period = box.raw.data || 'Sem data'
  const part = box.raw.parte ? `Parte: ${box.raw.parte}` : 'Parte não informada'
  const duplicate = box.duplicateIndex > 1 ? ` · registro ${box.duplicateIndex}` : ''
  return `<a class="position-card ${tone(box)}" ${draggable ? 'draggable="true"' : ''} data-record-id="${escapeHtml(box.recordId)}" data-arm-id="${armId}" data-position-id="${box.id}" href="${boxRoute(armId, box.recordId)}" aria-label="Armário ${armId}, posição ${box.id}">
    <span class="position-number">${box.id}</span>
    <strong>${escapeHtml(shortLabel(box))}</strong>
    <span>${escapeHtml(period)}</span>
    <small>${escapeHtml(part + duplicate)}</small>
  </a>`
}

function armarioCard(armario, full = false) {
  const preview = (full ? armario.positions : armario.positions.slice(0, 8)).map(box => positionCard(armario.id, box, full)).join('')
  return `<section class="armario-card">
    <div class="armario-card-head">
      <div><span class="section-kicker">ARMÁRIO ${armario.id}</span><h3>${escapeHtml(armarioName(armario))}</h3></div>
      <div class="armario-meta"><strong>${armario.positions.length}</strong><span>registros</span></div>
    </div>
    <div class="mini-grid">${preview}</div>
    <div class="card-action"><a class="text-link" href="${armRoute(armario.id)}">Abrir armário completo <span>→</span></a></div>
  </section>`
}

function filters() {
  const categories = [...new Set(allBoxes().flatMap(({ position }) => [position.raw.titulo, position.raw.convenio, position.raw.nome]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const arms = inventory.armarios.map(item => `<option value="${item.id}" ${homeState.armario === item.id ? 'selected' : ''}>${escapeHtml(armarioName(item))}</option>`).join('')
  const categoryOptions = categories.map(item => `<option value="${escapeHtml(item)}" ${homeState.filtro === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')
  return `<div class="filters-panel">
    <div class="search-field"><span class="search-icon">⌕</span><input id="search-input" type="search" placeholder="Buscar por convênio, ano, parte, categoria ou palavra..." value="${escapeHtml(homeState.q)}" /></div>
    <label>Armário<select id="arm-filter"><option value="todos">Todos os armários</option>${arms}</select></label>
    <label>Categoria / convênio<select id="category-filter"><option value="todos">Todas as categorias</option>${categoryOptions}</select></label>
    <label>Período<input id="period-filter" type="search" placeholder="Ex.: 2024" value="${escapeHtml(homeState.periodo)}" /></label>
  </div>`
}

function resultCard(item) {
  const { armario, position } = item
  return `<a class="result-row ${tone(position)}" href="${boxRoute(armario.id, position.recordId)}">
    <span class="result-location"><b>${escapeHtml(armarioName(armario))}</b><em>Posição ${position.id}</em></span>
    <span class="result-main"><strong>${escapeHtml(shortLabel(position))}</strong><span>${escapeHtml(categoryText(position) || 'Sem categoria')}</span></span>
    <span class="result-period">${escapeHtml(position.raw.data || 'Sem data')}</span>
    <span class="result-part">${escapeHtml(position.raw.parte || '—')}</span><span class="result-arrow">→</span>
  </a>`
}

function filteredResults() {
  const q = homeState.q.trim().toLocaleLowerCase('pt-BR')
  return allBoxes().filter(({ armario, position }) => {
    const matchQ = !q || `${armario.id} ${position.id} ${rawText(position)}`.toLocaleLowerCase('pt-BR').includes(q)
    const matchArm = homeState.armario === 'todos' || armario.id === homeState.armario
    const matchCategory = homeState.filtro === 'todos' || [position.raw.titulo, position.raw.convenio, position.raw.nome].includes(homeState.filtro)
    const matchPeriod = !homeState.periodo || (position.raw.data || '').toLocaleLowerCase('pt-BR').includes(homeState.periodo.toLocaleLowerCase('pt-BR'))
    return matchQ && matchArm && matchCategory && matchPeriod
  })
}

function renderResults() {
  const node = document.querySelector('#results')
  const count = document.querySelector('#results-count')
  if (!node || !count) return
  const results = filteredResults()
  count.textContent = `${formatCount(results.length)} ${results.length === 1 ? 'resultado encontrado' : 'resultados encontrados'}`
  node.innerHTML = results.length ? results.map(resultCard).join('') : '<div class="empty-state"><strong>Nenhuma caixa encontrada.</strong><span>Tente retirar algum filtro ou procurar por outro termo.</span></div>'
}

function homePage() {
  const total = allBoxes().length
  shell(`<section class="hero-section">
    <div class="hero-copy"><span class="section-kicker">CONSULTA RÁPIDA</span><h2>Encontre qualquer caixa<br /><em>em poucos segundos.</em></h2><p>Pesquise o conteúdo do inventário e descubra exatamente em qual armário e posição a caixa está guardada.</p></div>
    <div class="hero-note"><span class="hero-note-icon">⌖</span><strong>Como usar</strong><span>Pesquise abaixo ou use o único QR Code geral para abrir o site completo no celular.</span><a class="text-link" href="/caixa5anda-verificadas.pdf" target="_blank" rel="noreferrer">Abrir PDF verificado →</a></div>
  </section>
  <section class="stats-grid">${statCard(formatCount(inventory.armarios.length), 'armários cadastrados', 'stat-blue')}${statCard(formatCount(total), 'registros verificados', 'stat-orange')}${statCard('1', 'QR Code geral', 'stat-green')}</section>
  <section class="search-section"><div class="section-heading"><div><span class="section-kicker">INVENTÁRIO DIGITAL</span><h2>Buscar uma caixa</h2></div><span id="results-count" class="results-count"></span></div>${filters()}<div id="results" class="results-list"></div></section>
  <section class="armario-overview"><div class="section-heading"><div><span class="section-kicker">VISÃO ESPACIAL</span><h2>Mapa dos armários</h2></div><a class="outline-button" href="#/mapa">Ver mapa completo →</a></div><div class="armario-grid">${inventory.armarios.slice(0, 6).map(armarioCard).join('')}</div></section>`, 'inicio')
  renderResults()
  document.querySelector('#search-input')?.addEventListener('input', event => { homeState.q = event.target.value; renderResults() })
  document.querySelector('#arm-filter')?.addEventListener('change', event => { homeState.armario = event.target.value; renderResults() })
  document.querySelector('#category-filter')?.addEventListener('change', event => { homeState.filtro = event.target.value; renderResults() })
  document.querySelector('#period-filter')?.addEventListener('input', event => { homeState.periodo = event.target.value; renderResults() })
}

function mapPage() {
  shell(`<section class="page-intro"><span class="section-kicker">VISÃO ESPACIAL</span><h2>Mapa da sala</h2><p>Os armários aparecem abaixo com todas as posições das caixas. Arraste uma caixa para outra posição para mudar sua localização física.</p></section><div class="legend"><span><i class="dot dot-blue"></i> IMAS</span><span><i class="dot dot-orange"></i> IPASGO</span><span><i class="dot dot-green"></i> UNIMED</span><span><i class="dot dot-yellow"></i> Conferir / ilegível</span></div><div class="drag-help">Para mover: mantenha o dedo ou o mouse pressionado sobre uma caixa e solte na posição de destino. O sistema avisa se o destino já estiver ocupado.</div><div class="armario-grid full-map">${inventory.armarios.map(armario => armarioCard(armario, true)).join('')}</div>`, 'mapa')
  enableDragAndDrop()
}

function armarioPage(id) {
  const armario = getArmario(id)
  if (!armario) return notFound()
  shell(`<div class="breadcrumbs"><a href="#/">Visão geral</a><span>/</span><span>${escapeHtml(armarioName(armario))}</span></div><section class="page-intro split-intro"><div><span class="section-kicker">ARMÁRIO ${armario.id}</span><h2>${escapeHtml(armarioName(armario))}</h2><p>Selecione uma posição ou arraste uma caixa para outra posição.</p></div><a class="outline-button" href="#/qrcodes">QR Code geral</a></section><div class="armario-stats"><strong>${armario.positions.length}</strong><span>registros neste armário</span></div><div class="drag-help">Arraste uma caixa para uma posição livre. Para mover entre armários, use o mapa da sala.</div><div class="position-grid large-grid">${armario.positions.map(box => positionCard(armario.id, box, true)).join('') || '<div class="empty-state"><strong>Armário sem caixas.</strong><span>Entre na Administração para importar um PDF para este armário.</span></div>'}</div>`, 'mapa')
  enableDragAndDrop()
}

function enableDragAndDrop() {
  let draggedRecord = ''
  document.querySelectorAll('.position-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', event => { draggedRecord = card.dataset.recordId; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedRecord) })
    card.addEventListener('dragend', () => { draggedRecord = ''; card.classList.remove('dragging'); document.querySelectorAll('.position-card.drag-over').forEach(item => item.classList.remove('drag-over')) })
    card.addEventListener('dragover', event => { if (draggedRecord && card.dataset.recordId !== draggedRecord) { event.preventDefault(); card.classList.add('drag-over') } })
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'))
    card.addEventListener('drop', async event => {
      event.preventDefault(); card.classList.remove('drag-over')
      const recordId = event.dataTransfer.getData('text/plain') || draggedRecord
      if (!recordId || recordId === card.dataset.recordId) return
      if (!(await ensureAdmin())) return
      try {
        await api(`/api/boxes/${encodeURIComponent(recordId)}/move`, { method: 'POST', body: JSON.stringify({ armario: card.dataset.armId, posicao: card.dataset.positionId }) })
        await reloadInventory(); render()
      } catch (error) {
        if (error.status === 409 && window.confirm(`${error.message}\n\nDeseja substituir a caixa que já está nessa posição?`)) {
          try { await api(`/api/boxes/${encodeURIComponent(recordId)}/move`, { method: 'POST', body: JSON.stringify({ armario: card.dataset.armId, posicao: card.dataset.positionId, replace: true }) }); await reloadInventory(); render() } catch (replaceError) { window.alert(`Não foi possível substituir: ${replaceError.message}`) }
        } else if (error.status !== 409) window.alert(`Não foi possível mover: ${error.message}`)
      }
    })
  })
}

function detailRow(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Não informado')}</dd></div>`
}

function boxPage(armId, recordId) {
  const armario = getArmario(armId)
  const box = getBox(armId, recordId)
  if (!armario || !box) return notFound()
  const rawLines = escapeHtml(box.rawText || '').replaceAll('\n', '<br/>')
  const adminCard = isStaticPages ? `<div class="aside-card"><span class="section-kicker">MODO CONSULTA</span><strong>GitHub Pages</strong><span>Esta versão é somente para consulta. Para editar, excluir ou mover caixas, use o site principal.</span><a class="text-link" href="${primarySite}/#/admin" target="_blank" rel="noreferrer">Abrir administração →</a></div>` : `<div class="aside-card admin-card"><span class="section-kicker">GESTÃO DO INVENTÁRIO</span><button class="solid-button full-button" id="edit-box">Editar informações</button><button class="outline-button full-button danger-button" id="delete-box">Excluir este registro</button><span class="admin-hint">As alterações ficam salvas para todos no site.</span></div>`
  shell(`<div class="breadcrumbs"><a href="#/">Visão geral</a><span>/</span><a href="${armRoute(armId)}">Armário ${armId}</a><span>/</span><span>Posição ${box.id}</span></div><section class="detail-header"><div><span class="section-kicker">LOCALIZAÇÃO DA CAIXA</span><h2>Armário ${armId} · Posição ${box.id}</h2><p>Esta é a ficha detalhada da posição selecionada.</p></div><div class="location-badge ${tone(box)}"><span>POSIÇÃO</span><strong>${box.id}</strong></div></section><div class="detail-layout"><article class="detail-card"><div class="detail-card-title"><span class="box-mark ${tone(box)}">${box.id}</span><div><span class="section-kicker">CONTEÚDO VERIFICADO</span><h3>${escapeHtml(shortLabel(box))}</h3></div></div><dl>${detailRow('Categoria / título', box.raw.titulo)}${detailRow('Convênio', box.raw.convenio)}${detailRow('Nome', box.raw.nome)}${detailRow('Período / data', box.raw.data)}${detailRow('Parte', box.raw.parte)}</dl><div class="raw-transcription"><span class="section-kicker">TEXTO DO PDF VERIFICADO</span><div>${rawLines || '<span>Sem texto identificado.</span>'}</div></div><div class="source-note">Localização no PDF: página ${box.sourcePage} = armário ${armId} · quadrado ${box.sourcePosition} = posição ${box.id}${box.duplicateIndex > 1 ? ` · registro ${box.duplicateIndex}` : ''}</div></article><aside class="detail-aside"><div class="aside-card"><span class="section-kicker">CAMINHO FÍSICO</span><strong>5º andar</strong><span>Armário ${armId}</span><span>Posição ${box.id}</span></div><div class="aside-card"><span class="section-kicker">QR CODE</span><strong>1 QR geral</strong><span>Use o QR Code geral para abrir o site e pesquisar esta posição.</span><a class="text-link" href="#/qrcodes">Abrir QR geral →</a></div>${adminCard}</aside></div>`, 'mapa')
  document.querySelector('#edit-box')?.addEventListener('click', async () => { if (await ensureAdmin()) openEditDialog(armId, box) })
  document.querySelector('#delete-box')?.addEventListener('click', async () => { if (await ensureAdmin()) deleteBox(armId, box) })
}

function openEditDialog(armId, box) {
  const options = inventory.armarios.map(arm => `<option value="${arm.id}" ${arm.id === armId ? 'selected' : ''}>Armário ${arm.id}</option>`).join('')
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `<form class="edit-modal" id="edit-form"><div class="modal-head"><div><span class="section-kicker">EDITAR REGISTRO</span><h3>Armário ${armId} · Posição ${box.id}</h3></div><button type="button" class="modal-close" id="close-modal">×</button></div><label>Categoria / título<input name="titulo" value="${escapeHtml(box.raw.titulo)}" /></label><label>Convênio<input name="convenio" value="${escapeHtml(box.raw.convenio)}" /></label><label>Nome<input name="nome" value="${escapeHtml(box.raw.nome)}" /></label><label>Período / data<input name="data" value="${escapeHtml(box.raw.data)}" /></label><label>Parte<input name="parte" value="${escapeHtml(box.raw.parte)}" /></label><label>Texto completo do PDF<textarea name="rawText" rows="4">${escapeHtml(box.rawText || '')}</textarea></label><div class="move-box"><span class="section-kicker">REPOSICIONAR CAIXA</span><div class="move-fields"><label>Armário<select name="moveArmario">${options}</select></label><label>Posição<input name="movePosicao" inputmode="numeric" maxlength="2" value="${box.id}" /></label></div></div><div class="modal-actions"><button type="button" class="outline-button" id="cancel-modal">Cancelar</button><button type="submit" class="solid-button">Salvar alterações</button></div><p class="modal-status" id="modal-status"></p></form>`
  document.body.appendChild(modal)
  const close = () => modal.remove()
  modal.querySelector('#close-modal').addEventListener('click', close)
  modal.querySelector('#cancel-modal').addEventListener('click', close)
  modal.addEventListener('click', event => { if (event.target === modal) close() })
  modal.querySelector('#edit-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const status = modal.querySelector('#modal-status')
    status.textContent = 'Salvando...'
    try {
      await api(`/api/boxes/${encodeURIComponent(box.recordId)}`, { method: 'PUT', body: JSON.stringify({ titulo: form.get('titulo'), convenio: form.get('convenio'), nome: form.get('nome'), data: form.get('data'), parte: form.get('parte'), rawText: form.get('rawText') }) })
      const newArmario = form.get('moveArmario')
      const newPosition = String(form.get('movePosicao')).padStart(2, '0')
      if (newArmario !== armId || newPosition !== box.id) {
        try { await api(`/api/boxes/${encodeURIComponent(box.recordId)}/move`, { method: 'POST', body: JSON.stringify({ armario: newArmario, posicao: newPosition }) }) } catch (moveError) {
          if (moveError.status !== 409 || !window.confirm(`${moveError.message}\n\nDeseja substituir a caixa que já está nessa posição?`)) throw moveError
          await api(`/api/boxes/${encodeURIComponent(box.recordId)}/move`, { method: 'POST', body: JSON.stringify({ armario: newArmario, posicao: newPosition, replace: true }) })
        }
      }
      await reloadInventory()
      close()
      const updated = getBox(newArmario, box.recordId)
      location.hash = updated ? `/caixa/${box.recordId}` : `/armario/${newArmario}`
    } catch (error) { status.textContent = error.message; status.className = 'modal-status error' }
  })
}

async function deleteBox(armId, box) {
  if (!window.confirm(`Excluir o registro da posição ${box.id} do armário ${armId}? Esta ação não pode ser desfeita.`)) return
  try { await api(`/api/boxes/${encodeURIComponent(box.recordId)}`, { method: 'DELETE' }); await reloadInventory(); location.hash = armRoute(armId) } catch (error) { window.alert(error.message) }
}

function openAddDialog() {
  const options = inventory.armarios.map(arm => `<option value="${arm.id}">Armário ${arm.id}</option>`).join('')
  const modal = document.createElement('div'); modal.className = 'modal-backdrop'
  modal.innerHTML = `<form class="edit-modal" id="add-form"><div class="modal-head"><div><span class="section-kicker">NOVA CAIXA</span><h3>Adicionar registro ao inventário</h3></div><button type="button" class="modal-close" id="close-modal">×</button></div><label>Armário<select name="armario">${options}</select></label><label>Posição<input name="posicao" inputmode="numeric" maxlength="2" value="01" required /></label><label>Categoria / título<input name="titulo" /></label><label>Convênio<input name="convenio" /></label><label>Nome<input name="nome" /></label><label>Período / data<input name="data" /></label><label>Parte<input name="parte" /></label><label>Texto completo<textarea name="rawText" rows="4"></textarea></label><div class="modal-actions"><button type="button" class="outline-button" id="cancel-modal">Cancelar</button><button type="submit" class="solid-button">Adicionar caixa</button></div><p class="modal-status" id="modal-status"></p></form>`
  document.body.appendChild(modal)
  const close = () => modal.remove(); modal.querySelector('#close-modal').addEventListener('click', close); modal.querySelector('#cancel-modal').addEventListener('click', close); modal.addEventListener('click', event => { if (event.target === modal) close() })
  modal.querySelector('#add-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target); const status = modal.querySelector('#modal-status'); status.textContent = 'Salvando...'
    const payload = { armario: form.get('armario'), posicao: form.get('posicao'), titulo: form.get('titulo'), convenio: form.get('convenio'), nome: form.get('nome'), data: form.get('data'), parte: form.get('parte'), rawText: form.get('rawText') }
    try {
      let result
      try { result = await api('/api/boxes', { method: 'POST', body: JSON.stringify(payload) }) } catch (error) {
        if (error.status !== 409 || !window.confirm(`${error.message}\n\nDeseja substituir a caixa que já está nessa posição?`)) throw error
        result = await api('/api/boxes', { method: 'POST', body: JSON.stringify({ ...payload, replace: true }) })
      }
      await reloadInventory(); close(); location.hash = `/caixa/${result.recordId}`
    } catch (error) { status.textContent = error.message; status.className = 'modal-status error' }
  })
}

async function reloadInventory() {
  const response = await fetch('/api/inventory', { credentials: 'include' })
  if (!response.ok) throw new Error('Não foi possível atualizar o inventário compartilhado.')
  inventory = await response.json()
}

function openEditCabinetDialog(armario) {
  const modal = document.createElement('div'); modal.className = 'modal-backdrop'
  modal.innerHTML = `<form class="edit-modal import-modal" id="edit-cabinet-form"><div class="modal-head"><div><span class="section-kicker">EDITAR ARMÁRIO</span><h3>${escapeHtml(armarioName(armario))}</h3></div><button type="button" class="modal-close" id="close-modal">×</button></div><p class="modal-intro">Altere o número ou o nome. As caixas deste armário acompanharão automaticamente a mudança de número.</p><label>Número do armário<input name="id" inputmode="numeric" maxlength="3" value="${escapeHtml(armario.id)}" required /></label><label>Nome do armário<input name="name" maxlength="255" value="${escapeHtml(armarioName(armario))}" required /></label><div class="modal-actions"><button type="button" class="outline-button" id="cancel-modal">Cancelar</button><button type="submit" class="solid-button">Salvar alterações</button></div><p class="modal-status" id="modal-status"></p></form>`
  document.body.appendChild(modal)
  const close = () => modal.remove()
  modal.querySelector('#close-modal').addEventListener('click', close)
  modal.querySelector('#cancel-modal').addEventListener('click', close)
  modal.addEventListener('click', event => { if (event.target === modal) close() })
  modal.querySelector('#edit-cabinet-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target); const status = modal.querySelector('#modal-status'); status.textContent = 'Salvando...'; status.className = 'modal-status'
    try {
      await api(`/api/armarios/${encodeURIComponent(armario.id)}`, { method: 'PUT', body: JSON.stringify({ id: form.get('id'), name: form.get('name') }) })
      await reloadInventory(); close(); adminPage()
    } catch (error) { status.textContent = error.message; status.className = 'modal-status error' }
  })
}

async function deleteCabinet(armario) {
  if (!window.confirm(`Excluir o armário ${armario.id} — ${armarioName(armario)}?`)) return
  try {
    const result = await api(`/api/armarios/${encodeURIComponent(armario.id)}`, { method: 'DELETE', body: JSON.stringify({ deleteBoxes: false }) })
    if (result.confirmationRequired) {
      if (!window.confirm(`${result.message}\n\nPara excluir este armário, será necessário confirmar a senha novamente e apagar também as ${result.boxes} caixa(s). Continuar?`)) return
      if (!(await confirmAdminPassword())) return
      await api(`/api/armarios/${encodeURIComponent(armario.id)}`, { method: 'DELETE', body: JSON.stringify({ deleteBoxes: true }) })
    }
  } catch (error) {
    window.alert(error.message)
    return
  }
  await reloadInventory(); adminPage()
}

function openCabinetDialog() {
  const modal = document.createElement('div'); modal.className = 'modal-backdrop'
  modal.innerHTML = `<form class="edit-modal import-modal" id="cabinet-form"><div class="modal-head"><div><span class="section-kicker">NOVO ARMÁRIO</span><h3>Criar armário e importar PDF</h3></div><button type="button" class="modal-close" id="close-modal">×</button></div><p class="modal-intro">Informe o número e o nome do armário. O sistema lê cada página, reconhece o rodapé <strong>Origem: página X, quadrado Y</strong> e coloca as caixas na posição do quadrado, em ordem.</p><label>Número do armário<input name="id" inputmode="numeric" maxlength="3" placeholder="Ex.: 20" required /></label><label>Nome do armário<input name="name" maxlength="255" placeholder="Ex.: Arquivo de prontuários" required /></label><label>PDF deste armário<input name="pdf" type="file" accept="application/pdf,.pdf" /></label><label>Posição inicial se o PDF não tiver rodapé<input name="startPosition" type="number" min="1" value="1" /></label><label class="check-row"><input name="replace" type="checkbox" /> Substituir caixas que já estiverem nas posições encontradas</label><p class="file-hint">O PDF pode ter uma etiqueta por página. Com o rodapé de origem, o sistema usa automaticamente o número do quadrado como posição.</p><div class="modal-actions"><button type="button" class="outline-button" id="cancel-modal">Cancelar</button><button type="submit" class="solid-button">Criar e importar</button></div><p class="modal-status" id="modal-status"></p></form>`
  document.body.appendChild(modal)
  const close = () => modal.remove()
  modal.querySelector('#close-modal').addEventListener('click', close)
  modal.querySelector('#cancel-modal').addEventListener('click', close)
  modal.addEventListener('click', event => { if (event.target === modal) close() })
  modal.querySelector('#cabinet-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target); const status = modal.querySelector('#modal-status'); status.textContent = 'Criando armário...'; status.className = 'modal-status'
    const id = String(form.get('id') || '').trim(); const name = String(form.get('name') || '').trim(); const file = form.get('pdf')
    try {
      try { await api('/api/armarios', { method: 'POST', body: JSON.stringify({ id, name }) }) } catch (error) {
        if (error.status !== 409 || !file?.size) throw error
      }
      if (file?.size) {
        status.textContent = 'Lendo e organizando o PDF...'
        const buffer = await file.arrayBuffer()
        let binary = ''; const bytes = new Uint8Array(buffer); const chunkSize = 0x8000
        for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
        const data = `data:application/pdf;base64,${btoa(binary)}`
        const result = await api(`/api/armarios/${encodeURIComponent(id)}/import-pdf`, { method: 'POST', body: JSON.stringify({ data, filename: file.name, startPosition: form.get('startPosition'), replace: form.get('replace') === 'on' }) })
        status.textContent = `${result.imported} caixa(s) importada(s) em ${result.positions} posição(ões).`
      }
      await reloadInventory(); close(); location.hash = `/armario/${String(id).replace(/\D/g, '').padStart(2, '0')}`; render()
    } catch (error) { status.textContent = error.message; status.className = 'modal-status error' }
  })
}

async function renderQrCodes() {
  shell(`<section class="page-intro"><span class="section-kicker">ACESSO RÁPIDO</span><h2>QR Code geral do inventário</h2><p>Este é o único QR Code do sistema. Coloque-o em um local visível: ele abre o site completo, onde é possível pesquisar qualquer armário, posição ou conteúdo.</p></section><div class="qr-toolbar"><span>Endereço do site: ${escapeHtml(location.origin)}${escapeHtml(location.pathname)}</span><button class="outline-button" id="print-qr">Imprimir QR Code</button></div><div class="single-qr-layout"><article class="single-qr-card"><span class="section-kicker">MAPA DIGITAL · 5º ANDAR</span><h3>Escaneie para consultar</h3><canvas id="global-qr"></canvas><strong>${formatCount(inventory.armarios.length)} armários · ${formatCount(allBoxes().length)} registros</strong><span>Busca por armário, posição, convênio, data e parte.</span></article><div class="qr-instructions"><span class="section-kicker">COMO USAR</span><h3>Um QR. Todo o inventário.</h3><p>Após escanear, use a busca na página inicial ou abra o mapa dos armários. Cada posição leva à ficha detalhada com o texto do PDF verificado.</p><a class="solid-button" href="#/">Abrir o site agora →</a></div></div>`, 'qr')
  document.querySelector('#print-qr')?.addEventListener('click', () => window.print())
  const canvas = document.querySelector('#global-qr')
  if (canvas) await QRCode.toCanvas(canvas, `${location.origin}${location.pathname}#/`, { width: 280, margin: 2, color: { dark: '#17365d', light: '#ffffff' } })
}

function adminPage() {
  if (isStaticPages) {
    shell(`<section class="page-intro admin-intro"><span class="section-kicker">MODO CONSULTA</span><h2>Administração no site principal</h2><p>O GitHub Pages hospeda a versão pública de consulta. Para adicionar, editar, excluir ou mover caixas, use o site principal com banco e login administrativo.</p><a class="solid-button" href="${primarySite}/#/admin" target="_blank" rel="noreferrer">Abrir administração →</a></section>`, 'admin')
    return
  }
  if (!adminSessionValid) {
    shell(`<section class="page-intro admin-intro"><span class="section-kicker">ÁREA RESTRITA</span><h2>Administração do inventário</h2><p>Entre com o usuário e a senha de administrador para editar informações, excluir registros ou mover caixas no mapa.</p><button class="solid-button" id="admin-login">Entrar na administração</button></section><section class="admin-security-note"><strong>Proteção ativa</strong><span>O site pede autenticação antes de cada sessão administrativa e as alterações ficam salvas para todos os usuários.</span></section>`, 'admin')
    document.querySelector('#admin-login')?.addEventListener('click', async () => { if (await ensureAdmin()) adminPage() })
    return
  }
  const duplicateSlots = [...new Set(allBoxes().filter(({ position }) => position.duplicateIndex > 1).map(({ armario, position }) => `${armario.id}-${position.id}`))].length
  shell(`<section class="page-intro admin-intro"><div><span class="section-kicker">ÁREA RESTRITA</span><h2>Administração do inventário</h2><p>Crie, edite e exclua armários; importe um PDF por armário e gerencie todas as caixas. O sistema lê os quadrados do PDF e organiza as posições automaticamente.</p></div><div class="admin-actions"><button class="solid-button" id="add-cabinet">Criar armário / importar PDF</button><button class="outline-button" id="add-box">Adicionar caixa</button><a class="solid-button" href="#/mapa">Abrir mapa da sala →</a><button class="outline-button" id="admin-logout">Sair</button></div></section><section class="stats-grid admin-stats">${statCard(formatCount(allBoxes().length), 'registros cadastrados', 'stat-blue')}${statCard(formatCount(inventory.armarios.length), 'armários', 'stat-orange')}${statCard(formatCount(duplicateSlots), 'posições com mais de um registro', 'stat-green')}</section><section class="cabinet-management"><div class="section-heading"><div><span class="section-kicker">GESTÃO DE ARMÁRIOS</span><h2>Armários cadastrados</h2></div><span class="results-count">${formatCount(inventory.armarios.length)} armários</span></div><div class="cabinet-admin-list">${inventory.armarios.map(armario => `<div class="cabinet-admin-row"><span><b>Armário ${escapeHtml(armario.id)}</b><strong>${escapeHtml(armarioName(armario))}</strong><small>${formatCount(armario.positions.length)} caixa(s) vinculada(s)</small></span><span class="cabinet-admin-actions"><button class="outline-button compact-button edit-cabinet" data-arm-id="${escapeHtml(armario.id)}">Editar</button><button class="danger-button compact-button delete-cabinet" data-arm-id="${escapeHtml(armario.id)}">Excluir</button></span></div>`).join('')}</div></section><section class="diagnostic-panel"><div><span class="section-kicker">VERIFICAÇÃO DO SISTEMA</span><h2>Diagnóstico do site</h2><p id="diagnostic-status">Clique para verificar login, banco, inventário e movimentação.</p></div><button class="outline-button" id="run-diagnostics">Verificar agora</button><div id="diagnostic-details" class="diagnostic-details"></div></section><section class="admin-workspace"><div class="section-heading"><div><span class="section-kicker">GESTÃO RÁPIDA</span><h2>Localizar registro para editar</h2></div><span class="results-count" id="admin-count"></span></div><div class="search-field admin-search"><span class="search-icon">⌕</span><input id="admin-search" type="search" placeholder="Buscar por armário, posição, convênio, período ou conteúdo..." /></div><div class="admin-list" id="admin-list"></div></section>`, 'admin')
  const list = document.querySelector('#admin-list'); const count = document.querySelector('#admin-count')
  document.querySelector('#add-cabinet')?.addEventListener('click', openCabinetDialog)
  document.querySelector('#add-box')?.addEventListener('click', openAddDialog)
  document.querySelectorAll('.edit-cabinet').forEach(button => button.addEventListener('click', () => openEditCabinetDialog(getArmario(button.dataset.armId))))
  document.querySelectorAll('.delete-cabinet').forEach(button => button.addEventListener('click', () => { const armario = getArmario(button.dataset.armId); if (armario) deleteCabinet(armario) }))
  const draw = () => {
    const q = (document.querySelector('#admin-search')?.value || '').toLocaleLowerCase('pt-BR').trim()
    const results = allBoxes().filter(({ armario, position }) => !q || `${armario.id} ${position.id} ${rawText(position)}`.toLocaleLowerCase('pt-BR').includes(q)).slice(0, 120)
    count.textContent = `${formatCount(results.length)} registro${results.length === 1 ? '' : 's'}`
    list.innerHTML = results.length ? results.map(({ armario, position }) => `<div class="admin-list-row"><span class="admin-location">Armário ${armario.id}<b>Posição ${position.id}</b></span><span class="admin-record"><strong>${escapeHtml(shortLabel(position))}</strong><small>${escapeHtml(categoryText(position) || 'Sem categoria')} · ${escapeHtml(position.raw.data || 'Sem data')}</small></span><a class="outline-button compact-button" href="${boxRoute(armario.id, position.recordId)}">Abrir ficha →</a></div>`).join('') : '<div class="empty-state"><strong>Nenhum registro encontrado.</strong><span>Faça uma nova busca.</span></div>'
  }
  document.querySelector('#admin-search')?.addEventListener('input', draw)
  document.querySelector('#admin-logout')?.addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }) } finally { adminSessionValid = false; adminToken = ''; adminUsername = ''; adminPage() } })
  const runDiagnostics = async () => {
    const status = document.querySelector('#diagnostic-status'); const details = document.querySelector('#diagnostic-details')
    status.textContent = 'Verificando...'; details.innerHTML = ''
    try {
      const data = await api('/api/admin/diagnostics')
      status.textContent = `Tudo certo · verificado em ${new Date(data.checkedAt).toLocaleString('pt-BR')}`
      details.innerHTML = `<span class="diagnostic-ok">Autenticação: ${escapeHtml(data.authentication)}</span><span class="diagnostic-ok">Banco: ${escapeHtml(data.database)}</span><span class="diagnostic-ok">Inventário: ${formatCount(data.inventory.records)} registros em ${formatCount(data.inventory.armarios)} armários</span><span class="diagnostic-ok">Movimentação: ${escapeHtml(data.movement)}</span>`
    } catch (error) { status.textContent = 'Foi encontrado um erro'; details.innerHTML = `<span class="diagnostic-error">${escapeHtml(error.message)}</span>` }
  }
  document.querySelector('#run-diagnostics')?.addEventListener('click', runDiagnostics)
  runDiagnostics()
  draw()
}

function notFound() {
  shell(`<section class="empty-page"><span class="section-kicker">NÃO ENCONTRADO</span><h2>Esta posição não foi localizada.</h2><p>Verifique o QR Code ou volte para a visão geral.</p><a class="solid-button" href="#/">Voltar ao início</a></section>`)
}

function render() {
  const value = location.hash.replace(/^#/, '') || '/'
  if (value.startsWith('/qrcodes')) return renderQrCodes()
  const boxMatch = value.match(/^\/caixa\/(\d+)-(\d+)-([A-Za-z0-9_-]+)/)
  if (boxMatch) return boxPage(boxMatch[1], boxMatch[0].slice('/caixa/'.length))
  const armMatch = value.match(/^\/armario\/(\d+)/)
  if (armMatch) return armarioPage(armMatch[1])
  if (value === '/mapa') return mapPage()
  if (value === '/admin') return adminPage()
  return homePage()
}

window.addEventListener('hashchange', render)
fetch('/api/inventory').then(response => { if (!response.ok) throw new Error('API indisponível'); return response.json() }).catch(() => fetch(assetUrl('inventory.json')).then(response => response.json())).then(data => { inventory = data; render() }).catch(() => { app.innerHTML = '<div class="loading-error">Não foi possível carregar o inventário.</div>' })
