"""API views for the grid game."""

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from game.grid_providers import get_grid_provider
from game.models import Board, Game, Visit
from game.serializers import (
    BoardSerializer,
    CreateGameSerializer,
    GameListSerializer,
    GameStateSerializer,
    RecordVisitSerializer,
)


class ListGamesView(APIView):
    """List games for an authenticated user or player token."""

    authentication_classes = [SessionAuthentication]

    def get(self, request: Request) -> Response:
        """Handle GET request to list player's games.

        If authenticated, returns games linked to the user.
        Otherwise falls back to X-Player-Token header.

        Args:
            request: DRF request.

        Returns:
            Response with list of games.
        """
        if request.user.is_authenticated:
            games = Game.objects.filter(user=request.user)
        else:
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


class BoardListView(APIView):
    """List active game boards, optionally ordered by distance from a point."""

    MAX_NEARBY_BOARDS = 10

    def get(self, request: Request) -> Response:
        """Handle GET request to list active boards.

        Accepts optional query parameters ``lat`` and ``lon`` to order boards
        by distance from the user's location to the nearest edge of the board's
        area geometry. When coordinates are provided, results are limited to
        the closest MAX_NEARBY_BOARDS boards.

        Args:
            request: DRF request.

        Returns:
            Response with list of active boards.
        """
        boards = Board.objects.filter(is_active=True).select_related("area")

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")

        if lat is not None and lon is not None:
            try:
                user_point = Point(float(lon), float(lat), srid=4326)
            except (ValueError, TypeError):
                return Response(
                    {"error": "Invalid lat/lon values."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            boards = (
                boards.annotate(distance_m=Distance("area__geometry", user_point))
                .order_by("distance_m")[:self.MAX_NEARBY_BOARDS]
            )

        serializer = BoardSerializer(boards, many=True)
        return Response(serializer.data)


class CreateGameView(APIView):
    """Create a new game session."""

    authentication_classes = [SessionAuthentication]

    def post(self, request: Request) -> Response:
        """Handle POST request to create a game.

        Supports two modes: board-based (board_id) or radius-based (center + radius).
        If authenticated, links the game to the user.

        Args:
            request: DRF request with game creation data.

        Returns:
            Response with game info and grid GeoJSON.
        """
        serializer = CreateGameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        player_token = request.headers.get("X-Player-Token")
        if not player_token:
            return Response({"error": "X-Player-Token header is required."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None

        board_id = data.get("board_id")

        if board_id:
            # Board-based game
            board = get_object_or_404(Board, pk=board_id, is_active=True)
            grid_type = board.grid_type
            provider = get_grid_provider(grid_type)
            play_area = board.area.geometry

            # Use published board cells if available, otherwise compute from area
            board_cells = board.cells.filter(is_enabled=True)
            if board.is_published and board_cells.exists():
                enabled_cell_ids = list(board_cells.values_list("cell_id", flat=True))
                features = []
                for cell_id in enabled_cell_ids:
                    feature = provider.cell_id_to_geojson_feature(cell_id)
                    if feature:
                        features.append(feature)
                grid_geojson = {"type": "FeatureCollection", "features": features}
                total_cells = len(features)
                snapshot_cell_ids = enabled_cell_ids
            else:
                grid_geojson, total_cells = provider.get_cells_in_polygon(play_area)
                snapshot_cell_ids = []

            game = Game.objects.create(
                player_token=player_token,
                user=user,
                nickname=data["nickname"],
                grid_type=grid_type,
                board=board,
                play_area=play_area,
                min_dwell_s=data["min_dwell_s"],
                time_limit_s=data["time_limit_s"],
                total_cells=total_cells,
                snapshot_cell_ids=snapshot_cell_ids,
            )
        else:
            # Radius-based game
            provider = get_grid_provider(data["grid_type"])
            grid_geojson, total_cells = provider.get_cells_in_radius(
                center_lat=data["center_lat"],
                center_lon=data["center_lon"],
                radius_m=data["radius_m"],
            )

            center = Point(data["center_lon"], data["center_lat"], srid=4326)
            # Compute play_area as buffer circle polygon
            center_3067 = center.transform(3067, clone=True)
            buffer_3067 = center_3067.buffer(data["radius_m"])
            buffer_3067.srid = 3067
            play_area = buffer_3067.transform(4326, clone=True)

            game = Game.objects.create(
                player_token=player_token,
                user=user,
                nickname=data["nickname"],
                center=center,
                radius_m=data["radius_m"],
                grid_type=data["grid_type"],
                play_area=play_area,
                min_dwell_s=data["min_dwell_s"],
                time_limit_s=data["time_limit_s"],
                total_cells=total_cells,
            )

        response_data = {
            "game_id": str(game.id),
            "nickname": game.nickname,
            "total_cells": game.total_cells,
            "min_dwell_s": game.min_dwell_s,
            "time_limit_s": game.time_limit_s,
            "started_at": game.started_at.isoformat(),
            "grid": grid_geojson,
        }

        if game.board:
            response_data["board_name"] = game.board.name

        return Response(response_data, status=status.HTTP_201_CREATED)


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

            if game.snapshot_cell_ids:
                # Reconstruct GeoJSON from snapshot (not from current board state)
                features = []
                for cell_id in game.snapshot_cell_ids:
                    feature = provider.cell_id_to_geojson_feature(cell_id)
                    if feature:
                        features.append(feature)
                grid_geojson = {"type": "FeatureCollection", "features": features}
            elif game.play_area:
                grid_geojson, _total = provider.get_cells_in_polygon(game.play_area)
            else:
                grid_geojson, _total = provider.get_cells_in_radius(
                    center_lat=game.center.y,
                    center_lon=game.center.x,
                    radius_m=game.radius_m,
                )
            data["grid"] = grid_geojson
            data["min_dwell_s"] = game.min_dwell_s

        if game.board:
            data["board_name"] = game.board.name

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

        if game.snapshot_cell_ids:
            # Fast set lookup against snapshot
            cell_valid = data["cell_id"] in game.snapshot_cell_ids
        else:
            provider = get_grid_provider(game.grid_type)
            if game.play_area:
                cell_valid = provider.validate_cell_in_polygon(game.play_area, data["cell_id"])
            else:
                cell_valid = provider.validate_cell(game.center.x, game.center.y, game.radius_m, data["cell_id"])
        if not cell_valid:
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


class DeleteGameView(APIView):
    """Delete a game and all its visits."""

    authentication_classes = [SessionAuthentication]

    def delete(self, request: Request, game_id: str) -> Response:
        """Handle DELETE request to remove a game.

        Verifies ownership via authenticated user or player token.

        Args:
            request: DRF request.
            game_id: UUID of the game.

        Returns:
            Response with 204 No Content on success.
        """
        game = get_object_or_404(Game, pk=game_id)

        if request.user.is_authenticated and game.user == request.user:
            game.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        player_token = request.headers.get("X-Player-Token")
        if player_token and str(game.player_token) == player_token:
            game.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response({"error": "Not your game."}, status=status.HTTP_403_FORBIDDEN)
