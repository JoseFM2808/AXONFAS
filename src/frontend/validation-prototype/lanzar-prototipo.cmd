@echo off
rem AXONFAS - lanza el prototipo de validacion en la red local (TD-33).
rem Doble clic en este archivo, o ejecutalo desde una terminal. Ctrl+C para detenerlo.
rem Este equipo: http://localhost:8091  -  otros equipos de la misma red: el QR de la pagina (https://IP:8443).
rem Acepta argumentos de serve.py, por ejemplo: lanzar-prototipo.cmd --local-only
title AXONFAS - prototipo de validacion
cd /d "%~dp0..\..\.."
py src\frontend\validation-prototype\serve.py %*
if errorlevel 1 pause
