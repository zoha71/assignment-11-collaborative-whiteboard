/**
 * sockets/boardHandler.js
 * Handles Room Join/Leave, Stroke Synchronization, Canvas Undo, and Clear Actions
 */

const boardStore = require('./boardStore');

// Curated palette of pleasant colors for random assignment
const DEFAULT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6'
];

/**
 * Basic HTML-escaping helper to sanitize input and prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates hex color code format (#RGB or #RRGGBB)
 * @param {string} color
 * @returns {boolean}
 */
function isValidHexColor(color) {
  return typeof color === 'string' && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/**
 * Sanitizes board ID to prevent directory traversal or unsafe room naming
 * @param {string} id
 * @returns {string}
 */
function sanitizeBoardId(id) {
  if (typeof id !== 'string') return 'lobby';
  const trimmed = id.trim();
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
  return sanitized.length > 0 ? sanitized : 'lobby';
}

/**
 * Validates stroke coordinates and properties
 * @param {object} stroke
 * @returns {boolean}
 */
function isValidStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return false;
  const { prevX, prevY, currX, currY, size, color, strokeId } = stroke;

  const areCoordsValid =
    Number.isFinite(prevX) &&
    Number.isFinite(prevY) &&
    Number.isFinite(currX) &&
    Number.isFinite(currY);

  const isSizeValid = Number.isFinite(size) && size > 0 && size <= 100;
  const isColorValid = typeof color === 'string' && color.length <= 32;
  const isIdValid = !strokeId || (typeof strokeId === 'string' && strokeId.length <= 64);

  return areCoordsValid && isSizeValid && isColorValid && isIdValid;
}

/**
 * Registers board management and drawing handlers on a connected socket
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function registerBoardHandlers(io, socket) {
  // Handler for joining a collaborative board room
  socket.on('board:join', (payload = {}) => {
    try {
      const { boardId: rawBoardId, username: rawUsername, userColor } = payload;
      const boardId = sanitizeBoardId(rawBoardId);

      // Sanitize username
      let username = escapeHtml(typeof rawUsername === 'string' ? rawUsername.trim() : '');
      if (!username || username.length === 0) {
        username = `Guest-${socket.id.substring(0, 4)}`;
      } else if (username.length > 30) {
        username = username.substring(0, 30);
      }

      // Validate or generate user color
      const color = isValidHexColor(userColor)
        ? userColor
        : DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];

      // If socket is already in a different room, leave it first
      if (socket.data.boardId && socket.data.boardId !== boardId) {
        const oldBoardId = socket.data.boardId;
        boardStore.removeUser(oldBoardId, socket.id);
        socket.to(oldBoardId).emit('user:left', {
          userId: socket.id,
          username: socket.data.username
        });
        socket.leave(oldBoardId);
        boardStore.deleteBoardIfEmpty(oldBoardId);
      }

      // Join new socket room
      socket.join(boardId);

      // Save user state on socket session
      socket.data.boardId = boardId;
      socket.data.username = username;
      socket.data.color = color;

      // Add user to board store
      boardStore.addUser(boardId, socket.id, { username, color });
      const board = boardStore.getOrCreateBoard(boardId);

      // 1. Emit complete stroke history and active user list to the joining peer ONLY
      socket.emit('board:init', {
        strokes: board.strokes,
        activeUsers: boardStore.getActiveUsers(boardId)
      });

      // 2. Broadcast user:joined to all other participants in the room
      socket.to(boardId).emit('user:joined', {
        userId: socket.id,
        username,
        color
      });

      console.log(`[Socket] User "${username}" (${socket.id}) joined board "${boardId}"`);
    } catch (err) {
      console.error(`[Error] board:join failed for socket ${socket.id}:`, err);
    }
  });

  // Handler for drawing continuous line segments
  socket.on('draw:stroke', (payload = {}) => {
    try {
      const { boardId, stroke } = payload;

      // Ensure socket is joined in this board room
      if (!boardId || socket.data.boardId !== boardId) {
        return;
      }

      // Validate stroke payload schema
      if (!isValidStroke(stroke)) {
        console.warn(`[Warn] Invalid stroke received from ${socket.id} on board ${boardId}`);
        return;
      }

      // Append to room history buffer on the server
      const enrichedStroke = boardStore.addStroke(boardId, stroke, socket.id);

      // Relay the drawing stroke to all OTHER participants (never back to sender)
      socket.to(boardId).emit('draw:broadcast', {
        stroke: enrichedStroke
      });
    } catch (err) {
      console.error(`[Error] draw:stroke failed for socket ${socket.id}:`, err);
    }
  });

  // Handler for clearing the entire whiteboard
  socket.on('board:clear', (payload = {}) => {
    try {
      const { boardId } = payload;

      // Ensure socket is joined in this board room
      if (!boardId || socket.data.boardId !== boardId) {
        return;
      }

      // Clear strokes in server store
      boardStore.clearBoard(boardId);

      const clearedBy = socket.data.username || 'Anonymous';

      // Notify ALL room peers (including sender) to wipe their local canvas
      io.to(boardId).emit('board:cleared', {
        clearedBy
      });

      console.log(`[Socket] Board "${boardId}" cleared by "${clearedBy}"`);
    } catch (err) {
      console.error(`[Error] board:clear failed for socket ${socket.id}:`, err);
    }
  });

  // Handler for undoing the last continuous stroke action
  socket.on('draw:undo', (payload = {}) => {
    try {
      const { boardId } = payload;

      // Ensure socket is joined in this board room
      if (!boardId || socket.data.boardId !== boardId) {
        return;
      }

      // Roll back strokes grouped by the last strokeId
      const remainingStrokes = boardStore.undoLastStroke(boardId);

      // Broadcast new state snapshot after undo to EVERYONE in the room
      io.to(boardId).emit('board:sync', {
        strokes: remainingStrokes
      });

      console.log(`[Socket] Board "${boardId}" undo executed by "${socket.data.username}". Remaining strokes: ${remainingStrokes.length}`);
    } catch (err) {
      console.error(`[Error] draw:undo failed for socket ${socket.id}:`, err);
    }
  });

  // Handler for peer disconnect cleanup
  socket.on('disconnect', () => {
    try {
      const boardId = socket.data.boardId;
      const username = socket.data.username;

      if (boardId) {
        // Remove from store
        boardStore.removeUser(boardId, socket.id);

        // Notify remaining peers
        socket.to(boardId).emit('user:left', {
          userId: socket.id,
          username: username || 'A user'
        });

        // Clean up empty board from memory
        boardStore.deleteBoardIfEmpty(boardId);

        console.log(`[Socket] User "${username}" (${socket.id}) disconnected from board "${boardId}"`);
      }
    } catch (err) {
      console.error(`[Error] disconnect cleanup failed for socket ${socket.id}:`, err);
    }
  });
}

module.exports = {
  registerBoardHandlers,
  escapeHtml,
  isValidHexColor,
  sanitizeBoardId,
  isValidStroke
};
