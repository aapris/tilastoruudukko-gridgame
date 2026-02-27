"""Grid provider abstraction for different grid systems.

Supports Tilastokeskus statistical grids (virtualized from grid_inspire IDs)
and H3 hexagonal grids (computed on-the-fly). Neither requires DB storage.
"""

import json
import math
import re
from abc import ABC, abstractmethod

import h3
from django.contrib.gis.geos import Point, Polygon


# Grid size in meters for each statistical grid label
_STAT_GRID_SIZES = {"250m": 250, "1km": 1000, "5km": 5000}

# Finland bounding box in EPSG:3067 (easting, northing)
_FINLAND_BBOX_3067 = (60_000, 6_600_000, 770_000, 7_800_000)  # min_e, min_n, max_e, max_n

# Regex for parsing grid_inspire identifiers like "250mN667675E38875"
_INSPIRE_RE = re.compile(r"^(250m|1km|5km)N(\d+)E(\d+)$")


class GridProvider(ABC):
    """Abstract base class defining the interface for grid providers."""

    @abstractmethod
    def get_cells_in_polygon(self, polygon_4326: Polygon) -> tuple[dict, int]:
        """Return grid cells within a polygon as a GeoJSON FeatureCollection.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """

    @abstractmethod
    def cell_id_to_geojson_feature(self, cell_id: str) -> dict | None:
        """Convert a cell_id to a GeoJSON Feature with polygon geometry in 4326.

        Args:
            cell_id: The cell identifier.

        Returns:
            GeoJSON Feature dict or None if cell_id is invalid.
        """

    @abstractmethod
    def validate_cell_in_polygon(self, polygon_4326: Polygon, cell_id: str) -> bool:
        """Verify a cell_id belongs to the play area defined by a polygon.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.
            cell_id: The cell identifier to check.

        Returns:
            True if the cell exists within the polygon.
        """

    def get_cells_in_radius(self, center_lat: float, center_lon: float, radius_m: int) -> tuple[dict, int]:
        """Return grid cells within a radius as a GeoJSON FeatureCollection.

        Builds a circle polygon from center + radius, then delegates to
        get_cells_in_polygon.

        Args:
            center_lat: Center latitude in WGS84.
            center_lon: Center longitude in WGS84.
            radius_m: Radius in meters.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        polygon_4326 = _build_circle_polygon(center_lat, center_lon, radius_m)
        return self.get_cells_in_polygon(polygon_4326)

    def validate_cell(self, center_lon: float, center_lat: float, radius_m: int, cell_id: str) -> bool:
        """Verify a cell_id belongs to the play area defined by center and radius.

        Builds a circle polygon from center + radius, then delegates to
        validate_cell_in_polygon.

        Args:
            center_lon: Center longitude in WGS84.
            center_lat: Center latitude in WGS84.
            radius_m: Radius in meters.
            cell_id: The cell identifier to check.

        Returns:
            True if the cell exists within the play area.
        """
        polygon_4326 = _build_circle_polygon(center_lat, center_lon, radius_m)
        return self.validate_cell_in_polygon(polygon_4326, cell_id)


def _build_circle_polygon(center_lat: float, center_lon: float, radius_m: int) -> Polygon:
    """Build a circle polygon by buffering a center point in EPSG:3067.

    Args:
        center_lat: Center latitude in WGS84.
        center_lon: Center longitude in WGS84.
        radius_m: Radius in meters.

    Returns:
        Polygon in EPSG:4326 representing the buffered circle.
    """
    center = Point(center_lon, center_lat, srid=4326)
    center_3067 = center.transform(3067, clone=True)
    buffer = center_3067.buffer(radius_m)
    buffer.srid = 3067
    polygon_4326 = buffer.transform(4326, clone=True)
    return polygon_4326


def _parse_grid_inspire(cell_id: str) -> tuple[str, int, int] | None:
    """Parse a grid_inspire identifier into its components.

    Args:
        cell_id: Grid inspire ID like "250mN667675E38875".

    Returns:
        Tuple of (size_label, northing, easting) or None if invalid.
    """
    match = _INSPIRE_RE.match(cell_id)
    if not match:
        return None
    return match.group(1), int(match.group(2)), int(match.group(3))


class StatisticalGridProvider(GridProvider):
    """Grid provider for Tilastokeskus statistical grids (virtualized).

    Cell geometries are computed from grid_inspire IDs without DB queries.
    The grid_inspire format encodes the bottom-left corner coordinates in
    EPSG:3067, e.g. "250mN667675E38875" means a 250m cell at N=667675, E=38875.

    Args:
        grid_size: Grid size key (250m, 1km, 5km).
    """

    def __init__(self, grid_size: str) -> None:
        """Initialize with a grid size.

        Args:
            grid_size: Grid size key (250m, 1km, 5km).
        """
        self.grid_size = grid_size
        self.cell_size = _STAT_GRID_SIZES[grid_size]

    def get_cells_in_polygon(self, polygon_4326: Polygon) -> tuple[dict, int]:
        """Return statistical grid cells within a polygon as GeoJSON.

        Iterates over candidate grid cells whose centroid falls within the
        polygon. Geometry is computed from grid alignment, not from DB.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        polygon_3067 = polygon_4326.transform(3067, clone=True)
        bbox = polygon_3067.extent  # (xmin, ymin, xmax, ymax) = (min_e, min_n, max_e, max_n)
        size = self.cell_size
        half = size / 2

        # Clamp to Finland bounding box
        min_e = max(bbox[0], _FINLAND_BBOX_3067[0])
        min_n = max(bbox[1], _FINLAND_BBOX_3067[1])
        max_e = min(bbox[2], _FINLAND_BBOX_3067[2])
        max_n = min(bbox[3], _FINLAND_BBOX_3067[3])

        # Snap to grid alignment
        start_e = int((min_e // size) * size)
        start_n = int((min_n // size) * size)
        end_e = int(max_e) + size
        end_n = int(max_n) + size

        features = []
        for e in range(start_e, end_e, size):
            for n in range(start_n, end_n, size):
                # Check if centroid falls within the polygon
                centroid = Point(e + half, n + half, srid=3067)
                if not polygon_3067.contains(centroid):
                    continue

                cell_id = f"{self.grid_size}N{n}E{e}"
                cell_poly_3067 = Polygon(
                    ((e, n), (e + size, n), (e + size, n + size), (e, n + size), (e, n)),
                    srid=3067,
                )
                cell_poly_4326 = cell_poly_3067.transform(4326, clone=True)
                features.append(
                    {
                        "type": "Feature",
                        "geometry": json.loads(cell_poly_4326.json),
                        "properties": {"cell_id": cell_id},
                    }
                )

        return {"type": "FeatureCollection", "features": features}, len(features)

    def cell_id_to_geojson_feature(self, cell_id: str) -> dict | None:
        """Convert a statistical grid cell_id to a GeoJSON Feature.

        Parses the INSPIRE ID to extract coordinates and builds the polygon.

        Args:
            cell_id: The grid_inspire identifier (e.g. "250mN667675E38875").

        Returns:
            GeoJSON Feature dict or None if cell_id is invalid.
        """
        parsed = _parse_grid_inspire(cell_id)
        if not parsed:
            return None

        label, n, e = parsed
        if label != self.grid_size:
            return None

        size = self.cell_size
        cell_poly_3067 = Polygon(
            ((e, n), (e + size, n), (e + size, n + size), (e, n + size), (e, n)),
            srid=3067,
        )
        cell_poly_4326 = cell_poly_3067.transform(4326, clone=True)
        return {
            "type": "Feature",
            "geometry": json.loads(cell_poly_4326.json),
            "properties": {"cell_id": cell_id},
        }

    def validate_cell_in_polygon(self, polygon_4326: Polygon, cell_id: str) -> bool:
        """Verify a cell belongs to the play area defined by a polygon.

        Parses the cell_id to extract coordinates, computes the centroid,
        and checks if it falls within the polygon.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.
            cell_id: The grid_inspire identifier to check.

        Returns:
            True if the cell's centroid is within the polygon.
        """
        parsed = _parse_grid_inspire(cell_id)
        if not parsed:
            return False

        label, n, e = parsed
        if label != self.grid_size:
            return False

        size = self.cell_size
        half = size / 2
        centroid_e = e + half
        centroid_n = n + half

        # Quick check: within Finland bounding box
        if not (
            _FINLAND_BBOX_3067[0] <= centroid_e <= _FINLAND_BBOX_3067[2]
            and _FINLAND_BBOX_3067[1] <= centroid_n <= _FINLAND_BBOX_3067[3]
        ):
            return False

        polygon_3067 = polygon_4326.transform(3067, clone=True)
        centroid = Point(centroid_e, centroid_n, srid=3067)
        return polygon_3067.contains(centroid)


# H3 resolution to approximate edge length in meters
H3_RESOLUTIONS = {
    "h3_res6": 6,
    "h3_res7": 7,
    "h3_res8": 8,
    "h3_res9": 9,
    "h3_res10": 10,
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


class H3GridProvider(GridProvider):
    """Grid provider for H3 hexagonal grids (virtual, no DB storage).

    Args:
        resolution: H3 resolution level (6-10).
    """

    def __init__(self, resolution: int) -> None:
        """Initialize with an H3 resolution.

        Args:
            resolution: H3 resolution level (6-10).
        """
        self.resolution = resolution

    def cell_id_to_geojson_feature(self, cell_id: str) -> dict | None:
        """Convert an H3 cell index to a GeoJSON Feature.

        Args:
            cell_id: The H3 cell index string.

        Returns:
            GeoJSON Feature dict or None if cell_id is invalid.
        """
        if not h3.is_valid_cell(cell_id):
            return None
        if h3.get_resolution(cell_id) != self.resolution:
            return None

        boundary = h3.cell_to_boundary(cell_id)
        coords = [[lng, lat] for lat, lng in boundary]
        coords.append(coords[0])
        return {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {"cell_id": cell_id},
        }

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

    def get_cells_in_polygon(self, polygon_4326: Polygon) -> tuple[dict, int]:
        """Return H3 hex cells within a polygon as GeoJSON.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.

        Returns:
            Tuple of (GeoJSON FeatureCollection dict, cell count).
        """
        # Convert GEOS polygon to h3 LatLngPoly (lat, lng order)
        exterior = polygon_4326.exterior_ring
        coords = [(coord[1], coord[0]) for coord in exterior.coords[:-1]]
        h3_poly = h3.LatLngPoly(coords)

        cell_ids = h3.h3shape_to_cells(h3_poly, self.resolution)

        features = []
        for cell in cell_ids:
            boundary = h3.cell_to_boundary(cell)
            coords_geojson = [[lng, lat] for lat, lng in boundary]
            coords_geojson.append(coords_geojson[0])
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [coords_geojson]},
                    "properties": {"cell_id": cell},
                }
            )

        return {"type": "FeatureCollection", "features": features}, len(features)

    def validate_cell_in_polygon(self, polygon_4326: Polygon, cell_id: str) -> bool:
        """Verify an H3 cell belongs to the play area defined by a polygon.

        Args:
            polygon_4326: Polygon geometry in EPSG:4326.
            cell_id: The H3 cell index to check.

        Returns:
            True if the cell is valid and within the polygon.
        """
        if not h3.is_valid_cell(cell_id):
            return False
        if h3.get_resolution(cell_id) != self.resolution:
            return False

        exterior = polygon_4326.exterior_ring
        coords = [(coord[1], coord[0]) for coord in exterior.coords[:-1]]
        h3_poly = h3.LatLngPoly(coords)

        cell_ids = h3.h3shape_to_cells(h3_poly, self.resolution)
        return cell_id in cell_ids


# Grid type to provider class prefix mapping
GRID_TYPE_STATISTICAL = {"stat_250m": "250m", "stat_1km": "1km", "stat_5km": "5km"}


def get_grid_provider(grid_type: str) -> GridProvider:
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
