/**
 * Main application entry point and game state machine.
 */
const App = {
  state: {
    gameId: null,
    nickname: null,
    grid: null,
    visitedCells: {},
    currentCellId: null,
    cellEnteredAt: null,
    dwellTimer: null,
    minDwellS: 10,
    totalCells: 0,
  },

  /** DOM element references. */
  els: {},

  /** Initialize the application. */
  init() {
    this.els = {
      setupScreen: document.getElementById('setup-screen'),
      pickerScreen: document.getElementById('picker-screen'),
      gameScreen: document.getElementById('game-screen'),
      resultScreen: document.getElementById('result-screen'),
      setupForm: document.getElementById('setup-form'),
      setupStatus: document.getElementById('setup-status'),
      chooseLocationBtn: document.getElementById('choose-location-btn'),
      pickerStatus: document.getElementById('picker-status'),
      pickerBackBtn: document.getElementById('picker-back-btn'),
      pickerStartBtn: document.getElementById('picker-start-btn'),
      visitedCount: document.getElementById('visited-count'),
      totalCount: document.getElementById('total-count'),
      scorePct: document.getElementById('score-pct'),
      cellStatus: document.getElementById('cell-status'),
      finishBtn: document.getElementById('finish-btn'),
      resultNickname: document.getElementById('result-nickname'),
      resultVisited: document.getElementById('result-visited'),
      resultTotal: document.getElementById('result-total'),
      resultPct: document.getElementById('result-pct'),
      resultTime: document.getElementById('result-time'),
      newGameBtn: document.getElementById('new-game-btn'),
    };

    this.els.setupForm.addEventListener('submit', (e) => this.onChooseLocation(e));
    this.els.pickerBackBtn.addEventListener('click', () => this.onPickerBack());
    this.els.pickerStartBtn.addEventListener('click', () => this.onConfirmStart());
    this.els.finishBtn.addEventListener('click', () => this.onFinishGame());
    this.els.newGameBtn.addEventListener('click', () => this.onNewGame());
  },

  /**
   * Switch the visible screen.
   * @param {string} screenId - ID of the screen element.
   */
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  },

  /**
   * Handle form submission — open the picker screen.
   * @param {Event} e - Submit event.
   */
  async onChooseLocation(e) {
    e.preventDefault();
    this.els.chooseLocationBtn.disabled = true;
    this.els.setupStatus.textContent = 'Getting your location...';

    let position;
    try {
      position = await GPS.getCurrentPosition();
    } catch (err) {
      this.els.setupStatus.textContent = err.message;
      this.els.chooseLocationBtn.disabled = false;
      return;
    }

    const radiusM = parseInt(document.getElementById('radius').value, 10);

    this.showScreen('picker-screen');
    this.els.setupStatus.textContent = '';

    GameMap.initPicker(position.lat, position.lon, radiusM);

    // Live-update player position on picker map
    GPS.start(
      (lat, lon) => GameMap.updatePickerPosition(lat, lon),
      (errMsg) => { this.els.pickerStatus.textContent = errMsg; }
    );

    // Wire up click feedback
    GameMap.pickerMap.on('click', (e) => {
      const playerLatLng = GameMap.pickerPositionMarker.getLatLng();
      const distance = playerLatLng.distanceTo(e.latlng);
      if (distance > radiusM) {
        this.els.pickerStatus.textContent = 'Too far — you must be inside the play area';
      } else {
        this.els.pickerStatus.textContent = 'Play area moved. Tap Start Game to begin!';
      }
    });
  },

  /** Go back from picker to setup screen. */
  onPickerBack() {
    GPS.stop();
    GameMap.destroyPicker();
    this.els.chooseLocationBtn.disabled = false;
    this.showScreen('setup-screen');
  },

  /** Confirm picker selection and create the game. */
  async onConfirmStart() {
    this.els.pickerStartBtn.disabled = true;
    this.els.pickerStatus.textContent = 'Creating game...';

    GPS.stop();

    const center = GameMap.getPickerCenter();
    GameMap.destroyPicker();

    const formData = {
      nickname: document.getElementById('nickname').value,
      center_lat: center.lat,
      center_lon: center.lon,
      radius_m: parseInt(document.getElementById('radius').value, 10),
      grid_type: document.getElementById('grid-type').value,
      min_dwell_s: parseInt(document.getElementById('min-dwell').value, 10),
      time_limit_s: null,
    };

    try {
      const result = await API.createGame(formData);

      this.state.gameId = result.game_id;
      this.state.nickname = formData.nickname;
      this.state.grid = result.grid;
      this.state.totalCells = result.total_cells;
      this.state.minDwellS = result.min_dwell_s;
      this.state.visitedCells = {};
      this.state.currentCellId = null;

      this.showScreen('game-screen');
      this.updateScoreDisplay();

      GameMap.init(center.lat, center.lon);
      GameMap.loadGrid(this.state.grid, this.state.visitedCells);

      GPS.start(
        (lat, lon, accuracy) => this.onPositionUpdate(lat, lon, accuracy),
        (errMsg) => { this.els.cellStatus.textContent = errMsg; }
      );
    } catch (err) {
      this.els.pickerStatus.textContent = `Error: ${err.message}`;
      this.els.pickerStartBtn.disabled = false;
      // Re-init picker so user can try again
      this.showScreen('setup-screen');
      this.els.chooseLocationBtn.disabled = false;
    }
  },

  /**
   * Handle GPS position updates during gameplay.
   * @param {number} lat - Current latitude.
   * @param {number} lon - Current longitude.
   * @param {number} accuracy - GPS accuracy in meters.
   */
  onPositionUpdate(lat, lon, accuracy) {
    GameMap.updatePosition(lat, lon);

    const newCellId = Grid.detectCell(lat, lon, this.state.grid);

    if (newCellId === this.state.currentCellId) return;

    // Left previous cell — cancel pending dwell timer
    if (this.state.dwellTimer) {
      clearTimeout(this.state.dwellTimer);
      this.state.dwellTimer = null;
    }

    this.state.currentCellId = newCellId;
    this.state.cellEnteredAt = new Date();

    GameMap.highlightCurrentCell(newCellId);

    if (newCellId) {
      if (this.state.visitedCells[newCellId]) {
        this.els.cellStatus.textContent = `In cell ${newCellId} (already visited)`;
      } else {
        this.els.cellStatus.textContent = `In cell — waiting ${this.state.minDwellS}s...`;
      }

      const enteredAt = new Date();
      this.state.dwellTimer = setTimeout(
        () => this.onDwellComplete(newCellId, enteredAt, lat, lon),
        this.state.minDwellS * 1000
      );
    } else {
      this.els.cellStatus.textContent = 'Outside grid area';
    }
  },

  /**
   * Called when dwell timer fires — record the visit.
   * @param {string} cellId - The cell that was dwelled in.
   * @param {Date} enteredAt - When the cell was entered.
   * @param {number} lat - Entry latitude.
   * @param {number} lon - Entry longitude.
   */
  async onDwellComplete(cellId, enteredAt, lat, lon) {
    this.state.dwellTimer = null;

    try {
      const result = await API.recordVisit(this.state.gameId, {
        cell_id: cellId,
        entered_at: enteredAt.toISOString(),
        exited_at: new Date().toISOString(),
        lat,
        lon,
      });

      this.state.visitedCells[cellId] = {
        visitCount: result.visit_count,
        dwellS: this.state.minDwellS,
      };

      GameMap.markCellVisited(cellId);
      this.updateScoreDisplay(result.visited_count, result.score_pct);
      this.els.cellStatus.textContent = `Visited ${cellId}!`;
    } catch (err) {
      this.els.cellStatus.textContent = `Visit error: ${err.message}`;
    }
  },

  /**
   * Update the HUD score display.
   * @param {number} [visited] - Number of visited cells.
   * @param {number} [pct] - Score percentage.
   */
  updateScoreDisplay(visited, pct) {
    const v = visited !== undefined ? visited : Object.keys(this.state.visitedCells).length;
    const p = pct !== undefined ? pct : (this.state.totalCells ? (v / this.state.totalCells * 100).toFixed(1) : '0.0');
    this.els.visitedCount.textContent = v;
    this.els.totalCount.textContent = this.state.totalCells;
    this.els.scorePct.textContent = p;
  },

  /** Handle the finish game button. */
  async onFinishGame() {
    this.els.finishBtn.disabled = true;

    try {
      const result = await API.finishGame(this.state.gameId);

      GPS.stop();

      this.els.resultNickname.textContent = result.nickname;
      this.els.resultVisited.textContent = result.visited_count;
      this.els.resultTotal.textContent = result.total_cells;
      this.els.resultPct.textContent = result.score_pct;
      this.els.resultTime.textContent = this.formatTime(result.elapsed_s);

      this.showScreen('result-screen');
    } catch (err) {
      this.els.cellStatus.textContent = `Error: ${err.message}`;
      this.els.finishBtn.disabled = false;
    }
  },

  /** Reset state and go back to the setup screen. */
  onNewGame() {
    GPS.stop();
    if (this.state.dwellTimer) clearTimeout(this.state.dwellTimer);

    this.state = {
      gameId: null,
      nickname: null,
      grid: null,
      visitedCells: {},
      currentCellId: null,
      cellEnteredAt: null,
      dwellTimer: null,
      minDwellS: 10,
      totalCells: 0,
    };

    this.els.chooseLocationBtn.disabled = false;
    this.els.pickerStartBtn.disabled = false;
    this.els.finishBtn.disabled = false;
    this.els.setupStatus.textContent = '';
    this.showScreen('setup-screen');
  },

  /**
   * Format seconds into a human-readable string.
   * @param {number} seconds - Total seconds.
   * @returns {string} Formatted time string (e.g. "1h 23m 45s").
   */
  formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
