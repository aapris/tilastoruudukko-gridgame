"""Django admin configuration for the grid game."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.gis.admin import GISModelAdmin

from game.models import Area, Board, BoardCell, Game, User, Visit


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin for custom User model."""


@admin.register(Area)
class AreaAdmin(GISModelAdmin):
    """Admin for geographic areas with OSM map widget."""

    list_display = ["name", "imported_at"]
    search_fields = ["name"]
    readonly_fields = ["imported_at", "properties"]


class BoardCellInline(admin.TabularInline):
    """Inline admin for board cells."""

    model = BoardCell
    extra = 0
    fields = ["cell_id", "is_enabled"]
    readonly_fields = ["cell_id"]


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    """Admin for predefined game boards."""

    list_display = ["name", "area", "grid_type", "is_active", "is_published", "created_at"]
    list_filter = ["grid_type", "is_active", "is_published"]
    autocomplete_fields = ["area"]
    inlines = [BoardCellInline]


@admin.register(Game)
class GameAdmin(GISModelAdmin):
    """Admin for game sessions with OSM map widget."""

    list_display = ["id", "nickname", "grid_type", "board", "total_cells", "started_at", "finished_at"]
    list_filter = ["grid_type", "finished_at"]
    readonly_fields = ["id", "player_token", "started_at"]


@admin.register(Visit)
class VisitAdmin(GISModelAdmin):
    """Admin for cell visits with OSM map widget."""

    list_display = ["game", "cell_id", "dwell_s", "visit_count"]
    list_filter = ["game"]
