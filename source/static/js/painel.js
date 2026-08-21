/**
 * painel.js — Painel livre (canvas) do Concrestats
 *
 * Implementa a ideia do Naor: a página inteira é um canvas. Botão direito no
 * vazio ADICIONA um widget; botão direito no widget EDITA/duplica/exclui.
 * Os widgets cobrem as três "qualidades" que ele descreveu: valor filtrado,
 * agrupado por X, e proporção do total.
 *
 * Tipos: dado (KPI) · tabela · gráfico (barra/linha/pizza/empilhado/mapa de calor) · insights
 * Layout persistido por planilha em /api/prefs (chave painel_layouts).
 * Os dados respeitam SEMPRE os filtros globais da aba Planilhas.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const V = () => window.ConcreViz || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const GRID = 10;
  const snap = v => Math.round(v / GRID) * GRID;
  const HEADER_H = 30;

  // Operações. As três derivadas usam período anterior / total — é a base do
  // "criar suas próprias fórmulas" pedido pelo Naor.
  const OPS = ['Soma', 'Média', 'Contagem', 'Mínimo', 'Máximo', 'Mediana',
    'Desvio padrão', '% do total', 'Crescimento %', 'Acumulado'];
  const OPS_BASE = ['Soma', 'Média', 'Contagem', 'Mínimo', 'Máximo', 'Mediana', 'Desvio padrão'];
  const TIPOS = [['barra', 'Barra'], ['pizza', 'Pizza'],
    ['empilhado', 'Barra empilhada'], ['calor', 'Mapa de calor']];

  const state = { sheet: null, layouts: {}, carregado: false };

  /* ── dados (sempre com o filtro global aplicado) ── */
  function dados() {
    const d = window.getConcrestatsData ? window.getConcrestatsData({ filtered: true }) : null;
    if (!d || !d.headers || !d.headers.length) return null;
    return { headers: d.headers, rows: d.data || [], sheet: d.activeSheet };
  }
  const layout = () => (state.layouts[state.sheet] = state.layouts[state.sheet] || []);
  const genId = () => 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

  function salvar() {
    try {
      fetch('/api/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ painel_layouts: state.layouts })
      });
    } catch (_) { /* segue sem persistir */ }
  }
  function carregar() {
    return fetch('/api/prefs').then(r => r.ok ? r.json() : null).then(p => {
      if (p && p.painel_layouts && typeof p.painel_layouts === 'object') state.layouts = p.painel_layouts;
      state.carregado = true;
    }).catch(() => { state.carregado = true; });
  }

  /* ── agregação ─────────────────────────────────── */
  function calc(vals, op) {
    const ns = vals.filter(v => !isNaN(v));
    if (op === 'Contagem') return vals.length;
    if (!ns.length) return NaN;
    const soma = ns.reduce((a, b) => a + b, 0);
    switch (op) {
      case 'Soma': case '% do total': case 'Crescimento %': case 'Acumulado': return soma;
      case 'Média': return soma / ns.length;
      case 'Mínimo': return Math.min.apply(null, ns);
      case 'Máximo': return Math.max.apply(null, ns);
      case 'Mediana': {
        const b = ns.slice().sort((x, y) => x - y), m = b.length >> 1;
        return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
      }
      case 'Desvio padrão': {
        if (ns.length < 2) return 0;
        const md = soma / ns.length;
        return Math.sqrt(ns.reduce((s, v) => s + (v - md) * (v - md), 0) / (ns.length - 1));
      }
      default: return soma;
    }
  }

  // Chave de período no grão pedido (dia/mês/ano). Aceita ISO e data BR.
  function chavePeriodo(v, grao) {
    const s = String(v || '');
    let a, m, d;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { a = iso[1]; m = iso[2]; d = iso[3]; }
    else {
      const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (!br) return null;
      d = String(br[1]).padStart(2, '0');
      m = String(br[2]).padStart(2, '0');
      a = br[3];
    }
    return grao === 'ano' ? a : grao === 'dia' ? (a + '-' + m + '-' + d) : (a + '-' + m);
  }

  // Agrupa por coluna (ou por período) e aplica a operação escolhida.
  function agrupar(f, rows, cfg) {
    const num = V().num;
    const porPeriodo = cfg.grupo === '__periodo__';
    const iG = porPeriodo ? f.headers.indexOf(cfg.colData) : f.headers.indexOf(cfg.grupo);
    const iV = f.headers.indexOf(cfg.valor);
    if (iG < 0) return [];
    const g = new Map();
    rows.forEach(r => {
      const k = porPeriodo ? chavePeriodo(r[iG], cfg.grao || 'mes')
        : (String(r[iG] == null ? '—' : r[iG]).trim() || '—');
      if (k === null) return;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(iV >= 0 ? num(r[iV]) : NaN);
    });
    let saida = [];
    g.forEach((vals, k) => saida.push({ k: k, v: calc(vals, cfg.op || 'Soma'), n: vals.length }));
    if (porPeriodo) saida.sort((a, b) => String(a.k).localeCompare(String(b.k)));
    else saida.sort((a, b) => (isNaN(b.v) ? -Infinity : b.v) - (isNaN(a.v) ? -Infinity : a.v));

    const op = cfg.op || 'Soma';
    if (op === '% do total') {
      const t = saida.reduce((s, x) => s + (isNaN(x.v) ? 0 : Math.abs(x.v)), 0) || 1;
      saida = saida.map(x => ({ k: x.k, n: x.n, v: Math.abs(x.v) / t * 100 }));
    } else if (op === 'Crescimento %') {
      const orig = saida.slice();
      saida = saida.map((x, i) => ({
        k: x.k, n: x.n,
        v: (i === 0 || !orig[i - 1].v) ? NaN : (x.v - orig[i - 1].v) / Math.abs(orig[i - 1].v) * 100
      }));
    } else if (op === 'Acumulado') {
      let acc = 0;
      saida = saida.map(x => { acc += isNaN(x.v) ? 0 : x.v; return { k: x.k, n: x.n, v: acc }; });
    }
    if (cfg.topN > 0 && !porPeriodo) saida = saida.slice(0, cfg.topN);
    return saida;
  }

  const ehPct = op => op === '% do total' || op === 'Crescimento %';
  // Contagem é inteira; % ganha sufixo; demais usam o formato padrão.
  function fmtOp(v, op) {
    const viz = V();
    if (isNaN(v) || v === undefined) return '—';
    if (op === 'Contagem') return viz.fmt(v, 0);
    return viz.fmt0(v) + (ehPct(op) ? '%' : '');
  }

  /* ── export via backend (funciona no PC da empresa) ── */
  async function exportarAoa(aoa, baseName) {
    try {
      let path = null;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
        path = await window.pywebview.api.save_file_dialog(baseName + '.xlsx');
        if (!path) return;
      }
      const r = await fetch('/api/export_aoa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aoa: aoa, path: path, sheet_name: 'Dados', base_name: baseName })
      });
      const ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) {
        const j = await r.json();
        if (window.showToast) window.showToast(j.success ? 'Planilha salva' : ('Erro: ' + (j.error || '')), j.success ? 'success' : 'error');
        return;
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName + '.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (_) {
      if (window.showToast) window.showToast('Falha ao exportar', 'error');
    }
  }

  /* ── render do canvas ──────────────────────────── */
  function render() {
    const host = $('pan-body');
    if (!host) return;
    const f = dados();
    if (!f) {
      host.innerHTML = '<div class="graf-empty-state"><div class="empty-icon">◈</div>' +
        '<p>Abra uma planilha para montar seu painel</p>' +
        '<p class="empty-sub">Depois clique com o botão direito no espaço vazio para adicionar gráficos e tabelas</p></div>';
      const i0 = $('pan-info');
      if (i0) i0.textContent = 'Sem planilha ativa';
      return;
    }
    if (f.sheet !== state.sheet) state.sheet = f.sheet;
    const L = layout();
    host.innerHTML = '<div id="pan-canvas" class="pan-canvas"></div>';
    const canvas = $('pan-canvas');

    if (!L.length) {
      canvas.innerHTML = '<div class="pan-hint"><b>Painel vazio</b>' +
        '<span>Clique com o botão direito no fundo para adicionar um widget</span>' +
        '<button class="primary-btn" id="pan-add-first" type="button">Montar painel automático</button></div>';
      const bt = $('pan-add-first');
      if (bt) bt.addEventListener('click', ev => { ev.stopPropagation(); painelAutomatico(); });
    }

    let maxB = 0;
    L.forEach(it => {
      canvas.appendChild(criarWidget(f, it));
      maxB = Math.max(maxB, (it.y || 0) + (it.h || 240));
    });
    canvas.style.minHeight = Math.max(maxB + GRID * 4, 380) + 'px';
    canvas.addEventListener('contextmenu', e => {
      if (e.target.closest('.pan-widget')) return;
      e.preventDefault();
      menuCanvas(e.clientX, e.clientY);
    });

    const info = $('pan-info');
    if (info) info.textContent = (state.sheet || '') + ' · ' + L.length + ' widget(s) · ' + f.rows.length + ' linhas';
  }

  function criarWidget(f, it) {
    const el = document.createElement('div');
    el.className = 'pan-widget';
    el.dataset.wid = it.id;
    el.style.left = (it.x || 0) + 'px';
    el.style.top = (it.y || 0) + 'px';
    el.style.width = (it.w || 380) + 'px';
    el.style.height = (it.h || 240) + 'px';
    el.innerHTML = '<div class="pan-w-head"><span class="pan-w-tit">' +
      esc(it.config.titulo || tituloAuto(it)) + '</span>' +
      '<span class="pan-w-tag">' + esc(rotuloTipo(it)) + '</span></div>' +
      '<div class="pan-w-body"></div><div class="pan-w-resize" title="Redimensionar"></div>';
    const body = el.querySelector('.pan-w-body');
    try {
      desenhar(f, it, body);
    } catch (err) {
      body.innerHTML = '<p class="pan-erro">Não foi possível montar este widget.<br><small>' +
        esc(err.message) + '</small></p>';
    }
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      menuWidget(e.clientX, e.clientY, it);
    });
    arrastar(el, it);
    redimensionar(el, it);
    return el;
  }

  const rotuloTipo = it => it.type === 'grafico' ? (it.config.tipo || 'barra') : it.type;

  function tituloAuto(it) {
    const c = it.config;
    const alvo = c.grupo === '__periodo__' ? 'período' : (c.grupo || '—');
    if (it.type === 'dado') return (c.op || 'Soma') + ' de ' + (c.valor || '—');
    if (it.type === 'tabela') return 'Por ' + alvo;
    if (it.type === 'insights') return 'Insights automáticos';
    return (c.valor || 'Contagem') + ' por ' + alvo;
  }

  /* ── desenho por tipo ──────────────────────────── */
  function desenhar(f, it, body) {
    const c = it.config, viz = V();
    if (it.type === 'dado') return desenharDado(f, it, body);
    if (it.type === 'insights') {
      const iD = f.headers.indexOf(c.colData);
      const iV = f.headers.indexOf(c.valor);
      const iC = f.headers.indexOf(c.grupo);
      const ins = viz.gerarInsights ? viz.gerarInsights(f, f.rows, iD, iV, iC) : [];
      body.innerHTML = ins.length
        ? '<div class="ana-ins pan-ins">' + ins.map(i =>
            '<div class="ins-card ' + i.cls + '"><span class="ins-ico">' + i.ico +
            '</span><span>' + i.txt + '</span></div>').join('') + '</div>'
        : '<p class="pan-vazio">Sem insights — defina Data e Valor nas propriedades.</p>';
      return;
    }
    if (it.type === 'tabela') return desenharTabela(f, it, body);

    if (c.tipo === 'calor') return desenharCalor(f, it, body);
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = ((it.h || 240) - HEADER_H - 16) + 'px';
    body.appendChild(canvas);
    // O TIPO escolhido manda. Antes, um gráfico com séries extras ignorava o
    // tipo (pizza/empilhado) e continuava desenhando o combo — parecia que
    // "editar as propriedades não muda nada".
    if (c.tipo === 'empilhado' && c.serieCat) return desenharEmpilhado(f, it, canvas);
    if ((c.tipo === 'barra' || !c.tipo) && (c.series || []).length) return desenharCombo(f, it, canvas);

    const dat = agrupar(f, f.rows, c);
    if (!dat.length) {
      body.innerHTML = '<p class="pan-vazio">Sem dados para os campos escolhidos.</p>';
      return;
    }
    const sufixo = ehPct(c.op) ? '%' : '';
    const fv = v => viz.fmt0(v) + sufixo;
    if (c.tipo === 'pizza') viz.drawDonut(canvas, dat.map(d => d.k), dat.map(d => d.v), null);
    else viz.drawBars(canvas, dat.map(d => d.k), dat.map(d => d.v), null, fv);
  }

  function desenharDado(f, it, body) {
    const c = it.config, viz = V();
    const iV = f.headers.indexOf(c.valor);
    const vals = iV >= 0 ? f.rows.map(r => viz.num(r[iV])) : f.rows.map(() => NaN);
    let valor, pct = false, sub = c.subtitulo || '';

    if (c.op === 'Crescimento %') {
      const g = agrupar(f, f.rows, {
        grupo: '__periodo__', colData: c.colData, grao: c.grao || 'mes',
        valor: c.valor, op: c.opBase || 'Soma'
      });
      if (g.length >= 2) {
        const a = g[g.length - 2].v, b = g[g.length - 1].v;
        valor = a ? (b - a) / Math.abs(a) * 100 : NaN;
        pct = true;
        sub = sub || (g[g.length - 1].k + ' vs ' + g[g.length - 2].k);
      } else valor = NaN;
    } else if (c.op === '% do total' && c.grupo && c.filtroValor) {
      const g = agrupar(f, f.rows, { grupo: c.grupo, valor: c.valor, op: c.opBase || 'Soma' });
      const t = g.reduce((s, x) => s + (isNaN(x.v) ? 0 : Math.abs(x.v)), 0) || 1;
      const alvo = g.filter(x => x.k === c.filtroValor)[0];
      valor = alvo ? Math.abs(alvo.v) / t * 100 : NaN;
      pct = true;
      sub = sub || (c.filtroValor + ' sobre o total');
    } else {
      valor = calc(vals, c.op || 'Soma');
    }

    const cls = isNaN(valor) ? '' : (valor < 0 ? 'ana-down' : (pct && valor > 0 ? 'ana-up' : ''));
    const seta = pct ? (valor > 0 ? '▲ ' : valor < 0 ? '▼ ' : '') : '';
    const txt = isNaN(valor) ? '—'
      : pct ? seta + viz.fmt(Math.abs(valor), 1) + '%'
        : (c.op === 'Contagem' ? viz.fmt(valor, 0)
           : (viz.perfil === 'financeiro' ? 'R$ ' : '') + viz.fmt0(valor));
    body.innerHTML = '<div class="pan-dado"><b class="' + cls + '">' + esc(txt) + '</b>' +
      (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>';
  }

  function desenharTabela(f, it, body) {
    const c = it.config, viz = V();
    const cols = (c.colunas && c.colunas.length) ? c.colunas : [{ valor: c.valor, op: c.op || 'Soma' }];
    const base = agrupar(f, f.rows, {
      grupo: c.grupo, colData: c.colData, grao: c.grao,
      valor: cols[0].valor, op: cols[0].op, topN: c.topN
    });
    if (!base.length) {
      body.innerHTML = '<p class="pan-vazio">Escolha "Agrupar por" nas propriedades (botão direito).</p>';
      return;
    }
    const series = cols.map(cl => {
      const m = new Map();
      agrupar(f, f.rows, { grupo: c.grupo, colData: c.colData, grao: c.grao, valor: cl.valor, op: cl.op })
        .forEach(x => m.set(x.k, x.v));
      return m;
    });
    const pctCol = cols.map(cl => ehPct(cl.op));
    const linhas = base.slice(0, c.limite || 200);
    const totCols = cols.map((cl, i) => {
      if (pctCol[i]) return NaN;
      const iV = f.headers.indexOf(cl.valor);
      const vals = iV >= 0 ? f.rows.map(r => viz.num(r[iV])) : f.rows.map(() => NaN);
      return calc(vals, cl.op);
    });

    const cabec = '<th>' + esc(c.grupo === '__periodo__' ? 'Período' : (c.grupo || '')) + '</th>' +
      cols.map(cl => '<th>' + esc(cl.titulo || (cl.op + (cl.valor ? ' · ' + cl.valor : ''))) + '</th>').join('');

    const corpo = linhas.map(l => '<tr><td>' + esc(l.k) + '</td>' + cols.map((cl, i) => {
      const v = series[i].get(l.k);
      const neg = (v !== undefined && !isNaN(v) && v < 0) ? ' ana-neg' : '';
      return '<td class="ana-num' + neg + '">' + fmtOp(v, cl.op) + '</td>';
    }).join('') + '</tr>').join('');

    const rodape = c.total === false ? '' :
      '<tfoot><tr><td><b>Total</b></td>' + totCols.map((t, i) =>
        '<td class="ana-num"><b>' + fmtOp(t, cols[i].op) + '</b></td>'
      ).join('') + '</tr></tfoot>';

    body.innerHTML = (c.insights ? montarInsightsTabela(base, viz) : '') +
      '<div class="pan-tab-wrap"><table class="ana-pivot pan-tab"><thead><tr>' + cabec +
      '</tr></thead><tbody>' + corpo + '</tbody>' + rodape + '</table></div>' +
      '<button class="pan-btn-xls" type="button">Baixar Excel</button>';

    body.querySelector('.pan-btn-xls').addEventListener('click', ev => {
      ev.stopPropagation();
      const aoa = [[c.grupo === '__periodo__' ? 'Período' : c.grupo].concat(
        cols.map(cl => cl.titulo || (cl.op + ' ' + (cl.valor || ''))))];
      base.forEach(l => aoa.push([l.k].concat(cols.map((cl, i) => {
        const v = series[i].get(l.k);
        return (v === undefined || isNaN(v)) ? '' : v;
      }))));
      exportarAoa(aoa, String(it.config.titulo || tituloAuto(it)).replace(/[^\w\-]+/g, '_'));
    });
  }

  // Insights da própria tabela (o Naor pediu insights on/off por widget).
  function montarInsightsTabela(base, viz) {
    if (!base.length) return '';
    const tot = base.reduce((s, x) => s + (isNaN(x.v) ? 0 : Math.abs(x.v)), 0) || 1;
    const top = base[0];
    const cards = [{
      cls: 'info', ico: '★',
      txt: 'Maior: ' + top.k + ' (' + viz.fmt0(top.v) + ' · ' + viz.fmt(Math.abs(top.v) / tot * 100, 1) + '%)'
    }];
    if (base.length > 1) {
      const ult = base[base.length - 1];
      cards.push({ cls: 'down', ico: '▼', txt: 'Menor: ' + ult.k + ' (' + viz.fmt0(ult.v) + ')' });
    }
    const conc = Math.abs(top.v) / tot * 100;
    if (conc > 50) cards.push({ cls: 'warn', ico: '!', txt: '"' + top.k + '" concentra ' + viz.fmt(conc, 1) + '% do total' });
    return '<div class="ana-ins pan-ins">' + cards.map(i =>
      '<div class="ins-card ' + i.cls + '"><span class="ins-ico">' + i.ico + '</span><span>' +
      esc(i.txt) + '</span></div>').join('') + '</div>';
  }

  function desenharEmpilhado(f, it, canvas) {
    const c = it.config, viz = V(), num = viz.num;
    const porPeriodo = c.grupo === '__periodo__';
    const iX = porPeriodo ? f.headers.indexOf(c.colData) : f.headers.indexOf(c.grupo);
    const iC = f.headers.indexOf(c.serieCat);
    const iV = f.headers.indexOf(c.valor);
    if (iX < 0 || iC < 0) { viz.drawBars(canvas, [], [], null); return; }
    const xs = [], catTot = new Map(), mapa = new Map();
    f.rows.forEach(r => {
      const k = porPeriodo ? chavePeriodo(r[iX], c.grao || 'mes')
        : (String(r[iX] == null ? '—' : r[iX]).trim() || '—');
      if (k === null) return;
      const cat = String(r[iC] == null ? '—' : r[iC]).trim() || '—';
      const v = iV >= 0 ? num(r[iV]) : 1;
      if (isNaN(v)) return;
      if (!mapa.has(k)) { mapa.set(k, new Map()); xs.push(k); }
      mapa.get(k).set(cat, (mapa.get(k).get(cat) || 0) + v);
      catTot.set(cat, (catTot.get(cat) || 0) + v);
    });
    xs.sort((a, b) => String(a).localeCompare(String(b)));
    const arr = [];
    catTot.forEach((v, k) => arr.push([k, v]));
    const top = arr.sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
    const series = top.map(cat => ({
      nome: cat, vals: xs.map(k => (mapa.get(k) || new Map()).get(cat) || 0)
    }));
    const outros = {
      nome: 'Outros',
      vals: xs.map(k => {
        let s = 0;
        (mapa.get(k) || new Map()).forEach((v, cat) => { if (top.indexOf(cat) < 0) s += v; });
        return s;
      })
    };
    if (outros.vals.some(v => v > 0)) series.push(outros);
    viz.drawStacked(canvas, xs, series, null);
  }

  /* ── combo: várias séries (barra + linha, 2 eixos) ──
     É o que permite montar "produção e crescimento" como o Naor pediu. */
  function desenharCombo(f, it, canvas) {
    const c = it.config, viz = V();
    const eixoX = agrupar(f, f.rows, {
      grupo: c.grupo, colData: c.colData, grao: c.grao,
      valor: (c.series[0] || {}).valor, op: (c.series[0] || {}).op || 'Soma', topN: c.topN
    });
    if (!eixoX.length) { viz.drawBars(canvas, [], [], null); return; }
    const labels = eixoX.map(d => d.k);
    const series = c.series.map(s => {
      const m = new Map();
      agrupar(f, f.rows, { grupo: c.grupo, colData: c.colData, grao: c.grao, valor: s.valor, op: s.op })
        .forEach(x => m.set(x.k, x.v));
      const o = {};
      Object.keys(s).forEach(k => { o[k] = s[k]; });
      o.vals = labels.map(k => { const v = m.get(k); return v === undefined ? NaN : v; });
      return o;
    });

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 240;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const temDir = series.some(s => s.eixo === 'dir');
    const left = 56, right = temDir ? 56 : 14, top = 16, bottom = 48;
    const plotW = w - left - right, plotH = h - top - bottom, baseY = top + plotH;

    const junta = arr => arr.filter(v => !isNaN(v) && isFinite(v));
    let esqVals = [], dirVals = [];
    series.forEach(s => { (s.eixo === 'dir' ? dirVals : esqVals).push.apply(s.eixo === 'dir' ? dirVals : esqVals, junta(s.vals)); });
    const eMax = Math.max.apply(null, esqVals.concat([1])), eMin = Math.min.apply(null, esqVals.concat([0]));
    let dMax = Math.max.apply(null, dirVals.concat([1])), dMin = Math.min.apply(null, dirVals.concat([0]));
    if (dMax === dMin) { dMax += 1; dMin -= 1; }

    ctx.font = '11px IBM Plex Mono, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = top + plotH * i / 4;
      ctx.strokeStyle = '#ececea';
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillStyle = '#2a5298'; ctx.textAlign = 'right';
      ctx.fillText(viz.fmt0(eMax - (eMax - eMin) * i / 4), left - 6, y + 4);
      if (temDir) {
        ctx.fillStyle = '#2a6640'; ctx.textAlign = 'left';
        ctx.fillText(viz.fmt0(dMax - (dMax - dMin) * i / 4) + '%', w - right + 6, y + 4);
      }
    }
    ctx.textAlign = 'start';

    const yEsq = v => top + plotH * (1 - (v - eMin) / ((eMax - eMin) || 1));
    const yDir = v => top + plotH * (1 - (v - dMin) / ((dMax - dMin) || 1));
    const slot = plotW / Math.max(1, labels.length);
    const barras = series.filter(s => s.tipo !== 'linha');
    const bw = Math.max(4, Math.min(46, slot * 0.7 / Math.max(1, barras.length)));

    barras.forEach((s, si) => {
      ctx.fillStyle = s.cor || '#2a5298';
      s.vals.forEach((v, i) => {
        if (isNaN(v)) return;
        const fy = s.eixo === 'dir' ? yDir : yEsq;
        const yv = fy(v), y0 = fy(0);
        const x = left + slot * i + (slot - bw * barras.length) / 2 + si * bw;
        ctx.fillRect(x, Math.min(yv, y0), bw, Math.max(2, Math.abs(y0 - yv)));
      });
    });
    series.filter(s => s.tipo === 'linha').forEach(s => {
      const fy = s.eixo === 'dir' ? yDir : yEsq;
      ctx.strokeStyle = s.cor || '#2a6640';
      ctx.lineWidth = 2; ctx.beginPath();
      let iniciado = false;
      s.vals.forEach((v, i) => {
        if (isNaN(v)) return;
        const x = left + slot * i + slot / 2, y = fy(v);
        if (!iniciado) { ctx.moveTo(x, y); iniciado = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = s.cor || '#2a6640';
      s.vals.forEach((v, i) => {
        if (isNaN(v)) return;
        ctx.beginPath();
        ctx.arc(left + slot * i + slot / 2, fy(v), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    ctx.fillStyle = '#555'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
    const passo = slot >= 46 ? 1 : Math.ceil(46 / slot);
    labels.forEach((l, i) => {
      if (i % passo) return;
      ctx.fillText(String(l).slice(0, 12), left + slot * i + slot / 2, baseY + 16);
    });
    let lx = left;
    ctx.textAlign = 'left'; ctx.font = '10px IBM Plex Sans, sans-serif';
    series.forEach(s => {
      ctx.fillStyle = s.cor || '#2a5298';
      ctx.fillRect(lx, baseY + 28, 9, 9);
      ctx.fillStyle = '#5a5852';
      const nome = String(s.titulo || (s.op + ' ' + (s.valor || ''))).slice(0, 26);
      ctx.fillText(nome, lx + 13, baseY + 36);
      lx += ctx.measureText(nome).width + 30;
    });
    ctx.textAlign = 'start';
  }

  /* ── mapa de calor (calendário) ────────────────── */
  function desenharCalor(f, it, body) {
    const c = it.config, viz = V(), num = viz.num;
    const iD = f.headers.indexOf(c.colData), iV = f.headers.indexOf(c.valor);
    if (iD < 0) { body.innerHTML = '<p class="pan-vazio">Escolha a coluna de data nas propriedades.</p>'; return; }
    const dias = new Map();
    f.rows.forEach(r => {
      const k = chavePeriodo(r[iD], 'dia');
      if (!k) return;
      const v = iV >= 0 ? num(r[iV]) : 1;
      if (isNaN(v)) return;
      dias.set(k, (dias.get(k) || 0) + v);
    });
    const keys = [];
    dias.forEach((v, k) => keys.push(k));
    keys.sort();
    if (!keys.length) { body.innerHTML = '<p class="pan-vazio">Sem datas válidas.</p>'; return; }
    const parse = k => { const p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
    const d0 = parse(keys[0]), d1 = parse(keys[keys.length - 1]);
    let maxV = 1;
    dias.forEach(v => { if (v > maxV) maxV = v; });
    const cor = v => v <= 0 ? '#ebedf0'
      : (v / maxV < 0.25 ? '#c6e48b' : v / maxV < 0.5 ? '#7bc96f' : v / maxV < 0.75 ? '#239a3b' : '#196127');
    const cur = new Date(d0);
    cur.setUTCDate(cur.getUTCDate() - ((cur.getUTCDay() + 6) % 7));
    const cols = [];
    let guarda = 0;
    while (guarda++ < 800) {
      const semana = [];
      for (let i = 0; i < 7; i++) {
        const k = cur.toISOString().slice(0, 10);
        semana.push({ k: k, v: dias.get(k) || 0, dentro: cur >= d0 && cur <= d1 });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      cols.push(semana);
      if (cur > d1 && ((cur.getUTCDay() + 6) % 7) === 0) break;
    }
    const C = 12, G = 3;
    let svg = '<svg width="' + (cols.length * (C + G) + 46) + '" height="' + (7 * (C + G) + 34) +
      '" style="font-family:IBM Plex Mono,monospace">';
    ['Seg', '', 'Qua', '', 'Sex', '', 'Dom'].forEach((dn, r) => {
      if (dn) svg += '<text x="2" y="' + (30 + r * (C + G) + C - 2) + '" font-size="9" fill="#999">' + dn + '</text>';
    });
    let ultimoMes = '';
    cols.forEach((semana, ci) => {
      const primeiro = semana.filter(d => d.dentro)[0];
      if (primeiro) {
        const mo = primeiro.k.slice(0, 7);
        if (mo !== ultimoMes) {
          ultimoMes = mo;
          svg += '<text x="' + (44 + ci * (C + G)) + '" y="18" font-size="9" fill="#999">' +
            primeiro.k.slice(5, 7) + '/' + primeiro.k.slice(2, 4) + '</text>';
        }
      }
      semana.forEach((cel, r) => {
        if (!cel.dentro) return;
        svg += '<rect x="' + (44 + ci * (C + G)) + '" y="' + (24 + r * (C + G)) + '" width="' + C +
          '" height="' + C + '" rx="2" fill="' + cor(cel.v) + '"><title>' +
          viz.fmt(cel.v, 1) + ' · ' + cel.k.split('-').reverse().join('/') + '</title></rect>';
      });
    });
    svg += '</svg>';
    body.innerHTML = '<div class="pan-calor">' + svg + '</div>';
  }

  /* ── mover e redimensionar ─────────────────────── */
  function arrastar(el, it) {
    const head = el.querySelector('.pan-w-head');
    head.addEventListener('mousedown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const canvas = $('pan-canvas');
      const cr = canvas.getBoundingClientRect();
      const offX = ev.clientX - el.getBoundingClientRect().left;
      const offY = ev.clientY - el.getBoundingClientRect().top;
      el.classList.add('movendo');
      const mover = e => {
        let nl = snap(e.clientX - cr.left - offX);
        let nt = snap(e.clientY - cr.top - offY);
        nl = Math.max(0, Math.min(nl, snap(canvas.offsetWidth - el.offsetWidth)));
        nt = Math.max(0, nt);
        el.style.left = nl + 'px';
        el.style.top = nt + 'px';
      };
      const soltar = () => {
        document.removeEventListener('mousemove', mover);
        document.removeEventListener('mouseup', soltar);
        el.classList.remove('movendo');
        it.x = parseInt(el.style.left) || 0;
        it.y = parseInt(el.style.top) || 0;
        salvar();
        render();
      };
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
    });
  }

  function redimensionar(el, it) {
    const h = el.querySelector('.pan-w-resize');
    h.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const x0 = ev.clientX, y0 = ev.clientY;
      const w0 = el.offsetWidth, h0 = el.offsetHeight;
      const mover = e => {
        el.style.width = Math.max(180, snap(w0 + e.clientX - x0)) + 'px';
        el.style.height = Math.max(110, snap(h0 + e.clientY - y0)) + 'px';
      };
      const soltar = () => {
        document.removeEventListener('mousemove', mover);
        document.removeEventListener('mouseup', soltar);
        it.w = parseInt(el.style.width);
        it.h = parseInt(el.style.height);
        salvar();
        render();
      };
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
    });
  }

  /* ── menus de contexto ─────────────────────────── */
  let _fecharFora = null;
  function fecharMenu() {
    const m = $('pan-ctx');
    if (m) m.remove();
    if (_fecharFora) {
      document.removeEventListener('mousedown', _fecharFora, true);
      _fecharFora = null;
    }
  }
  function abrirMenu(x, y, itens) {
    fecharMenu();
    const m = document.createElement('div');
    m.id = 'pan-ctx';
    m.className = 'context-menu pan-ctx';
    m.style.cssText = 'display:block;left:' + x + 'px;top:' + y + 'px';
    m.innerHTML = itens.map((i, idx) => i.sep
      ? '<div class="pan-ctx-sep"></div>'
      : '<div class="context-item" data-i="' + idx + '">' + esc(i.label) + '</div>').join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth) m.style.left = Math.max(4, window.innerWidth - r.width - 6) + 'px';
    if (r.bottom > window.innerHeight) m.style.top = Math.max(4, window.innerHeight - r.height - 6) + 'px';
    m.querySelectorAll('.context-item').forEach(el => {
      el.addEventListener('click', () => {
        const it = itens[parseInt(el.dataset.i)];
        fecharMenu();
        if (it && it.fn) it.fn();
      });
    });
    // Fecha só quando o clique for FORA do menu. Antes, o mousedown no próprio
    // item removia o menu antes do 'click' disparar — as opções não funcionavam.
    _fecharFora = ev => { if (!ev.target.closest('#pan-ctx')) fecharMenu(); };
    setTimeout(() => document.addEventListener('mousedown', _fecharFora, true), 0);
  }

  function menuCanvas(x, y) {
    const canvas = $('pan-canvas');
    const cr = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const px = snap(Math.max(0, x - cr.left)), py = snap(Math.max(0, y - cr.top));
    abrirMenu(x, y, [
      { label: '+ Dado (KPI)', fn: () => novoWidget('dado', px, py) },
      { label: '+ Tabela', fn: () => novoWidget('tabela', px, py) },
      { label: '+ Gráfico', fn: () => novoWidget('grafico', px, py) },
      { label: '+ Insights', fn: () => novoWidget('insights', px, py) },
      { sep: true },
      { label: 'Montar painel automático', fn: painelAutomatico },
      {
        label: 'Limpar painel', fn: () => {
          if (!confirm('Remover todos os widgets deste painel?')) return;
          state.layouts[state.sheet] = [];
          salvar(); render();
        }
      }
    ]);
  }

  function menuWidget(x, y, it) {
    abrirMenu(x, y, [
      { label: 'Editar propriedades', fn: () => editar(it) },
      {
        label: 'Duplicar', fn: () => {
          const n = JSON.parse(JSON.stringify(it));
          n.id = genId(); n.y = (it.y || 0) + (it.h || 240) + GRID;
          layout().push(n); salvar(); render();
        }
      },
      { sep: true },
      {
        label: 'Excluir', fn: () => {
          const L = layout();
          for (let i = 0; i < L.length; i++) {
            if (L[i].id === it.id) { L.splice(i, 1); break; }
          }
          salvar(); render();
        }
      }
    ]);
  }

  /* ── criação e edição ──────────────────────────── */
  function autoMapa(f) {
    return (window.ConcreAutoMap && window.ConcreAutoMap(f.headers, f.rows)) || {};
  }

  function novoWidget(tipo, x, y) {
    const f = dados();
    if (!f) return;
    const m = autoMapa(f);
    const cfg = {
      valor: m.valor || '', grupo: m.cat || '', colData: m.data || '',
      grao: 'mes', op: 'Soma', insights: false, total: true, topN: 12
    };
    if (tipo === 'grafico') { cfg.tipo = 'barra'; cfg.series = []; }
    if (tipo === 'tabela') cfg.colunas = [{ valor: cfg.valor, op: 'Soma' }, { valor: cfg.valor, op: '% do total' }];
    const tam = tipo === 'dado' ? { w: 240, h: 130 }
      : tipo === 'insights' ? { w: 460, h: 210 }
        : tipo === 'tabela' ? { w: 460, h: 300 } : { w: 520, h: 280 };
    const it = { id: genId(), type: tipo, x: x || 0, y: y || 0, w: tam.w, h: tam.h, config: cfg };
    layout().push(it);
    salvar(); render();
    editar(it);
  }

  function selHtml(id, headers, cur, rotulo) {
    const opts = ['<option value="">—</option>'].concat(headers.map(h =>
      '<option value="' + esc(h) + '"' + (h === cur ? ' selected' : '') + '>' + esc(h) + '</option>'));
    return '<label>' + rotulo + '</label><select id="' + id + '">' + opts.join('') + '</select>';
  }
  const opSel = (id, cur, lista) => '<select id="' + id + '">' + (lista || OPS).map(o =>
    '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';

  function editar(it) {
    const f = dados();
    if (!f || !window.openModal) return;
    const c = it.config;
    const H = f.headers;
    const grupoOpts = '<option value="">—</option>' +
      '<option value="__periodo__"' + (c.grupo === '__periodo__' ? ' selected' : '') + '>Período (data)</option>' +
      H.map(h => '<option value="' + esc(h) + '"' + (h === c.grupo ? ' selected' : '') + '>' + esc(h) + '</option>').join('');

    let corpo = '<label>Título</label><input id="pw-tit" value="' + esc(c.titulo || '') +
      '" placeholder="' + esc(tituloAuto(it)) + '">';

    if (it.type === 'grafico') {
      corpo += '<label>Tipo</label><select id="pw-tipo">' + TIPOS.map(t =>
        '<option value="' + t[0] + '"' + (t[0] === (c.tipo || 'barra') ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select>';
    }
    if (it.type === 'tabela' || it.type === 'grafico') {
      corpo += '<label>Agrupar por</label><select id="pw-grupo">' + grupoOpts + '</select>';
    }
    corpo += selHtml('pw-data', H, c.colData, 'Coluna de data');
    corpo += '<label>Agrupar datas por</label><select id="pw-grao">' +
      [['dia', 'Dia'], ['mes', 'Mês'], ['ano', 'Ano']].map(g =>
        '<option value="' + g[0] + '"' + (g[0] === (c.grao || 'mes') ? ' selected' : '') + '>' + g[1] + '</option>').join('') + '</select>';
    corpo += selHtml('pw-valor', H, c.valor, 'Coluna de valor');

    if (it.type === 'dado') {
      corpo += '<label>Operação</label>' + opSel('pw-op', c.op || 'Soma');
      corpo += '<label>Operação base (para % e crescimento)</label>' + opSel('pw-opbase', c.opBase || 'Soma', OPS_BASE);
      corpo += '<label>Categoria (para "% do total")</label><select id="pw-grupo">' + grupoOpts + '</select>';
      corpo += '<label>Valor da categoria</label><input id="pw-fval" value="' + esc(c.filtroValor || '') +
        '" placeholder="ex.: Serviços">';
      corpo += '<label>Legenda</label><input id="pw-sub" value="' + esc(c.subtitulo || '') + '" placeholder="opcional">';
    }
    if (it.type === 'tabela') {
      corpo += '<label>Colunas (cada uma com sua operação)</label><div id="pw-cols" class="pw-cols"></div>' +
        '<button type="button" id="pw-addcol" class="pw-add">+ coluna</button>' +
        '<label class="pw-check"><input type="checkbox" id="pw-ins"' + (c.insights ? ' checked' : '') +
        '> Mostrar insights</label>' +
        '<label class="pw-check"><input type="checkbox" id="pw-tot"' + (c.total !== false ? ' checked' : '') + '> Linha de total</label>' +
        '<label>Máximo de grupos</label><input id="pw-topn" type="number" min="0" max="500" value="' + (c.topN || 12) + '">';
    }
    if (it.type === 'grafico') {
      corpo += '<label>Operação</label>' + opSel('pw-op', c.op || 'Soma');
      corpo += selHtml('pw-seriecat', H, c.serieCat, 'Dividir barras por (empilhado)');
      corpo += '<label>Séries extras — combo barra + linha</label>';
      if ((c.series || []).length) {
        corpo += '<p class="rc-dica">Este gráfico usa as séries abaixo. Enquanto houver série, ' +
          'os campos <b>Coluna de valor</b> e <b>Operação</b> acima não são usados — quem manda são as séries. ' +
          'Remova todas para voltar ao gráfico simples.</p>';
      }
      corpo += '<div id="pw-series" class="pw-cols"></div>' +
        '<button type="button" id="pw-addserie" class="pw-add">+ gráfico (série)</button>';
      corpo += '<label>Máximo de grupos</label><input id="pw-topn" type="number" min="0" max="500" value="' + (c.topN || 12) + '">';
    }

    const nomeTipo = it.type === 'dado' ? 'Dado' : it.type === 'tabela' ? 'Tabela'
      : it.type === 'insights' ? 'Insights' : 'Gráfico';

    window.openModal('Propriedades — ' + nomeTipo, corpo, () => {
      const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
      const gc = id => { const el = document.getElementById(id); return el ? el.checked : undefined; };
      c.titulo = g('pw-tit') || '';
      c.colData = g('pw-data') || '';
      c.grao = g('pw-grao') || 'mes';
      c.valor = g('pw-valor') || '';
      if (g('pw-grupo') !== undefined) c.grupo = g('pw-grupo') || '';
      if (g('pw-tipo') !== undefined) c.tipo = g('pw-tipo');
      if (g('pw-op') !== undefined) c.op = g('pw-op');
      if (g('pw-opbase') !== undefined) c.opBase = g('pw-opbase');
      if (g('pw-fval') !== undefined) c.filtroValor = g('pw-fval');
      if (g('pw-sub') !== undefined) c.subtitulo = g('pw-sub');
      if (g('pw-seriecat') !== undefined) c.serieCat = g('pw-seriecat') || '';
      if (gc('pw-ins') !== undefined) c.insights = gc('pw-ins');
      if (gc('pw-tot') !== undefined) c.total = gc('pw-tot');
      if (g('pw-topn') !== undefined) c.topN = parseInt(g('pw-topn')) || 0;
      if (it.type === 'tabela') c.colunas = lerColunas();
      if (it.type === 'grafico') c.series = lerSeries();
      salvar();
      if (window.closeModal) window.closeModal();
      render();
    });

    function linhaColuna(cl) {
      const d = document.createElement('div');
      d.className = 'pw-col-row';
      d.innerHTML = '<select class="pw-c-val"><option value="">— contagem —</option>' +
        H.map(h => '<option value="' + esc(h) + '"' + (h === cl.valor ? ' selected' : '') + '>' + esc(h) + '</option>').join('') +
        '</select><select class="pw-c-op">' + OPS.map(o =>
          '<option' + (o === cl.op ? ' selected' : '') + '>' + o + '</option>').join('') +
        '</select><input class="pw-c-tit" placeholder="título" value="' + esc(cl.titulo || '') + '">' +
        '<button type="button" class="pw-del" title="Remover">×</button>';
      d.querySelector('.pw-del').addEventListener('click', () => d.remove());
      return d;
    }
    function linhaSerie(s) {
      const d = document.createElement('div');
      d.className = 'pw-col-row';
      d.innerHTML = '<select class="pw-s-val"><option value="">— contagem —</option>' +
        H.map(h => '<option value="' + esc(h) + '"' + (h === s.valor ? ' selected' : '') + '>' + esc(h) + '</option>').join('') +
        '</select><select class="pw-s-op">' + OPS.map(o =>
          '<option' + (o === s.op ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>' +
        '<select class="pw-s-tipo"><option value="barra"' + (s.tipo !== 'linha' ? ' selected' : '') + '>barra</option>' +
        '<option value="linha"' + (s.tipo === 'linha' ? ' selected' : '') + '>linha</option></select>' +
        '<select class="pw-s-eixo"><option value="esq"' + (s.eixo !== 'dir' ? ' selected' : '') + '>eixo esq.</option>' +
        '<option value="dir"' + (s.eixo === 'dir' ? ' selected' : '') + '>eixo dir.</option></select>' +
        '<button type="button" class="pw-del" title="Remover">×</button>';
      d.querySelector('.pw-del').addEventListener('click', () => d.remove());
      return d;
    }
    function lerColunas() {
      const out = [];
      document.querySelectorAll('#pw-cols .pw-col-row').forEach(d => {
        out.push({
          valor: d.querySelector('.pw-c-val').value,
          op: d.querySelector('.pw-c-op').value,
          titulo: d.querySelector('.pw-c-tit').value
        });
      });
      return out.filter(x => x.op);
    }
    function lerSeries() {
      const cores = ['#2a5298', '#2a6640', '#e05c3a', '#8a2be2', '#e8a030'];
      const out = [];
      document.querySelectorAll('#pw-series .pw-col-row').forEach((d, i) => {
        out.push({
          valor: d.querySelector('.pw-s-val').value,
          op: d.querySelector('.pw-s-op').value,
          tipo: d.querySelector('.pw-s-tipo').value,
          eixo: d.querySelector('.pw-s-eixo').value,
          cor: cores[i % cores.length]
        });
      });
      return out.filter(x => x.op);
    }
    setTimeout(() => {
      const box = document.getElementById('pw-cols');
      if (box) {
        (c.colunas || []).forEach(cl => box.appendChild(linhaColuna(cl)));
        const b1 = document.getElementById('pw-addcol');
        if (b1) b1.addEventListener('click', () => box.appendChild(linhaColuna({ valor: c.valor, op: 'Soma' })));
      }
      const sbox = document.getElementById('pw-series');
      if (sbox) {
        (c.series || []).forEach(s => sbox.appendChild(linhaSerie(s)));
        const b2 = document.getElementById('pw-addserie');
        if (b2) b2.addEventListener('click', () => sbox.appendChild(linhaSerie({ valor: c.valor, op: 'Soma', tipo: 'barra', eixo: 'esq' })));
      }
    }, 30);
  }

  /* ── painel automático (um clique monta tudo) ──── */
  function painelAutomatico() {
    const f = dados();
    if (!f) return;
    const m = autoMapa(f);
    if (!m.valor && !m.cat) {
      if (window.showToast) window.showToast('Não consegui detectar as colunas — adicione widgets manualmente', 'error');
      return;
    }
    const base = { valor: m.valor || '', grupo: m.cat || '', colData: m.data || '', grao: 'mes', topN: 12 };
    const L = [];
    const add = (type, x, y, w, h, cfg) => {
      const c = {};
      Object.keys(base).forEach(k => { c[k] = base[k]; });
      Object.keys(cfg).forEach(k => { c[k] = cfg[k]; });
      L.push({ id: genId(), type: type, x: x, y: y, w: w, h: h, config: c });
    };

    add('dado', 0, 0, 240, 120, { op: 'Soma', titulo: 'Total' });
    add('dado', 250, 0, 240, 120, { op: 'Média', titulo: 'Média' });
    add('dado', 500, 0, 240, 120, { op: 'Contagem', titulo: 'Registros' });
    if (m.data) add('dado', 750, 0, 240, 120, { op: 'Crescimento %', opBase: 'Soma', titulo: 'Crescimento' });
    add('insights', 0, 130, 740, 200, {});
    if (m.data) {
      add('grafico', 750, 130, 480, 200, { tipo: 'calor', titulo: 'Mapa de calor' });
      add('grafico', 0, 340, 740, 300, {
        tipo: 'barra', grupo: '__periodo__', op: 'Soma', titulo: 'Produção e crescimento',
        series: [
          { valor: m.valor, op: 'Soma', tipo: 'barra', eixo: 'esq', cor: '#2a5298' },
          { valor: m.valor, op: 'Crescimento %', tipo: 'linha', eixo: 'dir', cor: '#2a6640' }
        ]
      });
    }
    if (m.cat) {
      add('grafico', 750, 340, 480, 300, { tipo: 'pizza', op: 'Soma', titulo: 'Distribuição' });
      add('tabela', 0, 650, 740, 320, {
        insights: true, total: true,
        colunas: [
          { valor: m.valor, op: 'Soma' },
          { valor: m.valor, op: '% do total' },
          { valor: m.valor, op: 'Média' }
        ]
      });
    }
    state.layouts[state.sheet] = L;
    salvar(); render();
    if (window.showToast) window.showToast('Painel montado automaticamente', 'success');
  }

  /* ── init ──────────────────────────────────────── */
  function init() {
    const b = $('pan-auto');
    if (b) b.addEventListener('click', painelAutomatico);
    const r = $('pan-refresh');
    if (r) r.addEventListener('click', render);
    const p = $('pan-present');
    if (p) p.addEventListener('click', () => {
      const m = $('module-painel');
      m.classList.add('ana-presenting');
      (m.requestFullscreen ? m.requestFullscreen() : Promise.reject())
        .catch(() => m.classList.remove('ana-presenting'));
    });
    document.addEventListener('fullscreenchange', () => {
      const m = $('module-painel');
      if (m && !document.fullscreenElement) m.classList.remove('ana-presenting');
    });
    window.addEventListener('concrestats:datachanged', () => {
      const el = $('module-painel');
      if (el && el.style.display !== 'none') setTimeout(render, 60);
    });
    carregar();
  }

  window.PainelModule = {
    onModuleEnter: () => {
      if (!state.carregado) carregar().then(render);
      else render();
    }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
