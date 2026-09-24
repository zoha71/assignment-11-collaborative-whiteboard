/**
 * sockets/cursorHandler.js
 * Live Collaborator Cursor Coordinate Streaming with Server-Side Throttling
 */

// Server-side throttle interval in milliseconds (30 updates/sec = ~33ms)
const CURSOR_THROTTLE_MS = 25;

/**
 * Registers cursor coordinate streaming handlers on a connected socket
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function registerCursorHandlers(io, socket) {
  let lastCursorBroadcastTime = 0;

  socket.on('cursor:move', (payload = {}) => {
    try {
      const { boardId, x, y } = payload;

      // Validate room membership
      if (!boardId || socket.data.boardId !== boardId) {
        return;
      }

      // Validate numeric coordinates
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }

      const now = Date.now();
      // Server-side throttle check to drop excessive high-frequency events
      if (now - lastCursorBroadcastTime < CURSOR_THROTTLE_MS) {
        return;
      }
      lastCursorBroadcastTime = now;

      // Relay peer cursor position to other room participants
      socket.to(boardId).emit('cursor:update', {
        userId: socket.id,
        x,
        y
      });
    } catch (err) {
      console.error(`[Error] cursor:move failed for socket ${socket.id}:`, err);
    }
  });
}

module.exports = {
  registerCursorHandlers,
  CURSOR_THROTTLE_MS
};
