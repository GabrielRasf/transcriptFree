# Changelog

Todas as mudanças relevantes deste projeto serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado
- Transcrição em lote: vários áudios de uma vez, progresso e download ZIP

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
