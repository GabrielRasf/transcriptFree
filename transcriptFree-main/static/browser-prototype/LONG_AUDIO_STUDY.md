# Estudo: áudio longo no navegador (30–60 min)

Data das medições: 2026-10-21. Ambiente: Windows 11 Pro, AMD Ryzen 5 4600G (6c/12t) + Radeon Graphics, ~14 GB RAM. Sem commit/push/deploy. Fluxo principal Python **não** alterado.

## 1. Arquivos analisados e alterações

### Analisados (sem mudar o fluxo principal)

| Arquivo | Papel |
|---|---|
| `app.js` | `File.arrayBuffer` → `decodeAudioData` → mono 16 kHz → Worker (transfer) |
| `whisper-worker.js` | `pipeline` tiny q8; **não** passa `chunk_length_s` |
| `segments.js` | Formatação TXT |
| `TEST_RESULTS.md` / `PRIVACY.md` | Baseline curto |

### Criados (harness isolado)

- `benchmark/generate_fixtures.py`, `run_node_bench.mjs`, `run_browser_60s.mjs`, `compare_fw.py`, `chunking.js`, `README.md`
- `tests/test_chunking_plan.py`
- Este relatório

**Atualização:** chunking integrado ao protótipo (`whisper-worker.js` + `chunking.js`). Validação em `CHUNKING_VALIDATION.md`.

---

## 2. Auditoria do protótipo atual (memória e fluxo)

### Pipeline de buffers

1. `file.arrayBuffer()` — arquivo comprimido inteiro na heap.
2. `buffer.slice(0)` — **segunda cópia** do comprimido (exigência do `decodeAudioData`).
3. `AudioBuffer` — PCM na taxa nativa (ex.: 22,05/44,1 kHz), possivelmente multi-canal.
4. Mixagem mono → novo `Float32Array` se >1 canal.
5. Reamostragem → outro `Float32Array` @ 16 kHz (`mono.slice` ou loop).
6. `postMessage(..., [samples.buffer])` — transfere o PCM ao Worker (main perde o buffer).
7. Worker mantém `samples` até o fim de `runTranscribe`, depois `msg.samples = null`.

**Conclusão:** o áudio **inteiro** vira PCM float32 na memória **antes** da inferência. Não há decode por blocos.

### Truncamento crítico (>30 s)

Em `@huggingface/transformers@3.7.2`, sem `chunk_length_s`, o feature extractor **corta** o áudio nos primeiros `n_samples` (~30 s) e emite warning. Medido:

| Condição | Duração arquivo | Último timestamp | Interpretação |
|---|---|---|---|
| Protótipo atual / `60s_no_chunk` | 60 s | `[18, 26]` | Só o início (~30 s de conteúdo) |
| Com `chunk_length_s: 30`, `stride_length_s: 5` | 60 s | `[58, 61]` | Cobertura até o fim |

Ou seja: o protótipo **atual não é apto** a entrevistas longas até habilitar chunking (nativo da lib ou próprio).

### Chunking nativo da biblioteca

Confirmado em `pipelines.js` (`_call_whisper`): com `chunk_length_s > 0`, usa `subarray` + overlap (`stride`), gera **sequencialmente**, e `_decode_asr` mescla texto/timestamps. Ainda assim o `Float32Array` completo permanece referenciado durante todo o loop.

---

## 3. Resultados dos benchmarks (medidos)

Fixtures: TTS pt-BR (Microsoft Maria Desktop) gerado localmente; 1/5/10 min por concatenação da mesma unidade (~32 s) + silêncio. Clip de qualidade (~23,5 s) sem repetição, com texto de referência.

Modelo: `Xenova/whisper-tiny`, `dtype: q8`. Backend: **WASM/CPU** (Node e Chromium headless). WebGPU: não disponível de forma estável neste ambiente headless.

### 3.1 Node (ONNX Runtime WASM)

Carga do modelo (cache quente): **~0,96–1 s**. RSS após carga: **~290 MB**.

| Label | Duração | PCM | Transcrição | RTF | Chunks | lastTs |
|---|---|---|---|---|---|---|
| quality_chunk30_s5 | 23,5 s | 1,44 MB | **2,1–2,3 s** | ~0,09–0,10 | 4 | ~22,8 s |
| 60s_no_chunk | 60 s | 3,66 MB | ~2,3 s | — | 5 | **26 s (truncado)** |
| 60s_chunk30_s5 | 60 s | 3,66 MB | **~6,5 s** | **0,109** | 12 | ~61 s |
| 60s_chunk25_s5 | 60 s | 3,66 MB | ~6,2 s | 0,103 | 5 | **74,6 s (overflow)** |
| 300s_chunk30_s5 | 300 s | 18,31 MB | **47,0 s** | **0,157** | 36 | ~299 s |
| 600s_chunk30_s5 | 600 s | 36,62 MB | **88,6 s** | **0,148** | 76 | ~600 s |

