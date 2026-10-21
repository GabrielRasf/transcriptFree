# API Whisper para hospedagem persistente (Railway, Render, Fly, VPS).
# NÃO use esta imagem na Vercel — serverless não comporta o modelo.

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY constants.py render_frontend.py app.py run_public.py ./
COPY static ./static

ENV HOST=0.0.0.0
ENV PORT=8000
# Ajuste no painel do host: origem da UI na Vercel
# ENV CORS_ORIGINS=https://seu-projeto.vercel.app
# ENV MAX_UPLOAD_MB=25

EXPOSE 8000

CMD ["python", "run_public.py"]
