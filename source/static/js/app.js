/**
 * ConcreLab — Spreadsheet Module
 * Scientific laboratory data management
 */

const API = '';
const SESSION_ID = 'clab_' + Math.random().toString(36).slice(2, 9);

// ── State ──────────────────────────────────────────
let state = {
  sheets: [],
  activeSheet: null,
  headers: [],
  data: [],          // full data
  filteredData: [],  // current view (after filters)
  filterActive: false, // distingue "sem filtro" de "filtro com 0 resultados"
  filters: [],
  activeCell: { row: -1, col: -1 },
  selectedRows: new Set(),
  isEditing: false,
  clipboard: null,   // { rows: [[...]] }
  undoStack: [],
  redoStack: [],
  congelarCols: 0,      // quantas colunas ficam fixas ao rolar na horizontal
  regrasCor: [],        // [{col, op, val, cor}] formatação condicional
  contextRow: -1,
  sortState: { col: -1, dir: 'asc' },
};

// ── Toast ──────────────────────────────────────────
function toast(msg, type = '') {
  let tc = document.getElementById('toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Expõe para outros módulos (receitas.js, etc.)
window.showToast = toast;
Object.defineProperty(window, 'currentSheetData', {
  get: () => ({ headers: state.headers, data: state.data, filteredData: state.filteredData, activeSheet: state.activeSheet, filters: state.filters }),
});
window.getConcrestatsData = function(opts = {}) {
  const useFiltered = opts.filtered !== false;
  const rows = useFiltered && state.filterActive ? state.filteredData : state.data;
  return { headers: state.headers, data: rows, fullData: state.data, filteredData: state.filteredData, activeSheet: state.activeSheet, filters: state.filters, sessionId: SESSION_ID };
};
function notifyDataChanged(reason='update') {
  window.dispatchEvent(new CustomEvent('concrestats:datachanged', { detail: window.getConcrestatsData({filtered:true}) }));
  renderGlobalFilterBars();
}

// ── Barra de filtros global (pedido do Naor) ───────────────────────────
// Mostra os filtros da aba Planilhas em TODAS as abas, com remoção rápida —
// sem precisar voltar para Planilhas só para mexer no filtro.
const opLabel = v => (FILTER_OPS.find(o => o.v === v) || {}).l || v;
function renderGlobalFilterBars() {
  document.querySelectorAll('.gfilter-bar').forEach(bar => {
    const rules = state.filters || [];
    if (!rules.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const n = state.filterActive ? state.filteredData.length : state.data.length;
    bar.innerHTML = `<span class="gfilter-lab">Filtros:</span>` +
      rules.map((r, i) => `<span class="gfilter-chip" data-i="${i}" title="Remover este filtro">${
        escHtml(r.col)} ${escHtml(opLabel(r.op))} ${escHtml(r.val ?? '')} ✕</span>`).join('') +
      `<span class="gfilter-count">${n} de ${state.data.length} linhas</span>` +
      `<button class="gfilter-clear" type="button">Limpar</button>`;
    bar.querySelectorAll('.gfilter-chip').forEach(ch => ch.addEventListener('click', () => {
      state.filters.splice(parseInt(ch.dataset.i), 1);
      recomputeFilters(); renderGrid(); syncFilterPanel(); notifyDataChanged('filter');
    }));
    bar.querySelector('.gfilter-clear').addEventListener('click', () => {
      state.filters = []; recomputeFilters(); renderGrid(); syncFilterPanel(); notifyDataChanged('filter');
    });
  });
}
// Reconstrói as regras do painel de Planilhas a partir de state.filters.
function syncFilterPanel() {
  const box = document.getElementById('filter-rules');
  if (!box) return;
  box.innerHTML = '';
  state.filters.forEach(r => {
    try {
      addFilterRule(r.col);
      const el = box.lastElementChild;
      if (!el) return;
      el.querySelector('.f-col').value = r.col;
      el.querySelector('.f-op').value = r.op;
      el.querySelector('.f-val').value = r.val ?? '';
    } catch (_) {}
  });
}

// ── Status ─────────────────────────────────────────
function setStatus(msg, type = '') {
  document.getElementById('status-text').textContent = msg;
  const dot = document.getElementById('status-dot');
  dot.className = 'status-indicator ' + (type === 'busy' ? 'busy' : type === 'error' ? 'error' : '');
}

// ── API helpers ────────────────────────────────────
async function apiFetch(path, opts = {}) {
  try {
    const r = await fetch(API + path, opts);
    return await r.json();
  } catch (e) {
    setStatus('Erro de conexão', 'error');
    toast('Erro: ' + e.message, 'error');
    return null;
  }
}

// ── Render sheets tabs ─────────────────────────────
function renderTabs() {
  const container = document.getElementById('sheet-tabs');
  container.innerHTML = '';
  state.sheets.forEach(name => {
    const tab = document.createElement('div');
    tab.className = 'sheet-tab' + (name === state.activeSheet ? ' active' : '');
    tab.innerHTML = `<span class="tab-name">${escHtml(name)}</span><span class="tab-close" data-sheet="${escHtml(name)}">×</span>`;
    tab.querySelector('.tab-name').addEventListener('click', () => switchSheet(name));
    tab.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      deleteSheet(name);
    });
    container.appendChild(tab);
  });
}

// ── Render grid ────────────────────────────────────
function renderGrid() {
  renderHead();
  wireGridOnce();
  renderBody();
  updateFooter();
  // Column resize (handles ficam no thead, recriado a cada render)
  initColResize();
  posicionarColunasFixas();
}

function renderHead() {
  const head = document.getElementById('table-head');
  let hRow = '<tr><th class="row-num row-num-header">№</th>';
  state.headers.forEach((h, i) => {
    const sortIcon = state.sortState.col === i ? (state.sortState.dir === 'asc' ? '↓' : '↑') : '';
    const fx = i < state.congelarCols
      ? ' col-fixa' + (i === state.congelarCols - 1 ? ' fixa-fim' : '') : '';
    hRow += `<th data-col="${i}" class="${fx.trim()}"><span>${escHtml(h)}</span><span class="sort-indicator">${sortIcon}</span><div class="col-resize" data-col="${i}"></div></th>`;
  });
  hRow += '</tr>';
  head.innerHTML = hRow;

  // Header click → sort
  head.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', e => {
      if (e.target.classList.contains('col-resize')) return;
      const col = parseInt(th.dataset.col);
      if (state.sortState.col === col) {
        state.sortState.dir = state.sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortState = { col, dir: 'asc' };
      }
      sortData();
    });
  });

  // Header right-click → menu de conveniências (filtrar por coluna / por data)
  head.querySelectorAll('th[data-col]').forEach(th => {
    th.title = 'Clique p/ ordenar · botão direito p/ filtrar';
    th.addEventListener('contextmenu', e => {
      e.preventDefault();
      const col = state.headers[parseInt(th.dataset.col)];
      showHeaderMenu(e.clientX, e.clientY, col);
    });
  });
}

// ── Virtualização do grid ──────────────────────────
// Para suportar planilhas grandes (milhares de linhas) sem travar, renderizamos
// apenas as linhas visíveis (+overscan). Como as linhas têm altura fixa
// (--cell-h), usamos dois <tr> "espaçadores" (topo/base) para preservar a
// altura total e o comportamento da barra de rolagem.
const VIRT = { rowH: 28, overscan: 8, measured: false };

// Detecta número negativo para pintar de vermelho (formato BR, US, R$ e
// notação contábil "(1.234,56)"). Só pinta se a célula for SÓ um número.
function ehNegativo(v) {
  let t = String(v ?? '').trim().replace(/\s|R\$/g, '');
  if (!t) return false;
  let contabil = false;
  if (t.startsWith('(') && t.endsWith(')')) { contabil = true; t = t.slice(1, -1); }
  if (!/^-?\d[\d.,]*$/.test(t)) return false;
  return contabil || t.startsWith('-');
}

// ── Formatação condicional ────────────────────────────────────
// Regras do usuário: {col, op, val, cor}. "val" aceita número, texto ou
// [Outra Coluna] — assim dá para pintar "MPA 28 < [FCK]".
const PALETA_COR = {
  vermelho: { fundo: '#fbe3df', texto: '#8c2c1c' },
  verde:    { fundo: '#dff0e4', texto: '#1d5c34' },
  amarelo:  { fundo: '#fdf1d3', texto: '#7a5a10' },
  azul:     { fundo: '#e2ebfa', texto: '#1d3f75' },
};
const OPS_NUMERICOS = ['>', '>=', '<', '<='];
function corDaRegra(ci, txt, row) {
  if (!state.regrasCor.length) return null;
  const nomeCol = state.headers[ci];
  for (const r of state.regrasCor) {
    if (r.col !== nomeCol) continue;
    // Comparação numérica só vale em célula numérica. Sem isto, um corpo de
    // prova com "n/d" (sem resultado) era pintado de VERDE por "MPA >= FCK" —
    // ensaio que nem existe aparecendo como aprovado.
    if (OPS_NUMERICOS.includes(r.op) && isNaN(parseNumberBR(txt))) continue;
    try {
      if (applyOperator(txt, r.op, r.val, row)) return PALETA_COR[r.cor] || PALETA_COR.amarelo;
    } catch (_) { /* regra inválida: ignora */ }
  }
  return null;
}
function salvarPrefsGrid() {
  try {
    fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: { congelarCols: state.congelarCols, regrasCor: state.regrasCor } }) });
  } catch (_) {}
}

// Linhas atualmente exibidas (respeita filtro ativo).
function getDisplayRows() {
  return state.filterActive ? state.filteredData : state.data;
}

