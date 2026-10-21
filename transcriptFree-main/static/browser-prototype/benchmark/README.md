# Benchmark isolado — áudio longo (protótipo browser)

Não faz parte do fluxo FastAPI / Faster Whisper. Não faz commit de áudios.

## Como executar

Na raiz do app (`transcriptFree-main/`):

```bat
:: 1) Fixtures PT-BR locais (TTS Windows SAPI + av) — 1 / 5 / 10 min + clip de qualidade
.venv\Scripts\python.exe static\browser-prototype\benchmark\generate_fixtures.py

:: 2) Dependências Node do harness
cd static\browser-prototype\benchmark
npm install

:: 3) Bench Node (WASM/CPU) — opcional: --only=60 ou --only=300,600
node run_node_bench.mjs

:: 4) Comparar qualidade com Faster Whisper (mesmo clip de referência)
cd ..\..\..
.venv\Scripts\python.exe static\browser-prototype\benchmark\compare_fw.py

:: 5) Inferência real espelhando o Worker (>45 s)
node run_inference_chunk_test.mjs

:: 6) Benchmark Chromium 1 / 5 / 10 min (PCM binário; evita OOM no evaluate)
node run_browser_chunk_bench.mjs
node run_browser_chunk_bench.mjs --only=60

:: 7) Comparação de modelos (WER alinhado + Chrome)
node run_model_compare.mjs
node run_browser_model_compare.mjs
..\..\..\.venv\Scripts\python.exe compare_fw_same_wer.py
```

Resultados em `fixtures/*.json` (pasta ignorada pelo Git).

## Relatórios

- Estudo: `../LONG_AUDIO_STUDY.md`
- Validação do chunking: `../CHUNKING_VALIDATION.md`
- Comparação de modelos: `../MODEL_COMPARE.md`
