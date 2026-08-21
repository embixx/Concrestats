"""
Concrestats — backend Flask (reconstruído).

Este arquivo foi RECONSTRUÍDO a partir do contrato observado do build original
(endpoints chamados pelo frontend + formato exato das respostas de /api/upload e
/api/export_report_custom verificados ao vivo). Comportamentos não observáveis
diretamente (save_file, import_merge, persistência de receitas) foram
implementados de forma sensata e estão marcados com  # [reconstruído] — confira
contra o comportamento esperado ao testar.

Compatível com PyInstaller (onedir): templates/ e static/ são localizados via
sys._MEIPASS; uploads/ e exports/ ficam ao lado do executável.

Requisitos: ver requirements.txt  (Flask 3.0.3, pandas, openpyxl, numpy).
Build:      ver Concrestats.spec / build.bat
"""

import os
import sys
import io
import json
import datetime
import threading
import time
import webbrowser

import numpy as np
import pandas as pd
from flask import (
    Flask, request, jsonify, send_file, Response
)

# ──────────────────────────────────────────────────────────────────────────
# Localização de recursos (compatível com PyInstaller)
# ──────────────────────────────────────────────────────────────────────────
def resource_path(rel):
    """templates/ e static/ — embutidos no bundle (sys._MEIPASS quando frozen)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def app_dir():
    """Pasta GRAVÁVEL ao lado do executável (uploads/exports/receitas.json)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


UPLOADS_DIR = os.path.join(app_dir(), "uploads")
EXPORTS_DIR = os.path.join(app_dir(), "exports")
RECEITAS_FILE = os.path.join(app_dir(), "receitas.json")
PREFS_FILE = os.path.join(app_dir(), "prefs.json")
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(EXPORTS_DIR, exist_ok=True)

app = Flask(
    __name__,
    template_folder=resource_path("templates"),
    static_folder=resource_path("static"),
)
# Limite de upload (evita travar o app com um arquivo gigante). Planilhas
# reais têm poucos MB; 200 MB é folga de sobra.
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

# ──────────────────────────────────────────────────────────────────────────
# Estado de sessão (em memória, por session_id)
#   SESSIONS[sid] = {
#       "sheets": { nome: {"headers": [...], "data": [[...]]} },
#       "active": nome,
#       "path":   caminho do arquivo original (para "Salvar"),
#   }
# ──────────────────────────────────────────────────────────────────────────
SESSIONS = {}

# ──────────────────────────────────────────────────────────────────────────
# MODO DE EXECUÇÃO
#   True  = servido na web (gunicorn/host) → recursos que tocam o disco do
#           servidor ficam BLOQUEADOS (ler caminho arbitrário, salvar no
#           arquivo de origem, recarregar). Sem isso, um usuário remoto
#           conseguiria ler/escrever arquivos da máquina que hospeda.
#   False = app de mesa (definido em __main__), tudo liberado.
# ──────────────────────────────────────────────────────────────────────────
MODO_WEB = os.environ.get("CONCRESTATS_WEB", "1") != "0"


def _bloqueado_na_web():
    return jsonify({
        "success": False,
        "error": ("recurso disponível apenas no aplicativo instalado — "
                  "na versão web use Abrir/Adicionar para enviar o arquivo "
                  "e Exportar para baixar o resultado")
    }), 403


@app.route("/api/ambiente")
def api_ambiente():
    """O frontend usa isto para esconder botões que só existem no app de mesa."""
    return jsonify({"web": MODO_WEB, "versao": "2.0"})


def _usuario():
    """Identifica o usuário pelo cookie (a web separa as preferências de cada
    um; no app de mesa existe um só e o valor cai em 'default')."""
    u = (request.cookies.get("concre_uid") or "default").strip()
    return "".join(ch for ch in u if ch.isalnum() or ch in "-_")[:40] or "default"


def _session(sid):
    return SESSIONS.setdefault(sid, {"sheets": {}, "active": None, "path": None,
                                 "demo": []})