function renderBody() {
  const scroller = document.getElementById('grid-scroll');
  const body = document.getElementById('table-body');
  if (!scroller || !body) return;

  const display = getDisplayRows();
  const total   = display.length;
  const ncols   = state.headers.length;
  const rowH    = VIRT.rowH;
  const viewH   = scroller.clientHeight || 600;

  // Janela de linhas a renderizar. NÃO mexemos no scrollTop (o navegador já
  // limita a rolagem) — apenas travamos o início para que as ÚLTIMAS linhas
  // sempre sejam renderizadas (bug do cabeçalho fixo comendo o fim da rolagem).
  const visCount = Math.ceil(viewH / rowH) + VIRT.overscan * 2;
  const maxStart = Math.max(0, total - visCount);
  let start = Math.floor(scroller.scrollTop / rowH) - VIRT.overscan;
  if (start > maxStart) start = maxStart;
  if (start < 0) start = 0;
  const end = Math.min(total, start + visCount);
  const topPad = start * rowH;
  // Buffer extra no fim garante que a última linha não fique sob o rodapé/borda.
  const botPad = Math.max(0, (total - end) * rowH) + (end >= total ? rowH * 2 : 0);
  const spacer = h => `<tr class="virt-spacer" style="height:${h}px"><td colspan="${ncols + 1}"></td></tr>`;

  let html = topPad > 0 ? spacer(topPad) : '';
  for (let ri = start; ri < end; ri++) {
    const row = display[ri] || [];
    const sel = state.selectedRows.has(ri) ? ' selected' : '';
    const par = ri % 2 ? ' r-odd' : ' r-even';
    html += `<tr data-row="${ri}" class="${sel}${par}"><td class="row-num">${ri + 1}</td>`;
    for (let ci = 0; ci < ncols; ci++) {
      const val = row[ci] !== undefined ? row[ci] : '';
      const isFormula = String(val).startsWith('=');
      const active = (state.activeCell.row === ri && state.activeCell.col === ci) ? ' active-cell' : '';
      // Formatação automática: número negativo em vermelho e realce da busca.
      const txt = String(val);
      const neg = ehNegativo(txt) ? ' cel-neg' : '';
      const hit = (busca.termo && txt.toLowerCase().includes(busca.termo)) ? ' cel-busca' : '';
      const fx  = ci < state.congelarCols
        ? ' col-fixa' + (ci === state.congelarCols - 1 ? ' fixa-fim' : '') : '';
      const cor = corDaRegra(ci, txt, row);
      const est = cor ? ` style="background:${cor.fundo};color:${cor.texto}"` : '';
      html += `<td data-row="${ri}" data-col="${ci}" class="${isFormula ? 'is-formula' : ''}${active}${neg}${hit}${fx}"${est}>${escHtml(txt)}</td>`;
    }
    html += '</tr>';
  }
  if (botPad > 0) html += spacer(botPad);
  body.innerHTML = html;

  // Mede a altura real de uma linha uma única vez; re-renderiza se divergir do
  // valor presumido (border-collapse pode alterar 1px e desalinhar o scroll).
  if (!VIRT.measured) {
    const firstReal = body.querySelector('tr[data-row]');
    if (firstReal) {
      const h = firstReal.getBoundingClientRect().height;
      VIRT.measured = true;
      if (h >= 1 && Math.abs(h - VIRT.rowH) >= 1) { VIRT.rowH = h; renderBody(); }
    }
  }
}

// Listeners do grid anexados UMA vez (delegação) — o tbody/scroller são
// persistentes, então não re-anexamos a cada render da janela.
let _gridWired = false;
function wireGridOnce() {
  if (_gridWired) return;
  const scroller = document.getElementById('grid-scroll');
  const body = document.getElementById('table-body');
  if (!scroller || !body) return;
  _gridWired = true;

  // Re-renderiza a janela ao rolar (throttle via rAF). Não mexe durante edição.
  let ticking = false;
  scroller.addEventListener('scroll', () => {
    if (state.isEditing || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; renderBody(); });
  });

  // Clique: célula → editar; nº da linha → selecionar.
  body.addEventListener('click', e => {
    if (e.target.classList.contains('cell-editor')) return;
    const td = e.target.closest('td');
    if (!td) return;
    const tr = td.closest('tr[data-row]');
    if (!tr) return;
    const ri = parseInt(tr.dataset.row);
    if (td.classList.contains('row-num')) {
      if (e.shiftKey) state.selectedRows.add(ri);
      else if (e.ctrlKey || e.metaKey) { if (state.selectedRows.has(ri)) state.selectedRows.delete(ri); else state.selectedRows.add(ri); }
      else state.selectedRows = new Set([ri]);
      highlightSelectedRows();
      return;
    }
    if (td.dataset.col !== undefined) startEditing(ri, parseInt(td.dataset.col));
  });

  // Menu de contexto (botão direito).
  body.addEventListener('contextmenu', e => {
    const td = e.target.closest('td[data-row]');
    if (!td) return;
    e.preventDefault();
    state.contextRow = parseInt(td.dataset.row);
    showContextMenu(e.clientX, e.clientY);
  });
}

// Garante que a linha esteja dentro da janela visível (rola se necessário) e
// re-renderiza — usado pela navegação por teclado/seleção de célula.
function ensureRowVisible(row) {
  const scroller = document.getElementById('grid-scroll');
  if (!scroller || row < 0) { renderBody(); return; }
  const rowH = VIRT.rowH;
  const top = row * rowH;
  const bottom = top + rowH;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;
  if (top < viewTop) scroller.scrollTop = top;
  else if (bottom > viewBottom) scroller.scrollTop = bottom - scroller.clientHeight;
  renderBody();
}

function updateCellDOM(row, col, val) {
  const td = document.querySelector(`#table-body td[data-row="${row}"][data-col="${col}"]`);
  if (!td) return;
  td.textContent = String(val);
  td.className = String(val).startsWith('=') ? 'is-formula' : '';
  td.classList.add('active-cell');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateFooter() {
  document.getElementById('row-count').textContent = `${state.data.length} linhas`;
  if (state.filterActive && state.filteredData.length !== state.data.length) {
    document.getElementById('filter-count').textContent = `· ${state.filteredData.length} filtradas`;
  } else {
    document.getElementById('filter-count').textContent = '';
  }
}

// ── Cell selection & editing ───────────────────────
function selectCell(row, col) {
  if (state.isEditing) commitEdit();
  state.activeCell = { row, col };

  const display = getDisplayRows();
  const val = display[row] && display[row][col] !== undefined ? display[row][col] : '';
  document.getElementById('formula-input').value = val;

  const colLetter = colIndexToLetter(col);
  document.getElementById('cell-ref').textContent = `${colLetter}${row + 1}`;

  // Re-renderiza a janela e aplica .active-cell (a célula pode estar fora da
  // janela virtualizada após navegação por teclado).
  ensureRowVisible(row);
}

function colIndexToLetter(idx) {
  let result = '';
  idx++;
  while (idx > 0) {
    let rem = (idx - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    idx = Math.floor((idx - 1) / 26);
  }
  return result;
}

function startEditing(row, col) {
  selectCell(row, col);
  state.isEditing = true;
  const td = document.querySelector(`#table-body td[data-row="${row}"][data-col="${col}"]`);
  if (!td) return;

  const display = getDisplayRows();
  const val = display[row] && display[row][col] !== undefined ? display[row][col] : '';

  td.innerHTML = '';
  const inp = document.createElement('input');
  inp.className = 'cell-editor';
  inp.value = val;
  td.appendChild(inp);
  inp.focus();
  inp.select();

  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      state.isEditing = false;
      renderGrid();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
      const nextRow = e.shiftKey ? row - 1 : row + 1;
      const display = getDisplayRows();
      if (nextRow >= 0 && nextRow < display.length) startEditing(nextRow, col);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      const nextCol = e.shiftKey ? col - 1 : col + 1;
      if (nextCol >= 0 && nextCol < state.headers.length) startEditing(row, nextCol);
      return;
    }
  });

  inp.addEventListener('blur', () => {
    if (state.isEditing) commitEdit();
  });
}

function commitEdit() {
  state.isEditing = false;
  const { row, col } = state.activeCell;
  const inp = document.querySelector('#table-body .cell-editor');
  if (!inp) return;
  const val = inp.value;

  pushUndo();
  setDataCell(row, col, val);

  if (val.startsWith('=')) {
    const display = getDisplayRows();
    const result = evaluateFormula(val, display[row] || [], state.headers);
    updateCellDOM(row, col, result);
  } else {
    updateCellDOM(row, col, val);
  }

  document.getElementById('formula-input').value = val;
  saveToServer();
}

function evaluateFormula(formula, rowData, headers) {
  if (!formula.startsWith('=')) return formula;
  const expr = formula.slice(1);

  function resolveArg(a) {
    a = a.trim();
    const idx = headers.findIndex(h => h.toUpperCase() === a.toUpperCase());
    if (idx >= 0) return parseFloat(rowData[idx]) || 0;
    return parseFloat(a) || 0;
  }

  const funcMatch = expr.match(/^(SUM|AVG|AVERAGE|MAX|MIN|COUNT)\(([^)]+)\)$/i);
  if (funcMatch) {
    const fname = funcMatch[1].toUpperCase();
    const nums = funcMatch[2].split(',').map(resolveArg);
    if (fname === 'SUM') return nums.reduce((a, b) => a + b, 0);
    if (fname === 'AVG' || fname === 'AVERAGE') return nums.reduce((a,b)=>a+b,0)/nums.length;
    if (fname === 'MAX') return Math.max(...nums);
    if (fname === 'MIN') return Math.min(...nums);
    if (fname === 'COUNT') return nums.length;
  }

  const sorted = headers
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.length - a.h.length);

  const placeholders = {};
  let e2 = expr;
  sorted.forEach(({ h, i }) => {
    const placeholder = `__c${i}__`;
    const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('(?<![\\w\\u00C0-\\uFFFF])' + escaped + '(?![\\w\\u00C0-\\uFFFF])', 'gi');
    e2 = e2.replace(rx, placeholder);
    placeholders[placeholder] = parseFloat(rowData[i]) || 0;
  });

  Object.entries(placeholders).forEach(([ph, val]) => {
    e2 = e2.replaceAll(ph, val);
  });

  try {
    const r = Function('"use strict"; return (' + e2 + ')')();
    // Divisão por zero / resultado inválido: mostra erro legível na célula
    // em vez de "Infinity" ou "NaN".
    if (typeof r === 'number' && !isFinite(r)) return isNaN(r) ? '#VALOR!' : '#DIV/0!';
    return r;
  } catch {
    return '#ERRO!';
  }
}

function setDataCell(row, col, val) {
  const display = getDisplayRows();
  if (!display[row]) return;
  display[row][col] = val;
  if (state.filterActive) {
    const targetRow = display[row];
    const mainIdx = state.data.indexOf(targetRow);
    if (mainIdx >= 0) state.data[mainIdx][col] = val;
  }
}

// ── Undo ───────────────────────────────────────────
function pushUndo(limparRedo = true) {
  if (limparRedo) state.redoStack = [];   // ação nova invalida o "refazer"
  state.undoStack.push({
    data: JSON.parse(JSON.stringify(state.data)),
    headers: JSON.parse(JSON.stringify(state.headers))
  });
  if (state.undoStack.length > 50) state.undoStack.shift();
}

function undo() {
  if (!state.undoStack.length) return;
  const snapshot = state.undoStack.pop();
  // guarda o estado ATUAL para permitir refazer
  state.redoStack.push({
    data: JSON.parse(JSON.stringify(state.data)),
    headers: JSON.parse(JSON.stringify(state.headers))
  });
  state.data = snapshot.data;
  state.headers = snapshot.headers;
  recomputeFilters();   // desfazer não desliga mais o filtro ativo
  renderGrid();
  notifyDataChanged('undo');
  saveToServer();
  toast(`Desfeito (${state.undoStack.length} restante(s))`);
}

