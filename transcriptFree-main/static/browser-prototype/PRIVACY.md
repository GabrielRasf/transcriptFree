# Privacidade — protótipo no navegador

## O que deve acontecer

No modo experimental (`/browser-prototype/` no `run.py` local e na Vercel):

1. O arquivo de áudio é lido só com a API `File` / `arrayBuffer` no navegador.
2. A inferência roda no Web Worker via Transformers.js.
3. **Não** existe `fetch`/`XHR` do áudio para `/transcribe` nem para qualquer API de STT.
4. Áudio e texto **não** são gravados em `IndexedDB`, `localStorage` nem cookies pela aplicação.

## Como validar no DevTools (Network)

1. Abra o protótipo.
2. DevTools → **Network** → limpe a lista → marque **Preserve log**.
3. Selecione um MP3 e clique em **Transcrever no navegador**.
4. Filtre por tipo ou procure pelo nome do seu arquivo.

### Requisições esperadas (não são o áudio do usuário)

| Destino | Motivo |
|---|---|
| Página HTML/JS/CSS do protótipo | Carregar a UI |
| `cdn.jsdelivr.net/npm/@huggingface/transformers@…` | Biblioteca JS |
| Arquivos WASM do ONNX Runtime (CDN da lib) | Runtime de inferência |
| `huggingface.co` / CDN do Hub (`Xenova/whisper-tiny`, `*.onnx`, tokenizer) | **Pesos do modelo** na 1ª execução (ou a cada cache miss) |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Fontes (já usadas no app) |

No caminho padrão **não** deve aparecer `GET /models/...` no mesmo origin do site (isso indica `allowLocalModels` ligado sem pesos locais; na Vercel costumava devolver `index.html` e falhar o JSON).

Nenhuma dessas requisições deve ter o **corpo** igual ao seu MP3.

### O que NÃO deve aparecer

- `POST …/transcribe` com `multipart` do seu arquivo.
- Upload do MP3 para `huggingface.co`, Railway, etc.
- Requests cujo payload size ≈ tamanho do seu áudio (exceto se você acidentalmente estiver no fluxo Python da home).

### Storage

Em **Application** → IndexedDB / Local Storage / Cache Storage:

- Pode existir **cache do modelo** (Cache API do Transformers.js) — isso é esperado e **não** é o áudio.
- Não deve haver blob/object store com o conteúdo do MP3 criado por este protótipo.

## Dependência externa documentada

Na configuração padrão deste protótipo, os **pesos** de `Xenova/whisper-tiny` vêm do Hugging Face Hub (não empacotados no Git nem baixados no build da Vercel, para não estourar o deploy sem aviso).

Tamanho medido dos arquivos q8 em cache: **~41,6 MB** (ver `TEST_RESULTS.md`).

Isso **não** é equivalente a hospedagem própria dos pesos. O áudio continua só no navegador.

Para espelhar o modelo nos estáticos da Vercel, veja `models/README.md`.

## Evidência automatizada

Um teste Playwright (Chromium headless) no ambiente de desenvolvimento confirmou conclusão da transcrição com `device: wasm` e **zero** requisições POST com payload de áudio / `/transcribe`. Detalhes em `TEST_RESULTS.md` e `CHUNKING_VALIDATION.md`.

### Chunking

O processamento em janelas (30 s / stride 5 s) ocorre **somente na memória do Worker**. Não há upload do PCM nem gravação em IndexedDB/localStorage.

Requisições esperadas (não são áudio do usuário):

- Página / `app.js` / `whisper-worker.js` / `chunking.js` / `segments.js`
- `cdn.jsdelivr.net` → Transformers.js + WASM ONNX
- Hugging Face Hub → pesos `Xenova/whisper-tiny` (q8)

O harness de benchmark pode fazer `GET` local de arquivos `.f32` de fixture — isso **não** existe no protótipo de produção e não envia áudio a APIs externas.
