# Tilastoruudukko (grid game) — task runner. Run `just` to list the recipes.
#
# Shared conventions across our projects (see the "Task Runner (Justfile)" section of the
# global development guidelines):
#   just              lists recipes; never has side effects
#   just dev          starts the app locally
#   just up           starts the docker compose stack
#   just manage ...   escape hatch to manage.py
#
# Recipe names are lowercase kebab-case; anything outside the shared core set is named
# <area>-<verb> (docker-local-up, import-areas). A thin `manage.py` wrapper only earns its
# own recipe if it does more than pass arguments through, is a dependency of another recipe,
# hides *where* it runs, or normalizes a project-specific difference — otherwise use
# `just manage <command>`.

# Recipe arguments reach the shell as real positional parameters, so a recipe passes them on
# with "$@" rather than interpolating {{ args }}. Interpolation pastes them into the command
# line as bare text for the shell to re-parse, which mangles anything that needed its quotes:
# `--config '{"host":"x","port":993}'` arrives unquoted, brace expansion splits it at the
# comma, and the command sees two broken arguments.
set positional-arguments := true

# The project-local knobs. Everything below them is identical across projects.
# This project has no src/ layout: the Django project lives in gridgame/, so lint_paths is
# "." to cover it and anything that lands beside it.
manage := "uv run python gridgame/manage.py"
compose := "docker compose"
compose_local := "docker compose -f docker-compose.local.yml"
lint_paths := "."

[private]
default:
    @just --list --unsorted

# --- setup -------------------------------------------------------------------

# Install/sync the Python virtual environment.
[group('setup')]
install:
    uv sync

# One-time developer setup for a fresh clone: dependencies + git hooks.
[doc('One-time developer setup: dependencies + git hooks.')]
[group('setup')]
setup: install
    uvx prek install

# `hooks` runs the hooks; installing them is `setup`'s job. prek is a drop-in runner for the
# standard .pre-commit-config.yaml, and `uvx` keeps it out of the project's dependencies.
[doc('Run all git hooks against all files.')]
[group('setup')]
hooks *args:
    uvx prek run --all-files "$@"

# --- dev ---------------------------------------------------------------------

# Pass runserver arguments through, e.g. `just dev 0.0.0.0:8001`.
[doc('Start the app: the Django development server.')]
[group('dev')]
dev *args:
    {{ manage }} runserver "$@"

# --- django ------------------------------------------------------------------

# Run any management command, e.g. `just manage createsuperuser`.
[group('django')]
manage *args:
    {{ manage }} "$@"

# Apply database migrations.
[group('django')]
migrate *args:
    {{ manage }} migrate "$@"

# Open a Django shell.
[group('django')]
shell *args:
    {{ manage }} shell "$@"

# --- quality -----------------------------------------------------------------

# Run the test suite.
[group('quality')]
test *args:
    uv run pytest "$@"

# What is measured lives in pyproject.toml under [tool.coverage.run].
[doc('Run the test suite with a coverage report.')]
[group('quality')]
cov *args:
    uv run pytest --cov --cov-report=term-missing "$@"

# Lint and format-check (no changes written).
[group('quality')]
lint:
    uv run ruff check {{ lint_paths }}
    uv run ruff format --check {{ lint_paths }}

# Auto-fix lint issues and format the code.
[group('quality')]
fmt:
    uv run ruff check --fix {{ lint_paths }}
    uv run ruff format {{ lint_paths }}

# Django system checks + a guard against model changes with no migration.
[group('quality')]
check:
    {{ manage }} check
    {{ manage }} makemigrations --check --dry-run

# The local pre-push gate. NOTE: this project has no tests yet, so pytest exits 5 ("no tests
# ran") and the gate stops here. Write the first test and it starts passing.
[doc('The local pre-push gate: lint + check + test.')]
[group('quality')]
ci: lint check test

# --- docker ------------------------------------------------------------------

# Start the stack, building images as needed.
[group('docker')]
up *args:
    {{ compose }} up --build "$@"

# Start the stack in the background.
[group('docker')]
up-d:
    {{ compose }} up --build -d

# Stop the stack and remove containers.
[group('docker')]
down *args:
    {{ compose }} down "$@"

# Tail service logs.
[group('docker')]
logs *args:
    {{ compose }} logs -f "$@"

# Open a shell inside a running container (default: web).
[group('docker')]
sh service="web":
    {{ compose }} exec {{ service }} bash

# Run a management command inside the web container, e.g. `just docker-manage migrate` or
# `just docker-manage collectstatic --noinput`.
[doc('Run a management command inside the web container.')]
[group('docker')]
docker-manage *args:
    {{ compose }} exec web uv run python gridgame/manage.py "$@"

# The local override stack (docker-compose.local.yml) rather than the default one.
[doc('Start the local override stack, building images as needed.')]
[group('docker')]
docker-local-up *args:
    {{ compose_local }} up --build "$@"

# --- project -----------------------------------------------------------------

# Arguments go straight to the management command, so any of its flags work:
# `just import-areas --file data/raw/areas.geojson --name-property nimi_fi`.
[doc('Import areas from a GeoJSON file.')]
[group('project')]
import-areas *args:
    {{ manage }} import_areas "$@"

# --- transitional aliases (drop once the new names have stuck) ---------------
# `makemigrations`, `collectstatic` and their docker twins lost their own recipes on purpose:
# a pure rename of a management command is not worth one. Use `just manage collectstatic
# --noinput` and `just docker-manage makemigrations` instead.
alias fix := fmt
alias docker-up := up
alias docker-up-d := up-d
alias docker-down := down
