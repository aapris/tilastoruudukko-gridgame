"""Load Tilastokeskus grid CSV data into the GridCell model."""

import csv
import logging
from pathlib import Path

from django.contrib.gis.geos import Polygon
from django.core.management.base import BaseCommand, CommandError

from game.models import GridCell


logger = logging.getLogger(__name__)

GRID_BOX_SIZES = {"250m": 250, "1km": 1000, "5km": 5000}


class Command(BaseCommand):
    """Import grid cells from a Tilastokeskus CSV file."""

    help = "Load grid cells from a Tilastokeskus CSV file into the database."

    def add_arguments(self, parser: "BaseCommand") -> None:
        """Define command arguments.

        Args:
            parser: Argument parser instance.
        """
        parser.add_argument(
            "--grid-size",
            required=True,
            choices=list(GRID_BOX_SIZES.keys()),
            help="Grid size: 250m, 1km, or 5km",
        )
        parser.add_argument(
            "--file",
            required=True,
            type=Path,
            help="Path to the CSV file",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=5000,
            help="Number of rows per bulk_create batch (default: 5000)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing rows for this grid size before loading",
        )

    def handle(self, **options: dict) -> None:
        """Execute the command.

        Args:
            **options: Parsed command options.
        """
        grid_size = options["grid_size"]
        file_path = options["file"]
        batch_size = options["batch_size"]
        clear = options["clear"]
        box_size = GRID_BOX_SIZES[grid_size]

        if not file_path.exists():
            msg = f"File not found: {file_path}"
            raise CommandError(msg)

        if clear:
            deleted_count, _ = GridCell.objects.filter(grid_size=grid_size).delete()
            self.stdout.write(f"Deleted {deleted_count} existing {grid_size} cells.")

        self.stdout.write(f"Loading {grid_size} grid data from {file_path}...")

        batch = []
        total_loaded = 0

        with file_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                x = int(row["euref_x"])
                y = int(row["euref_y"])
                polygon = Polygon.from_bbox((x, y, x + box_size, y + box_size))
                polygon.srid = 3067

                municipality_code = str(row["kunnro2025"]).zfill(3)

                batch.append(
                    GridCell(
                        grid_size=grid_size,
                        nro=int(row["nro"]),
                        grid_inspire=row["grid_inspire"],
                        municipality_code=municipality_code,
                        geometry=polygon,
                    )
                )

                if len(batch) >= batch_size:
                    GridCell.objects.bulk_create(batch)
                    total_loaded += len(batch)
                    batch = []
                    if total_loaded % 50000 == 0:
                        self.stdout.write(f"  Loaded {total_loaded} rows...")

        if batch:
            GridCell.objects.bulk_create(batch)
            total_loaded += len(batch)

        self.stdout.write(self.style.SUCCESS(f"Successfully loaded {total_loaded} {grid_size} cells."))
