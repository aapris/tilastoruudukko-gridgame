"""API views for the grid game."""

from django.contrib.gis.geos import Point
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from game.models import Game, Visit
from game.serializers import CreateGameSerializer, GameStateSerializer, RecordVisitSerializer
from game.services import get_cells_in_radius, validate_cell_in_game


class CreateGameView(APIView):
    """Create a new game session."""

    def post(self, request: Request) -> Response:
        """Handle POST request to create a game.

        Args:
            request: DRF request with game creation data.

        Returns:
            Response with game info and grid GeoJSON.
        """
        serializer = CreateGameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        grid_geojson, total_cells = get_cells_in_radius(
            center_lat=data["center_lat"],
            center_lon=data["center_lon"],
            radius_m=data["radius_m"],
            grid_size=data["grid_size"],
        )

        game = Game.objects.create(
            nickname=data["nickname"],
            center=Point(data["center_lon"], data["center_lat"], srid=4326),
            radius_m=data["radius_m"],
            grid_size=data["grid_size"],
            min_dwell_s=data["min_dwell_s"],
            time_limit_s=data["time_limit_s"],
            total_cells=total_cells,
        )

        return Response(
            {
                "game_id": str(game.id),
                "nickname": game.nickname,
                "total_cells": game.total_cells,
                "min_dwell_s": game.min_dwell_s,
                "time_limit_s": game.time_limit_s,
                "started_at": game.started_at.isoformat(),
                "grid": grid_geojson,
            },
            status=status.HTTP_201_CREATED,
        )


class GameStateView(APIView):
    """Get the current state of a game."""

    def get(self, request: Request, game_id: str) -> Response:
        """Handle GET request for game state.

        Args:
            request: DRF request.
            game_id: UUID of the game.

        Returns:
            Response with game state and visits.
        """
        game = get_object_or_404(Game, pk=game_id)
        serializer = GameStateSerializer(game)
        return Response(serializer.data)


class RecordVisitView(APIView):
    """Record a cell visit."""

    def post(self, request: Request, game_id: str) -> Response:
        """Handle POST request to record a visit.

        Args:
            request: DRF request with visit data.
            game_id: UUID of the game.

        Returns:
            Response with visit confirmation and updated score.
        """
        game = get_object_or_404(Game, pk=game_id)

        if game.finished_at:
            return Response({"error": "Game is already finished."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = RecordVisitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dwell_s = int((data["exited_at"] - data["entered_at"]).total_seconds())
        if dwell_s < game.min_dwell_s:
            return Response(
                {"error": f"Dwell time {dwell_s}s is less than minimum {game.min_dwell_s}s."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not validate_cell_in_game(game.center.x, game.center.y, game.radius_m, game.grid_size, data["cell_id"]):
            return Response(
                {"error": f"Cell {data['cell_id']} is not in the game's play area."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entry_point = Point(data["lon"], data["lat"], srid=4326)

        visit, created = Visit.objects.update_or_create(
            game=game,
            cell_id=data["cell_id"],
            defaults={
                "entered_at": data["entered_at"],
                "exited_at": data["exited_at"],
                "dwell_s": dwell_s,
                "entry_point": entry_point,
            },
        )

        if not created:
            visit.visit_count += 1
            visit.save(update_fields=["visit_count"])

        visited_count = game.visits.count()
        score_pct = round(visited_count / game.total_cells * 100, 1) if game.total_cells else 0.0

        return Response(
            {
                "ok": True,
                "cell_id": data["cell_id"],
                "visit_count": visit.visit_count,
                "visited_count": visited_count,
                "score_pct": score_pct,
            }
        )


class FinishGameView(APIView):
    """Finish a game."""

    def post(self, request: Request, game_id: str) -> Response:
        """Handle POST request to finish a game.

        Args:
            request: DRF request.
            game_id: UUID of the game.

        Returns:
            Response with final game summary.
        """
        game = get_object_or_404(Game, pk=game_id)

        if game.finished_at:
            return Response({"error": "Game is already finished."}, status=status.HTTP_400_BAD_REQUEST)

        game.finished_at = timezone.now()
        game.save(update_fields=["finished_at"])

        serializer = GameStateSerializer(game)
        return Response(serializer.data)
