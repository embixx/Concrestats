// Avisos usam o toast do app (o alert do Windows trava a janela e some
// atras dela em algumas maquinas).
function aviso(msg, tipo) {
  if (window.toast) window.toast(msg, tipo || 'success');
  else alert(msg);
}
(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  let selectedCols = null;
  let ensaioManual = {};   // edições inline do certificado (durante a sessão)
  let lastReport = null;   // {headers, data} do último relatório (todas as linhas filtradas, colunas selecionadas) p/ export xlsx
  // Campos fixos: cache em localStorage + persistência real em /api/prefs
  // (prefs.json ao lado do exe) — não somem ao fechar o app.
  function getFixos(){ try { return JSON.parse(localStorage.getItem('concrestats_ensaio_fixos')||'{}'); } catch(_){ return {}; } }
  function setFixos(o){
    try { localStorage.setItem('concrestats_ensaio_fixos', JSON.stringify(o)); } catch(_){}
    try { fetch('/api/prefs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ensaio_fixos:o})}); } catch(_){}
  }
  function carregarFixosServidor(){
    try{
      window.prefsGet().then(p=>{
        if(p && p.ensaio_fixos && typeof p.ensaio_fixos==='object'){
          try { localStorage.setItem('concrestats_ensaio_fixos', JSON.stringify(p.ensaio_fixos)); } catch(_){}
        }
      }).catch(()=>{});
    }catch(_){}
  }
  function lerCampos(){ const o={}; document.querySelectorAll('#rep-body .ensaio-inp').forEach(i => { o[i.dataset.f] = i.value; }); return o; }

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function norm(s){
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[²2]/g,'2').replace(/[³3]/g,'3')
      .replace(/\([^)]*\)$/,'')
      .replace(/[^A-Z0-9]+/gi,'')
      .toUpperCase();
  }

  function data(){
    return window.getConcrestatsData ? window.getConcrestatsData({filtered:true}) : null;
  }

  function headerIndex(headers, aliases){
    const ns = headers.map(norm);
    for(const a of aliases){
      const na = norm(a);
      let i = ns.findIndex(h => h === na);
      if(i >= 0) return i;
    }
    for(const a of aliases){
      const na = norm(a);
      let i = ns.findIndex(h => h.includes(na) || na.includes(h));
      if(i >= 0) return i;
    }
    return -1;
  }

  function byName(headers, name){
    const n = norm(name);
    return headers.findIndex(h => norm(h) === n || norm(h).replace(/\d+$/,'') === n.replace(/\d+$/,''));
  }

  function reportColDefs(headers){
    const defs = [
      {key:'cp', label:'CP', aliases:['CP','CORPO DE PROVA','N CORPO DE PROVA'], cls:'w-cp'},
      {key:'data', label:'Data', aliases:['DATA','MOLDAGEM','DATA MOLDAGEM'], cls:'w-date'},
      {key:'nf', label:'NF', aliases:['NF','NOTA FISCAL'], cls:'w-id'},
      {key:'cliente', label:'Cliente', aliases:['CLIENTE'], cls:'w-text'},
      {key:'produto', label:'Produto', aliases:['PRODUTO'], cls:'w-text-lg'},
      {key:'receita', label:'Receita', aliases:['RECEITA','TRACO','TRAÇO'], cls:'w-text'},
      {key:'m3', label:'M³', aliases:['M³','M3','VOLUME'], cls:'w-num'},
      {key:'data7', label:'Data 7', aliases:['DATA 7','Data 7','ROMPIMENTO 7'], cls:'w-date'},
      {key:'tnf7', label:'TNF 7', aliases:['TNF 7','TNF7'], cls:'w-num'},
      {key:'area', label:'Área', aliases:['AREA','ÁREA'], cls:'w-num'},
      {key:'mpa7', label:'MPa 7', aliases:['MPA 7','MPa 7','MPA7'], cls:'w-num'},
      {key:'data28', label:'Data 28', aliases:['DATA 28','Data 28','ROMPIMENTO 28'], cls:'w-date'},
      {key:'tnf28', label:'TNF 28', aliases:['TNF 28','TNF28'], cls:'w-num'},
      {key:'mpa28', label:'MPa 28', aliases:['MPA 28','MPa 28','MPA28'], cls:'w-num'}
    ];
    const used = new Set();
    return defs.map(d => {
      const idx = headerIndex(headers, d.aliases);
      if(idx < 0 || used.has(idx)) return null;
      used.add(idx);
      return {...d, idx, sourceLabel: headers[idx]};
    }).filter(Boolean);
  }

  function defaultCols(headers){
    // Colunas do certificado mapeadas para os cabeçalhos reais existentes.
    const out = [];
    [['CP'],['NF'],['M³','M3','VOLUME'],['DATA'],['TNF 28','TNF28'],['MPA 28','MPA28'],['RECEITA']].forEach(al => {
      const i = headerIndex(headers, al); if(i >= 0 && !out.includes(headers[i])) out.push(headers[i]);
    });
    return out.length ? out : reportColDefs(headers).map(c => c.sourceLabel);
  }

  function parseNum(v){
    if(v === null || v === undefined) return NaN;
    if(typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/\s/g,'').replace(/\u00a0/g,'');
    if(!s) return NaN;
    s = s.replace(/[^0-9,\.\-]/g,'');
    if(!s || ['-',',','.'].includes(s)) return NaN;
    if(s.includes(',') && s.includes('.')){
      if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if(s.includes(',')) s = s.replace(',','.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtNum(v, dec=2){
    const n = parseNum(v);
    if(!Number.isFinite(n)) return esc(v);
    return n.toLocaleString('pt-BR', {maximumFractionDigits:dec, minimumFractionDigits:0});
  }

  function fmtDate(v){
    if(v === null || v === undefined || v === '') return '';
    if(typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000){
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toLocaleDateString('pt-BR');
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s;
  }

  function smartValue(colKey, value){
    if(/^data/i.test(colKey)) return fmtDate(value);
    if(['m3','tnf7','tnf28','area','mpa7','mpa28'].includes(colKey)) return fmtNum(value, colKey.startsWith('mpa') ? 2 : 2);
    return esc(value);
  }

  function filteredRows(d){
    const q = ($('rep-filter')?.value || '').toLowerCase().trim();
    const rows = Array.isArray(d.data) ? d.data : [];
    if(!q) return rows;
    return rows.filter(r => r.some(c => String(c || '').toLowerCase().includes(q)));
  }

  function uniqueVal(rows, idx){
    if(idx < 0) return '—';
    const vals = [...new Set(rows.map(r => String(r[idx] ?? '').trim()).filter(Boolean))];
    if(vals.length === 0) return '—';
    if(vals.length === 1) return vals[0];
    return `${vals.length} valores`;
  }

  function sumMetric(rows, idx){
    if(idx < 0) return NaN;
    let total = 0, count = 0;
    rows.forEach(r => { const n = parseNum(r[idx]); if(Number.isFinite(n) && n !== 0){ total += n; count++; } });
    return count ? total : NaN;
  }

  function avgMetric(rows, idx){
    if(idx < 0) return NaN;
    let total = 0, count = 0;
    rows.forEach(r => { const n = parseNum(r[idx]); if(Number.isFinite(n) && n !== 0){ total += n; count++; } });
    return count ? total / count : NaN;
  }

  function render(){
    const d = data();
    const body = $('rep-body');
    if(!body) return;
    if(!d || !Array.isArray(d.headers) || !d.headers.length){
      body.innerHTML = '<div class="graf-empty-state"><div class="empty-icon">◈</div><p>Sem planilha ativa</p><p class="empty-sub">Importe a planilha de rompimentos em Planilhas.</p></div>';
      return;
    }

    const rows = filteredRows(d).filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== ''));
    const H = d.headers;
    const idxCP      = headerIndex(H, ['CP','CORPO DE PROVA','COD','CÓD']);
    const idxNF      = headerIndex(H, ['NF','NOTA FISCAL']);
    const idxM3      = headerIndex(H, ['M³','M3','VOLUME']);
    const idxData    = headerIndex(H, ['DATA','DATA DE MOLDAGEM','MOLDAGEM']);
    const idxTNF28   = headerIndex(H, ['TNF 28','TNF28']);
    const idxMPA28   = headerIndex(H, ['MPA 28','MPA28']);
    const idxCliente = headerIndex(H, ['CLIENTE']);
    const idxProduto = headerIndex(H, ['PRODUTO']);
    const idxReceita = headerIndex(H, ['RECEITA','TRAÇO','TRACO']);

    const fckRow = r => {
      for(const c of [idxReceita, idxProduto]){
        if(c >= 0){ const m = String(r[c]||'').toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/); if(m) return m[1].replace(',','.'); }
      }
      return '';
    };

    // Colunas do certificado (formato "Ensaio de Compressão" do Naor) — ou as
    // colunas escolhidas em "Selecionar colunas".
    const ensaio = [
      { label:'Cód.',             idx:idxCP,    cls:'w-id',   key:'txt'  },
      { label:'NF',               idx:idxNF,    cls:'w-id',   key:'txt'  },
      { label:'Volume (m³)',      idx:idxM3,    cls:'w-num',  key:'num'  },
      { label:'Data de Moldagem', idx:idxData,  cls:'w-date', key:'date' },
      { label:'Ruptura (Ton)',    idx:idxTNF28, cls:'w-num',  key:'num'  },
      { label:'MPa',              idx:idxMPA28, cls:'w-num',  key:'num'  },
      { label:'Fck (MPa)',        idx:-1,       cls:'w-num',  key:'fck'  },
    ].filter(c => c.idx >= 0 || c.key === 'fck');

    const cols = selectedCols
      ? selectedCols.map(c => ({ label:c, idx:byName(H,c), cls:'w-auto', key:norm(c).toLowerCase() })).filter(c => c.idx >= 0)
      : ensaio;
    if(!cols.length){
      body.innerHTML = '<div class="graf-empty-state"><div class="empty-icon">◈</div><p>Não encontrei colunas válidas para relatório.</p></div>';
      return;
    }

    const cellVal = (c, r) => {
      if(c.key === 'fck')  return esc(fckRow(r));
      if(c.key === 'date') return fmtDate(r[c.idx] ?? '');
      if(c.key === 'num')  return fmtNum(r[c.idx] ?? '');
      return esc(r[c.idx] ?? '');
    };
    // versão "crua" (sem HTML) p/ o export xlsx — mesmas colunas selecionadas, TODAS as linhas
    const cellRaw = (c, r) =>
      c.key === 'fck'  ? fckRow(r) :
      c.key === 'date' ? fmtDate(r[c.idx] ?? '') :
      c.key === 'num'  ? fmtNum(r[c.idx] ?? '') :
      String(r[c.idx] ?? '');
    lastReport = { headers: cols.map(c => c.label), data: rows.map(r => cols.map(c => cellRaw(c, r))) };

    const vol     = sumMetric(rows, idxM3);
    const media28 = avgMetric(rows, idxMPA28);
    const fckVals = [...new Set(rows.map(fckRow).filter(Boolean))];
    const fckLabel= fckVals.length === 1 ? fckVals[0] + ' MPa' : (fckVals.length ? fckVals.length + ' valores' : '—');
    const limit = 350;
    const previewRows = rows.slice(0, limit);

    // Campos do certificado: edição inline (ensaioManual) > campos fixos salvos
    // (localStorage) > valor automático dos dados. Tudo editável na tela.
    const fixos = getFixos();
    const autoVals = { cliente: uniqueVal(rows, idxCliente), produto: uniqueVal(rows, idxProduto), fck: fckLabel, prensa: 'Solotest 100T' };
    const campo = f => (ensaioManual[f] != null ? ensaioManual[f] : ((fixos[f] != null && fixos[f] !== '') ? fixos[f] : (autoVals[f] || '')));
    const FIELDS = [['cliente','Cliente'],['obra','Obra'],['contato','Contato'],['email','E-mail'],['cnpj','CNPJ'],['fone','Fone'],['produto','Produto'],['fck','Fck'],['endereco','Endereço'],['cidade','Cidade'],['finalidade','Finalidade'],['dimensao','Dimensão CP']];
    // textarea auto-ajustável: o campo (e o cabeçalho) CRESCE quando o texto é
    // maior, em vez de cortar com "…" (pedido do Naor).
    const formHtml = FIELDS.map(([f,lab]) => `<div><span>${lab}</span><textarea class="ensaio-inp" data-f="${f}" rows="1" placeholder="—">${esc(campo(f))}</textarea></div>`).join('');

    let html = `
      <div class="report-paper report-ensaio">
        <div class="ensaio-head">
          <div class="ensaio-logo"><span>USINOP</span><small>SOLUÇÕES EM CONCRETO</small></div>
          <div class="ensaio-titulo">
            <h2>ENSAIO DE COMPRESSÃO AXIAL DE CORPOS DE PROVA</h2>
            <div class="ensaio-nbr">NBR 5738:2015 e NBR 5739:2018</div>
          </div>
          <div class="ensaio-empresa">USINOP SOLUÇÕES<br>EM CONCRETO LTDA.</div>
        </div>

        <div class="ensaio-form">${formHtml}</div>

        <div class="report-table-title">Corpos de prova · exibindo ${previewRows.length.toLocaleString('pt-BR')} de ${rows.length.toLocaleString('pt-BR')} registros</div>
        <div class="report-table-wrap">
          <table class="report-table technical-report-table ensaio-table">
            <thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>`;

    previewRows.forEach(r => {
      html += '<tr>' + cols.map(c => `<td class="${esc(c.cls || '')}">${cellVal(c, r)}</td>`).join('') + '</tr>';
    });
    html += `</tbody></table></div>
        <div class="ensaio-foot">
          <div><span>Prensa</span> <input class="ensaio-inp ensaio-inp-foot" data-f="prensa" value="${esc(campo('prensa'))}"></div>
          <div><span>Volume total</span> ${Number.isFinite(vol) ? vol.toLocaleString('pt-BR',{maximumFractionDigits:2}) + ' m³' : '—'}</div>
          <div><span>Média MPa 28</span> ${Number.isFinite(media28) ? media28.toLocaleString('pt-BR',{maximumFractionDigits:2}) : '—'}</div>
          <div class="ensaio-norma">NBR 5738:2015 e NBR 5739:2018</div>
        </div>
      </div>`;

    body.innerHTML = html;
    // Auto-altura: o textarea acompanha o conteúdo (campo maior se há mais texto).
    // Fit síncrono — rAF não dispara com a janela em segundo plano.
    const fitInp = t => { if(t.tagName==='TEXTAREA'){ t.style.height='auto'; t.style.height=t.scrollHeight+'px'; } };
    body.querySelectorAll('.ensaio-inp').forEach(inp => {
      inp.addEventListener('input', () => { ensaioManual[inp.dataset.f] = inp.value; fitInp(inp); });
      fitInp(inp);
    });
    requestAnimationFrame(() => {
      body.scrollTop = 0;
      const wrap = body.querySelector('.report-table-wrap');
      if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
    });
  }

  function chooseCols(){
    const d = data();
    if(!d || !d.headers) return;
    const current = new Set(selectedCols || defaultCols(d.headers));
    const html = '<div class="rep-cols-box">' + d.headers.map(h => `
      <label class="rep-col-option"><input type="checkbox" class="rep-col-cb" value="${esc(h)}" ${current.has(h)?'checked':''}> <span>${esc(h)}</span></label>`).join('') + '</div><button id="rep-apply-cols" class="primary-btn" style="margin-top:12px">Aplicar colunas</button>';
    if(window.openModal) openModal('Colunas do relatório', html, () => {}); else aviso('Não consegui abrir a seleção de colunas', 'error');
    setTimeout(() => {
      const b = $('rep-apply-cols');
      if(b) b.onclick = () => {
        selectedCols = [...document.querySelectorAll('.rep-col-cb:checked')].map(c => c.value);
        if(window.closeModal) closeModal();
        render();
      };
    }, 50);
  }

  // Excel no formato do certificado USINOP (7 e 28 dias) — HTML que o Excel
  // abre como planilha. Client-side, não depende do backend.
  function buildEnsaioXls(d, rows){
    const H = d.headers;
    const ix = al => headerIndex(H, al);
    const iCP=ix(['CP']), iNF=ix(['NF']), iM3=ix(['M³','M3','VOLUME']), iProd=ix(['PRODUTO']), iRec=ix(['RECEITA','TRAÇO','TRACO']),
          iData=ix(['DATA']), iD7=ix(['Data 7','DATA 7']), iT7=ix(['TNF 7','TNF7']), iM7=ix(['MPA 7','MPA7']),
          iD28=ix(['Data 28','DATA 28']), iT28=ix(['TNF 28','TNF28']), iM28=ix(['MPA 28','MPA28']);
    const fckOf = r => { for(const c of [iRec,iProd]){ if(c>=0){ const m=String(r[c]||'').toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/); if(m) return m[1].replace(',','.'); } } return ''; };
    const g = (r,i,kind) => i<0 ? '' : (kind==='date'?fmtDate(r[i]) : (kind==='num'?fmtNum(r[i]) : esc(r[i]??'')));
    const C = lerCampos();
    const cli = C.cliente || uniqueVal(rows, ix(['CLIENTE']));
    const prod = C.produto || uniqueVal(rows, iProd);
    const fckVals=[...new Set(rows.map(fckOf).filter(Boolean))];
    const fck = C.fck || (fckVals.length===1?fckVals[0]+' MPa':(fckVals.length?fckVals.join(', '):'—'));
    const NC=11, th='font-weight:bold;background:#1d1c18;color:#fff;text-align:center;mso-number-format:\\@';
    const heads=['Cód.','NF','Volume (m³)','Produto','Data Moldagem','Data Rupt. 7','Ruptura (Ton) 7','Fck 7 (MPa)','Data Rupt. 28','Ruptura (Ton) 28','Fck 28 (MPa)'];
    let h = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1" style="border-collapse:collapse;font-family:Calibri;font-size:10pt">`;
    h += `<tr><td colspan="${NC}" style="font-size:13pt;font-weight:bold;text-align:center;background:#1d1c18;color:#fff">ENSAIO DE COMPRESSÃO AXIAL DE CORPOS DE PROVA</td></tr>`;
    h += `<tr><td colspan="${NC}" style="text-align:center">USINOP SOLUÇÕES EM CONCRETO LTDA. &nbsp;·&nbsp; NBR 5738:2015 e NBR 5739:2018</td></tr>`;
    h += `<tr><td colspan="${NC}"></td></tr>`;
    const pair=(l,v)=>`<td style="font-weight:bold;background:#eee">${esc(l)}</td><td colspan="3">${esc(v||'')}</td>`;
    h += `<tr>${pair('Cliente:',cli)}<td></td>${pair('Obra:',C.obra)}</tr>`;
    h += `<tr>${pair('Contato:',C.contato)}<td></td>${pair('E-mail:',C.email)}</tr>`;
    h += `<tr>${pair('CNPJ:',C.cnpj)}<td></td>${pair('Fone:',C.fone)}</tr>`;
    h += `<tr>${pair('Produto:',prod)}<td></td>${pair('Fck:',fck)}</tr>`;
    h += `<tr>${pair('Endereço:',C.endereco)}<td></td>${pair('Cidade:',C.cidade)}</tr>`;
    h += `<tr>${pair('Finalidade:',C.finalidade)}<td></td>${pair('Dimensão CP:',C.dimensao)}</tr>`;
    h += `<tr>${pair('Prensa:',C.prensa||'Solotest 100T')}<td></td>${pair('','')}</tr>`;
    h += `<tr><td colspan="${NC}"></td></tr>`;
    h += `<tr>${heads.map(t=>`<td style="${th}">${t}</td>`).join('')}</tr>`;
    rows.forEach(r=>{ h += `<tr>${[g(r,iCP),g(r,iNF),g(r,iM3,'num'),g(r,iProd),g(r,iData,'date'),g(r,iD7,'date'),g(r,iT7,'num'),g(r,iM7,'num'),g(r,iD28,'date'),g(r,iT28,'num'),g(r,iM28,'num')].map(v=>`<td>${v}</td>`).join('')}</tr>`; });
    h += `<tr><td colspan="${NC}"></td></tr>`;
    h += `<tr><td colspan="${NC}" style="text-align:center">_____________________________________</td></tr>`;
    h += `<tr><td colspan="${NC}" style="text-align:center">${esc(getFixos().responsavel || 'Responsável Técnico')} &nbsp;·&nbsp; USINOP SOLUÇÕES EM CONCRETO LTDA.</td></tr>`;
    h += `</table></body></html>`;
    return h;
  }

  async function exportFmt(fmt){
    const d = data();
    if(!d) return;

    // HTML: gera o certificado client-side (idêntico à tela) — não depende do backend.
    if(fmt === 'html'){
      const paper = $('rep-body')?.querySelector('.report-ensaio');
      if(!paper){ aviso('Gere o relatório primeiro: clique em Atualizar', 'error'); return; }
      const clone = paper.cloneNode(true);
      // cloneNode não copia .value editado — lê do DOM vivo, par a par.
      const liveInps = paper.querySelectorAll('.ensaio-inp');
      clone.querySelectorAll('.ensaio-inp').forEach((inp, i) => {
        const b = document.createElement('b');
        b.textContent = (liveInps[i] ? liveInps[i].value : inp.value) || '—';
        inp.replaceWith(b);
      });
      let css = '';
      try { css = await (await fetch('/static/css/style.css')).text(); } catch(_){}
      const docHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ensaio de Compressão</title><style>${css}
body{background:#fff;padding:18px}.report-table-wrap{overflow:visible;max-height:none}.report-ensaio{box-shadow:none}</style></head><body>${clone.outerHTML}</body></html>`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([docHtml], {type:'text/html'}));
      a.download = 'ensaio_de_compressao.html'; a.click(); URL.revokeObjectURL(a.href);
      return;
    }

    // Excel: gera um .xlsx REAL a partir do certificado exibido. Respeita as
    // COLUNAS SELECIONADAS e inclui TODAS as linhas filtradas (pedido do Naor:
    // "pegar o conteúdo do html e transformar em planilha"). Abre no Excel e
    // pode ser reimportado no app sem o erro de "engine".
    const paper = $('rep-body')?.querySelector('.report-ensaio');
    if(!paper){ aviso('Gere o relatório primeiro: clique em Atualizar', 'error'); return; }
    if(!lastReport || !lastReport.data || !lastReport.data.length){ aviso('Sem dados para exportar — confira o filtro', 'error'); return; }
    const aoa  = buildEnsaioAOA(paper);

    // 1ª opção: gerar o .xlsx NO SERVIDOR (openpyxl embutido no app). O download
    // via JS falhava em algumas máquinas — aqui o arquivo é escrito direto.
    if(await exportAoaBackend(aoa, 'ensaio_de_compressao', 'Ensaio de Compressão')) return;

    if(typeof XLSX === 'undefined'){ aviso('Não foi possível gerar a planilha', 'error'); return; }
    const ws   = XLSX.utils.aoa_to_sheet(aoa);
    const ncol = aoa.reduce((m, r) => Math.max(m, r.length), 1);
    ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:ncol-1}}, {s:{r:1,c:0},e:{r:1,c:ncol-1}}];
    ws['!cols']   = Array.from({length:ncol}, () => ({wch:18}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ensaio de Compressão');
    XLSX.writeFile(wb, 'ensaio_de_compressao.xlsx');
  }

  // Gera o .xlsx pelo backend. Com pywebview usa o diálogo "Salvar como" nativo
  // e grava no caminho escolhido; sem ele, baixa o arquivo. Retorna true se OK.
  async function exportAoaBackend(aoa, baseName, sheetName){
    try{
      let path = null;
      if(window.pywebview?.api?.save_file_dialog){
        path = await window.pywebview.api.save_file_dialog(baseName + '.xlsx');
        if(!path) return true;              // usuário cancelou — nada a fazer
      }
      const r = await fetch('/api/export_aoa', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ aoa, path, sheet_name: sheetName, base_name: baseName })
      });
      if(!r.ok) return false;
      const ct = r.headers.get('content-type') || '';
      if(ct.includes('json')){
        const j = await r.json();
        if(!j.success){ aviso('Erro ao salvar: ' + (j.error || ''), 'error'); return true; }
        window.showToast?.(`Planilha salva em "${String(j.path).split(/[\\\/]/).pop()}"`, 'success');
        return true;
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = baseName + '.xlsx'; a.click();
      URL.revokeObjectURL(a.href);
      return true;
    }catch(_){ return false; }             // cai no SheetJS
  }

  // Converte "1.234,56" / "32,5" em número; mantém datas, códigos e texto como estão.
  function numXls(t){
    const s = String(t).trim();
    if(s === '') return '';
    const n = s.replace(/\./g,'').replace(',','.');
    return (/^-?\d+(\.\d+)?$/.test(n) && /\d/.test(s)) ? Number(n) : s;
  }

  // Monta a matriz de células do .xlsx a partir do certificado na tela:
  // cabeçalho + campos do formulário + tabela (colunas selecionadas, todas as
  // linhas via lastReport) + rodapé/assinatura.
  function buildEnsaioAOA(paper){
    const aoa = [];
    aoa.push(['ENSAIO DE COMPRESSÃO AXIAL DE CORPOS DE PROVA']);
    aoa.push(['NBR 5738:2015 e NBR 5739:2018']);
    aoa.push([]);
    const campos = [...paper.querySelectorAll('.ensaio-form > div')].map(div => {
      const lab = div.querySelector('span')?.textContent?.trim() || '';
      const inp = div.querySelector('input,textarea');
      return [lab, inp ? (inp.value || '') : ''];
    });
    for(let i=0; i<campos.length; i+=2){
      const a = campos[i], b = campos[i+1];
      aoa.push(b ? [a[0], a[1], '', b[0], b[1]] : [a[0], a[1]]);
    }
    aoa.push([]);
    aoa.push(lastReport.headers.slice());
    lastReport.data.forEach(row => aoa.push(row.map(numXls)));
    aoa.push([]);
    aoa.push(['', (getFixos().responsavel || 'Responsável Técnico') + ' · USINOP SOLUÇÕES EM CONCRETO LTDA.']);
    [...paper.querySelectorAll('.ensaio-foot > div')].forEach(div => {
      const lab = div.querySelector('span')?.textContent?.trim();
      if(!lab) return;
      const inp = div.querySelector('input,textarea');
      aoa.push([lab, inp ? inp.value : div.textContent.replace(lab,'').trim()]);
    });
    return aoa;
  }

  // Campos fixos: valores que ficam salvos e preenchem o certificado sozinhos.
  function configFixos(){
    const fx = getFixos();
    const campos = [['email','E-mail'],['cnpj','CNPJ'],['fone','Fone'],['endereco','Endereço'],['cidade','Cidade'],['contato','Contato'],['obra','Obra'],['finalidade','Finalidade'],['dimensao','Dimensão CP'],['prensa','Prensa'],['responsavel','Responsável Técnico']];
    const body = '<p style="font-size:11px;color:var(--text-2);margin-bottom:10px">Estes valores ficam salvos e preenchem o certificado automaticamente. Você ainda pode editar qualquer campo direto na tela.</p>'
      + campos.map(([f,lab]) => `<label style="display:block;margin:8px 0 2px;font-size:11px;color:var(--text-3)">${lab}</label><input class="rec-search-input fx-inp" data-f="${f}" value="${esc(fx[f]||'')}" style="width:100%">`).join('');
    if(!window.openModal){ aviso('Indisponível', 'error'); return; }
    openModal('Campos fixos do certificado', body, () => {
      const o = {};
      document.querySelectorAll('.fx-inp').forEach(i => { if(i.value.trim()) o[i.dataset.f] = i.value.trim(); });
      setFixos(o);
      if(window.closeModal) closeModal();
      render();
    });
  }

  function init(){
    carregarFixosServidor();
    $('rep-refresh')?.addEventListener('click', render);
    $('rep-filter')?.addEventListener('input', render);
    $('rep-cols')?.addEventListener('click', chooseCols);
    $('rep-fixos')?.addEventListener('click', configFixos);
    $('rep-export-html')?.addEventListener('click', () => exportFmt('html'));
    $('rep-export-xlsx')?.addEventListener('click', () => exportFmt('xlsx'));
    window.addEventListener('concrestats:datachanged', () => setTimeout(render, 50));
  }

  window.RelatorioModule = { onModuleEnter: render };
  document.addEventListener('DOMContentLoaded', init);
})();
