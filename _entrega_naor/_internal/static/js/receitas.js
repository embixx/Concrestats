/**
 * receitas.js — Módulo de Cadastro de Receitas de Concreto
 * ConcreLab v1.2
 *
 * Modelo: receita = produto, cada produto tem versoes[]
 * Persistência: /api/receitas (JSON no disco) + fallback localStorage
 */

(function () {
  'use strict';

  // Escapa texto do usuário antes de injetar em innerHTML/atributos
  // (nomes de receita/versão com " < > & não quebram mais a lista).
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  /* ─────────────────────────────────────────────────
     ESTADO
  ───────────────────────────────────────────────── */
  let receitas     = [];
  let receitaAtiva = null;
  let versaoAtiva  = null;
  let unsaved      = false;

  /* ─────────────────────────────────────────────────
     NAVEGAÇÃO
  ───────────────────────────────────────────────── */
  function mudarModulo(mod) {
    // Mostra/oculta módulos de forma defensiva.
    // Antes alguns botões de Relatório ficavam sem ação quando a página era aberta em janela/app.
    const appEl      = document.getElementById('app');
    const receitasEl = document.getElementById('module-receitas');
    const graficosEl = document.getElementById('module-graficos');
    const dashEl     = document.getElementById('module-dashboard');
    const relEl      = document.getElementById('module-relatorio');
    const anaEl      = document.getElementById('module-analise');
    const panEl      = document.getElementById('module-painel');

    if (appEl)      appEl.style.display      = mod === 'spreadsheet' ? '' : 'none';
    if (receitasEl) receitasEl.classList.toggle('active', mod === 'receitas');
    if (graficosEl) graficosEl.style.display = mod === 'charts' ? 'flex' : 'none';
    if (dashEl)     dashEl.style.display     = mod === 'dashboard' ? 'flex' : 'none';
    if (relEl)      relEl.style.display      = mod === 'relatorio' ? 'flex' : 'none';
    if (anaEl)      anaEl.style.display      = mod === 'analise' ? 'flex' : 'none';
    if (panEl)      panEl.style.display      = mod === 'painel' ? 'flex' : 'none';

    // Atualiza nav
    document.querySelectorAll('.nav-btn[data-module]').forEach(b => {
      b.classList.toggle('active', b.dataset.module === mod);
    });

    if (mod === 'receitas') carregarReceitas().then(renderLista);
    if (mod === 'charts' && window.GraficosModule) window.GraficosModule.onModuleEnter();
    if (mod === 'dashboard' && window.DashboardModule) window.DashboardModule.onModuleEnter();
    if (mod === 'relatorio' && window.RelatorioModule) {
      setTimeout(() => window.RelatorioModule.onModuleEnter(), 0);
    }
    if (mod === 'analise' && window.AnaliseModule) {
      setTimeout(() => window.AnaliseModule.onModuleEnter(), 0);
    }
    if (mod === 'painel' && window.PainelModule) {
      setTimeout(() => window.PainelModule.onModuleEnter(), 0);
    }
  }

  // Expõe navegação para outros módulos/botões, inclusive Exportar > Relatório.
  window.ConcrestatsOpenModule = mudarModulo;

  // Listener delegado: funciona mesmo com botões adicionados depois ou em topbars duplicadas.
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.nav-btn[data-module], [data-open-module]');
    if (!btn) return;
    if (btn.classList.contains('disabled')) return;
    const mod = btn.dataset.module || btn.dataset.openModule;
    if (!mod) return;
    ev.preventDefault();
    mudarModulo(mod);
  });

  /* ─────────────────────────────────────────────────
     PERSISTÊNCIA
  ───────────────────────────────────────────────── */
  async function carregarReceitas() {
    try {
      const r = await fetch('/api/receitas');
      if (r.ok) { receitas = await r.json(); return; }
    } catch (_) {}
    const raw = localStorage.getItem('concrelab_receitas');
    receitas = raw ? JSON.parse(raw) : [];
  }

  async function salvarReceitas() {
    try {
      await fetch('/api/receitas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receitas)
      });
    } catch (_) {}
    localStorage.setItem('concrelab_receitas', JSON.stringify(receitas));
  }

  let _idSeq = 0;
  function gerarId(p = 'ID') {
    _idSeq++;
    return p + '-' + Date.now().toString(36).toUpperCase() + _idSeq.toString(36).toUpperCase();
  }
  function hoje() { return new Date().toLocaleDateString('pt-BR'); }

  /* ─────────────────────────────────────────────────
     LISTA LATERAL
  ───────────────────────────────────────────────── */
  function renderLista(filtro) {
    const lista = document.getElementById('rec-list');
    const count = document.getElementById('rec-count');
    const termo = (filtro !== undefined ? filtro : document.getElementById('rec-search').value || '').toLowerCase();
    const filtradas = receitas.filter(r => (r.nome || '').toLowerCase().includes(termo));
    count.textContent = receitas.length;

    if (filtradas.length === 0) {
      lista.innerHTML = `<div class="rec-empty-list">${termo ? 'Nenhum resultado' : 'Nenhuma receita cadastrada'}</div>`;
      return;
    }

    lista.innerHTML = filtradas.map(r => {
      const vAt = (r.versoes || []).find(v => v.id === r.versaoAtiva) || r.versoes?.[0];
      const nv  = (r.versoes || []).length;
      return `
        <div class="rec-list-item ${r.id === receitaAtiva ? 'active' : ''}" data-id="${r.id}">
          <div class="rec-list-item-name">${r.nome ? esc(r.nome) : '(sem nome)'}</div>
          <div class="rec-list-item-meta">
            <span>${vAt?.fck ? vAt.fck + ' MPa' : '—'}</span>
            <span class="rec-versoes-badge">${nv} versão${nv !== 1 ? 'ões' : ''}</span>
          </div>
          <span class="rec-list-item-status rec-status-${r.status || 'ativa'}">${
            r.status === 'teste' ? 'Teste' : r.status === 'descontinuada' ? 'Descont.' : 'Ativa'
          }</span>
        </div>`;
    }).join('');
  }

  // Delegação de evento única na lista — não recria listeners a cada render
  document.getElementById('rec-list').addEventListener('click', e => {
    const item = e.target.closest('.rec-list-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id || id === receitaAtiva) return;
    if (unsaved && !confirm('Há alterações não salvas. Descartar?')) return;
    selecionarReceita(id);
  });

  /* ─────────────────────────────────────────────────
     SELECIONAR RECEITA
  ───────────────────────────────────────────────── */
  function selecionarReceita(id, idVersao) {
    receitaAtiva = id; unsaved = false; limparUnsaved();
    const r = receitas.find(x => x.id === id);
    if (!r) return;
    if (!r.versoes) r.versoes = [];
    const vid = idVersao || r.versaoAtiva || r.versoes[0]?.id || null;
    versaoAtiva = vid; r.versaoAtiva = vid;

    document.getElementById('rec-placeholder').style.display = 'none';
    document.getElementById('rec-form').style.display = 'block';
    document.getElementById('rec-nome').value   = r.nome || '';
    document.getElementById('rec-status').value = r.status || 'ativa';
    document.getElementById('rec-id-display').textContent = r.id;

    renderVersoesTabs(r);
    carregarVersao(r, vid);

    document.getElementById('rec-btn-salvar').disabled  = false;
    document.getElementById('rec-btn-excluir').disabled = false;
    document.getElementById('rec-btn-duplicar-versao').disabled = !vid;
    document.getElementById('rec-btn-excluir-versao').disabled  = !vid || r.versoes.length <= 1;
    renderLista();
  }

  /* ─────────────────────────────────────────────────
     TABS DE VERSÕES
  ───────────────────────────────────────────────── */
  function renderVersoesTabs(r) {
    const ct = document.getElementById('rec-versoes-tabs');
    ct.innerHTML = (r.versoes || []).map(v =>
      `<button class="rec-versao-tab ${v.id === versaoAtiva ? 'active' : ''}" data-vid="${esc(v.id)}" title="${esc(v.nome || v.id)}">${v.nome ? esc(v.nome) : 'Versão'}</button>`
    ).join('');

    // Clique normal — troca versão ativa
    ct.onclick = e => {
      const btn = e.target.closest('.rec-versao-tab');
      if (!btn) return;
      const novaVid = btn.dataset.vid;
      if (novaVid === versaoAtiva) return;
      if (unsaved && !confirm('Alterações não salvas. Descartar?')) return;
      const r2 = receitas.find(x => x.id === receitaAtiva);
      versaoAtiva = novaVid;
      r2.versaoAtiva = versaoAtiva;
      unsaved = false; limparUnsaved();
      renderVersoesTabs(r2);
      carregarVersao(r2, versaoAtiva);
      document.getElementById('rec-btn-excluir-versao').disabled  = r2.versoes.length <= 1;
      document.getElementById('rec-btn-duplicar-versao').disabled = false;
    };

    // Botão direito — renomear versão
    ct.oncontextmenu = e => {
      const btn = e.target.closest('.rec-versao-tab');
      if (!btn) return;
      e.preventDefault();
      const vid = btn.dataset.vid;
      const r2  = receitas.find(x => x.id === receitaAtiva);
      const v   = r2?.versoes.find(x => x.id === vid);
      if (!v) return;

      // Remove menu anterior se existir
      document.getElementById('versao-ctx-menu')?.remove();

      const menu = document.createElement('div');
      menu.id = 'versao-ctx-menu';
      menu.style.cssText = `
        position:fixed; z-index:2000;
        background:var(--bg-white); border:1px solid var(--border-dark);
        border-radius:5px; box-shadow:0 4px 16px rgba(0,0,0,0.15);
        padding:4px 0; min-width:140px;
        left:${e.clientX}px; top:${e.clientY}px;
      `;
      menu.innerHTML = `
        <div id="versao-ctx-renomear" style="
          padding:7px 16px; cursor:pointer; font-size:12px;
          color:var(--text); font-family:var(--sans);
          transition:background 0.1s;
        ">Renomear versão</div>
      `;
      document.body.appendChild(menu);

      // Hover no item
      const item = menu.querySelector('#versao-ctx-renomear');
      item.onmouseenter = () => item.style.background = 'var(--accent-bg)';
      item.onmouseleave = () => item.style.background = '';
      // Fecha ao clicar fora
      const fechar = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', fechar); } };
      setTimeout(() => document.addEventListener('mousedown', fechar), 0);

      document.getElementById('versao-ctx-renomear').onclick = () => {
        menu.remove();
        document.removeEventListener('mousedown', fechar);

        const novoNome = prompt('Novo nome para a versão:', v.nome || '');
        if (novoNome === null) return;            // cancelou
        const nome = novoNome.trim();
        if (!nome) { toast('Nome não pode ser vazio', 'error'); return; }
        if (nome === v.nome) return;              // não mudou

        v.nome = nome;
        salvarReceitas().then(() => {
          renderVersoesTabs(r2);
          toast('Versão renomeada', 'success');
        });
      };
    };
  }

  /* ─────────────────────────────────────────────────
     CARREGAR VERSÃO
  ───────────────────────────────────────────────── */
  function carregarVersao(r, vid) {
    const v = (r.versoes || []).find(x => x.id === vid) || {};
    document.getElementById('rec-obs').value = v.obs || '';
    renderPropriedades(migrarPropriedades(v));
    document.getElementById('rec-data-display').textContent    = v.criadaEm  || '—';
    document.getElementById('rec-editada-display').textContent = v.editadaEm || '—';
  }

  /* ─────────────────────────────────────────────────
     COLETAR FORMULÁRIO
  ───────────────────────────────────────────────── */
  function coletarFormulario() {
    const r = receitas.find(x => x.id === receitaAtiva);
    if (!r) return null;
    r.nome   = document.getElementById('rec-nome').value.trim();
    r.status = document.getElementById('rec-status').value;
    const v = (r.versoes || []).find(x => x.id === versaoAtiva);
    if (!v) return r;
    v.obs          = document.getElementById('rec-obs').value.trim();
    v.editadaEm    = hoje();
    v.propriedades = coletarIngredientes('rec-props-list');
    // FCK derivado da 1ª propriedade de resistência — usado na lista lateral.
    const fckProp = v.propriedades.find(p => /fck|resist/i.test(p.nome) || /resist/i.test(p.tipo));
    v.fck = fckProp ? fckProp.consumo : null;
    return r;
  }

  function coletarIngredientes(listId) {
    return Array.from(document.querySelectorAll(`#${listId} .rec-ingrediente-row`)).map(row => ({
      nome:    row.querySelector('.ing-nome')?.value    || '',
      tipo:    row.querySelector('.ing-tipo')?.value    || '',
      consumo: parseFloat(row.querySelector('.ing-consumo')?.value) || null,
      unidade: row.querySelector('.ing-unidade')?.value || 'kg/m³',
    }));
  }

  /* ─────────────────────────────────────────────────
     INGREDIENTES
  ───────────────────────────────────────────────── */
  const TIPOS_AGREGADO = ['Areia fina','Areia média','Areia grossa','Brita 0','Brita 1','Brita 2','Pedrisco','Pó de pedra','Outro'];
  const TIPOS_ADITIVO  = ['Plastificante','Superplastificante','Polifuncional','Retardador','Acelerador','Incorporador de ar','Sílica ativa','Cinza volante','Escória','Outro'];
  const UNIDADES       = ['kg/m³','L/m³','%','MPa','mm','% cim','g/m³','un'];
  // Lista única de propriedades (Naor): tipos genéricos + alguns pré-preenchidos.
  const PROP_TIPOS = ['Cimento','Areia','Brita','Pedrisco','Pó de pedra','Água','Aditivo','Adição','Resistência','Outro'];
  function propsPadrao() {
    return [
      { nome:'Cimento', tipo:'Cimento', consumo:null, unidade:'kg/m³' },
      { nome:'Areia',   tipo:'Areia',   consumo:null, unidade:'kg/m³' },
      { nome:'Brita',   tipo:'Brita',   consumo:null, unidade:'kg/m³' },
      { nome:'Água',    tipo:'Água',    consumo:null, unidade:'L/m³' },
    ];
  }
  // Migra versões antigas (campos estruturados) → lista de propriedades, sem
  // perder dados. Usado ao carregar versões salvas antes da simplificação.
  function migrarPropriedades(v) {
    if (Array.isArray(v.propriedades)) return v.propriedades;
    const p = [];
    if (v.fck)          p.push({ nome:'FCK',          tipo:'Resistência', consumo:v.fck,          unidade:'MPa' });
    if (v.slump)        p.push({ nome:'Slump',        tipo:'Outro',       consumo:v.slump,        unidade:'mm' });
    if (v.cimentoKg || v.cimentoTipo) p.push({ nome:v.cimentoTipo||'Cimento', tipo:'Cimento', consumo:v.cimentoKg||null, unidade:'kg/m³' });
    if (v.agua)         p.push({ nome:'Água',         tipo:'Água',        consumo:v.agua,         unidade:'L/m³' });
    if (v.pctArgamassa) p.push({ nome:'% Argamassa',  tipo:'Outro',       consumo:v.pctArgamassa, unidade:'%' });
    (v.agregados || []).forEach(a => p.push({ nome:a.nome||'Agregado', tipo:a.tipo||'Areia',   consumo:a.consumo??null, unidade:a.unidade||'kg/m³' }));
    (v.aditivos  || []).forEach(a => p.push({ nome:a.nome||'Aditivo',  tipo:a.tipo||'Aditivo', consumo:a.consumo??null, unidade:a.unidade||'kg/m³' }));
    return p;
  }
  function renderPropriedades(lista) {
    const el = document.getElementById('rec-props-list');
    el.innerHTML = (lista.length ? cabecalhoIngredientes() : '') + lista.map(p => htmlIngrediente(p, PROP_TIPOS)).join('');
    bindRemoveIngrediente(el); bindIngredienteChange(el);
  }

  function cabecalhoIngredientes() {
    return `<div class="rec-ingrediente-header"><span>Nome</span><span>Tipo</span><span>Valor</span><span>Unidade</span><span></span></div>`;
  }
  function htmlIngrediente(ing, tipos) {
    const listaTipos = (ing.tipo && !tipos.includes(ing.tipo)) ? [ing.tipo, ...tipos] : tipos;
    const tOpts = listaTipos.map(t => `<option ${ing.tipo===t?'selected':''}>${t}</option>`).join('');
    const uOpts = UNIDADES.map(u => `<option ${(ing.unidade||'kg/m³')===u?'selected':''}>${u}</option>`).join('');
    return `<div class="rec-ingrediente-row">
      <input class="ing-nome" type="text" value="${ing.nome||''}" placeholder="Nome">
      <select class="ing-tipo"><option value="">—</option>${tOpts}</select>
      <input class="ing-consumo" type="number" step="0.01" min="0" value="${ing.consumo??''}" placeholder="ex: 800">
      <select class="ing-unidade">${uOpts}</select>
      <button class="rec-btn-remove" title="Remover">×</button>
    </div>`;
  }
  function renderAgregados(lista) {
    const el = document.getElementById('rec-agregados-list');
    el.innerHTML = (lista.length ? cabecalhoIngredientes() : '') + lista.map(a => htmlIngrediente(a, TIPOS_AGREGADO)).join('');
    bindRemoveIngrediente(el); bindIngredienteChange(el);
  }
  function renderAditivos(lista) {
    const el = document.getElementById('rec-aditivos-list');
    el.innerHTML = (lista.length ? cabecalhoIngredientes() : '') + lista.map(a => htmlIngrediente(a, TIPOS_ADITIVO)).join('');
    bindRemoveIngrediente(el); bindIngredienteChange(el);
  }
  function bindRemoveIngrediente(container) {
    container.querySelectorAll('.rec-btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.rec-ingrediente-row').remove();
        if (!container.querySelector('.rec-ingrediente-row')) container.innerHTML = '';
        marcarUnsaved();
      });
    });
  }
  function bindIngredienteChange(container) {
    container.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', marcarUnsaved); el.addEventListener('change', marcarUnsaved);
    });
  }
  function adicionarIngrediente(listId, tipos) {
    const el = document.getElementById(listId);
    if (!el.querySelector('.rec-ingrediente-header')) el.insertAdjacentHTML('beforeend', cabecalhoIngredientes());
    const row = document.createElement('div');
    row.innerHTML = htmlIngrediente({}, tipos);
    el.appendChild(row.firstElementChild);
    bindRemoveIngrediente(el); bindIngredienteChange(el); marcarUnsaved();
  }

  /* ─────────────────────────────────────────────────
     CÁLCULO a/c
  ───────────────────────────────────────────────── */
  function calcAc() {
    const a = parseFloat(document.getElementById('rec-agua').value);
    const c = parseFloat(document.getElementById('rec-cimento-kg').value);
    document.getElementById('rec-ac').value = (a > 0 && c > 0) ? (a/c).toFixed(3) : '';
  }

  /* ─────────────────────────────────────────────────
     UNSAVED / TOAST
  ───────────────────────────────────────────────── */
  function marcarUnsaved() {
    unsaved = true;
    const btn = document.getElementById('rec-btn-salvar');
    if (!btn.querySelector('.rec-unsaved-dot')) btn.insertAdjacentHTML('beforeend', '<span class="rec-unsaved-dot"></span>');
  }
  function limparUnsaved() {
    unsaved = false;
    document.querySelectorAll('.rec-unsaved-dot').forEach(d => d.remove());
  }
  function toast(msg, tipo = '') {
    if (typeof window.showToast === 'function') { window.showToast(msg, tipo); return; }
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = `toast ${tipo}`; t.textContent = msg;
    c.appendChild(t); setTimeout(() => t.remove(), 3000);
  }

  /* ─────────────────────────────────────────────────
     IMPORTAR DA PLANILHA
  ───────────────────────────────────────────────── */
  document.getElementById('rec-btn-importar').addEventListener('click', () => {
    const colunas = window.currentSheetData?.headers || [];
    const opts = colunas.length
      ? colunas.map(c => `<option value="${c}">${c}</option>`).join('')
      : '<option value="">— carregue uma planilha primeiro —</option>';

    document.getElementById('modal-content').innerHTML = `
      <div class="modal-header">IMPORTAR RECEITAS
        <button id="mi-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px;color:var(--text-2);margin-bottom:14px">
          Cada valor único da coluna <strong>Produto</strong> vira uma receita.<br>
          Cada valor único da coluna <strong>Versão/Receita</strong> vira uma versão dentro do produto.
        </p>
        <label>Coluna de Produto</label>
        <select id="mi-prod">${opts}</select>
        <label style="margin-top:12px">Coluna de Versão/Receita</label>
        <select id="mi-vers">${opts}</select>
        ${!colunas.length ? '<p style="color:var(--danger);font-size:11px;margin-top:10px">Abra uma planilha primeiro na aba Planilhas.</p>' : ''}
      </div>
      <div class="modal-footer">
        <button class="secondary-btn" id="mi-cancel">Cancelar</button>
        <button class="primary-btn" id="mi-ok" ${!colunas.length?'disabled':''}>Importar</button>
      </div>`;

    document.getElementById('modal-overlay').style.display = 'flex';
    ['PRODUTO','RECEITA'].forEach((alvo, i) => {
      const sel = document.getElementById(i === 0 ? 'mi-prod' : 'mi-vers');
      if (sel && [...sel.options].some(o => o.value === alvo)) sel.value = alvo;
    });
    document.getElementById('mi-close').onclick  =
    document.getElementById('mi-cancel').onclick = () => { document.getElementById('modal-overlay').style.display = 'none'; };
    document.getElementById('mi-ok').onclick = () => {
      const cp = document.getElementById('mi-prod').value;
      const cv = document.getElementById('mi-vers').value;
      document.getElementById('modal-overlay').style.display = 'none';
      if (!cp) { toast('Selecione a coluna de produto', 'error'); return; }
      importar(cp, cv);
    };
  });

  function importar(colP, colV) {
    const sd = window.currentSheetData;
    if (!sd?.data?.length) { toast('Nenhuma planilha carregada', 'error'); return; }
    const { headers, data } = sd;
    const iP = headers.indexOf(colP), iV = colV ? headers.indexOf(colV) : -1;
    if (iP === -1) { toast('Coluna não encontrada', 'error'); return; }

    const mapa = new Map();
    data.forEach(row => {
      const prod = String(row[iP] || '').trim();
      const vers = iV >= 0 ? String(row[iV] || '').trim() : prod;
      if (!prod) return;
      if (!mapa.has(prod)) mapa.set(prod, new Set());
      if (vers) mapa.get(prod).add(vers);
    });

    let criadas = 0, atualizadas = 0, versAdic = 0;
    mapa.forEach((versoes, nomeProd) => {
      let rec = receitas.find(r => r.nome === nomeProd);
      if (!rec) {
        rec = { id: gerarId('REC'), nome: nomeProd, status: 'ativa', criadaEm: hoje(), versoes: [], versaoAtiva: null };
        receitas.push(rec); criadas++;
      } else { atualizadas++; }
      versoes.forEach(nv => {
        if (!rec.versoes.find(v => v.nome === nv)) {
          const v = { id: gerarId('VRS'), nome: nv, criadaEm: hoje(), editadaEm: hoje() };
          rec.versoes.push(v);
          if (!rec.versaoAtiva) rec.versaoAtiva = v.id;
          versAdic++;
        }
      });
    });
    salvarReceitas().then(() => {
      renderLista();
      toast(`${criadas} criadas · ${atualizadas} atualizadas · ${versAdic} versões`, 'success');
    });
  }

  /* ─────────────────────────────────────────────────
     EVENTOS — RECEITA
  ───────────────────────────────────────────────── */
  document.getElementById('rec-btn-nova').addEventListener('click', async () => {
    if (unsaved && !confirm('Há alterações não salvas. Descartar?')) return;
    const v1 = { id: gerarId('VRS'), nome: 'Versão 1', criadaEm: hoje(), editadaEm: hoje(), propriedades: propsPadrao() };
    const nova = { id: gerarId('REC'), nome: 'Nova Receita', status: 'ativa', criadaEm: hoje(), versoes: [v1], versaoAtiva: v1.id };
    receitas.push(nova);
    await salvarReceitas();
    selecionarReceita(nova.id);
    document.getElementById('rec-nome').focus();
    document.getElementById('rec-nome').select();
  });

  document.getElementById('rec-btn-salvar').addEventListener('click', async () => {
    if (!receitaAtiva) return;
    coletarFormulario();
    await salvarReceitas();
    limparUnsaved(); renderLista();
    toast('Salvo', 'success');
  });

  document.getElementById('rec-btn-excluir').addEventListener('click', async () => {
    if (!receitaAtiva) return;
    const r = receitas.find(x => x.id === receitaAtiva);
    if (!confirm(`Excluir "${r?.nome}"? Todas as versões serão removidas.`)) return;
    receitas = receitas.filter(x => x.id !== receitaAtiva);
    await salvarReceitas();
    receitaAtiva = null; versaoAtiva = null; unsaved = false;
    document.getElementById('rec-form').style.display = 'none';
    document.getElementById('rec-placeholder').style.display = 'flex';
    document.getElementById('rec-btn-salvar').disabled  = true;
    document.getElementById('rec-btn-excluir').disabled = true;
    renderLista(); toast('Receita excluída');
  });

  /* ─────────────────────────────────────────────────
     EVENTOS — VERSÃO
  ───────────────────────────────────────────────── */
  document.getElementById('rec-btn-nova-versao').addEventListener('click', async () => {
    if (!receitaAtiva) return;
    if (unsaved && !confirm('Alterações não salvas. Descartar?')) return;
    const r = receitas.find(x => x.id === receitaAtiva);
    const n = (r.versoes?.length || 0) + 1;
    const v = { id: gerarId('VRS'), nome: `Versão ${n}`, criadaEm: hoje(), editadaEm: hoje() };
    r.versoes.push(v); r.versaoAtiva = v.id; versaoAtiva = v.id;
    await salvarReceitas();
    selecionarReceita(receitaAtiva, v.id);
    toast('Nova versão criada', 'success');
  });

  document.getElementById('rec-btn-duplicar-versao').addEventListener('click', async () => {
    if (!receitaAtiva || !versaoAtiva) return;
    const r = receitas.find(x => x.id === receitaAtiva);
    const orig = r.versoes.find(v => v.id === versaoAtiva);
    if (!orig) return;
    const copia = JSON.parse(JSON.stringify(orig));
    copia.id = gerarId('VRS'); copia.nome = orig.nome + ' (cópia)';
    copia.criadaEm = hoje(); copia.editadaEm = hoje();
    r.versoes.push(copia); r.versaoAtiva = copia.id; versaoAtiva = copia.id;
    await salvarReceitas();
    selecionarReceita(receitaAtiva, copia.id);
    toast('Versão duplicada', 'success');
  });

  document.getElementById('rec-btn-excluir-versao').addEventListener('click', async () => {
    if (!receitaAtiva || !versaoAtiva) return;
    const r = receitas.find(x => x.id === receitaAtiva);
    if (r.versoes.length <= 1) { toast('A receita precisa ter ao menos uma versão', 'error'); return; }
    const v = r.versoes.find(x => x.id === versaoAtiva);
    if (!confirm(`Excluir versão "${v?.nome}"?`)) return;
    r.versoes = r.versoes.filter(x => x.id !== versaoAtiva);
    r.versaoAtiva = r.versoes[0].id; versaoAtiva = r.versaoAtiva;
    await salvarReceitas();
    selecionarReceita(receitaAtiva, versaoAtiva);
    toast('Versão excluída');
  });

  /* ─────────────────────────────────────────────────
     EVENTOS — INGREDIENTES & CAMPOS
  ───────────────────────────────────────────────── */
  document.getElementById('rec-add-prop').addEventListener('click', () => adicionarIngrediente('rec-props-list', PROP_TIPOS));
  document.getElementById('rec-search').addEventListener('input', e => renderLista(e.target.value));
  ['rec-nome','rec-status','rec-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', marcarUnsaved); el.addEventListener('change', marcarUnsaved); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s' && document.querySelector('.nav-btn.active')?.dataset.module==='receitas') {
      e.preventDefault(); document.getElementById('rec-btn-salvar').click();
    }
  });
  window.addEventListener('beforeunload', e => { if (unsaved) { e.preventDefault(); e.returnValue=''; } });

  /* INIT */
  carregarReceitas();

})();
