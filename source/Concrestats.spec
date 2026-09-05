# -*- mode: python ; coding: utf-8 -*-
# Spec do PyInstaller (>= 6.0) para o Concrestats — build ONEDIR.
# Gera: dist/Concrestats/Concrestats.exe  +  dist/Concrestats/_internal/...
# (templates/ e static/ vão para _internal/, localizados em runtime via sys._MEIPASS)

from PyInstaller.utils.hooks import (collect_submodules, collect_data_files,
                                     collect_dynamic_libs)

# O backend vai embutido como reserva: o programa roda pela pasta codigo/,
# que a atualizacao substitui, e volta para estes modulos se ela nao abrir.
BACKEND = ['app', 'assinatura', 'atualizador', 'licenca', 'pagamento']

hidden = (collect_submodules('openpyxl') + ['numpy', 'pandas', 'pandas._libs.tslibs.timedeltas']
          + collect_submodules('webview') + ['clr', 'webview.platforms.winforms']
          + collect_submodules('qrcode') + BACKEND)

# pywebview (WebView2/WinForms) + pythonnet trazem DLLs/dados que o
# collect_submodules NÃO pega — coletadas explicitamente p/ o app nativo funcionar.
extra_datas = collect_data_files('webview')
extra_bins = collect_dynamic_libs('webview')
try:
    extra_datas += collect_data_files('clr_loader')
    extra_bins += collect_dynamic_libs('clr_loader')
except Exception:
    pass

# Edicao embutida: presente so' quando o build foi feito por
# tools/build_edicao.py. Vai para a RAIZ do bundle, e nao para static/ ou
# templates/ — sao essas duas que o pacote de atualizacao substitui inteiras,
# e a edicao tem de sobreviver a elas.
import os as _os
_edicao = [('edicao_embutida.json', '.')] if _os.path.exists('edicao_embutida.json') else []

a = Analysis(
    ['principal.py'],
    pathex=[],
    binaries=extra_bins,
    datas=[
        ('templates', 'templates'),
        ('static', 'static'),
        ('icon.ico', '.'),      # icone da JANELA (o do .exe e' o icon= abaixo)
    ] + _edicao + extra_datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL'],  # PIL só é usado p/ gerar o icon.ico (dev)
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Concrestats',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,           # False = app nativo sem janela de terminal (como Spotify).
                             # Troque para False se quiser um app sem janela de console.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',         # ícone do app (lupa sobre gráfico, 7 tamanhos)
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Concrestats',
)