# ──────────────────────────────────────────────────────────────────────────
# Conversão célula → string (replica o formato observado no build original)
#   - datas  → "YYYY-MM-DD"
#   - NaN / None / NaT → ""
#   - float inteiro (8.0) → "8"   |  float real (0.5) → "0.5"
#   - resto → str(v)
# ──────────────────────────────────────────────────────────────────────────
def _cell(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, np.datetime64):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return str(int(f)) if f.is_integer() else str(f)
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    return str(v)


def df_to_payload(df):
    """DataFrame → {"headers": [...], "data": [[str, ...], ...]} (igual ao build)."""
    df = df.copy()
    headers = [str(c) for c in df.columns]
    # Datas → ISO antes de extrair (evita numpy.datetime64 solto)
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime("%Y-%m-%d")
    records = df.where(pd.notna(df), None).values.tolist()
    data = [[_cell(v) for v in row] for row in records]
    return {"headers": headers, "data": data}


def payload_to_df(headers, data):
    """{headers, data} → DataFrame (tudo string; usado para exportar/salvar)."""
    return pd.DataFrame(data, columns=headers, dtype=object)


# ──────────────────────────────────────────────────────────────────────────
# Leitura de arquivos (xlsx/xls/csv)
# ──────────────────────────────────────────────────────────────────────────
def read_any(path_or_buffer, filename):
    """Retorna OrderedDict {nome_planilha: DataFrame}. Mantém o dedup de
    cabeçalhos do pandas ("Data 28", "Data 28.1") — igual ao build original."""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                df = pd.read_csv(path_or_buffer, sep=None, engine="python", encoding=enc)
                return {"Plan1": df}
            except Exception:  # noqa: BLE001 -- tenta a próxima codificação
                if hasattr(path_or_buffer, "seek"):
                    path_or_buffer.seek(0)
                continue
        # último recurso
        if hasattr(path_or_buffer, "seek"):
            path_or_buffer.seek(0)
        return {"Plan1": pd.read_csv(path_or_buffer, engine="python")}
    # Excel: todas as planilhas
    sheets = pd.read_excel(path_or_buffer, sheet_name=None)
    return sheets


def load_into_session(sid, sheets, path=None, mode="replace"):
    """mode='replace' troca a sessão; mode='add' ANEXA as abas do arquivo às
    existentes (permite cruzar planilhas de arquivos diferentes)."""
    sess = _session(sid)
    novos = {name: df_to_payload(df) for name, df in sheets.items()}
    if mode == "add" and sess["sheets"]:
        primeiro = None
        for name, payload in novos.items():
            final, k = name, 2
            while final in sess["sheets"]:
                final = f"{name} ({k})"; k += 1
            sess["sheets"][final] = payload
            if primeiro is None:
                primeiro = final
        sess["active"] = primeiro or sess["active"]
        # 'path' continua apontando para o arquivo base (Salvar não muda de alvo)
    else:
        sess["sheets"] = novos
        sess["active"] = next(iter(sess["sheets"]), None)
        if path:
            sess["path"] = path
    return sess


def sheet_response(sess, extra=None):
    name = sess["active"]
    payload = sess["sheets"].get(name, {"headers": [], "data": []})
    out = {
        "success": True,
        "active_sheet": name,
        "sheet_name": name,
        "sheets": list(sess["sheets"].keys()),
        "data": payload,
    }
    if extra:
        out.update(extra)
    return jsonify(out)


# ──────────────────────────────────────────────────────────────────────────
# Rotas
# ──────────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    # Serve o HTML diretamente (sem Jinja) para não interpretar chaves no markup.
    return send_file(resource_path(os.path.join("templates", "index.html")),
                     mimetype="text/html")


