/**
 * MapLibre GL JS map for the board editor.
 * Handles cell rendering, click-to-toggle, and layer switching.
 */
const EditorMap = {
  map: null,
  _mapReady: null,
  _geojson: null,
  _cellIdToIdx: {},
  _selectedCellIds: new Set(),
  _useOSM: false,
  _onSelectionChange: null,

  /**
   * Initialize the editor map.
   * @param {Function} onSelectionChange - Callback when selection changes.
   */
  init(onSelectionChange) {
    this._onSelectionChange = onSelectionChange;

    this.map = new maplibregl.Map({
      container: 'editor-map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [25.0, 62.0],
      zoom: 5,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this._mapReady = new Promise((resolve) => {
      this.map.on('load', () => {
        this._addOSMSource();
        resolve();
      });
    });

    // Click handler for cell toggle/selection
    this.map.on('click', 'editor-cells-fill', (e) => {
      if (!e.features || !e.features.length) return;
      const cellId = e.features[0].properties.cell_id;
      if (!cellId) return;

      if (e.originalEvent.shiftKey) {
        // Shift+click: toggle selection
        if (this._selectedCellIds.has(cellId)) {
          this._selectedCellIds.delete(cellId);
        } else {
          this._selectedCellIds.add(cellId);
        }
        this._updateSelectionStates();
      } else {
        // Regular click: select only this cell (or deselect if already only selection)
        if (this._selectedCellIds.size === 1 && this._selectedCellIds.has(cellId)) {
          this._selectedCellIds.clear();
        } else {
          this._selectedCellIds.clear();
          this._selectedCellIds.add(cellId);
        }
        this._updateSelectionStates();
      }
      if (this._onSelectionChange) {
        this._onSelectionChange(this._selectedCellIds);
      }
    });

    // Change cursor on cell hover
    this.map.on('mouseenter', 'editor-cells-fill', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'editor-cells-fill', () => {
      this.map.getCanvas().style.cursor = '';
    });
  },

  /**
   * Add OSM raster tile source (hidden by default).
   */
  _addOSMSource() {
    this.map.addSource('osm-raster', {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    this.map.addLayer(
      {
        id: 'osm-raster-layer',
        type: 'raster',
        source: 'osm-raster',
        layout: { visibility: 'none' },
      },
      // Insert below everything else — will be toggled
      this.map.getStyle().layers[0]?.id
    );
  },

  /**
   * Toggle between vector and OSM raster basemap.
   */
  toggleBaseMap() {
    this._useOSM = !this._useOSM;

    // Toggle vector layers visibility
    const style = this.map.getStyle();
    for (const layer of style.layers) {
      if (
        layer.id === 'osm-raster-layer' ||
        layer.id.startsWith('editor-') ||
        layer.id.startsWith('area-')
      ) {
        continue;
      }
      this.map.setLayoutProperty(
        layer.id,
        'visibility',
        this._useOSM ? 'none' : 'visible'
      );
    }

    this.map.setLayoutProperty(
      'osm-raster-layer',
      'visibility',
      this._useOSM ? 'visible' : 'none'
    );

    return this._useOSM;
  },

  /**
   * Show the board's area boundary on the map.
   * @param {Object} geometry - GeoJSON geometry of the area.
   */
  showArea(geometry) {
    this._mapReady.then(() => {
      // Remove old area layers
      if (this.map.getLayer('area-line')) this.map.removeLayer('area-line');
      if (this.map.getLayer('area-fill')) this.map.removeLayer('area-fill');
      if (this.map.getSource('area')) this.map.removeSource('area');

      const feature = { type: 'Feature', geometry, properties: {} };

      this.map.addSource('area', { type: 'geojson', data: feature });
      this.map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': '#4CAF50', 'fill-opacity': 0.05 },
      });
      this.map.addLayer({
        id: 'area-line',
        type: 'line',
        source: 'area',
        paint: { 'line-color': '#4CAF50', 'line-width': 2, 'line-dasharray': [4, 2] },
      });

      // Fit to area bounds
      const bbox = turf.bbox(feature);
      this.map.fitBounds(bbox, { padding: 40 });
    });
  },

  /**
   * Load cells GeoJSON onto the map.
   * @param {Object} geojson - GeoJSON FeatureCollection with is_enabled property.
   */
  loadCells(geojson) {
    this._geojson = geojson;
    this._cellIdToIdx = {};
    this._selectedCellIds.clear();

    geojson.features.forEach((f, i) => {
      f.id = i;
      f.properties._idx = i;
      this._cellIdToIdx[f.properties.cell_id] = i;
    });

    this._mapReady.then(() => {
      // Remove old cell layers
      if (this.map.getLayer('editor-cells-fill')) this.map.removeLayer('editor-cells-fill');
      if (this.map.getLayer('editor-cells-line')) this.map.removeLayer('editor-cells-line');
      if (this.map.getSource('editor-cells')) this.map.removeSource('editor-cells');

      this.map.addSource('editor-cells', {
        type: 'geojson',
        data: geojson,
        promoteId: '_idx',
      });

      this.map.addLayer({
        id: 'editor-cells-fill',
        type: 'fill',
        source: 'editor-cells',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#2196F3',
            ['boolean', ['feature-state', 'disabled'], false],
            '#f44336',
            '#4CAF50',
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.6,
            ['boolean', ['feature-state', 'disabled'], false],
            0.3,
            0.4,
          ],
        },
      });

      this.map.addLayer({
        id: 'editor-cells-line',
        type: 'line',
        source: 'editor-cells',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#2196F3',
            ['boolean', ['feature-state', 'disabled'], false],
            '#f44336',
            '#4CAF50',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.5,
            1,
          ],
          'line-opacity': 0.8,
        },
      });

      // Set initial disabled states
      geojson.features.forEach((f) => {
        if (!f.properties.is_enabled) {
          this.map.setFeatureState(
            { source: 'editor-cells', id: f.properties._idx },
            { disabled: true }
          );
        }
      });
    });
  },

  /**
   * Update feature states after toggling cells (called after API response).
   * @param {Array<string>} cellIds - Cell IDs that were toggled.
   * @param {boolean} isEnabled - New enabled state.
   */
  updateCellStates(cellIds, isEnabled) {
    if (!this._geojson) return;

    for (const cellId of cellIds) {
      const idx = this._cellIdToIdx[cellId];
      if (idx === undefined) continue;

      // Update geojson data
      this._geojson.features[idx].properties.is_enabled = isEnabled;

      this.map.setFeatureState(
        { source: 'editor-cells', id: idx },
        { disabled: !isEnabled }
      );
    }
  },

  /**
   * Update selection highlight states.
   */
  _updateSelectionStates() {
    if (!this._geojson) return;

    for (const f of this._geojson.features) {
      const isSelected = this._selectedCellIds.has(f.properties.cell_id);
      this.map.setFeatureState(
        { source: 'editor-cells', id: f.properties._idx },
        { selected: isSelected }
      );
    }
  },

  /**
   * Get the set of currently selected cell IDs.
   * @returns {Set<string>} Selected cell IDs.
   */
  getSelectedCellIds() {
    return new Set(this._selectedCellIds);
  },

  /**
   * Clear all selections.
   */
  clearSelection() {
    this._selectedCellIds.clear();
    this._updateSelectionStates();
  },

  /**
   * Fit map to the loaded cells bounds.
   */
  fitToCells() {
    if (!this._geojson || !this._geojson.features.length) return;
    const bbox = turf.bbox(this._geojson);
    this.map.fitBounds(bbox, { padding: 40 });
  },

  /**
   * Destroy the map and clean up.
   */
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this._mapReady = null;
    this._geojson = null;
    this._cellIdToIdx = {};
    this._selectedCellIds.clear();
  },
};
