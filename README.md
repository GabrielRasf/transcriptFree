# Transcriptor

**Transcreva áudio em texto no seu computador — grátis, local e open source.**

Sem assinatura. Sem enviar áudio para a nuvem. Coloque o MP3, transcreva, baixe o `.txt` com timestamps.

[English](#english) · [Baixar (.exe)](#versão-baixável-windows) · [Contribuir](CONTRIBUTING.md) · [Licença](LICENSE)

---

## Por que existe

Muita gente paga por minuto (ou por mês) só para transformar áudio em texto. O Transcriptor usa [Whisper](https://github.com/openai/whisper) localmente via [faster-whisper](https://github.com/SYSTRAN/faster-whisper): o áudio fica no seu PC e o custo é zero.

Ideal para podcasts, aulas, meditações, entrevistas e qualquer gravação em português.

## O que faz

1. Você envia um ou vários áudios (MP3 e outros formatos)
2. O app transcreve com segmentos de tempo (em lote, um após o outro)
3. Você baixa um `.txt` — ou um `.zip` com todos, se forem vários — neste formato:

```text
(0:03 - 0:35)
Olá, seja bem-vindo de volta ao Prana. Neste modo, vamos aprender a respirar melhor...

(0:36 - 1:10)
Texto do próximo trecho...
```

## Versão baixável (Windows)

1. Baixe o ZIP na [página de Releases](../../releases) (`Transcriptor.zip`)
2. Descompacte **a pasta inteira**
3. Abra `Transcriptor.exe`
4. O navegador abre sozinho — coloque o áudio → **Transcrever** → **Download TXT**

> Na primeira execução o modelo Whisper é baixado (~150 MB). É preciso internet só nessa etapa. Depois funciona offline.

Feche a janela do console para encerrar o app.

### Gerar o pacote você mesmo

```bat
build.bat
```

Saída:

- `dist\Transcriptor\Transcriptor.exe`
- `dist\Transcriptor.zip`

## Uso em desenvolvimento

Requisitos: Python 3.10+ (testado em 3.14), Windows / Linux / macOS.

```bash
git clone https://github.com/GabrielRasf/transcriptor.git
cd transcriptor
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
python run.py
```

Abra http://127.0.0.1:8000

### Formatos aceitos

`.mp3` · `.wav` · `.m4a` · `.ogg` · `.flac` · `.webm` · `.aac` · `.opus` · `.mp4` …

## Estrutura do projeto

```text
transcriptor/
├── app.py              # API FastAPI + Whisper
├── run.py              # Sobe o servidor e abre o navegador
├── static/index.html   # Interface (upload → transcrever → download)
├── Transcriptor.spec   # Empacotamento PyInstaller
├── build.bat           # Gera .exe + ZIP
└── requirements.txt
```

## Avisos

- O modelo padrão é Whisper **base** (bom equilíbrio velocidade/qualidade).
- Arquivos longos podem demorar em CPU.
- Privacidade: o processamento é local; o download inicial do modelo vem do Hugging Face.

## Roadmap (ideias)

- [ ] Escolher modelo (`tiny` / `base` / `small` / `medium`)
- [ ] Exportar SRT / VTT
- [x] Transcrever vários arquivos (lote + ZIP)
- [ ] Mais idiomas na interface
- [ ] Build para Linux / macOS

Sugestões? Abra uma [Issue](../../issues).

## Créditos

- [OpenAI Whisper](https://github.com/openai/whisper)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (SYSTRAN)
- [FastAPI](https://fastapi.tiangolo.com/) · [Uvicorn](https://www.uvicorn.org/)

## Licença

Código deste repositório: [MIT](LICENSE).  
Whisper e faster-whisper têm suas próprias licenças MIT — veja [NOTICE](NOTICE).

---

## English

**Transcribe audio to text on your computer — free, local, and open source.**

No subscription. No uploading your audio to the cloud. Drop an MP3, transcribe, download a `.txt` with timestamps.

### Why

People often pay per minute or per month just to turn speech into text. Transcriptor runs [Whisper](https://github.com/openai/whisper) locally through [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Your files stay on your machine.

### Flow

Upload → Transcribe → Download TXT in this format:

```text
(0:03 - 0:35)
Hello, welcome back...
```

### Windows download

1. Get `Transcriptor.zip` from [Releases](../../releases)
2. Unzip the **whole** folder
3. Run `Transcriptor.exe` (browser opens automatically)

First run downloads the Whisper model (~150 MB). After that, it works offline.

### Develop

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python run.py
```

### License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