@app.route("/api/upload", methods=["POST"])
def api_upload():
    sid = request.form.get("session_id", "default")
    f = request.files.get("file")
    if not f:
        return jsonify({"success": False, "error": "nenhum arquivo enviado"}), 400
    try:
        # Salva uma cópia em uploads/ (permite "Salvar no arquivo original")
        safe = os.path.basename(f.filename)
        path = os.path.join(UPLOADS_DIR, safe)
        f.save(path)
        sheets = read_any(path, safe)
        mode = request.form.get("mode", "replace")
        sess = load_into_session(sid, sheets, path=path, mode=mode)
        return sheet_response(sess)
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/load_path", methods=["POST"])
def api_load_path():
    if MODO_WEB:
        return _bloqueado_na_web()
    # App nativo: abre o arquivo DIRETO do caminho real (via diálogo do Windows).
    # Assim o "Salvar" grava no próprio arquivo original, não numa cópia.
    body = request.get_json(force=True, silent=True) or {}
    sid = body.get("session_id", "default")
    path = body.get("path") or ""
    if not path or not os.path.isfile(path):
        return jsonify({"success": False, "error": "arquivo não encontrado"}), 400
    try:
        sheets = read_any(path, os.path.basename(path))
        sess = load_into_session(sid, sheets, path=path,
                                 mode=body.get("mode", "replace"))
        return sheet_response(sess, extra={"path": path})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/import_merge", methods=["POST"])
def api_import_merge():
    # [reconstruído] anexa as linhas do arquivo ao sheet alvo (mode=append).
    sid = request.form.get("session_id", "default")
    target = request.form.get("target_sheet")
    f = request.files.get("file")
    sess = _session(sid)
    if not f or target not in sess["sheets"]:
        return jsonify({"success": False, "error": "planilha alvo inválida"}), 400
    try:
        sheets = read_any(f.stream, f.filename)
        incoming = next(iter(sheets.values()))
        inc_payload = df_to_payload(incoming)
        cur = sess["sheets"][target]
        # Alinha colunas pelo NOME (ignorando maiúsculas/espaços). Se nenhuma
        # coluna casar, o append geraria só linhas vazias — avisa em vez disso.
        norm = lambda h: str(h).strip().upper()
        idx = {norm(h): i for i, h in enumerate(inc_payload["headers"])}
        casadas = [h for h in cur["headers"] if norm(h) in idx]
        if not casadas:
            return jsonify({
                "success": False,
                "error": ("nenhuma coluna em comum entre as planilhas — "
                          "os cabeçalhos precisam ter os mesmos nomes. "
                          "Para juntar por uma chave, use o botão Cruzar; "
                          "para abrir como outra aba, use Adicionar.")
            }), 400
        for row in inc_payload["data"]:
            new_row = []
            for h in cur["headers"]:
                j = idx.get(norm(h))
                new_row.append(row[j] if j is not None and j < len(row) else "")
            cur["data"].append(new_row)
        return jsonify({"success": True, "data": cur,
                        "colunas_casadas": len(casadas),
                        "colunas_total": len(cur["headers"]),
                        "linhas_add": len(inc_payload["data"])})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/sheets_info", methods=["POST"])
def api_sheets_info():
    # Cabeçalhos de todas as abas da sessão (p/ montar o modal de cruzamento).
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    return jsonify({
        "success": True,
        "sheets": {n: p.get("headers", []) for n, p in sess["sheets"].items()},
        "active": sess["active"],
        "path": sess.get("path"),
    })


