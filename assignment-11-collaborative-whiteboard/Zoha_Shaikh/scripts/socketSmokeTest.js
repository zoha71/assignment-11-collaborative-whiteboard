require('dotenv').config();
const { io: ioClient } = require('socket.io-client');
const http = require('http');

// Target test server URL (reads PORT from .env or defaults to 5000)
const PORT = process.env.PORT || 5000;
const SERVER_URL = process.env.TEST_SERVER_URL || `http://localhost:${PORT}`;
const TEST_BOARD = 'TEST_ROOM_' + Date.now();

let testsPassed = 0;
let testsFailed = 0;

function logPass(msg) {
  console.log(`\x1b[32m✔ [PASS]\x1b[0m ${msg}`);
  testsPassed++;
}

function logFail(msg, err) {
  console.error(`\x1b[31m✖ [FAIL]\x1b[0m ${msg}`, err || '');
  testsFailed++;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchHttp(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${SERVER_URL}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function runSmokeTests() {
  console.log(`\n======================================================`);
  console.log(`🧪 Starting Real-Time Socket.io Whiteboard Smoke Tests`);
  console.log(`📡 Connecting to: ${SERVER_URL}`);
  console.log(`🎯 Test Board ID: ${TEST_BOARD}`);
  console.log(`======================================================\n`);

  // --- Step 1: Verify HTTP Health Endpoint ---
  try {
    const health = await fetchHttp('/health');
    if (health.status === 200 && health.body.status === 'ok') {
      logPass(`GET /health returned status 200 ok (activeBoards: ${health.body.activeBoards})`);
    } else {
      logFail(`GET /health failed: status ${health.status}`);
    }
  } catch (err) {
    logFail(`GET /health request error`, err);
  }

  // --- Step 2: Connect Simulated Client A ---
  const clientA = ioClient(SERVER_URL, { reconnection: false, forceNew: true });
  await new Promise(resolve => clientA.on('connect', resolve));
  logPass(`Client A connected with Socket ID: ${clientA.id}`);

  // Join Board on Client A
  const clientAInitPromise = new Promise((resolve) => {
    clientA.once('board:init', resolve);
  });
  clientA.emit('board:join', {
    boardId: TEST_BOARD,
    username: 'Alice_Tester',
    userColor: '#ef4444'
  });
  const initA = await clientAInitPromise;
  if (Array.isArray(initA.strokes) && initA.strokes.length === 0) {
    logPass(`Client A received board:init with empty strokes array for fresh room`);
  } else {
    logFail(`Client A board:init unexpected payload: ${JSON.stringify(initA)}`);
  }

  // --- Step 3: Client A draws stroke 1 (Stroke ID: STROKE_ALPHA) with 2 segments ---
  const strokeAlpha1 = {
    strokeId: 'STROKE_ALPHA',
    prevX: 10,
    prevY: 10,
    currX: 20,
    currY: 20,
    color: '#ef4444',
    size: 4
  };
  const strokeAlpha2 = {
    strokeId: 'STROKE_ALPHA',
    prevX: 20,
    prevY: 20,
    currX: 30,
    currY: 30,
    color: '#ef4444',
    size: 4
  };

  clientA.emit('draw:stroke', { boardId: TEST_BOARD, stroke: strokeAlpha1 });
  clientA.emit('draw:stroke', { boardId: TEST_BOARD, stroke: strokeAlpha2 });
  await delay(100);

  // --- Step 4: Connect Client B and verify history synchronization ---
  const clientB = ioClient(SERVER_URL, { reconnection: false, forceNew: true });
  await new Promise(resolve => clientB.on('connect', resolve));
  logPass(`Client B connected with Socket ID: ${clientB.id}`);

  // Set up listener on Client A to verify user:joined broadcast
  const userJoinedPromiseA = new Promise((resolve) => {
    clientA.once('user:joined', resolve);
  });

  const clientBInitPromise = new Promise((resolve) => {
    clientB.once('board:init', resolve);
  });

  clientB.emit('board:join', {
    boardId: TEST_BOARD,
    username: 'Bob_Tester',
    userColor: '#3b82f6'
  });

  const initB = await clientBInitPromise;
  const userJoinedA = await userJoinedPromiseA;

  if (Array.isArray(initB.strokes) && initB.strokes.length === 2 && initB.strokes[0].strokeId === 'STROKE_ALPHA') {
    logPass(`Client B received board:init containing complete stroke history (2 segments) from earlier client`);
  } else {
    logFail(`Client B history sync failed: ${JSON.stringify(initB)}`);
  }

  if (userJoinedA.username === 'Bob_Tester' && userJoinedA.color === '#3b82f6') {
    logPass(`Client A received user:joined broadcast for Client B`);
  } else {
    logFail(`Client A did not receive expected user:joined event`);
  }

  // --- Step 5: Test real-time drawing broadcast (Client B draws -> Client A receives) ---
  const strokeBeta = {
    strokeId: 'STROKE_BETA',
    prevX: 50,
    prevY: 50,
    currX: 60,
    currY: 60,
    color: '#3b82f6',
    size: 5
  };

  let clientAReceivedStroke = null;
  let clientBReceivedSelfStroke = false;

  clientA.once('draw:broadcast', (payload) => {
    clientAReceivedStroke = payload.stroke;
  });

  clientB.once('draw:broadcast', () => {
    clientBReceivedSelfStroke = true;
  });

  clientB.emit('draw:stroke', { boardId: TEST_BOARD, stroke: strokeBeta });
  await delay(150);

  if (clientAReceivedStroke && clientAReceivedStroke.strokeId === 'STROKE_BETA' && clientAReceivedStroke.currX === 60) {
    logPass(`Client A received draw:broadcast from Client B with identical stroke properties`);
  } else {
    logFail(`Client A failed to receive draw:broadcast from Client B`);
  }

  if (!clientBReceivedSelfStroke) {
    logPass(`Client B did NOT receive self-broadcast (correct socket.to relay)`);
  } else {
    logFail(`Client B incorrectly received its own drawing broadcast`);
  }

  // --- Step 6: Test Cursor Movement Streaming ---
  let clientBCursorUpdate = null;
  clientB.once('cursor:update', (payload) => {
    clientBCursorUpdate = payload;
  });

  clientA.emit('cursor:move', { boardId: TEST_BOARD, x: 250, y: 180 });
  await delay(150);

  if (clientBCursorUpdate && clientBCursorUpdate.userId === clientA.id && clientBCursorUpdate.x === 250 && clientBCursorUpdate.y === 180) {
    logPass(`Client B received cursor:update with accurate coordinates (x: 250, y: 180) and sender userId`);
  } else {
    logFail(`Cursor update test failed: ${JSON.stringify(clientBCursorUpdate)}`);
  }

  // --- Step 7: Test Multi-Segment Undo Rollback ---
  // History currently has STROKE_ALPHA (2 segments) and STROKE_BETA (1 segment).
  // Undoing should remove STROKE_BETA completely and leave only STROKE_ALPHA (2 segments).
  const clientASyncPromise = new Promise(resolve => clientA.once('board:sync', resolve));
  const clientBSyncPromise = new Promise(resolve => clientB.once('board:sync', resolve));

  clientA.emit('draw:undo', { boardId: TEST_BOARD });
  const syncA = await clientASyncPromise;
  const syncB = await clientBSyncPromise;

  if (
    syncA.strokes.length === 2 &&
    syncB.strokes.length === 2 &&
    syncA.strokes.every(s => s.strokeId === 'STROKE_ALPHA')
  ) {
    logPass(`draw:undo successfully removed all segments of STROKE_BETA and synced state (${syncA.strokes.length} remaining strokes) to all clients`);
  } else {
    logFail(`draw:undo failed: syncA=${JSON.stringify(syncA)}, syncB=${JSON.stringify(syncB)}`);
  }

  // --- Step 8: Test Canvas Clear ---
  const clientAClearedPromise = new Promise(resolve => clientA.once('board:cleared', resolve));
  const clientBClearedPromise = new Promise(resolve => clientB.once('board:cleared', resolve));

  clientB.emit('board:clear', { boardId: TEST_BOARD });
  const clearedA = await clientAClearedPromise;
  const clearedB = await clientBClearedPromise;

  if (clearedA.clearedBy === 'Bob_Tester' && clearedB.clearedBy === 'Bob_Tester') {
    logPass(`board:clear broadcasted board:cleared to all clients with clearedBy="Bob_Tester"`);
  } else {
    logFail(`board:clear failed: clearedA=${JSON.stringify(clearedA)}, clearedB=${JSON.stringify(clearedB)}`);
  }

  // Check stats endpoint
  const statsAfterClear = await fetchHttp(`/api/boards/${TEST_BOARD}/stats`);
  if (statsAfterClear.status === 200 && statsAfterClear.body.strokeCount === 0) {
    logPass(`/api/boards/:id/stats reports strokeCount: 0 after clear`);
  } else {
    logFail(`Board stats strokeCount check failed: ${JSON.stringify(statsAfterClear)}`);
  }

  // --- Step 9: Disconnect Client B & Verify Room Cleanup ---
  const clientBId = clientB.id;
  const clientAUserLeftPromise = new Promise(resolve => clientA.once('user:left', resolve));
  clientB.disconnect();

  const userLeftA = await clientAUserLeftPromise;
  if (userLeftA.userId === clientBId && userLeftA.username === 'Bob_Tester') {
    logPass(`Client A received user:left notification when Client B disconnected`);
  } else {
    logFail(`user:left event failed: ${JSON.stringify(userLeftA)}`);
  }

  // Disconnect Client A and verify room cleanup from in-memory store
  clientA.disconnect();
  await delay(150);

  const statsAfterAllLeave = await fetchHttp(`/api/boards/${TEST_BOARD}/stats`);
  if (statsAfterAllLeave.status === 404) {
    logPass(`Empty board room "${TEST_BOARD}" successfully pruned from server memory after all peers disconnected`);
  } else {
    logFail(`Room not cleaned up from memory: status ${statsAfterAllLeave.status}`);
  }

  // --- Test Summary ---
  console.log(`\n======================================================`);
  console.log(`📊 Smoke Test Summary: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log(`======================================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSmokeTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
