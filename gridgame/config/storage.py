"""Custom static files storage that skips post-processing for vendor files."""

from whitenoise.storage import CompressedManifestStaticFilesStorage


class SkipVendorManifestStorage(CompressedManifestStaticFilesStorage):
    """Static files storage that skips post-processing for vendor files.

    Vendor JS libraries (e.g. Leaflet, Turf.js) may reference source map
    files that are not included. Django's ManifestStaticFilesStorage fails
    when it cannot resolve these references. This subclass skips
    post-processing for any file under the ``vendor/`` directory.
    """

    manifest_strict = False

    def post_process(self, paths: dict, dry_run: bool = False, **options: object):  # noqa: ANN401
        """Post-process static files, skipping vendor directory.

        Args:
            paths: Mapping of file paths to storage details.
            dry_run: If True, no actual processing is performed.
            **options: Additional options passed to the parent.

        Yields:
            Tuples of (original_path, processed_path, processed) from the
            parent post_process, excluding vendor files.
        """
        filtered = {path: details for path, details in paths.items() if not path.startswith("vendor/")}
        yield from super().post_process(filtered, dry_run, **options)
