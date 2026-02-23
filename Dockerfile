FROM python:3.13-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv

# GeoDjango runtime dependencies (gdal-bin pulls in libgeos, libproj)
RUN apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install Python dependencies (cached layer unless pyproject.toml/uv.lock change)
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project

# Copy application code
COPY gridgame/ gridgame/

# Collect static files at build time (production)
RUN DJANGO_SECRET_KEY=build-placeholder \
    uv run python gridgame/manage.py collectstatic --noinput

EXPOSE 8000

CMD ["uv", "run", "gunicorn", "--chdir", "gridgame", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
