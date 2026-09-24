/**
 * server.js
 * Main Application Bootstrap for Real-Time Collaborative Whiteboard
 */

require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const boardStore = require('./sockets/boardStore');
const { registerBoardHandlers } = require('./sockets/boardHandler');
const { registerCursorHandlers } = require('./sockets/cursorHandler');

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Parse CORS origin config (handles wildcard, single origin, or comma-separated list)
const corsOriginConfig = CORS_ORIGIN === '*'
  ? '*'
  : CORS_ORIGIN.split(',').map(s => s.trim());

// Middleware setup
app.use(cors({ origin: corsOriginConfig }));
app.use(express.json());

// Serve static frontend client from public/ directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Socket.io attached to the HTTP server
const io = new Server(httpServer, {
  cors: {
    origin: corsOriginConfig,
    methods: ['GET', 'POST']
  },
  pingTimeout: 20000,
  pingInterval: 25000
});

// Socket.io connection pipeline
io.on('connection', (socket) => {
  // Register board events (join, stroke, clear, undo, disconnect)
  registerBoardHandlers(io, socket);

  // Register live pointer / cursor streaming
  registerCursorHandlers(io, socket);
});

// Health check endpoint for Render and monitoring probes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    activeBoards: boardStore.getAllBoardsCount(),
    activeConnections: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// Informational stats endpoint per board room
app.get('/api/boards/:boardId/stats', (req, res) => {
  const { boardId } = req.params;
  const stats = boardStore.getStats(boardId);

  if (!stats) {
    return res.status(404).json({
      error: 'Board not found or currently empty',
      boardId
    });
  }

  res.json(stats);
});

// Fallback route to serve index.html for query parameter routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful error handling for server listening (e.g. macOS AirPlay conflict on 5000)
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m[Error] Port ${PORT} is already in use.\x1b[0m`);
    console.error(`Note for macOS: System AirPlay Receiver often reserves port 5000.`);
    console.error(`You can set PORT=5001 in your .env file or disable AirPlay Receiver in System Settings.`);
  } else {
    console.error('[Error] Server error:', err);
  }
  process.exit(1);
});

// Start HTTP and WebSocket server on 0.0.0.0
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎨 Real-Time Collaborative Whiteboard Server Online`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🩺 Health Check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`====================================================`);
});

module.exports = { app, httpServer, io };
