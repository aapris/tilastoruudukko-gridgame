/**
 * MapLibre GL JS map setup and layer management.
 * Uses OpenFreeMap vector tiles.
 */
const GameMap = {
  map: null,
  _mapReady: null, // Promise resolved when map style is loaded
  _gridSourceId: 'grid-cells',
  _visitedCellIds: new Set(),
  _currentCellId: null,
  _useOSM: false,
  _cellReportCounts: {},   // { cell_id: count }
  _activePopup: null,

  // Picker state
  pickerMap: null,
  _pickerReady: null,
  _pickerMarker: null,
  _pickerPlayerPos: null,
  pickerCenter: null,
  pickerRadiusM: null,
  _pickerUseOSM: false,

  // Game player marker
  _playerMarker: null,

  // Distance line (player -> map center when panned away)
  _playerLngLat: null,
  _distanceLineSourceId: 'distance-line',
  _distanceLineLayerId: 'distance-line-layer',
  _distanceLabelMarker: null,

  // Heading (direction of travel) for the player arrow
  _lastHeading: 0,

  // Recent-positions track
  _trackPoints: [],       // [{ lon, lat, t }]  (t = epoch ms)
  _trackSeconds: 600,
  _trackSourceId: 'track-line',
  _trackLayerId: 'track-line-layer',

  // Auto-center settings
  _autoCenterEnabled: true,
  _userMoved: false,
  _recenterTimer: null,
  _recenterDelayS: 15,

  /**
   * Initialize the picker map with a radius circle.
   * @param {number} lat - Player's GPS latitude.
   * @param {number} lon - Player's GPS longitude.
   * @param {number} radiusM - Play area radius in meters.
   */
  initPicker(lat, lon, radiusM) {
    this.pickerRadiusM = radiusM;
    this.pickerCenter = { lat, lon };
    this._pickerPlayerPos = { lat, lon };

    this.pickerMap = new maplibregl.Map({
      container: 'picker-map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [lon, lat],
      zoom: 14,
    });

    this._pickerUseOSM = false;
    this._pickerReady = new Promise((resolve) => {
      this.pickerMap.on('load', () => {
        this._addOSMSource(this.pickerMap);
        resolve();
      });
    });

    // Player position marker (blue dot)
    const playerEl = this._createDotMarker('#2196F3');
    this._pickerMarker = new maplibregl.Marker({ element: playerEl })
      .setLngLat([lon, lat])
      .addTo(this.pickerMap);

    this._pickerReady.then(() => {
      // Play area circle
      this._addPickerCircle(lat, lon, radiusM);

      // Fit to circle bounds
      const bbox = turf.bbox(turf.circle([lon, lat], radiusM / 1000, { units: 'kilometers' }));
      this.pickerMap.fitBounds(bbox, { padding: 20 });
    });

    // Click handler
    this.pickerMap.on('click', (e) => this._onPickerClick(e));
  },

  /**
   * Add or update the play area circle on picker map.
   * @param {number} lat - Circle center latitude.
   * @param {number} lon - Circle center longitude.
   * @param {number} radiusM - Radius in meters.
   */
  _addPickerCircle(lat, lon, radiusM) {
    const circle = turf.circle([lon, lat], radiusM / 1000, {
      steps: 64,
      units: 'kilometers',
    });

    if (this.pickerMap.getSource('picker-circle')) {
      this.pickerMap.getSource('picker-circle').setData(circle);
    } else {
      this.pickerMap.addSource('picker-circle', {
        type: 'geojson',
        data: circle,
      });
      this.pickerMap.addLayer({
        id: 'picker-circle-fill',
        type: 'fill',
        source: 'picker-circle',
        paint: {
          'fill-color': '#4CAF50',
          'fill-opacity': 0.1,
        },
      });
      this.pickerMap.addLayer({
        id: 'picker-circle-line',
        type: 'line',
        source: 'picker-circle',
        paint: {
          'line-color': '#4CAF50',
          'line-width': 2,
        },
      });
    }
  },

  /**
   * Handle map click in picker mode.
   * @param {Object} e - MapLibre click event.
   * @returns {boolean} Whether the click was accepted.
   */
  _onPickerClick(e) {
    const clickedLngLat = e.lngLat;
    const playerPos = this._pickerPlayerPos;

    const from = turf.point([playerPos.lon, playerPos.lat]);
    const to = turf.point([clickedLngLat.lng, clickedLngLat.lat]);
    const distance = turf.distance(from, to, { units: 'meters' });

    if (distance > this.pickerRadiusM) {
      return false;
    }

    this.pickerCenter = { lat: clickedLngLat.lat, lon: clickedLngLat.lng };
    this._addPickerCircle(clickedLngLat.lat, clickedLngLat.lng, this.pickerRadiusM);

    const bbox = turf.bbox(
      turf.circle([clickedLngLat.lng, clickedLngLat.lat], this.pickerRadiusM / 1000, { units: 'kilometers' })
    );
    this.pickerMap.fitBounds(bbox, { padding: 20 });

    return true;
  },

  /**
   * Update the player position marker during picker mode.
   * @param {number} lat - Current latitude.
   * @param {number} lon - Current longitude.
   */
  updatePickerPosition(lat, lon) {
    this._pickerPlayerPos = { lat, lon };
    if (this._pickerMarker) {
      this._pickerMarker.setLngLat([lon, lat]);
    }
  },

  /**
   * Get the player position on the picker map (for distance checks in app.js).
   * @returns {{lat: number, lon: number}} Player position.
   */
  getPickerPlayerPos() {
    return this._pickerPlayerPos;
  },

  /**
   * Get the currently selected picker center.
   * @returns {{lat: number, lon: number}} Center coordinates.
   */
  getPickerCenter() {
    return this.pickerCenter;
  },

  /**
   * Destroy the picker map and clean up resources.
   */
  destroyPicker() {
    if (this.pickerMap) {
      this.pickerMap.remove();
      this.pickerMap = null;
    }
    this._pickerReady = null;
    this._pickerMarker = null;
    this._pickerPlayerPos = null;
    this.pickerCenter = null;
    this.pickerRadiusM = null;
  },

  /**
   * Destroy the game map and clean up resources.
   */
  destroy() {
    clearTimeout(this._recenterTimer);
    this._recenterTimer = null;
    this._userMoved = false;
    if (this._distanceLabelMarker) {
      this._distanceLabelMarker.remove();
      this._distanceLabelMarker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this._mapReady = null;
    this._playerMarker = null;
    this._playerLngLat = null;
    this._lastHeading = 0;
    this._trackPoints = [];
    this._visitedCellIds = new Set();
    this._currentCellId = null;
  },

  /**
   * Initialize the MapLibre game map.
   * @param {number} lat - Initial center latitude.
   * @param {number} lon - Initial center longitude.
   */
  init(lat, lon) {
    this.destroy();

    this.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [lon, lat],
      zoom: 14,
    });

    // Move zoom control to top-right
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Scale bar in the bottom-right corner (lifted above the HUD via CSS)
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right');

    // Redraw the distance line whenever the viewport center changes
    this.map.on('move', () => this._updateDistanceLine());

    this._useOSM = false;
    this._mapReady = new Promise((resolve) => {
      this.map.on('load', () => {
        this._addOSMSource(this.map);
        resolve();
      });
    });

    // Detect user-initiated map moves (e.originalEvent is set only for interaction events)
    this.map.on('movestart', (e) => {
      if (!e.originalEvent) return;
      this._userMoved = true;
      clearTimeout(this._recenterTimer);
      this._recenterTimer = null;
      if (this._autoCenterEnabled) {
        this._recenterTimer = setTimeout(() => {
          this._userMoved = false;
          this._recenterTimer = null;
        }, this._recenterDelayS * 1000);
      }
    });
  },

  /**
   * Add grid cells GeoJSON to the map.
   * @param {Object} geojson - GeoJSON FeatureCollection.
   * @param {Object} visitedCells - Map of cell_id -> visit info.
   */
  loadGrid(geojson, visitedCells) {
    this._visitedCellIds = new Set(Object.keys(visitedCells));
    this._currentCellId = null;

    // Assign unique numeric IDs for feature-state
    geojson.features.forEach((f, i) => {
      f.id = i;
      f.properties._idx = i;
    });

    // Build a lookup from cell_id to feature index
    this._cellIdToIdx = {};
    geojson.features.forEach((f, i) => {
      this._cellIdToIdx[f.properties.cell_id] = i;
    });

    this._mapReady.then(() => {
      // Remove old layers/source if they exist
      if (this.map.getLayer('grid-fill')) this.map.removeLayer('grid-fill');
      if (this.map.getLayer('grid-line')) this.map.removeLayer('grid-line');
      if (this.map.getLayer('grid-highlight')) this.map.removeLayer('grid-highlight');
      if (this.map.getSource(this._gridSourceId)) this.map.removeSource(this._gridSourceId);

      this.map.addSource(this._gridSourceId, {
        type: 'geojson',
        data: geojson,
        promoteId: '_idx',
      });

      // Fill layer for visited cells
      this.map.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: this._gridSourceId,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'visited'], false],
            '#4CAF50',
            ['boolean', ['feature-state', 'reported'], false],
            '#f44336',
            '#4CAF50',
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'visited'], false],
            0.28,
            ['boolean', ['feature-state', 'reported'], false],
            0.15,
            0,
          ],
        },
      });

      // Border lines for all cells
      this.map.addLayer({
        id: 'grid-line',
        type: 'line',
        source: this._gridSourceId,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'current'], false],
            '#FF9800',
            ['boolean', ['feature-state', 'reported'], false],
            '#f44336',
            ['boolean', ['feature-state', 'visited'], false],
            '#2E7D32',
            '#2196F3',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'current'], false],
            3,
            ['boolean', ['feature-state', 'reported'], false],
            2,
            ['boolean', ['feature-state', 'visited'], false],
            2,
            1,
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'current'], false],
            1,
            ['boolean', ['feature-state', 'reported'], false],
            0.8,
            ['boolean', ['feature-state', 'visited'], false],
            0.95,
            0.35,
          ],
        },
      });

      // Set initial visited states
      for (const cellId of this._visitedCellIds) {
        const idx = this._cellIdToIdx[cellId];
        if (idx !== undefined) {
          this.map.setFeatureState(
            { source: this._gridSourceId, id: idx },
            { visited: true }
          );
        }
      }

      // Set initial reported states
      for (const [cellId, count] of Object.entries(this._cellReportCounts)) {
        const idx = this._cellIdToIdx[cellId];
        if (idx !== undefined && count > 0) {
          this.map.setFeatureState(
            { source: this._gridSourceId, id: idx },
            { reported: true }
          );
        }
      }

      // Cell click handler for popup
      this.map.on('click', 'grid-fill', (e) => this._onCellClick(e));
      this.map.on('click', 'grid-line', (e) => this._onCellClick(e));

      // Change cursor on hover
      this.map.on('mouseenter', 'grid-fill', () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', 'grid-fill', () => {
        this.map.getCanvas().style.cursor = '';
      });

      // Fit to grid bounds
      const bbox = turf.bbox(geojson);
      this.map.fitBounds(bbox, { padding: 20 });
    });
  },

  /**
   * Set report counts for cells (called when grid data is loaded).
   * @param {Object} reportCounts - Map of cell_id -> report count.
   */
  setReportCounts(reportCounts) {
    this._cellReportCounts = reportCounts || {};
  },

  /**
   * Handle cell click — show info popup.
   * @param {Object} e - MapLibre click event.
   */
  _onCellClick(e) {
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const cellId = feature.properties.cell_id;
    const lngLat = e.lngLat;

    // Close existing popup
    if (this._activePopup) {
      this._activePopup.remove();
      this._activePopup = null;
    }

    const visited = this._visitedCellIds.has(cellId);
    const reportCount = this._cellReportCounts[cellId] || 0;

    // Build popup content
    const container = document.createElement('div');
    container.className = 'cell-popup';

    const title = document.createElement('div');
    title.className = 'cell-popup-title';
    title.textContent = cellId;
    container.appendChild(title);

    if (visited) {
      const info = document.createElement('div');
      info.className = 'cell-popup-info';
      info.textContent = 'Visited';
      container.appendChild(info);
    }

    if (reportCount > 0) {
      const info = document.createElement('div');
      info.className = 'cell-popup-reports';
      info.textContent = `${reportCount} report${reportCount !== 1 ? 's' : ''}`;
      container.appendChild(info);
    }

    const reportBtn = document.createElement('button');
    reportBtn.className = 'cell-popup-btn';
    reportBtn.textContent = reportCount > 0 ? 'Update report' : 'Report inaccessible';
    reportBtn.addEventListener('click', () => {
      this._showReportForm(container, cellId);
    });
    container.appendChild(reportBtn);

    this._activePopup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setDOMContent(container)
      .addTo(this.map);
  },

  /**
   * Show the report form inside the popup.
   * @param {HTMLElement} container - Popup container element.
   * @param {string} cellId - Cell ID being reported.
   */
  _showReportForm(container, cellId) {
    // Replace popup content with form
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'cell-popup-title';
    title.textContent = 'Report inaccessible';
    container.appendChild(title);

    const form = document.createElement('div');
    form.className = 'cell-popup-form';

    // Reason select
    const reasonLabel = document.createElement('label');
    reasonLabel.textContent = 'Reason';
    form.appendChild(reasonLabel);

    const reasonSelect = document.createElement('select');
    reasonSelect.className = 'cell-popup-select';
    const reasons = [
      ['dangerous', 'Dangerous'],
      ['no_ground_access', 'No ground access'],
      ['closed', 'Closed'],
      ['restricted', 'Restricted'],
      ['other', 'Other'],
    ];
    for (const [value, label] of reasons) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      reasonSelect.appendChild(opt);
    }
    form.appendChild(reasonSelect);

    // Comment textarea
    const commentLabel = document.createElement('label');
    commentLabel.textContent = 'Comment (optional)';
    form.appendChild(commentLabel);

    const commentInput = document.createElement('textarea');
    commentInput.className = 'cell-popup-textarea';
    commentInput.maxLength = 200;
    commentInput.rows = 2;
    commentInput.placeholder = 'Why is this cell inaccessible?';
    form.appendChild(commentInput);

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'cell-popup-btn cell-popup-btn-submit';
    submitBtn.textContent = 'Submit';
    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      try {
        // Get grid_type from the app state
        const gridType = App.state.gridType;
        const result = await API.reportCell(cellId, gridType, reasonSelect.value, commentInput.value);

        // Update local report count and feature state
        this._cellReportCounts[cellId] = result.total_reports;
        const idx = this._cellIdToIdx[cellId];
        if (idx !== undefined) {
          this.map.setFeatureState(
            { source: this._gridSourceId, id: idx },
            { reported: true }
          );
        }

        // Show success
        container.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'cell-popup-info';
        msg.textContent = 'Report submitted. Thank you!';
        container.appendChild(msg);

        setTimeout(() => {
          if (this._activePopup) {
            this._activePopup.remove();
            this._activePopup = null;
          }
        }, 1500);
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
        const errMsg = document.createElement('div');
        errMsg.className = 'cell-popup-error';
        errMsg.textContent = err.message;
        form.appendChild(errMsg);
      }
    });
    form.appendChild(submitBtn);

    container.appendChild(form);
  },

  /**
   * Mark a cell as visited on the map.
   * @param {string} cellId - The cell_id to highlight.
   */
  markCellVisited(cellId) {
    this._visitedCellIds.add(cellId);
    if (!this.map || !this._cellIdToIdx) return;
    const idx = this._cellIdToIdx[cellId];
    if (idx !== undefined) {
      this.map.setFeatureState(
        { source: this._gridSourceId, id: idx },
        { visited: true }
      );
    }
  },

  /**
   * Update the user's position marker on the map.
   * @param {number} lat - Current latitude.
   * @param {number} lon - Current longitude.
   * @param {number|null} heading - Direction of travel in degrees, or null.
   */
  updatePosition(lat, lon, heading) {
    this._playerLngLat = [lon, lat];
    if (!this._playerMarker) {
      const el = this._createArrowMarker('#2196F3');
      this._playerMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([lon, lat])
        .addTo(this.map);
    } else {
      this._playerMarker.setLngLat([lon, lat]);
    }
    // Rotate the arrow toward the direction of travel. GPS heading is null when
    // stationary or unsupported — keep the last known heading in that case.
    if (heading != null && !Number.isNaN(heading)) {
      this._lastHeading = heading;
    }
    this._playerMarker.setRotation(this._lastHeading);
    if (this._autoCenterEnabled && !this._userMoved && this.map) {
      this.map.easeTo({ center: [lon, lat], duration: 500 });
    }
    this._updateDistanceLine();
  },

  /**
   * Ensure the distance-line source and layer exist on the map.
   */
  _ensureDistanceLayers() {
    if (this.map.getSource(this._distanceLineSourceId)) return;
    this.map.addSource(this._distanceLineSourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: this._distanceLineLayerId,
      type: 'line',
      source: this._distanceLineSourceId,
      layout: { 'line-cap': 'round', visibility: 'none' },
      paint: {
        'line-color': '#1976D2',
        'line-width': 2.5,
        'line-dasharray': [2, 1.5],
      },
    });
  },

  /**
   * Hide the distance line and remove its label marker.
   */
  _hideDistanceLine() {
    if (this.map && this.map.getLayer(this._distanceLineLayerId)) {
      this.map.setLayoutProperty(this._distanceLineLayerId, 'visibility', 'none');
    }
    if (this._distanceLabelMarker) {
      this._distanceLabelMarker.remove();
      this._distanceLabelMarker = null;
    }
  },

  /**
   * Format a distance for display: metres below 10 km, kilometres above.
   * @param {number} meters - Distance in metres.
   * @returns {string} Formatted distance with one decimal.
   */
  _formatDistance(meters) {
    if (meters >= 10000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${meters.toFixed(1)} m`;
  },

  /**
   * Draw a line from the player to the map center when the map has been
   * panned away from the player, with a distance label at the center end.
   */
  _updateDistanceLine() {
    if (!this.map || !this._playerLngLat || !this.map.isStyleLoaded()) return;

    const center = this.map.getCenter();
    const playerPx = this.map.project(this._playerLngLat);
    const centerPx = this.map.project(center);
    const pixelDist = Math.hypot(playerPx.x - centerPx.x, playerPx.y - centerPx.y);

    // Map is (almost) centered on the player — nothing to show.
    if (pixelDist < 40) {
      this._hideDistanceLine();
      return;
    }

    this._ensureDistanceLayers();

    const centerLngLat = [center.lng, center.lat];
    this.map.getSource(this._distanceLineSourceId).setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [this._playerLngLat, centerLngLat] },
    });
    this.map.setLayoutProperty(this._distanceLineLayerId, 'visibility', 'visible');

    const meters = turf.distance(turf.point(this._playerLngLat), turf.point(centerLngLat), {
      units: 'meters',
    });

    if (!this._distanceLabelMarker) {
      const el = document.createElement('div');
      el.className = 'distance-label';
      this._distanceLabelMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(centerLngLat)
        .addTo(this.map);
    }
    this._distanceLabelMarker.getElement().textContent = this._formatDistance(meters);
    this._distanceLabelMarker.setLngLat(centerLngLat);
  },

  /**
   * Set how many seconds of recent positions to keep in the track, then redraw.
   * @param {number} seconds - Track length in seconds (0 disables the track).
   */
  setTrackSeconds(seconds) {
    this._trackSeconds = seconds;
    this._pruneAndDrawTrack();
  },

  /**
   * Append the current position to the recent-positions track and redraw it.
   * @param {number} lat - Current latitude.
   * @param {number} lon - Current longitude.
   */
  addTrackPoint(lat, lon) {
    this._trackPoints.push({ lon, lat, t: Date.now() });
    this._pruneAndDrawTrack();
  },

  /**
   * Ensure the track source and layer exist on the map.
   */
  _ensureTrackLayers() {
    if (this.map.getSource(this._trackSourceId)) return;
    this.map.addSource(this._trackSourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: this._trackLayerId,
      type: 'line',
      source: this._trackSourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#e53935',
        'line-width': 2,
        'line-opacity': 0.8,
      },
    });
  },

  /**
   * Drop track points older than the configured window and redraw the line.
   */
  _pruneAndDrawTrack() {
    const cutoff = Date.now() - this._trackSeconds * 1000;
    this._trackPoints = this._trackPoints.filter((p) => p.t >= cutoff);

    if (!this.map || !this.map.isStyleLoaded()) return;
    this._ensureTrackLayers();

    const coords = this._trackSeconds > 0 ? this._trackPoints.map((p) => [p.lon, p.lat]) : [];
    const data =
      coords.length >= 2
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
        : { type: 'FeatureCollection', features: [] };
    this.map.getSource(this._trackSourceId).setData(data);
  },

  /**
   * Enable or disable automatic map centering on the player's position.
   * @param {boolean} enabled - Whether auto-center should be active.
   */
  setAutoCenter(enabled) {
    this._autoCenterEnabled = enabled;
    if (!enabled) {
      clearTimeout(this._recenterTimer);
      this._recenterTimer = null;
      this._userMoved = false;
    }
  },

  /**
   * Set the delay before auto-center resumes after the user pans the map.
   * @param {number} seconds - Delay in seconds.
   */
  setRecenterDelay(seconds) {
    this._recenterDelayS = seconds;
  },

  /**
   * Highlight the currently occupied cell.
   * @param {string|null} cellId - Cell being occupied, or null.
   */
  highlightCurrentCell(cellId) {
    if (!this.map || !this._cellIdToIdx || !this.map.getSource(this._gridSourceId)) return;

    // Remove highlight from previous cell
    if (this._currentCellId !== null) {
      const prevIdx = this._cellIdToIdx[this._currentCellId];
      if (prevIdx !== undefined) {
        this.map.setFeatureState(
          { source: this._gridSourceId, id: prevIdx },
          { current: false }
        );
      }
    }

    // Highlight new cell
    this._currentCellId = cellId;
    if (cellId !== null) {
      const idx = this._cellIdToIdx[cellId];
      if (idx !== undefined) {
        this.map.setFeatureState(
          { source: this._gridSourceId, id: idx },
          { current: true }
        );
      }
    }
  },

  /**
   * Compute the center of a GeoJSON FeatureCollection.
   * @param {Object} geojson - GeoJSON FeatureCollection.
   * @returns {{lat: number, lon: number}} Center point.
   */
  getGeoJSONCenter(geojson) {
    const bbox = turf.bbox(geojson);
    return {
      lat: (bbox[1] + bbox[3]) / 2,
      lon: (bbox[0] + bbox[2]) / 2,
    };
  },

  /**
   * Create a circular DOM marker element.
   * @param {string} color - CSS color.
   * @returns {HTMLElement} Marker element.
   */
  _createDotMarker(color) {
    const el = document.createElement('div');
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = color;
    el.style.border = '2px solid #fff';
    el.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
    return el;
  },

  /**
   * Create a navigation-style arrow marker pointing north (rotation 0).
   * @param {string} color - CSS fill color.
   * @returns {HTMLElement} Marker element containing an SVG arrow.
   */
  _createArrowMarker(color) {
    const el = document.createElement('div');
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))';
    el.innerHTML =
      '<svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      `<path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="${color}" ` +
      'stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    return el;
  },

  /**
   * Add OSM raster tile source to a map (hidden by default).
   * @param {Object} map - MapLibre map instance.
   */
  _addOSMSource(map) {
    map.addSource('osm-raster', {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    map.addLayer(
      {
        id: 'osm-raster-layer',
        type: 'raster',
        source: 'osm-raster',
        layout: { visibility: 'none' },
      },
      map.getStyle().layers[0]?.id
    );
  },

  /**
   * Toggle OSM raster basemap on/off for a given map.
   * @param {Object} map - MapLibre map instance.
   * @param {boolean} showOSM - Whether to show OSM.
   */
  _toggleBaseMap(map, showOSM) {
    const style = map.getStyle();
    for (const layer of style.layers) {
      if (
        layer.id === 'osm-raster-layer' ||
        layer.id.startsWith('grid-') ||
        layer.id.startsWith('picker-')
      ) {
        continue;
      }
      map.setLayoutProperty(layer.id, 'visibility', showOSM ? 'none' : 'visible');
    }
    map.setLayoutProperty('osm-raster-layer', 'visibility', showOSM ? 'visible' : 'none');
  },

  /**
   * Toggle the game map basemap between vector and OSM raster.
   * @returns {boolean} Whether OSM is now active.
   */
  toggleGameBaseMap() {
    this._useOSM = !this._useOSM;
    if (this.map) this._toggleBaseMap(this.map, this._useOSM);
    return this._useOSM;
  },

  /**
   * Set the game map basemap to a specific state.
   * Safe to call before map style is loaded — waits for _mapReady.
   * @param {boolean} useOSM - Whether to use OSM raster tiles.
   */
  setGameBaseMap(useOSM) {
    this._useOSM = useOSM;
    if (this.map && this._mapReady) {
      this._mapReady.then(() => this._toggleBaseMap(this.map, useOSM));
    }
  },

  /**
   * Toggle the picker map basemap between vector and OSM raster.
   * @returns {boolean} Whether OSM is now active.
   */
  togglePickerBaseMap() {
    this._pickerUseOSM = !this._pickerUseOSM;
    if (this.pickerMap) this._toggleBaseMap(this.pickerMap, this._pickerUseOSM);
    return this._pickerUseOSM;
  },
};
