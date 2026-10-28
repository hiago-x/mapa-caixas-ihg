import QRCode from 'qrcode'
import './styles.css'

const app = document.querySelector('#app')
let inventory = { armarios: [] }
let homeState = { q: '', armario: 'todos', filtro: 'todos', periodo: '' }

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const allBoxes = () => inventory.armarios.flatMap(armario => armario.positions.map(position => ({ armario, position })))
const getArmario = id => inventory.armarios.find(item => item.id === String(id).padStart(2, '0'))
const getBox = (armId, positionId) => {
  const armario = getArmario(armId)
  return armario?.positions.find(position => position.id === String(positionId).padStart(2, '0'))
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
const route = path => `#${path}`
const armRoute = id => route(`/armario/${id}`)
const boxRoute = (armId, positionId) => route(`/caixa/${armId}-${positionId}`)
const formatCount = value => new Intl.NumberFormat('pt-BR').format(value)

function shell(content, active = 'inicio') {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand-wrap">
        <img src="/logo_ihg.png" alt="Centro de Oncologia IHG" class="brand-logo" />
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
      </nav>
    </header>
    <main class="page-content">${content}</main>
    <footer class="footer"><span>Inventário do 5º andar</span><span>19 armários · 328 posições</span></footer>
  `
}

function statCard(value, label, accent) {
  return `<div class="stat-card ${accent}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`
}

function positionCard(armId, box) {
  const period = box.raw.data || 'Sem data'
  const part = box.raw.parte ? `Parte: ${box.raw.parte}` : 'Parte não informada'
  return `<a class="position-card ${tone(box)}" href="${boxRoute(armId, box.id)}" aria-label="Armário ${armId}, posição ${box.id}">
    <span class="position-number">${box.id}</span>
    <strong>${escapeHtml(shortLabel(box))}</strong>
    <span>${escapeHtml(period)}</span>
    <small>${escapeHtml(part)}</small>
  </a>`
}

function armarioCard(armario) {
  const preview = armario.positions.slice(0, 8).map(box => positionCard(armario.id, box)).join('')
  return `<section class="armario-card">
    <div class="armario-card-head">
      <div><span class="section-kicker">ARMÁRIO</span><h3>${armario.id}</h3></div>
      <div class="armario-meta"><strong>${armario.positions.length}</strong><span>posições</span></div>
    </div>
    <div class="mini-grid">${preview}</div>
    <div class="card-action"><a class="text-link" href="${armRoute(armario.id)}">Abrir armário completo <span>→</span></a></div>
  </section>`
}

function filters() {
  const categories = [...new Set(allBoxes().flatMap(({ position }) => [position.raw.titulo, position.raw.convenio, position.raw.nome]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const arms = inventory.armarios.map(item => `<option value="${item.id}" ${homeState.armario === item.id ? 'selected' : ''}>Armário ${item.id}</option>`).join('')
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
  return `<a class="result-row ${tone(position)}" href="${boxRoute(armario.id, position.id)}">
    <span class="result-location"><b>Armário ${armario.id}</b><em>Posição ${position.id}</em></span>
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
    <div class="hero-note"><span class="hero-note-icon">⌖</span><strong>Como usar</strong><span>Pesquise abaixo ou escaneie o QR Code do armário para abrir o mapa direto no celular.</span></div>
  </section>
  <section class="stats-grid">${statCard('19', 'armários cadastrados', 'stat-blue')}${statCard(formatCount(total), 'posições mapeadas', 'stat-orange')}${statCard('100%', 'acesso por QR Code', 'stat-green')}</section>
  <section class="search-section"><div class="section-heading"><div><span class="section-kicker">INVENTÁRIO DIGITAL</span><h2>Buscar uma caixa</h2></div><span id="results-count" class="results-count"></span></div>${filters()}<div id="results" class="results-list"></div></section>
  <section class="armario-overview"><div class="section-heading"><div><span class="section-kicker">VISÃO ESPACIAL</span><h2>Mapa dos armários</h2></div><a class="outline-button" href="#/mapa">Ver mapa completo →</a></div><div class="armario-grid">${inventory.armarios.slice(0, 6).map(armarioCard).join('')}</div></section>`, 'inicio')
  renderResults()
  document.querySelector('#search-input')?.addEventListener('input', event => { homeState.q = event.target.value; renderResults() })
  document.querySelector('#arm-filter')?.addEventListener('change', event => { homeState.armario = event.target.value; renderResults() })
  document.querySelector('#category-filter')?.addEventListener('change', event => { homeState.filtro = event.target.value; renderResults() })
  document.querySelector('#period-filter')?.addEventListener('input', event => { homeState.periodo = event.target.value; renderResults() })
}

function mapPage() {
  shell(`<section class="page-intro"><span class="section-kicker">VISÃO ESPACIAL</span><h2>Mapa dos armários</h2><p>Cada cartão representa um armário. As posições são numeradas na ordem do inventário original.</p></section><div class="legend"><span><i class="dot dot-blue"></i> IMAS</span><span><i class="dot dot-orange"></i> IPASGO</span><span><i class="dot dot-green"></i> UNIMED</span><span><i class="dot dot-yellow"></i> Conferir / ilegível</span></div><div class="armario-grid full-map">${inventory.armarios.map(armarioCard).join('')}</div>`, 'mapa')
}

function armarioPage(id) {
  const armario = getArmario(id)
  if (!armario) return notFound()
  shell(`<div class="breadcrumbs"><a href="#/">Visão geral</a><span>/</span><span>Armário ${armario.id}</span></div><section class="page-intro split-intro"><div><span class="section-kicker">ARMÁRIO ${armario.id}</span><h2>Posições do armário</h2><p>Selecione uma posição para ver o conteúdo detalhado da caixa.</p></div><a class="solid-button" href="#/qrcodes?armario=${armario.id}">Abrir QR Code do armário</a></section><div class="armario-stats"><strong>${armario.positions.length}</strong><span>posições cadastradas</span></div><div class="position-grid large-grid">${armario.positions.map(box => positionCard(armario.id, box)).join('')}</div>`, 'mapa')
}

function detailRow(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Não informado')}</dd></div>`
}

function boxPage(armId, positionId) {
  const armario = getArmario(armId)
  const box = getBox(armId, positionId)
  if (!armario || !box) return notFound()
  const rawLines = Object.entries(box.raw).filter(([, value]) => value).map(([key, value]) => `<div><b>${escapeHtml(key.toUpperCase())}:</b> ${escapeHtml(value)}</div>`).join('')
  shell(`<div class="breadcrumbs"><a href="#/">Visão geral</a><span>/</span><a href="${armRoute(armId)}">Armário ${armId}</a><span>/</span><span>Posição ${box.id}</span></div><section class="detail-header"><div><span class="section-kicker">LOCALIZAÇÃO DA CAIXA</span><h2>Armário ${armId} · Posição ${box.id}</h2><p>Esta é a ficha detalhada da posição selecionada.</p></div><div class="location-badge ${tone(box)}"><span>POSIÇÃO</span><strong>${box.id}</strong></div></section><div class="detail-layout"><article class="detail-card"><div class="detail-card-title"><span class="box-mark ${tone(box)}">${box.id}</span><div><span class="section-kicker">CONTEÚDO TRANSCRITO</span><h3>${escapeHtml(shortLabel(box))}</h3></div></div><dl>${detailRow('Categoria / título', box.raw.titulo)}${detailRow('Convênio', box.raw.convenio)}${detailRow('Nome', box.raw.nome)}${detailRow('Período / data', box.raw.data)}${detailRow('Parte', box.raw.parte)}</dl><div class="raw-transcription"><span class="section-kicker">REGISTRO ORIGINAL</span><div>${rawLines || '<span>Sem texto identificado.</span>'}</div></div><div class="source-note">Fonte: inventário transcrito · página ${box.sourcePage} · quadrado ${box.sourcePosition}</div></article><aside class="detail-aside"><div class="aside-card"><span class="section-kicker">CAMINHO FÍSICO</span><strong>5º andar</strong><span>Armário ${armId}</span><span>Posição ${box.id}</span></div><div class="aside-card qr-small"><span class="section-kicker">QR DESTA POSIÇÃO</span><canvas id="box-qr"></canvas><small>Escaneie para abrir esta ficha.</small></div></aside></div>`, 'mapa')
  const canvas = document.querySelector('#box-qr')
  if (canvas) QRCode.toCanvas(canvas, `${location.origin}${location.pathname}${boxRoute(armId, box.id)}`, { width: 150, margin: 1, color: { dark: '#17365d', light: '#ffffff' } })
}

async function renderQrCodes() {
  shell(`<section class="page-intro"><span class="section-kicker">IDENTIFICAÇÃO FÍSICA</span><h2>QR Codes dos armários</h2><p>Imprima esta página ou abra pelo celular. Cada QR Code leva diretamente ao mapa detalhado do armário.</p></section><div class="qr-toolbar"><span>Os endereços são gerados automaticamente a partir deste site.</span><button class="outline-button" id="print-qr">Imprimir QR Codes</button></div><div class="qr-grid">${inventory.armarios.map(armario => `<article class="qr-card"><div><span class="section-kicker">ARMÁRIO</span><h3>${armario.id}</h3><p>${armario.positions.length} posições cadastradas</p></div><canvas data-arm-qr="${armario.id}"></canvas><a class="text-link" href="${armRoute(armario.id)}">Abrir armário →</a></article>`).join('')}</div><div class="qr-help"><strong>Para colocar em cada armário</strong><span>Imprima o QR correspondente e cole na parte externa do armário. Ao escanear, a pessoa verá as posições e o conteúdo de todas as caixas daquele armário.</span></div>`, 'qr')
  document.querySelector('#print-qr')?.addEventListener('click', () => window.print())
  for (const canvas of document.querySelectorAll('[data-arm-qr]')) {
    const id = canvas.dataset.armQr
    await QRCode.toCanvas(canvas, `${location.origin}${location.pathname}${armRoute(id)}`, { width: 170, margin: 1, color: { dark: '#17365d', light: '#ffffff' } })
  }
}

function notFound() {
  shell(`<section class="empty-page"><span class="section-kicker">NÃO ENCONTRADO</span><h2>Esta posição não foi localizada.</h2><p>Verifique o QR Code ou volte para a visão geral.</p><a class="solid-button" href="#/">Voltar ao início</a></section>`)
}

function render() {
  const value = location.hash.replace(/^#/, '') || '/'
  if (value.startsWith('/qrcodes')) return renderQrCodes()
  const boxMatch = value.match(/^\/caixa\/(\d+)-(\d+)/)
  if (boxMatch) return boxPage(boxMatch[1], boxMatch[2])
  const armMatch = value.match(/^\/armario\/(\d+)/)
  if (armMatch) return armarioPage(armMatch[1])
  if (value === '/mapa') return mapPage()
  return homePage()
}

window.addEventListener('hashchange', render)
fetch('/inventory.json').then(response => response.json()).then(data => { inventory = data; render() }).catch(() => { app.innerHTML = '<div class="loading-error">Não foi possível carregar o inventário.</div>' })
