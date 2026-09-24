# 🎨 Real-Time Collaborative Whiteboard & Canvas (Socket.io)

A production-grade, high-performance real-time collaborative whiteboard built with **Node.js**, **Express.js**, **Socket.io**, and the **HTML5 Canvas API**.

---

## 🔗 Live Demo & Submission Links

- 🌐 **Live Render Deployment**: `https://<your-render-subdomain>.onrender.com/?board=demo` *(Replace with your deployed URL)*
- 📹 **Screen Recording Demonstration**: `https://<your-video-link>` *(Replace with your demo video link)*
- 📦 **GitHub Repository**: [itm-assignment-11-whiteboard-socket](https://github.com/kartikwagh21/assignment-11-collaborative-whiteboard)

---

## ✨ Features

- ⚡ **Continuous Vector Stroke Streaming**: Zero-lag drawing synchronization between multi-user clients via optimized WebSocket event streams.
- 💾 **In-Memory Room History Buffer**: Instant state synchronization (`board:init`) for newly joined peers replaying complete room drawings.
- 🖱️ **Live Multi-User Collaborator Cursors**: High-frequency real-time pointer streaming with custom colored SVG indicators and labeled username tags.
- 👥 **Multi-Tenant Room Partitioning**: Isolated board rooms keyed by URL query parameter (`?board=ROOM_ID`) using Socket.io room abstractions.
- ⏪ **Smart Continuous Stroke Undo**: State rollback grouped by continuous mouse-down-to-up actions (`strokeId`) replayed deterministically across peers.
- 🧹 **Instant Board Wipe**: Room-wide canvas reset with notifier toast alerts.
- 📱 **Responsive & Retina-Ready**: High-DPI screen scaling (`devicePixelRatio`), touch & pointer support for mobile/tablets, and glassmorphic floating toolbars.
- 🖼️ **Image Export & Shareable Links**: Instant PNG canvas download and one-click shareable board link copy.
- 🛡️ **Input Sanitization & Bandwidth Throttling**: HTML-escaped usernames (stored XSS protection), strict coordinate bounding, and server-side cursor throttling.

---

## 🛠️ Tech Stack & Architecture

- **Backend / Real-Time**: Node.js (>= 18), Express.js 4.x, Socket.io 4.x, CORS, Dotenv
- **Frontend / Client**: Vanilla JavaScript (ES6+), HTML5 Canvas 2D Context API, CSS3 Glassmorphism & CSS Variables
- **Development & Testing**: Nodemon, Socket.io-Client (Automated smoke testing suite)
- **Deployment Target**: Render Web Service (Native WebSocket Support)

---

## 🔄 Real-Time Event Protocol

The whiteboard implements a strict bidirectional event protocol:

### 🔄 Room & Session Events

| Event Name | Direction | Payload Schema | Server-Side Processing & Logic |
| :--- | :--- | :--- | :--- |
| `board:join` | Client → Server | `{ "boardId": "DESIGN_101", "username": "Alice", "userColor": "#ff5722" }` | Validates `boardId`, sanitizes `username` (HTML escape against XSS), assigns default hex color if invalid. Removes socket from previous room if switching. Joins room `socket.join(boardId)`, adds user to `boardStore`. Emits `board:init` to joining socket **only**, and broadcasts `user:joined` to other room participants. |
| `board:init` | Server → Client | `{ "strokes": [...], "activeUsers": [...] }` | Emits complete stroke history and active user array to the newly joined peer for instant canvas reconstruction. |
| `user:joined` | Server → Room | `{ "userId": "socket_id", "username": "Alice", "color": "#ff5722" }` | Broadcasted (`socket.to(boardId)`) to other peers in the room to display collaborator avatars and notifications. |
| `user:left` | Server → Room | `{ "userId": "socket_id", "username": "Alice" }` | Triggered upon socket disconnect. Removes collaborator cursor and avatar; prunes empty room from server memory if 0 users remain. |

### ✏️ Drawing & Pointer Events

| Event Name | Direction | Payload Schema | Server-Side Processing & Logic |
| :--- | :--- | :--- | :--- |
| `draw:stroke` | Client → Server | `{ "boardId": "...", "stroke": { "strokeId": "uuid", "prevX": 120, "prevY": 80, "currX": 125, "currY": 85, "color": "#000", "size": 3 } }` | Validates room membership and finite coordinate bounds. Appends stroke to room history buffer (capped at 5,000 strokes). Relays `draw:broadcast` to all **other** room peers (`socket.to(boardId)`). |
| `draw:broadcast` | Server → Room | `{ "stroke": { ... } }` | Relays drawing segment directly to peer clients for instant local canvas rendering without redrawing everything. |
| `cursor:move` | Client → Server | `{ "boardId": "...", "x": 140, "y": 95 }` | High-frequency mouse/touch coordinates. Rate-limited on the server (~30–50 updates/sec) to conserve bandwidth. |
| `cursor:update` | Server → Room | `{ "userId": "socket_id", "x": 140, "y": 95 }` | Relays peer cursor positions in real time to render collaborator pointer overlays. |
| `board:clear` | Client → Server | `{ "boardId": "DESIGN_101" }` | Resets `boardRooms[boardId].strokes = []`. Broadcasts `board:cleared` to **all** room peers (including sender via `io.to(boardId)`). |
| `board:cleared` | Server → Room | `{ "clearedBy": "Alice" }` | Instructs all room clients to clear their canvas and shows a toast notification. |
| `draw:undo` | Client → Server | `{ "boardId": "DESIGN_101" }` | Finds the `strokeId` of the last segment in history and removes **all** continuous segments sharing that `strokeId`. Broadcasts `board:sync` with remaining history. |
| `board:sync` | Server → Room | `{ "strokes": [...] }` | Broadcasts refreshed stroke snapshot to all peers so all canvases redraw in identical order. |

---

## 🏛️ In-Memory State & Architecture Notes

### 1. In-Memory Store Structure (`sockets/boardStore.js`)
```javascript
const boardRooms = {
  "DESIGN_101": {
    boardId: "DESIGN_101",
    strokes: [
      {
        strokeId: "b6f04c10-8b1e-4503...",
        prevX: 120,
        prevY: 80,
        currX: 125,
        currY: 85,
        color: "#1e293b",
        size: 3,
        socketId: "abc123xyz",
        timestamp: 1726998000000
      }
    ],
    users: {
      "abc123xyz": {
        userId: "abc123xyz",
        username: "Alice",
        color: "#ff5722",
        cursor: { x: 140, y: 95 }
      }
    }
  }
};
```

### 2. Why Continuous Undo Groups by `strokeId`
A single human brush stroke consists of dozens of small line segments emitted on every `mousemove` event. If undo only popped the single latest segment, clicking "Undo" would only shave off a fraction of a millimeter. By generating a single `strokeId` (UUID) on `mousedown`/`touchstart` and attaching it to every segment until `mouseup`/`touchend`, the server can atomically roll back the entire continuous user action in one operation.

### 3. Cursor Streaming & Bandwidth Throttling
Mouse movements can generate over 120+ events per second per client. To prevent network saturation:
- **Client-Side Throttling**: `cursor:move` is throttled to at most once every ~35ms.
- **Server-Side Throttling**: The server enforces a 25ms throttle per socket before broadcasting `cursor:update`.

### 4. Single-Instance Limitation & Horizontal Scaling
The server store lives strictly in Node process memory.
- **Single Instance (Render Free Tier)**: All connected users share the same server memory seamlessly.
- **Horizontal Scaling Limitation**: If running multiple instances behind a load balancer, clients routed to different nodes would not share board state.
- **Scaling Path**: To scale across multiple nodes, replace the local in-memory store with **Redis Pub/Sub** using the official `@socket.io/redis-adapter` and Redis Key-Value / JSON caching.

---

## 📁 Project Structure

```
Kartik_Wagh/
├── public/
│   ├── index.html          # Full HTML5 Canvas collaborative interface
│   ├── canvas.js           # Client-side drawing engine & Socket.io manager
│   └── styles.css          # Glassmorphism design system & toolbars
├── sockets/
│   ├── boardStore.js       # Shared in-memory boardRooms store & helpers
│   ├── boardHandler.js     # Room join, stroke streaming & canvas reset handlers
│   └── cursorHandler.js    # Live cursor coordinate streaming & throttling
├── scripts/
│   └── socketSmokeTest.js  # Automated multi-client Socket.io test suite
├── .env.example            # Environment variables template
├── .gitignore              # Git ignored files (node_modules, .env)
├── package.json            # Node.js configuration & dependencies
├── render.yaml             # Render Blueprint configuration
├── server.js               # Express & Socket.io server bootstrap
└── README.md               # Comprehensive documentation
```

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js (v18 or later)
- npm (v9 or later)

### Installation & Run

1. **Navigate into the project root**:
   ```bash
   cd Kartik_Wagh
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   # Or standard production start:
   npm start
   ```

5. **Open the application**:
   Visit [http://localhost:5000/?board=demo](http://localhost:5000/?board=demo) in your web browser.

---

## 🧪 Automated Testing

Run the built-in multi-client smoke test suite to programmatically verify all Socket.io real-time events, room joins, stroke broadcasts, cursor movements, undo rollback, and cleanup:

```bash
npm run test:smoke
```

---

## 🖥️ Manual Multi-Window Verification Steps

To test the real-time collaborative behavior visually:

1. **Open Two Windows Side-by-Side**:
   - Open Window 1: `http://localhost:5000/?board=demo`
   - Open Window 2: `http://localhost:5000/?board=demo` in an Incognito window or separate browser.
2. **Test Real-Time Drawing**:
   - Draw freehand strokes in Window 1.
   - Observe the strokes appearing instantaneously in Window 2 without any page reload.
3. **Test Collaborator Cursors**:
   - Move the mouse in Window 1 without drawing.
   - Observe a colored pointer with Window 1's username tracking smoothly in Window 2.
4. **Test Late Joiner History Synchronization**:
   - Open a third window at `http://localhost:5000/?board=demo`.
   - Confirm that all existing drawings are immediately rendered upon joining via `board:init`.
5. **Test Undo Action**:
   - Draw a distinct line in Window 1.
   - Click **Undo** (or press `Ctrl+Z` / `Cmd+Z`) in Window 1.
   - Confirm that the entire continuous stroke is removed in all open windows simultaneously.
6. **Test Clear Canvas**:
   - Click the **Clear** button in Window 2.
   - Confirm that all windows wipe their canvas instantly and display a notification toast (`"Board cleared by..."`).

---

## ☁️ Deployment on Render

Render Web Services provide built-in native support for WebSockets and Node.js.

### Step-by-Step Render Setup

1. **Push your code to GitHub**:
   Ensure `Kartik_Wagh` is the root of your GitHub repository `itm-assignment-11-whiteboard-socket`.
2. **Create New Web Service**:
   - Log in to [Render Dashboard](https://dashboard.render.com/).
   - Click **New +** → **Web Service** → Connect your GitHub repository.
3. **Configure Service**:
   - **Name**: `itm-assignment-11-whiteboard-socket`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `CORS_ORIGIN`: `*`
   *(Do NOT set `PORT` — Render automatically injects `process.env.PORT`)*
5. **Health Check**:
   - Set Health Check Path to: `/health`
6. **Click "Create Web Service"**.

> [!NOTE]
> **Render Free Tier Cold Starts**: Render's free tier spins down after ~15 minutes of inactivity. The first connection after sleep may take ~30–50 seconds to boot up. Once awake, WebSockets connect with sub-millisecond response latency.


DEPLOYMENT LINK:
https://assignment-11-collaborative-whiteboard-0l7j.onrender.com
