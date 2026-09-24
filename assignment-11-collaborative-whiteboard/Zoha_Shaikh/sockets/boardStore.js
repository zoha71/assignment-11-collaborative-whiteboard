/**
 * sockets/boardStore.js
 * Centralized In-Memory Whiteboard Store and State Management Helpers
 * 
 * NOTE: This store is process-memory-only. It resets upon server restart and does
 * not sync across multiple server instances. For horizontal clustering, use Redis
 * with the @socket.io/redis-adapter.
 */

// In-Memory Whiteboard Store
// Structure: { [boardId]: { boardId: string, strokes: Array<Stroke>, users: { [socketId]: User } } }
const boardRooms = {};

const MAX_STROKES_PER_ROOM = 5000;

/**
 * Retrieves an existing board or initializes a new one.
 * @param {string} boardId
 * @returns {object} board object
 */
function getOrCreateBoard(boardId) {
  if (!boardRooms[boardId]) {
    boardRooms[boardId] = {
      boardId,
      strokes: [],
      users: {}
    };
  }
  return boardRooms[boardId];
}

/**
 * Retrieves a board if it exists.
 * @param {string} boardId
 * @returns {object|null}
 */
function getBoard(boardId) {
  return boardRooms[boardId] || null;
}

/**
 * Appends a stroke segment to a room's history buffer.
 * Enforces the maximum history length to prevent memory leakage.
 * @param {string} boardId
 * @param {object} stroke
 * @param {string} socketId
 * @returns {object} enriched stroke with metadata
 */
function addStroke(boardId, stroke, socketId) {
  const board = getOrCreateBoard(boardId);
  const enrichedStroke = {
    ...stroke,
    socketId,
    timestamp: Date.now()
  };

  board.strokes.push(enrichedStroke);

  // Prune oldest strokes if capped limit is exceeded
  if (board.strokes.length > MAX_STROKES_PER_ROOM) {
    board.strokes.splice(0, board.strokes.length - MAX_STROKES_PER_ROOM);
  }

  return enrichedStroke;
}

/**
 * Removes all stroke segments corresponding to the most recent strokeId.
 * @param {string} boardId
 * @returns {Array} remaining strokes in the board
 */
function undoLastStroke(boardId) {
  const board = getBoard(boardId);
  if (!board || board.strokes.length === 0) {
    return [];
  }

  // Find the strokeId of the very last segment in history
  const lastSegment = board.strokes[board.strokes.length - 1];
  const targetStrokeId = lastSegment.strokeId;

  if (targetStrokeId) {
    // Remove all segments that share this strokeId
    board.strokes = board.strokes.filter(s => s.strokeId !== targetStrokeId);
  } else {
    // Fallback: pop last segment if no strokeId
    board.strokes.pop();
  }

  return board.strokes;
}

/**
 * Clears all strokes for a room.
 * @param {string} boardId
 * @returns {boolean}
 */
function clearBoard(boardId) {
  const board = getBoard(boardId);
  if (board) {
    board.strokes = [];
    return true;
  }
  return false;
}

/**
 * Adds or updates a user in a board room.
 * @param {string} boardId
 * @param {string} socketId
 * @param {object} userData { username, color }
 */
function addUser(boardId, socketId, userData) {
  const board = getOrCreateBoard(boardId);
  board.users[socketId] = {
    userId: socketId,
    username: userData.username,
    color: userData.color,
    cursor: { x: null, y: null },
    joinedAt: Date.now()
  };
  return board.users[socketId];
}

/**
 * Removes a user from a board room.
 * @param {string} boardId
 * @param {string} socketId
 * @returns {object|null} removed user or null
 */
function removeUser(boardId, socketId) {
  const board = getBoard(boardId);
  if (!board || !board.users[socketId]) {
    return null;
  }
  const removedUser = board.users[socketId];
  delete board.users[socketId];
  return removedUser;
}

/**
 * Checks if a board has zero connected users, and removes it from memory if empty.
 * @param {string} boardId
 * @returns {boolean} true if deleted
 */
function deleteBoardIfEmpty(boardId) {
  const board = getBoard(boardId);
  if (board && Object.keys(board.users).length === 0) {
    delete boardRooms[boardId];
    return true;
  }
  return false;
}

/**
 * Gets array of active users for a board.
 * @param {string} boardId
 * @returns {Array} list of active user objects
 */
function getActiveUsers(boardId) {
  const board = getBoard(boardId);
  if (!board) return [];
  return Object.values(board.users);
}

/**
 * Returns summary stats for a board.
 * @param {string} boardId
 * @returns {object|null}
 */
function getStats(boardId) {
  const board = getBoard(boardId);
  if (!board) return null;
  return {
    boardId,
    strokeCount: board.strokes.length,
    userCount: Object.keys(board.users).length
  };
}

/**
 * Returns total count of active boards.
 * @returns {number}
 */
function getAllBoardsCount() {
  return Object.keys(boardRooms).length;
}

/**
 * Returns total count of active users across all rooms.
 * @returns {number}
 */
function getAllUsersCount() {
  let count = 0;
  for (const board of Object.values(boardRooms)) {
    count += Object.keys(board.users).length;
  }
  return count;
}

module.exports = {
  boardRooms,
  MAX_STROKES_PER_ROOM,
  getOrCreateBoard,
  getBoard,
  addStroke,
  undoLastStroke,
  clearBoard,
  addUser,
  removeUser,
  deleteBoardIfEmpty,
  getActiveUsers,
  getStats,
  getAllBoardsCount,
  getAllUsersCount
};