// Refazer — Ctrl+Y ou Ctrl+Shift+Z
function redo() {
  if (!state.redoStack.length) { toast('Nada para refazer'); return; }
  const snapshot = state.redoStack.pop();
  pushUndo(false);                     // permite desfazer o refazer
  state.data = snapshot.data;
  state.headers = snapshot.headers;
  recomputeFilters();
  renderGrid();
  notifyDataChanged('redo');
  saveToServer();
  toast('Refeito');
}

// Recalcula o filtro a partir de state.filters (independente do DOM).
// Usado após ordenar/editar para NÃO perder o filtro ativo.
let _regexRuim = null;   // guarda a última expressão inválida para avisar
function recomputeFilters() {
  _regexRuim = null;
  // Descarta regras cuja coluna não existe mais (coluna deletada/renomeada),
  // senão o chip continuava aparecendo sem filtrar nada.
  if (state.filters.length && state.headers.length) {
    state.filters = state.filters.filter(r => state.headers.indexOf(r.col) >= 0);
  }
  if (!state.filters.length) { state.filteredData = []; state.filterActive = false; return; }
  state.filteredData = state.data.filter(row =>
    state.filters.every(({ col, op, val }) => {
      const idx = state.headers.indexOf(col);
      if (idx === -1) return true;
      return applyOperator(row[idx], op, val, row);
    })
  );
  state.filterActive = true;
  if (_regexRuim && window.showToast) {
    showToast(`Expressão inválida no filtro: "${_regexRuim}" — nenhuma linha corresponde`, 'error');
    _regexRuim = null;
  }
}
window.ConcrestatsRecomputeFilters = recomputeFilters;

// ── Sort ───────────────────────────────────────────
function sortData() {
  const { col, dir } = state.sortState;
  // Ordenação por tipo. ATENÇÃO: parseFloat('2026-01-05') dá 2026, então datas
  // do mesmo ano empatavam e a coluna simplesmente não ordenava.
  const chaveData = v => {
    const t = String(v).trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Number(m[1] + m[2] + m[3]);
    m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return Number(m[3] + String(m[2]).padStart(2, '0') + String(m[1]).padStart(2, '0'));
    return null;
  };
  // Número só quando a célula inteira é numérica (evita "NF-123" virar 123).
  const chaveNum = v => {
    const t = String(v).trim().replace(/\s|R\$/g, '');
    if (!t || !/^-?\d[\d.,]*$/.test(t)) return null;
    let x = t;
    if (x.includes(',') && x.includes('.')) {
      x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    } else if (x.includes(',')) x = x.replace(',', '.');
    const n = Number(x);
    return isFinite(n) ? n : null;
  };
  state.data.sort((a, b) => {
    const av = a[col] ?? '', bv = b[col] ?? '';
    const ad = chaveData(av), bd = chaveData(bv);
    if (ad !== null && bd !== null) return dir === 'asc' ? ad - bd : bd - ad;
    const an = chaveNum(av), bn = chaveNum(bv);
    if (an !== null && bn !== null) return dir === 'asc' ? an - bn : bn - an;
    const cmp = String(av).localeCompare(String(bv), 'pt-BR', { numeric: true });
    return dir === 'asc' ? cmp : -cmp;
  });
  recomputeFilters();   // ordenar não desliga mais o filtro
  renderGrid();
}

// ── Debounced save ─────────────────────────────────
// Cada modulo lia /api/prefs por conta propria: 6 requisicoes iguais no boot.
// Agora todos compartilham a MESMA leitura.
window.prefsGet = function (recarregar) {
  const agora = Date.now();
  // Cache curto: junta as leituras do boot e ainda assim enxerga logo o que
  // acabou de ser gravado (layout de painel, template de grafico...).
  if (recarregar || !window._prefsPromise || agora - (window._prefsQuando || 0) > 3000) {
    window._prefsQuando = agora;
    window._prefsPromise = fetch('/api/prefs')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return window._prefsPromise;
};

let _saveTimer = null;
let _saveEmEspera = false;   // ha' edicao ainda nao enviada ao servidor
function saveToServer() {
  if (!state.activeSheet) return;
  markDirty(); // há alterações ainda não gravadas no arquivo
  clearTimeout(_saveTimer);
  _saveEmEspera = true;
  _saveTimer = setTimeout(async () => {
    _saveEmEspera = false;
    await apiFetch('/api/save_data', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        session_id: SESSION_ID,
        sheet_name: state.activeSheet,
        headers: state.headers,
        data: state.data
      })
    });
  }, 500);
}

// ── Load sheet data ────────────────────────────────
function loadSheetData(res) {
  if (!res || !res.data) return;
  if (!res.__manterOrigemPasta) state.origemPasta = null;
  state.sheets = res.sheets || [];
  state.activeSheet = res.active_sheet || res.sheet_name;
  state.headers = res.data.headers || [];
  state.data = res.data.data || [];
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  state.selectedRows = new Set();
  state.filters = [];
  renderTabs();
  showGridArea();
  const _gs = document.getElementById('grid-scroll');
  if (_gs) _gs.scrollTop = 0;
  renderGrid();
  setStatus(state.activeSheet);
  document.getElementById('filter-rules').innerHTML = '';
  notifyDataChanged('load');
}

function showGridArea() {
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('grid-area').style.display = 'flex';
}

// ── Switch sheet ───────────────────────────────────
async function switchSheet(name) {
  setStatus('Carregando...', 'busy');
  const res = await apiFetch('/api/get_sheet', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ session_id: SESSION_ID, sheet_name: name })
  });
  if (res && res.success) loadSheetData(res);
}

// ── Delete sheet ───────────────────────────────────
async function deleteSheet(name) {
  if (state.sheets.length <= 1) { toast('Não é possível deletar a única planilha', 'error'); return; }
  if (!confirm(`Deletar planilha "${name}"?`)) return;
  const res = await apiFetch('/api/delete_sheet', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ session_id: SESSION_ID, sheet_name: name })
  });
  if (res && res.success) {
    if (res.active_sheet) await switchSheet(res.active_sheet);
    state.sheets = res.sheets;
    renderTabs();
  }
}

// ── Add / Delete rows ──────────────────────────────
function addRow() {
  pushUndo();
  const empty = state.headers.map(() => '');
  state.data.push(empty);
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid();
  saveToServer();
}

function deleteSelectedRows() {
  if (!state.selectedRows.size && state.activeCell.row < 0) return;
  pushUndo();
  const toDelete = state.selectedRows.size
    ? [...state.selectedRows].sort((a,b) => b - a)
    : [state.activeCell.row];
  const display = getDisplayRows();
  toDelete.forEach(ri => {
    const rowRef = display[ri];
    const mainIdx = state.data.indexOf(rowRef);
    if (mainIdx >= 0) state.data.splice(mainIdx, 1);
  });
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  state.selectedRows = new Set();
  renderGrid();
  saveToServer();
  toast(`${toDelete.length} linha(s) deletada(s)`);
}

// ── Add / Delete column ──────────────────────────────
function addColumn() {
  openModal('Nova Coluna', `
    <label>Nome da Coluna</label>
    <input id="new-col-name" type="text" placeholder="Ex: Resistência" autofocus>
  `, () => {
    const name = document.getElementById('new-col-name').value.trim() || `Col ${state.headers.length + 1}`;
    pushUndo();
    state.headers.push(name);
    state.data.forEach(row => row.push(''));
    recomputeFilters();   // mantém o filtro ativo após alterar os dados
    renderGrid();
    saveToServer();
    closeModal();
  });
}

function deletecolumn () {
  const col = state.activeCell.col;
  if (col < 0) { toast('Selecione uma célula primeiro', 'error'); return; }
  if (state.headers.length <= 1) { toast('Não é possível deletar a única coluna', 'error'); return; }
  pushUndo();
  state.headers.splice(col, 1);
  state.data.forEach(row => row.splice(col, 1));
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  state.activeCell = { row: state.activeCell.row, col: Math.max(0, col - 1) };
  renderGrid();
  saveToServer();
  toast('Coluna deletada');
}

// ── File upload ────────────────────────────────────
async function uploadFile(file) {
  // O certificado exportado é um .xls em HTML (relatório, não dado). Evita o
  // erro feio do leitor de Excel se o usuário tentar reabri-lo como planilha.
  if (/\.xlsx?$/i.test(file.name)) {
    try {
      const head = await file.slice(0, 512).text();
      if (/<\s*(html|table|!doctype)/i.test(head)) {
        toast('Esse arquivo é um relatório/certificado exportado (não é uma planilha de dados). Abra-o no Excel.', 'error');
        return;
      }
    } catch (_) {}
  }
  setStatus('Carregando arquivo...', 'busy');
  const fd = new FormData();
  fd.append('file', file);
  fd.append('session_id', SESSION_ID);

  const res = await fetch(API + '/api/upload', { method: 'POST', body: fd }).then(r => r.json()).catch(e => null);
  if (res && res.success) {
    loadSheetData(res);
    markSaved();
    toast(`"${file.name}" carregado`, 'success');
  } else {
    setStatus('Erro ao carregar', 'error');
    toast('Erro ao carregar arquivo: ' + (res && res.error ? res.error : ''), 'error');
  }
}

