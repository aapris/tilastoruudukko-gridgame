"""URL configuration for the game API."""

from django.urls import path

from game import auth_views, views


urlpatterns = [
    path("boards/", views.BoardListView.as_view(), name="list-boards"),
    path("games/", views.CreateGameView.as_view(), name="create-game"),
    path("games/list/", views.ListGamesView.as_view(), name="list-games"),
    path("games/<uuid:game_id>/", views.GameStateView.as_view(), name="game-state"),
    path("games/<uuid:game_id>/visits/", views.RecordVisitView.as_view(), name="record-visit"),
    path("games/<uuid:game_id>/finish/", views.FinishGameView.as_view(), name="finish-game"),
    path("games/<uuid:game_id>/delete/", views.DeleteGameView.as_view(), name="delete-game"),
    # Auth
    path("auth/status/", auth_views.auth_status, name="auth-status"),
    path("auth/register/", auth_views.auth_register, name="auth-register"),
    path("auth/login/", auth_views.auth_login, name="auth-login"),
    path("auth/logout/", auth_views.auth_logout, name="auth-logout"),
    path("auth/claim/", auth_views.auth_claim, name="auth-claim"),
]
