"""URL configuration for the game API."""

from django.urls import path

from game import views


urlpatterns = [
    path("games/", views.CreateGameView.as_view(), name="create-game"),
    path("games/<uuid:game_id>/", views.GameStateView.as_view(), name="game-state"),
    path("games/<uuid:game_id>/visits/", views.RecordVisitView.as_view(), name="record-visit"),
    path("games/<uuid:game_id>/finish/", views.FinishGameView.as_view(), name="finish-game"),
]
