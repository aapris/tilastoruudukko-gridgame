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
    countdownInterval: null,
    minDwellS: 10,
    totalCells: 0,
    boardName: null,
  },

  /** Persistent user settings. */
  settings: {
    autoCenterEnabled: true,
    recenterDelayS: 15,
    mapStyleOSM: false,
    wakeLockEnabled: true,
  },

  /** Screen Wake Lock sentinel (non-null while lock is held). */
  _wakeLock: null,

  /** Auth state. */
  authState: {
    authenticated: false,
    username: null,
  },

  /** Cached boards list. */
  boards: [],

  /** DOM element references. */
  els: {},

  /** Initialize the application. */
  async init() {
    this.els = {
      lobbyScreen: document.getElementById('lobby-screen'),
      lobbyNewGameBtn: document.getElementById('lobby-new-game-btn'),
      lobbyStatus: document.getElementById('lobby-status'),
      activeGamesSection: document.getElementById('active-games-section'),
      activeGamesList: document.getElementById('active-games-list'),
      finishedGamesSection: document.getElementById('finished-games-section'),
      finishedGamesList: document.getElementById('finished-games-list'),
      setupScreen: document.getElementById('setup-screen'),
      pickerScreen: document.getElementById('picker-screen'),
      gameScreen: document.getElementById('game-screen'),
      resultScreen: document.getElementById('result-screen'),
      boardSelect: document.getElementById('board-select'),
      customAreaFields: document.getElementById('custom-area-fields'),
      setupBackBtn: document.getElementById('setup-back-btn'),
      setupForm: document.getElementById('setup-form'),
      setupStatus: document.getElementById('setup-status'),
      chooseLocationBtn: document.getElementById('choose-location-btn'),
      boardNameDisplay: document.getElementById('board-name'),
      pickerStatus: document.getElementById('picker-status'),
      pickerBackBtn: document.getElementById('picker-back-btn'),
      pickerStartBtn: document.getElementById('picker-start-btn'),
      visitedCount: document.getElementById('visited-count'),
      totalCount: document.getElementById('total-count'),
      scorePct: document.getElementById('score-pct'),
      cellStatus: document.getElementById('cell-status'),
      layerBtn: document.getElementById('layer-btn'),
      pickerLayerBtn: document.getElementById('picker-layer-btn'),
      pauseBtn: document.getElementById('pause-btn'),
      pauseModal: document.getElementById('pause-modal'),
      pauseScore: document.getElementById('pause-score'),
      pauseResumeBtn: document.getElementById('pause-resume-btn'),
      pauseLobbyBtn: document.getElementById('pause-lobby-btn'),
      pauseFinishBtn: document.getElementById('pause-finish-btn'),
      resultNickname: document.getElementById('result-nickname'),
      resultVisited: document.getElementById('result-visited'),
      resultTotal: document.getElementById('result-total'),
      resultPct: document.getElementById('result-pct'),
      resultTime: document.getElementById('result-time'),
      newGameBtn: document.getElementById('new-game-btn'),
      // Settings elements
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      settingsAutoCenter: document.getElementById('settings-auto-center'),
      settingsRecenterDelay: document.getElementById('settings-recenter-delay'),
      settingsRecenterDelayRow: document.getElementById('settings-recenter-delay-row'),
      settingsMapStyle: document.getElementById('settings-map-style'),
      settingsWakeLock: document.getElementById('settings-wake-lock'),
      settingsSaveBtn: document.getElementById('settings-save-btn'),
      settingsCancelBtn: document.getElementById('settings-cancel-btn'),
      // Auth elements
      authBar: document.getElementById('auth-bar'),
      authUser: document.getElementById('auth-user'),
      authLoginBtn: document.getElementById('auth-login-btn'),
      authRegisterBtn: document.getElementById('auth-register-btn'),
      authLogoutBtn: document.getElementById('auth-logout-btn'),
      authModal: document.getElementById('auth-modal'),
      authModalTitle: document.getElementById('auth-modal-title'),
      authForm: document.getElementById('auth-form'),
      authUsername: document.getElementById('auth-username'),
      authPassword: document.getElementById('auth-password'),
      authSubmitBtn: document.getElementById('auth-submit-btn'),
      authCancelBtn: document.getElementById('auth-cancel-btn'),
      authError: document.getElementById('auth-error'),
    };

    this.els.lobbyNewGameBtn.addEventListener('click', () => this.onLobbyNewGame());
    this.els.boardSelect.addEventListener('change', () => this.onBoardSelectChange());
    this.els.setupBackBtn.addEventListener('click', () => this.loadLobby());
    this.els.setupForm.addEventListener('submit', (e) => this.onChooseLocation(e));
    this.els.pickerBackBtn.addEventListener('click', () => this.onPickerBack());
    this.els.pickerStartBtn.addEventListener('click', () => this.onConfirmStart());
    this.els.layerBtn.addEventListener('click', () => {
      this.settings.mapStyleOSM = !this.settings.mapStyleOSM;
      GameMap.setGameBaseMap(this.settings.mapStyleOSM);
      this.saveSettings();
      this._updateLayerBtn();
    });
    this.els.pickerLayerBtn.addEventListener('click', () => {
      const isOSM = GameMap.togglePickerBaseMap();
      this.els.pickerLayerBtn.textContent = isOSM ? 'Vector' : 'OSM';
    });
    this.els.settingsBtn.addEventListener('click', () => this.openSettingsModal());
    this.els.settingsSaveBtn.addEventListener('click', () => this.onSettingsSave());
    this.els.settingsCancelBtn.addEventListener('click', () => this.closeSettingsModal());
    this.els.settingsAutoCenter.addEventListener('change', () => {
      this.els.settingsRecenterDelayRow.style.display = this.els.settingsAutoCenter.checked ? '' : 'none';
    });
    this.els.pauseBtn.addEventListener('click', () => this.onPauseGame());
    this.els.pauseResumeBtn.addEventListener('click', () => this.onResumeFromPause());
    this.els.pauseLobbyBtn.addEventListener('click', () => this.onBackToLobby());
    this.els.pauseFinishBtn.addEventListener('click', () => this.onFinishGame());
    this.els.newGameBtn.addEventListener('click', () => this.onNewGame());

    // Auth event listeners
    this.els.authLoginBtn.addEventListener('click', () => this.showAuthModal('login'));
    this.els.authRegisterBtn.addEventListener('click', () => this.showAuthModal('register'));
    this.els.authLogoutBtn.addEventListener('click', () => this.onLogout());
    this.els.authForm.addEventListener('submit', (e) => this.onAuthSubmit(e));
    this.els.authCancelBtn.addEventListener('click', () => this.hideAuthModal());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state.gameId) {
        this._acquireWakeLock();
      }
    });

    this.loadSettings();
    await this.checkAuth();
    await this.loadLobby();
  },

  /** Load settings from localStorage. */
  loadSettings() {
    const ac = localStorage.getItem('settings_autoCenterEnabled');
    if (ac !== null) this.settings.autoCenterEnabled = ac === 'true';
    const delay = localStorage.getItem('settings_recenterDelayS');
    if (delay !== null) this.settings.recenterDelayS = parseInt(delay, 10);
    const osm = localStorage.getItem('settings_mapStyleOSM');
    if (osm !== null) this.settings.mapStyleOSM = osm === 'true';
    const wl = localStorage.getItem('settings_wakeLockEnabled');
    if (wl !== null) this.settings.wakeLockEnabled = wl === 'true';
  },

  /** Persist settings to localStorage. */
  saveSettings() {
    localStorage.setItem('settings_autoCenterEnabled', this.settings.autoCenterEnabled);
    localStorage.setItem('settings_recenterDelayS', this.settings.recenterDelayS);
    localStorage.setItem('settings_mapStyleOSM', this.settings.mapStyleOSM);
    localStorage.setItem('settings_wakeLockEnabled', this.settings.wakeLockEnabled);
  },

  /** Apply current settings to the map and sync UI. */
  applySettings() {
    GameMap.setAutoCenter(this.settings.autoCenterEnabled);
    GameMap.setRecenterDelay(this.settings.recenterDelayS);
    GameMap.setGameBaseMap(this.settings.mapStyleOSM);
    this._updateLayerBtn();
    if (this.state.gameId) {
      if (this.settings.wakeLockEnabled) {
        this._acquireWakeLock();
      } else {
        this._releaseWakeLock();
      }
    }
  },

  /** Request a Screen Wake Lock if supported and setting is enabled. */
  async _acquireWakeLock() {
    if (!this.settings.wakeLockEnabled) return;
    if (!('wakeLock' in navigator)) return;
    if (this._wakeLock) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener('release', () => {
        this._wakeLock = null;
      });
    } catch {
      // Wake lock may be denied (e.g. low battery); non-critical.
    }
  },

  /** Release the Screen Wake Lock if held. */
  async _releaseWakeLock() {
    if (!this._wakeLock) return;
    try {
      await this._wakeLock.release();
    } catch {
      // Ignore errors on release.
    }
    this._wakeLock = null;
  },

  /** Update the layer button label to reflect current map style. */
  _updateLayerBtn() {
    if (this.els.layerBtn) {
      this.els.layerBtn.textContent = this.settings.mapStyleOSM ? 'Vector' : 'OSM';
    }
  },

  /** Open the settings modal and populate fields with current values. */
  openSettingsModal() {
    this.els.settingsAutoCenter.checked = this.settings.autoCenterEnabled;
    this.els.settingsRecenterDelay.value = this.settings.recenterDelayS;
    this.els.settingsRecenterDelayRow.style.display = this.settings.autoCenterEnabled ? '' : 'none';
    this.els.settingsMapStyle.checked = this.settings.mapStyleOSM;
    this.els.settingsWakeLock.checked = this.settings.wakeLockEnabled;
    this.els.settingsModal.style.display = '';
  },

  /** Close the settings modal without saving. */
  closeSettingsModal() {
    this.els.settingsModal.style.display = 'none';
  },

  /** Save settings from modal, persist and apply. */
  onSettingsSave() {
    this.settings.autoCenterEnabled = this.els.settingsAutoCenter.checked;
    this.settings.recenterDelayS = parseInt(this.els.settingsRecenterDelay.value, 10) || 15;
    this.settings.mapStyleOSM = this.els.settingsMapStyle.checked;
    this.settings.wakeLockEnabled = this.els.settingsWakeLock.checked;
    this.saveSettings();
    this.applySettings();
    this.closeSettingsModal();
  },

  /** Save current setup form values to localStorage for next session. */
  saveFormDefaults() {
    const nickname = document.getElementById('nickname').value.trim();
    if (nickname) localStorage.setItem('pref_nickname', nickname);
    localStorage.setItem('pref_grid_type', document.getElementById('grid-type').value);
    localStorage.setItem('pref_radius_m', document.getElementById('radius').value);
    localStorage.setItem('pref_min_dwell_s', document.getElementById('min-dwell').value);
  },

  /** Restore saved setup form values from localStorage. */
  restoreFormDefaults() {
    const nickname = localStorage.getItem('pref_nickname');
    if (nickname) document.getElementById('nickname').value = nickname;
    const gridType = localStorage.getItem('pref_grid_type');
    if (gridType) document.getElementById('grid-type').value = gridType;
    const radiusM = localStorage.getItem('pref_radius_m');
    if (radiusM) document.getElementById('radius').value = radiusM;
    const minDwellS = localStorage.getItem('pref_min_dwell_s');
    if (minDwellS) document.getElementById('min-dwell').value = minDwellS;
  },

  /** Check authentication status and update UI. */
  async checkAuth() {
    try {
      const status = await API.authStatus();
      this.authState = status;
    } catch {
      this.authState = { authenticated: false, username: null };
    }
    this.updateAuthBar();
  },

  /** Update the auth bar in the lobby header. */
  updateAuthBar() {
    if (this.authState.authenticated) {
      this.els.authUser.textContent = this.authState.username;
      this.els.authLoginBtn.style.display = 'none';
      this.els.authRegisterBtn.style.display = 'none';
      this.els.authLogoutBtn.style.display = '';
    } else {
      this.els.authUser.textContent = '';
      this.els.authLoginBtn.style.display = '';
      this.els.authRegisterBtn.style.display = '';
      this.els.authLogoutBtn.style.display = 'none';
    }
  },

  /**
   * Show the auth modal in login or register mode.
   * @param {string} mode - "login" or "register".
   */
  showAuthModal(mode) {
    this._authMode = mode;
    this.els.authModalTitle.textContent = mode === 'login' ? 'Log in' : 'Register';
    this.els.authSubmitBtn.textContent = mode === 'login' ? 'Log in' : 'Register';
    this.els.authPassword.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    this.els.authUsername.value = '';
    this.els.authPassword.value = '';
    this.els.authError.textContent = '';
    this.els.authModal.style.display = '';
  },

  /** Hide the auth modal. */
  hideAuthModal() {
    this.els.authModal.style.display = 'none';
  },

  /**
   * Handle auth form submission (login or register).
   * @param {Event} e - Submit event.
   */
  async onAuthSubmit(e) {
    e.preventDefault();
    this.els.authSubmitBtn.disabled = true;
    this.els.authError.textContent = '';

    const username = this.els.authUsername.value.trim();
    const password = this.els.authPassword.value;

    try {
      if (this._authMode === 'register') {
        await API.register(username, password);
      } else {
        await API.login(username, password);
      }

      this.hideAuthModal();
      await this.checkAuth();
      await this.offerClaimGames();
      await this.loadLobby();
    } catch (err) {
      this.els.authError.textContent = err.message;
    } finally {
      this.els.authSubmitBtn.disabled = false;
    }
  },

  /** Logout and reload lobby. */
  async onLogout() {
    try {
      await API.logout();
    } catch {
      // ignore
    }
    await this.checkAuth();
    await this.loadLobby();
  },

  /** After login, offer to claim anonymous games from this device. */
  async offerClaimGames() {
    if (!this.authState.authenticated) return;

    try {
      const result = await API.claimGames();
      if (result.claimed > 0) {
        this.els.lobbyStatus.textContent = `${result.claimed} game(s) linked to your account.`;
      }
    } catch {
      // non-critical, ignore
    }
  },

  /**
   * Switch the visible screen.
   * @param {string} screenId - ID of the screen element.
   */
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  },

  /** Load lobby data and show lobby screen. */
  async loadLobby() {
    this.els.lobbyStatus.textContent = 'Loading...';

    try {
      const [active, finished] = await Promise.all([
        API.listGames('active'),
        API.listGames('finished'),
      ]);

      this.renderGameList(this.els.activeGamesList, active, true);
      this.renderGameList(this.els.finishedGamesList, finished, false);

      this.els.activeGamesSection.style.display = active.length ? '' : 'none';
      this.els.finishedGamesSection.style.display = finished.length ? '' : 'none';

      this.els.lobbyStatus.textContent = '';
    } catch {
      this.els.lobbyStatus.textContent = '';
    }

    this.showScreen('lobby-screen');
  },

  /**
   * Render a list of game cards.
   * @param {HTMLElement} container - Container element.
   * @param {Array} games - List of game objects.
   * @param {boolean} isActive - Whether these are active (resumable) games.
   */
  renderGameList(container, games, isActive) {
    container.innerHTML = '';
    for (const game of games) {
      const card = document.createElement('div');
      card.className = 'game-card';

      const date = new Date(game.started_at).toLocaleDateString();
      const gridLabel = game.grid_type.replace('stat_', '').replace('h3_res', 'H3 r');
      const boardLabel = game.board_name ? `${game.board_name} &middot; ` : '';

      card.innerHTML = `
        <div class="game-card-info">
          <strong>${game.nickname}</strong>
          <span class="game-card-meta">${boardLabel}${gridLabel} &middot; ${game.visited_count}/${game.total_cells} (${game.score_pct}%) &middot; ${date}</span>
        </div>
      `;

      if (isActive) {
        const btn = document.createElement('button');
        btn.className = 'game-card-btn';
        btn.textContent = 'Resume';
        btn.addEventListener('click', () => this.onResumeGame(game.game_id));
        card.appendChild(btn);
      } else {
        const delBtn = document.createElement('button');
        delBtn.className = 'game-card-btn game-card-btn-delete';
        delBtn.textContent = '\u2716';
        delBtn.title = 'Delete game';
        delBtn.addEventListener('click', () => this.onDeleteGame(game.game_id, game.nickname));
        card.appendChild(delBtn);
      }

      container.appendChild(card);
    }
  },

  /** Navigate from lobby to setup screen, fetching boards sorted by distance. */
  async onLobbyNewGame() {
    this.showScreen('setup-screen');
    this.restoreFormDefaults();

    // Get user position for distance-based board sorting
    let lat = null;
    let lon = null;
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 5000,
        });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch {
      // GPS unavailable — boards will be listed without distance sorting
    }

    try {
      this.boards = await API.listBoards(lat, lon);
    } catch {
      this.boards = [];
    }

    // Populate board selector
    const sel = this.els.boardSelect;
    sel.innerHTML = '<option value="">Custom area (pick on map)</option>';
    for (const board of this.boards) {
      const opt = document.createElement('option');
      opt.value = board.id;
      const gridLabel = board.grid_type.replace('stat_', '').replace('h3_res', 'H3 r');
      let label = `${board.name} (${gridLabel})`;
      if (board.distance_m !== null && board.distance_m !== undefined) {
        const dist = board.distance_m;
        if (dist < 1) {
          label += ' — inside';
        } else if (dist < 1000) {
          label += ` — ${Math.round(dist)} m`;
        } else {
          label += ` — ${(dist / 1000).toFixed(1)} km`;
        }
      }
      opt.textContent = label;
      sel.appendChild(opt);
    }

    this.onBoardSelectChange();
  },

  /** Toggle custom area fields based on board selection. */
  onBoardSelectChange() {
    const boardSelected = this.els.boardSelect.value !== '';
    this.els.customAreaFields.style.display = boardSelected ? 'none' : '';
    this.els.chooseLocationBtn.textContent = boardSelected ? 'Start Game' : 'Choose Location';
  },

  /**
   * Resume an active game.
   * @param {string} gameId - UUID of the game to resume.
   */
  async onResumeGame(gameId) {
    this.els.lobbyStatus.textContent = 'Loading game...';

    try {
      const result = await API.getGameWithGrid(gameId);
      this._startGame(result, result.visits);
      this.els.lobbyStatus.textContent = '';
    } catch (err) {
      this.els.lobbyStatus.textContent = `Error: ${err.message}`;
    }
  },

  /**
   * Handle form submission — board game starts directly, custom area opens picker.
   * @param {Event} e - Submit event.
   */
  async onChooseLocation(e) {
    e.preventDefault();
    this.els.chooseLocationBtn.disabled = true;
    this.els.setupStatus.textContent = '';
    this.saveFormDefaults();

    const boardId = this.els.boardSelect.value;

    if (boardId) {
      // Board-based: create game directly
      this.els.setupStatus.textContent = 'Creating game...';

      const formData = {
        nickname: document.getElementById('nickname').value,
        board_id: parseInt(boardId, 10),
        min_dwell_s: parseInt(document.getElementById('min-dwell').value, 10),
        time_limit_s: null,
      };

      try {
        const result = await API.createGame(formData);
        this._startGame(result);
      } catch (err) {
        this.els.setupStatus.textContent = `Error: ${err.message}`;
        this.els.chooseLocationBtn.disabled = false;
      }
      return;
    }

    // Custom area: open picker
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
      const playerPos = GameMap.getPickerPlayerPos();
      const from = turf.point([playerPos.lon, playerPos.lat]);
      const to = turf.point([e.lngLat.lng, e.lngLat.lat]);
      const distance = turf.distance(from, to, { units: 'meters' });
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

  /**
   * Start a game from API response data.
   * @param {Object} result - API response from createGame or getGameWithGrid.
   * @param {Object} [visits] - Pre-existing visits (for resume). Defaults to empty.
   */
  _startGame(result, visits) {
    this.state.gameId = result.game_id;
    this.state.nickname = result.nickname;
    this.state.grid = result.grid;
    this.state.totalCells = result.total_cells;
    this.state.minDwellS = result.min_dwell_s;
    this.state.currentCellId = null;
    this.state.boardName = result.board_name || null;

    // Restore or initialize visited cells
    this.state.visitedCells = {};
    if (visits) {
      for (const visit of visits) {
        this.state.visitedCells[visit.cell_id] = {
          visitCount: visit.visit_count,
          dwellS: visit.dwell_s,
        };
      }
    }

    // Use center of grid bounding box for map init
    const center = GameMap.getGeoJSONCenter(this.state.grid);

    this.showScreen('game-screen');
    this.updateScoreDisplay();
    this._updateBoardNameDisplay();

    GameMap.init(center.lat, center.lon);
    this.applySettings();
    GameMap.loadGrid(this.state.grid, this.state.visitedCells);

    GPS.start(
      (lat, lon, accuracy) => this.onPositionUpdate(lat, lon, accuracy),
      (errMsg) => { this.els.cellStatus.textContent = errMsg; }
    );

    this._acquireWakeLock();
  },

  /** Update the board name display in HUD. */
  _updateBoardNameDisplay() {
    this.els.boardNameDisplay.textContent = this.state.boardName || '';
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
      this._startGame(result);
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

    // Left previous cell — cancel pending dwell timer and countdown
    if (this.state.dwellTimer) {
      clearTimeout(this.state.dwellTimer);
      this.state.dwellTimer = null;
    }
    if (this.state.countdownInterval) {
      clearInterval(this.state.countdownInterval);
      this.state.countdownInterval = null;
    }

    this.state.currentCellId = newCellId;
    this.state.cellEnteredAt = new Date();

    GameMap.highlightCurrentCell(newCellId);

    if (newCellId) {
      if (this.state.visitedCells[newCellId]) {
        this.els.cellStatus.textContent = `In cell ${newCellId} (already visited)`;
      } else {
        let remaining = this.state.minDwellS;
        this.els.cellStatus.textContent = `In cell — ${remaining}s...`;
        this.state.countdownInterval = setInterval(() => {
          remaining--;
          if (remaining > 0) {
            this.els.cellStatus.textContent = `In cell — ${remaining}s...`;
          } else {
            clearInterval(this.state.countdownInterval);
            this.state.countdownInterval = null;
          }
        }, 1000);
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

  /** Pause the game — stop GPS and show pause modal. */
  onPauseGame() {
    this._releaseWakeLock();
    GPS.stop();
    if (this.state.dwellTimer) {
      clearTimeout(this.state.dwellTimer);
      this.state.dwellTimer = null;
    }
    if (this.state.countdownInterval) {
      clearInterval(this.state.countdownInterval);
      this.state.countdownInterval = null;
    }
    this.state.currentCellId = null;

    const visited = Object.keys(this.state.visitedCells).length;
    const pct = this.state.totalCells ? (visited / this.state.totalCells * 100).toFixed(1) : '0.0';
    this.els.pauseScore.textContent = `${visited} / ${this.state.totalCells} (${pct}%)`;
    this.els.pauseModal.style.display = '';
    this.els.pauseFinishBtn.disabled = false;
  },

  /** Resume from pause — restart GPS and hide modal. */
  onResumeFromPause() {
    this.els.pauseModal.style.display = 'none';
    this.els.cellStatus.textContent = '';
    GPS.start(
      (lat, lon, accuracy) => this.onPositionUpdate(lat, lon, accuracy),
      (errMsg) => { this.els.cellStatus.textContent = errMsg; }
    );
    this._acquireWakeLock();
  },

  /** Go back to lobby without finishing — game stays active. */
  onBackToLobby() {
    this.els.pauseModal.style.display = 'none';
    this.onNewGame();
  },

  /** Finish the game permanently. */
  async onFinishGame() {
    this.els.pauseFinishBtn.disabled = true;

    try {
      const result = await API.finishGame(this.state.gameId);

      GPS.stop();
      this._releaseWakeLock();
      this.els.pauseModal.style.display = 'none';

      this.els.resultNickname.textContent = result.nickname;
      this.els.resultVisited.textContent = result.visited_count;
      this.els.resultTotal.textContent = result.total_cells;
      this.els.resultPct.textContent = result.score_pct;
      this.els.resultTime.textContent = this.formatTime(result.elapsed_s);

      this.showScreen('result-screen');
    } catch (err) {
      this.els.pauseModal.style.display = 'none';
      this.els.cellStatus.textContent = `Error: ${err.message}`;
    }
  },

  /** Reset state and go back to the lobby screen. */
  onNewGame() {
    GPS.stop();
    this._releaseWakeLock();
    GameMap.destroy();
    if (this.state.dwellTimer) clearTimeout(this.state.dwellTimer);
    if (this.state.countdownInterval) clearInterval(this.state.countdownInterval);

    this.state = {
      gameId: null,
      nickname: null,
      grid: null,
      visitedCells: {},
      currentCellId: null,
      cellEnteredAt: null,
      dwellTimer: null,
      countdownInterval: null,
      minDwellS: 10,
      totalCells: 0,
      boardName: null,
    };

    this.els.chooseLocationBtn.disabled = false;
    this.els.pickerStartBtn.disabled = false;
    this.els.setupStatus.textContent = '';
    this.loadLobby();
  },

  /**
   * Delete a finished game after confirmation.
   * @param {string} gameId - UUID of the game.
   * @param {string} nickname - Player nickname for confirmation message.
   */
  async onDeleteGame(gameId, nickname) {
    if (!confirm(`Delete game by ${nickname}? This cannot be undone.`)) return;

    try {
      await API.deleteGame(gameId);
      await this.loadLobby();
    } catch (err) {
      this.els.lobbyStatus.textContent = `Error: ${err.message}`;
    }
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
