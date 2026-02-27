/**
 * Board editor application logic.
 * Manages board list, selection, cell generation, toggle, and publishing.
 */
const EditorApp = {
  currentBoardId: null,
  currentBoard: null,

  /** DOM element references. */
  els: {},

  /** Initialize the editor application. */
  async init() {
    this.els = {
      boardList: document.getElementById('board-list'),
      boardListSection: document.getElementById('board-list-section'),
      boardDetailSection: document.getElementById('board-detail-section'),
      boardTitle: document.getElementById('board-title'),
      boardDescription: document.getElementById('board-description'),
      boardMeta: document.getElementById('board-meta'),
      backToListBtn: document.getElementById('back-to-list-btn'),
      generateCellsBtn: document.getElementById('generate-cells-btn'),
      publishBtn: document.getElementById('publish-btn'),
      cellStats: document.getElementById('cell-stats'),
      enabledCount: document.getElementById('enabled-count'),
      totalCellCount: document.getElementById('total-cell-count'),
      selectionInfo: document.getElementById('selection-info'),
      selectedCount: document.getElementById('selected-count'),
      enableSelectedBtn: document.getElementById('enable-selected-btn'),
      disableSelectedBtn: document.getElementById('disable-selected-btn'),
      clearSelectionBtn: document.getElementById('clear-selection-btn'),
      statusMsg: document.getElementById('status-msg'),
      layerToggleBtn: document.getElementById('layer-toggle-btn'),
      fitBoundsBtn: document.getElementById('fit-bounds-btn'),
    };

    // Event listeners
    this.els.backToListBtn.addEventListener('click', () => this.showBoardList());
    this.els.generateCellsBtn.addEventListener('click', () => this.generateCells());
    this.els.publishBtn.addEventListener('click', () => this.publishBoard());
    this.els.enableSelectedBtn.addEventListener('click', () => this.toggleSelected(true));
    this.els.disableSelectedBtn.addEventListener('click', () => this.toggleSelected(false));
    this.els.clearSelectionBtn.addEventListener('click', () => {
      EditorMap.clearSelection();
      this.onSelectionChange(new Set());
    });
    this.els.layerToggleBtn.addEventListener('click', () => {
      const isOSM = EditorMap.toggleBaseMap();
      this.els.layerToggleBtn.textContent = isOSM ? 'Vector' : 'OSM';
    });
    this.els.fitBoundsBtn.addEventListener('click', () => EditorMap.fitToCells());

    // Init map
    EditorMap.init((selectedIds) => this.onSelectionChange(selectedIds));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Load boards
    await this.loadBoards();
  },

  /**
   * Handle keyboard shortcuts.
   * @param {KeyboardEvent} e - Keyboard event.
   */
  _onKeyDown(e) {
    // Ignore if focus is in an input/textarea
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const selected = EditorMap.getSelectedCellIds();
    if (!selected.size) return;

    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      this.toggleSelected(true);
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      this.toggleSelected(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      EditorMap.clearSelection();
      this.onSelectionChange(new Set());
    }
  },

  /**
   * Set status message.
   * @param {string} msg - Message to display.
   */
  setStatus(msg) {
    this.els.statusMsg.textContent = msg;
  },

  /** Load and render the board list. */
  async loadBoards() {
    this.setStatus('Loading boards...');
    try {
      const boards = await EditorAPI.listBoards();
      this.renderBoardList(boards);
      this.setStatus('');
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    }
  },

  /**
   * Render the board list in the sidebar.
   * @param {Array} boards - Board objects.
   */
  renderBoardList(boards) {
    this.els.boardList.innerHTML = '';
    for (const board of boards) {
      const card = document.createElement('div');
      card.className = 'board-card';

      const statusBadge = board.is_published
        ? '<span class="badge badge-success">Published</span>'
        : '<span class="badge badge-muted">Draft</span>';

      card.innerHTML = `
        <div class="board-card-info">
          <strong>${board.name}</strong>
          <span class="board-card-meta">
            ${board.area_name} &middot; ${board.grid_type.replace('stat_', '').replace('h3_res', 'H3 r')}
            &middot; ${board.enabled_cells}/${board.total_cells} cells
            ${statusBadge}
          </span>
        </div>
      `;
      card.addEventListener('click', () => this.selectBoard(board.id));
      this.els.boardList.appendChild(card);
    }
  },

  /**
   * Select a board and show its detail view.
   * @param {number} boardId - Board ID.
   */
  async selectBoard(boardId) {
    this.currentBoardId = boardId;
    this.setStatus('Loading board...');

    try {
      const board = await EditorAPI.getBoard(boardId);
      this.currentBoard = board;

      this.els.boardTitle.textContent = board.name;
      this.els.boardDescription.textContent = board.description || '';
      this.els.boardMeta.innerHTML = `
        <span>Area: ${board.area_name}</span>
        <span>Grid: ${board.grid_type.replace('stat_', '').replace('h3_res', 'H3 r')}</span>
        <span>Status: ${board.is_published ? 'Published' : 'Draft'}</span>
      `;

      // Show area on map
      EditorMap.showArea(board.area_geometry);

      // Update cell stats
      this.updateCellStats(board.enabled_cells, board.total_cells);

      // Show/hide publish button
      this.els.publishBtn.style.display = board.is_published ? 'none' : '';

      // Switch to detail view
      this.els.boardListSection.style.display = 'none';
      this.els.boardDetailSection.style.display = '';

      // Load cells if they exist
      if (board.total_cells > 0) {
        await this.loadCells();
      }

      this.setStatus('');
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    }
  },

  /** Go back to the board list. */
  showBoardList() {
    this.currentBoardId = null;
    this.currentBoard = null;
    this.els.boardListSection.style.display = '';
    this.els.boardDetailSection.style.display = 'none';
    this.els.selectionInfo.style.display = 'none';
    this.loadBoards();
  },

  /** Generate cells for the current board. */
  async generateCells() {
    if (!this.currentBoardId) return;
    this.els.generateCellsBtn.disabled = true;
    this.setStatus('Generating cells...');

    try {
      const result = await EditorAPI.generateCells(this.currentBoardId);
      this.setStatus(`Generated ${result.total_cells} cells.`);
      this.updateCellStats(result.total_cells, result.total_cells);
      await this.loadCells();
      this.els.publishBtn.style.display = '';
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    } finally {
      this.els.generateCellsBtn.disabled = false;
    }
  },

  /** Load cells for the current board and display on map. */
  async loadCells() {
    if (!this.currentBoardId) return;
    this.setStatus('Loading cells...');

    try {
      const geojson = await EditorAPI.getCells(this.currentBoardId);
      EditorMap.loadCells(geojson);
      this.setStatus('');
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    }
  },

  /**
   * Toggle selected cells' enabled state.
   * @param {boolean} isEnabled - New enabled state.
   */
  async toggleSelected(isEnabled) {
    const selected = EditorMap.getSelectedCellIds();
    if (!selected.size || !this.currentBoardId) return;

    const cellIds = Array.from(selected);
    this.setStatus(`Toggling ${cellIds.length} cells...`);

    try {
      const result = await EditorAPI.toggleCells(this.currentBoardId, cellIds, isEnabled);
      EditorMap.updateCellStates(cellIds, isEnabled);
      this.updateCellStats(result.enabled_count, result.total_count);
      EditorMap.clearSelection();
      this.onSelectionChange(new Set());
      this.setStatus(`Updated ${result.updated} cells.`);
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    }
  },

  /** Publish the current board. */
  async publishBoard() {
    if (!this.currentBoardId) return;
    if (!confirm('Publish this board? It will become available for players.')) return;

    this.els.publishBtn.disabled = true;
    this.setStatus('Publishing...');

    try {
      await EditorAPI.publishBoard(this.currentBoardId);
      this.els.publishBtn.style.display = 'none';
      this.setStatus('Board published!');
      if (this.currentBoard) this.currentBoard.is_published = true;
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    } finally {
      this.els.publishBtn.disabled = false;
    }
  },

  /**
   * Update the cell stats display.
   * @param {number} enabled - Enabled cell count.
   * @param {number} total - Total cell count.
   */
  updateCellStats(enabled, total) {
    this.els.enabledCount.textContent = enabled;
    this.els.totalCellCount.textContent = total;
    this.els.cellStats.style.display = total > 0 ? '' : 'none';
  },

  /**
   * Handle selection change from the map.
   * @param {Set<string>} selectedIds - Currently selected cell IDs.
   */
  onSelectionChange(selectedIds) {
    if (selectedIds.size > 0) {
      this.els.selectedCount.textContent = selectedIds.size;
      this.els.selectionInfo.style.display = '';
    } else {
      this.els.selectionInfo.style.display = 'none';
    }
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => EditorApp.init());
