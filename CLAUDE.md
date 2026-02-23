# CLAUDE.md — Pervasive Grid Game: Project Specification

## Overview

A pervasive mobile web game where the player physically visits as many statistical grid cells
(Tilastokeskus 250m/1km/5km) as possible within a chosen area. Location is verified via GPS.
The game runs entirely in a mobile web browser (PWA-ready, no native app).

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 6.x + GeoDjango + Django REST Framework |
| Database | PostgreSQL + PostGIS |
| Frontend | Vanilla JS + Leaflet.js + Turf.js |
| Templates | Django templates (only for initial HTML shell) |

**No JS framework** (React, Vue, etc.) — the frontend is a single-page app built with plain JS.
Django serves one `index.html` shell; all subsequent interaction is via JSON API.

All javascript, css and other assets are served from Django static files, not from CDN.

---

## Existing Data

PostGIS database already contains Tilastokeskus statistical grid tables as polygon geometries
in **EPSG:3067**. Verify exact table and column names before use:

```sql
\d grid_250m   -- check column names, especially the cell identifier column
\d grid_1km
\d grid_5km
```

If needed, better table structure can be planned and implemented.

All API responses must transform geometries to **EPSG:4326** (WGS84) for GeoJSON output:
```sql
ST_AsGeoJSON(ST_Transform(geom, 4326))
```

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
│   ├── models.py
│   ├── serializers.py
│   ├── views.py
│   ├── urls.py
│   └── services.py        # grid query logic, scoring
├── templates/
│   └── index.html         # single HTML shell
└── static/
    ├── js/
    │   ├── app.js          # entry point, game state machine
    │   ├── map.js          # Leaflet setup, layer management
    │   ├── gps.js          # Geolocation API, dwell timer
    │   ├── api.js          # fetch wrappers for all endpoints
    │   └── grid.js         # Turf.js point-in-polygon, cell detection
    └── css/
        └── style.css
```

---

## Django Settings (relevant additions)

```python
INSTALLED_APPS = [
    ...
    'django.contrib.gis',
    'rest_framework',
    'game',
]

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': '<dbname>',
        'USER': '<user>',
        ...
    }
}
```

---

## Data Models

```python
# game/models.py
from django.contrib.gis.db import models as gis_models
from django.db import models
import uuid


class Game(models.Model):
    GRID_SIZES = [('250m', '250m'), ('1km', '1km'), ('5km', '5km')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nickname = models.CharField(max_length=64)

    # Play area: center point + radius (stored in 4326 for simplicity)
    center = gis_models.PointField(srid=4326)
    radius_m = models.IntegerField()          # meters, e.g. 5000
    grid_size = models.CharField(max_length=8, choices=GRID_SIZES)

    # Rules
    min_dwell_s = models.IntegerField(default=10)   # seconds required in cell
    time_limit_s = models.IntegerField(null=True, blank=True)  # None = unlimited

    # State
    total_cells = models.IntegerField()       # number of cells in play area
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']


class Visit(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name='visits')
    cell_id = models.CharField(max_length=64)   # identifier from grid table

    entered_at = models.DateTimeField()
    exited_at = models.DateTimeField()
    dwell_s = models.IntegerField()             # computed: (exited_at - entered_at).seconds
    visit_count = models.IntegerField(default=1)  # cumulative visits to this cell in this game

    # Entry point coordinates (for debugging / future routing features)
    entry_point = gis_models.PointField(srid=4326, null=True, blank=True)

    class Meta:
        # One row per cell per game; use upsert pattern on (game, cell_id)
        unique_together = [('game', 'cell_id')]
```

---

## API Endpoints

Base URL: `/api/`

### 1. Create Game

```
POST /api/games/
```

Request body:
```json
{
  "nickname": "Aapo",
  "center_lat": 60.1699,
  "center_lon": 24.9384,
  "radius_m": 5000,
  "grid_size": "250m",
  "min_dwell_s": 10,
  "time_limit_s": null
}
```

Response:
```json
{
  "game_id": "uuid",
  "nickname": "Aapo",
  "total_cells": 1247,
  "min_dwell_s": 10,
  "time_limit_s": null,
  "started_at": "2025-01-01T12:00:00Z",
  "grid": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Polygon", "coordinates": [...] },
        "properties": { "cell_id": "5km_1234_5678" }
      }
    ]
  }
}
```

The `grid` GeoJSON is returned **once** at game creation and cached in the browser
(localStorage or JS variable). It is not re-fetched during the game.

### 2. Get Game State

```
GET /api/games/{game_id}/
```

Response:
```json
{
  "game_id": "uuid",
  "nickname": "Aapo",
  "total_cells": 1247,
  "visited_count": 34,
  "score_pct": 2.7,
  "elapsed_s": 3721,
  "finished_at": null,
  "visits": [
    { "cell_id": "...", "visit_count": 1, "dwell_s": 23 }
  ]
}
```

### 3. Record Cell Visit

```
POST /api/games/{game_id}/visits/
```

Request body:
```json
{
  "cell_id": "5km_1234_5678",
  "entered_at": "2025-01-01T12:05:00Z",
  "exited_at": "2025-01-01T12:05:45Z",
  "lat": 60.171,
  "lon": 24.941
}
```

Backend validates:
- `dwell_s = (exited_at - entered_at).seconds >= game.min_dwell_s`
- `cell_id` exists in the game's play area (cross-check against DB)

Response:
```json
{
  "ok": true,
  "cell_id": "...",
  "visit_count": 1,
  "visited_count": 35,
  "score_pct": 2.8
}
```

On repeated visit to same cell: update `visit_count`, return updated state.
Use `update_or_create` on `(game, cell_id)`.

### 4. Finish Game

```
POST /api/games/{game_id}/finish/
```

Sets `finished_at`, returns final score summary.

---

## services.py — Grid Query Logic

```python
# game/services.py
from django.contrib.gis.geos import Point
from django.contrib.gis.db.models.functions import Transform
from django.db import connection

