/**
 * ponte-mobile.js — o Concrestats rodando sem Python
 *
 * No computador, a tela conversa com um servidor Flask. No celular/tablet não
 * há Python, então este arquivo INTERCEPTA as chamadas /api/... e responde
 * localmente, com o mesmo formato de resposta. Assim toda a interface (grade,
 * filtros, cores, gráficos, análise, painel, relatório) funciona sem tocar em
 * uma linha dos outros arquivos.
 *
 * O que muda de verdade no aparelho:
 *   - abrir arquivo  → seletor do Android, lido com SheetJS
 *   - salvar         → gera o arquivo e entrega para o Android (Downloads)
 *   - preferências   → localStorage, no lugar do prefs.json
 *
 * Carregado ANTES de app.js: quando os módulos rodarem, fetch já está trocado.
 */
(function () {
  'use strict';

  // ?mobile=1 permite conferir o modo aparelho no computador, sem emulador
  const ehMobile = /Android/i.test(navigator.userAgent)
    || window.CONCRE_MOBILE === true
    || /[?&]mobile=1/.test(location.search);
  if (!ehMobile) return;                 // no computador, nada muda
  window.CONCRE_MOBILE = true;

  /* ── estado, equivalente ao SESSIONS do servidor ─────────────── */
  const sessao = { sheets: {}, active: null, nome: 'planilha.xlsx' };

  const copia = o => JSON.parse(JSON.stringify(o));
  const norm = h => String(h).trim().toUpperCase();

  function respostaDaPlanilha(extra) {
    const nome = sessao.active;
    const p = sessao.sheets[nome] || { headers: [], data: [] };
    return Object.assign({
      success: true,
      active_sheet: nome,
      sheets: Object.keys(sessao.sheets),
      data: { headers: p.headers, data: p.data },
      headers: p.headers,
      rows: p.data,
    }, extra || {});
  }

  /* ── preferências: localStorage no lugar do arquivo ──────────── */
  const PREFS = 'concrestats_prefs';
  function lerPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch (e) { return {}; }
  }
  function gravarPrefs(novo) {
    const atual = lerPrefs();
    Object.keys(novo).forEach(k => {
      if (novo[k] === null) delete atual[k]; else atual[k] = novo[k];
    });
    try { localStorage.setItem(PREFS, JSON.stringify(atual)); } catch (e) {}
    return atual;
  }

  /* ── planilha ↔ SheetJS ──────────────────────────────────────── */
  function comoTexto(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const d = n => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${d(v.getMonth() + 1)}-${d(v.getDate())}`;
    }
    return String(v);
  }

  function lerArquivo(buffer, nomeArquivo) {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
    const abas = {};
    wb.SheetNames.forEach(nome => {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], {
        header: 1, defval: '', raw: false, blankrows: false });
      if (!linhas.length) { abas[nome] = { headers: [], data: [] }; return; }
      const headers = linhas[0].map((h, i) => comoTexto(h).trim() || `Coluna ${i + 1}`);
      const data = linhas.slice(1).map(l => {
        const linha = headers.map((_, i) => comoTexto(l[i]));
        return linha;
      });
      abas[nome] = { headers, data };
    });
    sessao.sheets = abas;
    sessao.active = wb.SheetNames[0] || null;
    sessao.nome = nomeArquivo || 'planilha.xlsx';
    return respostaDaPlanilha({ path: sessao.nome });
  }
  window.ConcreMobileLerArquivo = lerArquivo;

  function montarWorkbook(apenas) {
    const wb = XLSX.utils.book_new();
    const nomes = apenas ? [apenas] : Object.keys(sessao.sheets);
    nomes.forEach(nome => {
      const p = sessao.sheets[nome];
      if (!p) return;
      const aoa = [p.headers].concat(p.data.map(l => l.map(tipar)));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31) || 'Plan1');
    });
    return wb;
  }

  // texto → número/data, para o Excel não abrir tudo como texto
  const RE_INT = /^-?\d+$/, RE_DEC = /^-?\d*[.,]\d+$/, RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  function tipar(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (RE_INT.test(s)) {
      const semSinal = s[0] === '-' ? s.slice(1) : s;
      if (semSinal.length > 1 && semSinal[0] === '0') return s;   // 007 é código
      return parseInt(s, 10);
    }
    if (RE_DEC.test(s)) return parseFloat(s.replace(',', '.'));
    const m = RE_DATA.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return s;
  }

  /* ── entrega o arquivo pronto ao Android ─────────────────────── */
  function entregar(wb, nomeArquivo) {
    const saida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([saida], { type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    baixarBlob(blob, nomeArquivo);
  }

  function baixarBlob(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  window.ConcreMobileBaixar = baixarBlob;

  /* ── os endpoints, um a um ───────────────────────────────────── */
  const rotas = {
    '/api/ambiente': () => ({ web: false, mobile: true, versao: '2.0' }),

    '/api/sheets_info': () => ({
      success: true,
      sheets: Object.fromEntries(Object.entries(sessao.sheets)
        .map(([n, p]) => [n, p.headers])),
      active: sessao.active, path: sessao.nome, demo: [],
    }),

    '/api/get_sheet': body => {
      const nome = body.sheet_name;
      if (!sessao.sheets[nome]) return { success: false, error: 'planilha não encontrada' };
      sessao.active = nome;
      return respostaDaPlanilha();
    },

    '/api/save_data': body => {
      const nome = body.sheet_name;
      if (!nome) return { success: false, error: 'sheet_name ausente' };
      sessao.sheets[nome] = { headers: body.headers || [], data: body.data || [] };
      sessao.active = nome;
      return { success: true };
    },

    '/api/new_sheet': body => {
      let nome = (body.sheet_name || 'Nova Planilha').trim() || 'Nova Planilha';
      const base = nome; let k = 2;
      while (sessao.sheets[nome]) nome = `${base} (${k++})`;
      sessao.sheets[nome] = { headers: ['A', 'B', 'C'], data: [['', '', '']] };
      sessao.active = nome;
      return respostaDaPlanilha();
    },

    '/api/delete_sheet': body => {
      const nome = body.sheet_name;
      if (sessao.sheets[nome] && Object.keys(sessao.sheets).length > 1) {
        delete sessao.sheets[nome];
        if (sessao.active === nome) sessao.active = Object.keys(sessao.sheets)[0];
      }
      return { success: true, sheets: Object.keys(sessao.sheets), active_sheet: sessao.active };
    },

    '/api/join_preview': body => {
      const a = sessao.sheets[body.left_sheet], b = sessao.sheets[body.right_sheet];
      if (!a || !b) return { success: false, error: 'planilha inválida' };
      const ia = a.headers.indexOf(body.left_key), ib = b.headers.indexOf(body.right_key);
      if (ia < 0 || ib < 0) return { success: false, error: 'coluna inválida' };
      const dir = new Set(b.data.map(l => String(l[ib] ?? '').trim().toUpperCase()));
      let casaram = 0, exemplo = '';
      a.data.forEach(l => {
        const k = String(l[ia] ?? '').trim().toUpperCase();
        if (dir.has(k)) { casaram++; if (!exemplo) exemplo = String(l[ia]).trim().slice(0, 28); }
      });
      return { success: true, matched: casaram, total: a.data.length, exemplo };
    },

    '/api/join_sheets': body => {
      const a = sessao.sheets[body.left_sheet], b = sessao.sheets[body.right_sheet];
      if (!a || !b) return { success: false, error: 'planilha inválida' };
      const ia = a.headers.indexOf(body.left_key), ib = b.headers.indexOf(body.right_key);
      if (ia < 0 || ib < 0) return { success: false, error: 'coluna inválida' };
      const cols = body.columns || [];
      const idx = cols.map(c => b.headers.indexOf(c));
      const mapa = new Map();
      b.data.forEach(l => {
        const k = String(l[ib] ?? '').trim().toUpperCase();
        if (!mapa.has(k)) mapa.set(k, l);
      });
      // nome novo para coluna que já existe, igual ao servidor
      const novos = cols.map(c => a.headers.includes(c) ? c + ' (2)' : c);
      const headers = a.headers.concat(novos);
      let casaram = 0;
      const data = a.data.map(l => {
        const k = String(l[ia] ?? '').trim().toUpperCase();
        const par = mapa.get(k);
        if (par) casaram++;
        return l.concat(idx.map(i => par && i >= 0 ? String(par[i] ?? '') : ''));
      });
      const payload = { headers, data };
      if (body.destino === 'atual') {
        sessao.sheets[body.left_sheet] = payload; sessao.active = body.left_sheet;
      } else {
        let nome = `${body.left_sheet} + ${body.right_sheet}`, k = 2;
        while (sessao.sheets[nome]) nome = `${body.left_sheet} + ${body.right_sheet} (${k++})`;
        sessao.sheets[nome] = payload; sessao.active = nome;
      }
      return respostaDaPlanilha({ matched: casaram, total: a.data.length });
    },

    '/api/prefs': (body, metodo) => metodo === 'GET' ? lerPrefs() : (gravarPrefs(body), { success: true }),

    '/api/receitas': (body, metodo) => {
      if (metodo === 'GET') return lerPrefs().__receitas || [];
      gravarPrefs({ __receitas: body });
      return { success: true };
    },

    // no aparelho não há "arquivo de origem": salvar é gerar e entregar
    '/api/save_file': () => {
      if (!Object.keys(sessao.sheets).length) return { success: false, error: 'sem planilha aberta' };
      entregar(montarWorkbook(), sessao.nome.replace(/\.(xlsx|xls|csv)$/i, '') + '.xlsx');
      return { success: true, path: 'Downloads/' + sessao.nome, mobile: true };
    },

    '/api/export_aoa': body => {
      const aoa = body.aoa || [];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
        aoa.map(l => l.map(tipar))), (body.sheet_name || 'Planilha').slice(0, 31));
      entregar(wb, (body.base_name || 'dados') + '.xlsx');
      return { success: true };
    },

    // rotas que só existem no computador
    '/api/load_path':    () => ({ success: false, error: 'no aparelho, use o botão Abrir' }),
    '/api/reload':       () => ({ success: false, error: 'indisponível no aparelho' }),
    '/api/copias':       () => ({ success: true, copias: [] }),
    '/api/restaurar_copia': () => ({ success: false, error: 'indisponível no aparelho' }),
    '/api/salvar_binario':  () => ({ success: false, error: 'indisponível no aparelho' }),
  };

  /* ── troca do fetch ──────────────────────────────────────────── */
  const fetchOriginal = window.fetch.bind(window);

  function resposta(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  window.fetch = async function (entrada, opcoes) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    const caminho = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (!caminho.startsWith('/api/')) return fetchOriginal(entrada, opcoes);

    const metodo = ((opcoes && opcoes.method) || 'GET').toUpperCase();
    let corpo = {};
    const cru = opcoes && opcoes.body;
    if (cru && typeof cru === 'string') { try { corpo = JSON.parse(cru); } catch (e) {} }
    else if (cru instanceof FormData) { corpo = cru; }

    // exportar devolve ARQUIVO, não json
    if (caminho === '/api/export' || caminho === '/api/export_report_custom') {
      const fmt = (corpo.format || 'xlsx').toLowerCase();
      const nome = (corpo.sheet_name || sessao.active || 'dados');
      if (fmt === 'csv') {
        const p = sessao.sheets[nome] || { headers: [], data: [] };
        const csv = XLSX.utils.sheet_to_csv(
          XLSX.utils.aoa_to_sheet([p.headers].concat(p.data)));
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        baixarBlob(blob, nome + '.csv');
        return new Response(csv, { status: 200 });
      }
      entregar(montarWorkbook(sessao.sheets[nome] ? nome : null), nome + '.xlsx');
      return new Response(new Blob(), { status: 200 });
    }

    // importar/anexar arquivo vem como FormData
    if (caminho === '/api/import_merge' || caminho === '/api/upload') {
      const arq = corpo instanceof FormData ? corpo.get('file') : null;
      if (!arq) return resposta({ success: false, error: 'nenhum arquivo' }, 400);
      const buf = new Uint8Array(await arq.arrayBuffer());
      if (caminho === '/api/upload') {
        return resposta(lerArquivo(buf, arq.name));
      }
      // importar: junta as linhas na aba aberta, trazendo colunas novas
      const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
      const primeira = wb.SheetNames[0];
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[primeira],
        { header: 1, defval: '', raw: false, blankrows: false });
      if (!linhas.length) return resposta({ success: false, error: 'arquivo vazio' }, 400);
      const alvo = sessao.sheets[(corpo.get && corpo.get('target_sheet')) || sessao.active];
      if (!alvo) return resposta({ success: false, error: 'planilha alvo inválida' }, 400);
      const hIn = linhas[0].map(h => comoTexto(h).trim());
      const idx = {}; hIn.forEach((h, i) => { idx[norm(h)] = i; });
      const casadas = alvo.headers.filter(h => idx[norm(h)] !== undefined);
      if (!casadas.length) {
        return resposta({ success: false, error:
          'nenhuma coluna em comum entre as planilhas — os cabeçalhos precisam ter os mesmos nomes' }, 400);
      }
      const jaTem = new Set(alvo.headers.map(norm));
      const novas = hIn.filter(h => h && !jaTem.has(norm(h)));
      if (novas.length) {
        alvo.headers = alvo.headers.concat(novas);
        alvo.data.forEach(l => { novas.forEach(() => l.push('')); });
        novas.forEach(h => jaTem.add(norm(h)));
      }
      linhas.slice(1).forEach(l => {
        alvo.data.push(alvo.headers.map(h => {
          const i = idx[norm(h)];
          return i !== undefined ? comoTexto(l[i]) : '';
        }));
      });
      return resposta({ success: true, data: alvo, colunas_novas: novas,
                        linhas_add: linhas.length - 1 });
    }

    const rota = rotas[caminho];
    if (!rota) return resposta({ success: false, error: 'rota indisponível no aparelho' }, 404);
    try {
      const r = await rota(corpo, metodo);
      return resposta(r, r && r.success === false ? 400 : 200);
    } catch (e) {
      return resposta({ success: false, error: String(e && e.message || e) }, 500);
    }
  };

  /* ── botão Abrir usa o seletor do Android ────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('modo-mobile');
    const entrada = document.getElementById('file-input');
    ['btn-upload', 'btn-upload-empty'].forEach(id => {
      const b = document.getElementById(id);
      if (!b || !entrada) return;
      b.addEventListener('click', ev => { ev.stopImmediatePropagation(); entrada.click(); }, true);
    });
  });
})();
