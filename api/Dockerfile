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
RUN uv sync --frozen --no-install-project --group dev

COPY api ./
COPY alembic ../alembic
COPY alembic.ini ../alembic.ini

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "index:app", "--host", "0.0.0.0", "--port", "8000"]