@app.route("/api/join_sheets", methods=["POST"])
def api_join_sheets():
    # "PROCV automático": traz colunas da planilha B para a A casando pela
    # coluna-chave (merge left). Chave duplicada em B usa a 1ª ocorrência.
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    la, lb = body.get("left_sheet"), body.get("right_sheet")
    ka, kb = body.get("left_key"), body.get("right_key")
    cols = body.get("columns") or []
    destino = body.get("destino", "nova")  # 'nova' | 'atual'
    if la not in sess["sheets"] or lb not in sess["sheets"]:
        return jsonify({"success": False, "error": "planilha inválida"}), 400
    pa, pb = sess["sheets"][la], sess["sheets"][lb]
    if ka not in pa["headers"] or kb not in pb["headers"]:
        return jsonify({"success": False, "error": "coluna-chave inválida"}), 400
    cols = [c for c in cols if c in pb["headers"] and c != kb]
    if not cols:
        return jsonify({"success": False, "error": "escolha ao menos uma coluna para trazer"}), 400
    try:
        dfa = payload_to_df(pa["headers"], pa["data"])
        dfb = payload_to_df(pb["headers"], pb["data"])
        # normaliza a chave dos dois lados (trim + sem diferenciar maiúsculas)
        dfa["__k"] = dfa[ka].astype(str).str.strip().str.upper()
        dfb["__k"] = dfb[kb].astype(str).str.strip().str.upper()
        dfb = dfb.drop_duplicates("__k")[["__k"] + cols]
        # evita colisão de nomes: sufixa colunas que já existem em A
        ren = {}
        for c in cols:
            nc, k = c, 2
            while nc in dfa.columns:
                nc = f"{c} ({k})"; k += 1
            if nc != c:
                ren[c] = nc
        if ren:
            dfb = dfb.rename(columns=ren)
        out = dfa.merge(dfb, on="__k", how="left").drop(columns="__k")
        out = out.where(pd.notna(out), "")
        payload = {"headers": [str(c) for c in out.columns],
                   "data": [[str(v) for v in row] for row in out.values.tolist()]}
        matched = int((dfa["__k"].isin(dfb["__k"])).sum()) if len(dfb) else 0
        if destino == "atual":
            sess["sheets"][la] = payload
            sess["active"] = la
        else:
            name, k = f"{la} + {lb}", 2
            while name in sess["sheets"]:
                name = f"{la} + {lb} ({k})"; k += 1
            sess["sheets"][name] = payload
            sess["active"] = name
        return sheet_response(sess, extra={"matched": matched, "total": len(dfa)})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/reload", methods=["POST"])
def api_reload():
    if MODO_WEB:
        return _bloqueado_na_web()
    # "Atualizar tudo": relê o arquivo de origem do disco e recarrega a sessão.
    body = request.get_json(force=True, silent=True) or {}
    sid = body.get("session_id", "default")
    sess = _session(sid)
    path = sess.get("path")
    if not path or not os.path.isfile(path):
        return jsonify({"success": False, "error": "sem arquivo de origem para recarregar"}), 400
    try:
        ativo = sess["active"]
        sheets = read_any(path, os.path.basename(path))
        sess = load_into_session(sid, sheets, path=path)
        if ativo in sess["sheets"]:
            sess["active"] = ativo
        return sheet_response(sess, extra={"path": path})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/get_sheet", methods=["POST"])
def api_get_sheet():
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    name = body.get("sheet_name")
    if name in sess["sheets"]:
        sess["active"] = name
    return sheet_response(sess)


@app.route("/api/new_sheet", methods=["POST"])
def api_new_sheet():
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    name = (body.get("sheet_name") or "Nova Planilha").strip() or "Nova Planilha"
    base, n = name, 2
    while name in sess["sheets"]:
        name = f"{base} ({n})"
        n += 1
    sess["sheets"][name] = {"headers": ["A", "B", "C"], "data": [["", "", ""]]}
    sess["active"] = name
    # Aba criada pelo Modo Teste: nunca deve entrar no arquivo do usuario.
    if body.get("demo"):
        sess.setdefault("demo", [])
        if name not in sess["demo"]:
            sess["demo"].append(name)
    return sheet_response(sess)


@app.route("/api/delete_sheet", methods=["POST"])
def api_delete_sheet():
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    name = body.get("sheet_name")
    if name in sess["sheets"] and len(sess["sheets"]) > 1:
        sess["sheets"].pop(name, None)
        if sess["active"] == name:
            sess["active"] = next(iter(sess["sheets"]), None)
    return jsonify({
        "success": True,
        "sheets": list(sess["sheets"].keys()),
        "active_sheet": sess["active"],
    })


@app.route("/api/save_data", methods=["POST"])
def api_save_data():
    # Atualiza o sheet em memória (auto-save do grid).
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    name = body.get("sheet_name")
    if name:
        sess["sheets"][name] = {
            "headers": body.get("headers", []),
            "data": body.get("data", []),
        }
        sess["active"] = name
    return jsonify({"success": True})


def _excel_sheet_name(name):
    """Nome de aba aceito pelo Excel: sem []:*?/\\ , ≤31 chars, não vazio.
    (openpyxl levanta erro com caracteres inválidos — era fonte de export falho.)"""
    s = "".join(c for c in str(name) if c not in "[]:*?/\\").strip()
    return (s[:31] or "Plan1")


