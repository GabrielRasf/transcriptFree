# Modelos locais (opcional)

Por padrão o protótipo baixa `Xenova/whisper-tiny` (dtype `q8` / arquivos `*_quantized.onnx`) do Hugging Face Hub.

## Por que não baixamos no `prepare_vercel.py`

Tamanhos aproximados dos arquivos ONNX usados em `q8` (API do Hub, março/2026 da consulta local):

| Arquivo | ~Tamanho |
|---|---|
| `onnx/encoder_model_quantized.onnx` | ~10 MB |
| `onnx/decoder_model_merged_quantized.onnx` | ~31 MB |
| + tokenizer / configs | poucos MB |
| **Total ordem** | **~40–50 MB** |

Empacotar isso no Git ou baixar silenciosamente no build da Vercel aumenta o artefato e o tempo de deploy. Por isso o protótipo **não** faz download automático no build.

## Como espelhar na Vercel (hospedagem própria dos pesos)

1. Baixe manualmente do repositório [Xenova/whisper-tiny](https://huggingface.co/Xenova/whisper-tiny) a estrutura completa necessária (configs + `onnx/*_quantized.onnx` ou o conjunto que o dtype exigir).
2. Coloque em:

```text
static/browser-prototype/models/Xenova/whisper-tiny/
  config.json
  tokenizer.json
  …
  onnx/
    encoder_model_quantized.onnx
    decoder_model_merged_quantized.onnx
    …
```

3. Ajuste o Worker para `env.localModelPath` apontando para a base `/browser-prototype/models/` (ou `/static/browser-prototype/models/` no `run.py`) e `allowRemoteModels: false`.
4. Confirme o tamanho total do deploy frente aos limites da Vercel.
5. **Não** commite pesos grandes sem acordo explícito da equipe (adicione exceções no `.gitignore` se necessário).

Até isso ser feito, a dependência do Hub para **pesos** permanece documentada; o áudio do usuário não sobe para o Hub.
