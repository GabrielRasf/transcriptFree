# Resultados de teste — protótipo browser

## Testes automatizados

- `python -m pytest tests/ -q` → **29 passed** (inclui `tests/test_browser_segments.py`).
- Ambiente: Windows (`win32`), Python 3.14 (`.venv`), Node v24.17.0.

## Inferência no navegador (Playwright · Chromium headless)

| Item | Valor |
|---|---|
| Navegador | Chromium (Playwright 1.64 / Chrome for Testing 156) |
| SO | Windows win32 x64 |
| Áudio | MP3 PT-BR ~6,95 s (TTS “Microsoft Maria Desktop” → `av` MP3, 56 493 bytes) |
| Modelo | `Xenova/whisper-tiny` |
| Quantização | `dtype: "q8"` |
| Device | **wasm** (WebGPU sem adapter no headless; fallback correto) |
| Tempo wall (UI) | **~8,1 s** (carga do modelo + decode + transcrição) |
| Tamanho modelo em cache (arquivos q8) | **~41,6 MB** (decoder ~30,0 MB + encoder ~9,9 MB + tokenizer/configs) |
| Timestamps | Sim — `(0:00 - 0:06)` + texto |
| POST de áudio / `/transcribe` | **Nenhum** (lista Network do Playwright; `suspiciousAudioPosts: []`) |

Pré-visualização TXT:

```text
(0:00 - 0:06)
Olá, este é um teste de transcrição importante para o que eu vou fazer.
```

Qualidade do `tiny` é limitada (frase TTS distorcida). Rede observada: página/JS locais, jsDelivr (`@huggingface/transformers@3.7.2` + WASM ONNX), Hugging Face Hub para pesos — sem upload do MP3.

## Smoke Node (mesmo modelo, fora do Worker)

Cache quente: carga ~0,8 s, transcrição ~1,1 s, device CPU/WASM. Confirma API `Float32Array` + `return_timestamps` + `language: "portuguese"` em `@huggingface/transformers@3.7.2`.

## Hospedagem do modelo na Vercel

Pesos **não** baixados no build (~41,6 MB). Dependência documentada: Hub na 1ª execução do cliente. Ver `models/README.md`.

## Áudio longo (1–10 min) + chunking

- Estudo pré-implementação: [`LONG_AUDIO_STUDY.md`](./LONG_AUDIO_STUDY.md)
- Validação pós-chunking (Chrome 1/5/10 min): [`CHUNKING_VALIDATION.md`](./CHUNKING_VALIDATION.md)
- Comparação tiny/base/q4 vs Faster Whisper: [`MODEL_COMPARE.md`](./MODEL_COMPARE.md)
- Harness: [`benchmark/`](./benchmark/)
