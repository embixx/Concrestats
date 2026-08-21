/**
 * testes.js — Modo Teste
 *
 * Existe para economizar o tempo de quem testa. Em vez de abrir o Trello,
 * montar uma planilha com os casos certos e conferir item por item, ele:
 *   1. carrega uma planilha de DEMONSTRAÇÃO com todos os casos já plantados;
 *   2. roda sozinho as verificações que a máquina consegue fazer;
 *   3. leva até a tela certa, já com o cenário montado, no que precisa de olho.
 *
 * As verificações chamam as MESMAS funções do app (sortData, recomputeFilters,
 * evaluateFormula...). Se um teste passa aqui, passou no código de verdade —
 * não numa cópia paralela que pode divergir.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const espera = ms => new Promise(r => setTimeout(r, ms));
  // Espera a condição acontecer (até `limite` ms). Sem isto, um PC mais lento
  // faria a verificação falhar por atraso e o testador reportaria um bug que
  // não existe — pior do que não testar.
  async function ate(cond, limite = 4000, passo = 100) {
    const fim = Date.now() + limite;
    while (Date.now() < fim) {
      try { if (cond()) return true; } catch (_) {}
      await espera(passo);
    }
    try { return !!cond(); } catch (_) { return false; }
  }

  /* ── planilha de demonstração ─────────────────────
     Cada linha existe por um motivo: datas do mesmo mês (ordenação), MPA
     abaixo e acima do FCK (regra de cor), estorno negativo, célula sem
     número e coluna de código que já enganou a detecção automática. */
  const DEMO_HEADERS = ['CP', 'DATA', 'CLIENTE', 'RECEITA', 'FCK', 'MPA 28', 'M³', 'NF'];
  function dadosDemo() {
    const clientes = ['Alfa Engenharia', 'Beta Construtora', 'Gama Incorporadora', 'Delta Obras'];
    const linhas = [];
    let n = 1;
    // Janeiro: datas embaralhadas de propósito, dentro do MESMO mês
    [30, 5, 21, 13, 8, 27, 2, 17].forEach(dia => {
      const fck = [25, 30][n % 2];
      const mpa = n % 3 === 0 ? fck - 2.4 : fck + 3.1;    // 1 a cada 3 reprova
      linhas.push([`CP-${100 + n}`, `${String(dia).padStart(2, '0')}/01/2026`,
        clientes[n % 4], `${200 + n}-FCK ${fck} S100 B0`, String(fck),
        mpa.toFixed(1).replace('.', ','), String(6 + (n % 5)) + ',5', `NF-${5000 + n}`]);
      n++;
    });
    // Fevereiro a junho: volume para a Análise e o Painel terem o que mostrar
    for (let mes = 2; mes <= 6; mes++) {
      for (let i = 0; i < 9; i++) {
        const fck = [25, 30, 40][i % 3];
        const mpa = i === 4 ? fck - 1.8 : fck + 2 + (i % 6);
        linhas.push([`CP-${100 + n}`, `${String(1 + i * 3).padStart(2, '0')}/${String(mes).padStart(2, '0')}/2026`,
          clientes[i % 4], `${200 + (i % 5)}-FCK ${fck} S100 B0`, String(fck),
          mpa.toFixed(1).replace('.', ','), String(4 + (i % 7)) + ',5', `NF-${5000 + n}`]);
        n++;
      }
    }
    // Casos de borda, no fim para ficarem fáceis de achar
    linhas.push(['CP-999', '15/06/2026', 'Beta Construtora', '204-FCK 25 S100 B0', '25', '31,0', '-12,5', 'NF-9001']);
    linhas.push(['CP-998', '16/06/2026', 'Alfa Engenharia', '201-FCK 30 S100 B0', '30', 'n/d', '8,0', 'NF-9002']);
    return linhas;
  }
  const CADASTRO_HEADERS = ['CLIENTE', 'REGIAO', 'VENDEDOR'];
  const CADASTRO_DADOS = [
    ['Alfa Engenharia', 'Sul', 'Ana'],
    ['Beta Construtora', 'Sudeste', 'Bruno'],
    ['Gama Incorporadora', 'Norte', 'Carla'],
  ];

  let abaDoUsuario = null;      // para devolver o app como estava
  let nomeDemo = 'DEMONSTRAÇÃO';
  let nomeCadastro = 'Cadastro';

  async function limparDemo(preparando) {
    const alvos = new Set(['DEMONSTRAÇÃO', 'Cadastro', nomeDemo, nomeCadastro,
      `${nomeDemo} + ${nomeCadastro}`, 'DEMONSTRAÇÃO + Cadastro']);
    (state.sheets || []).forEach(n => { if (/DEMONSTRA|^Cadastro/.test(n)) alvos.add(n); });
    for (const nome of alvos) {
      try {
        await apiFetch('/api/delete_sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nome })
        });
      } catch (_) {}
    }
    if (!preparando && abaDoUsuario) {
      const r = await apiFetch('/api/get_sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, sheet_name: abaDoUsuario })
      });
      if (r && r.success) loadSheetData(r);
    }
  }

  // Grava no servidor imediatamente. O saveToServer() do app é adiado por
  // debounce — e o cruzamento é feito NO SERVIDOR, então ele encontrava a
  // demonstração ainda vazia e falhava sozinho.
  async function gravarAgora(nome, headers, data) {
    return apiFetch('/api/save_data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nome, headers, data })
    });
  }

  async function carregarDemo(comCadastro) {
    if (state.activeSheet && !/DEMONSTRA|^Cadastro/.test(state.activeSheet)) {
      abaDoUsuario = state.activeSheet;
    }
    // Apaga sobras de uma rodada anterior. Sem isto a segunda execução criava
    // "Cadastro (2)" e o teste de cruzamento falhava sozinho — um bug que não
    // existe é pior do que nenhum teste.
    await limparDemo(true);
    const res = await apiFetch('/api/new_sheet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: SESSION_ID, sheet_name: 'DEMONSTRAÇÃO', demo: true })
    });
    if (!res || !res.success) throw new Error('não consegui criar a planilha de demonstração');
    nomeDemo = res.active_sheet || 'DEMONSTRAÇÃO';
    loadSheetData(res);
    state.headers = DEMO_HEADERS.slice();
    state.data = dadosDemo();
    state.filters = []; state.regrasCor = []; state.congelarCols = 0;
    recomputeFilters();
    renderGrid();
    await gravarAgora(nomeDemo, state.headers, state.data);
    if (comCadastro) {
      const r2 = await apiFetch('/api/new_sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, sheet_name: 'Cadastro', demo: true })
      });
      if (r2 && r2.success) {
        nomeCadastro = r2.active_sheet || 'Cadastro';
        await gravarAgora(nomeCadastro, CADASTRO_HEADERS, CADASTRO_DADOS);
        // volta o foco para a demonstração (o new_sheet ativou o Cadastro)
        const volta = await apiFetch('/api/get_sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nomeDemo })
        });
        if (volta && volta.success) loadSheetData(volta);
        state.headers = DEMO_HEADERS.slice();
        state.data = dadosDemo();
        recomputeFilters(); renderGrid();
        await gravarAgora(nomeDemo, state.headers, state.data);
      }
    }
    notifyDataChanged('demo');
  }

  /* ── itens de teste ───────────────────────────────
     auto:   função que verifica sozinha e devolve {ok, msg}
     ir:     leva até a tela com o cenário montado (para o olho humano) */
  const ITENS = [
    {
      id: 'ordenar',
      titulo: 'Ordenar por data dentro do mesmo mês',
      olhar: 'Clique no cabeçalho DATA. As datas de janeiro devem ficar em ordem.',
      auto: async () => {
        state.sortState = { col: 1, dir: 'asc' };
        sortData();
        const jan = getDisplayRows().filter(r => String(r[1]).includes('/01/2026')).map(r => r[1]);
        const ordenado = jan.slice().sort((a, b) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)));
        const ok = JSON.stringify(jan) === JSON.stringify(ordenado) && jan.length > 3;
        return { ok, msg: ok ? `${jan.length} datas de janeiro em ordem` : 'a ordem não bateu' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'filtro-vive',
      titulo: 'Filtro sobrevive a ordenar, colar e desfazer',
      olhar: 'Filtre um cliente, ordene, adicione linha e desfaça: o filtro continua.',
      auto: async () => {
        state.filters = [{ col: 'CLIENTE', op: '==', val: 'Alfa Engenharia' }];
        recomputeFilters();
        const antes = getDisplayRows().length;
        state.sortState = { col: 1, dir: 'desc' }; sortData();
        const posSort = getDisplayRows().length;
        addRow();
        const posAdd = getDisplayRows().length;
        pushUndo(); state.data.push(state.headers.map(() => 'x')); undo();
        const posUndo = getDisplayRows().length;
        state.filters = []; recomputeFilters(); renderGrid();
        const ok = antes > 0 && posSort === antes && posAdd === antes && posUndo === antes;
        return { ok, msg: ok ? `${antes} linhas mantidas nas 3 operações` : `variou: ${antes}/${posSort}/${posAdd}/${posUndo}` };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'cores',
      titulo: 'Regra de cor: MPA abaixo do FCK fica vermelho',
      olhar: 'A coluna MPA 28 deve ter os reprovados em vermelho e os aprovados em verde.',
      auto: async () => {
        state.regrasCor = [
          { col: 'MPA 28', op: '<', val: '[FCK]', cor: 'vermelho' },
          { col: 'MPA 28', op: '>=', val: '[FCK]', cor: 'verde' },
        ];
        renderGrid();
        const ci = state.headers.indexOf('MPA 28');
        await ate(() => document.querySelectorAll(`#table-body td[data-col="${ci}"]`).length > 0);
        const cels = [...document.querySelectorAll(`#table-body td[data-col="${ci}"]`)];
        const ehNum = c => !isNaN(parseFloat(String(c.textContent).replace(',', '.')));
        const pintadas = cels.filter(c => c.getAttribute('style'));
        const numericas = cels.filter(ehNum);
        const semNumeroPintada = pintadas.filter(c => !ehNum(c)).length;
        const ok = numericas.length > 0 && pintadas.length === numericas.length && semNumeroPintada === 0;
        return {
          ok,
          msg: ok ? `${pintadas.length} células pintadas, nenhuma sem resultado`
                  : `${pintadas.length} pintadas para ${numericas.length} numéricas` +
                    (semNumeroPintada ? ` (${semNumeroPintada} sem número foi pintada)` : '')
        };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'negativos',
      titulo: 'Número negativo aparece em vermelho',
      olhar: 'Procure o CP-999: o M³ dele é -12,5 e deve estar vermelho.',
      auto: async () => {
        const ci = state.headers.indexOf('M³');
        const linha = state.data.findIndex(r => String(r[0]) === 'CP-999');
        if (linha < 0 || ci < 0) return { ok: false, msg: 'não achei o caso na demonstração' };
        selectCell(linha, ci);
        await espera(120);
        const td = document.querySelector(`#table-body td[data-row="${linha}"][data-col="${ci}"]`);
        const ok = !!td && td.classList.contains('cel-neg');
        return { ok, msg: ok ? 'o -12,5 está marcado' : 'não ficou vermelho' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'busca',
      titulo: 'Busca (Ctrl+F) conta e destaca',
      olhar: 'Ctrl+F, digite "Alfa": deve destacar em amarelo e mostrar quantos achou.',
      auto: async () => {
        abrirBusca();
        const inp = $('find-input');
        inp.value = 'alfa'; inp.dispatchEvent(new Event('input'));
        await ate(() => /de\s+\d+/.test($('find-count').textContent));
        const conta = $('find-count').textContent;
        const marcadas = document.querySelectorAll('#table-body td.cel-busca').length;
        fecharBusca();
        const ok = /de\s+\d+/.test(conta) && marcadas > 0;
        return { ok, msg: ok ? `${conta}, ${marcadas} destacadas` : 'não destacou' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); abrirBusca(); },
    },
    {
      id: 'refazer',
      titulo: 'Refazer (Ctrl+Y)',
      olhar: 'Adicione uma linha, Ctrl+Z para desfazer e Ctrl+Y para trazer de volta.',
      auto: async () => {
        const n0 = state.data.length;
        pushUndo(); state.data.push(state.headers.map(() => 'teste')); renderGrid();
        const n1 = state.data.length;
        undo(); const n2 = state.data.length;
        redo(); const n3 = state.data.length;
        undo();                                   // deixa como estava
        const ok = n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1;
        return { ok, msg: ok ? 'desfez e refez certo' : `${n0}/${n1}/${n2}/${n3}` };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'congelar',
      titulo: 'Congelar colunas ao rolar',
      olhar: 'Clique em Congelar e role para o lado: a coluna CP fica parada.',
      auto: async () => {
        state.congelarCols = 2; renderGrid();
        await ate(() => { const t = document.querySelector('#data-table thead th.col-fixa'); return t && t.style.left !== ''; });
        const th = document.querySelector('#data-table thead th.col-fixa');
        const ok = !!th && getComputedStyle(th).position === 'sticky' && th.style.left !== '';
        state.congelarCols = 0; renderGrid();
        return { ok, msg: ok ? 'colunas fixas posicionadas' : 'não ficaram fixas' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); state.congelarCols = 2; renderGrid(); },
    },
    {
      id: 'formula',
      titulo: 'Fórmula com erro mostra #DIV/0!',
      olhar: 'Numa célula, escreva =MPA 28/0 — deve aparecer #DIV/0!, não "Infinity".',
      auto: async () => {
        const r = String(evaluateFormula('=[FCK]/0', state.data[0], state.headers));
        const r2 = String(evaluateFormula('=[FCK]*2', state.data[0], state.headers));
        const ok = r.includes('DIV/0') && !isNaN(parseFloat(r2));
        return { ok, msg: ok ? `divisão por zero vira ${r}` : `retornou ${r}` };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'regex',
      titulo: 'Filtro avisa quando a expressão está quebrada',
      olhar: 'Filtro tipo regex com o valor [a- deve avisar, e não dizer "nada encontrado".',
      auto: async () => {
        document.querySelectorAll('.toast').forEach(t => t.remove());  // avisos antigos confundem
        state.filters = [{ col: 'CLIENTE', op: 'regex', val: '[a-' }];
        recomputeFilters();
        await ate(() => [...document.querySelectorAll('.toast')].some(t => /inv[aá]lida/i.test(t.textContent)));
        const avisou = [...document.querySelectorAll('.toast')]
          .some(t => /inválida|invalida/i.test(t.textContent));
        state.filters = []; recomputeFilters(); renderGrid();
        return { ok: avisou, msg: avisou ? 'avisou que a expressão está quebrada' : 'não avisou' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'cruzar',
      titulo: 'Cruzar planilhas (trazer REGIAO do Cadastro)',
      olhar: 'Cruzar: base DEMONSTRAÇÃO, origem Cadastro, chave CLIENTE, trazendo REGIAO.',
      auto: async () => {
        const r = await apiFetch('/api/join_sheets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: SESSION_ID, left_sheet: nomeDemo, right_sheet: nomeCadastro,
            left_key: 'CLIENTE', right_key: 'CLIENTE', columns: ['REGIAO'], destino: 'nova'
          })
        });
        if (!r || !r.success) return { ok: false, msg: (r && r.error) || 'falhou' };
        const ok = r.data.headers.includes('REGIAO') && r.matched > 0;
        return { ok, msg: ok ? `${r.matched} de ${r.total} linhas casaram` : 'nada casou' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); $('btn-join')?.click(); },
    },
    {
      id: 'importar',
      titulo: 'Importar avisa quando os cabeçalhos não batem',
      olhar: 'Importar uma planilha sem colunas em comum deve avisar, não inserir linhas vazias.',
      auto: async () => {
        const blob = await (await fetch('/api/export_aoa', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aoa: [['NADA_A_VER', 'OUTRA'], ['x', 'y']], base_name: 'teste' })
        })).blob();
        const fd = new FormData();
        fd.append('file', new File([blob], 'teste.xlsx'));
        fd.append('session_id', SESSION_ID);
        fd.append('target_sheet', nomeDemo);
        const r = await fetch('/api/import_merge', { method: 'POST', body: fd });
        const j = await r.json();
        const ok = r.status === 400 && /coluna/i.test(j.error || '');
        return { ok, msg: ok ? 'recusou e explicou o motivo' : 'aceitou sem avisar' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'painel-tipo',
      titulo: 'Painel: escolher Pizza vira pizza mesmo',
      olhar: 'Botão direito num gráfico > Editar > Tipo Pizza. Tem que virar pizza.',
      auto: async () => {
        ConcrestatsOpenModule('painel');
        await ate(() => $('pan-canvas') || document.querySelector('.pan-widget'), 6000);
        if (!document.querySelectorAll('.pan-widget').length) {
          $('pan-auto')?.click();
          await ate(() => document.querySelectorAll('.pan-widget').length > 0, 8000);
        }
        const w = [...document.querySelectorAll('.pan-widget')]
          .find(x => x.querySelector('canvas') && x.querySelector('.pan-w-tag').textContent !== 'calor');
        if (!w) return { ok: false, msg: 'nenhum gráfico no painel' };
        const tag = w.querySelector('.pan-w-tag').textContent;
        return { ok: true, msg: `painel montado (${document.querySelectorAll('.pan-widget').length} widgets, 1º gráfico: ${tag})`, manualDepois: true };
      },
      ir: () => ConcrestatsOpenModule('painel'),
    },
    {
      id: 'recentes',
      titulo: 'Botão Recentes funciona com planilha aberta',
      olhar: 'O botão Recentes na barra deve abrir a lista mesmo já tendo planilha aberta.',
      auto: async () => {
        const b = $('btn-recentes');
        return { ok: !!b, msg: b ? 'botão disponível na barra' : 'botão não existe' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); $('btn-recentes')?.click(); },
    },
    {
      id: 'largura',
      titulo: 'Gráfico passa de 1000px de largura',
      olhar: 'Em Gráficos, aumente a largura de um gráfico para 2000: deve rolar, não cortar.',
      manual: true,
      ir: () => ConcrestatsOpenModule('charts'),
    },
    {
      id: 'png',
      titulo: 'Exportar imagem pergunta onde salvar',
      olhar: 'Na Análise, botão Imagem: deve abrir a janela do Windows perguntando a pasta.',
      manual: true,
      ir: () => ConcrestatsOpenModule('analise'),
    },
    {
      id: 'excel',
      titulo: 'Exportar Excel no computador da empresa',
      olhar: 'Só dá para confirmar na máquina da Usinop — é lá que falhava.',
      manual: true,
      ir: () => ConcrestatsOpenModule('relatorio'),
    },
  ];

  /* ── painel ───────────────────────────────────────── */
  let resultados = {};

  function abrir() {
    let novidades = [];
    let versao = '';
    fetch('/static/versao.json').then(r => r.ok ? r.json() : null).then(v => {
      if (v) { novidades = v.novidades || []; versao = v.versao || ''; }
      desenhar(novidades, versao);
    }).catch(() => desenhar([], ''));
  }

  function desenhar(novidades, versao) {
    const cab = novidades.length
      ? `<div class="tst-novidades"><b>O que mudou nesta versão${versao ? ' (' + esc(versao) + ')' : ''}</b>` +
        `<ul>${novidades.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`
      : '';
    const linhas = ITENS.map(it => `
      <div class="tst-item" data-id="${it.id}">
        <div class="tst-status" id="tst-st-${it.id}">${it.manual ? '👁' : '•'}</div>
        <div class="tst-txt">
          <b>${esc(it.titulo)}</b>
          <span>${esc(it.olhar)}</span>
          <span class="tst-msg" id="tst-msg-${it.id}"></span>
        </div>
        <button class="tst-ir" data-ir="${it.id}">Levar até lá</button>
      </div>`).join('');

    const html = `
      ${cab}
      <div class="tst-acoes">
        <button class="primary-btn" id="tst-rodar">▶ Rodar autoteste</button>
        <button class="secondary-btn" id="tst-demo">Carregar planilha de exemplo</button>
        <button class="secondary-btn" id="tst-limpar">Remover demonstração</button>
        <span class="tst-resumo" id="tst-resumo"></span>
      </div>
      <p class="tst-aviso">O autoteste usa uma planilha de DEMONSTRAÇÃO e a remove no fim.
        Ela nunca entra no seu arquivo, nem se você salvar com ela aberta.
        Os itens com 👁 precisam do seu olho: use "Levar até lá".</p>
      <div class="tst-lista">${linhas}</div>`;

    openModal('Modo Teste', html, () => closeModal());
    setTimeout(() => {
      $('tst-rodar')?.addEventListener('click', rodarTudo);
      $('tst-limpar')?.addEventListener('click', async () => {
        try { await limparDemo(); toast('Demonstração removida', 'success'); }
        catch (e) { toast('Erro: ' + e.message, 'error'); }
      });
      $('tst-demo')?.addEventListener('click', async () => {
        try { await carregarDemo(true); toast('Planilha de demonstração carregada', 'success'); }
        catch (e) { toast('Erro: ' + e.message, 'error'); }
      });
      document.querySelectorAll('[data-ir]').forEach(b => {
        b.addEventListener('click', async () => {
          const it = ITENS.find(x => x.id === b.dataset.ir);
          if (!it) return;
          closeModal();
          try {
            if (!state.headers.length || state.activeSheet !== 'DEMONSTRAÇÃO') await carregarDemo(true);
            it.ir();
            toast(it.olhar, 'success');
          } catch (e) { toast('Erro: ' + e.message, 'error'); }
        });
      });
      // repinta o que já foi rodado nesta sessão
      Object.entries(resultados).forEach(([id, r]) => pintar(id, r));
    }, 40);
  }

  function pintar(id, r) {
    const st = $('tst-st-' + id), msg = $('tst-msg-' + id);
    if (!st) return;
    st.textContent = r.ok ? '✓' : '✕';
    st.className = 'tst-status ' + (r.ok ? 'ok' : 'falhou');
    if (msg) msg.textContent = r.msg || '';
  }

  async function rodarTudo() {
    const btn = $('tst-rodar');
    if (btn) { btn.disabled = true; btn.textContent = 'Rodando...'; }
    // guarda o estado para devolver como estava
    const antes = {
      filtros: JSON.parse(JSON.stringify(state.filters || [])),
      cores: JSON.parse(JSON.stringify(state.regrasCor || [])),
      congelar: state.congelarCols,
    };
    try { await carregarDemo(true); } catch (e) {
      toast('Não consegui montar a demonstração: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '▶ Rodar autoteste'; }
      return;
    }
    let ok = 0, falhou = 0, manuais = 0;
    for (const it of ITENS) {
      if (it.manual) { manuais++; continue; }
      let r;
      try { r = await it.auto(); }
      catch (e) { r = { ok: false, msg: 'erro: ' + e.message }; }
      resultados[it.id] = r;
      pintar(it.id, r);
      r.ok ? ok++ : falhou++;
      await espera(60);
    }
    // devolve o app ao estado anterior e APAGA a demonstração: se ela ficasse
    // na sessão, um Ctrl+S depois gravaria as abas de teste na planilha real.
    state.filters = antes.filtros; state.regrasCor = antes.cores;
    state.congelarCols = antes.congelar;
    try { await limparDemo(); } catch (_) {}
    recomputeFilters();
    ConcrestatsOpenModule('spreadsheet');
    renderGrid();
    const resumo = $('tst-resumo');
    if (resumo) {
      resumo.textContent = `${ok} passaram · ${falhou} falharam · ${manuais} para olhar`;
      resumo.className = 'tst-resumo ' + (falhou ? 'falhou' : 'ok');
    }
    if (btn) { btn.disabled = false; btn.textContent = '▶ Rodar de novo'; }
    toast(falhou ? `${falhou} item(ns) falharam — veja a lista` : `Tudo certo: ${ok} verificações passaram`,
      falhou ? 'error' : 'success');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button');
    b.id = 'btn-modo-teste';
    b.className = 'btn-modo-teste';
    b.title = 'Modo Teste: planilha de exemplo, autoteste e roteiro do que olhar';
    b.textContent = '✓ Testar';
    b.addEventListener('click', abrir);
    document.body.appendChild(b);
  });

  window.ModoTeste = { abrir };
})();
