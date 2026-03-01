"""DRF serializers for the grid game API."""

from rest_framework import serializers

from game.models import GRID_TYPE_CHOICES, Board, Game, Visit


class BoardSerializer(serializers.ModelSerializer):
    """Serializer for listing available boards."""

    distance_m = serializers.SerializerMethodField()

    class Meta:
        model = Board
        fields = ["id", "name", "description", "grid_type", "distance_m"]

    def get_distance_m(self, obj: Board) -> float | None:
        """Return distance in meters if annotated, otherwise None.

        Args:
            obj: Board instance, possibly with distance_m annotation.

        Returns:
            Distance in meters or None.
        """
        dist = getattr(obj, "distance_m", None)
        if dist is None:
            return None
        return dist.m


class CreateGameSerializer(serializers.Serializer):
    """Serializer for game creation requests.

    Either board_id OR (center_lat + center_lon + radius_m + grid_type) must be provided.
    """

    nickname = serializers.CharField(max_length=64)
    board_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    center_lat = serializers.FloatField(required=False, allow_null=True, default=None)
    center_lon = serializers.FloatField(required=False, allow_null=True, default=None)
    radius_m = serializers.IntegerField(min_value=100, max_value=50000, required=False, allow_null=True, default=None)
    grid_type = serializers.ChoiceField(choices=GRID_TYPE_CHOICES, required=False, allow_null=True, default=None)
    min_dwell_s = serializers.IntegerField(min_value=1, default=10)
    time_limit_s = serializers.IntegerField(required=False, allow_null=True, default=None)

    def validate(self, attrs: dict) -> dict:
        """Validate that either board_id or radius fields are provided.

        Args:
            attrs: Validated field data.

        Returns:
            Validated data.

        Raises:
            serializers.ValidationError: If neither or both modes are provided.
        """
        board_id = attrs.get("board_id")
        radius_fields = ("center_lat", "center_lon", "radius_m", "grid_type")
        has_radius_fields = all(attrs.get(f) is not None for f in radius_fields)

        if board_id and has_radius_fields:
            msg = "Provide either board_id or (center_lat, center_lon, radius_m, grid_type), not both."
            raise serializers.ValidationError(msg)

        if not board_id and not has_radius_fields:
            msg = "Provide board_id or all of (center_lat, center_lon, radius_m, grid_type)."
            raise serializers.ValidationError(msg)

        return attrs


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


class GameListSerializer(serializers.ModelSerializer):
    """Compact serializer for listing player's games."""

    game_id = serializers.UUIDField(source="id")
    visited_count = serializers.SerializerMethodField()
    score_pct = serializers.SerializerMethodField()
    board_name = serializers.SerializerMethodField()
    distance_m = serializers.SerializerMethodField()

    class Meta:
        model = Game
        fields = [
            "game_id",
            "nickname",
            "grid_type",
            "total_cells",
            "visited_count",
            "score_pct",
            "started_at",
            "finished_at",
            "board_name",
            "distance_m",
        ]

    def get_board_name(self, obj: Game) -> str | None:
        """Return the board name if the game is board-based.

        Args:
            obj: Game instance.

        Returns:
            Board name or None.
        """
        return obj.board.name if obj.board else None

    def get_distance_m(self, obj: Game) -> float | None:
        """Return distance in meters if annotated via distance query, otherwise None.

        Args:
            obj: Game instance, possibly with distance_m annotation.

        Returns:
            Distance in meters or None.
        """
        dist = getattr(obj, "distance_m", None)
        if dist is None:
            return None
        return dist.m

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


class RecordVisitSerializer(serializers.Serializer):
    """Serializer for visit recording requests."""

    cell_id = serializers.CharField(max_length=64)
    entered_at = serializers.DateTimeField()
    exited_at = serializers.DateTimeField()
    lat = serializers.FloatField()
    lon = serializers.FloatField()