GRID_TABLES = {
    '250m': 'grid_250m',
    '1km':  'grid_1km',
    '5km':  'grid_5km',
}

def get_cells_in_radius(center_lat, center_lon, radius_m, grid_size):
    """
    Returns GeoJSON FeatureCollection of grid cells intersecting
    a circle defined by center point and radius.
    Uses raw SQL for PostGIS operations on existing grid tables
    (not managed Django models).
    """
    table = GRID_TABLES[grid_size]

    # Transform center to EPSG:3067 to match grid data, buffer in meters
    sql = f"""
        SELECT
            cell_id,                          -- adjust column name if needed
            ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson
        FROM {table}
        WHERE ST_Intersects(
            geom,
            ST_Buffer(
                ST_Transform(
                    ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                    3067
                ),
                %s
            )
        )
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [center_lon, center_lat, radius_m])
        rows = cursor.fetchall()

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(row[1]),
            "properties": {"cell_id": row[0]}
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features}, len(features)


def validate_cell_in_game(game, cell_id):
    """Verify cell_id belongs to the game's play area."""
    table = GRID_TABLES[game.grid_size]
    sql = f"""
        SELECT EXISTS (
            SELECT 1 FROM {table}
            WHERE cell_id = %s
            AND ST_Intersects(
                geom,
                ST_Buffer(
                    ST_Transform(
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                        3067
                    ),
                    %s
                )
            )
        )
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [cell_id, game.center.x, game.center.y, game.radius_m])
        return cursor.fetchone()[0]
```

---

## Frontend Architecture

### State Machine (app.js)

The frontend maintains a simple game state:

```javascript
const state = {
  gameId: null,
  nickname: null,
  grid: null,           // GeoJSON FeatureCollection (loaded once)
  visitedCells: {},     // { cell_id: { visitCount, dwellS } }
  currentCellId: null,  // cell currently occupied
  cellEnteredAt: null,  // Date when current cell was entered
  dwellTimer: null,     // setTimeout handle for min_dwell
  totalCells: 0,
};
```

### GPS Logic (gps.js)

```javascript
// Poll GPS continuously during game
navigator.geolocation.watchPosition(onPositionUpdate, onError, {
  enableHighAccuracy: true,
  maximumAge: 2000,
  timeout: 5000,
});

function onPositionUpdate(position) {
  const { latitude, longitude } = position.coords;
  const newCellId = detectCell(latitude, longitude);  // Turf.js, see grid.js

  if (newCellId === state.currentCellId) return;  // still in same cell

  // Left previous cell
  if (state.currentCellId && state.dwellTimer) {
    clearTimeout(state.dwellTimer);
    // dwell was < min_dwell_s, visit not recorded
  }

  // Entered new cell
  state.currentCellId = newCellId;
  state.cellEnteredAt = new Date();

  if (newCellId) {
    state.dwellTimer = setTimeout(
      () => recordVisit(newCellId, state.cellEnteredAt),
      state.minDwellS * 1000
    );
  }
}
```

### Cell Detection (grid.js)

```javascript
import * as turf from 'https://cdn.skypack.dev/@turf/turf';

// Called on every GPS update, O(n) but fast enough for <2000 polygons
function detectCell(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of state.grid.features) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.cell_id;
    }
  }
  return null;
}
```

### Visit Recording (api.js → map.js)

When `min_dwell` timer fires:
1. POST to `/api/games/{id}/visits/` with `entered_at`, `exited_at = now()`, `cell_id`, coordinates
2. On success: update `state.visitedCells`, call `map.markCellVisited(cell_id)`
3. Update score display

### Map Rendering (map.js)

```javascript
// Leaflet GeoJSON layer with style function
const gridLayer = L.geoJSON(state.grid, {
  style: (feature) => {
    const visited = state.visitedCells[feature.properties.cell_id];
    return {
      fillColor: visited ? '#4CAF50' : 'transparent',
      fillOpacity: visited ? 0.5 : 0,
      color: '#2196F3',
      weight: 1,
      opacity: 0.6,
    };
  }
}).addTo(map);

function markCellVisited(cellId) {
  gridLayer.eachLayer((layer) => {
    if (layer.feature.properties.cell_id === cellId) {
      layer.setStyle({ fillColor: '#4CAF50', fillOpacity: 0.5 });
    }
  });
}
```

---

## Key Technical Challenges

**GPS accuracy in urban areas**
Accuracy of 5–20m is typical. At 250m cell size this is acceptable, but the device may
briefly report a position in an adjacent cell near borders. The `min_dwell_s` timer acts
as a debounce — spurious border crossings under 10 seconds are ignored.

**GeoJSON payload size**
1600 cells × 250m polygons ≈ 500–800 KB uncompressed. Enable gzip in Django/nginx.
This is a one-time load at game start; acceptable for a PoC on a mobile connection.

**Cell identifier column**
The existing grid tables may use a different column name than `cell_id`. Check with
`\d grid_250m` and update `services.py` accordingly before running any queries.

**Coordinate system mismatch**
All existing grid data is in EPSG:3067. GPS data arrives in EPSG:4326. All ST_Intersects
queries must transform the center point to 3067 before buffering (see services.py above).

---

## MVP Scope

The minimum viable version must include:

1. Game creation form (nickname, center point from current GPS, radius, grid size)
2. Grid cell fetch and display on Leaflet map
3. Continuous GPS tracking with Turf.js cell detection
4. `min_dwell_s` debounce timer
5. Cell visit recorded to backend on dwell completion
6. Visited cells highlighted green on map
7. Live score display: `visited / total` cells and percentage
8. "Finish game" button with final score

**Explicitly out of MVP scope:**
- Heatmap view (zoom-dependent rendering)
- Routing suggestions
- Time limit enforcement UI
- Administrative area selection
- Multiple players / leaderboard

---

## Implementation Order

### Phase 1 — Django backend (est. 1 day)
1. Create Django project, install GeoDjango + DRF
2. Define `Game` and `Visit` models, run migrations
3. Implement `services.py`: `get_cells_in_radius`, `validate_cell_in_game`
4. Implement API views and serializers for all four endpoints
5. Wire up `config/urls.py`
6. Test grid queries manually with known coordinates

### Phase 2 — Frontend map shell (est. 0.5 days)
1. Django template serving `index.html`
2. Leaflet map centered on user's GPS position
3. Game creation form → POST to API → load GeoJSON → render grid layer
4. Basic CSS for mobile layout

### Phase 3 — GPS and game logic (est. 0.5 days)
1. `watchPosition` loop in `gps.js`
2. Turf.js cell detection in `grid.js`
3. `min_dwell` timer logic
4. Visit POST on timer completion
5. Map cell highlighting on visit

### Phase 4 — Game flow and score (est. 0.5 days)
1. Score counter (visited / total, %)
2. Elapsed time display
3. "Finish game" button → POST finish endpoint → summary view

---

## Notes for the Coding Agent

- Verify grid table column names (`cell_id`, `geom`) before writing any SQL
- The `Game.center` field is a `PointField(srid=4326)` — store as `Point(lon, lat, srid=4326)`
- Use `update_or_create(game=game, cell_id=cell_id, defaults={...})` for Visit upserts
- Django REST Framework `ModelViewSet` is fine for Game CRUD; use `APIView` for
  the custom `/visits/` and `/finish/` endpoints for clarity
- All timestamps are UTC (`USE_TZ = True` in settings)
- Enable CORS for local development (`django-cors-headers`) if frontend is served separately
- For production-like PoC: serve static files with WhiteNoise
- Turf.js via CDN skypack or esm.sh is simplest; no build toolchain needed