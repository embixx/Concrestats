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
    // A lista do cliente fica velha: o cruzamento cria a aba NO SERVIDOR e a
    // tela nem sempre soube dela. Entao a limpeza pergunta a quem sabe.
    try {
      const info = await apiFetch('/api/sheets_info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID })
      });
      Object.keys((info && info.sheets) || {}).forEach(n => {
        if (/DEMONSTRA|^Cadastro/.test(n)) alvos.add(n);
      });
    } catch (e) { /* sem a lista, segue com os nomes conhecidos */ }
    for (const nome of alvos) {
      try {
        await apiFetch('/api/delete_sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nome })
        });
      } catch (_) {}
    }
    if (preparando) return;

    if (abaDoUsuario) {
      const r = await apiFetch('/api/get_sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, sheet_name: abaDoUsuario })
      });
      if (r && r.success) { loadSheetData(r); return; }
    }

    // Ninguem tinha planilha aberta: o servidor nao deixa apagar a ultima aba,
    // entao criamos uma vazia e apagamos as de demonstracao — a promessa e'
    // que a demonstracao some no fim, e ela tem que valer sempre.
    const nova = await apiFetch('/api/new_sheet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: SESSION_ID, sheet_name: 'Planilha1' })
    });
    for (const nome of alvos) {
      try {
        await apiFetch('/api/delete_sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nome })
        });
      } catch (e) {}
    }
    if (nova && nova.success) {
      const r2 = await apiFetch('/api/get_sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, sheet_name: nova.active_sheet || 'Planilha1' })
      });
      if (r2 && r2.success) loadSheetData(r2);
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
     auto:   verifica sozinho e devolve {ok, msg} (ou {ok, msg, subs:[...]})
     ir:     leva até a tela com o cenário montado, para o olho humano
     grupo:  organiza a lista em blocos                                   */
  const G_ARQ = 'O seu arquivo';
  const G_PLAN = 'Planilha';
  const G_JUNTAR = 'Trazer colunas e importar';
  const G_VIS = 'Análise, gráficos e painel';
  const G_OLHO = 'Precisa do seu olho';

  const ITENS = [
    /* ── grupo: o arquivo de quem usa ───────────────── */
    {
      id: 'arquivo',
      grupo: G_ARQ,
      titulo: 'Salvar não estraga a planilha de trabalho',
      olhar: 'Abra uma planilha sua com fórmula e formatação, mude uma célula, salve e confira no Excel.',
      auto: async () => {
        const r = await apiFetch('/api/autoteste_arquivo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (!r || !r.success) return { ok: false, msg: (r && r.error) || 'não consegui rodar' };
        const subs = (r.checks || []).map(c => ({ ok: c.ok, texto: c.nome, detalhe: c.detalhe }));
        const bons = subs.filter(s => s.ok).length;
        return { ok: !!r.ok, msg: bons + ' de ' + subs.length + ' conferências no arquivo', subs };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'ultima-edicao',
      grupo: G_ARQ,
      titulo: 'A última alteração não se perde ao salvar',
      olhar: 'Digite numa célula e clique em Salvar na sequência: o valor novo tem que ir para o arquivo.',
      auto: async () => {
        const marca = 'X' + Date.now();
        const linha = state.data.length - 1;
        const antes = state.data[linha][2];
        state.data[linha][2] = marca;
        saveToServer();                    // fica pendente (o envio é adiado)
        await enviarPendencias();          // é o que o botão Salvar faz agora
        const r = await apiFetch('/api/get_sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: state.activeSheet })
        });
        const chegou = !!r && JSON.stringify(r.data.data).includes(marca);
        state.data[linha][2] = antes;
        await gravarAgora(state.activeSheet, state.headers, state.data);
        renderGrid();
        return { ok: chegou, msg: chegou ? 'o servidor já estava com o valor novo' : 'o valor novo ficou para trás' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'exportar-csv',
      grupo: G_ARQ,
      titulo: 'Exportar CSV sai com os dados certos',
      olhar: 'Exportar em CSV e abrir no Excel: colunas e acentos têm que estar certos.',
      auto: async () => {
        const r = await fetch(API + '/api/export', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, sheet_name: state.activeSheet, format: 'csv' })
        });
        if (!r.ok) return { ok: false, msg: 'a exportação falhou (' + r.status + ')' };
        const txt = await r.text();
        const temCabecalho = txt.indexOf('CLIENTE') >= 0 && txt.indexOf('MPA 28') >= 0;
        const temAcento = /Incorporadora|Engenharia/.test(txt);
        const linhas = txt.trim().split(/\r?\n/).length;
        const ok = temCabecalho && temAcento && linhas > 40;
        return { ok, msg: ok ? linhas + ' linhas, cabeçalho e acentos ok' : 'o conteúdo não bateu' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },

    /* ── grupo: planilha ─────────────────────────────── */
    {
      id: 'ordenar',
      grupo: G_PLAN,
      titulo: 'Ordenar por data dentro do mesmo mês',
      olhar: 'Clique no cabeçalho DATA. As datas de janeiro devem ficar em ordem.',
      auto: async () => {
        state.sortState = { col: 1, dir: 'asc' };
        sortData();
        const jan = getDisplayRows().filter(r => String(r[1]).indexOf('/01/2026') >= 0).map(r => r[1]);
        const ordenado = jan.slice().sort((a, b) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)));
        const ok = JSON.stringify(jan) === JSON.stringify(ordenado) && jan.length > 3;
        return { ok, msg: ok ? jan.length + ' datas de janeiro em ordem' : 'a ordem não bateu' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'filtro-vive',
      grupo: G_PLAN,
      titulo: 'Filtro sobrevive a ordenar, colar e desfazer',
      olhar: 'Filtre um cliente, ordene, adicione linha e desfaça: o filtro continua valendo.',
      auto: async () => {
        state.filters = [{ col: 'CLIENTE', op: '==', val: 'Alfa Engenharia' }];
        recomputeFilters();
        const antes = getDisplayRows().length;
        state.sortState = { col: 1, dir: 'desc' }; sortData();
        const posSort = getDisplayRows().length;
        const nAntesAdd = state.data.length;
        addRow();
        const posAdd = getDisplayRows().length;
        pushUndo(); state.data.push(state.headers.map(() => 'x')); undo();
        const posUndo = getDisplayRows().length;
        // devolve a planilha como estava: um teste que deixa lixo faz o
        // teste seguinte falhar sozinho, e isso confunde quem esta' testando
        state.data.length = nAntesAdd;
        state.filters = []; recomputeFilters(); renderGrid();
        const ok = antes > 0 && posSort === antes && posAdd === antes && posUndo === antes;
        return { ok, msg: ok ? antes + ' linhas mantidas nas 3 operações'
                             : 'variou: ' + antes + '/' + posSort + '/' + posAdd + '/' + posUndo };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'cores',
      grupo: G_PLAN,
      titulo: 'Regra de cor: MPA abaixo do FCK fica vermelho',
      olhar: 'A coluna MPA 28 deve ter os reprovados em vermelho e os aprovados em verde.',
      auto: async () => {
        state.regrasCor = [
          { col: 'MPA 28', op: '<', val: '[FCK]', cor: 'vermelho' },
          { col: 'MPA 28', op: '>=', val: '[FCK]', cor: 'verde' },
        ];
        renderGrid();
        const ci = state.headers.indexOf('MPA 28');
        await ate(() => document.querySelectorAll('#table-body td[data-col="' + ci + '"]').length > 0);
        const cels = [].slice.call(document.querySelectorAll('#table-body td[data-col="' + ci + '"]'));
        const ehNum = c => !isNaN(parseFloat(String(c.textContent).replace(',', '.')));
        const pintadas = cels.filter(c => c.getAttribute('style'));
        const numericas = cels.filter(ehNum);
        const semNumeroPintada = pintadas.filter(c => !ehNum(c)).length;
        const ok = numericas.length > 0 && pintadas.length === numericas.length && semNumeroPintada === 0;
        return {
          ok,
          msg: ok ? pintadas.length + ' células pintadas, nenhuma sem resultado'
                  : pintadas.length + ' pintadas para ' + numericas.length + ' numéricas' +
                    (semNumeroPintada ? ' (' + semNumeroPintada + ' sem número foi pintada)' : '')
        };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'negativos',
      grupo: G_PLAN,
      titulo: 'Número negativo aparece em vermelho',
      olhar: 'Procure o CP-999: o M³ dele é -12,5 e deve estar vermelho.',
      auto: async () => {
        const ci = state.headers.indexOf('M³');
        const linha = state.data.findIndex(r => String(r[0]) === 'CP-999');
        if (linha < 0 || ci < 0) return { ok: false, msg: 'não achei o caso na demonstração' };
        selectCell(linha, ci);
        await espera(120);
        const td = document.querySelector('#table-body td[data-row="' + linha + '"][data-col="' + ci + '"]');
        const ok = !!td && td.classList.contains('cel-neg');
        return { ok, msg: ok ? 'o -12,5 está marcado' : 'não ficou vermelho' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'busca',
      grupo: G_PLAN,
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
        return { ok, msg: ok ? conta + ', ' + marcadas + ' destacadas' : 'não destacou' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); abrirBusca(); },
    },
    {
      id: 'refazer',
      grupo: G_PLAN,
      titulo: 'Desfazer e Refazer (Ctrl+Z / Ctrl+Y)',
      olhar: 'Adicione uma linha, Ctrl+Z para desfazer e Ctrl+Y para trazer de volta.',
      auto: async () => {
        const n0 = state.data.length;
        pushUndo(); state.data.push(state.headers.map(() => 'teste')); renderGrid();
        const n1 = state.data.length;
        undo(); const n2 = state.data.length;
        redo(); const n3 = state.data.length;
        undo();
        const ok = n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1;
        return { ok, msg: ok ? 'desfez e refez certo' : n0 + '/' + n1 + '/' + n2 + '/' + n3 };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'desfazer-fundo',
      grupo: G_PLAN,
      titulo: 'Desfazer volta várias vezes seguidas',
      olhar: 'Faça 3 alterações e aperte Ctrl+Z três vezes: tem que voltar tudo.',
      auto: async () => {
        const original = state.data[0][2];
        ['um', 'dois', 'tres'].forEach(v => { pushUndo(); state.data[0][2] = v; });
        renderGrid();
        undo(); undo(); undo();
        const ok = state.data[0][2] === original;
        renderGrid();
        return { ok, msg: ok ? 'voltou os 3 passos' : 'parou em "' + state.data[0][2] + '"' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'excluir-linha',
      grupo: G_PLAN,
      titulo: 'Excluir linha e desfazer devolve a linha igual',
      olhar: 'Exclua uma linha e aperte Ctrl+Z: ela volta com o mesmo conteúdo.',
      auto: async () => {
        const n0 = state.data.length;
        const copia = state.data[2].slice();
        pushUndo();
        state.data.splice(2, 1);
        recomputeFilters(); renderGrid();
        const n1 = state.data.length;
        undo();
        const voltou = JSON.stringify(state.data[2]) === JSON.stringify(copia);
        const ok = n1 === n0 - 1 && state.data.length === n0 && voltou;
        renderGrid();
        return { ok, msg: ok ? 'linha excluída e devolvida idêntica'
                             : n0 + ' → ' + n1 + ' → ' + state.data.length };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'congelar',
      grupo: G_PLAN,
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
      grupo: G_PLAN,
      titulo: 'Fórmula com erro mostra #DIV/0!',
      olhar: 'Numa célula, escreva =MPA 28/0 — deve aparecer #DIV/0!, não "Infinity".',
      auto: async () => {
        const r = String(evaluateFormula('=[FCK]/0', state.data[0], state.headers));
        const r2 = String(evaluateFormula('=[FCK]*2', state.data[0], state.headers));
        const ok = r.indexOf('DIV/0') >= 0 && !isNaN(parseFloat(r2));
        return { ok, msg: ok ? 'divisão por zero vira ' + r : 'retornou ' + r };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'regex',
      grupo: G_PLAN,
      titulo: 'Filtro avisa quando a expressão está quebrada',
      olhar: 'Filtro tipo regex com o valor [a- deve avisar, e não dizer "nada encontrado".',
      auto: async () => {
        document.querySelectorAll('.toast').forEach(t => t.remove());
        state.filters = [{ col: 'CLIENTE', op: 'regex', val: '[a-' }];
        recomputeFilters();
        await ate(() => [].slice.call(document.querySelectorAll('.toast')).some(t => /inv[aá]lida/i.test(t.textContent)));
        const avisou = [].slice.call(document.querySelectorAll('.toast'))
          .some(t => /inválida|invalida/i.test(t.textContent));
        state.filters = []; recomputeFilters(); renderGrid();
        return { ok: avisou, msg: avisou ? 'avisou que a expressão está quebrada' : 'não avisou' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },

    /* ── grupo: juntar e importar ────────────────────── */
    {
      id: 'cruzar',
      grupo: G_JUNTAR,
      titulo: 'Trazer colunas de outra planilha (REGIAO do Cadastro)',
      olhar: 'Trazer colunas: recebe DEMONSTRAÇÃO, fornece Cadastro, coluna em comum CLIENTE, trazendo REGIAO.',
      auto: async () => {
        const r = await apiFetch('/api/join_sheets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: SESSION_ID, left_sheet: nomeDemo, right_sheet: nomeCadastro,
            left_key: 'CLIENTE', right_key: 'CLIENTE', columns: ['REGIAO'], destino: 'nova'
          })
        });
        if (!r || !r.success) return { ok: false, msg: (r && r.error) || 'falhou' };
        const ok = r.data.headers.indexOf('REGIAO') >= 0 && r.matched > 0;
        return { ok, msg: ok ? r.matched + ' de ' + r.total + ' linhas casaram' : 'nada casou' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); $('btn-join') && $('btn-join').click(); },
    },
    {
      id: 'cruzar-sem-par',
      grupo: G_JUNTAR,
      titulo: 'Cliente sem cadastro fica em branco, não some',
      olhar: 'A Delta Obras não está no Cadastro: a linha continua, só sem REGIAO.',
      auto: async () => {
        const r = await apiFetch('/api/join_sheets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: SESSION_ID, left_sheet: nomeDemo, right_sheet: nomeCadastro,
            left_key: 'CLIENTE', right_key: 'CLIENTE', columns: ['REGIAO'], destino: 'nova'
          })
        });
        if (!r || !r.success) return { ok: false, msg: (r && r.error) || 'falhou' };
        const iCli = r.data.headers.indexOf('CLIENTE');
        const iReg = r.data.headers.indexOf('REGIAO');
        const delta = r.data.data.filter(l => String(l[iCli]).indexOf('Delta') >= 0);
        const semRegiao = delta.filter(l => !String(l[iReg] || '').trim()).length;
        const ok = r.total === r.data.data.length && delta.length > 0 && semRegiao === delta.length;
        return { ok, msg: ok ? delta.length + ' linhas da Delta preservadas, sem REGIAO'
                             : 'linhas foram perdidas no cruzamento' };
      },
      ir: () => { ConcrestatsOpenModule('spreadsheet'); $('btn-join') && $('btn-join').click(); },
    },
    {
      id: 'importar',
      grupo: G_JUNTAR,
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
      id: 'importar-bate',
      grupo: G_JUNTAR,
      titulo: 'Importar com as mesmas colunas acrescenta as linhas',
      olhar: 'Importar uma planilha com as MESMAS colunas deve somar as linhas no fim.',
      auto: async () => {
        // a conta e' feita no servidor: garantir que ele tem a mesma versao
        await gravarAgora(nomeDemo, state.headers, state.data);
        const antes = state.data.length;
        const linha = DEMO_HEADERS.map(h => h === 'CP' ? 'CP-IMPORTADO' : 'x');
        const blob = await (await fetch('/api/export_aoa', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aoa: [DEMO_HEADERS, linha], base_name: 'teste' })
        })).blob();
        const fd = new FormData();
        fd.append('file', new File([blob], 'teste.xlsx'));
        fd.append('session_id', SESSION_ID);
        fd.append('target_sheet', nomeDemo);
        const r = await fetch('/api/import_merge', { method: 'POST', body: fd });
        const j = await r.json();
        const ok = r.ok && j.success && j.data && j.data.data.length === antes + 1 &&
                   j.data.data.some(l => String(l[0]) === 'CP-IMPORTADO');
        // devolve a demonstração ao estado original
        state.headers = DEMO_HEADERS.slice();
        state.data = dadosDemo();
        await gravarAgora(nomeDemo, state.headers, state.data);
        recomputeFilters(); renderGrid();
        return { ok, msg: ok ? antes + ' → ' + (antes + 1) + ' linhas' : 'a linha importada não apareceu' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },

    /* ── grupo: análise, gráficos e painel ───────────── */
    {
      id: 'painel-monta',
      grupo: G_VIS,
      titulo: 'Painel monta sozinho a partir dos dados',
      olhar: 'Abra o Painel e clique em Montar: devem aparecer blocos com números e gráficos.',
      auto: async () => {
        ConcrestatsOpenModule('painel');
        await ate(() => $('pan-canvas') || document.querySelector('.pan-widget'), 6000);
        if (!document.querySelectorAll('.pan-widget').length) {
          $('pan-auto') && $('pan-auto').click();
          await ate(() => document.querySelectorAll('.pan-widget').length > 0, 8000);
        }
        const widgets = document.querySelectorAll('.pan-widget').length;
        const comGrafico = [].slice.call(document.querySelectorAll('.pan-widget'))
          .filter(w => w.querySelector('canvas')).length;
        const ok = widgets > 0 && comGrafico > 0;
        return { ok, msg: ok ? widgets + ' blocos, ' + comGrafico + ' com gráfico' : 'o painel ficou vazio' };
      },
      ir: () => ConcrestatsOpenModule('painel'),
    },
    {
      id: 'grafico-desenha',
      grupo: G_VIS,
      titulo: 'Gráfico desenha mesmo (não fica em branco)',
      olhar: 'Nenhum gráfico pode ficar branco, cortado ou com um fantasma no canto.',
      auto: async () => {
        ConcrestatsOpenModule('painel');
        await ate(() => document.querySelector('.pan-widget canvas'), 8000);
        const cv = document.querySelector('.pan-widget canvas');
        if (!cv || !cv.width) return { ok: false, msg: 'não achei o gráfico' };
        let pintados = 0;
        try {
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          for (let i = 0; i < d.length; i += 40) { if (d[i + 3] > 10) pintados++; }
        } catch (e) { return { ok: false, msg: 'não consegui ler o gráfico: ' + e.message }; }
        const ok = pintados > 50;
        return { ok, msg: ok ? 'gráfico de ' + cv.width + '×' + cv.height + ' desenhado'
                             : 'a área do gráfico está vazia' };
      },
      ir: () => ConcrestatsOpenModule('painel'),
    },
    {
      id: 'analise-abre',
      grupo: G_VIS,
      titulo: 'Análise monta a tabela cruzada e os indicadores',
      olhar: 'Na Análise: os cartões do topo, a tabela cruzada e os insights têm que sair com números.',
      auto: async () => {
        ConcrestatsOpenModule('analise');
        const sec = () => document.getElementById('module-analise');
        await ate(() => sec() && sec().querySelector('.ana-pivot-wrap table tbody tr'), 8000);
        const s = sec();
        if (!s) return { ok: false, msg: 'a Análise não abriu' };
        const linhas = s.querySelectorAll('.ana-pivot-wrap table tbody tr').length;
        const cartoes = s.querySelectorAll('.dash-card').length;
        const insights = s.querySelectorAll('.ins-card').length;
        const numeros = [].slice.call(s.querySelectorAll('.dash-card'))
          .filter(c => /\d/.test(c.textContent)).length;
        const ok = linhas > 0 && cartoes > 0 && numeros === cartoes;
        return {
          ok,
          msg: ok ? cartoes + ' indicadores, ' + linhas + ' linhas na tabela cruzada, ' +
                    insights + ' insights'
                  : 'tabela ' + linhas + ' linhas / ' + numeros + ' de ' + cartoes + ' cartões com número'
        };
      },
      ir: () => ConcrestatsOpenModule('analise'),
    },
    {
      id: 'analise-grafico',
      grupo: G_VIS,
      titulo: 'Os gráficos da Análise desenham sem fantasma',
      olhar: 'Nenhum gráfico pode ficar branco nem sobrar um pedaço de gráfico no canto.',
      auto: async () => {
        ConcrestatsOpenModule('analise');
        await ate(() => document.querySelectorAll('#module-analise canvas').length > 0, 8000);
        const cvs = [].slice.call(document.querySelectorAll('#module-analise canvas'));
        if (!cvs.length) return { ok: false, msg: 'nenhum gráfico na Análise' };
        const vazios = [];
        cvs.forEach((cv, n) => {
          if (!cv.width || !cv.height) { vazios.push(n + 1); return; }
          try {
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let p = 0;
            for (let i = 0; i < d.length; i += 40) { if (d[i + 3] > 10) p++; }
            if (p < 50) vazios.push(n + 1);
          } catch (e) { vazios.push(n + 1); }
        });
        const ok = vazios.length === 0;
        return { ok, msg: ok ? cvs.length + ' gráficos desenhados' : 'vazios: ' + vazios.join(', ') };
      },
      ir: () => ConcrestatsOpenModule('analise'),
    },
    {
      id: 'relatorio-stats',
      grupo: G_VIS,
      titulo: 'As contas do relatório fecham com a planilha',
      olhar: 'No Relatório Técnico, confira se a média e o fck batem com os dados.',
      auto: async () => {
        const iMpa = state.headers.indexOf('MPA 28');
        const vals = state.data.map(l => parseFloat(String(l[iMpa]).replace(',', '.')))
                               .filter(v => !isNaN(v));
        const media = vals.reduce((a, b) => a + b, 0) / vals.length;
        const ok = vals.length > 30 && media > 10 && media < 100;
        return { ok, msg: ok ? vals.length + ' resultados, média ' + media.toFixed(1) + ' MPa'
                             : 'os números não fecham' };
      },
      ir: () => ConcrestatsOpenModule('relatorio'),
    },
    {
      id: 'modulos-abrem',
      grupo: G_VIS,
      titulo: 'Todas as abas do topo abrem sem travar',
      olhar: 'Passe por Planilhas, Receitas, Gráficos, Análise, Painel, Dashboard e Relatório.',
      auto: async () => {
        const mods = ['receitas', 'charts', 'analise', 'painel', 'dashboard', 'relatorio', 'spreadsheet'];
        const falhas = [];
        const antes = window.onerror;
        let erro = null;
        window.onerror = m => { erro = String(m); };
        for (let i = 0; i < mods.length; i++) {
          try {
            ConcrestatsOpenModule(mods[i]);
            await espera(320);
            if (erro) { falhas.push(mods[i] + ' (' + erro + ')'); erro = null; }
          } catch (e) { falhas.push(mods[i] + ' (' + e.message + ')'); }
        }
        window.onerror = antes;
        ConcrestatsOpenModule('spreadsheet');
        return { ok: !falhas.length, msg: falhas.length ? 'problema em: ' + falhas.join(', ')
                                                        : mods.length + ' abas abriram' };
      },
      ir: () => ConcrestatsOpenModule('spreadsheet'),
    },
    {
      id: 'prefs',
      grupo: G_VIS,
      titulo: 'O que você configura continua salvo',
      olhar: 'Salve um template de gráfico, feche o app e abra de novo: tem que continuar lá.',
      auto: async () => {
        const marca = 'teste-' + Date.now();
        await fetch('/api/prefs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ __teste_modo_teste: marca })
        });
        const p = await window.prefsGet(true);
        const ok = !!p && p.__teste_modo_teste === marca;
        fetch('/api/prefs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ __teste_modo_teste: null })
        });
        return { ok, msg: ok ? 'gravou e leu de volta do disco' : 'não voltou igual' };
      },
      ir: () => ConcrestatsOpenModule('charts'),
    },

    /* ── grupo: precisa do olho ──────────────────────── */
    {
      id: 'largura',
      grupo: G_OLHO,
      titulo: 'Gráfico passa de 1000px de largura',
      olhar: 'Em Gráficos, aumente a largura de um gráfico para 2000: deve rolar, não cortar.',
      manual: true,
      ir: () => ConcrestatsOpenModule('charts'),
    },
    {
      id: 'png',
      grupo: G_OLHO,
      titulo: 'Exportar imagem pergunta onde salvar',
      olhar: 'Na Análise, botão Imagem: deve abrir a janela do Windows perguntando a pasta.',
      manual: true,
      ir: () => ConcrestatsOpenModule('analise'),
    },
    {
      id: 'excel',
      grupo: G_OLHO,
      titulo: 'Exportar Excel no computador da empresa',
      olhar: 'Só dá para confirmar na máquina da Usinop — é lá que falhava.',
      manual: true,
      ir: () => ConcrestatsOpenModule('relatorio'),
    },
  ];

  /* ── tela ─────────────────────────────────────────── */
  let resultados = {};
  let versaoApp = '';
  let filtroAtual = 'tudo';

  function abrir() {
    fetch('/static/versao.json').then(r => r.ok ? r.json() : null).then(v => {
      versaoApp = (v && v.versao) || '';
      desenhar((v && v.novidades) || [], versaoApp);
    }).catch(() => desenhar([], ''));
  }

  function icone(it) {
    const r = resultados[it.id];
    if (it.manual) return { txt: '👁', cls: 'olho' };
    if (!r) return { txt: '', cls: 'vazio' };
    return r.ok ? { txt: '✓', cls: 'ok' } : { txt: '✕', cls: 'falhou' };
  }

  function linhaItem(it) {
    const ic = icone(it);
    const r = resultados[it.id];
    const subs = (r && r.subs) ? r.subs.map(s =>
      '<div class="tst-sub ' + (s.ok ? 'ok' : 'falhou') + '">' +
      '<span>' + (s.ok ? '✓' : '✕') + '</span><span>' + esc(s.texto) + '</span></div>').join('') : '';
    return '' +
      '<div class="tst-item ' + (r && !r.ok ? 'e-falha' : '') + '" data-id="' + it.id + '" data-tipo="' +
        (it.manual ? 'manual' : (r ? (r.ok ? 'ok' : 'falha') : 'pendente')) + '">' +
        '<div class="tst-status ' + ic.cls + '" id="tst-st-' + it.id + '">' + ic.txt + '</div>' +
        '<div class="tst-txt">' +
          '<b>' + esc(it.titulo) + '</b>' +
          '<span class="tst-como">' + esc(it.olhar) + '</span>' +
          '<span class="tst-msg" id="tst-msg-' + it.id + '">' + esc((r && r.msg) || '') + '</span>' +
          '<div class="tst-subs" id="tst-subs-' + it.id + '">' + subs + '</div>' +
        '</div>' +
        '<button class="tst-ir" data-ir="' + it.id + '">Levar até lá</button>' +
      '</div>';
  }

  function desenhar(novidades, versao) {
    const grupos = [];
    ITENS.forEach(it => {
      let g = grupos.find(x => x.nome === it.grupo);
      if (!g) { g = { nome: it.grupo, itens: [] }; grupos.push(g); }
      g.itens.push(it);
    });

    const cab = novidades.length
      ? '<details class="tst-novidades"><summary>O que mudou nesta versão' +
        (versao ? ' (' + esc(versao) + ')' : '') + '</summary><ul>' +
        novidades.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></details>'
      : '';

    const auto = ITENS.filter(i => !i.manual).length;
    const olho = ITENS.length - auto;

    const lista = grupos.map(g =>
      '<div class="tst-grupo"><h4>' + esc(g.nome) +
      '<span>' + g.itens.length + '</span></h4>' +
      g.itens.map(linhaItem).join('') + '</div>').join('');

    const html = '' +
      cab +
      '<div class="tst-topo">' +
        '<button class="primary-btn" id="tst-rodar">▶ Rodar as ' + auto + ' verificações</button>' +
        '<button class="secondary-btn" id="tst-demo">Planilha de exemplo</button>' +
        '<button class="secondary-btn" id="tst-limpar">Remover demonstração</button>' +
        '<button class="secondary-btn" id="tst-copiar" title="Copia o resultado para colar no WhatsApp ou no Trello">Copiar resultado</button>' +
      '</div>' +
      '<div class="tst-barra" id="tst-barra"><i id="tst-barra-fill"></i></div>' +
      '<div class="tst-placar" id="tst-placar">' +
        '<span class="p-ok"><b id="tst-n-ok">0</b> passaram</span>' +
        '<span class="p-falha"><b id="tst-n-falha">0</b> falharam</span>' +
        '<span class="p-olho"><b id="tst-n-olho">' + olho + '</b> para olhar</span>' +
        '<span class="tst-tempo" id="tst-tempo"></span>' +
      '</div>' +
      '<div class="tst-chips">' +
        '<button class="tst-chip ativo" data-filtro="tudo">Tudo</button>' +
        '<button class="tst-chip" data-filtro="falha">Só as falhas</button>' +
        '<button class="tst-chip" data-filtro="manual">Só as de olho</button>' +
      '</div>' +
      '<p class="tst-aviso">A demonstração é uma planilha de mentira, criada só para o teste, ' +
        'e some no fim. Ela <b>nunca</b> entra no seu arquivo — nem se você salvar com ela aberta. ' +
        'Os itens com 👁 precisam do seu olho: use "Levar até lá" que o app já monta a cena.</p>' +
      '<div class="tst-lista" id="tst-lista">' + lista + '</div>';

    openModal('Modo Teste', html, () => closeModal(), 'modal-teste');
    setTimeout(ligarBotoes, 40);
  }

  function ligarBotoes() {
    const b = id => $(id);
    // o rodape padrao (Cancelar / Confirmar) nao faz sentido aqui
    const rodape = document.querySelector('#modal-content .modal-footer');
    if (rodape) {
      const cancelar = rodape.querySelector('.secondary-btn');
      if (cancelar) cancelar.style.display = 'none';
      const fechar = rodape.querySelector('.primary-btn');
      if (fechar) fechar.textContent = 'Fechar';
    }
    b('tst-rodar') && b('tst-rodar').addEventListener('click', rodarTudo);
    b('tst-limpar') && b('tst-limpar').addEventListener('click', async () => {
      try { await limparDemo(); toast('Demonstração removida', 'success'); }
      catch (e) { toast('Erro: ' + e.message, 'error'); }
    });
    b('tst-demo') && b('tst-demo').addEventListener('click', async () => {
      try { await carregarDemo(true); toast('Planilha de demonstração carregada', 'success'); }
      catch (e) { toast('Erro: ' + e.message, 'error'); }
    });
    b('tst-copiar') && b('tst-copiar').addEventListener('click', copiarResultado);
    document.querySelectorAll('.tst-chip').forEach(c => {
      c.addEventListener('click', () => {
        filtroAtual = c.dataset.filtro;
        document.querySelectorAll('.tst-chip').forEach(x => x.classList.toggle('ativo', x === c));
        aplicarFiltro();
      });
    });
    document.querySelectorAll('[data-ir]').forEach(bt => {
      bt.addEventListener('click', async () => {
        const it = ITENS.find(x => x.id === bt.dataset.ir);
        if (!it) return;
        closeModal();
        try {
          if (!state.headers.length || !/DEMONSTRA/.test(state.activeSheet || '')) await carregarDemo(true);
          it.ir();
          toast(it.olhar, 'success');
        } catch (e) { toast('Erro: ' + e.message, 'error'); }
      });
    });
    atualizarPlacar();
    aplicarFiltro();
  }

  function aplicarFiltro() {
    document.querySelectorAll('.tst-item').forEach(el => {
      const t = el.dataset.tipo;
      const mostra = filtroAtual === 'tudo' ||
                     (filtroAtual === 'falha' && t === 'falha') ||
                     (filtroAtual === 'manual' && t === 'manual');
      el.style.display = mostra ? '' : 'none';
    });
    document.querySelectorAll('.tst-grupo').forEach(g => {
      const algum = [].slice.call(g.querySelectorAll('.tst-item')).some(i => i.style.display !== 'none');
      g.style.display = algum ? '' : 'none';
    });
  }

  function atualizarPlacar() {
    const vals = Object.values(resultados);
    const ok = vals.filter(r => r.ok).length;
    const falha = vals.filter(r => !r.ok).length;
    if ($('tst-n-ok')) $('tst-n-ok').textContent = ok;
    if ($('tst-n-falha')) $('tst-n-falha').textContent = falha;
    const placar = $('tst-placar');
    if (placar) placar.classList.toggle('tem-falha', falha > 0);
  }

  function pintar(id, r) {
    const st = $('tst-st-' + id), msg = $('tst-msg-' + id), subs = $('tst-subs-' + id);
    const item = document.querySelector('.tst-item[data-id="' + id + '"]');
    if (st) { st.textContent = r.ok ? '✓' : '✕'; st.className = 'tst-status ' + (r.ok ? 'ok' : 'falhou'); }
    if (msg) msg.textContent = r.msg || '';
    if (item) { item.dataset.tipo = r.ok ? 'ok' : 'falha'; item.classList.toggle('e-falha', !r.ok); }
    if (subs) {
      subs.innerHTML = (r.subs || []).map(s =>
        '<div class="tst-sub ' + (s.ok ? 'ok' : 'falhou') + '">' +
        '<span>' + (s.ok ? '✓' : '✕') + '</span><span>' + esc(s.texto) + '</span></div>').join('');
    }
    atualizarPlacar();
  }

  function marcarRodando(id) {
    const st = $('tst-st-' + id);
    if (st) { st.textContent = '⋯'; st.className = 'tst-status rodando'; }
    const item = document.querySelector('.tst-item[data-id="' + id + '"]');
    if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
  }

  function progresso(feitos, total) {
    const f = $('tst-barra-fill');
    if (f) f.style.width = Math.round((feitos / total) * 100) + '%';
  }

  function copiarResultado() {
    const linhas = ['Concrestats — resultado do teste' + (versaoApp ? ' (' + versaoApp + ')' : '')];
    let grupo = '';
    ITENS.forEach(it => {
      if (it.grupo !== grupo) { grupo = it.grupo; linhas.push('', '[' + grupo + ']'); }
      const r = resultados[it.id];
      const marca = it.manual ? 'OLHAR' : (r ? (r.ok ? 'OK   ' : 'FALHA') : '--   ');
      linhas.push(marca + '  ' + it.titulo + (r && r.msg ? '  (' + r.msg + ')' : ''));
      if (r && r.subs) r.subs.forEach(s => linhas.push('        ' + (s.ok ? '-' : 'X') + ' ' + s.texto));
    });
    const txt = linhas.join('\n');
    const fim = () => toast('Resultado copiado — é só colar', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(fim).catch(() => caiuNoTextarea(txt, fim));
    } else caiuNoTextarea(txt, fim);
  }

  function caiuNoTextarea(txt, fim) {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); fim(); } catch (e) { toast('Não consegui copiar', 'error'); }
    document.body.removeChild(ta);
  }

  async function rodarTudo() {
    const btn = $('tst-rodar');
    if (btn) { btn.disabled = true; btn.textContent = 'Rodando...'; }
    const t0 = Date.now();
    const antes = {
      filtros: JSON.parse(JSON.stringify(state.filters || [])),
      cores: JSON.parse(JSON.stringify(state.regrasCor || [])),
      congelar: state.congelarCols,
      ordem: state.sortState ? JSON.parse(JSON.stringify(state.sortState)) : null,
    };
    try { await carregarDemo(true); } catch (e) {
      toast('Não consegui montar a demonstração: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '▶ Rodar de novo'; }
      return;
    }
    const autos = ITENS.filter(i => !i.manual);
    let feitos = 0, ok = 0, falhou = 0;
    for (let i = 0; i < autos.length; i++) {
      const it = autos[i];
      marcarRodando(it.id);
      let r;
      const ti = Date.now();
      try { r = await it.auto(); }
      catch (e) { r = { ok: false, msg: 'erro: ' + e.message }; }
      r.ms = Date.now() - ti;
      resultados[it.id] = r;
      pintar(it.id, r);
      r.ok ? ok++ : falhou++;
      progresso(++feitos, autos.length);
      await espera(40);
    }
    // devolve o app como estava e APAGA a demonstração
    state.filters = antes.filtros; state.regrasCor = antes.cores;
    state.congelarCols = antes.congelar; state.sortState = antes.ordem;
    try { await limparDemo(); } catch (e) {}
    recomputeFilters();
    ConcrestatsOpenModule('spreadsheet');
    renderGrid();
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    if ($('tst-tempo')) $('tst-tempo').textContent = 'em ' + seg + 's';
    atualizarPlacar();
    aplicarFiltro();
    if (btn) { btn.disabled = false; btn.textContent = '▶ Rodar de novo'; }
    toast(falhou ? falhou + ' item(ns) falharam — veja a lista'
                 : 'Tudo certo: ' + ok + ' verificações passaram',
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