def _safe_sheet_name(name, used):
    """Nome de aba válido p/ Excel e único no arquivo."""
    base = _excel_sheet_name(name)
    out, k = base, 1
    while out in used:
        suf = f"_{k}"
        out = base[: 31 - len(suf)] + suf
        k += 1
    used.add(out)
    return out


@app.route("/api/save_file", methods=["POST"])
def api_save_file():
    if MODO_WEB:
        return _bloqueado_na_web()
    # Grava a sessão de volta no arquivo de origem (ou num caminho novo vindo
    # do "Salvar como" nativo). Excel: escreve TODAS as planilhas.
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    new_path = (body.get("path") or "").strip()
    if new_path:
        if not os.path.splitext(new_path)[1]:
            new_path += ".xlsx"
        sess["path"] = new_path
    path = sess.get("path")
    if not path or not sess["sheets"]:
        return jsonify({"success": False, "error": "sem arquivo de origem"}), 400
    try:
        if path.lower().endswith(".csv"):
            # CSV só comporta uma planilha: grava a ativa.
            name = body.get("sheet_name") or sess["active"]
            payload = sess["sheets"].get(name)
            if not payload:
                return jsonify({"success": False, "error": "planilha inválida"}), 400
            payload_to_df(payload["headers"], payload["data"]).to_csv(
                path, index=False, encoding="utf-8-sig")
        else:
            used = set()
            # As abas de demonstracao do Modo Teste ficam de fora: elas existem
            # so' para o teste e nao podem contaminar a planilha de trabalho.
            demo = set(sess.get("demo") or [])
            reais = {n: p for n, p in sess["sheets"].items() if n not in demo}
            if not reais:
                return jsonify({"success": False,
                                "error": "so' ha planilha de demonstracao aberta"}), 400
            with pd.ExcelWriter(path, engine="openpyxl") as w:
                for sheet_name, payload in reais.items():
                    df = payload_to_df(payload["headers"], payload["data"])
                    df.to_excel(w, sheet_name=_safe_sheet_name(sheet_name, used),
                                index=False)
        return jsonify({"success": True, "path": path})
    except PermissionError:
        return jsonify({"success": False,
                        "error": "arquivo em uso — feche-o no Excel e salve de novo"}), 500
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


def _send_dataframe(df, fmt, base_name):
    """Gera CSV / XLSX / HTML a partir de um DataFrame e devolve como download."""
    if fmt == "csv":
        buf = io.BytesIO(df.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig"))
        return send_file(buf, mimetype="text/csv", as_attachment=True,
                         download_name=f"{base_name}.csv")
    if fmt in ("html", "report"):
        html = (
            "<html><head><meta charset='utf-8'><style>"
            "table{border-collapse:collapse;font-family:Arial;font-size:12px}"
            "th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}"
            "th{background:#1d1c18;color:#fff}</style></head><body>"
            f"<h2>{base_name}</h2>"
            + df.to_html(index=False, border=0)
            + "</body></html>"
        )
        buf = io.BytesIO(html.encode("utf-8"))
        return send_file(buf, mimetype="text/html", as_attachment=True,
                         download_name=f"{base_name}.html")
    # xlsx (default)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name=_excel_sheet_name(base_name))
    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"{base_name}.xlsx",
    )


@app.route("/api/export", methods=["POST"])
def api_export():
    body = request.get_json(force=True, silent=True) or {}
    sess = _session(body.get("session_id", "default"))
    name = body.get("sheet_name") or sess["active"]
    fmt = (body.get("format") or "xlsx").lower()
    payload = sess["sheets"].get(name, {"headers": [], "data": []})
    rows = body.get("filtered_data") or payload["data"]
    df = payload_to_df(payload["headers"], rows)
    return _send_dataframe(df, fmt, str(name or "planilha"))


