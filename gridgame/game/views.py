"""API views for the grid game."""

from django.contrib.gis.geos import Point
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from game.grid_providers import get_grid_provider
from game.models import Game, Visit
from game.serializers import CreateGameSerializer, GameListSerializer, GameStateSerializer, RecordVisitSerializer


class ListGamesView(APIView):
    """List games for a player token."""

    def get(self, request: Request) -> Response:
        """Handle GET request to list player's games.

        Args:
            request: DRF request with X-Player-Token header.

        Returns:
            Response with list of games.
        """
        player_token = request.headers.get("X-Player-Token")
        if not player_token:
            return Response({"error": "X-Player-Token header is required."}, status=status.HTTP_400_BAD_REQUEST)

        games = Game.objects.filter(player_token=player_token)

        status_filter = request.query_params.get("status")
        if status_filter == "active":
            games = games.filter(finished_at__isnull=True)
        elif status_filter == "finished":
            games = games.filter(finished_at__isnull=False)

        serializer = GameListSerializer(games, many=True)
        return Response(serializer.data)


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

        provider = get_grid_provider(data["grid_type"])
        grid_geojson, total_cells = provider.get_cells_in_radius(
            center_lat=data["center_lat"],
            center_lon=data["center_lon"],
            radius_m=data["radius_m"],
        )

        player_token = request.headers.get("X-Player-Token")
        if not player_token:
            return Response({"error": "X-Player-Token header is required."}, status=status.HTTP_400_BAD_REQUEST)

        game = Game.objects.create(
            player_token=player_token,
            nickname=data["nickname"],
            center=Point(data["center_lon"], data["center_lat"], srid=4326),
            radius_m=data["radius_m"],
            grid_type=data["grid_type"],
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

        Supports ?include_grid=true to re-fetch and include grid GeoJSON
        (needed when resuming a game).

        Args:
            request: DRF request.
            game_id: UUID of the game.

        Returns:
            Response with game state and visits, optionally with grid.
        """
        game = get_object_or_404(Game, pk=game_id)
        serializer = GameStateSerializer(game)
        data = serializer.data

        if request.query_params.get("include_grid") == "true":
            provider = get_grid_provider(game.grid_type)
            grid_geojson, _total = provider.get_cells_in_radius(
                center_lat=game.center.y,
                center_lon=game.center.x,
                radius_m=game.radius_m,
            )
            data["grid"] = grid_geojson
            data["min_dwell_s"] = game.min_dwell_s

        return Response(data)


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

        provider = get_grid_provider(game.grid_type)
        if not provider.validate_cell(game.center.x, game.center.y, game.radius_m, data["cell_id"]):
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
