// signaling_server.js
const WebSocket = require("ws");
const http = require("http");
const url = require("url");

const SIGNALING_PORT = process.env.SIGNALING_PORT || 8080;

// In-memory store for rooms and clients
const rooms = {};

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebRTC Signaling Server\n");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const clientId = ws._socket.remoteAddress + ":" + ws._socket.remotePort;
  let currentRoomId = null;

  console.log(`[WS] Client connected: ${clientId}`);

  ws.on("message", (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
      console.log(
        `[WS] Received message from ${clientId}:`,
        parsedMessage.type
      );
    } catch (e) {
      console.error(`[WS] Invalid JSON received from ${clientId}: ${message}`);
      return;
    }

    switch (parsedMessage.type) {
      case "join":
        const { roomId } = parsedMessage;
        if (!roomId) {
          console.warn(`[WS] Client ${clientId} sent 'join' without roomId.`);
          return;
        }

        if (currentRoomId && currentRoomId !== roomId) {
          leaveRoom(ws, currentRoomId, clientId);
        }

        currentRoomId = roomId;
        let isClientHost = false;

        if (!rooms[roomId] || Object.keys(rooms[roomId].clients).length === 0) {
          rooms[roomId] = {
            hostId: clientId,
            clients: {},
          };
          isClientHost = true;
          console.log(
            `[WS] Room '${roomId}' created. Client ${clientId} is the new host.`
          );
        } else {
          isClientHost = rooms[roomId].hostId === clientId;
        }

        rooms[roomId].clients[clientId] = { ws, joinedAt: Date.now() };
        console.log(
          `[WS] Client ${clientId} joined room '${roomId}'. Total clients in room: ${
            Object.keys(rooms[roomId].clients).length
          }`
        );

        Object.keys(rooms[roomId].clients).forEach((otherClientId) => {
          const otherWs = rooms[roomId].clients[otherClientId].ws;
          if (otherWs.readyState === WebSocket.OPEN) {
            otherWs.send(
              JSON.stringify({
                type: "participant_joined",
                clientId: clientId,
                roomSize: Object.keys(rooms[roomId].clients).length,
                isHost: rooms[roomId].hostId === otherClientId,
              })
            );
          }
        });

        const existingParticipants = Object.keys(rooms[roomId].clients)
          .filter((id) => id !== clientId)
          .map((id) => ({
            clientId: id,
            isHost: rooms[roomId].hostId === id,
          }));

        if (existingParticipants.length > 0) {
          ws.send(
            JSON.stringify({
              type: "existing_participants",
              participants: existingParticipants,
            })
          );
        }
        break;

      case "leave":
        if (currentRoomId) {
          leaveRoom(ws, currentRoomId, clientId);
          currentRoomId = null;
        }
        break;

      // =================================================================
      // == THIS IS THE NEW BLOCK TO HANDLE THE HOST LEAVING ==
      // =================================================================
      case "host_leave":
        const { roomId: hostLeaveRoomId } = parsedMessage;
        if (
          rooms[hostLeaveRoomId] &&
          rooms[hostLeaveRoomId].hostId === clientId
        ) {
          console.log(
            `[WS] Host ${clientId} is leaving room ${hostLeaveRoomId}. Disconnecting all clients.`
          );

          // Notify all other clients that the host has left
          Object.keys(rooms[hostLeaveRoomId].clients).forEach(
            (otherClientId) => {
              if (otherClientId !== clientId) {
                const otherWs =
                  rooms[hostLeaveRoomId].clients[otherClientId].ws;
                if (otherWs.readyState === WebSocket.OPEN) {
                  otherWs.send(JSON.stringify({ type: "host_leave" }));
                  otherWs.close(); // Forcefully close the connection
                }
              }
            }
          );

          // Delete the room
          delete rooms[hostLeaveRoomId];
          console.log(
            `[WS] Room '${hostLeaveRoomId}' has been closed by the host.`
          );
        }
        currentRoomId = null;
        break;
      // =================================================================

      case "offer":
      case "answer":
      case "candidate":
        const { targetClientId, sdp, candidate } = parsedMessage;
        if (!currentRoomId || !rooms[currentRoomId]) {
          return;
        }

        const targetClient = rooms[currentRoomId].clients[targetClientId];
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(
            JSON.stringify({
              type: parsedMessage.type,
              senderClientId: clientId,
              sdp: sdp,
              candidate: candidate,
            })
          );
        }
        break;

      case "start_recording_signal":
      case "stop_recording_signal":
        if (!currentRoomId || !rooms[currentRoomId]) {
          return;
        }
        Object.keys(rooms[currentRoomId].clients).forEach((otherClientId) => {
          if (otherClientId !== clientId) {
            const otherWs = rooms[currentRoomId].clients[otherClientId].ws;
            if (otherWs.readyState === WebSocket.OPEN) {
              otherWs.send(
                JSON.stringify({
                  ...parsedMessage,
                  senderClientId: clientId,
                })
              );
            }
          }
        });
        break;

      default:
        console.warn(
          `[WS] Unknown message type from ${clientId}: ${parsedMessage.type}`
        );
    }
  });

  ws.on("close", () => {
    console.log(`[WS] Client disconnected: ${clientId}`);
    if (currentRoomId) {
      leaveRoom(ws, currentRoomId, clientId);
    }
  });

  ws.on("error", (error) => {
    console.error(`[WS] WebSocket error for ${clientId}:`, error);
    if (currentRoomId) {
      leaveRoom(ws, currentRoomId, clientId);
    }
  });
});

function leaveRoom(ws, roomId, clientId) {
  if (!rooms[roomId] || !rooms[roomId].clients[clientId]) {
    return;
  }

  delete rooms[roomId].clients[clientId];
  console.log(
    `[WS] Client ${clientId} left room '${roomId}'. Remaining clients: ${
      Object.keys(rooms[roomId].clients).length
    }`
  );

  const remainingClientsInRoom = Object.keys(rooms[roomId].clients);

  if (rooms[roomId].hostId === clientId) {
    if (remainingClientsInRoom.length > 0) {
      const newHostId = remainingClientsInRoom.sort((a, b) => {
        return (
          rooms[roomId].clients[a].joinedAt - rooms[roomId].clients[b].joinedAt
        );
      })[0];
      rooms[roomId].hostId = newHostId;
      console.log(`[WS] New host for room '${roomId}' is: ${newHostId}`);

      const newHostWs = rooms[roomId].clients[newHostId].ws;
      if (newHostWs.readyState === WebSocket.OPEN) {
        newHostWs.send(
          JSON.stringify({
            type: "host_status_update",
            isHost: true,
          })
        );
      }
    } else {
      delete rooms[roomId];
      console.log(`[WS] Room '${roomId}' is now empty and deleted.`);
    }
  }

  remainingClientsInRoom.forEach((otherClientId) => {
    const otherWs = rooms[roomId].clients[otherClientId].ws;
    if (otherWs.readyState === WebSocket.OPEN) {
      otherWs.send(
        JSON.stringify({
          type: "participant_left",
          clientId: clientId,
          roomSize: remainingClientsInRoom.length,
          isHost: rooms[roomId].hostId === otherClientId,
        })
      );
    }
  });
}

server.listen(SIGNALING_PORT, () => {
  console.log(
    `WebRTC Signaling server listening on ws://localhost:${SIGNALING_PORT}`
  );
});
