"""assinatura.py — Ed25519 em Python puro (RFC 8032).

Por que existe: a licença precisa ser IMPOSSÍVEL de forjar por quem tem o
executável. Com senha compartilhada (HMAC) o segredo viaja dentro do .exe e
quem souber procurar fabrica licença. Com assinatura, o app carrega só a chave
PÚBLICA — ela confere assinaturas, mas não cria nenhuma. A chave privada fica
apenas na máquina de quem emite.

Não há biblioteca de criptografia neste ambiente, e instalar uma acrescentaria
uns 10 MB ao executável para uma verificação que roda uma vez por abertura.
Então está aqui, em ~80 linhas, usando só hashlib.

A correção NÃO é suposta: tests/test_assinatura.py roda os vetores oficiais da
RFC 8032. Se algum dia isso quebrar, o teste acusa.
"""

import hashlib

# Curva de Edwards usada pelo Ed25519
_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _sha512(dados):
    return hashlib.sha512(dados).digest()


def _inverso(x):
    return pow(x, _P - 2, _P)


def _recupera_x(y, sinal):
    """Reconstrói a coordenada x a partir de y (o ponto é comprimido em 32 bytes)."""
    xx = (y * y - 1) * _inverso(_D * y * y + 1)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P != 0:
        x = (x * _I) % _P
    if (x * x - xx) % _P != 0:
        return None                      # ponto inválido
    if x % 2 != sinal:
        x = _P - x
    return x


def _soma(p, q):
    """Soma de pontos em coordenadas estendidas (x, y, z, t)."""
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % _P
    b = (y1 + x1) * (y2 + x2) % _P
    c = t1 * 2 * _D * t2 % _P
    dd = z1 * 2 * z2 % _P
    e, f, g, h = b - a, dd - c, dd + c, b + a
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _multiplica(p, n):
    q = (0, 1, 1, 0)                     # elemento neutro
    while n > 0:
        if n & 1:
            q = _soma(q, p)
        p = _soma(p, p)
        n >>= 1
    return q


_By = 4 * _inverso(5) % _P
_Bx = _recupera_x(_By, 0)
_B = (_Bx % _P, _By % _P, 1, _Bx * _By % _P)


def _comprime(p):
    x, y, z, _ = p
    zi = _inverso(z)
    x, y = x * zi % _P, y * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _descomprime(s):
    y = int.from_bytes(s, "little") & ~(1 << 255)
    sinal = (int.from_bytes(s, "little") >> 255) & 1
    x = _recupera_x(y, sinal)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


def _mesmo_ponto(p, q):
    x1, y1, z1, _ = p
    x2, y2, z2, _ = q
    return (x1 * z2 - x2 * z1) % _P == 0 and (y1 * z2 - y2 * z1) % _P == 0


def chave_publica(semente):
    """Semente de 32 bytes → chave pública de 32 bytes."""
    return _comprime(_multiplica(_B, _escalar(semente)))


def _escalar(semente):
    """Primeira metade do hash da semente, com os bits podados como manda a RFC."""
    a = int.from_bytes(_sha512(semente)[:32], "little")
    a &= (1 << 254) - 8      # zera os 3 bits baixos
    a |= 1 << 254            # fixa o bit alto
    return a


def assinar(mensagem, semente):
    """Assina com a chave privada. Só quem emite licença usa isto."""
    h = _sha512(semente)
    a = _escalar(semente)
    pub = _comprime(_multiplica(_B, a))
    r = int.from_bytes(_sha512(h[32:] + mensagem), "little") % _L
    R = _comprime(_multiplica(_B, r))
    k = int.from_bytes(_sha512(R + pub + mensagem), "little") % _L
    S = (r + k * a) % _L
    return R + int.to_bytes(S, 32, "little")


def conferir(mensagem, assinatura, publica):
    """True só se a assinatura foi feita pela chave privada correspondente."""
    try:
        if len(assinatura) != 64 or len(publica) != 32:
            return False
        R = _descomprime(assinatura[:32])
        A = _descomprime(publica)
        if R is None or A is None:
            return False
        S = int.from_bytes(assinatura[32:], "little")
        if S >= _L:
            return False                 # assinatura maleável: recusa
        k = int.from_bytes(_sha512(assinatura[:32] + publica + mensagem), "little") % _L
        return _mesmo_ponto(_multiplica(_B, S), _soma(R, _multiplica(A, k)))
    except Exception:                    # noqa: BLE001 -- entrada podre é só assinatura inválida
        return False
