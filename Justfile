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

# Load all grid data (5km, 1km, 250m)
load-grid-all:
    uv run python gridgame/manage.py load_grid_data --grid-size 5km --file data/raw/hila5km_linkki.csv --clear
    uv run python gridgame/manage.py load_grid_data --grid-size 1km --file data/raw/hila1km_linkki.csv --clear
    uv run python gridgame/manage.py load_grid_data --grid-size 250m --file data/raw/hila250m_linkki.csv --clear

# Load only 5km grid data (quick, for testing)
load-grid-5km:
    uv run python gridgame/manage.py load_grid_data --grid-size 5km --file data/raw/hila5km_linkki.csv --clear

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
