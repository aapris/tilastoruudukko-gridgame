"""DRF serializers for the board editor API."""

from rest_framework import serializers

from game.models import Board, BoardCell


class EditorBoardListSerializer(serializers.ModelSerializer):
    """Serializer for listing boards in the editor."""

    area_name = serializers.CharField(source="area.name", read_only=True)
    total_cells = serializers.SerializerMethodField()
    enabled_cells = serializers.SerializerMethodField()

    class Meta:
        model = Board
        fields = [
            "id",
            "name",
            "description",
            "grid_type",
            "area_name",
            "is_active",
            "is_published",
            "total_cells",
            "enabled_cells",
        ]

    def get_total_cells(self, obj: Board) -> int:
        """Return the total number of cells for this board.

        Args:
            obj: Board instance.

        Returns:
            Total cell count.
        """
        return obj.cells.count()

    def get_enabled_cells(self, obj: Board) -> int:
        """Return the number of enabled cells for this board.

        Args:
            obj: Board instance.

        Returns:
            Enabled cell count.
        """
        return obj.cells.filter(is_enabled=True).count()


class EditorBoardDetailSerializer(serializers.ModelSerializer):
    """Serializer for board detail in the editor, includes area geometry."""

    area_name = serializers.CharField(source="area.name", read_only=True)
    area_geometry = serializers.SerializerMethodField()
    total_cells = serializers.SerializerMethodField()
    enabled_cells = serializers.SerializerMethodField()

    class Meta:
        model = Board
        fields = [
            "id",
            "name",
            "description",
            "grid_type",
            "area_name",
            "is_active",
            "is_published",
            "total_cells",
            "enabled_cells",
            "area_geometry",
        ]

    def get_area_geometry(self, obj: Board) -> dict:
        """Return the area geometry as GeoJSON.

        Args:
            obj: Board instance.

        Returns:
            GeoJSON geometry dict.
        """
        import json

        return json.loads(obj.area.geometry.json)

    def get_total_cells(self, obj: Board) -> int:
        """Return the total number of cells for this board.

        Args:
            obj: Board instance.

        Returns:
            Total cell count.
        """
        return obj.cells.count()

    def get_enabled_cells(self, obj: Board) -> int:
        """Return the number of enabled cells for this board.

        Args:
            obj: Board instance.

        Returns:
            Enabled cell count.
        """
        return obj.cells.filter(is_enabled=True).count()


class ToggleCellsSerializer(serializers.Serializer):
    """Serializer for toggling cell enabled state."""

    cell_ids = serializers.ListField(child=serializers.CharField(max_length=64), min_length=1)
    is_enabled = serializers.BooleanField()


class BoardCellSerializer(serializers.ModelSerializer):
    """Serializer for individual board cells."""

    class Meta:
        model = BoardCell
        fields = ["cell_id", "is_enabled"]
