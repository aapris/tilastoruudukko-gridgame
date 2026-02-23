"""Data models for the grid game."""

import uuid

from django.contrib.auth.models import AbstractUser
from django.contrib.gis.db import models as gis_models
from django.db import models


class User(AbstractUser):
    """Custom user model for future extensibility."""


class GridCell(gis_models.Model):
    """A statistical grid cell from Tilastokeskus data."""

    GRID_SIZE_CHOICES = [("250m", "250 m"), ("1km", "1 km"), ("5km", "5 km")]

    grid_size = models.CharField(max_length=4, choices=GRID_SIZE_CHOICES, db_index=True)
    nro = models.IntegerField()
    grid_inspire = models.CharField(max_length=32)
    municipality_code = models.CharField(max_length=3)
    geometry = gis_models.PolygonField(srid=3067)

    class Meta:
        indexes = [
            models.Index(fields=["grid_size", "nro"]),
            models.Index(fields=["grid_inspire"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["grid_size", "nro"], name="unique_grid_cell"),
        ]

    def __str__(self) -> str:
        """Return the INSPIRE code as string representation."""
        return self.grid_inspire


class Game(models.Model):
    """A single game session where a player visits grid cells."""

    GRID_TYPE_CHOICES = [
        ("stat_250m", "Statistical 250m"),
        ("stat_1km", "Statistical 1km"),
        ("stat_5km", "Statistical 5km"),
        ("h3_res9", "H3 ~175m"),
        ("h3_res8", "H3 ~460m"),
        ("h3_res7", "H3 ~1.2km"),
        ("h3_res6", "H3 ~3.2km"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nickname = models.CharField(max_length=64)

    center = gis_models.PointField(srid=4326)
    radius_m = models.IntegerField()
    grid_type = models.CharField(max_length=16, choices=GRID_TYPE_CHOICES)

    min_dwell_s = models.IntegerField(default=10)
    time_limit_s = models.IntegerField(null=True, blank=True)

    total_cells = models.IntegerField()
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self) -> str:
        """Return a summary of the game."""
        return f"Game {self.id} ({self.nickname})"


class Visit(models.Model):
    """A recorded visit to a grid cell during a game."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="visits")
    cell_id = models.CharField(max_length=64)

    entered_at = models.DateTimeField()
    exited_at = models.DateTimeField()
    dwell_s = models.IntegerField()
    visit_count = models.IntegerField(default=1)

    entry_point = gis_models.PointField(srid=4326, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "cell_id"], name="unique_visit_per_cell"),
        ]

    def __str__(self) -> str:
        """Return a summary of the visit."""
        return f"Visit {self.cell_id} (game {self.game_id})"
