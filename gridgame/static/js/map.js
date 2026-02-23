/**
 * Leaflet map setup and layer management.
 */
const GameMap = {
  map: null,
  gridLayer: null,
  positionMarker: null,

  /**
   * Initialize the Leaflet map.
   * @param {number} lat - Initial center latitude.
   * @param {number} lon - Initial center longitude.
   */
  init(lat, lon) {
    // Fix Leaflet icon paths for static serving
    L.Icon.Default.imagePath = '/static/vendor/leaflet/';

    this.map = L.map('map', {
      zoomControl: false,
    }).setView([lat, lon], 14);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);
  },

  /**
   * Add grid cells GeoJSON to the map.
   * @param {Object} geojson - GeoJSON FeatureCollection.
   * @param {Object} visitedCells - Map of cell_id -> visit info.
   */
  loadGrid(geojson, visitedCells) {
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
    }

    this.gridLayer = L.geoJSON(geojson, {
      style: (feature) => {
        const visited = visitedCells[feature.properties.cell_id];
        return {
          fillColor: visited ? '#4CAF50' : 'transparent',
          fillOpacity: visited ? 0.5 : 0,
          color: '#2196F3',
          weight: 1,
          opacity: 0.6,
        };
      },
    }).addTo(this.map);

    this.map.fitBounds(this.gridLayer.getBounds(), { padding: [20, 20] });
  },

  /**
   * Mark a cell as visited on the map.
   * @param {string} cellId - The cell_id to highlight.
   */
  markCellVisited(cellId) {
    if (!this.gridLayer) return;
    this.gridLayer.eachLayer((layer) => {
      if (layer.feature.properties.cell_id === cellId) {
        layer.setStyle({ fillColor: '#4CAF50', fillOpacity: 0.5 });
      }
    });
  },

  /**
   * Update the user's position marker on the map.
   * @param {number} lat - Current latitude.
   * @param {number} lon - Current longitude.
   */
  updatePosition(lat, lon) {
    if (!this.positionMarker) {
      this.positionMarker = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: '#2196F3',
        fillOpacity: 1,
        color: '#fff',
        weight: 2,
      }).addTo(this.map);
    } else {
      this.positionMarker.setLatLng([lat, lon]);
    }
  },

  /**
   * Highlight the currently occupied cell.
   * @param {string|null} cellId - Cell being occupied, or null.
   */
  highlightCurrentCell(cellId) {
    if (!this.gridLayer) return;
    this.gridLayer.eachLayer((layer) => {
      const id = layer.feature.properties.cell_id;
      if (id === cellId) {
        layer.setStyle({ color: '#FF9800', weight: 3, opacity: 1 });
      } else {
        // Reset to default unless visited
        const isVisited = App.state.visitedCells[id];
        layer.setStyle({
          color: '#2196F3',
          weight: 1,
          opacity: 0.6,
          fillColor: isVisited ? '#4CAF50' : 'transparent',
          fillOpacity: isVisited ? 0.5 : 0,
        });
      }
    });
  },
};
