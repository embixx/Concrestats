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
      <div id="lic-resultado" class="lic-resultado"></div>`;

    openModal('Mensalidade', corpo, () => closeModal(), 'modal-licenca');
    setTimeout(ligar, 40);
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
        mostrar('Não há um endereço de atualização configurado neste computador. ' +
                'A versão instalada é a ' + (j.versao_atual || '—') + '.', null);
        return;
      }
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
      } else {
        mostrar('Você já está na versão mais recente (' + j.versao_atual + ').', true);
      }
    } catch (e) { mostrar('Não consegui verificar agora', false); }
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
