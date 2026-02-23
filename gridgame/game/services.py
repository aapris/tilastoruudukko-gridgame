"""Grid query logic and scoring services."""

import json

from django.contrib.gis.geos import Point

from game.models import GridCell


def get_cells_in_radius(center_lat: float, center_lon: float, radius_m: int, grid_size: str) -> tuple[dict, int]:
    """Return grid cells intersecting a circle as a GeoJSON FeatureCollection.

    Args:
        center_lat: Center latitude in WGS84.
        center_lon: Center longitude in WGS84.
        radius_m: Radius in meters.
        grid_size: Grid size key (250m, 1km, 5km).

    Returns:
        Tuple of (GeoJSON FeatureCollection dict, cell count).
    """
    center = Point(center_lon, center_lat, srid=4326)
    center_3067 = center.transform(3067, clone=True)
    buffer = center_3067.buffer(radius_m)

    cells = GridCell.objects.filter(
        grid_size=grid_size,
        geometry__intersects=buffer,
    )

    features = []
    for cell in cells.iterator():
        geom_4326 = cell.geometry.transform(4326, clone=True)
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(geom_4326.json),
                "properties": {"cell_id": cell.grid_inspire},
            }
        )

    return {"type": "FeatureCollection", "features": features}, len(features)


def validate_cell_in_game(center_lon: float, center_lat: float, radius_m: int, grid_size: str, cell_id: str) -> bool:
    """Verify a cell_id belongs to the game's play area.

    Args:
        center_lon: Game center longitude in WGS84.
        center_lat: Game center latitude in WGS84.
        radius_m: Game radius in meters.
        grid_size: Grid size key.
        cell_id: The grid_inspire identifier to check.

    Returns:
        True if the cell exists within the play area.
    """
    center = Point(center_lon, center_lat, srid=4326)
    center_3067 = center.transform(3067, clone=True)
    buffer = center_3067.buffer(radius_m)

    return GridCell.objects.filter(
        grid_size=grid_size,
        grid_inspire=cell_id,
        geometry__intersects=buffer,
    ).exists()
