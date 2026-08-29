FROM python:3.14-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_LINK_MODE=copy

WORKDIR /app/api

RUN pip install --no-cache-dir uv

FROM base AS dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "index:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS runner

COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-install-project --group dev \
    && groupadd --system cipheria \
    && useradd --system --gid cipheria --create-home cipheria

COPY --chown=cipheria:cipheria api ./
COPY --chown=cipheria:cipheria alembic ../alembic
COPY --chown=cipheria:cipheria alembic.ini ../alembic.ini
RUN chown -R cipheria:cipheria /app/api

USER cipheria

EXPOSE 8000

CMD [".venv/bin/uvicorn", "index:app", "--host", "0.0.0.0", "--port", "8000"]