Arquivos MP3: 60 s ≈ 481 KB; 300 s ≈ 2,4 MB; 600 s ≈ 4,8 MB.

Memória Node: deltas de RSS/heap **não são pico confiável** (GC, WASM externo). Pico observado de RSS após runs longos ~**1,0 GB**. Heap JS após 10 min ~55–100 MB — subestima o runtime nativo.

### 3.2 Chromium headless (60 s, página isolada com chunking)

| Item | Valor medido |
|---|---|
| modelLoadMs | 4464 |
| transcribeMs | **12608** |
| wallMs | 17071 |
| RTF (só inferência) | **0,210** |
| `performance.memory.usedJSHeapMB` | **347,1** (Chrome; não é RSS do processo) |
| POST de áudio / `/transcribe` | **0** |

Chromium ~**1,9×** mais lento que Node no mesmo áudio de 60 s com as mesmas opções de chunk.

### 3.3 Não medido (declarado)

- 30 min e 60 min de áudio **não** foram executados ponta a ponta.
- Pico de memória do processo Chrome (Task Manager) não capturado automaticamente.
- WebGPU em desktop com adapter real: não medido nesta sessão.

---

## 4. Estimativa de memória por duração

### PCM mono float32 @ 16 kHz (fórmula exata)

`bytes = duração_s × 16000 × 4`

| Duração | PCM | Notas |
|---|---|---|
| 5 min | **19,2 MB** | ≈ 18,31 MB medido @ 300 s |
| 10 min | **38,4 MB** | ≈ 36,62 MB @ 600 s |
| 30 min | **115,2 MB** | só PCM final @ 16 kHz |
| 60 min | **230,4 MB** | só PCM final @ 16 kHz |

### Cópias adicionais no decode atual (`app.js`)

No pior caso (antes do transfer):

- arquivo comprimido + `slice` (2× tamanho do MP3; 60 min de fala TTS ~5 MB/10 min → ordem de **dezenas de MB**);
- `AudioBuffer` na taxa nativa (pode ser **> PCM 16 kHz** se 44,1 kHz / stereo);
- buffers mono + reamostrado.

Ordem de grandeza no pico de decode para 60 min: **centenas de MB** só de áudio, **antes** do modelo.

### Modelo + runtime (ordem de grandeza medida)

- Arquivos q8 em disco: **~41,6 MB** (estudo anterior).
- RSS Node após load: **~290 MB**.
- Heap JS Chrome pós 60 s: **~347 MB** (não inclui todo o processo).

**Complemento de medição sugerido:** Performance → Memory no Chrome, ou contador “Working set” do processo no Gerenciador de Tarefas durante 10 min e 30 min manuais.

---

## 5. Estratégia de chunking recomendada

### Preferência: API nativa da lib (já suportada)

```js
await transcriber(samples, {
  return_timestamps: true,
  language: "portuguese",
  task: "transcribe",
  chunk_length_s: 30,   // janela 20–30 s; 30 alinha ao treino Whisper
  stride_length_s: 5,   // overlap ≈ 5 s cada lado (default da lib = chunk/6)
});
```

Documentação tipada da 3.7.2: `chunk_length_s` / `stride_length_s`. Merge e offsets são feitos em `_decode_asr`.

**Não assumir** “só somar offset” se a lib já mesclou — isso **duplicaria** o deslocamento.

### Parâmetros sugeridos para a próxima fase

| Parâmetro | Valor inicial | Motivo |
|---|---|---|
| `chunk_length_s` | **30** | Janela nativa Whisper; medido OK em 1–10 min |
| `stride_length_s` | **5** | Overlap estável; 25/5 mostrou overflow de timestamp |
| Evitar | `chunk_length_s: 25` sem validação | lastTs 74 s em áudio de 60 s (medido) |

### Se for necessário chunking manual (fora da lib)

1. Decode → PCM 16 kHz (idealmente por trechos no futuro).
2. Janelas `planWindows(duration, 30, 5)` (`benchmark/chunking.js`).
3. Inferir cada janela; **liberar** o slice após uso.
4. Ajustar timestamps com `shiftChunks` **somente** se a saída for relativa à janela.
5. Deduplicar overlap (texto + proximidade temporal); `auditMergedChunks` / `findCoverageGaps`.
6. UI: progresso `janela i/N` + cancel → `terminate` Worker.
7. Testes obrigatórios: ordem cronológica, gaps > limiar, duplicatas na junção, lastTs ≤ duração+ε.

