"""DRF serializers for the grid game API."""

from rest_framework import serializers

from game.models import Game, Visit


class CreateGameSerializer(serializers.Serializer):
    """Serializer for game creation requests."""

    nickname = serializers.CharField(max_length=64)
    center_lat = serializers.FloatField()
    center_lon = serializers.FloatField()
    radius_m = serializers.IntegerField(min_value=100, max_value=50000)
    grid_type = serializers.ChoiceField(choices=Game.GRID_TYPE_CHOICES)
    min_dwell_s = serializers.IntegerField(min_value=1, default=10)
    time_limit_s = serializers.IntegerField(required=False, allow_null=True, default=None)


class VisitSerializer(serializers.ModelSerializer):
    """Serializer for visit summaries in game state."""

    class Meta:
        model = Visit
        fields = ["cell_id", "visit_count", "dwell_s"]


class GameStateSerializer(serializers.ModelSerializer):
    """Serializer for game state responses."""

    game_id = serializers.UUIDField(source="id")
    visited_count = serializers.SerializerMethodField()
    score_pct = serializers.SerializerMethodField()
    elapsed_s = serializers.SerializerMethodField()
    visits = VisitSerializer(many=True, read_only=True)

    class Meta:
        model = Game
        fields = [
            "game_id",
            "nickname",
            "total_cells",
            "visited_count",
            "score_pct",
            "elapsed_s",
            "finished_at",
            "visits",
        ]

    def get_visited_count(self, obj: Game) -> int:
        """Return the number of unique visited cells.

        Args:
            obj: Game instance.

        Returns:
            Count of visits.
        """
        return obj.visits.count()

    def get_score_pct(self, obj: Game) -> float:
        """Return the visit percentage.

        Args:
            obj: Game instance.

        Returns:
            Percentage of cells visited.
        """
        if obj.total_cells == 0:
            return 0.0
        return round(obj.visits.count() / obj.total_cells * 100, 1)

    def get_elapsed_s(self, obj: Game) -> int:
        """Return elapsed seconds since game start.

        Args:
            obj: Game instance.

        Returns:
            Elapsed time in seconds.
        """
        from django.utils import timezone

        end = obj.finished_at or timezone.now()
        return int((end - obj.started_at).total_seconds())


class RecordVisitSerializer(serializers.Serializer):
    """Serializer for visit recording requests."""

    cell_id = serializers.CharField(max_length=64)
    entered_at = serializers.DateTimeField()
    exited_at = serializers.DateTimeField()
    lat = serializers.FloatField()
    lon = serializers.FloatField()
