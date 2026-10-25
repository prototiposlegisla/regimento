@echo off
rem ============================================================================
rem build_e_testa_local.bat - gera o regimento num arquivo de teste e abre no
rem navegador. Nao mexe em docs\index.html, na versao privada do OneDrive nem
rem nos Markdown do chatbot, e nao faz commit/push (para isso: build_e_publica.bat).
rem
rem Saida: regimento\dist\teste\index.html (dist\ fica fora do git)
rem A versao de teste mostra tambem os correlatos ainda propostos.
rem
rem Uso:
rem   build_e_testa_local.bat            gera e abre a versao de teste
rem   build_e_testa_local.bat comparar   abre tambem a versao publicada
rem                                      (docs\index.html) para comparar
rem ============================================================================

rem pasta deste .bat, sem a barra final
set "REGIMENTO=%~dp0"
set "REGIMENTO=%REGIMENTO:~0,-1%"
set "SAIDA=%REGIMENTO%\dist\teste\index.html"
set "PYTHONIOENCODING=utf-8"

if exist "%SAIDA%" del "%SAIDA%"

rem "echo." responde ao "Pressione Enter para fechar..." do fim do build.py
rem --com-propostas: mostra tambem os correlatos com Status "proposto" na
rem planilha remissoes.xlsx (borda tracejada), para revisar antes de aprovar
echo.| python "%REGIMENTO%\build.py" --only-public --skip-markdown --com-propostas --output "%SAIDA%"
set "RC=%errorlevel%"

if not exist "%SAIDA%" (
  echo.
  echo O build nao gerou %SAIDA% - veja as mensagens acima.
  pause
  exit /b 1
)

start "" "%SAIDA%"
if /i "%~1"=="comparar" start "" "%REGIMENTO%\docs\index.html"

echo.
if not "%RC%"=="0" echo Atencao: o build terminou com erros de validacao ^(veja acima^), mas o arquivo foi gerado e aberto.
echo Versao de teste aberta: %SAIDA%
pause
