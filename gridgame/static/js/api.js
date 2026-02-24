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
   * Build common headers for all requests.
   * @returns {Object} Headers object.
   */
  _headers() {
    return {
      'Content-Type': 'application/json',
      'X-Player-Token': this.getPlayerToken(),
    };
  },

  /**
   * List games for the current player.
   * @param {string} [statusFilter] - "active" or "finished", or omit for all.
   * @returns {Promise<Array>} List of game summaries.
   */
  async listGames(statusFilter) {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    const resp = await fetch(`${this.baseUrl}/games/list/${params}`, {
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
};
