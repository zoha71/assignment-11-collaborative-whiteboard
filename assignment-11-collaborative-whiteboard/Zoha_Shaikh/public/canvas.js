/**
 * public/canvas.js
 * High-Performance Client-Side Whiteboard Engine and Real-Time Socket Manager
 */

(function () {
  'use strict';

  // --- 1. State & Configuration ---
  const urlParams = new URLSearchParams(window.location.search);
  let boardId = (urlParams.get('board') || 'lobby').trim().replace(/[^a-zA-Z0-9_\-]/g, '') || 'lobby';

  // Ensure URL reflects boardId
  if (!urlParams.get('board')) {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('board', boardId);
    window.history.replaceState({}, '', newUrl.toString());
  }

  // Predefined pleasant avatar colors
  const AVATAR_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6'
  ];

  // User Identity from localStorage or random defaults
  let currentUser = {
    username: localStorage.getItem('collab_username') || `Guest-${Math.floor(1000 + Math.random() * 9000)}`,
    color: localStorage.getItem('collab_user_color') || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
  };

  // Drawing State
  let isDrawing = false;
  let isEraser = false;
  let currentColor = '#1e293b';
  let currentSize = 3;
  let currentStrokeId = null;
  let lastX = 0;
  let lastY = 0;
  let localStrokesHistory = [];
  let activeUsersMap = new Map();

  // DOM Elements
  const canvas = document.getElementById('whiteboardCanvas');
  const ctx = canvas.getContext('2d');
  const cursorsOverlay = document.getElementById('cursorsOverlay');
  const roomIdDisplay = document.getElementById('roomIdDisplay');
  const shareRoomBtn = document.getElementById('shareRoomBtn');
  const brushToolBtn = document.getElementById('brushToolBtn');
  const eraserToolBtn = document.getElementById('eraserToolBtn');
  const colorSwatches = document.querySelectorAll('.color-swatch');
  const customColorInput = document.getElementById('customColorInput');
  const brushSizeSlider = document.getElementById('brushSizeSlider');
  const brushSizeLabel = document.getElementById('brushSizeLabel');
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');
  const usersAvatarsList = document.getElementById('usersAvatarsList');
  const usersCounter = document.getElementById('usersCounter');
  const userProfileBadge = document.getElementById('userProfileBadge');
  const usernameDisplay = document.getElementById('usernameDisplay');
  const userColorIndicator = document.getElementById('userColorIndicator');
  const connectionDot = document.getElementById('connectionDot');
  const connectionStatusText = document.getElementById('connectionStatusText');
  const strokeCounterText = document.getElementById('strokeCounterText');
  const cursorCoordsText = document.getElementById('cursorCoordsText');
  const toastContainer = document.getElementById('toastContainer');
  const nameModal = document.getElementById('nameModal');
  const modalUsernameInput = document.getElementById('modalUsernameInput');
  const modalColorsGrid = document.getElementById('modalColorsGrid');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');

  // Set initial UI values
  roomIdDisplay.textContent = `Room: ${boardId}`;
  updateProfileBadgeUI();

  // --- 2. Canvas Setup & High-DPI Scaling ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(dpr, dpr);
    redrawAllStrokes();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function redrawAllStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < localStrokesHistory.length; i++) {
      drawStrokeSegment(localStrokesHistory[i]);
    }
    updateStrokeCountUI();
  }

  function drawStrokeSegment(stroke) {
    if (!stroke) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(stroke.prevX, stroke.prevY);
    ctx.lineTo(stroke.currX, stroke.currY);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function updateStrokeCountUI() {
    if (strokeCounterText) {
      strokeCounterText.textContent = `Strokes: ${localStrokesHistory.length}`;
    }
  }

  // --- 3. Socket.io Connection & Event Handling ---
  // Connect to the same origin where page is served
  const socket = io();

  function emitJoinRoom() {
    socket.emit('board:join', {
      boardId,
      username: currentUser.username,
      userColor: currentUser.color
    });
  }

  socket.on('connect', () => {
    connectionDot.className = 'status-indicator-dot online';
    connectionStatusText.textContent = 'Connected (Real-Time WS)';
    emitJoinRoom();
  });

  socket.on('disconnect', () => {
    connectionDot.className = 'status-indicator-dot offline';
    connectionStatusText.textContent = 'Disconnected (Reconnecting...)';
  });

  // 1. board:init - Complete stroke history on join
  socket.on('board:init', (payload = {}) => {
    localStrokesHistory = Array.isArray(payload.strokes) ? payload.strokes : [];
    redrawAllStrokes();

    // Render active users
    activeUsersMap.clear();
    if (Array.isArray(payload.activeUsers)) {
      payload.activeUsers.forEach(u => {
        activeUsersMap.set(u.userId, u);
      });
    }
    renderActiveUsers();
    showToast(`Joined board "${boardId}" as ${currentUser.username}`);
  });

  // 2. draw:broadcast - Incoming real-time stroke segment from peer
  socket.on('draw:broadcast', (payload = {}) => {
    const stroke = payload.stroke;
    if (stroke) {
      localStrokesHistory.push(stroke);
      drawStrokeSegment(stroke);
      updateStrokeCountUI();
    }
  });

  // 3. cursor:update - Live collaborator cursor tracking
  socket.on('cursor:update', (payload = {}) => {
    const { userId, x, y } = payload;
    if (!userId || userId === socket.id) return;
    updateCollaboratorCursor(userId, x, y);
  });

  // 4. user:joined - Peer joined notification
  socket.on('user:joined', (payload = {}) => {
    const { userId, username, color } = payload;
    if (!userId) return;
    activeUsersMap.set(userId, { userId, username, color });
    renderActiveUsers();
    showToast(`${username} joined the board`);
  });

  // 5. user:left - Peer disconnected
  socket.on('user:left', (payload = {}) => {
    const { userId, username } = payload;
    if (!userId) return;
    activeUsersMap.delete(userId);
    removeCollaboratorCursor(userId);
    renderActiveUsers();
    showToast(`${username || 'A user'} left`);
  });

  // 6. board:cleared - Canvas wiped by a participant
  socket.on('board:cleared', (payload = {}) => {
    localStrokesHistory = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateStrokeCountUI();
    showToast(`Board cleared by ${payload.clearedBy || 'someone'}`);
  });

  // 7. board:sync - Resync canvas snapshot after undo
  socket.on('board:sync', (payload = {}) => {
    localStrokesHistory = Array.isArray(payload.strokes) ? payload.strokes : [];
    redrawAllStrokes();
  });

  // --- 4. Drawing Engine & Pointer Events ---
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'stroke_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  }

  function startDrawing(e) {
    // Ignore right clicks or clicks outside canvas
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();

    isDrawing = true;
    currentStrokeId = generateUUID();
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;

    // Draw a single dot immediately on press
    const stroke = {
      strokeId: currentStrokeId,
      prevX: lastX,
      prevY: lastY,
      currX: lastX + 0.1,
      currY: lastY + 0.1,
      color: isEraser ? '#f8fafc' : currentColor,
      size: Number(currentSize)
    };

    localStrokesHistory.push(stroke);
    drawStrokeSegment(stroke);
    socket.emit('draw:stroke', { boardId, stroke });
    updateStrokeCountUI();
  }

  function drawMove(e) {
    const coords = getCanvasCoords(e);
    
    // Update footer coordinate indicator
    if (cursorCoordsText) {
      cursorCoordsText.textContent = `X: ${Math.round(coords.x)}, Y: ${Math.round(coords.y)}`;
    }

    // Emit live cursor position with client-side throttle
    emitCursorMove(coords.x, coords.y);

    if (!isDrawing) return;
    e.preventDefault();

    const currX = coords.x;
    const currY = coords.y;

    // Ignore micro-movements
    const dist = Math.hypot(currX - lastX, currY - lastY);
    if (dist < 1) return;

    const stroke = {
      strokeId: currentStrokeId,
      prevX: lastX,
      prevY: lastY,
      currX: currX,
      currY: currY,
      color: isEraser ? '#f8fafc' : currentColor,
      size: Number(currentSize)
    };

    // Draw locally immediately for instantaneous feedback
    localStrokesHistory.push(stroke);
    drawStrokeSegment(stroke);

    // Relay to server
    socket.emit('draw:stroke', { boardId, stroke });
    updateStrokeCountUI();

    lastX = currX;
    lastY = currY;
  }

  function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
    currentStrokeId = null;
  }

  // Pointer / Mouse / Touch Listeners
  canvas.addEventListener('mousedown', startDrawing);
  window.addEventListener('mousemove', drawMove);
  window.addEventListener('mouseup', stopDrawing);

  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  window.addEventListener('touchmove', drawMove, { passive: false });
  window.addEventListener('touchend', stopDrawing);
  window.addEventListener('touchcancel', stopDrawing);

  // --- 5. Client Cursor Streaming & Rendering ---
  let lastCursorEmit = 0;
  function emitCursorMove(x, y) {
    const now = Date.now();
    // Client-side throttle: emit at most every 35ms (~28 fps)
    if (now - lastCursorEmit > 35) {
      lastCursorEmit = now;
      socket.emit('cursor:move', {
        boardId,
        x: Math.round(x),
        y: Math.round(y)
      });
    }
  }

  function updateCollaboratorCursor(userId, x, y) {
    let cursorEl = document.getElementById(`cursor-${userId}`);
    const user = activeUsersMap.get(userId) || {
      username: 'Collaborator',
      color: '#4f46e5'
    };

    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.id = `cursor-${userId}`;
      cursorEl.className = 'collaborator-cursor';
      cursorEl.innerHTML = `
        <svg class="cursor-pointer-icon" viewBox="0 0 24 24" fill="${user.color}" stroke="#ffffff" stroke-width="1.5">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36z"/>
        </svg>
        <span class="cursor-label" style="background-color: ${user.color};">${user.username}</span>
      `;
      cursorsOverlay.appendChild(cursorEl);
    }

    cursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function removeCollaboratorCursor(userId) {
    const cursorEl = document.getElementById(`cursor-${userId}`);
    if (cursorEl) {
      cursorEl.remove();
    }
  }

  // --- 6. Active Users Strip Rendering ---
  function renderActiveUsers() {
    usersAvatarsList.innerHTML = '';
    const users = Array.from(activeUsersMap.values());
    usersCounter.textContent = users.length;

    users.forEach(user => {
      const bubble = document.createElement('div');
      bubble.className = 'avatar-bubble';
      bubble.style.backgroundColor = user.color || '#4f46e5';
      bubble.textContent = (user.username || 'G').charAt(0).toUpperCase();
      bubble.title = `${user.username}${user.userId === socket.id ? ' (You)' : ''}`;
      usersAvatarsList.appendChild(bubble);
    });
  }

  function updateProfileBadgeUI() {
    if (usernameDisplay) usernameDisplay.textContent = currentUser.username;
    if (userColorIndicator) userColorIndicator.style.backgroundColor = currentUser.color;
  }

  // --- 7. Toolbar & Interactive Controls ---
  // Color Swatches
  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      currentColor = swatch.getAttribute('data-color');
      isEraser = false;
      brushToolBtn.classList.add('active');
      eraserToolBtn.classList.remove('active');
    });
  });

  // Custom Color Picker
  customColorInput.addEventListener('input', (e) => {
    currentColor = e.target.value;
    colorSwatches.forEach(s => s.classList.remove('active'));
    isEraser = false;
    brushToolBtn.classList.add('active');
    eraserToolBtn.classList.remove('active');
  });

  // Brush / Eraser Toggles
  brushToolBtn.addEventListener('click', () => {
    isEraser = false;
    brushToolBtn.classList.add('active');
    eraserToolBtn.classList.remove('active');
  });

  eraserToolBtn.addEventListener('click', () => {
    isEraser = true;
    eraserToolBtn.classList.add('active');
    brushToolBtn.classList.remove('active');
  });

  // Brush Size
  brushSizeSlider.addEventListener('input', (e) => {
    currentSize = e.target.value;
    brushSizeLabel.textContent = `${currentSize}px`;
  });

  // Undo Action
  function triggerUndo() {
    socket.emit('draw:undo', { boardId });
  }
  undoBtn.addEventListener('click', triggerUndo);

  // Keyboard shortcut for Undo (Ctrl+Z / Cmd+Z)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (!e.shiftKey) {
        e.preventDefault();
        triggerUndo();
      }
    }
  });

  // Clear Action
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear the whiteboard for everyone in this room?')) {
      socket.emit('board:clear', { boardId });
    }
  });

  // Export / Save PNG
  exportBtn.addEventListener('click', () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    // Fill background with clean off-white
    tempCtx.fillStyle = '#ffffff';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = `whiteboard-${boardId}-${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    showToast('Board exported as PNG image');
  });

  // Copy Room Link
  function copyRoomLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Room link copied to clipboard!');
    }).catch(() => {
      showToast(`Share this URL: ${url}`);
    });
  }
  shareRoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyRoomLink();
  });
  roomIdDisplay.parentElement.addEventListener('click', copyRoomLink);

  // --- 8. Profile Modal ---
  userProfileBadge.addEventListener('click', () => {
    modalUsernameInput.value = currentUser.username;
    modalColorsGrid.innerHTML = '';
    AVATAR_COLORS.forEach(c => {
      const opt = document.createElement('div');
      opt.className = `modal-color-option ${c === currentUser.color ? 'selected' : ''}`;
      opt.style.backgroundColor = c;
      opt.addEventListener('click', () => {
        document.querySelectorAll('.modal-color-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        currentUser.color = c;
      });
      modalColorsGrid.appendChild(opt);
    });
    nameModal.classList.remove('hidden');
  });

  modalCancelBtn.addEventListener('click', () => {
    nameModal.classList.add('hidden');
  });

  modalSaveBtn.addEventListener('click', () => {
    const rawName = modalUsernameInput.value.trim();
    if (rawName) {
      currentUser.username = rawName.substring(0, 25);
    }
    localStorage.setItem('collab_username', currentUser.username);
    localStorage.setItem('collab_user_color', currentUser.color);
    updateProfileBadgeUI();
    nameModal.classList.add('hidden');

    // Re-emit join to sync updated name and color with peers
    emitJoinRoom();
    showToast('Profile updated!');
  });

  // --- 9. Toast Notification System ---
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

})();
