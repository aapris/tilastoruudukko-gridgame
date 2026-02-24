"""Import geographic areas from a GeoJSON file into the Area model."""

import json
import logging
from pathlib import Path

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Polygon
from django.core.management.base import BaseCommand, CommandError

from game.models import Area


logger = logging.getLogger(__name__)


def _extract_srid(geojson_data: dict) -> int:
    """Extract SRID from GeoJSON CRS member, defaulting to 4326.

    Args:
        geojson_data: Parsed GeoJSON dict.

    Returns:
        EPSG SRID integer.
    """
    crs = geojson_data.get("crs")
    if not crs:
        return 4326

    props = crs.get("properties", {})
    name = props.get("name", "")

    # Handle "urn:ogc:def:crs:EPSG::3067" or "EPSG:3067" formats
    if "EPSG" in name:
        parts = name.replace("::", ":").split(":")
        for i, part in enumerate(parts):
            if part == "EPSG" and i + 1 < len(parts):
                try:
                    return int(parts[i + 1])
                except ValueError:
                    pass

    return 4326


def _to_polygon_4326(geometry: dict, source_srid: int) -> Polygon | None:
    """Convert a GeoJSON geometry to a single Polygon in EPSG:4326.

    Handles Polygon and MultiPolygon (takes largest by area).

    Args:
        geometry: GeoJSON geometry dict.
        source_srid: Source coordinate reference system SRID.

    Returns:
        A GEOS Polygon in EPSG:4326, or None if conversion fails.
    """
    geom = GEOSGeometry(json.dumps(geometry))
    # GeoJSON spec defaults to SRID 4326, but the file may use a different CRS.
    # Always override with the detected source SRID.
    geom.srid = source_srid

    if isinstance(geom, MultiPolygon):
        # Take the largest polygon by area
        geom = max(geom, key=lambda p: p.area)

    if not isinstance(geom, Polygon):
        return None

    if source_srid != 4326:
        geom.transform(4326)

    return geom


class Command(BaseCommand):
    """Import areas from a GeoJSON file."""

    help = "Import geographic areas from a GeoJSON file into the Area model."

    def add_arguments(self, parser: "BaseCommand") -> None:
        """Define command arguments.

        Args:
            parser: Argument parser instance.
        """
        parser.add_argument(
            "--file",
            required=True,
            type=Path,
            help="Path to the GeoJSON file",
        )
        parser.add_argument(
            "--name-property",
            required=True,
            help="GeoJSON property to use as the area name",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all existing areas before importing",
        )

    def handle(self, **options: dict) -> None:
        """Execute the import command.

        Args:
            **options: Parsed command options.
        """
        file_path: Path = options["file"]
        name_property: str = options["name_property"]
        clear: bool = options["clear"]

        if not file_path.exists():
            msg = f"File not found: {file_path}"
            raise CommandError(msg)

        with file_path.open(encoding="utf-8") as f:
            geojson_data = json.load(f)

        if geojson_data.get("type") != "FeatureCollection":
            msg = "GeoJSON file must be a FeatureCollection."
            raise CommandError(msg)

        source_srid = _extract_srid(geojson_data)
        self.stdout.write(f"Detected source CRS: EPSG:{source_srid}")

        if clear:
            deleted_count, _ = Area.objects.all().delete()
            self.stdout.write(f"Deleted {deleted_count} existing areas.")

        features = geojson_data.get("features", [])
        imported = 0
        skipped = 0

        for feature in features:
            properties = feature.get("properties", {})
            name = properties.get(name_property)

            if not name:
                skipped += 1
                logger.warning("Skipping feature missing '%s' property", name_property)
                continue

            geometry = feature.get("geometry")
            if not geometry:
                skipped += 1
                logger.warning("Skipping feature '%s' with no geometry", name)
                continue

            polygon = _to_polygon_4326(geometry, source_srid)
            if polygon is None:
                skipped += 1
                logger.warning("Skipping feature '%s': unsupported geometry type", name)
                continue

            Area.objects.create(
                name=str(name),
                geometry=polygon,
                properties=properties,
            )
            imported += 1

            if imported % 100 == 0:
                self.stdout.write(f"  Imported {imported} areas...")

        self.stdout.write(self.style.SUCCESS(f"Imported {imported} areas ({skipped} skipped)."))
