# Textos prontos para divulgação

Textos prontos — repo: https://github.com/GabrielRasf/transcriptor

---

## LinkedIn / Twitter (curto)

```text
Transcrever áudio não precisa ser assinatura.

Lancei o Transcriptor (open source):
MP3 → TXT com timestamps, rodando no seu PC.
Sem nuvem. Sem pagar por minuto.

Windows: baixe o .exe na Release
https://github.com/GabrielRasf/transcriptor/releases

Código aberto (MIT). Contribuições bem-vindas.
```

---

## Reddit / fóruns

**Título:**
```text
[Open Source] Transcriptor — MP3 para TXT com timestamps, local e grátis (Windows .exe)
```

**Corpo:**
```text
Fiz um app simples porque cansei de ver gente pagando para transcrever áudio.

O que faz:
- Você coloca um MP3 (ou wav/m4a/ogg…)
- Transcreve localmente com Whisper
- Baixa um .txt no formato:

(0:03 - 0:35)
Texto do trecho...

Sem enviar áudio para a nuvem. Sem assinatura.

Windows: tem .exe na Release
Repo: https://github.com/GabrielRasf/transcriptor

Feedback e PRs são bem-vindos.
```

---

## Show HN (Hacker News)

**Título:**
```text
Show HN: Transcriptor – local MP3 to timestamped TXT (Whisper, free, Windows exe)
```

**Texto:**
```text
I built a tiny open-source tool so people don’t have to pay for speech-to-text subscriptions.

Upload an audio file → transcribe locally with Whisper → download a .txt with (start - end) timestamps.

Privacy-friendly (runs on your machine). MIT license. Windows zip/exe in Releases; source runs anywhere with Python.

https://github.com/GabrielRasf/transcriptor
```

---

## Discord / Telegram / grupos de criadores

```text
Se você paga para transcrever podcast/aula/áudio: tem alternativa open source.

Transcriptor — local, grátis, gera TXT com tempo marcado.
.exe pro Windows + código no GitHub:
https://github.com/GabrielRasf/transcriptor
```

---

## Checklist de lançamento no GitHub

1. [ ] Criar repositório público
2. [ ] Subir o código (sem `.venv`, `dist/`, `build/`, áudios)
3. [ ] Confirmar README, LICENSE, NOTICE
4. [ ] Rodar `build.bat` e anexar `dist/Transcriptor.zip` na Release `v0.1.0`
5. [ ] Colar o texto de `docs/RELEASE_NOTES_v0.1.0.md`
6. [ ] Criar Release com `dist/Transcriptor.zip`
7. [ ] Postar em 2–3 comunidades no mesmo dia
