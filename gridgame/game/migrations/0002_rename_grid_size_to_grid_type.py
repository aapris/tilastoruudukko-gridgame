"""Rename Game.grid_size to Game.grid_type and convert existing values."""

from django.db import migrations, models


def convert_grid_size_to_grid_type(apps, schema_editor):
    """Convert old grid_size values to new grid_type format."""
    Game = apps.get_model("game", "Game")
    mapping = {"250m": "stat_250m", "1km": "stat_1km", "5km": "stat_5km"}
    for old_value, new_value in mapping.items():
        Game.objects.filter(grid_type=old_value).update(grid_type=new_value)


def convert_grid_type_to_grid_size(apps, schema_editor):
    """Reverse: convert grid_type values back to grid_size format."""
    Game = apps.get_model("game", "Game")
    mapping = {"stat_250m": "250m", "stat_1km": "1km", "stat_5km": "5km"}
    for old_value, new_value in mapping.items():
        Game.objects.filter(grid_type=old_value).update(grid_type=new_value)


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0001_initial"),
    ]

    operations = [
        # Step 1: Rename the field (preserves data)
        migrations.RenameField(
            model_name="game",
            old_name="grid_size",
            new_name="grid_type",
        ),
        # Step 2: Alter field to new max_length and choices
        migrations.AlterField(
            model_name="game",
            name="grid_type",
            field=models.CharField(
                max_length=16,
                choices=[
                    ("stat_250m", "Statistical 250m"),
                    ("stat_1km", "Statistical 1km"),
                    ("stat_5km", "Statistical 5km"),
                    ("h3_res9", "H3 ~175m"),
                    ("h3_res8", "H3 ~460m"),
                    ("h3_res7", "H3 ~1.2km"),
                    ("h3_res6", "H3 ~3.2km"),
                ],
            ),
        ),
        # Step 3: Convert existing values
        migrations.RunPython(
            convert_grid_size_to_grid_type,
            convert_grid_type_to_grid_size,
        ),
    ]
