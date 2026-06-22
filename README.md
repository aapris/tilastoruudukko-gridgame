# Tilastoruudukko

## Tiivistelmä

Tilastoruudukko on paikkatietopohjainen mobiiliselainpeli, jossa pelaaja käy fyysisesti
mahdollisimman monessa Tilastokeskuksen tilastoruudussa (250 m / 1 km / 5 km) valitulla
pelialueella. Sijainti todennetaan GPS:llä ja ruudussa on viivyttävä vähimmäisajan ennen
kuin käynti rekisteröidään. Peli toimii kokonaan mobiiliselaimessa (PWA-valmis) eikä vaadi
erillistä natiivisovellusta.

Järjestelmä koostuu Django-pohjaisesta palvelimesta (GeoDjango + PostGIS) ja
yksisivuisesta JavaScript-käyttöliittymästä (Leaflet + Turf.js). Pelinjohtaja voi luoda
pelialueita karttaeditorilla, ja pelaajat liittyvät peleihin mobiililaitteella.

---

## Overview

A pervasive mobile web game where the player physically visits as many Finnish statistical
grid cells (Tilastokeskus 250 m / 1 km / 5 km) as possible within a chosen area. Location
is verified via GPS with a configurable minimum dwell time. The game runs entirely in a
mobile browser — no native app required.

## Tech Stack

| Layer    | Technology                                  |
|----------|---------------------------------------------|
| Backend  | Django 5.x + GeoDjango + Django REST Framework |
| Database | PostgreSQL + PostGIS                        |
| Frontend | Vanilla JS + Leaflet.js + Turf.js           |
| Server   | Gunicorn + WhiteNoise (static files)        |

## Project Structure

```
tilastoruudukko/
├── gridgame/
│   ├── config/          # Django settings, urls, wsgi
│   ├── game/            # Main app (models, views, serializers, services)
│   ├── templates/       # HTML shells (index.html, login.html, editor)
│   └── static/          # JS, CSS, vendor libs
├── data/raw/            # GeoJSON area files (not in git)
├── docker-compose.yml   # Production Docker setup
├── docker-compose.local.yml  # Local Docker setup
├── Justfile             # Development task runner
└── pyproject.toml       # Project metadata and dependencies
```

## Prerequisites

- Python 3.13+
- PostgreSQL with PostGIS extension
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [just](https://github.com/casey/just) (task runner)
- GeoJSON files for game area boundaries (placed in `data/raw/`)

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd tilastoruudukko
```

### 2. Install dependencies

```bash
uv sync
```

### 3. Set up the database

Create a PostGIS-enabled database:

```sql
CREATE DATABASE tilastoruudukko;
\c tilastoruudukko
CREATE EXTENSION postgis;
```

### 4. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your database credentials and settings
```

Required variables:

| Variable              | Description                        | Default                    |
|-----------------------|------------------------------------|----------------------------|
| `DB_NAME`             | Database name                      | `tilastoruudukko`          |
| `DB_USER`             | Database user                      | `gridgame`                 |
| `DB_PASSWORD`         | Database password                  | `gridgame`                 |
| `DB_HOST`             | Database host                      | `localhost`                |
| `DB_PORT`             | Database port                      | `5432`                     |
| `DJANGO_SECRET_KEY`   | Django secret key                  | dev default (change in prod) |
| `DJANGO_DEBUG`        | Debug mode                         | `True`                     |
| `DJANGO_ALLOWED_HOSTS`| Comma-separated allowed hosts      | `localhost,127.0.0.1`      |

### 5. Run migrations

```bash
just migrate
```

### 6. Create a superuser

```bash
uv run python gridgame/manage.py createsuperuser
```

### 7. Import game areas

Grid cells (both Tilastokeskus statistical grids and H3 hexagons) are computed
on the fly — no grid data needs to be loaded into the database. However, game
boards are based on geographic **areas** that must be imported from GeoJSON files.

Import areas from a GeoJSON file:

```bash
just import-areas data/raw/areas.geojson nimi_fi
```

The second argument (`nimi_fi`) is the GeoJSON feature property name used as the
Area name in the database. Each feature in the file must have this property.

### 8. Start the development server

```bash
just dev
```

The app is now available at `http://localhost:8000/`.

## Key Commands

| Command                | Description                              |
|------------------------|------------------------------------------|
| `just dev`             | Start the development server             |
| `just migrate`         | Run database migrations                  |
| `just makemigrations`  | Create new migrations                    |
| `just import-areas <file> <prop>` | Import areas from GeoJSON     |
| `just lint`            | Run linter and format checks             |
| `just fix`             | Auto-fix lint and formatting issues      |
| `just test`            | Run test suite                           |
| `just shell`           | Open Django shell                        |
| `just collectstatic`   | Collect & content-hash static files      |

### Docker

| Command                | Description                              |
|------------------------|------------------------------------------|
| `just docker-up`       | Build and start containers               |
| `just docker-up-d`     | Start containers in background           |
| `just docker-down`     | Stop containers                          |
| `just docker-migrate`  | Run migrations in Docker                 |
| `just docker-collectstatic` | Collect & hash static files in Docker |
| `just docker-manage createsuperuser` | Run manage.py commands in Docker |

## Static files & cache busting

Browsers (especially mobile) cache JS/CSS aggressively. This project busts the
cache **at the application level** using content-hashed filenames — no per-deploy
nginx changes are needed.

How it works:

1. **Hashed filenames.** `STORAGES["staticfiles"]` uses
   `config.storage.SkipVendorManifestStorage` (a WhiteNoise
   `CompressedManifestStaticFilesStorage` subclass). `collectstatic` rewrites
   `js/app.js` → `js/app.<hash>.js`; the hash changes only when the file content
   changes. Vendored libraries under `static/vendor/` are intentionally **not**
   hashed (they reference missing source maps) — version them by changing their
   path/filename when you upgrade.
2. **Templates use `{% static %}`**, so the rendered HTML always points at the
   current hashed URL.
3. **The HTML shell is never cached.** The `index_view` is decorated with
   `@never_cache`, so every load fetches fresh HTML and therefore the newest
   hashed asset URLs. Changed files get a new URL (fetched immediately); unchanged
   files keep their URL (served from cache).

**Required on every deploy:** run `collectstatic` so the hashes are regenerated,
and make sure the directory nginx serves at `/static/` is that `collectstatic`
output (`STATIC_ROOT`). The Dockerfile runs `collectstatic` at build time; if you
bind-mount the source over `/app` (see `docker-compose.yml`) that build-time output
is shadowed, so run `just docker-collectstatic` after start, or serve
`STATIC_ROOT` directly. Set `DJANGO_DEBUG=False` in production.

> With hashed filenames the existing nginx rule
> (`expires 30d; Cache-Control "public, immutable"`) is correct and desirable: a
> new deploy changes the filename, so clients fetch the new file even though the
> old one is cached "forever". No nginx change is required for cache busting — keep
> the immutable header, just ensure `/static/` points at fresh `collectstatic`
> output.

## API

All API endpoints are under `/api/v1/`. Key endpoints:

| Method | Endpoint                          | Description            |
|--------|-----------------------------------|------------------------|
| GET    | `/api/v1/boards/`                 | List game boards       |
| POST   | `/api/v1/games/`                  | Create a new game      |
| GET    | `/api/v1/games/list/`             | List player's games    |
| GET    | `/api/v1/games/{id}/`             | Get game state         |
| POST   | `/api/v1/games/{id}/visits/`      | Record a cell visit    |
| POST   | `/api/v1/games/{id}/finish/`      | Finish a game          |

## License

Private — all rights reserved.