@app.route("/api/export_report_custom", methods=["POST"])
def api_export_report_custom():
    body = request.get_json(force=True, silent=True) or {}
    fmt = (body.get("format") or "xlsx").lower()
    columns = body.get("columns") or []
    data = body.get("data") or []
    title = body.get("title") or "relatorio"
    # Reordena/seleciona as colunas pedidas (data pode trazer linhas completas).
    df_full = payload_to_df(columns, data) if data and len(data[0]) == len(columns) \
        else pd.DataFrame(data)
    if list(df_full.columns) != columns and columns:
        try:
            df_full.columns = columns[: len(df_full.columns)]
        except Exception:  # noqa: BLE001
            pass
    base = f"relatorio_{title}"
    return _send_dataframe(df_full, fmt, base)


@app.route("/api/export_aoa", methods=["POST"])
def api_export_aoa():
    """Gera .xlsx REAL no servidor a partir de uma matriz (lista de listas).

    Existe porque o download via JS (SheetJS) falhava em algumas máquinas —
    aqui o arquivo é escrito com openpyxl, que já vem no executável. Se vier
    'path', grava direto no disco (diálogo nativo); senão devolve o arquivo.
    """
    body = request.get_json(force=True, silent=True) or {}
    aoa = body.get("aoa") or []
    if not isinstance(aoa, list) or not aoa:
        return jsonify({"success": False, "error": "sem dados"}), 400
    nome = _excel_sheet_name(body.get("sheet_name") or "Planilha")
    path = (body.get("path") or "").strip()
    try:
        ncol = max(len(r) for r in aoa)
        linhas = [list(r) + [""] * (ncol - len(r)) for r in aoa]
        df = pd.DataFrame(linhas[1:], columns=[str(c) for c in linhas[0]]) \
            if len(linhas) > 1 else pd.DataFrame(columns=[str(c) for c in linhas[0]])
        if path:
            if not os.path.splitext(path)[1]:
                path += ".xlsx"
            with pd.ExcelWriter(path, engine="openpyxl") as w:
                df.to_excel(w, sheet_name=nome, index=False)
            return jsonify({"success": True, "path": path})
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as w:
            df.to_excel(w, sheet_name=nome, index=False)
        buf.seek(0)
        return send_file(
            buf,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"{body.get('base_name') or 'planilha'}.xlsx",
        )
    except PermissionError:
        return jsonify({"success": False,
                        "error": "arquivo em uso — feche-o no Excel e tente de novo"}), 500
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/salvar_binario", methods=["POST"])
def api_salvar_binario():
    """Grava um arquivo binario (ex.: PNG) no caminho escolhido pelo usuario.
    Existe porque no app nativo o download do navegador nao pergunta onde
    salvar — o arquivo 'sumia'."""
    if MODO_WEB:
        return _bloqueado_na_web()
    import base64
    body = request.get_json(force=True, silent=True) or {}
    path = (body.get("path") or "").strip()
    dados = body.get("base64") or ""
    if not path or not dados:
        return jsonify({"success": False, "error": "caminho ou conteudo ausente"}), 400
    try:
        if "," in dados[:64]:            # remove prefixo data:image/png;base64,
            dados = dados.split(",", 1)[1]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(dados))
        return jsonify({"success": True, "path": path})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/prefs", methods=["GET", "POST"])
