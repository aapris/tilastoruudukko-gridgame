# CLAUDE.md — Pervasive Grid Game: Project Specification

## Overview

A pervasive mobile web game where the player physically visits as many grid cells
as possible within a chosen area. Supports both Tilastokeskus statistical grids
(250m/1km/5km) and H3 hexagonal grids (resolutions 6–10). Location is verified via GPS.
The game runs entirely in a mobile web browser (PWA-ready, no native app).

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5.x + GeoDjango + Django REST Framework |
| Database | PostgreSQL + PostGIS |
| Frontend | Vanilla JS + Leaflet.js + Turf.js |
| Templates | Django templates (only for initial HTML shell) |

**No JS framework** (React, Vue, etc.) — the frontend is a single-page app built with plain JS.
Django serves one `index.html` shell; all subsequent interaction is via JSON API.

All javascript, css and other assets are served from Django static files, not from CDN.

---

## Grid System — Virtual Grid Providers

Grid cells are **not stored in the database**. They are computed on the fly by grid
providers defined in `game/grid_providers.py`.

### Statistical Grid (Tilastokeskus)

`StatisticalGridProvider` generates rectangular grid cells aligned to EPSG:3067 coordinates.
Cell identifiers encode the bottom-left corner: `{size}N{northing}E{easting}`,
e.g. `"250mN667675E38875"`.

Given a polygon (play area), the provider:
1. Transforms the polygon to EPSG:3067
2. Iterates over grid-aligned coordinates within the bounding box
3. Includes any cell that intersects the polygon
4. Returns GeoJSON in EPSG:4326

### H3 Hexagonal Grid

`H3GridProvider` uses the `h3` library to compute hexagonal cells.
Cell identifiers are standard H3 cell indexes.

### Provider API

```python
from game.grid_providers import get_grid_provider

provider = get_grid_provider("stat_1km")  # or "h3_res9", etc.
geojson, count = provider.get_cells_in_polygon(polygon_4326)
is_valid = provider.validate_cell_in_polygon(polygon_4326, cell_id)
feature = provider.cell_id_to_geojson_feature(cell_id)
```

Grid types: `stat_250m`, `stat_1km`, `stat_5km`, `h3_res6`–`h3_res10`.

---

## Game Area Data

Game boards are based on geographic **Areas** imported from GeoJSON files.
No grid data needs to be loaded — only area boundaries.

Import command:
```bash
uv run python gridgame/manage.py import_areas --file <geojson_path> --name-property <prop>
```

The `--name-property` argument specifies which GeoJSON feature property to use as the
Area name in the database (e.g. `nimi_fi` for Finnish place names).

---

## Django Project Structure

```
gridgame/
├── manage.py
├── config/
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── game/
│   ├── models.py           # User, Area, Board, BoardCell, Game, Visit, CellReport
│   ├── grid_providers.py   # StatisticalGridProvider, H3GridProvider
│   ├── serializers.py
│   ├── views.py            # Game API views
│   ├── urls.py             # Game API URL routing
│   ├── auth_views.py       # Authentication endpoints
│   ├── editor_views.py     # Board editor views
│   ├── editor_serializers.py
│   ├── editor_urls.py
│   ├── services.py         # Reserved for future scoring logic
│   └── management/commands/
│       └── import_areas.py
├── templates/
│   ├── index.html          # Main SPA shell
│   ├── login.html
│   └── editor/
│       └── editor.html
└── static/
    ├── js/
    │   ├── app.js           # Entry point, game state machine
    │   ├── map.js           # Leaflet setup, layer management
    │   ├── gps.js           # Geolocation API, dwell timer
    │   ├── api.js           # Fetch wrappers for all endpoints
    │   ├── grid.js          # Turf.js point-in-polygon, cell detection
    │   └── editor/          # Board editor JS
    ├── css/
    │   └── style.css
    └── vendor/              # Leaflet, Turf.js (served locally)
```

---

## Data Models

### Core Models