// ── Import & merge ─────────────────────────────────
async function importMerge(file) {
  if (!state.activeSheet) { toast('Abra uma planilha primeiro', 'error'); return; }
  setStatus('Importando...', 'busy');
  const fd = new FormData();
  fd.append('file', file);
  fd.append('session_id', SESSION_ID);
  fd.append('target_sheet', state.activeSheet);
  fd.append('mode', 'append');

  const res = await fetch(API + '/api/import_merge', { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
  if (res && res.success) {
    state.headers = res.data.headers;
    state.data = res.data.data;
    recomputeFilters();   // mantém o filtro ativo após alterar os dados
    renderGrid();
    saveToServer();
    const novas = res.colunas_novas || [];
    toast(`${res.linhas_add || 0} linha(s) importada(s)` +
      (novas.length ? ` — coluna(s) nova(s): ${novas.join(', ')}` : ''), 'success');
    setStatus(state.activeSheet);
  } else {
    toast('Erro na importação: ' + ((res && res.error) || 'falha'), 'error');
    setStatus('Erro', 'error');
  }
}

// ── Databases: compila uma PASTA inteira de planilhas num único banco ──
async function importFolder(files) {
  // Ignora arquivos temporários/lock do Excel (~$...), ocultos e não-planilhas.
  const list = [...files]
    .filter(f => /\.(xlsx|xls|csv)$/i.test(f.name) && !f.name.startsWith('~') && !f.name.startsWith('.'))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  if (!list.length) { toast('Nenhuma planilha (xlsx/csv) válida na pasta', 'error'); return; }
  let baseLoaded = false, ok = 0; const falhas = [];
  for (let i = 0; i < list.length; i++) {
    setStatus(`Compilando ${i + 1}/${list.length}: ${list[i].name}`, 'busy');
    try {
      const fd = new FormData();
      fd.append('file', list[i]); fd.append('session_id', SESSION_ID);
      if (!baseLoaded) {
        // 1º arquivo válido: carrega (substitui o banco atual)
        const res = await fetch(API + '/api/upload', { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
        if (res && res.success) { loadSheetData(res); baseLoaded = true; ok++; }
        else falhas.push(list[i].name);
      } else {
        // demais: anexa (mescla) no mesmo banco
        fd.append('target_sheet', state.activeSheet); fd.append('mode', 'append');
        const r = await fetch(API + '/api/import_merge', { method: 'POST', body: fd }).then(x => x.json()).catch(() => null);
        if (r && r.success) { state.headers = r.data.headers; state.data = r.data.data; ok++; }
        else falhas.push(list[i].name);
      }
    } catch (_) { falhas.push(list[i].name); }
  }
  if (!baseLoaded) { toast('Nenhum arquivo pôde ser lido', 'error'); setStatus('Erro', 'error'); return; }
  // Marca a origem: o "Recarregar" precisa reler a PASTA inteira, não 1 arquivo.
  state.origemPasta = { qtd: ok, quando: Date.now() };
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid();
  notifyDataChanged('folder');
  toast(`${ok} planilha(s) compiladas · ${state.data.length} linhas` + (falhas.length ? ` · ${falhas.length} ignorada(s)` : ''), falhas.length ? '' : 'success');
  setStatus(state.activeSheet);
}

// ── Filters ────────────────────────────────────────

const FILTER_OPS = [
  { v: 'contém',   l: 'contém'   },
  { v: '!contém',  l: '!contém'  },
  { v: '==',       l: '='        },
  { v: '!=',       l: '≠'        },
  { v: '>',        l: '>'        },
  { v: '>=',       l: '≥'        },
  { v: '<',        l: '<'        },
  { v: '<=',       l: '≤'        },
  { v: 'começa',   l: 'começa'   },
  { v: 'termina',  l: 'termina'  },
  { v: 'regex',    l: 'regex'    },
];

// Tenta parsear uma string como data (YYYY-MM-DD ou DD/MM/YYYY).
// Retorna timestamp (ms) ou null.
function parseDate(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str + 'T00:00:00');
    return isNaN(d) ? null : d.getTime();
  }
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3]) : parseInt(dmy[3]);
    const d = new Date(year, parseInt(dmy[2]) - 1, parseInt(dmy[1]));
    return isNaN(d) ? null : d.getTime();
  }
  return null;
}


function parseNumberBR(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/\s/g,'').replace(/\u00a0/g,'');
  if (!s) return NaN;
  s = s.replace(/[^0-9,\.\-]/g,'');
  if (!s || s === '-' || s === ',' || s === '.') return NaN;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',', '.');
    else s = s.replace(/,/g,'');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}
function extractFckFromRow(row) {
  const cols = ['PRODUTO','RECEITA','NOME','TRAÇO','TRACO'];
  for (const col of cols) {
    const idx = state.headers.findIndex(h => String(h).trim().toUpperCase() === col);
    if (idx >= 0 && row && row[idx] !== undefined) {
      const m = String(row[idx]).toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/);
      if (m) return parseNumberBR(m[1]);
    }
  }
  return NaN;
}
// Resolve o lado direito de um filtro.
// Substitui [Coluna] pelo valor da linha e avalia aritmética quando há referências.
// Datas literais (YYYY-MM-DD, DD/MM/YYYY) NUNCA são avaliadas como aritmética.
// Retorna { num: number|null, raw: string }.
function resolveValExpr(vs, row, headers) {
  let vsTrimmed = String(vs ?? '').trim();
  if (/\{FCK\}/i.test(vsTrimmed)) {
    const fck = extractFckFromRow(row);
    vsTrimmed = vsTrimmed.replace(/\{FCK\}/ig, isNaN(fck) ? '0' : String(fck));
  }

  // 1. Valor literal que é data: retornar bruto imediatamente, sem tentar avaliar.
  if (parseDate(vsTrimmed) !== null) return { num: null, raw: vsTrimmed };

  // 2. Substituir [Coluna] por valor numérico; guardar bruto do primeiro ref.
  let rawFirst = null;
  let hasRef = false;
  const expr = vsTrimmed.replace(/\[([^\]]+)\]/g, (_, colName) => {
    hasRef = true;
    const idx = headers.indexOf(colName);
    const cellVal = idx >= 0 && row ? String(row[idx] ?? '').trim() : '0';
    if (rawFirst === null) rawFirst = cellVal;
    const n = parseNumberBR(cellVal);
    return isNaN(n) ? '0' : String(n);
  });

  // 3. Referência simples [col] sem aritmética: retornar bruto para datas/texto.
  const isBareRef = /^\[([^\]]+)\]$/.test(vsTrimmed);
  if (isBareRef && rawFirst !== null) {
    const n = parseNumberBR(rawFirst);
    return { num: isNaN(n) ? null : n, raw: rawFirst };
  }

  // 4. Expressão aritmética (só avalia se havia pelo menos um [ref]).
  if (hasRef) {
    try {
      if (/[^0-9+\-*/%.\s()eE]/.test(expr)) throw new Error('unsafe');
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result === 'number' && isFinite(result))
        return { num: result, raw: String(result) };
    } catch(_) {}
  }

  // 5. Fallback: string literal.
  return { num: null, raw: vsTrimmed };
}

// Avalia um operador entre célula (string) e expressão de valor.
// Suporta: datas, referência a colunas, expressões aritméticas, texto, regex.
function applyOperator(cellStr, op, valStr, row) {
  const cs = String(cellStr ?? '').trim();
  const vs = String(valStr  ?? '').trim();

  // Conveniência (Naor): "= produto1 & produto2" → igual a QUALQUER um dos valores.
  if ((op === '==' || op === '!=') && vs.includes('&')) {
    const partes = vs.split('&').map(s => s.trim()).filter(Boolean);
    const algum = partes.some(part => {
      const res = resolveValExpr(part, row, state.headers);
      const cn2 = parseNumberBR(cs), vn2 = res.num !== null ? res.num : parseNumberBR(res.raw);
      if (!isNaN(cn2) && !isNaN(vn2)) return cn2 === vn2;
      return cs.toLowerCase() === res.raw.toLowerCase();
    });
    return op === '==' ? algum : !algum;
  }

  const resolved = resolveValExpr(vs, row, state.headers);

  // Comparação de datas — quando o lado direito é data literal ou ref simples
  if (resolved.num === null) {
    const cd = parseDate(cs);
    const vd = parseDate(resolved.raw);
    if (cd !== null && vd !== null) {
      switch (op) {
        case '==': case 'contém':  return cd === vd;
        case '!=': case '!contém': return cd !== vd;
        case '>':  return cd > vd;
        case '>=': return cd >= vd;
        case '<':  return cd < vd;
        case '<=': return cd <= vd;
        default:   return cd === vd;
      }
    }
  }

  // Comparação numérica
  const cn = parseNumberBR(cs);
  const vn = resolved.num !== null ? resolved.num : parseNumberBR(resolved.raw);
  const numOk = !isNaN(cn) && !isNaN(vn);

  switch (op) {
    case '==':      return numOk ? cn === vn : cs.toLowerCase() === resolved.raw.toLowerCase();
    case '!=':      return numOk ? cn !== vn : cs.toLowerCase() !== resolved.raw.toLowerCase();
    case 'contém':  return cs.toLowerCase().includes(resolved.raw.toLowerCase());
    case '!contém': return !cs.toLowerCase().includes(resolved.raw.toLowerCase());
    case 'começa':  return cs.toLowerCase().startsWith(resolved.raw.toLowerCase());
    case 'termina': return cs.toLowerCase().endsWith(resolved.raw.toLowerCase());
    case '>':       return numOk ? cn > vn  : cs.localeCompare(resolved.raw) > 0;
    case '>=':      return numOk ? cn >= vn : cs.localeCompare(resolved.raw) >= 0;
    case '<':       return numOk ? cn < vn  : cs.localeCompare(resolved.raw) < 0;
    case '<=':      return numOk ? cn <= vn : cs.localeCompare(resolved.raw) <= 0;
    case 'regex':
      try { return new RegExp(resolved.raw, 'i').test(cs); }
      catch (_) { _regexRuim = resolved.raw; return false; }
    default:        return cs.toLowerCase().includes(resolved.raw.toLowerCase());
  }
}

