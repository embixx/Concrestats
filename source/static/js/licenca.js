/**
 * licenca.js — mensalidade e atualização, do lado da tela.
 *
 * Três coisas:
 *   1. um selo discreto na barra de cima, dizendo em que pé está a licença
 *   2. a janela para instalar o arquivo que o cliente recebeu
 *   3. o aviso quando alguma ação esbarra na licença vencida
 *
 * O tom aqui importa. Quem está vendo essa mensagem é um cliente que pagou e
 * esqueceu de renovar, não um pirata. Então: nada de alarme vermelho, nada de
 * bloquear a planilha. Ele continua vendo os dados dele; o que para é gravar.
 */
(function () {
  'use strict';

  if (window.CONCRE_MOBILE) return;       // no APK a licença não se aplica ainda

  let situacao = null;

  const $ = id => document.getElementById(id);

  async function buscar() {
    try {
      const r = await fetch('/api/licenca');
      situacao = await r.json();
      pintarSelo();
      avisarSePreciso();
    } catch (e) { /* sem backend, segue a vida */ }
  }

  function pintarSelo() {
    if (!situacao) return;
    // Sem mensalidade configurada nesta cópia não há o que mostrar. Um selo
    // "sem licença" aqui assustaria quem está só testando, à toa.
    if (situacao.estado === 'livre') {
      const antigo = $('selo-licenca');
      if (antigo) antigo.remove();
      return;
    }
    let selo = $('selo-licenca');
    if (!selo) {
      const direita = document.querySelector('.topbar-right');
      if (!direita) return;
      selo = document.createElement('button');
      selo.id = 'selo-licenca';
      selo.className = 'selo-licenca';
      selo.title = 'Situação da mensalidade';
      selo.addEventListener('click', abrir);
      direita.insertBefore(selo, direita.firstChild);
    }
    const e = situacao.estado;
    selo.className = 'selo-licenca ' + (
      e === 'valida' ? 'ok' :
      e === 'teste' ? 'teste' :
      e === 'cortesia' ? 'atencao' : 'parado');
    selo.textContent =
      e === 'valida' ? (situacao.dias <= 10 ? `vence em ${situacao.dias}d` : 'licenciado') :
      e === 'teste' ? `teste · ${situacao.dias}d` :
      e === 'cortesia' ? `renovar · ${situacao.dias}d` :
      e === 'teste_vencido' ? 'teste encerrado' : 'sem licença';
  }

  let jaAvisou = false;
  function avisarSePreciso() {
    if (jaAvisou || !situacao) return;
    const e = situacao.estado;
    if (e === 'cortesia' || e === 'vencida' || e === 'teste_vencido' ||
        (e === 'teste' && situacao.dias <= 3) ||
        (e === 'valida' && situacao.dias <= 5)) {
      jaAvisou = true;
      setTimeout(() => window.toast && toast(situacao.texto,
        situacao.pode_gravar ? 'info' : 'error'), 1800);
    }
    if (situacao.aviso_arquivo) {
      setTimeout(() => window.toast && toast('Licença: ' + situacao.aviso_arquivo, 'error'), 2600);
    }
  }

  function abrir() {
    const s = situacao || { estado: 'teste', texto: '' };
    const podeEscolher = !!(window.pywebview && pywebview.api && pywebview.api.open_file_dialog);
    const corpo = `
      <div class="lic-estado lic-${s.estado}">
        <b>${escHtml(s.texto || '')}</b>
        ${s.cliente ? `<span>Cliente: ${escHtml(s.cliente)}</span>` : ''}
        ${s.vence ? `<span>Vencimento: ${escHtml(formatarData(s.vence))}</span>` : ''}
      </div>
      ${!s.pode_gravar ? `<p class="lic-nota">Enquanto isso, o programa continua
        abrindo, filtrando, analisando e imprimindo os seus dados normalmente.
        Só <b>salvar</b> e <b>exportar</b> ficam esperando a renovação.</p>` : ''}
      <p class="lic-ajuda">Recebeu o arquivo de licença? Ele costuma vir por e-mail
        ou WhatsApp com o nome <b>licenca.key</b>.</p>
      <div class="lic-acoes">
        ${podeEscolher ? '<button class="secondary-btn" id="lic-escolher">Escolher o arquivo…</button>' : ''}
        <button class="secondary-btn" id="lic-colar">Colar o conteúdo</button>
        <button class="secondary-btn" id="lic-atualizar">Procurar atualização</button>
      </div>
      <div id="lic-colar-area" style="display:none">
        <label>Cole aqui o conteúdo do arquivo</label>
        <textarea id="lic-texto" rows="5" placeholder="Comece colando o texto do licenca.key"></textarea>
      </div>
      <div id="lic-pagar" class="lic-pagar" hidden></div>
      <div id="lic-resultado" class="lic-resultado"></div>`;

    openModal('Mensalidade', corpo, () => closeModal(), 'modal-licenca');
    setTimeout(() => { ligar(); montarPagamento(); }, 40);
  }

  function ligar() {
    $('lic-escolher')?.addEventListener('click', async () => {
      try {
        const p = await pywebview.api.open_file_dialog();
        if (p) instalar({ path: p });
      } catch (e) { mostrar('Não consegui abrir o seletor de arquivos', false); }
    });
    $('lic-colar')?.addEventListener('click', () => {
      const area = $('lic-colar-area');
      if (area.style.display === 'none') { area.style.display = ''; $('lic-texto').focus(); }
      else instalar({ conteudo: $('lic-texto').value.trim() });
    });
    $('lic-atualizar')?.addEventListener('click', procurarAtualizacao);
  }

  // ── pagamento ────────────────────────────────────────────────────────────
  // Fica ESCONDIDO quando ninguém configurou a chave PIX. Botão de pagar que
  // não recebe é pior do que não ter botão nenhum.
  let planoEscolhido = null;

  async function montarPagamento(plano) {
    const caixa = $('lic-pagar');
    if (!caixa) return;
    let d;
    try {
      d = await (await fetch('/api/pagamento' + (plano ? '?plano=' + encodeURIComponent(plano) : ''))).json();
    } catch (e) { return; }
    if (!d || !d.configurado) return;

    planoEscolhido = d.plano && d.plano.id;
    const planos = d.planos || [];
    // Dois planos ficam lado a lado; mais que isso vira lista, para não
    // espremer os cartões e obrigar a ler no talo.
    const opcoes = planos.map(function (p) {
      const marcado = p.id === planoEscolhido;
      return `<button type="button" class="plano${marcado ? ' escolhido' : ''}"
                data-plano="${escHtml(p.id)}" aria-pressed="${marcado}">
                <span class="plano-tit">${escHtml(p.titulo)}</span>
                <span class="plano-valor">${dinheiro(p.valor)}</span>
                ${p.meses > 1 ? `<span class="plano-obs">${dinheiro(p.valor / p.meses)} por mês</span>` : ''}
              </button>`;
    }).join('');

    caixa.hidden = false;
    caixa.innerHTML = `
      <div class="lic-pagar-tit">Pagar por PIX</div>
      ${planos.length > 1 ? `<div class="planos${planos.length > 2 ? ' lista' : ''}">${opcoes}</div>` : ''}
      <div class="pix">
        <div class="pix-qr">${d.qr}</div>
        <div class="pix-lado">
          <p class="pix-como">Abra o aplicativo do banco, escolha <b>PIX</b> e
            aponte para o código. No computador, use <b>Copia e Cola</b>.</p>
          <button class="primary-btn" id="pix-copiar">Copiar código PIX</button>
          <p class="pix-quem">Recebe: ${escHtml(d.recebedor)}</p>
          <p class="pix-depois">Depois de pagar, mande o comprovante. A licença
            chega como um arquivo <b>licenca.key</b> para instalar aqui em cima.</p>
        </div>
      </div>`;

    caixa.querySelectorAll('.plano').forEach(function (b) {
      b.addEventListener('click', function () { montarPagamento(b.dataset.plano); });
    });
    $('pix-copiar')?.addEventListener('click', function () {
      copiar(d.codigo, this);
    });
  }

  function copiar(texto, botao) {
    const feito = function () {
      const antes = botao.textContent;
      botao.textContent = 'Copiado';
      botao.classList.add('feito');
      setTimeout(function () {
        botao.textContent = antes;
        botao.classList.remove('feito');
      }, 2000);
    };
    try {
      navigator.clipboard.writeText(texto).then(feito, function () { manual(texto, feito); });
    } catch (e) { manual(texto, feito); }
  }

  function manual(texto, feito) {
    // Sem área de transferência (acontece em WebView antigo): seleciona o texto
    // num campo, que é o que dá para fazer sem depender do navegador.
    const t = document.createElement('textarea');
    t.value = texto;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); feito(); } catch (e) { /* nada a fazer */ }
    t.remove();
  }

  function dinheiro(v) {
    const n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }

  async function instalar(carga) {
    if (!carga.path && !carga.conteudo) { mostrar('Cole o conteúdo primeiro', false); return; }
    mostrar('Conferindo…', null);
    try {
      const r = await fetch('/api/licenca', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(carga) });
      const j = await r.json();
      if (j.success) {
        situacao = j.situacao; pintarSelo();
        mostrar('Licença instalada. ' + (situacao.texto || ''), true);
        if (window.toast) toast('Licença ativada', 'success');
      } else {
        mostrar(j.error || 'não consegui validar', false);
      }
    } catch (e) { mostrar('Erro: ' + e.message, false); }
  }

  async function procurarAtualizacao() {
    mostrar('Procurando…', null);
    try {
      const j = await (await fetch('/api/atualizacao')).json();
      if (!j.verificou) {
        // Duas coisas bem diferentes vinham com a mesma frase: não ter endereço
        // configurado, e ter endereço e não conseguir chegar nele. Quem lia
        // "não há endereço configurado" depois de uma queda de internet ia
        // procurar configuração que já estava certa.
        mostrar(j.motivo
          ? `Não consegui verificar agora (${j.motivo}). Você está na ` +
            `${j.versao_atual || '—'}.`
          : 'Não há um endereço de atualização configurado neste computador. ' +
            'A versão instalada é a ' + (j.versao_atual || '—') + '.', null);
        rodapeDaInstalacao(j);
        return;
      }
      rodapeDaInstalacao(j);
      if (j.tem_nova) {
        mostrar(`Saiu a versão ${j.versao_nova} — você está na ${j.versao_atual}.`, true);
        const el = $('lic-resultado');
        const b = document.createElement('button');
        b.className = 'primary-btn'; b.id = 'lic-instalar';
        b.style.marginTop = '10px';
        b.textContent = 'Atualizar agora';
        b.addEventListener('click', () => aplicarAtualizacao(b));
        el.appendChild(document.createElement('br'));
        el.appendChild(b);
        if ((j.novidades || []).length) {
          const ul = document.createElement('ul');
          ul.className = 'lic-novidades';
          j.novidades.slice(0, 8).forEach(n => {
            const li = document.createElement('li'); li.textContent = n; ul.appendChild(li);
          });
          el.appendChild(ul);
        }
      } else if (j.restrita) {
        // Dizer "você está na mais recente" aqui seria mentira: existe versão
        // nova, ela só não foi liberada para esta instalação ainda.
        mostrar(`Existe uma versão mais nova (${j.versao_nova}), mas ela foi ` +
                `liberada só para algumas instalações. Você está na ` +
                `${j.versao_atual}.`, null);
      } else {
        mostrar('Você já está na versão mais recente (' + j.versao_atual + ').', true);
      }
    } catch (e) { mostrar('Não consegui verificar agora', false); }
  }

  // Quem entrega o programa precisa saber PARA QUEM está mandando cada versão.
  // Sem um identificador visível, "libera essa correção só para o Naor" não tem
  // como ser dito. São 10 letras sorteadas na primeira vez que o programa roda
  // — não é nome, e-mail nem nada da pessoa.
  function rodapeDaInstalacao(j) {
    const el = $('lic-resultado');
    if (!el || !j.instalacao) return;

    const box = document.createElement('div');
    box.className = 'atz-instalacao';

    if ((j.canais || []).length > 1) {
      const lab = document.createElement('label');
      lab.textContent = 'Canal';
      const sel = document.createElement('select');
      j.canais.forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c === 'teste' ? 'Teste (recebe antes)' : 'Estável';
        if (c === j.canal) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', async () => {
        // Endereço próprio, e não /api/prefs: o canal vale para o computador
        // inteiro, e as prefs comuns são separadas por usuário.
        await fetch('/api/atualizacao', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canal: sel.value }) });
        procurarAtualizacao();
      });
      lab.appendChild(sel);
      box.appendChild(lab);
    }

    const cod = document.createElement('button');
    cod.type = 'button';
    cod.className = 'atz-codigo';
    cod.title = 'Clique para copiar. Mande este código para liberarem uma versão para você.';
    cod.textContent = 'Instalação ' + j.instalacao;
    cod.addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(j.instalacao);
        cod.textContent = 'Copiado';
        setTimeout(() => { cod.textContent = 'Instalação ' + j.instalacao; }, 1800);
      } catch (e) { /* sem área de transferência: o código está na tela */ }
    });
    box.appendChild(cod);
    el.appendChild(box);
  }

  async function aplicarAtualizacao(botao) {
    botao.disabled = true; botao.textContent = 'Baixando…';
    try {
      const j = await (await fetch('/api/atualizar', { method: 'POST' })).json();
      if (j.success) {
        botao.textContent = 'Pronto — reabra o programa';
        mostrar(`Atualizado para a versão ${j.versao}. ${j.mensagem}. ` +
                'Feche e abra o programa para usar a versão nova.', true);
        if (window.toast) toast('Atualização aplicada — reabra o programa', 'success');
      } else {
        botao.disabled = false; botao.textContent = 'Tentar de novo';
        mostrar('Não deu certo: ' + (j.error || 'erro desconhecido'), false);
      }
    } catch (e) {
      botao.disabled = false; botao.textContent = 'Tentar de novo';
      mostrar('Não deu certo: ' + e.message, false);
    }
  }

  function mostrar(texto, bom) {
    const el = $('lic-resultado');
    if (!el) return;
    el.textContent = texto;
    el.className = 'lic-resultado ' + (bom === true ? 'bom' : bom === false ? 'ruim' : '');
  }

  function formatarData(iso) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }
  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Quando o backend recusa por licença, a mensagem tem que ser clara e única
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (entrada, opcoes) {
    const r = await fetchOriginal(entrada, opcoes);
    if (r.status === 402) {
      try {
        const copia = r.clone();
        const j = await copia.json();
        if (j && j.sem_licenca) {
          if (window.toast) toast(j.error, 'error');
          setTimeout(abrir, 400);
        }
      } catch (e) {}
    }
    return r;
  };

  document.addEventListener('DOMContentLoaded', () => setTimeout(buscar, 900));
  window.ConcreLicenca = { abrir, buscar };
})();