### Decode em streaming?

A lib **não** remove a necessidade do waveform completo quando se chama o pipeline uma vez com o array inteiro (`subarray` só evita cópia por janela). Decode verdadeiramente streaming (sem PCM total) **não** está confirmado como suportado de ponta a ponta nesta versão — exigiria arquitetura própria (MediaBunny/ffmpeg.wasm por segmentos) e nova validação. **Não implementar** até prova de suporte estável.

---

## 6. Qualidade e timestamps

### Clip de referência (~23,5 s, fala com nomes próprios)

| Motor | WER vs referência (palavra) | Notas |
|---|---|---|
| Faster Whisper `base` int8 | **0,021** (2,1 %) | Quase fiel; timestamps coerentes |
| Transformers.js tiny q8 (Node) | **0,192** (19,2 %) | Erros: “doctor”, “januio de 2020 e 6”, “Infermeira” |

**Não há equivalência** entre os motores. Tiny serve a protótipo/privacidade no cliente; base local continua superior para qualidade.

### Timestamps em áudio longo (TTS repetido)

- Com `chunk30_s5`: cobertura até o fim em 60/300/600 s; gaps >2 s: **0** nos audits.
- Alertas `possible_text_duplicate`: em parte **esperados** (fixture é loop da mesma fala) — não prova sozinho bug de merge.
- `chunk25_s5`: timestamps **além** da duração → rejeitar como default.

---

## 7. Limitações de navegador e hardware

- Medições longas confiáveis aqui: **Node WASM** até 10 min; **Chrome** só 60 s com chunking.
- Headless: sem WebGPU útil; desktop com iGPU AMD pode diferir.
- RAM do host ~14 GB com pouca folga livre no momento do teste — risco maior em notebooks 8 GB para 60 min + modelo + Chrome.
- UI atual: um único job; sem progresso por janela; sem `chunk_length_s`.

### Extrapolação (não é garantia)

Usando RTF Node 10 min (**0,148**) e fator Chrome/Node @60 s (**~1,9×**):

| Duração | Estimativa Node | Estimativa Chrome WASM |
|---|---|---|
| 30 min | ~4–5 min | ~8–10 min |
| 60 min | ~9–10 min | ~16–20 min |

Marcado como **estimativa**. RTF subiu de 0,11 (1 min) para 0,15 (10 min) — não linearizar cegamente.

---

## 8. Privacidade

- Fixtures e inferência **locais**; sem upload de áudio a STT.
- Bench Chromium: `suspiciousPosts: []`.
- Chunking nativo **não** exige serviço externo.
- Dependência remota permanece: **pesos** do modelo + JS/WASM (jsDelivr / Hub) — documentada; não é o áudio do usuário.
- Harness não grava áudio em IndexedDB/localStorage.

---

## 9. Classificação de viabilidade

| Meta | Classificação | Base |
|---|---|---|
| **30 minutos** | **Viável com limitações ou chunking adicional** | 10 min medido (Node) com `chunk_length_s`; protótipo UI ainda trunca; qualidade tiny << Faster Whisper; memória PCM ~115 MB + runtime |
| **60 minutos** | **Não validado por falta de medições** (tendência: viável com limitações severas) | Só extrapolação; PCM ~230 MB + decode; risco OOM em 8 GB; tempo de espera alto no WASM |

**Inviável** se a exigência for paridade com Faster Whisper `base` ou UX “quase tempo real” no cliente low-end.

---

## 10. Critérios objetivos para autorizar a próxima fase

Autorizar integração no protótipo (ainda experimental, sem substituir Python) **somente se**:

1. Worker passar `chunk_length_s: 30` e `stride_length_s: 5` (ou equivalente validado).
2. Teste automatizado comprove que áudio >45 s **não** trunca (lastTs ≥ 0,9 × duração).
3. Bench browser (não só Node) de **≥10 min** completar sem crash, com cancelamento OK.
4. Pico de memória do processo Chrome documentado (Task Manager ou CDP) para 10 min e, se possível, 30 min.
5. WER / revisão qualitativa aceitos explicitamente para o caso de uso (tiny ≠ base).
6. Privacidade: checklist Network sem POST de áudio (como em `PRIVACY.md`).
7. Progresso por janela + liberação de referências após cada merge.

Até lá: manter Faster Whisper como caminho principal; usar o harness em `benchmark/` para novas medições.
