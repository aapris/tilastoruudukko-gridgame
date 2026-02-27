"""URL configuration for the board editor."""

from django.urls import path

from game import editor_views


urlpatterns = [
    path("", editor_views.EditorPageView.as_view(), name="editor"),
    path("api/boards/", editor_views.EditorBoardListView.as_view(), name="editor-board-list"),
    path("api/boards/<int:board_id>/", editor_views.EditorBoardDetailView.as_view(), name="editor-board-detail"),
    path(
        "api/boards/<int:board_id>/generate/",
        editor_views.GenerateCellsView.as_view(),
        name="editor-generate-cells",
    ),
    path("api/boards/<int:board_id>/cells/", editor_views.BoardCellsView.as_view(), name="editor-board-cells"),
    path(
        "api/boards/<int:board_id>/cells/toggle/",
        editor_views.ToggleCellsView.as_view(),
        name="editor-toggle-cells",
    ),
    path("api/boards/<int:board_id>/publish/", editor_views.PublishBoardView.as_view(), name="editor-publish-board"),
]
