/**
 * graficos.js — Módulo de Gráficos e Análise de Receitas
 * ConcreLab v1.4
 */

(function () {
  'use strict';

  const GRID = 10;
  function snap(v)         { return Math.round(v / GRID) * GRID; }
  function snapMin(v, min) { return Math.max(min, snap(v)); }

  const grafState = {
    receitas:        [],
    sheetData:       null,
    colReceita:      null,
    colVersao:       null,
    filtros:         [],
    layouts:         {},
    templates:       {},
    editMode:        new Set(), // Set de recIds em modo de edição
    chartInstances:  {},
    recSearch:       '',
    separaPorVersao: false,
  };

  const STATS = [
    'Média','Desvio Padrão','Mínimo','Máximo','Mediana',
    'P95 (95º Percentil)','fck est. (Méd−1,65σ)','Contagem','Soma','% Aprovação',
  ];
  const CHART_TYPES = ['Linha','Barra','Dispersão','Área','Histograma'];
  const COLORS = ['#2a5298','#e05c3a','#2a6640','#8a2be2','#e8a030','#1a9aa0','#c0392b','#27ae60'];
  function numBR(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/\s/g,'').replace(/\u00a0/g,'');
    if (!s) return NaN;
    s = s.replace(/[^0-9,\.\-]/g,'');
    if (!s || s==='-' || s===',' || s==='.') return NaN;
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',', '.');
      else s = s.replace(/,/g,'');
    } else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s); return isFinite(n) ? n : NaN;
  }
  function fckRow(row) {
    const headers = grafState.sheetData?.headers || [];
    for (const col of ['PRODUTO','RECEITA','NOME','TRAÇO','TRACO']) {
      const i = headers.findIndex(h => String(h).trim().toUpperCase() === col);
      if (i >= 0 && row) { const m = String(row[i]||'').toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/); if (m) return numBR(m[1]); }
    }
    return NaN;
  }
  // FCK a partir do NOME da receita (ex.: "169-FCK 25 S100 ...").
  function fckFromNome(nome) {
    const m = String(nome||'').toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/);
    return m ? numBR(m[1]) : NaN;
  }
  // Índice da coluna de CP (corpo de prova) na planilha.
  function colCP(headers) {
    return (headers||[]).findIndex(h => String(h).trim().toUpperCase() === 'CP');
  }
  // Linhas de uma receita após versão + filtros do módulo (preserva a linha
  // inteira, para sabermos o CP de cada ponto do gráfico).
  function linhasFiltradas(nomeReceita, versaoFiltro) {
    if (!grafState.sheetData || !grafState.colReceita) return [];
    const { headers, data } = grafState.sheetData;
    const iR = headers.indexOf(grafState.colReceita);
    if (iR === -1) return [];
    const iV = grafState.colVersao ? headers.indexOf(grafState.colVersao) : -1;
    let linhas = data.filter(r => String(r[iR]||'').trim() === nomeReceita);
    if (versaoFiltro && iV >= 0) linhas = linhas.filter(r => String(r[iV]||'').trim() === versaoFiltro);
    grafState.filtros.forEach(({col,op,val}) => {
      if (!col || val === '') return;
      const i = headers.indexOf(col); if (i === -1) return;
      linhas = linhas.filter(r => aplicarOperador(String(r[i]||''), op, val, r));
    });
    return linhas;
  }
  // Valores válidos de uma coluna + o CP correspondente (alinhados).
  function dadosReceitaComCP(nomeReceita, coluna, versaoFiltro) {
    if (!grafState.sheetData || !coluna) return [];
    const { headers } = grafState.sheetData;
    const iC = headers.indexOf(coluna); if (iC === -1) return [];
    const iCP = colCP(headers);
    return linhasFiltradas(nomeReceita, versaoFiltro)
      .map(r => ({ v: r[iC], cp: iCP >= 0 ? r[iCP] : null }))
      .filter(p => {
        const s = String(p.v ?? '').trim();
        if (s === '' || s === 'null' || s === 'undefined') return false;
        const nv = numBR(s);
        if (!isNaN(nv) && nv === 0) return false;
        return true;
      });
  }

  // Pedido do Naor: pontos com TODOS os campos do hover (resistência, data, CP,
  // receita) e a COR da linha definida pela receita — muda ponto a ponto;
  // quando uma receita reaparece, reusa a mesma cor.
  const RECEITA_CORES = ['#2a5298','#e05c3a','#e8a030','#2a6640','#8a2be2','#1a9aa0','#c0392b','#16a085'];
  function pontosComReceita(grupo, coluna, versaoFiltro) {
    if (!grafState.sheetData || !coluna) return [];
    const { headers } = grafState.sheetData;
    const iC = headers.indexOf(coluna); if (iC === -1) return [];
    const iCP   = colCP(headers);
    const iRec  = headers.findIndex(h => String(h).trim().toUpperCase() === 'RECEITA');
    const iData = headers.findIndex(h => String(h).trim().toUpperCase() === 'DATA');
    const pts = linhasFiltradas(grupo, versaoFiltro)
      .map(r => ({
        v:       r[iC],
        cp:      iCP   >= 0 ? r[iCP]   : null,
        receita: iRec  >= 0 ? String(r[iRec] || '').trim() : '',
        data:    iData >= 0 ? r[iData] : '',
      }))
      .filter(p => {
        const s = String(p.v ?? '').trim();
        if (s === '' || s === 'null' || s === 'undefined') return false;
        const nv = numBR(s);
        if (!isNaN(nv) && nv === 0) return false;
        return true;
      });
    const mapaCor = new Map(); let prox = 0;
    pts.forEach(p => {
      const k = p.receita || '—';
      if (!mapaCor.has(k)) { mapaCor.set(k, RECEITA_CORES[prox % RECEITA_CORES.length]); prox++; }
      p.color = mapaCor.get(k);
    });
    return pts;
  }

  // px por ponto abaixo dos quais ativamos scroll horizontal
  const MIN_PX_PER_POINT = 8;
  // altura do .graf-widget-header (px) — usado para calcular innerH
  const HEADER_H = 36;

  /* ── INIT ─────────────────────────────────────── */
  function init() {
    carregarLayout();
    bindToolbar();
    renderTemplatesList();
    window.addEventListener('concrestats:datachanged', () => { try { if (document.getElementById('module-graficos').style.display !== 'none') sincronizarComPlanilha(); } catch(_){} });
  }

  /* ── TOOLBAR ──────────────────────────────────── */
  function bindToolbar() {
    document.getElementById('graf-btn-refresh').addEventListener('click', sincronizarComPlanilha);

    document.getElementById('graf-btn-versao').addEventListener('click', () => {
      grafState.separaPorVersao = !grafState.separaPorVersao;
      document.getElementById('graf-btn-versao').classList.toggle('active', grafState.separaPorVersao);
      renderTodosContainers();
    });

    document.getElementById('graf-col-receita').addEventListener('change', e => {
      grafState.colReceita = e.target.value || null;
      sincronizarComPlanilha();
    });
    document.getElementById('graf-col-versao').addEventListener('change', e => {
      grafState.colVersao = e.target.value || null;
      if (grafState.separaPorVersao) renderTodosContainers();
    });

    document.getElementById('graf-btn-filtros').addEventListener('click', () => {
      const p = document.getElementById('graf-filtros-panel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('graf-btn-add-filtro').addEventListener('click', adicionarFiltroRow);
    document.getElementById('graf-btn-aplicar-filtros').addEventListener('click', aplicarFiltros);
    document.getElementById('graf-btn-limpar-filtros').addEventListener('click', limparFiltros);

    document.getElementById('graf-search').addEventListener('input', e => {
      grafState.recSearch = e.target.value.toLowerCase();
      filtrarContainers();
    });

    document.getElementById('graf-btn-templates').addEventListener('click', () => {
      const p = document.getElementById('graf-templates-panel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('graf-btn-salvar-template').addEventListener('click', salvarTemplate);
    document.getElementById('graf-btn-fechar-templates').addEventListener('click', () => {
      document.getElementById('graf-templates-panel').style.display = 'none';
    });
  }

  /* ── SINCRONIZAR ─────────────────────────────── */
  function sincronizarComPlanilha() {
    // Usa a visão FILTRADA do grid (igual ao Dashboard/Relatório), para que os
    // filtros da planilha atualizem os gráficos sem precisar reiniciar.
    const sd    = window.getConcrestatsData ? window.getConcrestatsData({ filtered: true }) : window.currentSheetData;
    const aviso = document.getElementById('graf-aviso-planilha');
    if (!sd || !sd.headers || !sd.headers.length) { aviso.style.display = 'block'; return; }
    aviso.style.display = 'none';
    grafState.sheetData = sd;
    atualizarSelectores();
    detectarReceitas();
    renderTodosContainers();
    salvarLayout();
  }

  function atualizarSelectores() {
    const { headers } = grafState.sheetData;
    const colRec = document.getElementById('graf-col-receita');
    const colVer = document.getElementById('graf-col-versao');

    colRec.innerHTML = '<option value="">— coluna —</option>' +
      headers.map(h => `<option value="${esc(h)}" ${h===grafState.colReceita?'selected':''}>${esc(h)}</option>`).join('');
    colVer.innerHTML = '<option value="">— (nenhuma) —</option>' +
      headers.map(h => `<option value="${esc(h)}" ${h===grafState.colVersao?'selected':''}>${esc(h)}</option>`).join('');

    if (!grafState.colReceita) {
      const f = headers.find(h => ['RECEITA','PRODUTO','RECIPE','MIX','TRAÇO','TRACO','NOME'].includes(h.trim().toUpperCase()));
      if (f) { grafState.colReceita = f; colRec.value = f; }
    }
    if (!grafState.colVersao) {
      const f = headers.find(h => ['VERSAO','VERSÃO','VERSION','VERSÕES','VERSOES'].includes(h.trim().toUpperCase()));
      if (f) { grafState.colVersao = f; colVer.value = f; }
    }
    document.querySelectorAll('#graf-filtros-regras .gf-col').forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = headers.map(h => `<option value="${esc(h)}" ${h===cur?'selected':''}>${esc(h)}</option>`).join('');
    });
  }

  /* ── DETECTAR RECEITAS ───────────────────────── */
  function detectarReceitas() {
    if (!grafState.colReceita || !grafState.sheetData) return;
    const { headers, data } = grafState.sheetData;
    const iR = headers.indexOf(grafState.colReceita);
    if (iR === -1) return;
    const nomes = [...new Set(data.map(r => String(r[iR]||'').trim()).filter(Boolean))].sort();
    grafState.receitas = nomes.map(nome => ({
      id: slugify(nome), nome,
      versoes: detectarVersoes(nome, headers, data, iR),
    }));
  }

  function detectarVersoes(nome, headers, data, iR) {
    if (!grafState.colVersao) return [];
    const iV = headers.indexOf(grafState.colVersao);
    if (iV === -1) return [];
    const linhas = data.filter(r => String(r[iR]||'').trim() === nome);
    return [...new Set(linhas.map(r => String(r[iV]||'').trim()).filter(Boolean))].sort();
  }

  /* ── RENDER CONTAINERS ───────────────────────── */
  function renderTodosContainers() {
    const area = document.getElementById('graf-containers-area');
    Object.values(grafState.chartInstances).forEach(c => { try { c.destroy(); } catch(_) {} });
    grafState.chartInstances = {};
    area.innerHTML = '';

    if (!grafState.receitas.length) {
      area.innerHTML = `<div class="graf-empty-state"><div class="empty-icon">◈</div>
        <p>Nenhuma receita detectada</p>
        <p class="empty-sub">Selecione a coluna de receita na barra acima e clique em Sincronizar</p></div>`;
      return;
    }
    grafState.receitas.forEach(rec => {
      if (grafState.recSearch && !rec.nome.toLowerCase().includes(grafState.recSearch)) return;
      area.appendChild(criarContainerReceita(rec));
    });
  }

  function criarContainerReceita(rec) {
    const wrap = document.createElement('div');
    wrap.className = 'graf-receita-wrap';
    wrap.dataset.recId = rec.id;

    const chipsHtml = (grafState.separaPorVersao && rec.versoes.length)
      ? rec.versoes.map(v => `<button class="graf-versao-chip" data-versao="${esc(v)}">${esc(v)}</button>`).join('') : '';

    const isEditing = grafState.editMode.has(rec.id);

    const header = document.createElement('div');
    header.className = 'graf-receita-header';
    header.innerHTML = `
      <span class="graf-receita-nome">${esc(rec.nome)}</span>
      <div class="graf-receita-actions">
        ${chipsHtml}
        <button class="graf-btn-add-widget">+ Dado</button>
        <button class="graf-btn-add-chart">+ Gráfico</button>
        <button class="graf-btn-aplicar-tpl" title="Aplicar template">⬇ Template</button>
        <button class="graf-btn-edit-layout ${isEditing ? 'active' : ''}" title="Editar layout deste container">${isEditing ? '✓ Edição ON' : '⊞ Layout'}</button>
      </div>`;
    wrap.appendChild(header);

    const container = document.createElement('div');
    container.className = 'graf-container' + (grafState.editMode.has(rec.id) ? ' edit-mode' : '');
    container.dataset.recId = rec.id;
    wrap.appendChild(container);

    header.querySelectorAll('.graf-versao-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        header.querySelectorAll('.graf-versao-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderWidgetsNoContainer(rec, container, chip.dataset.versao);
      });
    });
    header.querySelector('.graf-btn-add-widget').addEventListener('click', () => abrirModalWidget(rec, container));
    header.querySelector('.graf-btn-add-chart').addEventListener('click',  () => abrirModalGrafico(rec, container));
    header.querySelector('.graf-btn-aplicar-tpl').addEventListener('click',() => abrirModalAplicarTemplate(rec, container));
    header.querySelector('.graf-btn-edit-layout').addEventListener('click', () => toggleEditModeContainer(rec, container, header));

    renderWidgetsNoContainer(rec, container);
    return wrap;
  }

  function renderWidgetsNoContainer(rec, container, versaoFiltro) {
    const layout = grafState.layouts[rec.id] || [];
    layout.forEach(item => {
      // destruir plotChart e yChart (modo scroll)
      [item.id, item.id + '_y'].forEach(id => {
        if (grafState.chartInstances[id]) {
          try { grafState.chartInstances[id].destroy(); } catch(_) {}
          delete grafState.chartInstances[id];
        }
      });
    });
    container.innerHTML = '';

    if (!layout.length) {
      container.innerHTML = `<div class="graf-container-empty">
        Clique em <strong>+ Dado</strong> ou <strong>+ Gráfico</strong> para adicionar visualizações</div>`;
      return;
    }

    let maxBottom = 0, maxRight = 0;
    layout.forEach(item => {
      const b = (item.y||0)+(item.h||100); if (b>maxBottom) maxBottom=b;
      const r = (item.x||0)+(item.w||160); if (r>maxRight) maxRight=r;
    });
    container.style.minHeight = snapMin(maxBottom + GRID*2, 120) + 'px';
    // largura mínima = widget mais largo (habilita o scroll horizontal)
    container.style.minWidth = (maxRight + GRID*2) + 'px';

    layout.forEach(item => {
      const el = item.type === 'chart'
        ? criarWidgetGrafico(rec, item, versaoFiltro)
        : criarWidgetDado(rec, item, versaoFiltro);
      if (!el) return;
      el.style.position = 'absolute';
      el.style.left = snap(item.x||0) + 'px';
      el.style.top  = snap(item.y||0) + 'px';
      container.appendChild(el);
    });

    if (grafState.editMode.has(rec.id)) ativarDragNoContainer(container, rec);
  }

  /* ── WIDGET DADO ─────────────────────────────── */
  function criarWidgetDado(rec, item, versaoFiltro) {
    const dados  = filtrarDadosReceita(rec.nome, item.config.coluna, versaoFiltro);
    const res    = calcularEstatistica(dados, item.config.stat, fckFromNome(rec.nome));
    const titulo = item.config.titulo || item.config.stat;

    const el = document.createElement('div');
    el.className   = 'graf-widget graf-widget-dado';
    el.dataset.wid = item.id;
    el.style.width  = snap(item.w||160) + 'px';
    el.style.height = snap(item.h||100) + 'px';
    el.innerHTML = `
      <div class="graf-widget-header">
        <span class="graf-widget-title">${esc(titulo)}</span>
        <span class="graf-widget-col">${esc(item.config.coluna||'—')}</span>
      </div>
      <div class="graf-widget-body"><div class="graf-stat-valor">${res.valor}</div></div>`;
    bindWidgetCtx(el, item, rec, 'dado');
    return el;
  }

  /* ── WIDGET GRÁFICO ──────────────────────────── */
  /*
   * Estratégia para scroll horizontal SEM perder o eixo Y:
   *
   *  .graf-widget-chart                  (tamanho fixo do widget)
   *    .graf-widget-header               (36px — título)
   *    .graf-widget-canvas-outer         (flex row, altura = widgetH - HEADER_H)
   *      canvas#yaxis                    (largura fixa ~56px, height=innerH — só eixo Y)
   *      .graf-widget-scroll-area        (flex:1, overflow-x:auto, height=innerH)
   *        canvas#plot                   (largura variável, height=innerH — só plot)
   *
   * Usamos dois Charts do Chart.js vinculados:
   *   - chartY: tipo 'bar'/'line' com apenas eixo Y visível,
   *             sem dados, width = 56px (espaço do eixo)
   *   - chartX: gráfico real sem eixo Y, width = max(availW, n*MIN_PX_PER_POINT)
   *
   * Quando NÃO há necessidade de scroll, usamos um único canvas normal
   * (comportamento simples, sem overhead de dois charts).
   */
  function criarWidgetGrafico(rec, item, versaoFiltro) {
    const cfg      = item.config;
    const titulo   = cfg.titulo || `${cfg.colunaY||'Y'} x ${cfg.colunaX||'Amostra'}`;
    const widgetW  = snap(item.w||640);
    const widgetH  = snap(item.h||400);
    const innerH   = widgetH - HEADER_H; // altura da area de plot

    const el = document.createElement('div');
    el.className   = 'graf-widget graf-widget-chart';
    el.dataset.wid = item.id;
    el.style.width  = widgetW + 'px';
    el.style.height = widgetH + 'px';
    bindWidgetCtx(el, item, rec, 'chart');

    requestAnimationFrame(() => {
      const ptsY   = pontosComReceita(rec.nome, cfg.colunaY, versaoFiltro);
      const dadosY = ptsY.map(p => p.v);
      const dadosX = cfg.colunaX
        ? filtrarDadosReceita(rec.nome, cfg.colunaX, versaoFiltro)
        : dadosY.map((_, i) => i+1);

      // Impede gráfico vazio: mostra um aviso em vez de eixos sem dados.
      if (!dadosY.length) {
        el.innerHTML = `
          <div class="graf-widget-header">
            <span class="graf-widget-title">${esc(titulo)}</span>
            <span class="graf-widget-chart-type">${esc(cfg.tipoGrafico||'Linha')}</span>
          </div>
          <div class="graf-chart-error" style="display:flex;align-items:center;justify-content:center;height:${innerH}px;color:var(--text-3);text-align:center;padding:0 12px">Sem dados para "${esc(cfg.colunaY||'')}" nesta receita/filtro</div>`;
        return;
      }

      const tipo      = mapChartType(cfg.tipoGrafico);
      const isScatter = tipo === 'scatter';
      const color     = COLORS[Object.keys(grafState.chartInstances).length % COLORS.length];
      const n         = dadosY.length;

      // Largura disponível para o plot (sem bordas do widget)
      const availW     = widgetW - 2;
      const minPlotW   = isScatter ? availW : Math.max(availW, n * MIN_PX_PER_POINT);
      const needsScroll = !isScatter && minPlotW > availW;

      // ── Dados indexados (fix do bug "linha não chega ao fim") ──────
      let chartData, xLabels;
      if (isScatter) {
        chartData = dadosX.map((x, i) => ({ x: +x||i+1, y: +dadosY[i]||0, cp: ptsY[i].cp, receita: ptsY[i].receita, data: ptsY[i].data, color: ptsY[i].color }));
        xLabels   = undefined;
      } else {
        chartData = dadosY.map((v, i) => ({ x: i, y: +v || 0, cp: ptsY[i].cp, receita: ptsY[i].receita, data: ptsY[i].data, color: ptsY[i].color }));
        xLabels   = dadosX.map((v, i) => cfg.colunaX ? String(v) : `#${i+1}`);
      }

      // ── Plugin: linha horizontal ───────────────────────────────────
      const linhaH = numBR(cfg.linhaH);
      const linhaHPlugin = !isNaN(linhaH) ? [{
        id: 'linhaH',
        afterDraw(chart) {
          const { ctx, scales: { y } } = chart;
          if (!y) return;
          const yPx = y.getPixelForValue(linhaH);
          if (yPx < chart.chartArea.top || yPx > chart.chartArea.bottom) return;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(chart.chartArea.left,  yPx);
          ctx.lineTo(chart.chartArea.right, yPx);
          ctx.lineWidth   = 1.5;
          ctx.strokeStyle = cfg.linhaHCor || '#e05c3a';
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.restore();
          ctx.save();
          ctx.font      = '10px IBM Plex Mono, monospace';
          ctx.fillStyle = cfg.linhaHCor || '#e05c3a';
          ctx.fillText(
            cfg.linhaHLabel ? `${cfg.linhaHLabel} (${linhaH})` : String(linhaH),
            chart.chartArea.left + 4, yPx - 4
          );
          ctx.restore();
        },
      }] : [];

      // ── Opções comuns de escalas ───────────────────────────────────
      const xScaleOpts = {
        type: isScatter ? 'linear' : 'linear',
        min:  isScatter ? undefined : 0,
        max:  isScatter ? undefined : Math.max(0, n - 1),
        ticks: {
          font: { family: 'IBM Plex Mono', size: 10 },
          maxTicksLimit: Math.max(4, Math.floor((needsScroll ? minPlotW : availW) / 60)),
          callback: isScatter ? undefined : (val) => {
            const idx = Math.round(val);
            return (xLabels && xLabels[idx] !== undefined) ? xLabels[idx] : '';
          },
        },
        grid: { color: '#e8e6e1' },
      };
      const yScaleOpts = {
        ticks: { font: { family: 'IBM Plex Mono', size: 10 } },
        grid:  { color: '#e8e6e1' },
      };
      const datasetBase = {
        label:           cfg.colunaY || 'Valor',
        data:            chartData,
        borderColor:     color,
        backgroundColor: tipo === 'bar' ? color+'bb' : color+'22',
        borderWidth:     2,
        pointRadius:     isScatter ? 4 : (n > 200 ? 0 : 2),
        fill:            cfg.tipoGrafico === 'Área',
        tension:         0.3,
      };

      // ════════════════════════════════════════════════════════════════
      // CASO A: sem scroll — um canvas simples, responsivo
      // ════════════════════════════════════════════════════════════════
      if (!needsScroll) {
        el.innerHTML = `
          <div class="graf-widget-header">
            <span class="graf-widget-title">${esc(titulo)}</span>
            <span class="graf-widget-chart-type">${esc(cfg.tipoGrafico||'Linha')}</span>
          </div>
          <div class="graf-widget-canvas-wrap" style="height:${innerH}px;overflow:hidden">
            <canvas style="width:100%;height:${innerH}px"></canvas>
          </div>`;

        const canvas = el.querySelector('canvas');
        try {
          const chart = new Chart(canvas, {
            type: isScatter ? 'scatter' : tipo,
            plugins: linhaHPlugin,
            data: { datasets: [datasetBase] },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: { duration: n > 500 ? 0 : 300 },
              plugins: {
                legend: { display:true, position:'top', labels:{font:{family:'IBM Plex Mono',size:11}} },
                tooltip: {
                  mode: isScatter ? 'point' : 'index', intersect: false,
                  callbacks: { title: (items) => {
                    if (isScatter) return `x: ${items[0]?.parsed?.x}`;
                    const idx = items[0]?.parsed?.x;
                    return xLabels ? xLabels[idx] : `#${idx+1}`;
                  }},
                },
              },
              scales: { x: xScaleOpts, y: yScaleOpts },
            },
          });
          grafState.chartInstances[item.id] = chart;
        } catch(e) {
          el.querySelector('.graf-widget-canvas-wrap').innerHTML =
            `<div class="graf-chart-error">Erro: ${esc(e.message)}</div>`;
        }
        return;
      }

      // ════════════════════════════════════════════════════════════════
      // CASO B: scroll horizontal — dois canvas lado a lado
      //
      // |  yCanvas (fixo)  |  plotCanvas (scrollável)  |
      //
      // yCanvas: Chart.js com eixo Y visível, área de plot oculta (largura 0)
      //          e SEM dados (só para renderizar o eixo)
      // plotCanvas: Chart.js com o gráfico real, eixo Y OCULTO
      //
      // Os dois charts compartilham os mesmos dados de Y para que o
      // eixo Y do yCanvas use a mesma escala do plotCanvas.
      // Fazemos isso via afterLayout: copiamos yMin/yMax do plotCanvas
      // para o yCanvas usando plugin de sincronização.
      // ════════════════════════════════════════════════════════════════
      const Y_AXIS_W = 56; // largura reservada para o eixo Y (px)

      el.innerHTML = `
        <div class="graf-widget-header">
          <span class="graf-widget-title">${esc(titulo)}</span>
          <span class="graf-widget-chart-type">${esc(cfg.tipoGrafico||'Linha')}</span>
        </div>
        <div class="graf-widget-canvas-outer" style="display:flex;flex-direction:row;height:${innerH}px;overflow:hidden">
          <canvas class="graf-yaxis-canvas" width="${Y_AXIS_W}" height="${innerH}"
                  style="width:${Y_AXIS_W}px;height:${innerH}px;flex-shrink:0"></canvas>
          <div class="graf-scroll-area" style="flex:1;overflow-x:auto;overflow-y:hidden;height:${innerH}px">
            <canvas class="graf-plot-canvas" width="${minPlotW}" height="${innerH}"
                    style="width:${minPlotW}px;min-width:${minPlotW}px;height:${innerH}px;display:block"></canvas>
          </div>
        </div>`;

      const yCanvas   = el.querySelector('.graf-yaxis-canvas');
      const plotCanvas = el.querySelector('.graf-plot-canvas');

      // Estado compartilhado de limites Y (sincronizado após layout)
      let sharedYMin = null, sharedYMax = null;

      // Plugin: após o plotChart calcular os limites, sincroniza com yChart
      const syncPlugin = {
        id: 'syncY',
        afterLayout(chart) {
          const yScale = chart.scales.y;
          if (!yScale) return;
          if (sharedYMin === yScale.min && sharedYMax === yScale.max) return;
          sharedYMin = yScale.min;
          sharedYMax = yScale.max;
          // Forçar re-render do yChart com os novos limites
          if (chart._yChartRef) {
            chart._yChartRef.options.scales.y.min = sharedYMin;
            chart._yChartRef.options.scales.y.max = sharedYMax;
            chart._yChartRef.update('none');
          }
        },
      };

      try {
        // ── plotChart: gráfico real, sem eixo Y ──────────────────────
        const plotChart = new Chart(plotCanvas, {
          type: tipo,
          plugins: [...linhaHPlugin, syncPlugin],
          data: { datasets: [{
            ...datasetBase,
            clip: false,   // pontos nas bordas não são cortados pelo clip do canvas
          }] },
          options: {
            responsive:          false,
            maintainAspectRatio: false,
            animation: { duration: n > 500 ? 0 : 300 },
            layout: { padding: { left: 6, right: 6, top: 6 } },
            plugins: {
              legend: { display: false }, // legend só no yChart
              tooltip: {
                mode: 'index', intersect: false,
                callbacks: { title: (items) => {
                  const idx = items[0]?.parsed?.x;
                  return xLabels ? xLabels[idx] : `#${idx+1}`;
                }},
              },
            },
            scales: {
              x: xScaleOpts,
              y: {
                ...yScaleOpts,
                display: false, // eixo Y oculto no plot
              },
            },
          },
        });

        // ── yChart: "gráfico fantasma" apenas para renderizar o eixo Y ─
        // Usa o mesmo range de dados para que Chart.js calcule a escala correta.
        // Depois que o plotChart roda afterLayout, sincronizamos os limites.
        const yChart = new Chart(yCanvas, {
          type: tipo,
          data: { datasets: [{ ...datasetBase, borderWidth: 0, pointRadius: 0, backgroundColor: 'transparent', borderColor: 'transparent' }] },
          options: {
            responsive:          false,
            maintainAspectRatio: false,
            animation:           false,
            layout: { padding: { right: 0 } },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                labels: { font: { family: 'IBM Plex Mono', size: 11 } },
              },
              tooltip: { enabled: false },
            },
            scales: {
              x: {
                display: false,
                type: 'linear',
                min: 0, max: Math.max(0, n - 1),
              },
              y: {
                ...yScaleOpts,
                // Limites serão sobrescritos pelo syncPlugin após plotChart fazer layout
              },
            },
          },
        });

        // Vincular referência circular para sincronização
        plotChart._yChartRef = yChart;

        // Forçar sincronização inicial
        const yS = plotChart.scales.y;
        if (yS) {
          yChart.options.scales.y.min = yS.min;
          yChart.options.scales.y.max = yS.max;
          yChart.update('none');
        }

        // Guardar ambos para destruição posterior
        // Armazenamos como array usando o id do item
        grafState.chartInstances[item.id]         = plotChart;
        grafState.chartInstances[item.id + '_y']  = yChart;

      } catch(e) {
        el.querySelector('.graf-widget-canvas-outer').innerHTML =
          `<div class="graf-chart-error">Erro: ${esc(e.message)}</div>`;
      }
    });

    return el;
  }

  function mapChartType(t) {
    return {Linha:'line',Barra:'bar','Dispersão':'scatter','Área':'line',Histograma:'bar'}[t]||'line';
  }

  /* ── ESTATÍSTICA ─────────────────────────────── */
  function calcularEstatistica(dados, stat, fck) {
    const nums = dados.map(v=>numBR(v)).filter(v=>!isNaN(v));
    const n = nums.length;
    if (!n) return {valor:'—',n:0};
    const sorted = [...nums].sort((a,b)=>a-b);
    const sum  = nums.reduce((a,b)=>a+b,0);
    const mean = sum/n;
    const sd   = stdDev(nums, mean);
    switch(stat) {
      case 'Média':                return {valor:mean.toFixed(2),n};
      case 'Desvio Padrão':        return {valor:sd.toFixed(3),n};
      case 'Mínimo':               return {valor:sorted[0].toFixed(2),n};
      case 'Máximo':               return {valor:sorted[sorted.length-1].toFixed(2),n};
      case 'Mediana': {
        const m=Math.floor(n/2);
        return {valor:(n%2?sorted[m]:(sorted[m-1]+sorted[m])/2).toFixed(2),n};
      }
      case 'P95 (95º Percentil)': {
        const p   = 95 / 100 * (n - 1);
        const lo  = Math.floor(p);
        const hi  = Math.ceil(p);
        const p95 = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
        return {valor:p95.toFixed(2),n};
      }
      case 'fck est. (Méd−1,65σ)':
        // Resistência característica estimada (NBR 12655): fck,est = média − 1,65 · desvio padrão amostral.
        return {valor:(mean-1.65*sd).toFixed(2),n};
      case 'Contagem':             return {valor:String(n),n};
      case 'Soma':                 return {valor:sum.toFixed(2),n};
      case '% Aprovação': {
        // Aprovação = valores ≥ FCK (resistência característica). Se o FCK não
        // puder ser lido do nome da receita, mantém o fallback (85% da média).
        const ref = (!isNaN(fck) && fck > 0) ? fck : mean*0.85;
        const a=nums.filter(v=>v>=ref).length;
        return {valor:`${(a/n*100).toFixed(1)}%`,n};
      }
      default:                     return {valor:mean.toFixed(2),n};
    }
  }
  function stdDev(nums, mean) {
    if (nums.length<2) return 0;
    return Math.sqrt(nums.reduce((s,v)=>s+Math.pow(v-mean,2),0)/(nums.length-1));
  }

  /* ── FILTRAR DADOS ───────────────────────────── */
  function filtrarDadosReceita(nomeReceita, coluna, versaoFiltro) {
    if (!grafState.sheetData||!coluna||!grafState.colReceita) return [];
    const {headers,data} = grafState.sheetData;
    const iR = headers.indexOf(grafState.colReceita);
    const iV = grafState.colVersao ? headers.indexOf(grafState.colVersao) : -1;
    const iC = headers.indexOf(coluna);
    if (iR===-1||iC===-1) return [];

    let linhas = data.filter(r=>String(r[iR]||'').trim()===nomeReceita);
    if (versaoFiltro&&iV>=0) linhas=linhas.filter(r=>String(r[iV]||'').trim()===versaoFiltro);

    grafState.filtros.forEach(({col,op,val})=>{
      if (!col||val==='') return;
      const i=headers.indexOf(col); if(i===-1)return;
      linhas=linhas.filter(r=>aplicarOperador(String(r[i]||''),op,val,r));
    });

    return linhas.map(r=>r[iC]).filter(v=>{
      if(v===null||v===undefined) return false;
      const s=String(v).trim();
      if(s===''||s==='null'||s==='undefined') return false;
      const nv=numBR(s);
      if(!isNaN(nv)&&nv===0) return false;
      return true;
    });
  }

  /* ── PARSE DATA ──────────────────────────────── */
  function parseFilterDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const d = new Date(str + 'T00:00:00');
      return isNaN(d) ? null : d.getTime();
    }
    const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (dmy) {
      const year = dmy[3].length===2 ? 2000+parseInt(dmy[3]) : parseInt(dmy[3]);
      const d = new Date(year, parseInt(dmy[2])-1, parseInt(dmy[1]));
      return isNaN(d) ? null : d.getTime();
    }
    return null;
  }

  /* ── RESOLVER EXPRESSÃO DE FILTRO ────────────── */
  function resolveExprFiltro(vs, row) {
    const headers   = grafState.sheetData?.headers || [];
    let vsTrimmed = String(vs ?? '').trim();
    if (/\{FCK\}/i.test(vsTrimmed)) {
      const f = fckRow(row);
      vsTrimmed = vsTrimmed.replace(/\{FCK\}/ig, isNaN(f) ? '0' : String(f));
    }

    if (parseFilterDate(vsTrimmed) !== null) return { num: null, raw: vsTrimmed };

    let rawFirst = null, hasRef = false;
    const expr = vsTrimmed.replace(/\[([^\]]+)\]/g, (_, colName) => {
      hasRef = true;
      const idx = headers.indexOf(colName);
      const cellVal = idx >= 0 && row ? String(row[idx] ?? '').trim() : '0';
      if (rawFirst === null) rawFirst = cellVal;
      const n = numBR(cellVal);
      return isNaN(n) ? '0' : String(n);
    });

    if (/^\[([^\]]+)\]$/.test(vsTrimmed) && rawFirst !== null) {
      const n = numBR(rawFirst);
      return { num: isNaN(n) ? null : n, raw: rawFirst };
    }

    if (hasRef) {
      try {
        if (/[^0-9+\-*/%.\s()eE]/.test(expr)) throw new Error('unsafe');
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result === 'number' && isFinite(result))
          return { num: result, raw: String(result) };
      } catch(_) {}
    }

    return { num: null, raw: vsTrimmed };
  }

  /* ── APLICAR OPERADOR ────────────────────────── */
  function aplicarOperador(celula, op, val, row) {
    const cs = String(celula ?? '').trim();
    const vs = String(val    ?? '').trim();
    const resolved = resolveExprFiltro(vs, row);

    if (resolved.num === null) {
      const cd = parseFilterDate(cs);
      const vd = parseFilterDate(resolved.raw);
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

    const cn = numBR(cs);
    const vn = resolved.num !== null ? resolved.num : numBR(resolved.raw);
    const numOk = !isNaN(cn) && !isNaN(vn);

    switch (op) {
      case '==':      return numOk ? cn===vn : cs.toLowerCase()===resolved.raw.toLowerCase();
      case '!=':      return numOk ? cn!==vn : cs.toLowerCase()!==resolved.raw.toLowerCase();
      case 'contém':  return cs.toLowerCase().includes(resolved.raw.toLowerCase());
      case '!contém': return !cs.toLowerCase().includes(resolved.raw.toLowerCase());
      case 'começa':  return cs.toLowerCase().startsWith(resolved.raw.toLowerCase());
      case 'termina': return cs.toLowerCase().endsWith(resolved.raw.toLowerCase());
      case '>':       return numOk ? cn>vn  : cs.localeCompare(resolved.raw)>0;
      case '>=':      return numOk ? cn>=vn : cs.localeCompare(resolved.raw)>=0;
      case '<':       return numOk ? cn<vn  : cs.localeCompare(resolved.raw)<0;
      case '<=':      return numOk ? cn<=vn : cs.localeCompare(resolved.raw)<=0;
      case 'regex':   try{return new RegExp(resolved.raw,'i').test(cs);}catch(_){return false;}
      default:        return cs.toLowerCase().includes(resolved.raw.toLowerCase());
    }
  }

  /* ── CONTEXT MENU ────────────────────────────── */
  function bindWidgetCtx(el, item, rec, tipo) {
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      fecharCtxMenu();
      const menu = document.createElement('div');
      menu.id = 'graf-ctx-menu';
      menu.className = 'context-menu';
      menu.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;display:block`;
      menu.innerHTML = `
        <div class="ctx-item" data-a="rename">✏ Renomear</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" data-a="config">⚙ Configurar</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" data-a="delete">✕ Remover</div>`;
      document.body.appendChild(menu);
      menu.querySelector('[data-a="rename"]').onclick = () => {
        fecharCtxMenu();
        const n = prompt('Novo nome:', item.config.titulo||'');
        if (n===null) return;
        item.config.titulo = n.trim(); salvarLayout();
        renderWidgetsNoContainer(rec, el.closest('.graf-container'));
      };
      menu.querySelector('[data-a="config"]').onclick = () => {
        fecharCtxMenu();
        const c = el.closest('.graf-container');
        tipo==='dado' ? abrirModalWidget(rec,c,item) : abrirModalGrafico(rec,c,item);
      };
      menu.querySelector('[data-a="delete"]').onclick = () => {
        fecharCtxMenu();
        // Destruir plotChart e yChart
        [item.id, item.id + '_y'].forEach(id => {
          if (grafState.chartInstances[id]) {
            try { grafState.chartInstances[id].destroy(); } catch(_) {}
            delete grafState.chartInstances[id];
          }
        });
        grafState.layouts[rec.id]=(grafState.layouts[rec.id]||[]).filter(i=>i.id!==item.id);
        salvarLayout(); renderWidgetsNoContainer(rec, el.closest('.graf-container'));
      };
      const onOut = ev=>{if(!menu.contains(ev.target)){fecharCtxMenu();document.removeEventListener('mousedown',onOut);}};
      setTimeout(()=>document.addEventListener('mousedown',onOut),0);
    });
  }
  function fecharCtxMenu(){document.getElementById('graf-ctx-menu')?.remove();}

  /* ── MODAL: DADO ─────────────────────────────── */
  function abrirModalWidget(rec, container, itemExist) {
    const headers=grafState.sheetData?.headers||[];
    const cfg=itemExist?.config||{};
    const colOpts=headers.map(h=>`<option value="${esc(h)}" ${h===cfg.coluna?'selected':''}>${esc(h)}</option>`).join('');
    const stOpts=STATS.map(s=>`<option value="${s}" ${s===cfg.stat?'selected':''}>${s}</option>`).join('');
    abrirModalGraf(itemExist?'Editar Dado':'Novo Dado',`
      <label>Título (opcional)</label>
      <input id="gw-titulo" type="text" value="${esc(cfg.titulo||'')}" placeholder="ex: Resistência 28d">
      <label style="margin-top:14px">Coluna de dados</label>
      <select id="gw-coluna"><option value="">— selecione —</option>${colOpts}</select>
      <label style="margin-top:14px">Estatística</label>
      <select id="gw-stat">${stOpts}</select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
        <div><label>Largura (px)</label><input id="gw-w" type="number" value="${snap(itemExist?.w||160)}" min="100" max="3000" step="${GRID}"></div>
        <div><label>Altura (px)</label><input id="gw-h" type="number" value="${snap(itemExist?.h||100)}" min="60" max="800" step="${GRID}"></div>
      </div>`,()=>{
      const coluna=document.getElementById('gw-coluna').value;
      if(!coluna){showT('Selecione uma coluna','error');return;}
      upsertItem(rec,{id:itemExist?.id||genId(),type:'dado',
        config:{titulo:document.getElementById('gw-titulo').value.trim(),coluna,stat:document.getElementById('gw-stat').value},
        x:itemExist?.x??0,y:itemExist?.y??autoY(rec.id,snap(itemExist?.h||100)),
        w:snapMin(parseInt(document.getElementById('gw-w').value)||160,100),
        h:snapMin(parseInt(document.getElementById('gw-h').value)||100,60)});
      fecharModalGraf(); renderWidgetsNoContainer(rec,container);
    });
  }

  /* ── MODAL: GRÁFICO ──────────────────────────── */
  function abrirModalGrafico(rec, container, itemExist) {
    const headers=grafState.sheetData?.headers||[];
    const cfg=itemExist?.config||{};
    const colY=headers.map(h=>`<option value="${esc(h)}" ${h===cfg.colunaY?'selected':''}>${esc(h)}</option>`).join('');
    const colX=headers.map(h=>`<option value="${esc(h)}" ${h===cfg.colunaX?'selected':''}>${esc(h)}</option>`).join('');
    const tOpts=CHART_TYPES.map(t=>`<option value="${t}" ${t===cfg.tipoGrafico?'selected':''}>${t}</option>`).join('');

    abrirModalGraf(itemExist?'Editar Gráfico':'Novo Gráfico',`
      <label>Título (opcional)</label>
      <input id="gc-titulo" type="text" value="${esc(cfg.titulo||'')}" placeholder="ex: MPa 28 ao longo do tempo">
      <label style="margin-top:14px">Tipo de gráfico</label><select id="gc-tipo">${tOpts}</select>
      <label style="margin-top:14px">Coluna Eixo Y</label>
      <select id="gc-colunaY"><option value="">— selecione —</option>${colY}</select>
      <label style="margin-top:14px">Coluna Eixo X</label>
      <select id="gc-colunaX"><option value="">— automático (nº da amostra) —</option>${colX}</select>

      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:14px">
        <p style="font-size:10px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:10px">Linha de Referência (opcional)</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div><label>Valor Y</label>
            <input id="gc-linhaH" type="number" step="any" value="${esc(cfg.linhaH??'')}" placeholder="ex: 25">
          </div>
          <div><label>Cor</label>
            <input id="gc-linhaHCor" type="color" value="${cfg.linhaHCor||'#e05c3a'}" style="width:100%;height:32px;border:1px solid var(--border);border-radius:3px;padding:2px;cursor:pointer">
          </div>
          <div><label>Rótulo</label>
            <input id="gc-linhaHLabel" type="text" value="${esc(cfg.linhaHLabel||'')}" placeholder="ex: FCK mín">
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
        <div><label>Largura (px)</label><input id="gc-w" type="number" value="${snap(itemExist?.w||640)}" min="200" max="3000" step="${GRID}"></div>
        <div><label>Altura (px)</label><input id="gc-h" type="number" value="${snap(itemExist?.h||400)}" min="100" max="900" step="${GRID}"></div>
      </div>`,()=>{
      const colunaY=document.getElementById('gc-colunaY').value;
      if(!colunaY){showT('Selecione a coluna Y','error');return;}
      // Destruir plotChart e yChart se editando
      if(itemExist){
        [itemExist.id, itemExist.id+'_y'].forEach(id=>{
          if(grafState.chartInstances[id]){
            try{grafState.chartInstances[id].destroy();}catch(_){}
            delete grafState.chartInstances[id];
          }
        });
      }
      const linhaHVal = document.getElementById('gc-linhaH').value.trim();
      upsertItem(rec,{id:itemExist?.id||genId(),type:'chart',
        config:{
          titulo:      document.getElementById('gc-titulo').value.trim(),
          tipoGrafico: document.getElementById('gc-tipo').value,
          colunaY,
          colunaX:     document.getElementById('gc-colunaX').value||null,
          linhaH:      linhaHVal !== '' ? parseFloat(linhaHVal) : undefined,
          linhaHCor:   document.getElementById('gc-linhaHCor').value,
          linhaHLabel: document.getElementById('gc-linhaHLabel').value.trim(),
        },
        x:itemExist?.x??0,y:itemExist?.y??autoY(rec.id,snap(itemExist?.h||400)),
        w:snapMin(parseInt(document.getElementById('gc-w').value)||640,200),
        h:snapMin(parseInt(document.getElementById('gc-h').value)||400,100)});
      fecharModalGraf(); renderWidgetsNoContainer(rec,container);
    });
  }

  function autoY(recId,h){
    const layout=grafState.layouts[recId]||[];
    if(!layout.length)return 0;
    return snap(Math.max(...layout.map(i=>(i.y||0)+(i.h||100)))+GRID);
  }

  function abrirModalGraf(titulo,bodyHtml,onOk){
    const ov=document.getElementById('modal-overlay');
    document.getElementById('modal-content').innerHTML=`
      <div class="modal-header"><span>${titulo}</span>
        <button id="gm-x" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:18px">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button class="secondary-btn" id="gm-cancel">Cancelar</button>
        <button class="primary-btn" id="gm-ok">Confirmar</button></div>`;
    ov.style.display='flex';
    document.getElementById('gm-x').onclick=document.getElementById('gm-cancel').onclick=fecharModalGraf;
    document.getElementById('gm-ok').onclick=onOk;
    setTimeout(()=>ov.querySelector('input,select')?.focus(),50);
  }
  function fecharModalGraf(){document.getElementById('modal-overlay').style.display='none';}

  function upsertItem(rec,item){
    if(!grafState.layouts[rec.id])grafState.layouts[rec.id]=[];
    const idx=grafState.layouts[rec.id].findIndex(i=>i.id===item.id);
    if(idx>=0)grafState.layouts[rec.id][idx]=item;
    else grafState.layouts[rec.id].push(item);
    salvarLayout();
  }

  /* ── TOGGLE EDIT MODE (por container) ──────── */
  function toggleEditModeContainer(rec, container, header) {
    const editing = grafState.editMode.has(rec.id);
    if (editing) {
      grafState.editMode.delete(rec.id);
    } else {
      grafState.editMode.add(rec.id);
    }
    const nowEditing = grafState.editMode.has(rec.id);

    const btn = header.querySelector('.graf-btn-edit-layout');
    btn.textContent = nowEditing ? '✓ Edição ON' : '⊞ Layout';
    btn.classList.toggle('active', nowEditing);

    container.classList.toggle('edit-mode', nowEditing);
    container.style.position  = 'relative';
    container.style.minHeight = nowEditing ? '300px' : '';

    if (nowEditing) {
      ativarDragNoContainer(container, rec);
    } else {
      // Desativar cursores grab nos headers dos widgets
      container.querySelectorAll('.graf-widget-header').forEach(h => {
        h.style.cursor = '';
        h._dragBound   = false;
      });
    }
  }

  /* ── TOGGLE EDIT MODE (legado — não usado) ── */
  function toggleEditMode() {}

  function ativarDragNoContainer(container,rec){
    container.style.position='relative';
    container.querySelectorAll('.graf-widget').forEach(widget=>{
      const handle=widget.querySelector('.graf-widget-header');
      if(!handle||handle._dragBound)return;
      handle._dragBound=true; handle.style.cursor='grab';
      handle.addEventListener('mousedown',function onDown(e){
        if(!grafState.editMode.has(rec.id))return;
        if(e.target.closest('.graf-widget-chart-type,.graf-widget-col'))return;
        e.preventDefault();
        const cr=container.getBoundingClientRect();
        const offX=e.clientX-cr.left-(parseInt(widget.style.left)||0);
        const offY=e.clientY-cr.top-(parseInt(widget.style.top)||0);
        widget.style.zIndex='100'; handle.style.cursor='grabbing';
        function onMove(ev){
          if(!grafState.editMode)return;
          let nl=snap(ev.clientX-cr.left-offX);
          let nt=snap(ev.clientY-cr.top-offY);
          nl=Math.max(0,Math.min(nl,snap(container.offsetWidth-widget.offsetWidth)));
          nt=Math.max(0,Math.min(nt,Math.max(0,snap(container.offsetHeight-widget.offsetHeight))));
          widget.style.left=nl+'px'; widget.style.top=nt+'px';
          const needed=snap(nt+widget.offsetHeight+GRID*2);
          if(needed>container.offsetHeight)container.style.minHeight=needed+'px';
        }
        function onUp(){
          handle.style.cursor='grab'; widget.style.zIndex='';
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onUp);
          const wid=widget.dataset.wid;
          const itm=(grafState.layouts[rec.id]||[]).find(i=>i.id===wid);
          if(itm){itm.x=snap(parseInt(widget.style.left)||0);itm.y=snap(parseInt(widget.style.top)||0);salvarLayout();}
        }
        document.addEventListener('mousemove',onMove);
        document.addEventListener('mouseup',onUp);
      });
    });
  }

  /* ── TEMPLATES ───────────────────────────────── */
  function salvarTemplate(){
    const recSel=document.getElementById('graf-tpl-receita-sel').value;
    const nome=document.getElementById('graf-tpl-nome').value.trim();
    if(!nome){showT('Digite um nome para o template','error');return;}
    if(!recSel){showT('Selecione a receita de origem','error');return;}
    const lo=grafState.layouts[recSel];
    if(!lo||!lo.length){showT('A receita selecionada não tem widgets para salvar','error');return;}
    grafState.templates[nome]=JSON.parse(JSON.stringify(lo)).map(item=>({...item,id:genId()}));
    salvarLayout(); renderTemplatesList();
    showT(`Template "${nome}" salvo`,'success');
    document.getElementById('graf-tpl-nome').value='';
  }

  function abrirModalAplicarTemplate(rec,container){
    const nomes=Object.keys(grafState.templates);
    if(!nomes.length){showT('Nenhum template salvo. Crie um no painel Templates.','error');return;}
    const opts=nomes.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    abrirModalGraf(`Aplicar Template — ${esc(rec.nome)}`,`
      <label>Template</label><select id="at-tpl">${opts}</select>
      <label style="margin-top:12px">Como aplicar</label>
      <select id="at-modo">
        <option value="substituir">Substituir o conteúdo atual</option>
        <option value="adicionar">Adicionar ao conteúdo atual</option>
      </select>
      <p style="margin-top:12px;font-size:11px;color:var(--text-3)">
        "Substituir" deixa a receita igual ao template (mesmo comportamento do "⬇ Todas").</p>`,()=>{
      const nomeTpl=document.getElementById('at-tpl').value;
      const modo=document.getElementById('at-modo').value;
      const tpl=grafState.templates[nomeTpl]; if(!tpl)return;
      const clone=ti=>{const n=JSON.parse(JSON.stringify(ti));n.id=genId();return n;};
      if(modo==='substituir'){
        // apaga o conteúdo existente antes de aplicar (bug: antes só somava)
        grafState.layouts[rec.id]=tpl.map(clone);
      }else{
        if(!grafState.layouts[rec.id])grafState.layouts[rec.id]=[];
        const ex=grafState.layouts[rec.id];
        const offsetY=ex.length?snap(Math.max(...ex.map(i=>(i.y||0)+(i.h||100)))+GRID):0;
        tpl.forEach(ti=>{const n=clone(ti);n.y=snap((n.y||0)+offsetY);ex.push(n);});
      }
      salvarLayout(); fecharModalGraf(); renderWidgetsNoContainer(rec,container);
      showT(`Template "${nomeTpl}" aplicado`,'success');
    });
  }

  // Conveniência (pedido do Naor): adiciona o template a TODAS as receitas de uma vez.
  function aplicarTemplateATodas(nomeTpl){
    const tpl=grafState.templates[nomeTpl];
    if(!tpl||!tpl.length){showT('Template vazio','error');return;}
    const recs=grafState.receitas||[];
    if(!recs.length){showT('Nenhuma receita carregada','error');return;}
    if(!confirm(`Isto vai SUBSTITUIR o conteúdo atual de todas as ${recs.length} receitas pelo template "${nomeTpl}". Continuar?`))return;
    recs.forEach(rec=>{
      // substitui: apaga o conteúdo existente do container antes de aplicar o template
      grafState.layouts[rec.id]=tpl.map(ti=>{const n=JSON.parse(JSON.stringify(ti));n.id=genId();return n;});
    });
    salvarLayout(); renderTodosContainers();
    showT(`Template "${nomeTpl}" aplicado a ${recs.length} receitas`,'success');
  }

  function renderTemplatesList(){
    const lista=document.getElementById('graf-templates-lista');
    const nomes=Object.keys(grafState.templates);
    const recSel=document.getElementById('graf-tpl-receita-sel');
    if(recSel){
      recSel.innerHTML='<option value="">— receita de origem —</option>'+
        grafState.receitas.map(r=>`<option value="${esc(r.id)}">${esc(r.nome)}</option>`).join('');
    }
    if(!nomes.length){lista.innerHTML='<span class="graf-tpl-empty">Nenhum template salvo</span>';return;}
    lista.innerHTML=nomes.map(n=>{
      const c=grafState.templates[n]?.length||0;
      return `<div class="graf-tpl-item">
        <span class="graf-tpl-nome">${esc(n)}</span>
        <span class="graf-tpl-count">${c} widget${c!==1?'s':''}</span>
        <button class="graf-tpl-btn-all" data-tpl="${esc(n)}" title="Adicionar este template a TODAS as receitas">⬇ Todas</button>
        <button class="graf-tpl-btn-del" data-tpl="${esc(n)}" title="Excluir template">✕</button></div>`;
    }).join('');
    lista.querySelectorAll('.graf-tpl-btn-all').forEach(btn=>{
      btn.onclick=()=>aplicarTemplateATodas(btn.dataset.tpl);
    });
    lista.querySelectorAll('.graf-tpl-btn-del').forEach(btn=>{
      btn.onclick=()=>{
        if(!confirm(`Excluir template "${btn.dataset.tpl}"?`))return;
        delete grafState.templates[btn.dataset.tpl]; salvarLayout(); renderTemplatesList(); showT('Template excluído');
      };
    });
  }

  /* ── FILTROS ─────────────────────────────────── */
  const OPERADORES=['contém','!contém','==','!=','>','>=','<','<=','começa','termina','regex'];

  function adicionarFiltroRow(){
    const headers=grafState.sheetData?.headers||[];
    if(!headers.length){showT('Carregue uma planilha primeiro','error');return;}
    const uid=Date.now();
    const colOpts=headers.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
    const refOpts=headers.map(h=>`<option value="[${esc(h)}]">[${esc(h)}]</option>`).join('');
    const opOpts=OPERADORES.map(o=>`<option value="${o}">${o}</option>`).join('');
    const row=document.createElement('div');
    row.className='filter-rule';
    row.innerHTML=`
      <select class="gf-col">${colOpts}</select>
      <select class="gf-op" style="min-width:90px">${opOpts}</select>
      <input class="gf-val" type="text" list="gref-${uid}" placeholder="Valor ou [Coluna]">
      <datalist id="gref-${uid}">${refOpts}</datalist>
      <button class="remove-filter" title="Remover">×</button>`;
    row.querySelector('.remove-filter').onclick=()=>{row.remove();};
    document.getElementById('graf-filtros-regras').appendChild(row);
  }

  function aplicarFiltros(){
    grafState.filtros=[];
    document.querySelectorAll('#graf-filtros-regras .filter-rule').forEach(row=>{
      const col=row.querySelector('.gf-col').value;
      const op=row.querySelector('.gf-op').value;
      const val=row.querySelector('.gf-val').value;
      if(col)grafState.filtros.push({col,op,val});
    });
    renderTodosContainers();
    showT(`${grafState.filtros.length} filtro(s) aplicado(s)`,'success');
  }

  function limparFiltros(){
    grafState.filtros=[];
    document.getElementById('graf-filtros-regras').innerHTML='';
    renderTodosContainers(); showT('Filtros removidos');
  }

  function filtrarContainers(){
    document.querySelectorAll('.graf-receita-wrap').forEach(wrap=>{
      const nome=(wrap.querySelector('.graf-receita-nome')?.textContent||'').toLowerCase();
      wrap.style.display=(!grafState.recSearch||nome.includes(grafState.recSearch))?'':'none';
    });
  }

  /* ── PERSISTÊNCIA ────────────────────────────── */
  // Grava em localStorage (cache rápido) E em /api/prefs (arquivo prefs.json ao
  // lado do exe) — templates/layouts sobrevivem a fechar o app e trocar de PC.
  function salvarLayout(){
    localStorage.setItem('concrelab_graf_layouts',  JSON.stringify(grafState.layouts));
    localStorage.setItem('concrelab_graf_templates',JSON.stringify(grafState.templates));
    try{
      fetch('/api/prefs',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({graf_layouts:grafState.layouts, graf_templates:grafState.templates})});
    }catch(_){}
  }
  function carregarLayout(){
    try{
      const l=localStorage.getItem('concrelab_graf_layouts');
      const t=localStorage.getItem('concrelab_graf_templates');
      if(l)grafState.layouts=JSON.parse(l);
      if(t)grafState.templates=JSON.parse(t);
    }catch(_){}
    // Servidor é a fonte de verdade: mescla por cima do cache e re-renderiza.
    try{
      fetch('/api/prefs').then(r=>r.ok?r.json():null).then(p=>{
        if(!p)return;
        if(p.graf_layouts   && typeof p.graf_layouts==='object')  grafState.layouts  = p.graf_layouts;
        if(p.graf_templates && typeof p.graf_templates==='object')grafState.templates= p.graf_templates;
        renderTemplatesList();
        if(grafState.colReceita) renderTodosContainers();
      }).catch(()=>{});
    }catch(_){}
  }

  /* ── UTILITÁRIOS ─────────────────────────────── */
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function slugify(s){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'r_'+Math.random().toString(36).slice(2,7);}
  function genId(){return 'w_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
  function showT(msg,tipo){if(typeof window.showToast==='function')window.showToast(msg,tipo);}

  /* ── GLOBAL ──────────────────────────────────── */
  window.GraficosModule = {
    onModuleEnter() { sincronizarComPlanilha(); renderTemplatesList(); },
  };

  init();

})();
