/**
 * CSRF-aware fetch wrappers for the board editor API.
 */
const EditorAPI = {
  /**
   * Get CSRF token from cookie.
   * @returns {string} CSRF token.
   */
  _getCSRFToken() {
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    return match ? match[1] : '';
  },

  /**
   * Perform a fetch request with CSRF token and JSON handling.
   * @param {string} url - Request URL.
   * @param {Object} options - Fetch options override.
   * @returns {Promise<Object>} Parsed JSON response.
   */
  async _fetch(url, options = {}) {
    const defaults = {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': this._getCSRFToken(),
      },
      credentials: 'same-origin',
    };
    const res = await fetch(url, { ...defaults, ...options });
    if (!res.ok) {
      const text = await res.text();
      let msg;
      try {
        const data = JSON.parse(text);
        msg = data.error || data.detail || text;
      } catch {
        msg = text;
      }
      throw new Error(msg);
    }
    return res.json();
  },

  /**
   * List all boards.
   * @returns {Promise<Array>} List of board objects.
   */
  listBoards() {
    return this._fetch('/editor/api/boards/');
  },

  /**
   * Get board detail.
   * @param {number} boardId - Board ID.
   * @returns {Promise<Object>} Board detail with area geometry.
   */
  getBoard(boardId) {
    return this._fetch(`/editor/api/boards/${boardId}/`);
  },

  /**
   * Generate cells for a board.
   * @param {number} boardId - Board ID.
   * @returns {Promise<Object>} Result with total_cells count.
   */
  generateCells(boardId) {
    return this._fetch(`/editor/api/boards/${boardId}/generate/`, { method: 'POST' });
  },

  /**
   * Get board cells as GeoJSON.
   * @param {number} boardId - Board ID.
   * @returns {Promise<Object>} GeoJSON FeatureCollection.
   */
  getCells(boardId) {
    return this._fetch(`/editor/api/boards/${boardId}/cells/`);
  },

  /**
   * Toggle enabled state for a list of cell IDs.
   * @param {number} boardId - Board ID.
   * @param {Array<string>} cellIds - Cell IDs to toggle.
   * @param {boolean} isEnabled - New enabled state.
   * @returns {Promise<Object>} Updated counts.
   */
  toggleCells(boardId, cellIds, isEnabled) {
    return this._fetch(`/editor/api/boards/${boardId}/cells/toggle/`, {
      method: 'PATCH',
      body: JSON.stringify({ cell_ids: cellIds, is_enabled: isEnabled }),
    });
  },

  /**
   * Publish a board.
   * @param {number} boardId - Board ID.
   * @returns {Promise<Object>} Publication result.
   */
  publishBoard(boardId) {
    return this._fetch(`/editor/api/boards/${boardId}/publish/`, { method: 'POST' });
  },
};
