"""Views for the board editor (requires authentication)."""

from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import get_object_or_404
from django.views.generic import TemplateView
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from game.editor_serializers import (
    EditorBoardDetailSerializer,
    EditorBoardListSerializer,
    ToggleCellsSerializer,
)
from game.grid_providers import get_grid_provider
from game.models import Board, BoardCell


class EditorPageView(LoginRequiredMixin, TemplateView):
    """Serve the editor HTML shell."""

    template_name = "editor.html"


class _EditorAPIBase(APIView):
    """Base class for editor API views requiring session authentication."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]


class EditorBoardListView(_EditorAPIBase):
    """List all boards with cell counts."""

    def get(self, request: Request) -> Response:
        """Handle GET request to list all boards.

        Args:
            request: DRF request.

        Returns:
            Response with list of boards.
        """
        boards = Board.objects.select_related("area").all()
        serializer = EditorBoardListSerializer(boards, many=True)
        return Response(serializer.data)


class EditorBoardDetailView(_EditorAPIBase):
    """Get board detail with area geometry."""

    def get(self, request: Request, board_id: int) -> Response:
        """Handle GET request for board detail.

        Args:
            request: DRF request.
            board_id: Board primary key.

        Returns:
            Response with board detail including area geometry.
        """
        board = get_object_or_404(Board.objects.select_related("area"), pk=board_id)
        serializer = EditorBoardDetailSerializer(board)
        return Response(serializer.data)


class GenerateCellsView(_EditorAPIBase):
    """Generate BoardCell rows from the grid provider for the board's area."""

    def post(self, request: Request, board_id: int) -> Response:
        """Handle POST to generate cells for a board.

        Deletes existing cells and regenerates from the grid provider.

        Args:
            request: DRF request.
            board_id: Board primary key.

        Returns:
            Response with generated cell count.
        """
        board = get_object_or_404(Board.objects.select_related("area"), pk=board_id)
        provider = get_grid_provider(board.grid_type)
        geojson, count = provider.get_cells_in_polygon(board.area.geometry)

        # Delete existing cells and bulk create new ones
        board.cells.all().delete()

        cell_ids = [f["properties"]["cell_id"] for f in geojson["features"]]
        cells = [BoardCell(board=board, cell_id=cid, is_enabled=True) for cid in cell_ids]
        BoardCell.objects.bulk_create(cells, batch_size=5000)

        return Response({"total_cells": count, "message": f"Generated {count} cells."})


class BoardCellsView(_EditorAPIBase):
    """Return board cells as GeoJSON with is_enabled property."""

    def get(self, request: Request, board_id: int) -> Response:
        """Handle GET to return cells as GeoJSON FeatureCollection.

        Args:
            request: DRF request.
            board_id: Board primary key.

        Returns:
            Response with GeoJSON FeatureCollection.
        """
        board = get_object_or_404(Board, pk=board_id)
        cells = board.cells.all().values_list("cell_id", "is_enabled")

        if not cells:
            return Response({"type": "FeatureCollection", "features": []})

        provider = get_grid_provider(board.grid_type)

        features = []
        for cell_id, is_enabled in cells:
            feature = provider.cell_id_to_geojson_feature(cell_id)
            if feature:
                feature["properties"]["is_enabled"] = is_enabled
                features.append(feature)

        return Response({"type": "FeatureCollection", "features": features})


class ToggleCellsView(_EditorAPIBase):
    """Toggle is_enabled for a list of cell_ids."""

    def patch(self, request: Request, board_id: int) -> Response:
        """Handle PATCH to toggle cell enabled state.

        Args:
            request: DRF request with cell_ids and is_enabled.
            board_id: Board primary key.

        Returns:
            Response with updated counts.
        """
        board = get_object_or_404(Board, pk=board_id)
        serializer = ToggleCellsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        updated = BoardCell.objects.filter(
            board=board,
            cell_id__in=data["cell_ids"],
        ).update(is_enabled=data["is_enabled"])

        enabled_count = board.cells.filter(is_enabled=True).count()
        total_count = board.cells.count()

        return Response(
            {
                "updated": updated,
                "enabled_count": enabled_count,
                "total_count": total_count,
            }
        )


class PublishBoardView(_EditorAPIBase):
    """Set board as published and active."""

    def post(self, request: Request, board_id: int) -> Response:
        """Handle POST to publish a board.

        Args:
            request: DRF request.
            board_id: Board primary key.

        Returns:
            Response confirming publication.
        """
        board = get_object_or_404(Board, pk=board_id)

        if not board.cells.exists():
            return Response(
                {"error": "Generate cells before publishing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        board.is_published = True
        board.is_active = True
        board.save(update_fields=["is_published", "is_active"])

        return Response({"message": "Board published.", "is_published": True, "is_active": True})
