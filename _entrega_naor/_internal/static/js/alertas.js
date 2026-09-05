/**
 * alertas.js — Alertas automáticos
 *
 * A pergunta que um laboratório faz o tempo todo é "tem alguma coisa fora do
 * lugar hoje?". Até aqui só dava para descobrir olhando. Agora você escreve a
 * regra uma vez ("avisar quando MPA 28 for menor que FCK") e o app verifica
 * sozinho toda vez que os dados mudam: um sino na barra mostra quantas linhas
 * bateram na regra, e a lista diz quais são.
 *
 * As regras ficam em prefs.json (por planilha), então sobrevivem a fechar o app.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const OPS = [
    { v: '<',  l: 'for menor que' },
    { v: '<=', l: 'for menor ou igual a' },
    { v: '>',  l: 'for maior que' },
    { v: '>=', l: 'for maior ou igual a' },
    { v: '==', l: 'for igual a' },
    { v: '!=', l: 'for diferente de' },
    { v: 'vazio',   l: 'estiver em branco' },
    { v: 'contem',  l: 'contiver o texto' },
  ];

  let regras = [];        // [{col, op, val, aviso}]
  let achados = [];       // resultado da última verificação
  let carregou = false;

  const chave = () => 'alertas__' + (state.activeSheet || '_');

  function numero(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(/\s/g, '');
    if (!s) return NaN;
    // aceita 1.234,56 e 1234.56
    const br = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s);
    return parseFloat(br ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
  }

  // O valor pode ser um número fixo ou o nome de outra coluna entre colchetes:
  // "avisar quando MPA 28 for menor que [FCK]" é a regra que o laboratório usa.
  function valorDaRegra(bruto, linha) {
    const m = String(bruto || '').match(/^\s*\[(.+)\]\s*$/);
    if (!m) return { num: numero(bruto), txt: String(bruto || '') };
    const i = state.headers.indexOf(m[1]);
    if (i < 0) return { num: NaN, txt: '' };
    return { num: numero(linha[i]), txt: String(linha[i] ?? '') };
  }

  function bate(regra, linha) {
    const ci = state.headers.indexOf(regra.col);
    if (ci < 0) return false;
    const cel = linha[ci];
    const txt = String(cel ?? '').trim();
    if (regra.op === 'vazio') return txt === '';
    if (regra.op === 'contem') {
      return txt.toLowerCase().includes(String(regra.val || '').toLowerCase()) &&
             String(regra.val || '') !== '';
    }
    const alvo = valorDaRegra(regra.val, linha);
    const a = numero(cel);
    if (regra.op === '==' || regra.op === '!=') {
      const igual = (!isNaN(a) && !isNaN(alvo.num))
        ? Math.abs(a - alvo.num) < 1e-9
        : txt.toLowerCase() === String(alvo.txt).trim().toLowerCase();
      return regra.op === '==' ? igual : !igual;
    }
    // comparação de grandeza só vale entre números: célula sem número
    // (um "n/d", por exemplo) não pode disparar alerta silenciosamente
    if (isNaN(a) || isNaN(alvo.num)) return false;
    if (regra.op === '<')  return a <  alvo.num;
    if (regra.op === '<=') return a <= alvo.num;
    if (regra.op === '>')  return a >  alvo.num;
    if (regra.op === '>=') return a >= alvo.num;
    return false;
  }

  function verificar() {
    achados = [];
    if (!regras.length || !state.data || !state.headers.length) { pintarSino(); return; }
    const idCol = 0;   // primeira coluna serve de identificação na lista
    state.data.forEach((linha, i) => {
      regras.forEach(r => {
        if (bate(r, linha)) {
          achados.push({ linha: i, regra: r, id: String(linha[idCol] ?? ('linha ' + (i + 1))) });
        }
      });
    });
    pintarSino();
  }

  function pintarSino() {
    const b = $('btn-alertas');
    if (!b) return;
    const n = achados.length;
    b.classList.toggle('tem-alerta', n > 0);
    const marca = b.querySelector('.alr-conta');
    if (marca) { marca.textContent = n > 99 ? '99+' : String(n); marca.style.display = n ? '' : 'none'; }
    b.title = !regras.length
      ? 'Alertas: crie uma regra e o app avisa sozinho quando algo fugir dela'
      : (n ? `${n} ocorrência(s) na(s) sua(s) ${regras.length} regra(s)`
           : `Nenhuma ocorrência nas suas ${regras.length} regra(s)`);
  }

  let chaveCarregada = null;

  async function carregar(forcar) {
    try {
      const p = await window.prefsGet(!!forcar);
      regras = (p && p[chave()]) || [];
    } catch (e) { regras = []; }
    chaveCarregada = chave();
    carregou = true;
    verificar();
  }

  function salvar() {
    const corpo = {}; corpo[chave()] = regras;
    fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo) }).catch(() => {});
  }

  /* ── tela ─────────────────────────────────────── */
  function linhaRegra(r, i) {
    const cols = state.headers.map(h =>
      `<option ${h === r.col ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const ops = OPS.map(o =>
      `<option value="${o.v}" ${o.v === r.op ? 'selected' : ''}>${o.l}</option>`).join('');
    const semValor = r.op === 'vazio';
    return `<div class="alr-regra" data-i="${i}">
        <span class="alr-quando">quando</span>
        <select class="alr-col">${cols}</select>
        <select class="alr-op">${ops}</select>
        <input class="alr-val" value="${esc(r.val || '')}" placeholder="número ou [COLUNA]"
               ${semValor ? 'disabled' : ''}>
        <button class="alr-x" title="Remover esta regra">✕</button>
      </div>`;
  }

  function abrir() {
    if (!state.headers.length) { toast('Abra uma planilha primeiro', 'error'); return; }
    const lista = regras.length
      ? regras.map(linhaRegra).join('')
      : '<p class="alr-vazio">Nenhuma regra ainda.</p>';

    const ocorr = achados.length
      ? '<div class="alr-achados"><h4>O que bateu agora</h4>' +
        achados.slice(0, 60).map(a =>
          `<div class="alr-item" data-linha="${a.linha}">
             <b>${esc(a.id)}</b>
             <span>${esc(a.regra.col)} ${esc((OPS.find(o => o.v === a.regra.op) || {}).l || '')} ${esc(a.regra.val || '')}</span>
             <button class="alr-ir" data-linha="${a.linha}">ver na planilha</button>
           </div>`).join('') +
        (achados.length > 60 ? `<p class="alr-mais">e mais ${achados.length - 60}…</p>` : '') +
        '</div>'
      : (regras.length ? '<p class="alr-ok">Nenhuma linha bateu nas regras. Está tudo dentro do esperado.</p>' : '');

    openModal('Alertas automáticos', `
      <p class="alr-ajuda">Escreva a regra uma vez e o app confere sozinho, sempre que
        os dados mudarem. Para comparar com outra coluna, escreva o nome dela entre
        colchetes — por exemplo <b>[FCK]</b>.</p>
      <div class="alr-lista">${lista}</div>
      <button type="button" class="alr-add" id="alr-add">+ nova regra</button>
      ${ocorr}
    `, salvarDoModal, 'modal-alertas');

    setTimeout(ligar, 40);
  }

  function lerModal() {
    return [...document.querySelectorAll('.alr-regra')].map(el => ({
      col: el.querySelector('.alr-col').value,
      op:  el.querySelector('.alr-op').value,
      val: el.querySelector('.alr-val').value.trim(),
    })).filter(r => r.col && r.op);
  }

  function salvarDoModal() {
    regras = lerModal();
    salvar();
    chaveCarregada = chave();
    verificar();
    closeModal();
    toast(achados.length
      ? `${achados.length} ocorrência(s) encontrada(s)`
      : 'Regras salvas — nada fora do esperado', achados.length ? 'error' : 'success');
  }

  function ligar() {
    $('alr-add')?.addEventListener('click', () => {
      regras = lerModal();
      regras.push({ col: state.headers[0], op: '<', val: '' });
      abrir();
    });
    document.querySelectorAll('.alr-x').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.closest('.alr-regra').dataset.i);
        regras = lerModal(); regras.splice(i, 1); abrir();
      });
    });
    document.querySelectorAll('.alr-op').forEach(s => {
      s.addEventListener('change', () => {
        const inp = s.closest('.alr-regra').querySelector('.alr-val');
        inp.disabled = s.value === 'vazio';
        if (inp.disabled) inp.value = '';
      });
    });
    document.querySelectorAll('.alr-ir').forEach(b => {
      b.addEventListener('click', () => {
        const l = parseInt(b.dataset.linha);
        closeModal();
        if (window.ConcrestatsOpenModule) ConcrestatsOpenModule('spreadsheet');
        setTimeout(() => { try { selectCell(l, 0); } catch (e) {} }, 120);
      });
    });
  }

  /* ── botão na barra ───────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    const alvo = $('btn-cores');
    if (!alvo || !alvo.parentElement) return;
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.id = 'btn-alertas';
    b.innerHTML =
      '<svg viewBox="0 0 16 16"><path d="M8 1.6a3.4 3.4 0 00-3.4 3.4v2.2L3.4 9.6h9.2L11.4 7.2V5A3.4 3.4 0 008 1.6z" ' +
      'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M6.6 11.4a1.4 1.4 0 002.8 0" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' +
      ' Alertas<span class="alr-conta" style="display:none">0</span>';
    b.addEventListener('click', abrir);
    alvo.parentElement.insertBefore(b, alvo.nextSibling);
    setTimeout(carregar, 700);
  });

  // reverifica quando os dados ou a planilha mudam
  // As regras sao POR PLANILHA. No boot ainda nao ha' planilha aberta, entao e'
  // preciso reler quando a aba muda — senao a regra salva parecia ter sumido.
  window.addEventListener('concrestats:datachanged', () => {
    if (!carregou) return;
    if (chave() !== chaveCarregada) carregar(true); else verificar();
  });
  window.ConcreAlertas = { abrir, verificar, get achados() { return achados; } };
})();
