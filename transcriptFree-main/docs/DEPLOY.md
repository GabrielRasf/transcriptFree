# Deploy público (Vercel + API Whisper)

## Diagnóstico

| Parte | Tecnologia | Pode ir na Vercel? |
|---|---|---|
| Interface | HTML/CSS/JS estático | **Sim** |
| API + Whisper (`faster-whisper`) | FastAPI + modelo ~150 MB + CPU | **Não** |

A Vercel usa funções serverless com tempo e memória limitados. O Whisper `base` em CPU demora segundos a minutos, carrega um modelo grande e precisa de processo persistente. Por isso:

1. **Vercel** publica só a interface (`public/` gerado por `scripts/prepare_vercel.py`).
2. **Railway, Render, Fly.io ou VPS** (ou Docker) roda `run_public.py` com o modelo.

O uso local (`python run.py` / `.exe`) continua em `127.0.0.1` e não depende da Vercel.

## Variáveis

Veja `.env.example`. Nenhuma chave secreta é necessária para o Whisper local; o modelo vem do Hugging Face na primeira execução da API.

| Variável | Onde | Função |
|---|---|---|
| `TRANSCRIPTOR_API_URL` | Build da Vercel | URL da API (ex.: `https://….railway.app`) |
| `CORS_ORIGINS` | API | Origem da UI Vercel (ex.: `https://….vercel.app`) |
| `MAX_UPLOAD_MB` | API (e opcionalmente build Vercel) | Teto de upload; use o mesmo valor nos dois lados |
| `HOST` / `PORT` | API | Padrão `0.0.0.0` e `8000` (muitos hosts injetam `PORT`) |

## Passo a passo

### 1. Publicar a API (obrigatório para transcrição na web)

Exemplo com Docker:

```bash
docker build -t transcriptor-api .
docker run --rm -p 8000:8000 \
  -e CORS_ORIGINS=https://SEU-PROJETO.vercel.app \
  -e MAX_UPLOAD_MB=25 \
  transcriptor-api
```

No painel do host (Railway/Render/Fly):

- Build: Dockerfile deste repositório, ou `pip install -r requirements.txt` + `python run_public.py`
- Healthcheck: `GET /health`
- Disco/CPU: a primeira requisição baixa o modelo (~150 MB); áudios longos precisam de timeout alto no proxy
- Defina `CORS_ORIGINS` com a URL final da Vercel (pode atualizar depois do primeiro deploy da UI)

Anote a URL pública da API (ex.: `https://transcriptor-api.example.com`).

### 2. Publicar a UI na Vercel

O código da aplicação fica em `transcriptFree-main/` dentro do repositório. O build da Vercel **não** executa FastAPI nem Faster Whisper: só gera HTML estático em `public/`.

**Opção A (recomendada se Root Directory estiver vazio):** use o `vercel.json` na **raiz do repositório**. Ele já aponta para:

- Build: `python transcriptFree-main/scripts/prepare_vercel.py`
- Output: `transcriptFree-main/public`

**Opção B:** no painel da Vercel, defina Root Directory = `transcriptFree-main`. Nesse caso vale o `transcriptFree-main/vercel.json` (`python scripts/prepare_vercel.py` → `public/`).

Passos:

1. Importe o repositório no [Vercel](https://vercel.com).
2. Confirme que `scripts/prepare_vercel.py`, `constants.py`, `render_frontend.py` e `static/index.html` estão no GitHub (sem isso o build falha com “No such file”).
3. Framework Preset: Other.
4. Não sobrescreva o Build Command no painel com `python scripts/prepare_vercel.py` se a Root Directory estiver vazia — isso procura o script na raiz e falha. Deixe o `vercel.json` da raiz ou use a Opção B.
5. Environment Variables (Build):
   - `TRANSCRIPTOR_API_URL` = URL da API do passo 1 (sem `/` final)
   - `MAX_UPLOAD_MB` = mesmo valor da API (ex.: `25`), se quiser alinhar o aviso na UI
6. Deploy.

### 3. Alinhar CORS

Se a URL da Vercel só ficou conhecida após o deploy, atualize `CORS_ORIGINS` na API e reinicie o serviço:

```text
CORS_ORIGINS=https://seu-projeto.vercel.app
```

### 4. Verificar

1. Abra a URL `*.vercel.app`.
2. A interface deve ser a mesma do app local.
3. Envie um áudio curto.
4. Confirme texto com timestamps e download TXT.
5. Se falhar por rede/CORS, veja o Network do navegador e os logs da API.

## Modos na home e protótipo

`scripts/prepare_vercel.py` gera `public/index.html` e copia `static/browser-prototype/`.

| Situação | Default na home | Notas |
|---|---|---|
| Sem `TRANSCRIPTOR_API_URL` | **Navegador** (Whisper tiny) | Precisão inferior; aviso na UI. Laboratório em `/browser-prototype/`. |
| Com `TRANSCRIPTOR_API_URL` | **Python/API** (recomendado) | Modo navegador continua selecionável. |

- Home e `/browser-prototype/` **não exigem** API para o modo navegador.
- Pesos: Hub na 1ª execução (~40–50 MB q8); ver `static/browser-prototype/models/README.md`.
- Privacidade: `static/browser-prototype/PRIVACY.md` (áudio local; JS/pesos podem vir de jsDelivr/Hub).

## O que a Vercel sozinha NÃO faz

- Não executa `faster-whisper`.
- Não substitui o `.exe` Windows.
- Não deve receber rewrite de `/transcribe` para uma função serverless com o modelo: timeout e memória impedem uso real.
- Não hospeda automaticamente os pesos ONNX do Whisper tiny no deploy estático (decisão explícita; ver README do protótipo).

O `vercel.json` **não** usa rewrite SPA `/(.*)` → `/index.html`. Esse catch-all fazia pedidos inexistentes (ex.: `/models/.../config.json`) devolverem HTML 200 e quebrava o carregamento do modelo no navegador.

## Segurança em API pública

Expor Whisper na internet permite abuso de CPU. Recomendações:

- Limite `MAX_UPLOAD_MB` (ex.: 25).
- Use host com autosuspend/quota.
- Considere autenticação ou rate limit em etapa futura (ainda não incluso neste projeto).
- Mantenha o modo local (`run.py`) para privacidade total do áudio.

## URL pública

A URL final é a atribuída pela Vercel (ou domínio customizado que você configurar no painel). Este repositório não define um domínio fixo.
