# Comparação de modelos no navegador (qualidade × desempenho)

Data: 2026-10-21. Experimentos isolados — **sem** alterar UI principal, **sem** substituir Faster Whisper, **sem** commit/push/deploy.

## 1. Auditoria do WER anterior

| Item | Valor |
|---|---|
| Áudio de referência | `benchmark/fixtures/ptbr_quality.wav` (~23,5 s, TTS pt-BR Maria) |
| Texto de referência | `ptbr_quality.ref.txt` (nomes próprios, cidade, hospital, data falada) |
| Normalização WER (JS e Python alinhados) | lower → NFD remove acentos → remove pontuação → split por espaço |
| Tiny histórico | **19,15%** (Node + Chrome, mesmo hyp) |
| Faster Whisper histórico | **2,13%** (`base` int8 CPU) |

Conclusão da auditoria: os WERs citados no estudo usam o **mesmo clip e a mesma família de critérios**; a reexecução abaixo com normalização idêntica confirma FW **2,13%** e tiny q8 **19,15%**.

Áudios longos (60/300/600 s) medem **tempo/cobertura**, não WER (são loops TTS sem referência única).

---

## 2. Modelos avaliados (Transformers.js 3.7.2)

Compatíveis e multilingual (adequados a PT-BR):

| Modelo | Licença | `dtype` | Arquivos ONNX usados (HEAD) | Total ONNX ≈ |
|---|---|---|---|---|
| `Xenova/whisper-tiny` | Apache-2.0 | **q8** (`*_quantized.onnx`) | encoder 9,7 + decoder 29,3 MB | **~39 MB** |
| `Xenova/whisper-tiny` | Apache-2.0 | **q4** | encoder 8,6 + decoder 82,7 MB | **~91 MB** |
| `Xenova/whisper-base` | Apache-2.0 | **q8** | encoder 22,1 + decoder 51,2 MB | **~73 MB** |
| `Xenova/whisper-small` | Apache-2.0 | q8 (só tamanho) | encoder 88 + decoder 150 MB | **~238 MB** |

Notas:

- Modelos `*.en` foram **excluídos** (inglês apenas).
- `q4` no tiny **não** reduz download vs q8 neste empacotamento Xenova (decoder q4 maior).
- Tokenizer/configs: poucos MB adicionais (HEAD às vezes omite `content-length`; cache local anterior ~2,4 MB `tokenizer.json`).
- WebGPU: `navigator.gpu` pode existir sem adapter útil (headless). **Não medido com sucesso** neste ambiente; WASM foi o backend efetivo.

---

## 3. Resultados experimentais (mesmo áudio / mesmo WER)

### 3.1 Node (CPU/WASM) — qualidade + 60 s

| Config | WER | Load (ms) | Transcr. qualidade (ms) | 60 s (ms) | RTF 60 s | Cobertura 60 s |
|---|---|---|---|---|---|---|
| tiny q8 | **0,1915** | 938 | 2009 | 6936 | 0,116 | 1,00 |
| tiny q4 | **0,1702** | 4968 | 1262 | 3976 | 0,066 | 1,00 |
| base q8 | **0,1489** | 4147 | 3127 | 9414 | 0,157 | 0,983 |
| Faster Whisper base int8 | **0,0213** | 1663 | 1690 | — | — | — |

Fonte: `fixtures/model_compare_node.json`, `faster_whisper_same_wer.json`.

### 3.2 Chromium headless (WASM) — qualidade + 60 s

| Config | WER | Load (ms) | Transcr. qualidade (ms) | 60 s (ms) | RTF 60 s | Heap JS (MB) |
|---|---|---|---|---|---|---|
| tiny q8 | **0,1915** | 4574 | 4472 | 13184 | 0,22 | ~58 |
| base q8 | **0,1489** | 6512 | 7442 | 22199 | 0,37 | **~527** |

Fonte: `fixtures/model_compare_browser.json`. `suspiciousPosts`: **[]**.

### 3.3 Qualidade qualitativa (PT-BR)

Referência: *“… doutor Ricardo Oliveira … janeiro de dois mil e vinte e seis … enfermeira … Juliana Prado.”*

| Motor | Observação |
|---|---|
| Faster Whisper base | Quase fiel; “Dr.” / “belo horizonte”; WER ~2% |
| tiny q8 | “doctor”, “januio de 2020 e 6”, “Infermeira” |
| tiny q4 | “do autor Ricardo”; data melhor (“janeiro”); ainda longe do FW |
| base q8 | “Dr. Ricardo”, “enfermeira” ok; data vira “2022-16”; WER ~15% |

**Chunking não fecha o gap de precisão** relativamente ao Faster Whisper.

---

## 4. Privacidade e hospedagem

- Experimentos: áudio só local; Hub/jsDelivr só para **pesos/JS/WASM**.
- Empacotar na Vercel:
  - tiny q8 (~40–50 MB c/ tokenizer): possível, mas aumenta artefato; já documentado como opcional.
  - base q8 (~75+ MB) / small (~240 MB): **inadequado** para deploy silencioso; risco de limites de tamanho/tempo de upload.
- Projeto **não** é independente de terceiros enquanto baixar Hub + jsDelivr.

Limites práticos Vercel: preferir UI estática leve; pesos grandes → Hub na 1ª execução ou espelho consciente (ver `models/README.md`).

---

## 5. Equilíbrio prático (produto gratuito, áudio local)

| Critério | tiny q8 | base q8 | Faster Whisper base |
|---|---|---|---|
| Precisão PT-BR (este set) | Fraca | Melhor, ainda fraca | Forte |
| Download | Menor | ~2× tiny | Local/Python |
| RAM no Chrome (heap) | Baixa | Alta (~9×) | N/A (app desktop) |
| Tempo 60 s Chrome | ~13 s | ~22 s | ~1,7 s (Node FW, clip curto*) |
| Viabilidade PC comum | Alta | Média | Alta (fluxo atual) |

\*FW não foi re-medido nos 60 s TTS neste script; referência de qualidade é o clip de 23,5 s.

---

## 6. Recomendação

**Opção 3 — Manter o navegador apenas para transcrições rápidas/privadas e preservar o Faster Whisper para maior precisão.**

Motivos objetivos:

1. Mesmo o melhor candidato browser testado (**base q8**, WER 14,9%) fica **~7× pior** que o Faster Whisper base (2,1%) no mesmo áudio/critério.
2. base q8 custa ~2× download e ~1,7× tempo (60 s Chrome) e ~9× heap JS vs tiny.
3. tiny q4 melhora pouco o WER e **piora** o tamanho do pacote — não recomenda-se.
4. Não há evidência, neste conjunto, de que um modelo browser atinja paridade aceitável com o motor Python atual.

**Não** recomendar agora: (1) trocar o default do protótipo por base, (2) níveis de qualidade na UI principal, (4) “não integrar nada” absoluto — o protótipo tiny+chunking já é útil para demos curtas e privacidade verificável, desde que a expectativa de precisão seja explícita.

Próximo passo possível (fora desta etapa): se no futuro houver WebGPU estável em desktop real, reavaliar **só** `base` q8 como opção avançada no `/browser-prototype/`, mantendo Python como caminho de precisão.

### Como reproduzir

```bat
cd static\browser-prototype\benchmark
npm install
python generate_fixtures.py
node run_model_compare.mjs
node run_browser_model_compare.mjs
..\..\..\.venv\Scripts\python.exe compare_fw_same_wer.py
```
