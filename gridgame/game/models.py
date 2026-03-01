"""Data models for the grid game."""

import uuid

from django.contrib.auth.models import AbstractUser
from django.contrib.gis.db import models as gis_models
from django.db import models


GRID_TYPE_CHOICES = [
    ("stat_250m", "Statistical 250m"),
    ("stat_1km", "Statistical 1km"),
    ("stat_5km", "Statistical 5km"),
    ("h3_res10", "H3 ~44m"),
    ("h3_res9", "H3 ~175m"),
    ("h3_res8", "H3 ~460m"),
    ("h3_res7", "H3 ~1.2km"),
    ("h3_res6", "H3 ~3.2km"),
]


class User(AbstractUser):
    """Custom user model for future extensibility."""


class Area(gis_models.Model):
    """A geographic area imported from GeoJSON (e.g. a neighborhood)."""

    name = models.CharField(max_length=256)
    description = models.TextField(blank=True, default="")
    geometry = gis_models.PolygonField(srid=4326)
    properties = models.JSONField(default=dict, blank=True)
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        """Return the area name."""
        return self.name


class Board(models.Model):
    """A predefined game board based on a geographic area with a fixed grid type."""

    name = models.CharField(max_length=256)
    description = models.TextField(blank=True, default="")
    area = models.ForeignKey(Area, on_delete=models.PROTECT, related_name="boards")
    grid_type = models.CharField(max_length=16, choices=GRID_TYPE_CHOICES, default="h3_res9")
    is_active = models.BooleanField(default=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        """Return the board name."""
        return self.name


class BoardCell(models.Model):
    """A cell belonging to a board, with an enabled/disabled toggle for the editor."""

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="cells")
    cell_id = models.CharField(max_length=64)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["board", "cell_id"], name="unique_board_cell"),
        ]
        indexes = [
            models.Index(fields=["board", "is_enabled"]),
        ]

    def __str__(self) -> str:
        """Return the cell ID and enabled status."""
        status = "enabled" if self.is_enabled else "disabled"
        return f"{self.cell_id} ({status})"


class Game(models.Model):
    """A single game session where a player visits grid cells."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player_token = models.UUIDField(db_index=True, default=uuid.uuid4)
    user = models.ForeignKey("game.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="games")
    nickname = models.CharField(max_length=64)

    center = gis_models.PointField(srid=4326, null=True, blank=True)
    radius_m = models.IntegerField(null=True, blank=True)
    grid_type = models.CharField(max_length=16, choices=GRID_TYPE_CHOICES)
    board = models.ForeignKey(Board, on_delete=models.SET_NULL, null=True, blank=True, related_name="games")
    play_area = gis_models.PolygonField(srid=4326, null=True, blank=True)
    snapshot_cell_ids = models.JSONField(default=list, blank=True)

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


class CellReport(models.Model):
    """A player report that a grid cell is inaccessible."""

    REASON_CHOICES = [
        ("dangerous", "Dangerous"),
        ("no_ground_access", "No ground access"),
        ("closed", "Closed"),
        ("restricted", "Restricted"),
        ("other", "Other"),
    ]

    cell_id = models.CharField(max_length=64)
    grid_type = models.CharField(max_length=16, choices=GRID_TYPE_CHOICES)
    reason = models.CharField(max_length=32, choices=REASON_CHOICES)
    comment = models.TextField(blank=True, default="")
    player_token = models.UUIDField(db_index=True)
    user = models.ForeignKey("game.User", null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["cell_id", "grid_type", "player_token"],
                name="unique_report_per_player",
            ),
        ]

    def __str__(self) -> str:
        """Return a summary of the report."""
        return f"Report {self.cell_id} ({self.reason})"
