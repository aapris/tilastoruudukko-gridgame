/**
 * API client — fetch wrappers for all game endpoints.
 */
const API = {
  baseUrl: '/api',

  /**
   * Create a new game.
   * @param {Object} data - Game creation parameters.
   * @returns {Promise<Object>} Game data with grid GeoJSON.
   */
  async createGame(data) {
    const resp = await fetch(`${this.baseUrl}/games/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const resp = await fetch(`${this.baseUrl}/games/${gameId}/`);
    if (!resp.ok) throw new Error('Failed to get game state');
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) throw new Error('Failed to finish game');
    return resp.json();
  },
};
