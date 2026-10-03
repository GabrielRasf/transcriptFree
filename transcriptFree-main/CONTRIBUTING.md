# Guia de contribuição

Obrigado por ajudar o Transcriptor a continuar grátis e open source.

## Como contribuir

1. Abra uma [Issue](../../issues) descrevendo o bug ou a ideia
2. Faça um fork e uma branch (`feat/nome` ou `fix/nome`)
3. Mantenha o escopo pequeno e o código simples
4. Abra um Pull Request explicando o *porquê* da mudança

## Ambiente local

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux / macOS
pip install -r requirements.txt
python run.py
```

Testes (não executam o Whisper):

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Para gerar o `.exe` (Windows), com o `.venv` já criado:

```bat
build.bat
```

O script termina sozinho e imprime o caminho de `dist\Transcriptor.zip`.

## Boas práticas

- Prefira mudanças pequenas e revisáveis
- Não commite `.venv/`, `dist/`, `build/` nem modelos Whisper
- Não inclua áudios de exemplo com conteúdo sensível
- UI: mantenha o fluxo simples — upload → transcrever → download
- Documente no README se a mudança alterar o uso

## Ideias bem-vindas

- Export SRT/VTT
- Seleção de modelo Whisper
- Melhorias de acessibilidade na interface
- Builds para Linux/macOS
- Tradução do README / UI

## Código de conduta

Participação neste projeto segue o [Código de Conduta](CODE_OF_CONDUCT.md).
