# Notas da Release v0.1.0

Cole isso na descrição da Release no GitHub.

## Transcriptor 0.1.0

Primeira versão pública: transcreva MP3 (e outros áudios) em TXT com timestamps, **local e grátis**.

### Download (Windows)

1. Baixe **Transcriptor.zip** abaixo
2. Descompacte a pasta inteira
3. Abra `Transcriptor.exe`

Na primeira vez o modelo Whisper é baixado (~150 MB).

### Formato do TXT

```text
(0:03 - 0:35)
Seu texto transcrito aqui...
```

### Incluído nesta release

- Interface simples: upload → transcrever → download
- Whisper `base` em português
- Empacotamento Windows standalone

### Requisitos

- Windows 10/11 64-bit
- Internet na primeira execução (download do modelo)
- PC com CPU razoável para áudios longos

---

**Arquivo para anexar na Release:** `dist/Transcriptor.zip`
