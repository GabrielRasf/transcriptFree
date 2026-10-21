# Changelog

Todas as mudanças relevantes deste projeto serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado
- Transcrição em lote: vários áudios de uma vez, progresso e download ZIP
- Testes das funções de texto/validação e dos erros HTTP, sem executar o Whisper
- Protótipo experimental de transcrição no navegador (`/browser-prototype/`): Transformers.js + Whisper tiny multilingual em Web Worker, sem alterar o fluxo Python/Faster Whisper
- Chunking 30 s / stride 5 s no protótipo (progresso por janela, cancelamento, multiarquivo) + harness de benchmark Chromium
- UI principal com dois modos: Python/API (padrão quando há backend) e navegador tiny+chunking (seletor explícito, cancelamento, avisos de precisão)
- `PRIVACY.md` do protótipo com checklist de verificação no DevTools (áudio não sai do navegador)

### Alterado
- Cada upload fica limitado a 200 MB (HTTP 413) e é gravado em pedaços
- Falha interna de transcrição responde 500 com mensagem genérica; o detalhe fica no log
- Arquivo sem extensão deixa de ser assumido como MP3, salvo MIME conhecido
- ZIP gerado no navegador marca o nome do arquivo como UTF-8
- A transcrição roda fora do event loop, uma por vez
- `requests` permanece em `requirements.txt`: o faster-whisper 1.1.1 importa esse pacote sem declará-lo
- UI pode apontar para API remota (`TRANSCRIPTOR_API_URL`); deploy web documentado em `docs/DEPLOY.md`

### Adicionado
- `run_public.py`, `Dockerfile` e CORS opcional (`CORS_ORIGINS`) para API em host persistente
- `vercel.json` + `scripts/prepare_vercel.py` para publicar só a interface na Vercel
- `GET /health` para healthcheck do host da API

### Planejado
- Seleção de modelo Whisper
- Exportação SRT / VTT
- Builds para Linux / macOS

## [0.1.0] - 2026-07-20

### Adicionado
- Interface web: upload → transcrever → download TXT
- Timestamps no formato `(M:SS - M:SS)`
- Backend FastAPI + faster-whisper (modelo `base`, português)
- Empacotamento Windows (`Transcriptor.exe` + ZIP via `build.bat`)
- Documentação open source (README, LICENSE, CONTRIBUTING, etc.)
