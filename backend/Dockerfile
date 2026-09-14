FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/mirra
# CPU wheels keep the image free of CUDA runtimes. uv.lock pins the remaining dependencies.
RUN pip install uv==0.11.3
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project --no-hashes --no-emit-package torch --no-emit-package torchaudio \
    | sed '/^nvidia-/d; /^triton==/d' > /tmp/requirements.txt \
    && pip install torch==2.12.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r /tmp/requirements.txt
RUN python -c "from silero_vad import load_silero_vad; load_silero_vad()"
COPY app ./app
RUN useradd --create-home --uid 10001 mirra && chown -R mirra:mirra /srv/mirra
USER mirra
EXPOSE 8000
# One worker protects the stateful VAD model and the launch request limits.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "16", "--timeout-keep-alive", "5", "--no-access-log"]
