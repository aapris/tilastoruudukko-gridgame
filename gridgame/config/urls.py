"""URL configuration for the grid game project."""

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.urls import include, path
from django.views.decorators.csrf import ensure_csrf_cookie


@ensure_csrf_cookie
def index_view(request: HttpRequest) -> HttpResponse:
    """Serve the main SPA shell with CSRF cookie set.

    Args:
        request: Django HTTP request.

    Returns:
        Rendered index.html template.
    """
    return render(request, "index.html")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(template_name="login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("editor/", include("game.editor_urls")),
    path("api/v1/", include("game.urls")),
    path("", index_view, name="index"),
]
