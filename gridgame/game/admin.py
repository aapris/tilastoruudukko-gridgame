"""Django admin configuration for the grid game."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from game.models import Area, Board, Game, User, Visit


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin for custom User model."""


@admin.register(Area)
class AreaAdmin(admin.ModelAdmin):
    """Admin for geographic areas."""

    list_display = ["name", "imported_at"]
    search_fields = ["name"]
    readonly_fields = ["imported_at", "properties"]


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    """Admin for predefined game boards."""

    list_display = ["name", "area", "grid_type", "is_active", "created_at"]
    list_filter = ["grid_type", "is_active"]
    autocomplete_fields = ["area"]


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    """Admin for game sessions."""

    list_display = ["id", "nickname", "grid_type", "board", "total_cells", "started_at", "finished_at"]
    list_filter = ["grid_type", "finished_at"]
    readonly_fields = ["id", "player_token", "started_at"]


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    """Admin for cell visits."""

    list_display = ["game", "cell_id", "dwell_s", "visit_count"]
    list_filter = ["game"]