function addFilterRule(presetCol) {
  if (!state.headers.length) { toast('Sem dados para filtrar'); return; }

  const uid = Date.now() + '_' + Math.floor(Math.random() * 1e4);
  const col = presetCol && state.headers.includes(presetCol) ? presetCol : null;
  const colOpts = state.headers.map(h => `<option value="${escHtml(h)}" ${h===col?'selected':''}>${escHtml(h)}</option>`).join('');
  const opOpts  = FILTER_OPS.map(o => `<option value="${o.v}" ${col&&o.v==='=='?'selected':''}>${o.l}</option>`).join('');

  // Datalist do campo de valor: com coluna pré-definida, lista os VALORES
  // distintos da coluna (conveniência do Naor); senão, as referências [Coluna].
  let listOpts;
  if (col) {
    const ci = state.headers.indexOf(col);
    const vals = [...new Set(state.data.map(r => String(r[ci] ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 1000);
    listOpts = vals.map(v => `<option value="${escHtml(v)}"></option>`).join('');
  } else {
    listOpts = state.headers.map(h => `<option value="[${escHtml(h)}]">[${escHtml(h)}]</option>`).join('');
  }

  const rule = document.createElement('div');
  rule.className = 'filter-rule';
  rule.innerHTML = `
    <select class="f-col">${colOpts}</select>
    <select class="f-op" style="min-width:90px">${opOpts}</select>
    <input  class="f-val" type="text" list="fref-${uid}" placeholder="${col ? 'Escolha um valor… (use & p/ vários)' : 'Valor ou [Coluna]'}">
    <datalist id="fref-${uid}">${listOpts}</datalist>
    <button class="remove-filter" title="Remover">×</button>`;

  rule.querySelector('.remove-filter').addEventListener('click', () => rule.remove());
  document.getElementById('filter-rules').appendChild(rule);
  return rule;
}

// Abre o painel de filtros e adiciona uma regra já apontando para a coluna,
// com a lista de valores dela (conveniência do right-click no cabeçalho).
function filterByColumn(col) {
  document.getElementById('filter-panel').style.display = 'block';
  const rule = addFilterRule(col);
  const val = rule && rule.querySelector('.f-val');
  if (val) setTimeout(() => val.focus(), 50);
}

// Conveniência "coluna de data": adiciona duas regras (De/Até) com calendário.
function addDateRangeFilter(col) {
  document.getElementById('filter-panel').style.display = 'block';
  [['>=', 'De…'], ['<=', 'Até…']].forEach(([op, ph]) => {
    const rule = addFilterRule(col);
    if (!rule) return;
    rule.querySelector('.f-op').value = op;
    const val = rule.querySelector('.f-val');
    val.type = 'date';
    val.removeAttribute('list');
    val.placeholder = ph;
  });
}

// ── Menu de contexto do cabeçalho ──────────────────
function showHeaderMenu(x, y, col) {
  hideHeaderMenu();
  const menu = document.createElement('div');
  menu.id = 'header-menu';
  menu.className = 'context-menu';
  menu.style.cssText = `left:${x}px;top:${y}px;display:block`;
  menu.innerHTML = `
    <div class="ctx-item" data-a="filter">🔎 Filtrar por “${escHtml(col)}”</div>
    <div class="ctx-item" data-a="select">☑ Seleção on/off…</div>
    <div class="ctx-item" data-a="date">📅 Filtrar por período (datas)</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-a="clear">✕ Limpar filtros</div>`;
  document.body.appendChild(menu);
  menu.querySelector('[data-a="filter"]').onclick = () => { hideHeaderMenu(); filterByColumn(col); };
  menu.querySelector('[data-a="select"]').onclick = () => { hideHeaderMenu(); selectionFilter(col); };
  menu.querySelector('[data-a="date"]').onclick   = () => { hideHeaderMenu(); addDateRangeFilter(col); };
  menu.querySelector('[data-a="clear"]').onclick  = () => { hideHeaderMenu(); clearFilters(); };
  const off = ev => { if (!menu.contains(ev.target)) { hideHeaderMenu(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}
function hideHeaderMenu() { document.getElementById('header-menu')?.remove(); }

// Lista de seleção on/off (Naor): marca quais valores da coluna manter.
// Gera um filtro multivalor "[col] == a & b & c…".
function selectionFilter(col) {
  const ci = state.headers.indexOf(col);
  if (ci < 0) return;
  const vals = [...new Set(state.data.map(r => String(r[ci] ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const body = `
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
      <button id="sel-all" class="secondary-btn" type="button">Todos</button>
      <button id="sel-none" class="secondary-btn" type="button">Nenhum</button>
      <input id="sel-search" class="rec-search-input" placeholder="buscar…" style="flex:1">
      <span id="sel-count" class="status-text"></span>
    </div>
    <div id="sel-list" style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:5px;padding:6px">
      ${vals.map(v => `<label class="rep-col-option" style="display:flex;gap:8px;align-items:center;padding:2px 4px"><input type="checkbox" class="sel-cb" value="${escHtml(v)}" checked> <span>${escHtml(v)}</span></label>`).join('')}
    </div>`;
  openModal(`Seleção on/off — ${escHtml(col)} (${vals.length})`, body, () => {
    const chosen = [...document.querySelectorAll('.sel-cb:checked')].map(c => c.value);
    closeModal();
    if (!chosen.length) { toast('Nada selecionado', 'error'); return; }
    document.getElementById('filter-panel').style.display = 'block';
    const rule = addFilterRule(col);
    if (!rule) return;
    rule.querySelector('.f-op').value = '==';
    rule.querySelector('.f-val').value = chosen.join(' & ');
    applyFilters();
  });
  setTimeout(() => {
    const list = document.getElementById('sel-list');
    const count = document.getElementById('sel-count');
    const upd = () => { count.textContent = `${list.querySelectorAll('.sel-cb:checked').length}/${vals.length}`; };
    list.addEventListener('change', upd); upd();
    document.getElementById('sel-all').onclick  = () => { list.querySelectorAll('.sel-cb').forEach(c => c.checked = true); upd(); };
    document.getElementById('sel-none').onclick = () => { list.querySelectorAll('.sel-cb').forEach(c => c.checked = false); upd(); };
    document.getElementById('sel-search').oninput = e => {
      const q = e.target.value.toLowerCase();
      list.querySelectorAll('.rep-col-option').forEach(l => { l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
  }, 50);
}

function applyFilters() {
  const rules = [...document.querySelectorAll('#filter-rules .filter-rule')].map(r => ({
    col: r.querySelector('.f-col').value,
    op:  r.querySelector('.f-op').value,
    val: r.querySelector('.f-val').value,
  })).filter(r => r.col);

  state.filters = rules;

  if (!rules.length) {
    recomputeFilters();   // mantém o filtro ativo após alterar os dados
    renderGrid();
    return;
  }

  setStatus('Filtrando...', 'busy');

  recomputeFilters(); // filtro ativo mesmo que retorne 0 linhas

  renderGrid();
  setStatus(state.activeSheet);
  toast(`${state.filteredData.length} linha(s) após filtro`);
  notifyDataChanged('filter');
}

function clearFilters() {
  state.filters = [];
  state.filteredData = []; state.filterActive = false;
  document.getElementById('filter-rules').innerHTML = '';
  renderGrid();
  toast('Filtros removidos');
  notifyDataChanged('clear-filter');
}

// ── Export ─────────────────────────────────────────
async function exportData(fmt) {
  if (!state.activeSheet) { toast('Nenhuma planilha ativa', 'error'); return; }

  // O botão Relatório deve abrir o relatório técnico novo, não o relatório HTML antigo do backend.
  // Isso mantém o comportamento esperado pelo Naor: ver/filtrar o relatório dentro do app.
  if (fmt === 'report') {
    notifyDataChanged('open-report');
    if (window.ConcrestatsOpenModule) {
      window.ConcrestatsOpenModule('relatorio');
      toast('Relatório técnico aberto', 'success');
    } else {
      const relBtn = document.querySelector('.nav-btn[data-module="relatorio"]');
      if (relBtn) relBtn.click();
    }
    return;
  }

  const display = state.filterActive ? state.filteredData : null;
  setStatus('Exportando...', 'busy');

  await enviarPendencias();
  const res = await fetch(API + '/api/export', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      session_id: SESSION_ID,
      sheet_name: state.activeSheet,
      format: fmt,
      filtered_data: display
    })
  });

  if (res.ok) {
    const blob = await res.blob();
    const ext = fmt === 'report' ? 'html' : fmt;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.activeSheet}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exportado como ${ext.toUpperCase()}`, 'success');
  } else {
    toast('Erro ao exportar', 'error');
  }
  setStatus(state.activeSheet);
}

// ── New sheet ──────────────────────────────────────
async function newSheet(name) {
  const res = await apiFetch('/api/new_sheet', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ session_id: SESSION_ID, sheet_name: name || 'Nova Planilha' })
  });
  if (res && res.success) {
    loadSheetData(res);
    toast(`Planilha "${res.sheet_name}" criada`);
  }
}

// ── Context menu ───────────────────────────────────
function showContextMenu(x, y) {
  const cm = document.getElementById('context-menu');
  cm.style.display = 'block';
  cm.style.left = x + 'px';
  cm.style.top = y + 'px';
}
function hideContextMenu() {
  document.getElementById('context-menu').style.display = 'none';
}

// ── Save ───────────────────────────────────────────
// Indicador de alterações não salvas no botão Salvar.
function markDirty() { document.getElementById('btn-save-file')?.classList.add('dirty'); }
function markSaved() { document.getElementById('btn-save-file')?.classList.remove('dirty'); }

// A gravacao no servidor e' adiada meio segundo. Toda operacao que roda no
// SERVIDOR (salvar, cruzar, recarregar, exportar) precisa da versao atual —
// sem isto, editar uma celula e clicar em Salvar gravava o valor ANTIGO.
async function enviarPendencias() {
  if (!_saveEmEspera || !state.activeSheet) return;
  clearTimeout(_saveTimer);
  _saveEmEspera = false;
  await apiFetch('/api/save_data', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      session_id: SESSION_ID,
      sheet_name: state.activeSheet,
      headers: state.headers,
      data: state.data
    })
  });
}

let _salvandoAgora = false;

async function saveFile() {
  if (!state.activeSheet) { toast('Nenhuma planilha ativa', 'error'); return; }
  if (document.body.classList.contains('modo-web')) {
    toast('Na versão web use Exportar (Excel/CSV) para baixar o arquivo', 'error');
    return;
  }
  if (_salvandoAgora) return;            // clique duplo em planilha grande
  _salvandoAgora = true;
  setStatus('Salvando...', 'busy');
  await enviarPendencias();
  const post = body => apiFetch('/api/save_file', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  let res = await post({ session_id: SESSION_ID, sheet_name: state.activeSheet });

  // Sem arquivo de origem (planilha criada do zero) OU arquivo aberto por
  // arrastar (o app so' tem uma copia): pergunta onde gravar, em vez de
  // gravar escondido numa copia e dizer que salvou.
  const pedeDestino = res && !res.success &&
      (res.precisa_destino || /sem arquivo de origem/i.test(res.error || ''));
  if (pedeDestino && window.pywebview?.api?.save_file_dialog) {
    try {
      if (res.precisa_destino) toast('Escolha onde gravar este arquivo', 'info');
      const path = await window.pywebview.api.save_file_dialog(
        (window.__concreNomeArquivo || state.activeSheet || 'planilha')
          .replace(/\.(xlsx|xls|csv)$/i, '') + '.xlsx');
      if (!path) { setStatus('Pronto'); _salvandoAgora = false; return; } // cancelou
      res = await post({ session_id: SESSION_ID, sheet_name: state.activeSheet, path });
    } catch (_) { /* mantém o res original */ }
  }

  if (res && res.success) {
    markSaved();
    if (res.path) registrarRecente(res.path);
    const nome = res.path ? String(res.path).split(/[\\\/]/).pop() : 'arquivo';
    toast(`Salvo em "${nome}"`, 'success');
    setStatus(state.activeSheet);
  } else {
    toast('Erro: ' + (res && res.error ? res.error : 'falha ao salvar'), 'error');
    setStatus('Erro', 'error');
  }
  _salvandoAgora = false;
}

// ── Modal ──────────────────────────────────────────
function openModal(title, bodyHtml, onConfirm, classe) {
  const caixa = document.getElementById('modal-box');
  if (caixa) caixa.className = 'modal-box' + (classe ? ' ' + classe : '');
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <span>${title}</span>
      <button onclick="closeModal()" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:16px">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">
      <button class="secondary-btn" onclick="closeModal()">Cancelar</button>
      <button class="primary-btn" id="modal-confirm">Confirmar</button>
    </div>
  `;
  document.getElementById('modal-confirm').addEventListener('click', onConfirm);
  document.getElementById('modal-overlay').style.display = 'flex';
  const firstInput = document.querySelector('#modal-content input');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  const caixa = document.getElementById('modal-box');
  if (caixa) caixa.className = 'modal-box';
}
// Esc fecha o modal aberto (atalho de produtividade).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('modal-overlay');
  if (ov && ov.style.display !== 'none' && ov.style.display !== '') closeModal();
});

// ── Column resize ──────────────────────────────────
function initColResize() {
  document.querySelectorAll('.col-resize').forEach(handle => {
    let startX, startWidth, th;
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      th = handle.closest('th');
      startX = e.pageX;
      startWidth = th.offsetWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    function onMouseMove(e) {
      const newW = Math.max(50, startWidth + (e.pageX - startX));
      th.style.minWidth = newW + 'px';
      th.style.width = newW + 'px';
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  });
}

// ── Highlight selected rows ────────────────────────
function highlightSelectedRows() {
  document.querySelectorAll('#table-body tr').forEach(tr => {
    const ri = parseInt(tr.dataset.row);
    tr.classList.toggle('selected', state.selectedRows.has(ri));
  });
  document.getElementById('selection-info').textContent =
    state.selectedRows.size ? `${state.selectedRows.size} linha(s) selecionada(s)` : '';
}

// ── Keyboard shortcuts ─────────────────────────────
document.addEventListener('keydown', e => {
  // Não intercepta digitação em campos (inputs/modais/outros módulos):
  // sem isso, Delete numa busca apagava célula do grid e Ctrl+V colava linhas.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  // Atalhos do grid só valem com o módulo Planilhas visível.
  const appEl = document.getElementById('app');
  if (appEl && appEl.style.display === 'none') return;

  // Ctrl+Z — undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault(); redo(); return;
  }

  // Ctrl+C — copy selected rows
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    const display = getDisplayRows();
    if (state.selectedRows.size) {
      state.clipboard = { rows: [...state.selectedRows].sort().map(i => [...display[i]]) };
      toast(`${state.clipboard.rows.length} linha(s) copiadas`);
    } else if (state.activeCell.row >= 0) {
      const val = display[state.activeCell.row][state.activeCell.col];
      navigator.clipboard.writeText(String(val || '')).catch(() => {});
    }
    return;
  }

  // Ctrl+V — paste
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (state.clipboard) {
      pushUndo();
      state.clipboard.rows.forEach(row => state.data.push([...row]));
      recomputeFilters();   // mantém o filtro ativo após alterar os dados
      renderGrid();
      saveToServer();
      toast(`${state.clipboard.rows.length} linha(s) coladas`);
    }
    return;
  }

  if (state.isEditing) return;

  const { row, col } = state.activeCell;

  if (e.key === 'ArrowDown' && row >= 0) {
    e.preventDefault();
    const display = getDisplayRows();
    if (row + 1 < display.length) selectCell(row + 1, col);
  }
  if (e.key === 'ArrowUp' && row > 0) { e.preventDefault(); selectCell(row - 1, col); }
  if (e.key === 'ArrowRight' && col >= 0) { e.preventDefault(); selectCell(row, col + 1); }
  if (e.key === 'ArrowLeft' && col > 0) { e.preventDefault(); selectCell(row, col - 1); }

  if ((e.key === 'F2' || e.key === 'Enter') && row >= 0) {
    e.preventDefault();
    startEditing(row, col);
  }

  if (e.key === 'Delete' && row >= 0) {
    pushUndo();
    setDataCell(row, col, '');
    updateCellDOM(row, col, '');
    saveToServer();
  }
});

// Formula bar apply
document.getElementById('formula-apply').addEventListener('click', () => {
  const val = document.getElementById('formula-input').value;
  const { row, col } = state.activeCell;
  if (row < 0 || col < 0) return;
  pushUndo();
  setDataCell(row, col, val);
  renderGrid();
  saveToServer();
});

document.getElementById('formula-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('formula-apply').click();
});

// ── UI wiring ──────────────────────────────────────

document.getElementById('btn-save-file').addEventListener('click', saveFile);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

// App nativo: diálogo do Windows entrega o caminho REAL → Salvar grava no
// próprio arquivo. No navegador, cai no <input type=file> de sempre.
async function abrirArquivoNativo() {
  try {
    if (window.pywebview?.api?.open_file_dialog) {
      const path = await window.pywebview.api.open_file_dialog();
      if (!path) return; // cancelou
      setStatus('Carregando arquivo...', 'busy');
      const res = await apiFetch('/api/load_path', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ session_id: SESSION_ID, path })
      });
      if (res && res.success) {
        loadSheetData(res);
        markSaved();
        window.__concreSourcePath = res.path || path;
        registrarRecente(res.path || path);   // sem isto a lista de recentes ficava sempre vazia
        toast(`"${String(path).split(/[\\\/]/).pop()}" carregado`, 'success');
      } else {
        toast('Erro: ' + (res && res.error ? res.error : 'falha ao abrir'), 'error');
        setStatus('Erro', 'error');
      }
      return;
    }
  } catch (_) { /* sem pywebview → fallback abaixo */ }
  document.getElementById('file-input').click();
}
document.getElementById('btn-upload').addEventListener('click', abrirArquivoNativo);
document.getElementById('btn-upload-empty').addEventListener('click', abrirArquivoNativo);

// ── Adicionar outro arquivo como novas abas ────────
// (Abrir substitui a sessão; Adicionar preserva as planilhas já abertas —
//  é o que permite cruzar dados de arquivos diferentes.)
async function adicionarArquivo(file) {
  setStatus('Adicionando arquivo...', 'busy');
  let res;
  if (!file && window.pywebview?.api?.open_file_dialog) {
    const path = await window.pywebview.api.open_file_dialog();
    if (!path) { setStatus(state.activeSheet || 'Pronto'); return; }
    res = await apiFetch('/api/load_path', { method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ session_id: SESSION_ID, path, mode: 'add' }) });
  } else {
    if (!file) { document.getElementById('addfile-input').click(); return; }
    const fd = new FormData();
    fd.append('file', file); fd.append('session_id', SESSION_ID); fd.append('mode', 'add');
    res = await fetch(API + '/api/upload', { method: 'POST', body: fd })
      .then(r => r.json()).catch(() => null);
  }
  if (res && res.success) {
    loadSheetData(res);
    toast(`Arquivo adicionado — agora são ${res.sheets.length} planilha(s)`, 'success');
  } else {
    toast('Erro: ' + (res && res.error ? res.error : 'falha ao adicionar'), 'error');
    setStatus('Erro', 'error');
  }
}
document.getElementById('btn-add-file').addEventListener('click', () => adicionarArquivo());
document.getElementById('addfile-input').addEventListener('change', e => {
  if (e.target.files[0]) adicionarArquivo(e.target.files[0]);
  e.target.value = '';
});

