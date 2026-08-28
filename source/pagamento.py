"""pagamento.py — cobrança por PIX, sem gateway e sem servidor.

POR QUE PIX E NAO STRIPE/MERCADO PAGO: um gateway cobra taxa por transacao,
exige conta de empresa, chave de API guardada em algum lugar e um servidor
ouvindo webhook. Para vender um programa para um laboratorio de concreto, uma
ou duas vezes por ano, isso e' infraestrutura demais para o problema.

O PIX resolve com o que ja' existe: o proprio banco. O programa monta o codigo
de cobranca (o "Copia e Cola"), mostra o QR, e o cliente paga do aplicativo do
banco dele. O dinheiro cai direto na conta, sem intermediario e sem taxa.

O QUE ESTE ARQUIVO FAZ E O QUE NAO FAZ:
  FAZ    monta o codigo de cobranca no formato oficial do Banco Central
         (EMV / BR Code, com o CRC16 no fim), desenha o QR e mostra na tela.
  NAO FAZ  nao confere se o pagamento caiu. Isso exigiria API do banco.
         O fluxo e': cliente paga -> manda o comprovante -> voce emite a
         licenca com tools/emitir_licenca.py.

Para conferencia automatica seria preciso PIX cobranca via API do banco
(Itau/Sicredi/Banco do Brasil tem), com certificado mTLS. Vale a pena quando
houver volume; para uma venda por ano, nao vale.

CONFIGURAR: preencha DADOS_DO_RECEBEDOR abaixo com a sua chave PIX. Enquanto
estiver vazio, a tela de pagamento nao aparece (nao inventa chave de ninguem).
"""

import json
import os
import unicodedata

# ── quem recebe ─────────────────────────────────────────────────────────────
# A chave PIX e' publica por natureza: e' o que voce passa para receber. Ainda
# assim fica em arquivo separado, para nao ir junto quando voce manda o codigo.
ARQUIVO_RECEBEDOR = "recebedor.json"

PADRAO = {
    "chave": "",              # CPF, CNPJ, e-mail, telefone (+55...) ou aleatoria
    "nome": "",               # ate' 25 caracteres, sem acento
    "cidade": "",             # ate' 15 caracteres, sem acento
    "planos": [
        {"id": "mensal", "titulo": "Mensal",  "valor": 0.0, "meses": 1},
        {"id": "anual",  "titulo": "Anual",   "valor": 0.0, "meses": 12},
    ],
}


def _pasta_dos_dados():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Concrestats")


def recebedor():
    """Le' os dados de quem recebe. Devolve o padrao (vazio) se nao houver."""
    for pasta in (_pasta_dos_dados(), os.path.dirname(os.path.abspath(__file__))):
        caminho = os.path.join(pasta, ARQUIVO_RECEBEDOR)
        if os.path.exists(caminho):
            try:
                with open(caminho, encoding="utf-8") as fh:
                    d = dict(PADRAO)
                    d.update(json.load(fh))
                    return d
            except (OSError, ValueError):
                continue
    return dict(PADRAO)


def configurado(dados=None):
    d = dados if dados is not None else recebedor()
    return bool(d.get("chave") and d.get("nome") and d.get("cidade"))


# ── o codigo de cobranca ────────────────────────────────────────────────────
def _limpar(texto, tamanho):
    """O BR Code so' aceita ASCII imprimivel. 'Sao Paulo' vira 'Sao Paulo'."""
    sem_acento = unicodedata.normalize("NFKD", str(texto))
    sem_acento = sem_acento.encode("ascii", "ignore").decode("ascii")
    limpo = "".join(c for c in sem_acento if 32 <= ord(c) < 127)
    return limpo.upper()[:tamanho].strip()


def _campo(numero, valor):
    """Formato do EMV: id (2) + tamanho (2) + conteudo."""
    return "%s%02d%s" % (numero, len(valor), valor)


def _crc16(carga):
    """CRC-16/CCITT-FALSE, exigido no fim do BR Code."""
    crc = 0xFFFF
    for byte in carga.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return "%04X" % crc


def codigo_pix(chave, nome, cidade, valor=None, identificador="***"):
    """Monta o 'Copia e Cola' do PIX no formato do Banco Central.

    valor=None gera cobranca sem valor definido (o cliente digita quanto pagar).
    """
    conta = _campo("00", "br.gov.bcb.pix") + _campo("01", str(chave).strip())

    partes = [
        _campo("00", "01"),                    # versao do formato
        _campo("26", conta),                   # a chave PIX
        _campo("52", "0000"),                  # ramo de atividade: nao informado
        _campo("53", "986"),                   # moeda: real
    ]
    if valor is not None:
        partes.append(_campo("54", "%.2f" % float(valor)))
    partes += [
        _campo("58", "BR"),                    # pais
        _campo("59", _limpar(nome, 25)),       # quem recebe
        _campo("60", _limpar(cidade, 15)),     # cidade de quem recebe
        _campo("62", _campo("05", _limpar(identificador, 25) or "***")),
    ]
    carga = "".join(partes) + "6304"           # 63 04 = campo do CRC
    return carga + _crc16(carga)


def qr_svg(codigo, lado=210):
    """Desenha o QR como SVG. Sem arquivo temporario, sem PIL."""
    import qrcode
    import qrcode.image.svg as svg

    imagem = qrcode.make(codigo, image_factory=svg.SvgPathImage,
                         box_size=10, border=2)
    bruto = imagem.to_string(encoding="unicode")
    # o gerador nao define largura util; fixamos para caber no modal
    return bruto.replace("<svg ", '<svg width="%d" height="%d" ' % (lado, lado), 1)


def cobranca(plano_id=None):
    """Junta tudo: dados do recebedor + plano escolhido -> codigo e QR."""
    dados = recebedor()
    if not configurado(dados):
        return {"configurado": False}

    planos = dados.get("planos") or PADRAO["planos"]
    plano = next((p for p in planos if p.get("id") == plano_id), planos[0])
    valor = float(plano.get("valor") or 0) or None

    codigo = codigo_pix(dados["chave"], dados["nome"], dados["cidade"], valor)
    return {
        "configurado": True,
        "plano": plano,
        "planos": planos,
        "recebedor": dados["nome"],
        "codigo": codigo,
        "qr": qr_svg(codigo),
    }
