# 🎨 Assignment 11: Real-Time Collaborative Whiteboard & Canvas (Socket.io)
> **Track:** Backend & Real-Time Web | **Level:** Advanced | **Estimated Time:** 7–9 Hours  
> **Tech Stack:** Node.js, Express.js, Socket.io, HTML5 Canvas API, CORS

---

## 📌 1. Objective & Overview

Build a high-performance **Real-Time Collaborative Multi-User Whiteboard Application** using **Node.js, Express.js, and Socket.io**. This assignment challenges students to synchronize continuous vector stroke streams, manage shared canvas draw history buffers in server memory, handle multi-user room partitioning (`roomId`), track live pointer/cursor coordinates across connected peers, and implement coordinated canvas actions such as `clear` and `undo`.

### Key Learning Outcomes:
- Handling high-frequency WebSocket event streams with minimal latency overhead.
- Maintaining an in-memory stroke history buffer per room so new joiners immediately sync the existing drawing state.
- Broadcasting cursor coordinate deltas to display live collaborator cursors in real time.
- Designing state rollback algorithms (`draw:undo` and `draw:clear`).
- Managing multi-tenant whiteboard rooms (`socket.join(boardId)`).

---

## 🛠️ 2. Tech Stack & Dependencies

```bash
# Initialize Node.js project
npm init -y

# Install dependencies
npm install express socket.io cors dotenv

# Install development dependencies
npm install -D nodemon
```

---

## 🖌️ 3. Real-Time Canvas Event Protocol

### 🔄 Room & Session Events

| Event Name | Direction | Payload Schema | Description |
|---|:---:|---|---|
| `board:join` | `Client -> Server` | `{ "boardId": "DESIGN_101", "username": "Alice", "userColor": "#ff5722" }` | Join a collaborative canvas room |
| `board:init` | `Server -> Client` | `{ "strokes": [...], "activeUsers": [...] }` | Emits complete stroke history to the newly joined peer |
| `user:joined` | `Server -> Room` | `{ "userId": "socket_id", "username": "Alice", "color": "#ff5722" }` | Notifies other participants in the board room |
| `user:left` | `Server -> Room` | `{ "userId": "socket_id", "username": "Alice" }` | Broadcasted when a peer disconnects |

### ✏️ Drawing & Pointer Events

| Event Name | Direction | Payload Schema | Description |
|---|:---:|---|---|
| `draw:stroke` | `Client -> Server` | `{ "boardId": "...", "stroke": { "prevX": 120, "prevY": 80, "currX": 125, "currY": 85, "color": "#000", "size": 3 } }` | Client draws a line segment; server appends to room history |
| `draw:broadcast` | `Server -> Room (broadcast.to)` | `{ "stroke": { ... } }` | Relays drawing stroke to all other participants in the room |
| `cursor:move` | `Client -> Server` | `{ "boardId": "...", "x": 140, "y": 95 }` | High-frequency mouse pointer sync |
| `cursor:update` | `Server -> Room (broadcast.to)` | `{ "userId": "socket_id", "x": 140, "y": 95 }` | Relays peer cursor positions on screen |
| `board:clear` | `Client -> Server` | `{ "boardId": "DESIGN_101" }` | Clears all strokes for this room |
| `board:cleared` | `Server -> Room` | `{ "clearedBy": "Alice" }` | Notifies all room peers to wipe their local canvas |
| `draw:undo` | `Client -> Server` | `{ "boardId": "DESIGN_101" }` | Removes the last continuous stroke action |
| `board:sync` | `Server -> Room` | `{ "strokes": [...] }` | Broadcasts new state snapshot after undo |

---

## 🏗️ 4. Server-Side Board State Architecture

```javascript
// In-Memory Whiteboard Store
const boardRooms = {
  "DESIGN_101": {
    boardId: "DESIGN_101",
    strokes: [], // Array of stroke objects
    users: {}    // Map of socketId -> { username, color, cursor: { x, y } }
  }
};
```

---

## 📁 5. Directory Structure

```text
assignment-11-whiteboard-socket/
├── public/
│   ├── index.html           # Full HTML5 Canvas collaborative interface
│   ├── canvas.js            # Client-side drawing & socket event emitter
│   └── styles.css           # Toolbars, color pickers & canvas layout
├── sockets/
│   ├── boardHandler.js      # Room join, stroke caching & canvas reset handlers
│   └── cursorHandler.js     # Live cursor coordinate streaming
├── server.js                # Express & Socket.io server bootstrap
├── package.json
└── README.md
```

---

## 🧪 6. Testing & Validation

1. Start server at `http://localhost:5000`.
2. Open two browser windows side-by-side on `http://localhost:5000?board=demo`.
3. Draw in Window 1: verify that Window 2 renders the exact stroke in real time without lag.
4. Move mouse in Window 1: verify a colored collaborator cursor moves smoothly in Window 2.
5. Open a third browser window in an incognito tab with the same board URL: verify it immediately loads all prior strokes from `board:init`.
6. Click **Clear Canvas** in Window 1: verify both Window 2 and 3 instantly clear.

---

## 📊 7. Grading Rubric (100 Marks)

| Evaluation Component | Marks |
|---|:---:|
| **Socket.io Connection & Multi-Room Management** | 25 |
| **Real-Time Stroke Streaming & History Buffer Synchronization** | 30 |
| **Live Multi-User Collaborator Cursor Tracking** | 15 |
| **Canvas Reset (`board:clear`) & Undo Implementation** | 15 |
| **Client UI Smoothness, Responsive Canvas & Code Organization** | 15 |
| **Total Marks** | **100** |

---

## 📤 8. Submission Guidelines

- Submit your GitHub repository: `itm-assignment-11-whiteboard-socket`.
- Provide a link to a live demo or a screen recording displaying 2 browser windows drawing together simultaneously.