// ── Cruzar planilhas (PROCV automático) ────────────
async function abrirModalJoin() {
  const info = await apiFetch('/api/sheets_info', { method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ session_id: SESSION_ID }) });
  const names = info && info.success ? Object.keys(info.sheets || {}) : [];
  if (names.length < 2) {
    toast('Para cruzar são necessárias 2 planilhas. Use "Adicionar" para abrir outro arquivo sem perder este.', 'error');
    return;
  }
  const A = state.activeSheet && names.includes(state.activeSheet) ? state.activeSheet : names[0];
  const selOpts = (arr, cur) => arr.map(n => `<option ${n === cur ? 'selected' : ''}>${escHtml(n)}</option>`).join('');

  // O nome "cruzar" nao dizia nada para quem usa. Agora o modal explica em
  // portugues o que vai acontecer, mostra um exemplo e faz uma PREVIA de
  // quantas linhas vao casar antes de confirmar.
  openModal('Trazer colunas de outra planilha', `
    <div class="jn-ajuda">
      <b>O que isto faz:</b> procura cada linha desta planilha na outra, usando uma
      coluna em comum, e traz as informações que faltam.
      <div class="jn-exemplo">
        Exemplo: sua planilha tem <b>CLIENTE</b>; a outra tem <b>CLIENTE</b> e <b>REGIÃO</b>.
        Cruzando pelo CLIENTE, a REGIÃO entra na sua planilha.
      </div>
    </div>
    <label>1. Planilha que vai RECEBER as colunas</label><select id="jn-a">${selOpts(names, A)}</select>
    <label>2. Planilha que vai FORNECER as colunas</label><select id="jn-b">${selOpts(names, names.find(n => n !== A) || names[0])}</select>
    <label>3. Coluna em comum entre as duas</label>
    <div class="jn-chaves">
      <div><span>nesta</span><select id="jn-ka"></select></div>
      <div class="jn-igual">=</div>
      <div><span>na outra</span><select id="jn-kb"></select></div>
    </div>
    <div id="jn-previa" class="jn-previa">conferindo...</div>
    <label>4. O que trazer <span id="jn-cont" class="jn-cont"></span></label>
    <div id="jn-cols" class="jn-cols"></div>
    <label>5. Onde colocar o resultado</label>
    <select id="jn-dest">
      <option value="nova">Numa planilha nova (não mexe na atual)</option>
      <option value="atual">Acrescentar as colunas nesta mesma planilha</option>
    </select>
  `, executarJoin, 'modal-join');

  const previa = async () => {
    const el = document.getElementById('jn-previa');
    if (!el) return;
    const a = document.getElementById('jn-a').value, b = document.getElementById('jn-b').value;
    const ka = document.getElementById('jn-ka').value, kb = document.getElementById('jn-kb').value;
    if (a === b) { el.className = 'jn-previa aviso'; el.textContent =
      'Escolha duas planilhas diferentes.'; return; }
    el.className = 'jn-previa'; el.textContent = 'conferindo...';
    try {
      const r = await apiFetch('/api/join_preview', { method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ session_id: SESSION_ID, left_sheet: a, right_sheet: b,
                               left_key: ka, right_key: kb }) });
      if (!r || !r.success) { el.className = 'jn-previa aviso'; el.textContent = (r && r.error) || 'não consegui conferir'; return; }
      const pct = r.total ? Math.round(r.matched / r.total * 100) : 0;
      el.className = 'jn-previa ' + (pct === 0 ? 'aviso' : pct < 60 ? 'meio' : 'bom');
      el.textContent = pct === 0
        ? 'Nenhuma linha casou por estas colunas — provavelmente não são a mesma informação.'
        : `${r.matched} de ${r.total} linhas encontram par (${pct}%)` +
          (r.exemplo ? ` · ex.: "${r.exemplo}"` : '') +
          (pct < 100 ? '. As demais ficam em branco, sem sumir.' : '');
    } catch (e) { el.className = 'jn-previa aviso'; el.textContent = 'não consegui conferir'; }
  };

  const fill = () => {
    const a = document.getElementById('jn-a').value, b = document.getElementById('jn-b').value;
    const ha = info.sheets[a] || [], hb = info.sheets[b] || [];
    const guess = ha.find(h => hb.includes(h));
    document.getElementById('jn-ka').innerHTML = selOpts(ha, guess || ha[0]);
    document.getElementById('jn-kb').innerHTML = selOpts(hb, guess || hb[0]);
    const chave = document.getElementById('jn-kb').value;
    document.getElementById('jn-cols').innerHTML = hb.filter(h => h !== chave).map(h =>
      `<label class="jn-col"><input type="checkbox" value="${escHtml(h)}"> ${escHtml(h)}</label>`).join('')
      || '<p class="jn-vazio">A outra planilha não tem outras colunas para trazer.</p>';
    document.getElementById('jn-cols').addEventListener('change', contar);
    contar();
    previa();
  };
  const contar = () => {
    const n = document.querySelectorAll('#jn-cols input:checked').length;
    const el = document.getElementById('jn-cont');
    if (el) el.textContent = n ? `(${n} selecionada${n > 1 ? 's' : ''})` : '(marque ao menos uma)';
  };
  document.getElementById('jn-a').addEventListener('change', fill);
  document.getElementById('jn-b').addEventListener('change', fill);
  document.getElementById('jn-ka').addEventListener('change', previa);
  document.getElementById('jn-kb').addEventListener('change', () => { fill(); });
  fill();
}
async function executarJoin() {
  const g = id => document.getElementById(id).value;
  const cols = [...document.querySelectorAll('#jn-cols input:checked')].map(i => i.value);
  if (!cols.length) { toast('Escolha ao menos uma coluna para trazer', 'error'); return; }
  setStatus('Cruzando...', 'busy');
  await enviarPendencias();
  const res = await apiFetch('/api/join_sheets', { method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ session_id: SESSION_ID, left_sheet: g('jn-a'), right_sheet: g('jn-b'),
      left_key: g('jn-ka'), right_key: g('jn-kb'), columns: cols, destino: g('jn-dest') }) });
  if (res && res.success) {
    closeModal(); loadSheetData(res); markDirty();
    toast(`Cruzamento concluído: ${res.matched} de ${res.total} linhas casaram`, 'success');
  } else {
    toast('Erro: ' + (res && res.error ? res.error : 'falha no cruzamento'), 'error');
    setStatus('Erro', 'error');
  }
}
document.getElementById('btn-join').addEventListener('click', abrirModalJoin);

