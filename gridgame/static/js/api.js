/**
 * API client — fetch wrappers for all game endpoints.
 * Manages a persistent player token in localStorage.
 */
const API = {
  baseUrl: '/api',

  /**
   * Get or create a persistent player token.
   * @returns {string} UUID player token.
   */
  getPlayerToken() {
    let token = localStorage.getItem('playerToken');
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem('playerToken', token);
    }
    return token;
  },

  /**
   * Read the CSRF token from Django's csrftoken cookie.
   * @returns {string|null} CSRF token or null.
   */
  _getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  },

  /**
   * Build common headers for all requests.
   * @returns {Object} Headers object.
   */
  _headers() {
    const headers = {
      'Content-Type': 'application/json',
      'X-Player-Token': this.getPlayerToken(),
    };
    const csrf = this._getCsrfToken();
    if (csrf) {
      headers['X-CSRFToken'] = csrf;
    }
    return headers;
  },

  /**
   * List active game boards, optionally sorted by distance.
   * @param {number|null} lat - User latitude for distance sorting.
   * @param {number|null} lon - User longitude for distance sorting.
   * @returns {Promise<Array>} List of board objects.
   */
  async listBoards(lat = null, lon = null) {
    let url = `${this.baseUrl}/boards/`;
    if (lat !== null && lon !== null) {
      url += `?lat=${lat}&lon=${lon}`;
    }
    const resp = await fetch(url, {
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to list boards');
    return resp.json();
  },

  /**
   * List games for the current player.
   * @param {string} [statusFilter] - "active" or "finished", or omit for all.
   * @param {number|null} [lat] - User latitude for distance sorting.
   * @param {number|null} [lon] - User longitude for distance sorting.
   * @returns {Promise<Array>} List of game summaries.
   */
  async listGames(statusFilter, lat = null, lon = null) {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (lat !== null && lon !== null) {
      params.set('lat', lat);
      params.set('lon', lon);
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(`${this.baseUrl}/games/list/${qs}`, {
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to list games');
    return resp.json();
  },

  /**
   * Create a new game.
   * @param {Object} data - Game creation parameters.
   * @returns {Promise<Object>} Game data with grid GeoJSON.
   */
  async createGame(data) {
    const resp = await fetch(`${this.baseUrl}/games/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || err.error || JSON.stringify(err));
    }
    return resp.json();
  },

  /**
   * Get game state.
   * @param {string} gameId - UUID of the game.
   * @returns {Promise<Object>} Game state.
   */
  async getGameState(gameId) {
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/`, {
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to get game state');
    return resp.json();
  },

  /**
   * Get game state with grid GeoJSON (for resuming).
   * @param {string} gameId - UUID of the game.
   * @returns {Promise<Object>} Game state with grid.
   */
  async getGameWithGrid(gameId) {
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/?include_grid=true`, {
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to get game with grid');
    return resp.json();
  },

  /**
   * Record a cell visit.
   * @param {string} gameId - UUID of the game.
   * @param {Object} data - Visit data (cell_id, entered_at, exited_at, lat, lon).
   * @returns {Promise<Object>} Visit result.
   */
  async recordVisit(gameId, data) {
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/visits/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Failed to record visit');
    }
    return resp.json();
  },

  /**
   * Finish a game.
   * @param {string} gameId - UUID of the game.
   * @returns {Promise<Object>} Final game state.
   */
  async finishGame(gameId) {
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/finish/`, {
      method: 'POST',
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to finish game');
    return resp.json();
  },

  /**
   * Delete a game.
   * @param {string} gameId - UUID of the game.
   * @returns {Promise<void>}
   */
  async deleteGame(gameId) {
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/delete/`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to delete game');
  },

  // --- Cell report endpoints ---

  /**
   * Report a cell as inaccessible (create or update).
   * @param {string} cellId - Cell identifier.
   * @param {string} gridType - Grid type (e.g. "stat_1km").
   * @param {string} reason - Reason code.
   * @param {string} comment - Optional comment.
   * @returns {Promise<Object>} Report data with total_reports count.
   */
  async reportCell(cellId, gridType, reason, comment = '') {
    const resp = await fetch(`${this.baseUrl}/cells/report/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        cell_id: cellId,
        grid_type: gridType,
        reason,
        comment,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || err.error || JSON.stringify(err));
    }
    return resp.json();
  },

  /**
   * Get reports for a specific cell.
   * @param {string} cellId - Cell identifier.
   * @param {string} gridType - Grid type.
   * @returns {Promise<Object>} Reports data with total_reports and reports array.
   */
  async getCellReports(cellId, gridType) {
    const resp = await fetch(
      `${this.baseUrl}/cells/${encodeURIComponent(cellId)}/reports/?grid_type=${encodeURIComponent(gridType)}`,
      { headers: this._headers() }
    );
    if (!resp.ok) throw new Error('Failed to get cell reports');
    return resp.json();
  },

  // --- Auth endpoints ---

  /**
   * Check authentication status.
   * @returns {Promise<Object>} {authenticated, username}
   */
  async authStatus() {
    const resp = await fetch(`${this.baseUrl}/auth/status/`, {
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to check auth status');
    return resp.json();
  },

  /**
   * Register a new user.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} {authenticated, username} or error.
   */
  async register(username, password) {
    const resp = await fetch(`${this.baseUrl}/auth/register/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Registration failed');
    return data;
  },

  /**
   * Login with credentials.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} {authenticated, username} or error.
   */
  async login(username, password) {
    const resp = await fetch(`${this.baseUrl}/auth/login/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  /**
   * Logout.
   * @returns {Promise<Object>}
   */
  async logout() {
    const resp = await fetch(`${this.baseUrl}/auth/logout/`, {
      method: 'POST',
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Logout failed');
    return resp.json();
  },

  /**
   * Claim anonymous games for the authenticated user.
   * @returns {Promise<Object>} {claimed: number}
   */
  async claimGames() {
    const resp = await fetch(`${this.baseUrl}/auth/claim/`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ player_token: this.getPlayerToken() }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Claim failed');
    return data;
  },
};
