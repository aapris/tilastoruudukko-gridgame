"""Authentication API views using plain Django (no DRF)."""

import json

from django.contrib.auth import authenticate, login, logout
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from game.models import Game, User


@require_GET
def auth_status(request: HttpRequest) -> JsonResponse:
    """Return the current authentication status.

    Args:
        request: Django HTTP request.

    Returns:
        JsonResponse with authenticated flag and username.
    """
    if request.user.is_authenticated:
        return JsonResponse({"authenticated": True, "username": request.user.username})
    return JsonResponse({"authenticated": False, "username": None})


@require_POST
def auth_register(request: HttpRequest) -> JsonResponse:
    """Register a new user and auto-login.

    Args:
        request: Django HTTP request with JSON body (username, password).

    Returns:
        JsonResponse with success or error.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return JsonResponse({"error": "Username and password are required."}, status=400)

    if len(username) > 150:
        return JsonResponse({"error": "Username too long (max 150 characters)."}, status=400)

    if len(password) < 8:
        return JsonResponse({"error": "Password must be at least 8 characters."}, status=400)

    if User.objects.filter(username=username).exists():
        return JsonResponse({"error": "Username already taken."}, status=409)

    user = User.objects.create_user(username=username, password=password)
    login(request, user)
    return JsonResponse({"authenticated": True, "username": user.username}, status=201)


@require_POST
def auth_login(request: HttpRequest) -> JsonResponse:
    """Login with username and password.

    Args:
        request: Django HTTP request with JSON body (username, password).

    Returns:
        JsonResponse with success or error.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    username = data.get("username", "").strip()
    password = data.get("password", "")

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Invalid username or password."}, status=401)

    login(request, user)
    return JsonResponse({"authenticated": True, "username": user.username})


@require_POST
def auth_logout(request: HttpRequest) -> JsonResponse:
    """Logout the current user.

    Args:
        request: Django HTTP request.

    Returns:
        JsonResponse confirming logout.
    """
    logout(request)
    return JsonResponse({"authenticated": False})


@require_POST
def auth_claim(request: HttpRequest) -> JsonResponse:
    """Link anonymous games (by player_token) to the authenticated user.

    Args:
        request: Django HTTP request with JSON body (player_token).

    Returns:
        JsonResponse with the number of games claimed.
    """
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    player_token = data.get("player_token", "")
    if not player_token:
        return JsonResponse({"error": "player_token is required."}, status=400)

    claimed = Game.objects.filter(player_token=player_token, user__isnull=True).update(user=request.user)
    return JsonResponse({"claimed": claimed})