// ── Recarregar do arquivo de origem ("Atualizar tudo") ──
async function recarregarDoArquivo() {
  // Planilha vinda de uma PASTA compilada: reler 1 arquivo daria dados errados
  // (só o último). Pede a pasta de novo e recompila tudo.
  if (state.origemPasta) {
    if (!confirm(`Esta planilha foi compilada de uma pasta (${state.origemPasta.qtd} arquivos).
` +
                 'Para atualizar, escolha a pasta novamente. Continuar?')) return false;
    document.getElementById('folder-input').click();
    return false;
  }
  if (!confirm('Recarregar do arquivo de origem? Alterações não salvas serão perdidas.')) return false;
  setStatus('Recarregando...', 'busy');
  await enviarPendencias();
  const res = await apiFetch('/api/reload', { method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ session_id: SESSION_ID }) });
  if (res && res.success) {
    loadSheetData(res); markSaved();
    if (res.path) window.__concreSourcePath = res.path;
    toast('Dados recarregados do arquivo', 'success');
    return true;
  }
  toast('Erro: ' + (res && res.error ? res.error : 'sem arquivo de origem'), 'error');
  setStatus('Erro', 'error');
  return false;
}
document.getElementById('btn-reload').addEventListener('click', recarregarDoArquivo);
window.ConcrestatsReload = recarregarDoArquivo;
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('btn-import-merge').addEventListener('click', () => {
  if (!state.activeSheet) { toast('Abra uma planilha antes de importar', 'error'); return; }
  document.getElementById('import-input').click();
});
document.getElementById('import-input').addEventListener('change', e => {
  if (e.target.files[0]) importMerge(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('btn-databases').addEventListener('click', () => document.getElementById('folder-input').click());
document.getElementById('folder-input').addEventListener('change', e => {
  if (e.target.files && e.target.files.length) importFolder(e.target.files);
  e.target.value = '';
});

document.getElementById('btn-new-sheet').addEventListener('click', () => {
  openModal('Nova Planilha', `
    <label>Nome da Planilha</label>
    <input id="new-sheet-name" type="text" placeholder="Ex: Corpos de Prova" autofocus>
  `, () => {
    const n = document.getElementById('new-sheet-name').value.trim();
    closeModal();
    newSheet(n);
  });
});
document.getElementById('btn-new-sheet-tab').addEventListener('click', () => document.getElementById('btn-new-sheet').click());
document.getElementById('btn-new-empty').addEventListener('click', () => document.getElementById('btn-new-sheet').click());

document.getElementById('btn-add-row').addEventListener('click', addRow);
document.getElementById('btn-del-row').addEventListener('click', deleteSelectedRows);
document.getElementById('btn-add-col').addEventListener('click', addColumn);
document.getElementById('btn-del-col').addEventListener('click', () => {
  const col = state.activeCell.col;
  if (col < 0) { toast('Selecione uma célula primeiro', 'error'); return; }
  if (state.headers.length <= 1) { toast('Não é possível deletar a única coluna', 'error'); return; }
  pushUndo();
  state.headers.splice(col, 1);
  state.data.forEach(row => row.splice(col, 1));
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  state.activeCell = { row: state.activeCell.row, col: Math.max(0, col - 1) };
  renderGrid();
  saveToServer();
  toast('Coluna deletada');
});

document.getElementById('btn-filter').addEventListener('click', () => {
  const p = document.getElementById('filter-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('btn-close-filter').addEventListener('click', () => {
  document.getElementById('filter-panel').style.display = 'none';
});
document.getElementById('btn-add-filter-rule').addEventListener('click', () => {
  if (!state.headers.length) { toast('Sem dados para filtrar'); return; }
  addFilterRule();
});
document.getElementById('btn-apply-filters').addEventListener('click', applyFilters);
document.getElementById('btn-clear-filter').addEventListener('click', clearFilters);

document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', () => exportData(btn.dataset.fmt));
});

document.getElementById('ctx-insert-above').addEventListener('click', () => {
  pushUndo();
  const empty = state.headers.map(() => '');
  state.data.splice(state.contextRow, 0, empty);
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid(); saveToServer(); hideContextMenu();
});
document.getElementById('ctx-insert-below').addEventListener('click', () => {
  pushUndo();
  const empty = state.headers.map(() => '');
  state.data.splice(state.contextRow + 1, 0, empty);
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid(); saveToServer(); hideContextMenu();
});
document.getElementById('ctx-delete-row').addEventListener('click', () => {
  pushUndo();
  state.data.splice(state.contextRow, 1);
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid(); saveToServer(); hideContextMenu();
});
document.getElementById('ctx-copy-row').addEventListener('click', () => {
  const display = getDisplayRows();
  state.clipboard = { rows: [[...display[state.contextRow]]] };
  toast('Linha copiada'); hideContextMenu();
});
document.getElementById('ctx-paste-row').addEventListener('click', () => {
  if (!state.clipboard) return;
  pushUndo();
  state.clipboard.rows.forEach(r => state.data.splice(state.contextRow + 1, 0, [...r]));
  recomputeFilters();   // mantém o filtro ativo após alterar os dados
  renderGrid(); saveToServer(); hideContextMenu();
  toast('Linha colada');
});

document.addEventListener('click', e => {
  if (!e.target.closest('#context-menu')) hideContextMenu();
});

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !/\.(xlsx|xls|csv)$/i.test(file.name)) return;
  window.__concreNomeArquivo = file.name;
  uploadFile(file);
  // O Windows nao entrega o caminho de um arquivo arrastado, entao o app fica
  // com uma copia. Melhor avisar agora do que na hora de salvar.
  if (window.pywebview?.api?.open_file_dialog) {
    setTimeout(() => toast('Arrastado: o app está com uma cópia. Ao salvar, ele vai '
      + 'perguntar onde gravar. Para editar o original, use Abrir.', 'info'), 900);
  }
});

// ── Busca na planilha (Ctrl+F) ─────────────────────
// Percorre as células visíveis (respeita o filtro) e navega entre as ocorrências.
const busca = { termo: '', hits: [], i: -1 };
function abrirBusca() {
  const bar = document.getElementById('find-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  const inp = document.getElementById('find-input');
  inp.focus(); inp.select();
}
function fecharBusca() {
  const bar = document.getElementById('find-bar');
  if (bar) bar.style.display = 'none';
  busca.termo = ''; busca.hits = []; busca.i = -1;
  try { renderGrid(); } catch (_) {}      // limpa o realce
}
function calcularBusca() {
  const t = (document.getElementById('find-input').value || '').trim().toLowerCase();
  busca.termo = t; busca.hits = []; busca.i = -1;
  if (t) {
    const rows = getDisplayRows();
    for (let r = 0; r < rows.length; r++) {
      const linha = rows[r] || [];
      for (let c = 0; c < linha.length; c++) {
        if (String(linha[c] ?? '').toLowerCase().includes(t)) busca.hits.push({ r, c });
      }
    }
  }
  atualizarContadorBusca();
}
function atualizarContadorBusca() {
  const el = document.getElementById('find-count');
  if (!el) return;
  el.textContent = !busca.termo ? '—'
    : busca.hits.length ? `${busca.i + 1} de ${busca.hits.length}` : 'nada encontrado';
}
function irBusca(passo) {
  if (!busca.hits.length) return;
  busca.i = (busca.i + passo + busca.hits.length) % busca.hits.length;
  const h = busca.hits[busca.i];
  selectCell(h.r, h.c);
  atualizarContadorBusca();
}
(function ligarBusca() {
  const inp = document.getElementById('find-input');
  if (!inp) return;
  inp.addEventListener('input', () => { calcularBusca(); renderGrid(); irBusca(1); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); irBusca(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); fecharBusca(); }
  });
  document.getElementById('find-next').addEventListener('click', () => irBusca(1));
  document.getElementById('find-prev').addEventListener('click', () => irBusca(-1));
  document.getElementById('find-close').addEventListener('click', fecharBusca);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const app = document.getElementById('app');
      if (app && app.style.display === 'none') return;  // só na aba Planilhas
      e.preventDefault(); abrirBusca();
    }
  });
})();

