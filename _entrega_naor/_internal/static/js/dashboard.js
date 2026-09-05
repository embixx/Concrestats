(function(){'use strict';
const $=id=>document.getElementById(id);
const preferredMetrics=['MPA 28','MPA 7','TNF 28','TNF 7','M³'];
const preferredGroups=['RECEITA','PRODUTO','CLIENTE'];
function norm(s){return String(s||'').trim().toUpperCase();}
function idx(headers,names){return names.map(n=>headers.findIndex(h=>norm(h)===norm(n))).find(i=>i>=0)??-1;}
function num(v){if(v===null||v===undefined)return NaN;let s=String(v).trim().replace(/\s/g,'');if(!s)return NaN;s=s.replace(/[^0-9,\.\-]/g,'');if(!s||s==='-'||s===','||s==='.')return NaN;if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',', '.');else s=s.replace(/,/g,'');}else if(s.includes(','))s=s.replace(',', '.');const n=Number(s);return isFinite(n)?n:NaN;}
function nums(rows,i,ignoreZero=true){return rows.map(r=>num(r[i])).filter(n=>!isNaN(n)&&(!ignoreZero||n!==0));}
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;}
function median(a){if(!a.length)return NaN;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2;}
function fmt(n,d=2){return isNaN(n)?'—':n.toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d});}
function fckFrom(row,headers){for(const h of ['PRODUTO','RECEITA']){const i=idx(headers,[h]);if(i>=0){const m=String(row[i]||'').toUpperCase().match(/FCK\s*[-:_]*\s*(\d+(?:[\.,]\d+)?)/);if(m)return num(m[1]);}}return NaN;}
// Concrestats: cada ensaio pode ter 2 corpos de prova → pandas gera colunas duplicadas
// ("MPA 28" e "MPA 28.1"). baseName remove o sufixo .N; colsFor devolve TODAS as colunas
// (base + duplicatas) de uma métrica; poolNums junta os valores de todas elas.
function baseName(h){return String(h).replace(/\.\d+$/,'').trim();}
function colsFor(headers,name){const t=norm(name);return headers.map((h,i)=>[h,i]).filter(p=>norm(baseName(p[0]))===t).map(p=>p[1]);}
function poolNums(rows,idxList,ignoreZero=true){const out=[];idxList.forEach(i=>rows.forEach(r=>{const n=num(r[i]);if(!isNaN(n)&&(!ignoreZero||n!==0))out.push(n);}));return out;}
function escTip(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// Tooltip de hover para os gráficos do dashboard (mostra rótulo + info completa).
// Usa um ÚNICO elemento compartilhado (evita acumular divs a cada render).
let _dashTip=null;
function getDashTip(){
  if(!_dashTip){
    _dashTip=document.createElement('div');_dashTip.className='dash-canvas-tip';
    _dashTip.style.cssText='position:fixed;z-index:99999;background:#1b1b18;color:#fff;border:1px solid #555;padding:5px 8px;font:11px IBM Plex Mono,monospace;display:none;pointer-events:none;border-radius:3px;max-width:300px;white-space:normal;line-height:1.4';
    document.body.appendChild(_dashTip);
  }
  return _dashTip;
}
function bindCanvasTooltip(canvas){
  if(canvas._ttBound)return;canvas._ttBound=true;
  canvas.addEventListener('mousemove',e=>{
    const tip=getDashTip();
    const r=canvas.getBoundingClientRect();const sx=(canvas._cssW||canvas.clientWidth||canvas.width)/r.width;const x=(e.clientX-r.left)*sx;
    const b=(canvas._bars||[]).find(b=>x>=b.x-2&&x<=b.x+b.w+2);
    if(!b){tip.style.display='none';return;}
    tip.innerHTML=`<b>${escTip(b.label)}</b><br>${escTip(b.tip)}`;
    tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';tip.style.display='block';
  });
  canvas.addEventListener('mouseleave',()=>{getDashTip().style.display='none';});
}
// Desenha barras/linha num canvas. `tips[i]` = texto extra mostrado no hover.
// Configura o canvas para telas HiDPI (escala do Windows > 100%): o backing store
// passa a ter dpr× pixels e o desenho continua em coordenadas CSS. Sem isso,
// canvas.width=clientWidth deixava o texto/eixos borrados e "fantasma".
function setupCanvas(canvas,fw,fh){
  const dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth||fw,h=canvas.clientHeight||fh;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  canvas._dpr=dpr;canvas._cssW=w;canvas._cssH=h;
  return {ctx,w,h};
}
function drawCanvas(canvas,labels,values,type='bar',tips){
  const {ctx,w,h}=setupCanvas(canvas,700,290);
  ctx.clearRect(0,0,w,h);
  const left=52,right=14,top=16;
  const MAXC=26;                                       // nº de caracteres do nome exibido (antes 18)
  let bottom=type==='line'?30:46;
  if(type!=='line'){                                   // faixa inferior adaptativa p/ caber os nomes
    ctx.font='10px IBM Plex Mono, monospace';let mx=0;
    for(let i=0;i<labels.length;i++){const t=String(labels[i]??'').slice(0,MAXC);const wl=ctx.measureText(t).width;if(wl>mx)mx=wl;}
    bottom=Math.min(170,Math.max(46,Math.ceil(mx)+16));
  }
  const max=Math.max(...values,1),min=Math.min(...values,0);
  ctx.font='11px IBM Plex Mono, monospace';ctx.textAlign='start';
  ctx.strokeStyle='#ececea';ctx.fillStyle='#888';
  for(let i=0;i<=4;i++){const y=top+(h-top-bottom)*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();const v=max-(max-min)*i/4;ctx.fillText(fmt(v,1),4,y+4);}
  const plotW=w-left-right,plotH=h-top-bottom,baseY=top+plotH;const bars=[];
  if(type==='line'){
    ctx.strokeStyle='#2a5298';ctx.lineWidth=2;ctx.beginPath();
    values.forEach((v,i)=>{const x=left+plotW*(i/Math.max(1,values.length-1));const y=top+plotH*(1-(v-min)/(max-min||1));if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
    ctx.stroke();ctx.lineWidth=1;
  }else{
    const slot=plotW/Math.max(1,values.length),bw=Math.max(3,Math.min(46,slot*0.72));
    values.forEach((v,i)=>{const x=left+slot*i+(slot-bw)/2;const y=top+plotH*(1-(v-min)/(max-min||1));const bh=baseY-y;const g=ctx.createLinearGradient(0,y,0,baseY);g.addColorStop(0,'#3f74b5');g.addColorStop(1,'#2a5298');ctx.fillStyle=g;ctx.fillRect(x,y,bw,bh);bars.push({x,y,w:bw,h:bh,label:String(labels[i]??''),value:v,tip:tips&&tips[i]!=null?String(tips[i]):fmt(v,2)});});
    ctx.fillStyle='#555';ctx.font='10px IBM Plex Mono, monospace';
    const step=slot>=8?1:Math.ceil(8/slot);          // se muito apertado, rotula 1 a cada N barras
    values.forEach((v,i)=>{if(i%step)return;const cx=left+slot*i+slot/2;const lab=String(labels[i]??'');const t=lab.length>MAXC?lab.slice(0,MAXC)+'…':lab;ctx.save();ctx.translate(cx,baseY+8);ctx.rotate(-Math.PI/2);ctx.textAlign='right';ctx.fillText(t,0,3);ctx.restore();});
    ctx.font='11px IBM Plex Mono, monospace';ctx.textAlign='start';
  }
  canvas._bars=bars;bindCanvasTooltip(canvas);
}
// ── Distribuição de resistência ─────────────────────────────────────────────
// O gráfico antigo era um gráfico de barras genérico com faixas fixas de 5 MPa.
// Isso escondia justamente o que interessa: concreto de um mesmo fck se agrupa
// numa faixa estreita, então tudo caía em duas ou três barras e a forma da
// distribuição sumia.
//
// O que este desenho mostra, e o outro não mostrava:
//   1. onde está o fck — sem essa linha, olhar a distribuição não responde a
//      pergunta que o laboratório faz, que é "quanto ficou abaixo do projeto"
//   2. quais corpos de prova ficaram abaixo dele, pela cor E pela legenda
//   3. o desvio padrão, que é a medida de constância da usina
//   4. a forma real, com a largura de faixa escolhida a partir dos dados

function desvioPadrao(vals, media) {
  if (vals.length < 2) return NaN;
  const soma = vals.reduce((s, v) => s + (v - media) * (v - media), 0);
  return Math.sqrt(soma / (vals.length - 1));   // amostral: é uma amostra da produção
}

// Largura de faixa a partir da amplitude, não fixa. Mira uma dúzia de barras e
// arredonda para um passo redondo, senão os rótulos saem quebrados (23,7 MPa).
function larguraDeFaixa(vals) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const amplitude = max - min;
  if (!(amplitude > 0)) return 1;
  // Quantas faixas: a raiz do numero de ensaios e' a regra de bolso usual.
  // Poucas faixas achatam a forma; muitas viram serrote sobre ruido.
  const quantas = Math.min(24, Math.max(6, Math.round(Math.sqrt(vals.length))));
  const alvo = amplitude / quantas;
  return [0.25, 0.5, 1, 1.5, 2, 2.5, 5, 10, 20].find(p => p >= alvo) || 25;
}

// O fck pode variar dentro da mesma planilha (produtos diferentes). Pega o mais
// frequente e avisa quando há mais de um, porque aí a distribuição é a soma de
// duas populações e a linha única engana.
function fckPredominante(rows, headers) {
  const contagem = new Map();
  rows.forEach(r => {
    const f = fckFrom(r, headers);
    if (!isNaN(f) && f > 0) contagem.set(f, (contagem.get(f) || 0) + 1);
  });
  if (!contagem.size) return { fck: NaN, quantos: 0 };
  const ordenado = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  return { fck: ordenado[0][0], quantos: contagem.size };
}

function faixas(vals, largura, fck) {
  // As faixas se ancoram NO FCK quando ele existe. Sem isso uma barra fica em
  // cima do limite (24 a 26 com fck 25), metade dela reprovada e metade não —
  // e aí a contagem "abaixo do fck" não bate com o que está pintado de
  // vermelho. Quem lê nota a diferença e passa a desconfiar do resto.
  const min = Math.min(...vals);
  const inicio = !isNaN(fck)
    ? fck - Math.ceil((fck - min) / largura) * largura
    : Math.floor(min / largura) * largura;
  const fim = Math.ceil(Math.max(...vals) / largura) * largura;
  const n = Math.max(1, Math.round((fim - inicio) / largura));
  const contas = new Array(n).fill(0);
  vals.forEach(v => {
    let i = Math.floor((v - inicio) / largura);
    if (i >= n) i = n - 1;                        // o valor máximo entra na última
    if (i < 0) i = 0;
    contas[i]++;
  });
  return { inicio, largura, contas };
}


// Tira do calculo o que nao pode ser concreto.
//
// Na planilha real do laboratorio ha' 4 rupturas registradas como 327, 504,
// 3021 e 3553 MPa, em 7464 ensaios. Concreto de usina rompe entre 20 e 60;
// 3553 MPa e' aco. Sao erros de digitacao ou a carga em kgf caindo na coluna
// de MPa. Sao 0,05% das linhas e sozinhas levavam o desvio padrao de ~8 para
// 55,29 MPa e o coeficiente de variacao para 142%.
//
// O coeficiente de variacao E' a medida de constancia da usina — e' o numero
// que diz se o processo esta sob controle. Com 142% a leitura e' de uma usina
// descontrolada, e nao e' verdade.
//
// O corte e' pela MEDIANA, nao pela media: a media ja' vem contaminada pelos
// proprios erros que se quer achar. Quatro vezes a mediana da' ~146 MPa nesta
// planilha — deixa passar qualquer concreto real, inclusive os de alta
// resistencia, e barra so' o impossivel.
//
// Nada e' apagado, e o que ficou de fora aparece na tela: numero errado
// escondido volta como desconfianca no resto.
function separarImpossiveis(vals) {
  if (vals.length < 8) return { bons: vals, fora: [], limite: NaN };
  const mediana = median(vals);
  if (!(mediana > 0)) return { bons: vals, fora: [], limite: NaN };
  const limite = mediana * 4;
  const bons = [], fora = [];
  vals.forEach(v => (v > limite ? fora : bons).push(v));
  // Se MUITA coisa passou do limite, nao sao erros de digitacao: e' uma coluna
  // que nao e' de resistencia (dinheiro, volume — distribuicoes com cauda
  // longa, onde 4x a mediana e' normal). Ai' mostra tudo: melhor um grafico
  // estranho do que esconder metade dos dados.
  //
  // O piso de 3 existe porque 2% de uma planilha pequena e' menos de um valor:
  // num laboratorio com 31 ensaios e um 3553 digitado errado, a trava sozinha
  // impedia a propria correcao de acontecer. Foi o autoteste que pegou.
  if (fora.length > Math.max(3, vals.length * 0.02)) {
    return { bons: vals, fora: [], limite: NaN };
  }
  return { bons: bons, fora: fora, limite: limite };
}

function drawDistribuicao(canvas, vals, fck) {
  const { ctx, w, h } = setupCanvas(canvas, 700, 300);
  ctx.clearRect(0, 0, w, h);
  if (!vals.length) return;

  const largura = larguraDeFaixa(vals);
  const { inicio, contas } = faixas(vals, largura, fck);
  const maxConta = Math.max(...contas, 1);

  const left = 46, right = 16, top = 26, bottom = 34;
  const plotW = w - left - right, plotH = h - top - bottom, baseY = top + plotH;
  const paraX = mpa => left + plotW * ((mpa - inicio) / (contas.length * largura));

  // Grade: linha sólida de um tom só acima do fundo. Fica atrás de tudo e não
  // disputa atenção com a linha do fck, que é a única tracejada de propósito.
  ctx.font = '10px IBM Plex Mono, monospace';
  ctx.textAlign = 'start';
  // 0, 17, 34, 51 é o que sai de dividir o topo por 4. Ninguém lê contagem
  // assim: o passo sobe para o número redondo mais próximo.
  const bruto = maxConta / 4;
  const escala = Math.pow(10, Math.floor(Math.log10(Math.max(1, bruto))));
  const passoY = Math.max(1,
    [1, 2, 2.5, 5, 10].map(m => m * escala).find(x => x >= bruto) || 10 * escala);
  ctx.strokeStyle = '#ececea';
  ctx.lineWidth = 1;
  for (let v = 0; v <= maxConta; v += passoY) {
    const y = baseY - plotH * (v / maxConta);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillStyle = '#9a968e';
    ctx.fillText(String(v), 6, y + 3);
  }

  // Barras. Reprovado e aprovado se separam pela cor E pela legenda embaixo —
  // cor sozinha exclui quem não distingue vermelho de azul.
  const slot = plotW / contas.length;
  // Num histograma as faixas se encostam de propósito: o eixo é contínuo, e a
  // forma da distribuição só aparece quando as barras formam um contorno. O
  // limite de 24px vale para barra de categoria, onde a folga entre elas é que
  // separa um cliente do outro. Aqui separar quebra a leitura — fica só o vão
  // de 2px do fundo, para as barras não se fundirem numa mancha.
  const larguraBarra = Math.max(2, slot - 2);
  const barras = [];
  contas.forEach((n, i) => {
    if (!n) return;
    const de = inicio + i * largura, ate = de + largura;
    const abaixo = !isNaN(fck) && ate <= fck;
    const x = left + slot * i + (slot - larguraBarra) / 2;
    const alturaBarra = plotH * (n / maxConta);
    const y = baseY - alturaBarra;
    const r = Math.min(4, larguraBarra / 2, alturaBarra);      // topo arredondado, base reta

    ctx.fillStyle = abaixo ? '#b33a2a' : '#2a5298';
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + larguraBarra - r, y);
    ctx.quadraticCurveTo(x + larguraBarra, y, x + larguraBarra, y + r);
    ctx.lineTo(x + larguraBarra, baseY);
    ctx.closePath();
    ctx.fill();

    barras.push({
      x, y, w: larguraBarra, h: alturaBarra,
      label: `${fmt(de, largura < 1 ? 2 : 1)} a ${fmt(ate, largura < 1 ? 2 : 1)} MPa`,
      value: n,
      tip: `${n} corpo(s) de prova` + (abaixo ? ' · abaixo do fck' : '')
    });
  });

  // Linha do fck: tracejada, porque aqui o tracejado significa limite mesmo.
  if (!isNaN(fck) && fck >= inicio && fck <= inicio + contas.length * largura) {
    const x = paraX(fck);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#b33a2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, top - 6); ctx.lineTo(x, baseY); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#b33a2a';
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.textAlign = x > left + plotW * 0.72 ? 'end' : 'start';
    ctx.fillText(`fck ${fmt(fck, 0)}`, x + (ctx.textAlign === 'end' ? -4 : 4), top - 10);
  }

  // Média: linha fina e contínua, para não competir com o limite.
  const media = mean(vals);
  if (!isNaN(media)) {
    const x = paraX(media);
    // Linha escura de 1px some em cima da barra azul, que e' exatamente onde a
    // media costuma cair. Um halo da cor do fundo por baixo resolve: sobre a
    // barra quem separa e' o halo, sobre o fundo quem aparece e' o traco.
    ctx.strokeStyle = 'rgba(250,250,247,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, baseY); ctx.stroke();
    ctx.strokeStyle = '#1c1b18';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, baseY); ctx.stroke();
    // A média cai quase sempre em cima da barra mais alta. Sem uma tarja do
    // tom do fundo atrás, o texto fica ilegível justamente onde importa.
    const texto = `média ${fmt(media, 1)}`;
    ctx.textAlign = x > left + plotW * 0.72 ? 'end' : 'start';
    const larg = ctx.measureText(texto).width + 8;
    const tx = ctx.textAlign === 'end' ? x - larg - 2 : x + 2;
    ctx.fillStyle = 'rgba(250,250,247,.92)';
    ctx.fillRect(tx, top + 1, larg, 14);
    ctx.fillStyle = '#1c1b18';
    ctx.fillText(texto, tx + 4, top + 11);
  }

  // Eixo x: só alguns rótulos, o suficiente para situar. Número em cada barra
  // vira ruído e ninguém lê.
  ctx.fillStyle = '#5a5852';
  ctx.textAlign = 'center';
  ctx.font = '10px IBM Plex Mono, monospace';
  const passoX = Math.ceil(contas.length / Math.max(2, Math.floor(plotW / 62)));
  for (let i = 0; i <= contas.length; i += passoX) {
    const v = inicio + i * largura;
    ctx.fillText(fmt(v, largura < 1 ? 1 : 0), left + slot * i, baseY + 14);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9a968e';
  ctx.fillText('MPa', left + plotW / 2, baseY + 28);
  ctx.textAlign = 'start';

  canvas._bars = barras;
  bindCanvasTooltip(canvas);
}

// Junta tudo: números em cima, gráfico no meio, legenda embaixo. A legenda não
// é enfeite — sem ela a diferença entre aprovado e reprovado seria só cor, e
// cor sozinha não serve para quem não distingue vermelho de azul.
function montarDistribuicao(entrada, rows, headers) {
  const { bons: vals, fora, limite } = separarImpossiveis(entrada);
  const canvas = $('dash-chart-dist');
  const caixaNums = $('dist-numeros');
  const caixaLeg = $('dist-legenda');
  if (!canvas) return;

  if (!vals.length) {
    if (caixaNums) caixaNums.innerHTML = '';
    if (caixaLeg) caixaLeg.innerHTML = '<span class="dist-vazio">Sem resultado de 28 dias nesta seleção</span>';
    const { ctx, w, h } = setupCanvas(canvas, 700, 300);
    ctx.clearRect(0, 0, w, h);
    return;
  }

  const { fck, quantos } = fckPredominante(rows, headers);
  const media = mean(vals);
  const dp = desvioPadrao(vals, media);
  const cv = (!isNaN(dp) && media > 0) ? (dp / media * 100) : NaN;
  const abaixo = !isNaN(fck) ? vals.filter(v => v < fck).length : 0;

  drawDistribuicao(canvas, vals, fck);

  if (caixaNums) {
    const numero = (rotulo, valor, obs) =>
      `<div class="dist-num"><b>${valor}</b><span>${rotulo}</span>` +
      (obs ? `<i>${obs}</i>` : '') + '</div>';
    caixaNums.innerHTML =
      numero('Corpos de prova', vals.length) +
      numero('Média', fmt(media, 1) + ' MPa') +
      numero('Desvio padrão', isNaN(dp) ? '—' : fmt(dp, 2) + ' MPa',
             'constância da usina') +
      numero('Coef. de variação', isNaN(cv) ? '—' : fmt(cv, 1) + '%') +
      (!isNaN(fck)
        ? numero('Abaixo do fck', abaixo,
                 fmt(abaixo / vals.length * 100, 1) + '% do total')
        : '');
  }

  if (caixaLeg) {
    const item = (cor, texto) =>
      `<span class="dist-item"><i class="dist-cor" style="background:${cor}"></i>${texto}</span>`;
    let leg = '';
    if (!isNaN(fck)) {
      leg += item('#2a5298', `Atingiu o fck (${fmt(fck, 0)} MPa)`) +
             item('#b33a2a', 'Abaixo do fck') +
             '<span class="dist-item"><i class="dist-tracejado"></i>Limite do projeto</span>';
      if (quantos > 1) {
        leg += `<span class="dist-alerta">Esta seleção tem ${quantos} fck diferentes. ` +
               `A linha marca o mais frequente; para ler a distribuição de um só, ` +
               `filtre por produto.</span>`;
      }
    } else {
      leg += item('#2a5298', 'Corpos de prova') +
             '<span class="dist-alerta">Sem fck na coluna de produto ou receita, ' +
             'não dá para marcar o limite do projeto.</span>';
    }
    if (fora.length) {
      leg += `<span class="dist-alerta">${fora.length} ` +
        `${fora.length === 1 ? 'resultado ficou' : 'resultados ficaram'} de fora do cálculo ` +
        `por passar de ${fmt(limite, 0)} MPa (${fora.map(v => fmt(v, 0)).join(', ')}). ` +
        `Concreto não chega lá — provavelmente é erro de digitação na planilha.</span>`;
    }
    caixaLeg.innerHTML = leg;
  }
}

// ── Dashboards de Produção/Crescimento (pedido do Naor) ──────────────
let prodModo = 'mes'; // 'mes' | 'ano'
function parseISO(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?{y:+m[1],mo:+m[2],d:+m[3],key:`${m[1]}-${m[2]}-${m[3]}`}:null;}
// Produção (soma de M³) por período + crescimento % vs período anterior.
function producaoPorPeriodo(rows,iData,iVol,modo){
  const map=new Map();
  rows.forEach(r=>{const dt=parseISO(r[iData]);const v=num(r[iVol]);if(!dt||isNaN(v))return;const k=modo==='ano'?String(dt.y):`${dt.y}-${String(dt.mo).padStart(2,'0')}`;map.set(k,(map.get(k)||0)+v);});
  const labels=[...map.keys()].sort();
  const prod=labels.map(k=>map.get(k));
  const growth=prod.map((v,i)=>i===0?null:(prod[i-1]>0?((v-prod[i-1])/prod[i-1]*100):null));
  return {labels,prod,growth};
}
function volumePorDia(rows,iData,iVol){
  const map=new Map();
  rows.forEach(r=>{const dt=parseISO(r[iData]);const v=num(r[iVol]);if(!dt||isNaN(v))return;map.set(dt.key,(map.get(dt.key)||0)+v);});
  return map;
}
// Acima de duas dezenas, barra deixa de ser leitura: na planilha do
// laboratorio sao 425 clientes, que viraram um borrao de 3px por barra com os
// nomes ilegiveis embaixo. Os maiores respondem por quase tudo; o resto vira
// uma barra so', com quantos ela reune escrito no rotulo.
const MAX_BARRAS = 20;
function limitarGrupos(pares, maximo){
  maximo = maximo || MAX_BARRAS;
  if (pares.length <= maximo + 1) return {pares: pares, agrupados: 0};
  const topo = pares.slice(0, maximo);
  const resto = pares.slice(maximo);
  const soma = resto.reduce((t,x)=>t+x[1], 0);
  return {pares: topo.concat([['Outros (' + resto.length + ')', soma]]),
          agrupados: resto.length};
}
function volumePorGrupo(rows,iGrp,iVol){
  const map=new Map();
  rows.forEach(r=>{const k=(String(r[iGrp]||'').trim()||'(em branco)');const v=num(r[iVol]);if(!k||isNaN(v))return;map.set(k,(map.get(k)||0)+v);});
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}
// Combo: barras (produção, eixo esquerdo) + linha (crescimento %, eixo direito).
function drawCombo(canvas,labels,bars,line){
  const {ctx,w,h}=setupCanvas(canvas,700,300);
  ctx.clearRect(0,0,w,h);
  const left=60,right=54,top=22,bottom=44,plotW=w-left-right,plotH=h-top-bottom,baseY=top+plotH;
  const maxBar=Math.max(...bars,1);
  const lv=line.filter(v=>v!=null&&isFinite(v));
  let gMin=Math.min(0,...lv),gMax=Math.max(0,...lv,1);if(gMin===gMax){gMin-=1;gMax+=1;}
  ctx.font='11px IBM Plex Mono, monospace';
  for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.strokeStyle='#ececea';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();
    ctx.fillStyle='#2a5298';ctx.textAlign='right';ctx.fillText(fmt(maxBar-maxBar*i/4,0),left-6,y+4);
    ctx.fillStyle='#2a6640';ctx.textAlign='left';ctx.fillText(fmt(gMax-(gMax-gMin)*i/4,0)+'%',w-right+6,y+4);}
  const n=bars.length,slot=plotW/Math.max(1,n),bw=Math.max(5,Math.min(46,slot*0.6)),geom=[];
  bars.forEach((v,i)=>{const x=left+slot*i+(slot-bw)/2,y=top+plotH*(1-v/maxBar),bh=baseY-y;const g=ctx.createLinearGradient(0,y,0,baseY);g.addColorStop(0,'#2f5fa6');g.addColorStop(1,'#1f3f73');ctx.fillStyle=g;ctx.fillRect(x,y,bw,bh);geom.push({x:left+slot*i,w:slot,label:String(labels[i]),tip:`Produção: ${fmt(v,0)} m³`+(line[i]!=null&&isFinite(line[i])?` · Cresc.: ${fmt(line[i],2)}%`:'')});});
  ctx.fillStyle='#1f3f73';ctx.textAlign='center';ctx.font='10px IBM Plex Mono, monospace';
  bars.forEach((v,i)=>{ctx.fillText(fmt(v,0),left+slot*i+slot/2,top+plotH*(1-v/maxBar)-3);});
  const yG=v=>top+plotH*(1-(v-gMin)/(gMax-gMin||1));
  ctx.strokeStyle='#2a6640';ctx.lineWidth=2;ctx.beginPath();let st=false;
  line.forEach((v,i)=>{if(v==null||!isFinite(v))return;const x=left+slot*i+slot/2,y=yG(v);if(!st){ctx.moveTo(x,y);st=true;}else ctx.lineTo(x,y);});
  ctx.stroke();ctx.lineWidth=1;ctx.fillStyle='#2a6640';
  line.forEach((v,i)=>{if(v==null||!isFinite(v))return;const x=left+slot*i+slot/2,y=yG(v);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillText(fmt(v,1)+'%',x,y-8);});
  ctx.font='11px IBM Plex Mono, monospace';ctx.fillStyle='#555';
  labels.forEach((l,i)=>{ctx.fillText(String(l),left+slot*i+slot/2,baseY+16);});
  ctx.textAlign='start';canvas._bars=geom;bindCanvasTooltip(canvas);
}
// Mapa de calor (calendário tipo GitHub) — cor por volume diário (m³).
function drawHeatmap(container,dayMap){
  const keys=[...dayMap.keys()].sort();
  if(!keys.length){container.innerHTML='<div class="dash-empty-mini">Sem datas para o mapa de calor</div>';return;}
  const s=parseISO(keys[0]),e=parseISO(keys[keys.length-1]);
  const d0=new Date(Date.UTC(s.y,s.mo-1,s.d)),d1=new Date(Date.UTC(e.y,e.mo-1,e.d));
  const maxV=Math.max(...dayMap.values(),1);
  const color=v=>{if(v<=0)return'#ebedf0';const t=Math.min(1,v/maxV);return t<0.25?'#c6e48b':t<0.5?'#7bc96f':t<0.75?'#239a3b':'#196127';};
  const cur=new Date(d0);cur.setUTCDate(cur.getUTCDate()-((cur.getUTCDay()+6)%7));
  const cols=[];let guard=0;
  while(guard++<2000){
    const wk=[];for(let r=0;r<7;r++){const key=cur.toISOString().slice(0,10);wk.push({key,v:dayMap.get(key)||0,inRange:cur>=d0&&cur<=d1});cur.setUTCDate(cur.getUTCDate()+1);}
    cols.push(wk);
    if(cur>d1&&((cur.getUTCDay()+6)%7)===0)break;
  }
  const C=12,G=3,wsvg=cols.length*(C+G)+44,hsvg=7*(C+G)+34;
  let svg=`<svg width="${wsvg}" height="${hsvg}" style="font-family:IBM Plex Mono,monospace">`;
  ['Seg','','Qua','','Sex','','Dom'].forEach((dn,r)=>{if(dn)svg+=`<text x="2" y="${30+r*(C+G)+C-2}" font-size="9" fill="#999">${dn}</text>`;});
  let lastMo='';
  cols.forEach((wk,c)=>{
    const fday=wk.find(d=>d.inRange);
    if(fday){const mo=fday.key.slice(0,7);if(mo!==lastMo){lastMo=mo;svg+=`<text x="${42+c*(C+G)}" y="18" font-size="9" fill="#999">${fday.key.slice(5,7)}/${fday.key.slice(2,4)}</text>`;}}
    wk.forEach((cell,r)=>{if(!cell.inRange)return;const x=42+c*(C+G),y=24+r*(C+G);svg+=`<rect x="${x}" y="${y}" width="${C}" height="${C}" rx="2" fill="${color(cell.v)}"><title>${cell.v.toFixed(1)} m³ · ${cell.key.split('-').reverse().join('/')}</title></rect>`;});
  });
  svg+='</svg>';container.innerHTML=svg;
}
function render(){const d=window.getConcrestatsData?window.getConcrestatsData({filtered:true}):null;const body=$('dash-body');/* Numa edicao que esconde esta aba, o elemento nao existe mais — mas o modulo continua ouvindo a troca de planilha e quebrava aqui a cada arquivo aberto. */if(!body)return;if(!d||!d.headers||!d.headers.length){body.innerHTML='<div class="graf-empty-state"><div class="empty-icon">◈</div><p>Sem planilha ativa</p></div>';return;}const {headers,data:rows}=d;const cM28=colsFor(headers,'MPA 28'), cM7=colsFor(headers,'MPA 7'), iVol=idx(headers,['M³','M3','VOLUME']);const m28=poolNums(rows,cM28),m7=poolNums(rows,cM7),vol=iVol>=0?nums(rows,iVol,false):[];const aprov=cM28.length?rows.reduce((acc,r)=>{const f=fckFrom(r,headers);if(isNaN(f))return acc;cM28.forEach(ci=>{const v=num(r[ci]);if(!isNaN(v)&&v>0&&v>=f)acc++;});return acc;},0):0;const pend=cM28.length?rows.filter(r=>cM28.every(ci=>{const v=num(r[ci]);return isNaN(v)||v===0;})).length:0;body.innerHTML=`<div class="dash-grid-cards"><div class="dash-card"><b>${rows.length}</b><span>Registros</span></div><div class="dash-card"><b>${fmt(vol.reduce((s,v)=>s+v,0))}</b><span>Volume M³</span></div><div class="dash-card"><b>${aprov}</b><span>CPs aprovados</span></div><div class="dash-card"><b>${pend}</b><span>Pendentes 28d</span></div></div>`;body.innerHTML+=`<div class="dash-section"><h3>Produção e Crescimento <span class="dash-toggle"><button class="dash-tgl ${prodModo==='mes'?'on':''}" data-modo="mes">Mensal</button><button class="dash-tgl ${prodModo==='ano'?'on':''}" data-modo="ano">Anual</button></span></h3><div id="dash-prod-cards" class="dash-grid-cards dash-cards-mini"></div><div class="dash-scroll"><canvas id="dash-chart-prod" style="width:100%;height:300px"></canvas></div></div><div class="dash-section"><h3>Mapa de calor — volume por dia (m³)</h3><div class="dash-scroll" id="dash-heatmap"></div></div><div class="dash-section"><h3>Volume por cliente (m³)</h3><div class="dash-scroll"><canvas id="dash-vol-cli" style="width:100%;height:320px"></canvas></div></div><div class="dash-section"><h3>Volume por produto (m³)</h3><div class="dash-scroll"><canvas id="dash-vol-prod" style="width:100%;height:320px"></canvas></div></div><div class="dash-section"><h3>Distribuição da resistência aos 28 dias</h3><div id="dist-numeros" class="dist-numeros"></div><div class="dash-scroll"><canvas id="dash-chart-dist" style="width:100%;height:300px"></canvas></div><div id="dist-legenda" class="dist-legenda"></div></div>`;/* gráfico "Análise por receita/produto" e seus dropdowns removidos a pedido do Naor */montarDistribuicao(m28,rows,headers);const iData=idx(headers,['DATA','Data']);if(iData>=0&&iVol>=0){const pp=producaoPorPeriodo(rows,iData,iVol,prodModo);const prodC=$('dash-chart-prod');if(prodC){prodC.style.width=Math.max(720,pp.labels.length*90)+'px';drawCombo(prodC,pp.labels,pp.prod,pp.growth);}document.querySelectorAll('.dash-tgl').forEach(b=>b.onclick=()=>{prodModo=b.dataset.modo;render();});const ppA=producaoPorPeriodo(rows,iData,iVol,'ano');const prodTot=ppA.prod.reduce((s,v)=>s+v,0),nAnos=ppA.labels.length||1,gA=ppA.growth.filter(v=>v!=null&&isFinite(v)),crescMed=gA.length?mean(gA):NaN,crescTot=(ppA.prod.length>1&&ppA.prod[0]>0)?((ppA.prod[ppA.prod.length-1]-ppA.prod[0])/ppA.prod[0]*100):NaN;const pc=$('dash-prod-cards');if(pc)pc.innerHTML=`<div class="dash-card"><b>${fmt(prodTot,0)}</b><span>Produção total (m³)</span></div><div class="dash-card"><b>${fmt(prodTot/nAnos,0)}</b><span>Produção média/ano</span></div><div class="dash-card"><b>${isNaN(crescTot)?'—':fmt(crescTot,1)+'%'}</b><span>Crescimento total</span></div><div class="dash-card"><b>${isNaN(crescMed)?'—':fmt(crescMed,1)+'%'}</b><span>Crescimento médio/ano</span></div>`;drawHeatmap($('dash-heatmap'),volumePorDia(rows,iData,iVol));const iCli=idx(headers,['CLIENTE']),iProd=idx(headers,['PRODUTO']);if(iCli>=0){const g=limitarGrupos(volumePorGrupo(rows,iCli,iVol));const vc=g.pares;const c=$('dash-vol-cli');if(c){c.style.width=Math.max(720,vc.length*54)+'px';drawCanvas(c,vc.map(x=>x[0]),vc.map(x=>x[1]),'bar',vc.map((x,i)=>`${fmt(x[1],0)} m³`+(g.agrupados&&i===vc.length-1?` · ${g.agrupados} clientes somados`:'')));}}if(iProd>=0){const g=limitarGrupos(volumePorGrupo(rows,iProd,iVol));const vp=g.pares;const c=$('dash-vol-prod');if(c){c.style.width=Math.max(720,vp.length*54)+'px';drawCanvas(c,vp.map(x=>x[0]),vp.map(x=>x[1]),'bar',vp.map((x,i)=>`${fmt(x[1],0)} m³`+(g.agrupados&&i===vp.length-1?` · ${g.agrupados} produtos somados`:'')));}}}const inf=$('dash-info');if(inf)inf.textContent=`${d.activeSheet||''} · ${rows.length} registros`;}
function init(){['dash-refresh','dash-reset'].forEach(id=>{const el=$(id);if(el)el.addEventListener('click',render)});['dash-group','dash-metric'].forEach(id=>{const el=$(id);if(el)el.addEventListener('change',render)});window.addEventListener('concrestats:datachanged',()=>setTimeout(render,50));}
// Estatistica de laboratorio reutilizada pelo Painel.
//
// O Naor quer que o PAINEL substitua ANALISE e DASHBOARD. A Analise ja exporta
// o desenho dela em window.ConcreViz; faltava esta parte, que e' a unica que
// sabe o que e' fck, corpo de prova e desvio padrao. Sem ela o Painel monta
// grafico de barra bonito e perde justamente o numero que o laboratorio olha.
window.ConcreLab = {
  drawDistribuicao: drawDistribuicao,
  faixas: faixas,
  larguraDeFaixa: larguraDeFaixa,
  desvioPadrao: desvioPadrao,
  fckPredominante: fckPredominante,
  fckFrom: fckFrom,
  colsFor: colsFor,
  poolNums: poolNums,
  baseName: baseName,
  idx: idx,
  nums: nums,
  mean: mean,
  median: median,
  drawHeatmap: drawHeatmap,
  volumePorDia: volumePorDia,
  volumePorGrupo: volumePorGrupo,
  producaoPorPeriodo: producaoPorPeriodo,
  limitarGrupos: limitarGrupos,
  separarImpossiveis: separarImpossiveis,
};

window.DashboardModule={onModuleEnter:render};document.addEventListener('DOMContentLoaded',init);
})();