def api_prefs():
    # Preferências persistentes (templates/layouts de gráficos, campos fixos do
    # certificado...) num JSON ao lado do executável — sobrevivem a reinstalar,
    # trocar de máquina ou limpar o cache do WebView2.
    u = _usuario()
    if request.method == "GET":
        try:
            with open(PREFS_FILE, "r", encoding="utf-8") as fh:
                todos = json.load(fh) or {}
        except Exception:  # noqa: BLE001
            return jsonify({})
        # Formato antigo (um usuário só) continua funcionando no app de mesa.
        if u == "default" and not isinstance(todos.get(u), dict):
            return jsonify({k: v for k, v in todos.items() if not isinstance(v, dict) or k != "__users__"})
        return jsonify((todos.get("__users__", {}) or {}).get(u, {}))
    body = request.get_json(force=True, silent=True)
    if not isinstance(body, dict):
        return jsonify({"success": False, "error": "esperado objeto JSON"}), 400
    try:
        # Mescla com o que já existe (cada módulo grava só as suas chaves).
        cur = {}
        if os.path.exists(PREFS_FILE):
            try:
                with open(PREFS_FILE, "r", encoding="utf-8") as fh:
                    cur = json.load(fh) or {}
            except Exception:  # noqa: BLE001
                cur = {}
        if u == "default":
            cur.update(body)            # app de mesa: como sempre foi
        else:
            users = cur.setdefault("__users__", {})
            users.setdefault(u, {}).update(body)
        with open(PREFS_FILE, "w", encoding="utf-8") as fh:
            json.dump(cur, fh, ensure_ascii=False, indent=2)
        return jsonify({"success": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/receitas", methods=["GET", "POST"])
def api_receitas():
    # [reconstruído] persiste as receitas num JSON ao lado do executável.
    if request.method == "GET":
        if os.path.exists(RECEITAS_FILE):
            try:
                with open(RECEITAS_FILE, "r", encoding="utf-8") as fh:
                    return jsonify(json.load(fh))
            except Exception:  # noqa: BLE001
                return jsonify([])
        return jsonify([])
    body = request.get_json(force=True, silent=True)
    try:
        with open(RECEITAS_FILE, "w", encoding="utf-8") as fh:
            json.dump(body if body is not None else [], fh, ensure_ascii=False, indent=2)
        return jsonify({"success": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────────────
# Inicialização
# ──────────────────────────────────────────────────────────────────────────
def open_browser():
    try:
        webbrowser.open("http://127.0.0.1:5000")
    except Exception:  # noqa: BLE001
        pass


def _run_server():
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    # Executado como app de mesa: libera os recursos locais (abrir por caminho,
    # salvar no arquivo de origem, recarregar). Servido por gunicorn/host, o
    # módulo é só importado e MODO_WEB continua True.
    MODO_WEB = False
    # Flask sobe numa thread em segundo plano.
    threading.Thread(target=_run_server, daemon=True).start()
    # App NATIVO do Windows: abre numa JANELA PRÓPRIA (WebView2), como Spotify —
    # nada de navegador. Se o pywebview não estiver presente, cai pro navegador.
    try:
        import webview  # pywebview
        time.sleep(1.0)  # garante o servidor no ar antes de criar a janela

        class JsApi:
            """Diálogos NATIVOS do Windows (window.pywebview.api.* no frontend).
            Entregam o caminho REAL do arquivo — o Salvar grava no próprio .xlsx."""

            _FT = ("Planilhas (*.xlsx;*.xls;*.csv)", "Todos os arquivos (*.*)")

            def _win(self):
                return webview.windows[0] if webview.windows else None

            def open_file_dialog(self):
                w = self._win()
                if not w:
                    return None
                mode = getattr(webview, "OPEN_DIALOG", None)
                if mode is None:
                    mode = webview.FileDialog.OPEN
                res = w.create_file_dialog(mode, allow_multiple=False,
                                           file_types=self._FT)
                if not res:
                    return None
                return res[0] if isinstance(res, (list, tuple)) else res

            def save_file_dialog(self, default_name="planilha.xlsx"):
                w = self._win()
                if not w:
                    return None
                mode = getattr(webview, "SAVE_DIALOG", None)
                if mode is None:
                    mode = webview.FileDialog.SAVE
                res = w.create_file_dialog(mode, save_filename=str(default_name),
                                           file_types=self._FT)
                if not res:
                    return None
                return res[0] if isinstance(res, (list, tuple)) else res

        webview.create_window(
            "Concrestats", "http://127.0.0.1:5000",
            width=1280, height=820, min_size=(900, 600),
            js_api=JsApi(),
        )
        # private_mode=False + storage_path: o WebView2 usa um perfil PERSISTENTE
        # ao lado do exe (por padrão o pywebview é "anônimo" e o localStorage —
        # templates, layouts, campos fixos — sumia ao fechar o app).
        webview.start(
            private_mode=False,
            storage_path=os.path.join(app_dir(), "webview_data"),
        )  # bloqueia até fechar a janela
    except Exception:  # noqa: BLE001 -- fallback: navegador
        threading.Timer(1.0, open_browser).start()
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