// ── Arquivos recentes ──────────────────────────────
// Guarda os últimos arquivos abertos (caminho real) em prefs.json.
let _recentes = [];
function carregarRecentes() {
  window.prefsGet().then(p => {
    if (p && Array.isArray(p.recentes)) _recentes = p.recentes;
    renderRecentes();
  }).catch(() => {});
}
function registrarRecente(path) {
  if (!path) return;
  const nome = (() => { const t = String(path); const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/')); return i >= 0 ? t.slice(i + 1) : t; })();
  _recentes = [{ path, nome, quando: new Date().toISOString() }]
    .concat(_recentes.filter(r => r.path !== path)).slice(0, 8);
  try {
    fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentes: _recentes }) });
  } catch (_) {}
  renderRecentes();
}
function renderRecentes() {
  const box = document.getElementById('recentes-box');
  const lista = document.getElementById('recentes-lista');
  if (!box || !lista) return;
  if (!_recentes.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  // Deriva o nome do caminho na hora (entradas antigas podem ter nome errado).
  const soNome = v => { const t = String(v || ''); const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/')); return i >= 0 ? t.slice(i + 1) : t; };
  lista.innerHTML = _recentes.map((r, i) =>
    `<div class="recente-item" data-i="${i}" title="${escHtml(r.path)}">
       <span class="recente-nome">${escHtml(soNome(r.path))}</span>
       <span class="recente-path">${escHtml(r.path)}</span>
     </div>`).join('');
  lista.querySelectorAll('.recente-item').forEach(el => {
    el.addEventListener('click', async () => {
      const rec = _recentes[parseInt(el.dataset.i)];
      setStatus('Abrindo...', 'busy');
      const res = await apiFetch('/api/load_path', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, path: rec.path }) });
      if (res && res.success) {
        loadSheetData(res); markSaved();
        window.__concreSourcePath = res.path || rec.path;
        registrarRecente(rec.path);
        toast(`"${rec.nome}" carregado`, 'success');
      } else {
        toast('Não foi possível abrir (o arquivo foi movido?)', 'error');
        setStatus('Erro', 'error');
        _recentes = _recentes.filter(x => x.path !== rec.path);
        try { fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recentes: _recentes }) }); } catch (_) {}
        renderRecentes();
      }
    });
  });
}
document.addEventListener('DOMContentLoaded', carregarRecentes);

// ── Modo web x aplicativo instalado ────────────────
// Na web, cada pessoa tem suas próprias preferências (cookie) e os recursos
// que mexem no disco do servidor ficam escondidos.
(function ambiente() {
  try {
    let uid = localStorage.getItem('concre_uid');
    if (!uid) {
      uid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('concre_uid', uid);
    }
    document.cookie = 'concre_uid=' + uid + ';path=/;max-age=31536000;SameSite=Lax';
  } catch (_) {}
  fetch('/api/ambiente').then(r => r.ok ? r.json() : null).then(a => {
    if (!a || !a.web) return;                 // aplicativo instalado: nada muda
    document.body.classList.add('modo-web');
    ['btn-save-file', 'btn-reload'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const rec = document.getElementById('recentes-box');
    if (rec) rec.style.display = 'none';      // caminhos locais não valem na web
    const st = document.getElementById('status-text');
    if (st) st.textContent = 'Versão web';
  }).catch(() => {});
})();

// ── Regras de cor (formatação condicional) ─────────
function abrirModalCores() {
  if (!state.headers.length) { toast('Abra uma planilha primeiro', 'error'); return; }
  const opsHtml = FILTER_OPS.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
  const colsHtml = state.headers.map(h => `<option value="${escHtml(h)}">${escHtml(h)}</option>`).join('');
  const coresHtml = [['vermelho','Vermelho'],['verde','Verde'],['amarelo','Amarelo'],['azul','Azul']]
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  openModal('Regras de cor', `
    <p class="rc-dica">Pinta a célula quando a regra for verdadeira. No valor dá para usar
      <b>[Outra Coluna]</b> — por exemplo <b>MPA 28</b> <b>&lt;</b> <b>[FCK]</b> deixa o reprovado em vermelho.</p>
    <div id="rc-lista"></div>
    <button type="button" id="rc-add" class="rc-add">+ regra</button>
  `, () => {
    state.regrasCor = [...document.querySelectorAll('#rc-lista .regra-cor-row')].map(d => ({
      col: d.querySelector('.rc-col').value,
      op:  d.querySelector('.rc-op').value,
      val: d.querySelector('.rc-val').value,
      cor: d.querySelector('.rc-cor').value,
    })).filter(r => r.col && r.val !== '');
    salvarPrefsGrid();
    renderGrid();
    closeModal();
    toast(state.regrasCor.length ? `${state.regrasCor.length} regra(s) aplicada(s)` : 'Regras removidas', 'success');
  });

  const linha = (r = {}) => {
    const d = document.createElement('div');
    d.className = 'regra-cor-row';
    d.innerHTML = `<select class="rc-col">${colsHtml}</select>
      <select class="rc-op" style="max-width:110px">${opsHtml}</select>
      <input class="rc-val" placeholder="valor ou [Coluna]">
      <select class="rc-cor" style="max-width:110px">${coresHtml}</select>
      <button type="button" class="rc-del" title="Remover">×</button>`;
    if (r.col) d.querySelector('.rc-col').value = r.col;
    if (r.op)  d.querySelector('.rc-op').value = r.op;
    if (r.val !== undefined) d.querySelector('.rc-val').value = r.val;
    if (r.cor) d.querySelector('.rc-cor').value = r.cor;
    d.querySelector('.rc-del').addEventListener('click', () => d.remove());
    return d;
  };
  setTimeout(() => {
    const box = document.getElementById('rc-lista');
    if (!box) return;
    (state.regrasCor.length ? state.regrasCor : [{}]).forEach(r => box.appendChild(linha(r)));
    document.getElementById('rc-add').addEventListener('click', () => box.appendChild(linha()));
  }, 30);
}
document.getElementById('btn-cores')?.addEventListener('click', abrirModalCores);

// ── Congelar colunas ───────────────────────────────
document.getElementById('btn-congelar')?.addEventListener('click', () => {
  if (!state.headers.length) { toast('Abra uma planilha primeiro', 'error'); return; }
  const max = Math.min(3, state.headers.length);
  state.congelarCols = (state.congelarCols + 1) % (max + 1);   // 0 → 1 → 2 → 3 → 0
  salvarPrefsGrid();
  renderGrid();
  const btn = document.getElementById('btn-congelar');
  if (btn) btn.classList.toggle('ativo', state.congelarCols > 0);
  if (!state.congelarCols) { toast('Colunas descongeladas'); return; }
  const nomes = state.headers.slice(0, state.congelarCols).join(', ');
  // Sem coluna fora da tela nao ha' o que congelar — e' o caso em que o botao
  // parece nao fazer nada. Melhor dizer isso do que deixar no ar.
  const sc = document.getElementById('grid-scroll');
  const rolaDeLado = sc && sc.scrollWidth > sc.clientWidth + 4;
  toast(rolaDeLado
    ? `${nomes} ficam fixas ao rolar para o lado`
    : `${nomes} marcadas. Esta planilha cabe inteira na tela, então o efeito só `
      + `aparece quando houver coluna fora dela (ou com a janela menor).`,
    rolaDeLado ? 'success' : 'info');
});

// Posiciona as colunas congeladas (o "left" depende da largura das anteriores).
function posicionarColunasFixas() {
  if (!state.congelarCols) return;
  const head = document.querySelector('#data-table thead tr');
  if (!head) return;
  const larguras = [];
  let acumulado = head.children[0]?.offsetWidth || 40;   // coluna do número
  for (let i = 0; i < state.congelarCols; i++) {
    larguras.push(acumulado);
    acumulado += head.children[i + 1]?.offsetWidth || 0;
  }
  document.querySelectorAll('#data-table .col-fixa').forEach(el => {
    const ci = parseInt(el.dataset.col);
    if (!isNaN(ci) && larguras[ci] !== undefined) el.style.left = larguras[ci] + 'px';
  });
  // a coluna do número também acompanha
  document.querySelectorAll('#data-table .row-num').forEach(el => {
    el.style.position = 'sticky'; el.style.left = '0'; el.style.zIndex = '6';
  });
}

// Carrega preferências do grid salvas (cores + congelamento).
document.addEventListener('DOMContentLoaded', () => {
  window.prefsGet().then(p => {
    if (p && p.grid) {
      state.congelarCols = p.grid.congelarCols || 0;
      const bc = document.getElementById('btn-congelar');
      if (bc) bc.classList.toggle('ativo', state.congelarCols > 0);
      state.regrasCor = Array.isArray(p.grid.regrasCor) ? p.grid.regrasCor : [];
      if (state.headers.length) renderGrid();
    }
  }).catch(() => {});
});

// Lista de recentes acessivel de qualquer lugar (a tela inicial some assim
// que uma planilha e aberta, entao os recentes ficavam invisiveis).
function abrirModalRecentes() {
  const soNome = v => { const t = String(v || ''); const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/')); return i >= 0 ? t.slice(i + 1) : t; };
  if (!_recentes.length) {
    openModal('Arquivos recentes',
      '<p style="font-size:12px;color:var(--text-2);line-height:1.6;margin:0">' +
      'Ainda nao ha nenhum. Assim que voce abrir uma planilha pelo botao <b>Abrir</b>, ' +
      'ela passa a aparecer aqui — e continua aparecendo depois de fechar o app.<br><br>' +
      'Arquivo arrastado para a janela nao entra na lista: o Windows nao informa onde ' +
      'ele esta.</p>', () => closeModal());
    return;
  }
  const html = '<div class="recentes-box" style="margin:0;width:100%">' +
    _recentes.map((r, i) =>
      `<div class="recente-item" data-i="${i}" title="${escHtml(r.path)}">
         <span class="recente-nome">${escHtml(soNome(r.path))}</span>
         <span class="recente-path">${escHtml(r.path)}</span>
       </div>`).join('') + '</div>';
  openModal('Arquivos recentes', html, () => closeModal());
  setTimeout(() => {
    document.querySelectorAll('#modal-content .recente-item').forEach(el => {
      el.addEventListener('click', async () => {
        const rec = _recentes[parseInt(el.dataset.i)];
        closeModal();
        setStatus('Abrindo...', 'busy');
        const res = await apiFetch('/api/load_path', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, path: rec.path }) });
        if (res && res.success) {
          loadSheetData(res); markSaved();
          window.__concreSourcePath = res.path || rec.path;
          registrarRecente(rec.path);
          toast(`"${soNome(rec.path)}" carregado`, 'success');
        } else {
          toast('Não foi possível abrir (o arquivo foi movido?)', 'error');
          setStatus('Erro', 'error');
          _recentes = _recentes.filter(x => x.path !== rec.path);
          renderRecentes();
        }
      });
    });
  }, 30);
}
document.getElementById('btn-recentes')?.addEventListener('click', abrirModalRecentes);
