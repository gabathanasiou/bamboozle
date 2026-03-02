const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const ttsService = require('./ttsService');
const adminRoutes = require('./adminRoutes');

// Phase 1 Hardening Constants
const MAX_CONCURRENT_ROOMS_PER_HOST = 2;
const MAX_EVENTS_PER_WINDOW = 20;
const EVENT_RATE_WINDOW = 10000; // 10 seconds
const MAX_NAME_LENGTH = 12;
const MAX_ANSWER_LENGTH = 100;

// State for hardening
const socketEventCounts = {}; // { socketId: { count, windowStart } }

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors());

// Admin routes - only for local development/management
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/admin', adminRoutes);
}

// Serve Static Audio Files from Cache
// Route: /audio/:roomCode/:filename
app.use('/audio', express.static('/tmp/bamboozle_audio_cache', {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

app.get('/', (req, res) => {
  res.send('Bamboozle server is running');
});

// Get server version
app.get('/api/version', (req, res) => {
  const packageJson = require('./package.json');
  res.json({ version: packageJson.version });
});

// Trigger TTS manually (fallback/test endpoint)
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language, roomCode } = req.body;
    const result = await ttsService.getAudio(text, language || 'en', roomCode || 'test');
    res.json({ url: result.url, isHit: result.isHit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- HELPER FUNCTIONS ---

function sanitize(str, maxLen = 100) {
  if (typeof str !== 'string') return '';
  // Strip HTML tags and truncate
  return str.replace(/<[^>]*>?/gm, '').substring(0, maxLen).trim();
}

function countActiveRoomsByHost(hostId) {
  return Object.values(rooms).filter(r => r.hostId === hostId).length;
}

function closeRoom(roomCode, reason) {
  if (!rooms[roomCode]) return;

  const lifetime = Math.floor((Date.now() - rooms[roomCode].createdAt) / 1000);
  console.log(`[Server] Room Closed (${reason}): ${roomCode} | Lifetime: ${lifetime}s`);

  // Notify everyone in the room
  io.to(roomCode).emit('roomClosed');

  // Clean up all timeouts
  if (hostTimeouts[roomCode]) {
    clearTimeout(hostTimeouts[roomCode]);
    delete hostTimeouts[roomCode];
  }
  if (roomTimeouts[roomCode]) {
    clearTimeout(roomTimeouts[roomCode]);
    delete roomTimeouts[roomCode];
  }

  // Clean up player-specific timeouts
  Object.keys(playerTimeouts).forEach(key => {
    if (key.startsWith(`${roomCode}:`)) {
      clearTimeout(playerTimeouts[key]);
      delete playerTimeouts[key];
    }
  });

  // TTS Cleanup
  ttsService.cleanupRoom(roomCode);

  delete rooms[roomCode];
}

function isSocketRateLimited(socketId) {
  const now = Date.now();
  if (!socketEventCounts[socketId]) {
    socketEventCounts[socketId] = { count: 0, windowStart: now };
  }

  const tracker = socketEventCounts[socketId];
  if (now - tracker.windowStart > EVENT_RATE_WINDOW) {
    tracker.count = 0;
    tracker.windowStart = now;
  }

  tracker.count++;
  return tracker.count > MAX_EVENTS_PER_WINDOW;
}

server.listen(PORT, () => {
  console.log(`[Server] ${new Date().toISOString()} - Listening on port ${PORT}`);
});

// Room management and game state
const rooms = {}; // { roomCode: { players: [], audience: [], state: {}, hostSocketId, pendingHostReconnect: boolean } }
const roomTimeouts = {}; // For empty room cleanup
const hostTimeouts = {}; // For host disconnection grace period
const playerTimeouts = {}; // For player disconnection tracking { `${roomCode}:${playerId}`: timeoutId }
const socketToPlayer = {}; // Map socket.id -> { roomCode, playerId }

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('checkRoom', ({ roomCode }, callback) => {
    console.log(`[Server] checkRoom: ${roomCode} - Exists: ${!!rooms[roomCode]}`);
    if (callback) {
      callback({ exists: !!rooms[roomCode] });
    }
  });

  socket.on('getRoomsByHost', ({ hostId }, callback) => {
    const cleanHostId = sanitize(hostId, 50);
    const hostRooms = Object.entries(rooms)
      .filter(([_, r]) => r.hostId === cleanHostId)
      .map(([code, r]) => ({
        roomCode: code,
        phase: r.state.phase,
        playerCount: Object.keys(r.players).length,
        playerNames: Object.values(r.players).map(p => p.name),
        isGracePeriod: r.pendingHostReconnect,
        createdAt: r.createdAt
      }));
    if (callback) callback(hostRooms);
  });

  socket.on('createRoom', ({ hostId }, callback) => {
    if (isSocketRateLimited(socket.id)) return;

    const cleanHostId = sanitize(hostId, 50);

    // Dynamic Room Management:
    // Limit: Max 2 active (non-grace) rooms.
    // 3rd room -> Move oldest to grace period.
    // 4th room -> Destroy oldest.
    const hostRooms = Object.entries(rooms)
      .filter(([_, r]) => r.hostId === cleanHostId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    if (hostRooms.length >= 3) {
      // Hard cap: Destroy oldest
      const [oldCode] = hostRooms[0];
      console.log(`[Limit] Host ${cleanHostId} created 4th room. Destroying oldest: ${oldCode}`);
      closeRoom(oldCode, 'LIMIT_HARD_CAP');
      hostRooms.shift(); // Remove from temporary list
    }

    if (hostRooms.length === 2) {
      // Soft cap: Grace period for oldest
      const [oldCode, oldRoom] = hostRooms[0];
      if (!oldRoom.pendingHostReconnect) {
        console.log(`[Limit] Host ${cleanHostId} created 3rd room. Putting ${oldCode} into grace.`);
        oldRoom.pendingHostReconnect = true;
        oldRoom.hostSocketId = null;
        io.to(oldCode).emit('hostDisconnected');
        // Start grace timer if not active
        if (!hostTimeouts[oldCode]) {
          hostTimeouts[oldCode] = setTimeout(() => closeRoom(oldCode, 'LIMIT_GRACE_EXPIRED'), 60000);
        }
      }
    }

    const roomCode = generateRoomCode();

    // Clear any pending deletion for this room code (unlikely collision but safe)
    if (roomTimeouts[roomCode]) {
      clearTimeout(roomTimeouts[roomCode]);
      delete roomTimeouts[roomCode];
    }

    rooms[roomCode] = {
      hostSocketId: socket.id,
      hostId: cleanHostId, // Track the host's player ID for reconnection
      pendingHostReconnect: false,
      players: {},
      audience: {},
      createdAt: Date.now(),
      state: {
        roomCode,
        players: {},
        audience: {},
        phase: 'LOBBY',
        currentRound: 0,
        totalRounds: 3,
        emotes: []
      }
    };
    socket.join(roomCode);
    socket.data.roomCode = roomCode; // Track room for disconnect logic
    socket.data.isHost = true;

    if (callback) callback(roomCode);
    console.log(`[Server] Room Created: ${roomCode} | Host: ${cleanHostId}`);
  });

  socket.on('joinRoom', ({ roomCode, role, name, id }, callback) => {
    if (isSocketRateLimited(socket.id)) return;

    const cleanRoomCode = sanitize(roomCode, 4).toUpperCase();
    const cleanName = sanitize(name, MAX_NAME_LENGTH);
    const cleanId = sanitize(id, 50);

    if (!rooms[cleanRoomCode]) {
      if (callback) callback({ error: 'Room not found' });
      return;
    }

    const roomCodeNormalized = cleanRoomCode;

    // Cancel room cleanup if room was pending deletion
    if (roomTimeouts[roomCodeNormalized]) {
      clearTimeout(roomTimeouts[roomCodeNormalized]);
      delete roomTimeouts[roomCodeNormalized];
      console.log(`Room ${roomCodeNormalized} deletion cancelled (user joined)`);
    }

    // Check if this is the original host reclaiming their room
    const isOriginalHost = rooms[roomCodeNormalized].hostId === cleanId;
    let becameHost = false;

    // Allow host to reclaim only if:
    // 1. They are the original host AND
    // 2. Room is pending reconnect (host actually disconnected)
    if (isOriginalHost && rooms[roomCodeNormalized].pendingHostReconnect) {
      // Original host is reclaiming their room!
      if (hostTimeouts[roomCodeNormalized]) {
        clearTimeout(hostTimeouts[roomCodeNormalized]);
        delete hostTimeouts[roomCodeNormalized];
      }
      rooms[roomCodeNormalized].hostSocketId = socket.id;
      rooms[roomCodeNormalized].pendingHostReconnect = false;
      socket.data.isHost = true;
      becameHost = true;
      console.log(`Original host ${cleanId} reclaimed room ${roomCodeNormalized}!`);

      // Notify other players that host has reconnected
      socket.to(roomCodeNormalized).emit('hostReconnected');
    }

    // Cancel player timeout if player is reconnecting
    const playerKey = `${roomCodeNormalized}:${cleanId}`;
    if (playerTimeouts[playerKey]) {
      clearTimeout(playerTimeouts[playerKey]);
      delete playerTimeouts[playerKey];
      console.log(`Player ${cleanId} reconnected to ${roomCodeNormalized}. Kick cancelled.`);
    }

    socket.join(roomCodeNormalized);
    socket.data.roomCode = roomCodeNormalized; // Track room for disconnect logic

    // Track this socket -> player mapping for disconnect handling
    if (cleanId) {
      socketToPlayer[socket.id] = { roomCode: roomCodeNormalized, playerId: cleanId };
    }

    if (callback) callback({ success: true, state: rooms[roomCodeNormalized].state, becameHost });
    console.log(`User ${cleanName || 'Anonymous'} joined room ${roomCodeNormalized} as ${role}${becameHost ? ' (reclaimed host)' : ''}`);
  });

  socket.on('gameStateUpdate', ({ roomCode, gameState }) => {
    if (isSocketRateLimited(socket.id)) return;
    if (rooms[roomCode]) {
      rooms[roomCode].state = gameState;
      // Broadcast to everyone in the room EXCEPT the sender (host)
      socket.to(roomCode).emit('gameStateUpdate', gameState);
    }
  });

  // Relay generic events from Host to All
  socket.on('hostEvent', ({ roomCode, event }) => {
    if (isSocketRateLimited(socket.id)) return;
    socket.to(roomCode).emit('hostEvent', event);
  });

  // --- TTS LOGIC ---
  socket.on('requestNarrator', async ({ roomCode, text, language, requestId }) => {
    if (isSocketRateLimited(socket.id)) return;
    try {
      const cleanText = sanitize(text, 500); // Allow longer for TTS but still capped
      console.log(`[TTS Req] Room: ${roomCode}, Text: "${cleanText}", ReqId: ${requestId}`);
      // Only accept from Host (simple check via rooms map)
      if (!rooms[roomCode]) return; // Invalid room

      // Generate (or get from cache)
      const result = await ttsService.getAudio(cleanText, language || 'en', roomCode);

      // Use GCS URL directly
      const audioUrl = result.url;

      // Broadcast to everyone ONLY if in Online Mode, otherwise only to Host (the sender)
      const isOnlineMode = rooms[roomCode].state && rooms[roomCode].state.isOnlineMode;

      if (isOnlineMode) {
        io.in(roomCode).emit('playAudio', {
          audioUrl,
          text,
          requestId,
          isHit: result.isHit,
          hash: null
        });
      } else {
        // Only back to host (sender)
        socket.emit('playAudio', {
          audioUrl,
          text,
          requestId,
          isHit: result.isHit,
          hash: null
        });
      }

    } catch (e) {
      console.error('Narrator Error:', e);
    }
  });

  socket.on('requestState', ({ roomCode }, callback) => {
    if (rooms[roomCode]) {
      if (callback) callback(rooms[roomCode].state);
    } else {
      if (callback) callback(null);
    }
  });

  // Relay events from players to host
  socket.on('playerEvent', ({ roomCode, event }) => {
    if (isSocketRateLimited(socket.id)) return;

    // Sanitize user inputs in payloads (lies, votes)
    if (event.payload) {
      if (typeof event.payload.text === 'string') {
        event.payload.text = sanitize(event.payload.text, MAX_ANSWER_LENGTH);
      }
      if (typeof event.payload.name === 'string') {
        event.payload.name = sanitize(event.payload.name, MAX_NAME_LENGTH);
      }
    }

    console.log('[Server] playerEvent in ' + roomCode + ': ' + event.type);
    socket.to(roomCode).emit('playerEvent', event);
  });

  socket.on('disconnect', () => {
    // console.log('User disconnected:', socket.id);
    delete socketEventCounts[socket.id];

    const roomCode = socket.data.roomCode;
    if (roomCode && rooms[roomCode]) {
      // Check if host disconnected
      if (rooms[roomCode].hostSocketId === socket.id) {
        console.log(`[Server] Host Disconnected: ${roomCode} | Starting 60s grace.`);
        rooms[roomCode].pendingHostReconnect = true;

        // Notify players that host disconnected (they can wait for reconnection)
        io.to(roomCode).emit('hostDisconnected');

        // Start 60 second grace period for host to reconnect
        hostTimeouts[roomCode] = setTimeout(() => {
          closeRoom(roomCode, 'HOST_TIMEOUT');
        }, 60000);

        return;
      }
      // ... rest of logic

      // Check if a tracked player disconnected
      const playerInfo = socketToPlayer[socket.id];
      if (playerInfo && playerInfo.roomCode === roomCode && playerInfo.playerId) {
        const playerId = playerInfo.playerId;
        const playerKey = `${roomCode}:${playerId}`;

        console.log(`Player ${playerId} disconnected from ${roomCode}. Starting 60s kick timer.`);

        // Notify the room about player disconnection
        io.to(roomCode).emit('playerDisconnected', { playerId });

        // Start 60 second timer to kick player
        playerTimeouts[playerKey] = setTimeout(() => {
          console.log(`Player ${playerId} did not reconnect to ${roomCode} within 60s. Kicking.`);
          io.to(roomCode).emit('playerKicked', { playerId });
          delete playerTimeouts[playerKey];
        }, 60000);

        delete socketToPlayer[socket.id];
        return;
      }

      // Clean up socket mapping
      delete socketToPlayer[socket.id];

      // Check if room is empty of human players
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      const numClients = roomSockets ? roomSockets.size : 0;

      console.log(`User left ${roomCode}. Remaining connections: ${numClients}`);

      if (numClients === 0 && rooms[roomCode]) {
        console.log(`[Server] Room Empty: ${roomCode} | Starting 60s grace.`);
        roomTimeouts[roomCode] = setTimeout(() => {
          closeRoom(roomCode, 'ROOM_EMPTY');
        }, 60000);
      }
    }
  });
});

