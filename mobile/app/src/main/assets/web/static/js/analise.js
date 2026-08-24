/**
 * analise.js — Módulo Análise (BI genérico, Fase 1)
 * Funciona com QUALQUER planilha: mapeamento de colunas (Data/Valor/Categoria),
 * KPIs, evolução por período (total ou empilhado), top categorias (barra/pizza),
 * slicers com filtro cruzado (clicar no gráfico filtra tudo) e tabela dinâmica
 * com export xlsx. Mapeamento persistido em /api/prefs por planilha.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  /* ── helpers numéricos/data (mesma semântica do dashboard) ── */
  function num(v){if(v===null||v===undefined)return NaN;if(typeof v==='number')return isFinite(v)?v:NaN;let s=String(v).trim().replace(/\s/g,'');if(!s)return NaN;s=s.replace(/[^0-9,\.\-]/g,'');if(!s||s==='-'||s===','||s==='.')return NaN;if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',', '.');else s=s.replace(/,/g,'');}else if(s.includes(','))s=s.replace(',', '.');const n=Number(s);return isFinite(n)?n:NaN;}
  function parseKey(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return`${m[1]}-${m[2]}`;const b=String(v||'').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);if(b)return`${b[3]}-${String(b[2]).padStart(2,'0')}`;return null;}
  function fmt(n,d=2){return isNaN(n)?'—':n.toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d});}
  function fmt0(n){return fmt(n, Math.abs(n)>=1000?0:2);}

  const COLORS = ['#2a5298','#e05c3a','#2a6640','#8a2be2','#e8a030','#1a9aa0','#c0392b','#27ae60','#5d6d7e','#b7950b','#7d3c98','#148f77'];
  const OPS = ['Soma','Média','Contagem','Mínimo','Máximo'];

  const state = {
    sheet: null,
    map: { data: null, valor: null, cat: null },
    fil: { periodo: null, cats: new Set() },
    pivot: { linha: null, op: 'Soma' },
    evolTipo: 'total',   // 'total' | 'stack'
    catTipo: 'barra',    // 'barra' | 'pizza'
    perfil: 'geral',     // 'geral' | 'financeiro' | 'engenharia'
    prefsMaps: {},
  };

  const PERFIS = [['geral', 'Geral'], ['financeiro', 'Financeiro'], ['engenharia', 'Engenharia']];
  // Formata valor conforme o perfil (financeiro ganha R$).
  const mon = v => (state.perfil === 'financeiro' ? 'R$ ' : '') + fmt0(v);
  function autoPerfil(headers) {
    const H = headers.map(h => String(h).toUpperCase());
    if (H.some(h => /MPA|FCK|TNF|SLUMP/.test(h))) return 'engenharia';
    if (H.some(h => /R\$|VALOR|RECEITA|DESPESA|CUSTO|FATURA|PRE[ÇC]O/.test(h))) return 'financeiro';
    return 'geral';
  }

  /* ── dados ─────────────────────────────────────── */
  function fonte() {
    const d = window.getConcrestatsData ? window.getConcrestatsData({ filtered: false }) : null;
    if (!d || !d.headers || !d.headers.length) return null;
    return { headers: d.headers, rows: d.fullData || d.data || [] };
  }

  // Numérico ESTRITO p/ detecção: só dígitos/separadores (e R$). Sem isso,
  // códigos como "C0"/"NF-123" viravam 0 e roubavam a coluna Valor.
  function isStrictNum(v) {
    if (typeof v === 'number') return isFinite(v);
    const s = String(v ?? '').trim().replace(/R\$|\s/g, '');
    return !!s && /^-?\d[\d.,]*$/.test(s);
  }

  function autoDetect(headers, rows) {
    const N = Math.min(rows.length, 400);
    const dateS = headers.map(() => 0), numS = headers.map(() => 0), sets = headers.map(() => new Set());
    for (let r = 0; r < N; r++) {
      const row = rows[r] || [];
      headers.forEach((h, i) => {
        const v = row[i];
        if (parseKey(v)) dateS[i]++;
        else if (isStrictNum(v)) numS[i]++;
        const s = String(v ?? '').trim(); if (s) sets[i].add(s);
      });
    }
    const arg = a => a.indexOf(Math.max(...a));
    const map = { data: null, valor: null, cat: null };
    if (Math.max(...dateS) > N * 0.3) map.data = headers[arg(dateS)];
    const numScore = numS.map((v, i) => headers[i] === map.data ? -1 : v);
    if (Math.max(...numScore) > N * 0.3) map.valor = headers[arg(numScore)];
    let best = -1, bi = -1;
    headers.forEach((h, i) => {
      if (h === map.data || h === map.valor) return;
      const d = sets[i].size;
      if (d < 2 || d > Math.max(3, N * 0.6)) return;
      const score = N / d;
      if (score > best) { best = score; bi = i; }
    });
    if (bi >= 0) map.cat = headers[bi];
    return map;
  }

  function salvarMapa() {
    if (!state.sheet) return;
    state.prefsMaps[state.sheet] = { ...state.map, perfil: state.perfil };
    try {
      fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analise_maps: state.prefsMaps }) });
    } catch (_) {}
  }

  function linhasFiltradas(f) {
    const iD = f.headers.indexOf(state.map.data);
    const iC = f.headers.indexOf(state.map.cat);
    return f.rows.filter(r => {
      if (state.fil.periodo && iD >= 0 && parseKey(r[iD]) !== state.fil.periodo) return false;
      if (state.fil.cats.size && iC >= 0 && !state.fil.cats.has(String(r[iC] ?? '').trim())) return false;
      return true;
    });
  }

  function agg(vals, op) {
    const ns = vals.filter(v => !isNaN(v));
    if (op === 'Contagem') return vals.length;
    if (!ns.length) return NaN;
    if (op === 'Soma') return ns.reduce((a, b) => a + b, 0);
    if (op === 'Média') return ns.reduce((a, b) => a + b, 0) / ns.length;
    if (op === 'Mínimo') return Math.min(...ns);
    if (op === 'Máximo') return Math.max(...ns);
    return NaN;
  }

  /* ── tooltip compartilhado ─────────────────────── */
  let _tip = null;
  function tip() {
    if (!_tip) {
      _tip = document.createElement('div');
      _tip.style.cssText = 'position:fixed;z-index:99999;background:#1b1b18;color:#fff;border:1px solid #555;padding:5px 8px;font:11px IBM Plex Mono,monospace;display:none;pointer-events:none;border-radius:3px;max-width:320px;line-height:1.4';
      document.body.appendChild(_tip);
    }
    return _tip;
  }
  function bindHits(canvas, hitFn) {
    canvas.addEventListener('mousemove', e => {
      const h = hitFn(e);
      if (!h) { tip().style.display = 'none'; canvas.style.cursor = 'default'; return; }
      tip().innerHTML = h.html; canvas.style.cursor = 'pointer';
      tip().style.left = (e.clientX + 12) + 'px'; tip().style.top = (e.clientY + 12) + 'px';
      tip().style.display = 'block';
    });
    canvas.addEventListener('mouseleave', () => { tip().style.display = 'none'; });
  }
  function canvasXY(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setupCanvas(canvas, fh) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 700, h = canvas.clientHeight || fh;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ── gráfico: barras simples (com clique) ──────── */
  function drawBars(canvas, labels, values, onClick, fmtVal) {
    const { ctx, w, h } = setupCanvas(canvas, 300);
    ctx.clearRect(0, 0, w, h);
    const left = 56, right = 12, top = 14;
    ctx.font = '10px IBM Plex Mono, monospace';
    let mx = 0; labels.forEach(l => { const t = String(l).slice(0, 24); const tw = ctx.measureText(t).width; if (tw > mx) mx = tw; });
    const bottom = Math.min(150, Math.max(40, Math.ceil(mx) + 14));
    const max = Math.max(...values.map(v => isNaN(v) ? 0 : v), 1);
    const min = Math.min(...values.map(v => isNaN(v) ? 0 : v), 0);
    ctx.strokeStyle = '#ececea'; ctx.fillStyle = '#888'; ctx.font = '11px IBM Plex Mono, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = top + (h - top - bottom) * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillText(fmt0(max - (max - min) * i / 4), 4, y + 4);
    }
    const plotW = w - left - right, plotH = h - top - bottom, baseY = top + plotH;
    const slot = plotW / Math.max(1, values.length), bw = Math.max(4, Math.min(52, slot * 0.7));
    const bars = [];
    values.forEach((v, i) => {
      const vv = isNaN(v) ? 0 : v;
      const x = left + slot * i + (slot - bw) / 2;
      const y0 = top + plotH * (1 - (Math.max(vv, 0) - min) / (max - min || 1));
      const y1 = top + plotH * (1 - (Math.min(vv, 0) - min) / (max - min || 1));
      const sel = state.fil.cats.has(String(labels[i])) || state.fil.periodo === String(labels[i]);
      ctx.fillStyle = vv < 0 ? '#b33a2a' : (sel ? '#e8a030' : COLORS[0]);
      ctx.fillRect(x, y0, bw, Math.max(2, y1 - y0));
      bars.push({ x, w: bw, label: String(labels[i]), v: vv });
    });
    // valor no topo da barra quando há espaço (leitura sem hover)
    if (slot >= 44) {
      ctx.fillStyle = '#5a5852'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
      values.forEach((v, i) => {
        const vv = isNaN(v) ? 0 : v;
        const y0 = top + plotH * (1 - (Math.max(vv, 0) - min) / (max - min || 1));
        ctx.fillText(fmt0(vv), left + slot * i + slot / 2, y0 - 4);
      });
      ctx.textAlign = 'start';
    }
    ctx.fillStyle = '#555'; ctx.font = '10px IBM Plex Mono, monospace';
    const step = slot >= 9 ? 1 : Math.ceil(9 / slot);
    labels.forEach((l, i) => {
      if (i % step) return;
      const cx = left + slot * i + slot / 2;
      const t = String(l).length > 24 ? String(l).slice(0, 24) + '…' : String(l);
      ctx.save(); ctx.translate(cx, baseY + 7); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(t, 0, 3); ctx.restore();
    });
    const hit = e => { const { x } = canvasXY(canvas, e); return bars.find(b => x >= b.x - 2 && x <= b.x + b.w + 2); };
    bindHits(canvas, e => { const b = hit(e); return b ? { html: `<b>${esc(b.label)}</b><br>${(fmtVal || fmt0)(b.v)}` } : null; });
    if (onClick) canvas.addEventListener('click', e => { const b = hit(e); if (b) onClick(b.label); });
  }

  /* ── gráfico: barras empilhadas por categoria ──── */
  function drawStacked(canvas, labels, series, onClick) {
    const { ctx, w, h } = setupCanvas(canvas, 300);
    ctx.clearRect(0, 0, w, h);
    const left = 56, right = 12, top = 14, bottom = 46;
    const totals = labels.map((_, i) => series.reduce((s, sr) => s + (sr.vals[i] > 0 ? sr.vals[i] : 0), 0));
    const max = Math.max(...totals, 1);
    ctx.strokeStyle = '#ececea'; ctx.fillStyle = '#888'; ctx.font = '11px IBM Plex Mono, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = top + (h - top - bottom) * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillText(fmt0(max - max * i / 4), 4, y + 4);
    }
    const plotW = w - left - right, plotH = h - top - bottom, baseY = top + plotH;
    const slot = plotW / Math.max(1, labels.length), bw = Math.max(6, Math.min(52, slot * 0.7));
    const segs = [];
    labels.forEach((lab, i) => {
      const x = left + slot * i + (slot - bw) / 2;
      let acc = 0;
      series.forEach((sr, si) => {
        const v = Math.max(0, sr.vals[i] || 0); if (!v) return;
        const y1 = top + plotH * (1 - acc / max);
        acc += v;
        const y0 = top + plotH * (1 - acc / max);
        ctx.fillStyle = COLORS[si % COLORS.length];
        ctx.fillRect(x, y0, bw, Math.max(1, y1 - y0));
        segs.push({ x, w: bw, y0, y1, per: String(lab), cat: sr.nome, v });
      });
    });
    ctx.fillStyle = '#555'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
    const step = slot >= 46 ? 1 : Math.ceil(46 / slot);
    labels.forEach((l, i) => { if (i % step) return; ctx.fillText(String(l), left + slot * i + slot / 2, baseY + 16); });
    ctx.textAlign = 'start';
    const hit = e => { const { x, y } = canvasXY(canvas, e); return segs.find(s => x >= s.x && x <= s.x + s.w && y >= s.y0 && y <= s.y1); };
    bindHits(canvas, e => { const s = hit(e); return s ? { html: `<b>${esc(s.cat)}</b><br>${esc(s.per)} · ${fmt0(s.v)}` } : null; });
    if (onClick) canvas.addEventListener('click', e => { const s = hit(e); if (s) onClick(s.cat); });
  }

  /* ── gráfico: pizza/donut ──────────────────────── */
  function drawDonut(canvas, labels, values, onClick) {
    const { ctx, w, h } = setupCanvas(canvas, 300);
    ctx.clearRect(0, 0, w, h);
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cx = Math.min(h * 0.62, w * 0.32), cy = h / 2, R = Math.min(cx - 12, h / 2 - 14), r = R * 0.55;
    let a0 = -Math.PI / 2;
    const slices = [];
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const sel = state.fil.cats.has(String(labels[i]));
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, sel ? R + 5 : R, a0, a1); ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fill();
      slices.push({ a0, a1, label: String(labels[i]), v, pct: frac * 100 });
      a0 = a1;
    });
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#fafaf7'; ctx.fill();
    ctx.fillStyle = '#1c1b18'; ctx.font = '600 13px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(fmt0(total), cx, cy + 1); ctx.font = '9px IBM Plex Mono, monospace'; ctx.fillStyle = '#9a968e';
    ctx.fillText('total', cx, cy + 14); ctx.textAlign = 'start';
    // legenda
    ctx.font = '11px IBM Plex Sans, sans-serif';
    const lx = cx + R + 26; let ly = Math.max(16, cy - slices.length * 9);
    slices.forEach((s, i) => {
      ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fillRect(lx, ly - 8, 9, 9);
      ctx.fillStyle = '#5a5852';
      const t = s.label.length > 30 ? s.label.slice(0, 30) + '…' : s.label;
      ctx.fillText(`${t} — ${fmt(s.pct, 1)}%`, lx + 14, ly);
      ly += 18;
    });
    const hit = e => {
      const { x, y } = canvasXY(canvas, e);
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d < r || d > R + 6) return null;
      let a = Math.atan2(dy, dx); if (a < -Math.PI / 2) a += Math.PI * 2;
      return slices.find(s => a >= s.a0 && a < s.a1);
    };
    bindHits(canvas, e => { const s = hit(e); return s ? { html: `<b>${esc(s.label)}</b><br>${fmt0(s.v)} · ${fmt(s.pct, 1)}%` } : null; });
    if (onClick) canvas.addEventListener('click', e => { const s = hit(e); if (s) onClick(s.label); });
  }

  /* ── filtros (cross-filter) ────────────────────── */
  function toggleCat(nome) {
    const s = String(nome);
    if (state.fil.cats.has(s)) state.fil.cats.delete(s); else state.fil.cats.add(s);
    render();
  }
  function togglePeriodo(p) {
    state.fil.periodo = state.fil.periodo === p ? null : p;
    render();
  }
  function limparFiltros() { state.fil.periodo = null; state.fil.cats.clear(); render(); }

  /* ── pivot ─────────────────────────────────────── */
  function pivotDados(f) {
    const iL = f.headers.indexOf(state.pivot.linha);
    const iV = f.headers.indexOf(state.map.valor);
    if (iL < 0) return null;
    const rows = linhasFiltradas(f);
    const g = new Map();
    rows.forEach(r => {
      const k = String(r[iL] ?? '—').trim() || '—';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(iV >= 0 ? num(r[iV]) : NaN);
    });
    const op = iV >= 0 ? state.pivot.op : 'Contagem';
    const linhas = [...g.entries()].map(([k, vals]) => ({ k, valor: agg(vals, op), n: vals.length }));
    linhas.sort((a, b) => (isNaN(b.valor) ? -1 : b.valor) - (isNaN(a.valor) ? -1 : a.valor));
    // Total geral com a MESMA operação sobre todos os valores filtrados.
    const todos = [];
    g.forEach(vals => todos.push(...vals));
    const totalGeral = op === 'Contagem' ? rows.length : agg(todos, op);
    return { linhas, op, totalGeral, totN: rows.length };
  }

  async function exportPivot() {
    const f = fonte(); if (!f) return;
    const p = pivotDados(f); if (!p || !p.linhas.length) { window.showToast?.('Sem dados para exportar', 'error'); return; }
    const cols = [state.pivot.linha, `${p.op} de ${state.map.valor || 'registros'}`, 'Contagem', '%'];
    const somaAbs = p.linhas.reduce((s, l) => s + (isNaN(l.valor) ? 0 : Math.abs(l.valor)), 0) || 1;
    const data = p.linhas.map(l => [l.k, isNaN(l.valor) ? '' : l.valor, l.n, (Math.abs(isNaN(l.valor) ? 0 : l.valor) / somaAbs * 100).toFixed(1) + '%']);
    try {
      const r = await fetch('/api/export_report_custom', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'xlsx', columns: cols, data, title: 'tabela_dinamica' }) });
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'tabela_dinamica.xlsx'; a.click();
      URL.revokeObjectURL(a.href);
    } catch (_) { window.showToast?.('Falha no export', 'error'); }
  }

  /* ── insights automáticos (em português) ───────── */
  function gerarInsights(f, rows, iD, iV, iC) {
    const ins = [];
    const nomeMes = k => { const m = String(k).match(/^(\d{4})-(\d{2})$/); if (!m) return k;
      const M = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      return `${M[+m[2] - 1]}/${m[1]}`; };

    if (iD >= 0 && iV >= 0) {
      const porPer = new Map();
      rows.forEach(r => { const k = parseKey(r[iD]); if (!k) return; const v = num(r[iV]); if (isNaN(v)) return;
        porPer.set(k, (porPer.get(k) || 0) + v); });
      const pers = [...porPer.keys()].sort();
      if (pers.length >= 2) {
        const a = porPer.get(pers[pers.length - 2]), b = porPer.get(pers[pers.length - 1]);
        if (a) {
          const d = (b - a) / Math.abs(a) * 100;
          ins.push({ cls: d >= 0 ? 'up' : 'down', ico: d >= 0 ? '▲' : '▼',
            txt: `${nomeMes(pers[pers.length - 1])} fechou em ${mon(b)} — ${d >= 0 ? 'alta' : 'queda'} de ${fmt(Math.abs(d), 1)}% sobre ${nomeMes(pers[pers.length - 2])}` });
        }
      }
      if (pers.length >= 4) {
        let seq = 0; // >0: subidas consecutivas no fim da série; <0: quedas
        for (let i = pers.length - 1; i > 0; i--) {
          const dif = porPer.get(pers[i]) - porPer.get(pers[i - 1]);
          const dir = dif > 0 ? 1 : dif < 0 ? -1 : 0;
          if (!dir) break;
          if (seq === 0 || (seq > 0) === (dir > 0)) seq += dir; else break;
        }
        if (seq <= -3) ins.push({ cls: 'warn', ico: '!', txt: `${Math.abs(seq)} períodos seguidos de queda — vale investigar` });
        if (seq >= 3)  ins.push({ cls: 'up',  ico: '▲', txt: `${seq} períodos seguidos de crescimento` });
      }
      if (pers.length >= 3) {
        let bk = pers[0]; pers.forEach(k => { if (porPer.get(k) > porPer.get(bk)) bk = k; });
        ins.push({ cls: 'info', ico: '★', txt: `Melhor período: ${nomeMes(bk)} (${mon(porPer.get(bk))})` });
      }
    }

    if (iC >= 0 && iV >= 0 && rows.length) {
      const g = new Map();
      let tot = 0;
      rows.forEach(r => { const v = num(r[iV]); if (isNaN(v)) return;
        const c = String(r[iC] ?? '—').trim() || '—';
        g.set(c, (g.get(c) || 0) + v); tot += Math.abs(v); });
      const top = [...g.entries()].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0];
      if (top && tot > 0) {
        const pct = Math.abs(top[1]) / tot * 100;
        if (pct >= 25) ins.push({ cls: pct > 50 ? 'warn' : 'info', ico: pct > 50 ? '!' : '◔',
          txt: `“${top[0]}” concentra ${fmt(pct, 1)}% do total${pct > 50 ? ' — alta dependência' : ''}` });
      }
    }

    if (iV >= 0) {
      const vals = rows.map(r => num(r[iV])).filter(v => !isNaN(v));
      if (vals.length >= 8) {
        const m = vals.reduce((s, v) => s + v, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1));
        const outs = vals.filter(v => Math.abs(v - m) > 2.5 * sd);
        if (outs.length) ins.push({ cls: 'warn', ico: '◎',
          txt: `${outs.length} valor(es) fora do padrão — extremo: ${mon(outs.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0))}` });
      }
      const negs = vals.filter(v => v < 0);
      if (negs.length) ins.push({ cls: 'down', ico: '−',
        txt: `${negs.length} lançamento(s) negativo(s)${state.perfil === 'financeiro' ? ' (estornos?)' : ''} somando ${mon(negs.reduce((a, b) => a + b, 0))}` });
      const semValor = rows.length - vals.length;
      if (semValor > 0) ins.push({ cls: 'warn', ico: '×',
        txt: `${semValor} linha(s) sem valor numérico — ficam fora dos cálculos` });
    }
    return ins.slice(0, 6).map(i => ({ ...i, txt: esc(i.txt) }));
  }

  /* ── render ────────────────────────────────────── */
  function selHtml(id, headers, cur, extra) {
    const opts = ['<option value="">—</option>']
      .concat(headers.map(h => `<option value="${esc(h)}" ${h === cur ? 'selected' : ''}>${esc(h)}</option>`));
    return `<label class="ana-lab">${extra}</label><select id="${id}" class="ana-select">${opts.join('')}</select>`;
  }

  function render() {
    const body = $('ana-body'); if (!body) return;
    const f = fonte();
    if (!f) {
      body.innerHTML = '<div class="graf-empty-state"><div class="empty-icon">◈</div><p>Abra uma planilha para analisar</p><p class="empty-sub">O módulo Análise funciona com qualquer arquivo Excel/CSV</p></div>';
      $('ana-info') && ($('ana-info').textContent = 'Sem planilha ativa');
      return;
    }
    const d = window.getConcrestatsData();
    if (d.activeSheet !== state.sheet) {
      state.sheet = d.activeSheet;
      state.fil.periodo = null; state.fil.cats.clear();
      const saved = state.prefsMaps[state.sheet];
      state.map = saved ? { data: saved.data, valor: saved.valor, cat: saved.cat } : autoDetect(f.headers, f.rows);
      state.perfil = (saved && saved.perfil) || autoPerfil(f.headers);
      if (state.perfil === 'engenharia' && !saved) state.pivot.op = 'Média';
      state.pivot.linha = state.map.cat;
    }
    if (!state.pivot.linha || f.headers.indexOf(state.pivot.linha) < 0) state.pivot.linha = state.map.cat || f.headers[0];

    const iD = f.headers.indexOf(state.map.data);
    const iV = f.headers.indexOf(state.map.valor);
    const iC = f.headers.indexOf(state.map.cat);
    const rows = linhasFiltradas(f);

    /* KPIs */
    const vals = iV >= 0 ? rows.map(r => num(r[iV])).filter(v => !isNaN(v)) : [];
    const soma = vals.reduce((s, v) => s + v, 0);
    let delta = null, perAtual = null;
    if (iD >= 0 && iV >= 0) {
      const porPer = new Map();
      rows.forEach(r => { const k = parseKey(r[iD]); if (!k) return; const v = num(r[iV]); if (isNaN(v)) return; porPer.set(k, (porPer.get(k) || 0) + v); });
      const ks = [...porPer.keys()].sort();
      if (ks.length >= 2) {
        const a = porPer.get(ks[ks.length - 2]), b = porPer.get(ks[ks.length - 1]);
        perAtual = ks[ks.length - 1];
        if (a) delta = (b - a) / Math.abs(a) * 100;
      }
    }
    const deltaHtml = delta === null ? '—'
      : `<span class="${delta >= 0 ? 'ana-up' : 'ana-down'}">${delta >= 0 ? '▲' : '▼'} ${fmt(Math.abs(delta), 1)}%</span>`;

    /* chips de filtros ativos */
    const chips = [];
    if (state.fil.periodo) chips.push(`<span class="slicer-chip on" data-per="${esc(state.fil.periodo)}">${esc(state.fil.periodo)} ✕</span>`);
    state.fil.cats.forEach(c => chips.push(`<span class="slicer-chip on" data-cat="${esc(c)}">${esc(c.length > 26 ? c.slice(0, 26) + '…' : c)} ✕</span>`));

    /* slicer de categorias (top 12) */
    let catChips = '';
    if (iC >= 0) {
      const cont = new Map();
      f.rows.forEach(r => { const k = String(r[iC] ?? '').trim(); if (k) cont.set(k, (cont.get(k) || 0) + 1); });
      const top = [...cont.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      catChips = top.map(([k]) => `<span class="slicer-chip ${state.fil.cats.has(k) ? 'on' : ''}" data-cat="${esc(k)}">${esc(k.length > 22 ? k.slice(0, 22) + '…' : k)}</span>`).join('');
    }

    body.innerHTML = `
      <div class="ana-map-bar">
        ${selHtml('ana-map-data', f.headers, state.map.data, 'Data')}
        ${selHtml('ana-map-valor', f.headers, state.map.valor, 'Valor')}
        ${selHtml('ana-map-cat', f.headers, state.map.cat, 'Categoria')}
        <label class="ana-lab">Perfil</label>
        <select id="ana-perfil" class="ana-select" style="max-width:130px">
          ${PERFIS.map(([v, l]) => `<option value="${v}" ${v === state.perfil ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="ana-map-hint">← mapeie as colunas e toda a análise se adapta</span>
      </div>
      ${catChips ? `<div class="ana-slicers"><span class="ana-lab">Filtrar:</span>${catChips}${chips.length ? '<span class="toolbar-sep"></span>' + chips.join('') : ''}</div>` : (chips.length ? `<div class="ana-slicers">${chips.join('')}</div>` : '')}
      <div class="dash-grid-cards">
        <div class="dash-card"><b>${iV >= 0 ? mon(soma) : fmt0(rows.length)}</b><span>${iV >= 0 ? 'Total — ' + esc(state.map.valor) : 'Registros'}</span></div>
        <div class="dash-card"><b>${iV >= 0 && vals.length ? mon(soma / vals.length) : '—'}</b><span>Média por registro</span></div>
        <div class="dash-card"><b>${fmt(rows.length, 0)}</b><span>Registros${state.fil.periodo || state.fil.cats.size ? ' (filtrados)' : ''}</span></div>
        <div class="dash-card"><b>${deltaHtml}</b><span>${perAtual ? esc(perAtual) + ' vs anterior' : 'Variação período'}</span></div>
      </div>
      ${(() => { const insights = gerarInsights(f, rows, iD, iV, iC);
        return insights.length ? `<div class="dash-section ana-ins-sec"><h3>◈ Insights automáticos</h3>
          <div class="ana-ins">${insights.map(i => `<div class="ins-card ${i.cls}"><span class="ins-ico">${i.ico}</span><span>${i.txt}</span></div>`).join('')}</div>
        </div>` : ''; })()}
      ${iD >= 0 ? `
      <div class="dash-section"><h3>Evolução por período
        <span class="dash-toggle">
          <button class="dash-tgl ${state.evolTipo === 'total' ? 'on' : ''}" data-ev="total">Total</button>
          <button class="dash-tgl ${state.evolTipo === 'stack' ? 'on' : ''}" data-ev="stack" ${iC < 0 ? 'disabled' : ''}>Empilhado</button>
        </span></h3>
        <div class="dash-scroll"><canvas id="ana-evol" style="width:100%;height:280px"></canvas></div>
        <p class="ana-dica">clique numa barra para filtrar o período</p>
      </div>` : ''}
      ${iC >= 0 ? `
      <div class="dash-section"><h3>Por ${esc(state.map.cat)}
        <span class="dash-toggle">
          <button class="dash-tgl ${state.catTipo === 'barra' ? 'on' : ''}" data-ct="barra">Barras</button>
          <button class="dash-tgl ${state.catTipo === 'pizza' ? 'on' : ''}" data-ct="pizza">Pizza</button>
        </span></h3>
        <div class="dash-scroll"><canvas id="ana-cat" style="width:100%;height:300px"></canvas></div>
        <p class="ana-dica">clique para filtrar — os outros gráficos e a tabela acompanham</p>
      </div>` : ''}
      <div class="dash-section"><h3>Tabela dinâmica
        <span class="dash-toggle">
          ${selHtml('ana-piv-linha', f.headers, state.pivot.linha, 'Agrupar por')}
          <label class="ana-lab">Operação</label>
          <select id="ana-piv-op" class="ana-select" ${iV < 0 ? 'disabled' : ''}>${OPS.map(o => `<option ${o === state.pivot.op ? 'selected' : ''}>${o}</option>`).join('')}</select>
          <button class="dash-tgl" id="ana-piv-export">⬇ Excel</button>
        </span></h3>
        <div id="ana-pivot-wrap" class="ana-pivot-wrap"></div>
      </div>`;

    /* eventos: mapeamento */
    [['ana-map-data', 'data'], ['ana-map-valor', 'valor'], ['ana-map-cat', 'cat']].forEach(([id, k]) => {
      $(id).addEventListener('change', e => {
        state.map[k] = e.target.value || null;
        if (k === 'cat') { state.fil.cats.clear(); state.pivot.linha = state.map.cat; }
        if (k === 'data') state.fil.periodo = null;
        salvarMapa(); render();
      });
    });
    $('ana-perfil').addEventListener('change', e => {
      state.perfil = e.target.value;
      if (state.perfil === 'engenharia' && state.pivot.op === 'Soma') state.pivot.op = 'Média';
      if (state.perfil === 'financeiro' && state.pivot.op === 'Média') state.pivot.op = 'Soma';
      salvarMapa(); render();
    });
    /* slicers/chips */
    body.querySelectorAll('.slicer-chip[data-cat]').forEach(ch => ch.addEventListener('click', () => toggleCat(ch.dataset.cat)));
    body.querySelectorAll('.slicer-chip[data-per]').forEach(ch => ch.addEventListener('click', () => togglePeriodo(ch.dataset.per)));
    /* toggles */
    body.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => { state.evolTipo = b.dataset.ev; render(); }));
    body.querySelectorAll('[data-ct]').forEach(b => b.addEventListener('click', () => { state.catTipo = b.dataset.ct; render(); }));
    /* pivot */
    $('ana-piv-linha').addEventListener('change', e => { state.pivot.linha = e.target.value || state.map.cat; render(); });
    $('ana-piv-op') && $('ana-piv-op').addEventListener('change', e => { state.pivot.op = e.target.value; render(); });
    $('ana-piv-export').addEventListener('click', exportPivot);

    /* evolução */
    if (iD >= 0) {
      const porPer = new Map();
      const catTot = new Map();
      rows.forEach(r => {
        const k = parseKey(r[iD]); if (!k) return;
        const v = iV >= 0 ? num(r[iV]) : 1; if (isNaN(v)) return;
        porPer.set(k, (porPer.get(k) || 0) + v);
        if (iC >= 0) { const c = String(r[iC] ?? '—').trim() || '—'; catTot.set(c, (catTot.get(c) || 0) + v); }
      });
      const pers = [...porPer.keys()].sort();
      const cEv = $('ana-evol');
      if (cEv && pers.length) {
        cEv.style.width = Math.max(cEv.parentElement.clientWidth - 8, pers.length * 64) + 'px';
        if (state.evolTipo === 'stack' && iC >= 0) {
          const topCats = [...catTot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
          const series = topCats.map(c => ({ nome: c, vals: pers.map(() => 0) }));
          const outros = { nome: 'Outros', vals: pers.map(() => 0) };
          rows.forEach(r => {
            const k = parseKey(r[iD]); if (!k) return;
            const pi = pers.indexOf(k); if (pi < 0) return;
            const v = iV >= 0 ? num(r[iV]) : 1; if (isNaN(v)) return;
            const c = String(r[iC] ?? '—').trim() || '—';
            const si = topCats.indexOf(c);
            (si >= 0 ? series[si] : outros).vals[pi] += v;
          });
          if (outros.vals.some(v => v > 0)) series.push(outros);
          drawStacked(cEv, pers, series, cat => { if (cat !== 'Outros') toggleCat(cat); });
        } else {
          drawBars(cEv, pers, pers.map(p => porPer.get(p)), togglePeriodo);
        }
      }
    }

    /* por categoria */
    if (iC >= 0) {
      const g = new Map();
      rows.forEach(r => {
        const c = String(r[iC] ?? '—').trim() || '—';
        const v = iV >= 0 ? num(r[iV]) : 1; if (isNaN(v)) return;
        g.set(c, (g.get(c) || 0) + v);
      });
      const top = [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
      const cCat = $('ana-cat');
      if (cCat && top.length) {
        if (state.catTipo === 'pizza') {
          const top8 = top.slice(0, 8);
          const resto = top.slice(8).reduce((s, e) => s + e[1], 0);
          const labels = top8.map(e => e[0]).concat(resto > 0 ? ['Outros'] : []);
          const values = top8.map(e => e[1]).concat(resto > 0 ? [resto] : []);
          drawDonut(cCat, labels, values, l => { if (l !== 'Outros') toggleCat(l); });
        } else {
          cCat.style.width = Math.max(cCat.parentElement.clientWidth - 8, top.length * 58) + 'px';
          drawBars(cCat, top.map(e => e[0]), top.map(e => e[1]), toggleCat);
        }
      }
    }

    /* tabela dinâmica */
    const p = pivotDados(f);
    const wrap = $('ana-pivot-wrap');
    if (p && p.linhas.length) {
      const somaAbs = p.linhas.reduce((s, l) => s + (isNaN(l.valor) ? 0 : Math.abs(l.valor)), 0) || 1;
      const maxAbs = Math.max(...p.linhas.map(l => Math.abs(isNaN(l.valor) ? 0 : l.valor)), 1);
      wrap.innerHTML = `<table class="ana-pivot"><thead><tr>
          <th>${esc(state.pivot.linha)}</th><th>${esc(p.op)}${state.map.valor && p.op !== 'Contagem' ? ' — ' + esc(state.map.valor) : ''}</th><th>Contagem</th><th>%</th><th class="ana-bar-col"></th>
        </tr></thead><tbody>
        ${p.linhas.slice(0, 200).map(l => {
          const pct = Math.abs(isNaN(l.valor) ? 0 : l.valor) / somaAbs * 100;
          const barw = Math.abs(isNaN(l.valor) ? 0 : l.valor) / maxAbs * 100;
          const selecionavel = state.pivot.linha === state.map.cat;
          return `<tr class="${selecionavel ? 'ana-row-click' : ''} ${state.fil.cats.has(l.k) ? 'ana-row-on' : ''}" data-k="${esc(l.k)}">
            <td>${esc(l.k)}</td>
            <td class="ana-num ${!isNaN(l.valor) && l.valor < 0 ? 'ana-neg' : ''}">${isNaN(l.valor) ? '—' : mon(l.valor)}</td>
            <td class="ana-num">${l.n}</td>
            <td class="ana-num">${fmt(pct, 1)}%</td>
            <td class="ana-bar-col"><div class="ana-minibar" style="width:${barw}%"></div></td>
          </tr>`;
        }).join('')}
        </tbody><tfoot><tr>
          <td><b>Total</b></td>
          <td class="ana-num ${p.totalGeral < 0 ? 'ana-neg' : ''}"><b>${isNaN(p.totalGeral) ? '—' : mon(p.totalGeral)}</b></td>
          <td class="ana-num"><b>${p.totN}</b></td>
          <td class="ana-num"><b>100%</b></td><td class="ana-bar-col"></td>
        </tr></tfoot></table>
        ${p.linhas.length > 200 ? `<p class="ana-dica">mostrando 200 de ${p.linhas.length} grupos — exporte para ver tudo</p>` : ''}`;
      if (state.pivot.linha === state.map.cat) {
        wrap.querySelectorAll('.ana-row-click').forEach(tr => tr.addEventListener('click', () => toggleCat(tr.dataset.k)));
      }
    } else {
      wrap.innerHTML = '<p class="ana-dica">Escolha uma coluna em "Agrupar por"</p>';
    }

    $('ana-info') && ($('ana-info').textContent =
      `${state.sheet || ''} · ${rows.length}/${f.rows.length} registros` +
      (state.fil.cats.size || state.fil.periodo ? ' · filtros ativos' : ''));
  }

  /* ── salvar/abrir análise (.concre) ───────────── */
  function salvarAnalise() {
    const f = fonte();
    if (!f) { window.showToast?.('Abra uma planilha primeiro', 'error'); return; }
    const cfg = {
      tipo: 'concrestats-analise', versao: 1,
      criadoEm: new Date().toISOString(),
      sheet: state.sheet,
      sourcePath: window.__concreSourcePath || null,
      map: state.map,
      fil: { periodo: state.fil.periodo, cats: [...state.fil.cats] },
      pivot: state.pivot, evolTipo: state.evolTipo, catTipo: state.catTipo,
      perfil: state.perfil,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
    a.download = `analise_${(state.sheet || 'dados').replace(/[^\w\-]+/g, '_')}.concre`;
    a.click(); URL.revokeObjectURL(a.href);
    window.showToast?.('Análise salva — envie o .concre junto com a planilha para compartilhar', 'success');
  }

  function aplicarAnalise(cfg) {
    state.map = cfg.map || state.map;
    if (cfg.perfil) state.perfil = cfg.perfil;
    state.fil.periodo = cfg.fil?.periodo ?? null;
    state.fil.cats = new Set(cfg.fil?.cats || []);
    state.pivot = cfg.pivot || state.pivot;
    state.evolTipo = cfg.evolTipo || 'total';
    state.catTipo = cfg.catTipo || 'barra';
    state.sheet = window.getConcrestatsData?.().activeSheet || state.sheet;
    render();
    window.showToast?.('Análise aplicada', 'success');
  }

  async function abrirAnalise(file) {
    let cfg;
    try { cfg = JSON.parse(await file.text()); } catch (_) { window.showToast?.('Arquivo .concre inválido', 'error'); return; }
    if (cfg.tipo !== 'concrestats-analise') { window.showToast?.('Arquivo .concre inválido', 'error'); return; }
    // Se a análise referencia o arquivo de origem, tenta recarregá-lo do disco.
    if (cfg.sourcePath) {
      try {
        const r = await fetch('/api/load_path', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: (window.getConcrestatsData?.() || {}).sessionId || 'default', path: cfg.sourcePath }) });
        const res = await r.json();
        if (res && res.success && window.loadSheetData) {
          window.loadSheetData(res);
          window.__concreSourcePath = cfg.sourcePath;
        }
      } catch (_) { /* segue com a planilha atual */ }
    }
    aplicarAnalise(cfg);
  }

  /* ── export imagem (PNG) ───────────────────────── */
  function exportImagem() {
    const body = $('ana-body');
    const f = fonte();
    if (!f) { window.showToast?.('Abra uma planilha primeiro', 'error'); return; }
    const kpis = [...body.querySelectorAll('.dash-card')].map(c => ({
      v: c.querySelector('b')?.innerText || '', l: c.querySelector('span')?.innerText || '' }));
    const canv = [$('ana-evol'), $('ana-cat')].filter(Boolean);
    // título vem da PRÓPRIA seção do canvas (índice fixo desalinhava com Insights)
    const tituloDe = c => c.closest('.dash-section')?.querySelector('h3')?.childNodes[0]?.textContent?.trim() || '';
    const pvHead = [...body.querySelectorAll('.ana-pivot thead th')].slice(0, 4).map(t => t.innerText);
    const pvRows = [...body.querySelectorAll('.ana-pivot tbody tr')].slice(0, 14)
      .map(tr => [...tr.querySelectorAll('td')].slice(0, 4).map(td => td.innerText));
    const W = 1240, M = 40, dpr = 2;
    let H = 100 + (kpis.length ? 120 : 0);
    const imgs = canv.map(c => {
      const w = Math.min(W - M * 2, c.clientWidth || 800);
      const h = Math.round(w * ((c.clientHeight || 300) / (c.clientWidth || 800)));
      return { c, w, h };
    });
    imgs.forEach(i => H += i.h + 64);
    if (pvRows.length) H += 70 + (pvRows.length + 1) * 26;
    H += 30;
    const out = document.createElement('canvas');
    out.width = W * dpr; out.height = H * dpr;
    const x = out.getContext('2d'); x.scale(dpr, dpr);
    if (!x.roundRect) x.roundRect = function (a, b2, c, d2) { this.rect(a, b2, c, d2); }; // WebView2 antigo
    x.fillStyle = '#fafaf7'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1c1b18'; x.font = '600 20px IBM Plex Mono, monospace';
    x.fillText('◈ CONCRESTATS · Análise', M, 46);
    x.font = '12px IBM Plex Mono, monospace'; x.fillStyle = '#9a968e';
    x.fillText(`${state.sheet || ''} · ${new Date().toLocaleDateString('pt-BR')}`, M, 68);
    let y = 96;
    if (kpis.length) {
      const cw = (W - M * 2 - 12 * (kpis.length - 1)) / kpis.length;
      kpis.forEach((k, i) => {
        const cx0 = M + i * (cw + 12);
        x.fillStyle = '#fff'; x.strokeStyle = '#d4d2ca';
        x.beginPath(); x.roundRect(cx0, y, cw, 84, 6); x.fill(); x.stroke();
        x.fillStyle = '#1c1b18'; x.font = '600 20px IBM Plex Mono, monospace';
        x.fillText(k.v.length > 16 ? k.v.slice(0, 16) : k.v, cx0 + 14, y + 38);
        x.fillStyle = '#9a968e'; x.font = '10px IBM Plex Mono, monospace';
        x.fillText(k.l.toUpperCase().slice(0, Math.floor(cw / 6.5)), cx0 + 14, y + 62);
      });
      y += 120;
    }
    imgs.forEach((im, idx) => {
      x.fillStyle = '#1c1b18'; x.font = '600 13px IBM Plex Mono, monospace';
      x.fillText(tituloDe(im.c).toUpperCase(), M, y + 6);
      y += 18;
      x.fillStyle = '#fff'; x.strokeStyle = '#d4d2ca';
      x.beginPath(); x.roundRect(M, y, W - M * 2, im.h + 16, 6); x.fill(); x.stroke();
      x.drawImage(im.c, 0, 0, im.c.width, im.c.height, M + 8, y + 8, im.w - 16, im.h);
      y += im.h + 46;
    });
    if (pvRows.length) {
      x.fillStyle = '#1c1b18'; x.font = '600 13px IBM Plex Mono, monospace';
      x.fillText('TABELA DINÂMICA', M, y + 6); y += 20;
      const colW = [ (W - M * 2) * 0.44, (W - M * 2) * 0.22, (W - M * 2) * 0.14, (W - M * 2) * 0.2 ];
      x.fillStyle = '#1c1b18'; x.fillRect(M, y, W - M * 2, 26);
      x.fillStyle = '#fff'; x.font = '11px IBM Plex Mono, monospace';
      let cx0 = M + 10;
      pvHead.forEach((h2, i) => { x.fillText(h2.slice(0, 40), cx0, y + 17); cx0 += colW[i]; });
      y += 26;
      x.font = '11px IBM Plex Sans, sans-serif';
      pvRows.forEach((r, ri) => {
        x.fillStyle = ri % 2 ? '#f4f3ef' : '#fff'; x.fillRect(M, y, W - M * 2, 24);
        cx0 = M + 10;
        r.forEach((cell, ci) => {
          x.fillStyle = ci === 1 && cell.trim().startsWith('-') ? '#b33a2a' : '#1c1b18';
          x.fillText(String(cell).slice(0, ci === 0 ? 52 : 20), cx0, y + 16);
          cx0 += colW[ci];
        });
        y += 24;
      });
    }
    const nomeArq = `analise_${(state.sheet || 'dados').replace(/[^\w\-]+/g, '_')}.png`;
    // No app instalado o download do navegador nao pergunta onde salvar e o
    // arquivo "sumia". Aqui usamos o dialogo do Windows e gravamos no disco.
    if (window.pywebview?.api?.save_file_dialog) {
      out.toBlob(async b => {
        try {
          const caminho = await window.pywebview.api.save_file_dialog(nomeArq);
          if (!caminho) return;                         // cancelou
          const b64 = await new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.readAsDataURL(b);
          });
          const r = await fetch('/api/salvar_binario', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: caminho, base64: b64 })
          });
          const j = await r.json();
          window.showToast?.(j.success
            ? `Imagem salva em "${String(j.path).split(/[\/]/).pop()}"`
            : 'Erro ao salvar: ' + (j.error || ''), j.success ? 'success' : 'error');
        } catch (_) { window.showToast?.('Falha ao salvar a imagem', 'error'); }
      });
      return;
    }
    out.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = nomeArq;
      a.click(); URL.revokeObjectURL(a.href);
      window.showToast?.('Imagem baixada', 'success');
    });
  }

  /* ── init ──────────────────────────────────────── */
  function init() {
    $('ana-refresh')?.addEventListener('click', () => { state.sheet = null; render(); });
    $('ana-limpar')?.addEventListener('click', limparFiltros);
    $('ana-reload')?.addEventListener('click', async () => {
      if (window.ConcrestatsReload) { const ok = await window.ConcrestatsReload(); if (ok) render(); }
      else window.showToast?.('Sem arquivo de origem', 'error');
    });
    $('ana-save')?.addEventListener('click', salvarAnalise);
    $('ana-open')?.addEventListener('click', () => $('concre-input')?.click());
    $('concre-input')?.addEventListener('change', e => {
      if (e.target.files[0]) abrirAnalise(e.target.files[0]);
      e.target.value = '';
    });
    $('ana-img')?.addEventListener('click', exportImagem);
    $('ana-pdf')?.addEventListener('click', () => window.print());
    // Modo apresentação: tela cheia, sem barras, fontes maiores (Esc sai).
    $('ana-present')?.addEventListener('click', () => {
      const m = $('module-analise');
      m.classList.add('ana-presenting');
      (m.requestFullscreen ? m.requestFullscreen() : Promise.reject())
        .catch(() => { m.classList.remove('ana-presenting'); }); // negado → desfaz
    });
    document.addEventListener('fullscreenchange', () => {
      const m = $('module-analise');
      if (!document.fullscreenElement) m.classList.remove('ana-presenting');
      if (m.style.display !== 'none') setTimeout(render, 120); // canvases mudam de tamanho
    });
    window.addEventListener('concrestats:datachanged', () => {
      const el = $('module-analise');
      if (el && el.style.display !== 'none') setTimeout(render, 50);
    });
    try {
      window.prefsGet().then(p => {
        if (p && p.analise_maps && typeof p.analise_maps === 'object') state.prefsMaps = p.analise_maps;
      }).catch(() => {});
    } catch (_) {}
  }

  // API de desenho/estatística reutilizada pelo Painel (canvas do Naor).
  window.ConcreViz = {
    setupCanvas, drawBars, drawStacked, drawDonut,
    num, parseKey, fmt, fmt0, agg, gerarInsights, esc,
    get perfil() { return state.perfil; },
    mon,
  };

  // Autodetecção reutilizada pelo Painel.
  window.ConcreAutoMap = (headers, rows) => autoDetect(headers, rows);

  window.AnaliseModule = { onModuleEnter: render };
  document.addEventListener('DOMContentLoaded', init);
})();
