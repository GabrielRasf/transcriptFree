# Validação do chunking no protótipo (navegador)

Data: 2026-10-21. Sem commit/push/deploy. Fluxo Python intacto.

## Implementação

| Peça | Papel |
|---|---|
| `chunking.js` | `planWindows(30,5)`, zona confiável (stride), `mergeWindowResults`, dedupe por **IoU temporal** + texto relacionado |
| `whisper-worker.js` | Inferência por janela ≤30 s + progresso + `cancel` cooperativo |
| `app.js` | Multiarquivo; erro em um não aborta os demais; cancel termina o Worker |

**API confirmada** em `@huggingface/transformers@3.7.2`: `chunk_length_s`, `stride_length_s`, `return_timestamps`. O Worker **não** aninha `chunk_length_s` dentro de cada janela (já ≤30 s); o salto de janela replica `jump = chunk - 2*stride` da lib.

### Limitações da junção (documentadas)

- Fala contínua sem pausa na fronteira pode gerar eco residual ou omissão.
- Alucinações do tiny sem overlap temporal **não** são removidas.
- Paráfrases na zona de stride com IoU baixo podem permanecer.
- Timestamps podem precisar de clamp à duração (aplicado).

## Testes automatizados

`pytest`: **33 passed** (inclui junção, cancelamento simulado, isolamento de lote, protótipo).

Inferência real Node (mesma lógica do Worker), `ptbr_60s` (>45 s):

| Campo | Valor |
|---|---|
| ok | **true** |
| ratio cobertura | **1.0** |
| ordered / withinDuration | true |
| lastTimestamp | `[58, 60]` |
| janelas | 3 |
| transcribeMs | ~7252 |

## Benchmark Chromium (chunking)

Modelo `Xenova/whisper-tiny` q8, device **wasm**, chunk 30 / stride 5.

| Duração | MP3 | modelLoadMs | transcribeMs | lastTs | ratio | usedJSHeapMB* |
|---|---|---|---|---|---|---|
| 60 s | 481 005 | 4478 | **12606** | [58,60] | 1.0 | 272.8 |
| 300 s | 2 401 101 | 858 | **69690** | [293.16,299.4] | 0.998 | 272.8 |
| 600 s | 4 801 005 | 712 | **169851** | [598.16,600] | 1.0 | 272.8 |

\* `performance.memory` (heap JS). Valores idênticos entre runs sugerem medição grosseira / cache de heap; **não** substitui RSS do processo. Metodologia complementar: Gerenciador de Tarefas no run manual.

POST de áudio / `/transcribe`: **nenhum** (`suspiciousAudioPosts: []`). GET local `/pcm/*.f32` só no harness de bench (não é upload a STT).

### Impedimento corrigido

Primeira tentativa de 10 min falhou com OOM no Node ao serializar `Array.from(Float32Array)` no `page.evaluate`. Corrigido servindo PCM binário. **10 min concluído com sucesso** após o fix.

## Qualidade

Referência histórica (estudo): Faster Whisper base WER **2,1%** · tiny q8 **19,2%**.

Novo (mesmo clip de qualidade): pipeline nativa `chunk_length_s=30` vs merge manual do protótipo → WER **0,1915** em ambos; hipóteses idênticas. Chunking **não** melhorou a precisão do tiny; apenas a cobertura temporal.

### Alternativas (estimativa, não implementadas)

| Opção | Download / custo | Nota |
|---|---|---|
| Whisper **base** ONNX q8 | tipicamente **~3–4×** tiny (~120–160 MB ordem de grandeza) | Melhor WER esperado; maior RAM/tempo |
| WebGPU | mesmo modelo; exige adapter | Pode reduzir tempo; não medido com sucesso no headless desta máquina |

## Critérios de aprovação

| # | Critério | Status |
|---|---|---|
| 1 | Navegador >45 s sem truncamento | **OK** (60 s Chrome + Node) |
| 2 | Timestamps coerentes/contínuos | **OK** (ratio ≥0,9; ordered) |
| 3 | Testes de junção/fronteiras | **OK** |
| 4 | Bench ≥10 min no navegador | **OK** (600 s, ~170 s inferência) |
| 5 | Memória medida ou metodologia | **Parcial** — heap JS documentado; RSS processo pendente de medição manual |
| 6 | Sem upload de áudio | **OK** |
| 7 | Python + pytest | **OK** (33 passed) |

**Pendência para integração na UI principal:** revisão humana dos resultados + medição de RSS em desktop real (opcional WebGPU).
