"""Grid provider abstraction for different grid systems.

Supports both Tilastokeskus statistical grids (DB-backed) and H3 hexagonal
grids (computed on-the-fly without DB storage).

TODO: Investigate whether Tilastokeskus grids can also be virtualized, since
the grid_inspire ID (e.g. '250mN667675E38875') encodes the bottom-left corner
coordinates, allowing geometry to be derived without DB lookup.
"""

import json
import math
from typing import Protocol

import h3
from django.contrib.gis.geos import Point

from game.models import GridCell


class GridProvider(Protocol):
    """Protocol defining the interface for grid providers."""

    def get_cells_in_radius(self, center_lat: float, center_lon: float, radius_m: int) -> tuple[dict, int]:
        """Return grid cells within a radius as a GeoJSON FeatureCollection.

        Args:
            center_lat: Center latitude in WGS84.
            center_lon: Center longitude in WGS84.
            radius_m: Radius in meters.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        ...

    def validate_cell(self, center_lon: float, center_lat: float, radius_m: int, cell_id: str) -> bool:
        """Verify a cell_id belongs to the play area defined by center and radius.

        Args:
            center_lon: Center longitude in WGS84.
            center_lat: Center latitude in WGS84.
            radius_m: Radius in meters.
            cell_id: The cell identifier to check.

        Returns:
            True if the cell exists within the play area.
        """
        ...


class StatisticalGridProvider:
    """Grid provider for Tilastokeskus statistical grids (DB-backed).

    Args:
        grid_size: Grid size key (250m, 1km, 5km).
    """

    def __init__(self, grid_size: str) -> None:
        """Initialize with a grid size.

        Args:
            grid_size: Grid size key (250m, 1km, 5km).
        """
        self.grid_size = grid_size

    def get_cells_in_radius(self, center_lat: float, center_lon: float, radius_m: int) -> tuple[dict, int]:
        """Return statistical grid cells within a radius as GeoJSON.

        Args:
            center_lat: Center latitude in WGS84.
            center_lon: Center longitude in WGS84.
            radius_m: Radius in meters.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        center = Point(center_lon, center_lat, srid=4326)
        center_3067 = center.transform(3067, clone=True)
        buffer = center_3067.buffer(radius_m)

        cells = GridCell.objects.filter(
            grid_size=self.grid_size,
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

    def validate_cell(self, center_lon: float, center_lat: float, radius_m: int, cell_id: str) -> bool:
        """Verify a cell belongs to the play area.

        Args:
            center_lon: Center longitude in WGS84.
            center_lat: Center latitude in WGS84.
            radius_m: Radius in meters.
            cell_id: The grid_inspire identifier to check.

        Returns:
            True if the cell exists within the play area.
        """
        center = Point(center_lon, center_lat, srid=4326)
        center_3067 = center.transform(3067, clone=True)
        buffer = center_3067.buffer(radius_m)

        return GridCell.objects.filter(
            grid_size=self.grid_size,
            grid_inspire=cell_id,
            geometry__intersects=buffer,
        ).exists()


# H3 resolution to approximate edge length in meters
H3_RESOLUTIONS = {
    "h3_res6": 6,
    "h3_res7": 7,
    "h3_res8": 8,
    "h3_res9": 9,
}


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in meters.

    Args:
        lat1: Latitude of point 1 in degrees.
        lon1: Longitude of point 1 in degrees.
        lat2: Latitude of point 2 in degrees.
        lon2: Longitude of point 2 in degrees.

    Returns:
        Distance in meters.
    """
    r = 6_371_000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class H3GridProvider:
    """Grid provider for H3 hexagonal grids (virtual, no DB storage).

    Args:
        resolution: H3 resolution level (6-9).
    """

    def __init__(self, resolution: int) -> None:
        """Initialize with an H3 resolution.

        Args:
            resolution: H3 resolution level (6-9).
        """
        self.resolution = resolution

    def get_cells_in_radius(self, center_lat: float, center_lon: float, radius_m: int) -> tuple[dict, int]:
        """Return H3 hex cells within a radius as GeoJSON.

        Uses h3.latlng_to_cell to find the center cell, then grid_disk to
        expand outward, filtering cells whose center falls within the radius.

        Args:
            center_lat: Center latitude in WGS84.
            center_lon: Center longitude in WGS84.
            radius_m: Radius in meters.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        center_cell = h3.latlng_to_cell(center_lat, center_lon, self.resolution)
        edge_length = h3.average_hexagon_edge_length(self.resolution, unit="m")
        # Estimate k-ring size needed: radius / edge_length, with margin
        k = int(radius_m / edge_length) + 2

        all_cells = h3.grid_disk(center_cell, k)

        # Filter to cells whose center is within the radius
        features = []
        for cell in all_cells:
            cell_lat, cell_lon = h3.cell_to_latlng(cell)
            dist = _haversine_distance(center_lat, center_lon, cell_lat, cell_lon)
            if dist <= radius_m:
                boundary = h3.cell_to_boundary(cell)
                # h3 returns boundary as list of (lat, lon) tuples; GeoJSON needs [lon, lat]
                coords = [[lng, lat] for lat, lng in boundary]
                coords.append(coords[0])  # close the polygon ring
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [coords]},
                        "properties": {"cell_id": cell},
                    }
                )

        return {"type": "FeatureCollection", "features": features}, len(features)

    def validate_cell(self, center_lon: float, center_lat: float, radius_m: int, cell_id: str) -> bool:
        """Verify an H3 cell belongs to the play area.

        Checks that the cell is a valid H3 index at the correct resolution
        and its center falls within the game radius.

        Args:
            center_lon: Center longitude in WGS84.
            center_lat: Center latitude in WGS84.
            radius_m: Radius in meters.
            cell_id: The H3 cell index to check.

        Returns:
            True if the cell is valid and within the play area.
        """
        if not h3.is_valid_cell(cell_id):
            return False
        if h3.get_resolution(cell_id) != self.resolution:
            return False

        cell_lat, cell_lon = h3.cell_to_latlng(cell_id)
        dist = _haversine_distance(center_lat, center_lon, cell_lat, cell_lon)
        return dist <= radius_m


# Grid type to provider class prefix mapping
GRID_TYPE_STATISTICAL = {"stat_250m": "250m", "stat_1km": "1km", "stat_5km": "5km"}


def get_grid_provider(grid_type: str) -> StatisticalGridProvider | H3GridProvider:
    """Create a grid provider for the given grid type.

    Args:
        grid_type: Grid type identifier (e.g. 'stat_1km', 'h3_res8').

    Returns:
        A grid provider instance.

    Raises:
        ValueError: If the grid type is not recognized.
    """
    if grid_type in GRID_TYPE_STATISTICAL:
        return StatisticalGridProvider(GRID_TYPE_STATISTICAL[grid_type])
    if grid_type in H3_RESOLUTIONS:
        return H3GridProvider(H3_RESOLUTIONS[grid_type])
    msg = f"Unknown grid type: {grid_type}"
    raise ValueError(msg)