- **User** — Custom user model extending `AbstractUser`
- **Area** — Geographic area imported from GeoJSON (polygon in EPSG:4326)
- **Board** — Predefined game board linking an Area to a grid type
- **BoardCell** — Individual cell in a board (enabled/disabled toggle for editor)
- **Game** — A single game session (UUID PK, player token, board or center+radius)
- **Visit** — A recorded cell visit (unique per game+cell_id, upsert pattern)
- **CellReport** — Player report that a cell is inaccessible

### Key Fields

- `Game.grid_type` — One of: `stat_250m`, `stat_1km`, `stat_5km`, `h3_res6`–`h3_res10`
- `Game.play_area` — Polygon in EPSG:4326 (from board area or center+radius buffer)
- `Game.snapshot_cell_ids` — JSON list of enabled cell IDs (for published boards)
- `Game.player_token` — UUID identifying anonymous players
- `Game.user` — Optional FK to authenticated user

---

## API Endpoints

Base URL: `/api/v1/`

### Game Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/boards/` | List active game boards |
| POST | `/api/v1/games/` | Create a new game |
| GET | `/api/v1/games/list/` | List player's games |
| GET | `/api/v1/games/{id}/` | Get game state (`?include_grid=true` for grid) |
| POST | `/api/v1/games/{id}/visits/` | Record a cell visit |
| POST | `/api/v1/games/{id}/finish/` | Finish a game |
| DELETE | `/api/v1/games/{id}/delete/` | Delete a game |

### Cell Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/cells/report/` | Report a cell as inaccessible |
| GET | `/api/v1/cells/{id}/reports/` | Get reports for a cell |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/auth/status/` | Check auth status |
| POST | `/api/v1/auth/register/` | Register new user |
| POST | `/api/v1/auth/login/` | Login |
| POST | `/api/v1/auth/logout/` | Logout |
| POST | `/api/v1/auth/claim/` | Claim anonymous games for user |

### Board Editor (separate URL namespace)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/editor/api/boards/` | List boards for editor |
| GET | `/editor/api/boards/{id}/` | Get board detail |
| POST | `/editor/api/boards/{id}/generate/` | Generate cells for board |
| GET | `/editor/api/boards/{id}/cells/` | Get board cells |
| PATCH | `/editor/api/boards/{id}/cells/toggle/` | Toggle cells |
| POST | `/editor/api/boards/{id}/publish/` | Publish board |

---

## Frontend Architecture

### State Machine (app.js)

Screens: **setup** (lobby) → **game** (active play) → **result** (finish)

### GPS Logic (gps.js)

```javascript
navigator.geolocation.watchPosition(onPositionUpdate, onError, {
  enableHighAccuracy: true,
  maximumAge: 2000,
  timeout: 5000,
});
```

On each position update:
1. Turf.js `booleanPointInPolygon` detects current cell (O(n) scan)
2. If cell changed, start `min_dwell_s` timer
3. On timer completion, POST visit to backend

### Cell Detection (grid.js)

Uses Turf.js point-in-polygon against the locally cached GeoJSON grid.
The grid is fetched once at game creation and not re-fetched during play.

---

## Key Technical Details

**Coordinate systems:**
Statistical grid cells use EPSG:3067 internally. All API responses and frontend
data use EPSG:4326 (WGS84). Transformations happen in the grid providers.

**GPS accuracy:**
5–20m typical. The `min_dwell_s` timer (default 10s) acts as a debounce for
spurious border crossings between adjacent cells.

**GeoJSON payload size:**
Grid GeoJSON is returned once at game creation. For large boards this can be
500–800 KB uncompressed. Gzip compression is enabled.

**Player identification:**
Anonymous players are identified by a UUID `player_token` stored in localStorage.
Authenticated users can claim anonymous games via `/api/v1/auth/claim/`.

---

## Notes for the Coding Agent

- Grid cells are virtual — never query the database for grid geometries
- Use `get_grid_provider(grid_type)` to get the correct provider
- `Game.center` is `PointField(srid=4326)` — store as `Point(lon, lat, srid=4326)`
- Use `update_or_create(game=game, cell_id=cell_id, defaults={...})` for Visit upserts
- All timestamps are UTC (`USE_TZ = True`)
- Static files served with WhiteNoise
- Turf.js and Leaflet served from `static/vendor/`, not from CDN
- API base URL is `/api/v1/`
- Board editor is under `/editor/` with its own URL namespace
