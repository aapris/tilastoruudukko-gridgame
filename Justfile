# Development commands for the grid game project

# Start the development server
dev:
    uv run python gridgame/manage.py runserver

# Run database migrations
migrate:
    uv run python gridgame/manage.py migrate

# Create new migrations
makemigrations:
    uv run python gridgame/manage.py makemigrations

# Import areas from a GeoJSON file (e.g. just import-areas data/raw/areas.geojson nimi_fi)
import-areas file name_property:
    uv run python gridgame/manage.py import_areas --file {{ file }} --name-property {{ name_property }}

# Lint and format check
lint:
    uv run ruff check gridgame/
    uv run ruff format --check gridgame/

# Auto-fix lint and format issues
fix:
    uv run ruff check --fix gridgame/
    uv run ruff format gridgame/

# Run tests
test:
    uv run pytest

# Django shell
shell:
    uv run python gridgame/manage.py shell

# --- Docker commands ---

# Build and start all containers
docker-local-up:
    docker compose -f docker-compose.local.yml up --build

docker-up:
    docker compose up --build

# Start containers in background
docker-up-d:
    docker compose up --build -d

# Stop containers
docker-down:
    docker compose down

# Run migrations in Docker
docker-migrate:
    docker compose exec web uv run python gridgame/manage.py migrate

# Create migrations in Docker
docker-makemigrations:
    docker compose exec web uv run python gridgame/manage.py makemigrations

# Import areas from a GeoJSON file in Docker
docker-import-areas file name_property:
    docker compose exec web uv run python gridgame/manage.py import_areas --file {{ file }} --name-property {{ name_property }}

# Django shell in Docker
docker-shell:
    docker compose exec web uv run python gridgame/manage.py shell

# Run any manage.py command in Docker (e.g. just docker-manage createsuperuser)
docker-manage *ARGS:
    docker compose exec web uv run python gridgame/manage.py {{ ARGS }}
