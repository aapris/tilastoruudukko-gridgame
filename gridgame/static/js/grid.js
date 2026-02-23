/**
 * Grid cell detection using Turf.js point-in-polygon.
 */
const Grid = {
  /**
   * Find which grid cell contains the given coordinates.
   * @param {number} lat - Latitude (WGS84).
   * @param {number} lon - Longitude (WGS84).
   * @param {Object} geojson - GeoJSON FeatureCollection of grid cells.
   * @returns {string|null} cell_id of the matching cell, or null.
   */
  detectCell(lat, lon, geojson) {
    const pt = turf.point([lon, lat]);
    for (const feature of geojson.features) {
      if (turf.booleanPointInPolygon(pt, feature)) {
        return feature.properties.cell_id;
      }
    }
    return null;
  },
};
