import React, { useState, useEffect, useRef, useCallback } from "react";
import "./VideoConference.css"; // You'll create this CSS file with the provided styles

const SIGNALING_SERVER_URL = "ws://localhost:8080";
const BACKEND_API_URL = "http://localhost:3000";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function generateUUID() {
  return crypto.randomUUID();
}

function VideoConference() {
  // UI State
  const [roomId, setRoomId] = useState("my-test-room");
  const [messages, setMessages] = useState(
    'Enter a Room ID and click "Join Room".'
  );
  const [errors, setErrors] = useState("");
  const [currentRoomDisplay, setCurrentRoomDisplay] = useState("");
  const [localClientIdDisplay, setLocalClientIdDisplay] = useState("");
  const [roomSizeDisplay, setRoomSizeDisplay] = useState("");
  const [statusList, setStatusList] = useState([]);
  const [downloadLink, setDownloadLink] = useState({
    href: "#",
    display: "none",
    filename: "",
  });

  // WebRTC State
  const ws = useRef(null);
  const localStream = useRef(null);
  const peerConnections = useRef({}); // { remoteClientId: RTCPeerConnection }
  const currentRoomId = useRef(null);
  const localClientId = useRef(null);
  const isHost = useRef(false);
  const hostUserId = useRef(null);

  // Recording State
  const mediaRecorder = useRef(null);
  const chunkSequence = useRef(0);
  const pendingChunkUploadPromises = useRef([]);
  const recordingStartTime = useRef(null);
  const recordingEndTime = useRef(null);
  const recordingUserId = useRef(
    "webrtc-user-" + generateUUID().substring(0, 8)
  );
  const conferenceRecordingId = useRef(null);
  const conferenceStatusPollingInterval = useRef(null);

  // Video Refs
  const localVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const remoteVideosContainerRef = useRef(null);
  const hostSectionRef = useRef(null);

  // Button States (derived from other states, could also be separate useState)
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isConferenceRecordingActive, setIsConferenceRecordingActive] =
    useState(false);
  const [isMergeReady, setIsMergeReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // New state for mute button

  const displayMessage = useCallback((msg) => {
    setMessages(msg);
    setErrors("");
  }, []);

  const displayError = useCallback((err) => {
    const errorName = err.name || "UnknownError";
    const errorMessage = err.message || "An unknown error occurred.";
    setErrors(`Error: ${errorName} - ${errorMessage}`);
    setMessages("");
    console.error("Detailed error:", err);
  }, []);

  const updateButtonStates = useCallback(() => {
    setIsInRoom(currentRoomId.current !== null);
    setIsLocalCameraOn(localStream.current !== null);
    setIsRecordingActive(
      mediaRecorder.current && mediaRecorder.current.state === "recording"
    );
    setIsConferenceRecordingActive(conferenceRecordingId.current !== null);
  }, []);

  // --- WebRTC Core Logic ---

  const startLocalCamera = useCallback(async () => {
    displayMessage("Requesting local camera access...");
    console.log(localClientId);
    try {
      // ✅ Set the innerText of the existing <h3>
      if (hostSectionRef.current) {
        const label = hostSectionRef.current.querySelector("h3");
        if (label) {
          label.innerText = `ID: ${localClientId.current}`;
          label.style.color = "#80c0ff";
          label.style.marginBottom = "6px";
        }
      }

      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localVideoRef.current.srcObject = localStream.current;
      displayMessage("Local camera and microphone access granted.");
      updateButtonStates();
    } catch (error) {
      displayError(
        new Error(`Error accessing local media devices: ${error.message}`)
      );
      updateButtonStates();
    }
  }, [displayMessage, displayError, updateButtonStates]);

  const stopLocalCamera = useCallback(() => {
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
      localStream.current = null;
      displayMessage("Local camera and microphone stopped.");
    }
    updateButtonStates();
  }, [displayMessage, updateButtonStates]);

  const createPeerConnection = useCallback((remoteClientId) => {
    console.log(`Creating RTCPeerConnection for ${remoteClientId}`);
    const pc = new RTCPeerConnection(rtcConfig);

    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStream.current);
      });
    }

    pc.ontrack = (event) => {
      console.log(`Received remote track from ${remoteClientId}`);
      let remoteVideoElement = document.getElementById(
        `remoteVideo-${remoteClientId}`
      );
      if (remoteVideoElement) {
        if (remoteVideoElement.srcObject !== event.streams[0]) {
          remoteVideoElement.srcObject = event.streams[0];
        }
      } else {
        if (remoteVideoElement) {
          if (remoteVideoElement.srcObject !== event.streams[0]) {
            remoteVideoElement.srcObject = event.streams[0];
          }
        } else {
          const wrapper = document.createElement("div");
          wrapper.className = "video-container"; // Use same class as host
          wrapper.id = `wrapper-${remoteClientId}`;

          const video = document.createElement("video");
          video.id = `remoteVideo-${remoteClientId}`;
          video.autoplay = true;
          video.playsInline = true;
          video.srcObject = event.streams[0];
          const label = document.createElement("h3");
          label.textContent = `Guest ${remoteClientId}`;
          label.style.color = "#e0e0e0";
          label.style.marginBottom = "5px";
          remoteVideosContainerRef.current.appendChild(label);

          wrapper.appendChild(video);
          remoteVideosContainerRef.current.appendChild(wrapper);
        }
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Sending ICE candidate to ${remoteClientId}`);
        ws.current.send(
          JSON.stringify({
            type: "candidate",
            candidate: event.candidate,
            targetClientId: remoteClientId,
          })
        );
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(
        `ICE connection state with ${remoteClientId}: ${pc.iceConnectionState}`
      );
    };

    return pc;
  }, []); // Dependencies for createPeerConnection

  const sendOffer = useCallback(async (remoteClientId) => {
    const pc = peerConnections.current[remoteClientId];
    if (!pc) {
      console.error(`No PeerConnection for ${remoteClientId} to send offer.`);
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(`Sending SDP offer to ${remoteClientId}`);
      ws.current.send(
        JSON.stringify({
          type: "offer",
          sdp: pc.localDescription,
          targetClientId: remoteClientId,
        })
      );
    } catch (error) {
      console.error(
        `Error creating or sending offer to ${remoteClientId}:`,
        error
      );
    }
  }, []);

  const handleOffer = useCallback(
    async (offer, senderClientId) => {
      console.log(`Received SDP offer from ${senderClientId}`);
      let pc = peerConnections.current[senderClientId];
      if (!pc) {
        pc = createPeerConnection(senderClientId);
        peerConnections.current[senderClientId] = pc;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`Sending SDP answer to ${senderClientId}`);
        ws.current.send(
          JSON.stringify({
            type: "answer",
            sdp: pc.localDescription,
            targetClientId: senderClientId,
          })
        );
      } catch (error) {
        console.error(`Error handling offer from ${senderClientId}:`, error);
      }
    },
    [createPeerConnection]
  );

  const handleAnswer = useCallback(async (answer, senderClientId) => {
    console.log(`Received SDP answer from ${senderClientId}`);
    const pc = peerConnections.current[senderClientId];
    if (!pc) {
      console.error(
        `No PeerConnection for ${senderClientId} to handle answer.`
      );
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error(`Error handling answer from ${senderClientId}:`, error);
    }
  }, []);

  const handleCandidate = useCallback(async (candidate, senderClientId) => {
    console.log(`Received ICE candidate from ${senderClientId}`);
    const pc = peerConnections.current[senderClientId];
    if (!pc) {
      console.error(
        `No PeerConnection for ${senderClientId} to add candidate.`
      );
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(
        `Error adding ICE candidate from ${senderClientId}:`,
        error
      );
    }
  }, []);

  const removeRemoteVideo = useCallback((clientId) => {
    const wrapper = document.getElementById(`wrapper-${clientId}`);
    if (wrapper) {
      wrapper.remove();
      console.log(`Removed remote video for ${clientId}`);
    }
  }, []);

  const closePeerConnection = useCallback((clientId) => {
    if (peerConnections.current[clientId]) {
      console.log(`Closing PeerConnection for ${clientId}`);
      peerConnections.current[clientId].close();
      delete peerConnections.current[clientId];
    }
  }, []);

  // --- Conference Recording Functionality ---

  const uploadVideoChunk = useCallback(
    async (
      chunkBlob,
      chunkIndex,
      roomId,
      recordingId, // conferenceRecordingId
      userId // individual participant's userId
    ) => {
      const formData = new FormData();
      formData.append("roomId", roomId);
      formData.append("recordingId", recordingId);
      formData.append("chunkIndex", chunkIndex);
      formData.append(
        "videoChunk",
        chunkBlob,
        `chunk-${userId}-${chunkIndex}.webm`
      );
      formData.append("userId", userId);
      formData.append("timestamp", Date.now());
      try {
        const response = await fetch(`${BACKEND_API_URL}/upload-chunk`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const errorDetails = await response.text();
          throw new Error(
            `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
          );
        }
        const result = await response.json();
        displayMessage(
          `Chunk ${chunkIndex} uploaded (${result.message || "success"}).`
        );
        return true;
      } catch (error) {
        console.error(
          `Error uploading chunk ${chunkIndex} for recording ${recordingId} (User: ${userId}):`,
          error
        );
        displayError(
          new Error(
            `Failed to upload chunk ${chunkIndex}. Check console for details. `
          )
        );
        return false;
      }
    },
    [displayMessage, displayError]
  );

  const sendEndOfRecordingSignal = useCallback(
    async (roomId, recordingId, userId, startTime, endTime) => {
      const formData = new FormData();
      formData.append("roomId", roomId);
      formData.append("recordingId", recordingId);
      formData.append("userId", userId);
      formData.append("isLastChunk", "true");
      formData.append("recordingStartTime", startTime); // Optional if unused
      formData.append("recordingEndTime", endTime); // Optional if unused

      try {
        const response = await fetch(`${BACKEND_API_URL}/upload-chunk`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const errorDetails = await response.text();
          throw new Error(
            `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
          );
        }
        console.log(
          `End of recording signal sent successfully for recording ID: ${recordingId} (User: ${userId}).`
        );
        displayMessage(
          `Recording ended for ${userId}. Signaled backend for processing.`
        );
      } catch (error) {
        console.error(
          `Error sending end of recording signal for recording ID: ${recordingId} (User: ${userId}):`,
          error
        );
        displayError(
          `Failed to send end of recording signal for ${userId}. Video may not finalize correctly.`
        );
      }
    },
    [displayMessage, displayError]
  );

  const startLocalRecording = useCallback(
    async (sharedConferenceRecordingId = null) => {
      if (!currentRoomId.current) {
        displayError("Not in a WebRTC room.");
        return;
      }
      if (!localStream.current) {
        displayError("Local camera not started.");
        return;
      }
      if (
        mediaRecorder.current &&
        mediaRecorder.current.state === "recording"
      ) {
        console.log("Local MediaRecorder already active.");
        return;
      }

      if (sharedConferenceRecordingId) {
        conferenceRecordingId.current = sharedConferenceRecordingId;
        console.log(
          `Guest ${recordingUserId.current}: Setting conferenceRecordingId from host signal: ${conferenceRecordingId.current}`
        );
      } else {
        // Only host generates a new ID
        conferenceRecordingId.current = generateUUID();
        console.log(
          `Host ${recordingUserId.current}: Generating new conferenceRecordingId: ${conferenceRecordingId.current}`
        );
        // Host also sends signal to others
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify({
              type: "start_recording_signal",
              roomId: currentRoomId.current,
              conferenceRecordingId: conferenceRecordingId.current,
            })
          );
          console.log(
            `Host ${recordingUserId.current}: Sending start_recording_signal for conference ID: ${conferenceRecordingId.current}`
          );
        }
      }

      chunkSequence.current = 0;
      pendingChunkUploadPromises.current = [];
      const options = { mimeType: "video/webm" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        displayError(
          `MIME type ${options.mimeType} is not supported by your browser for recording.`
        );
        return;
      }

      mediaRecorder.current = new MediaRecorder(localStream.current, options);
      mediaRecorder.current.onstart = () => {
        recordingStartTime.current = Date.now();
        console.log(
          `Local recorder started at ${recordingStartTime.current} for conference recording ID: ${conferenceRecordingId.current} (User: ${recordingUserId.current}).`
        );
        updateButtonStates();
      };

      mediaRecorder.current.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          pendingChunkUploadPromises.current.push(
            uploadVideoChunk(
              event.data,
              chunkSequence.current,
              currentRoomId.current,
              conferenceRecordingId.current,
              recordingUserId.current
            )
          );
          chunkSequence.current++;
        }
      };
      mediaRecorder.current.onstop = async () => {
        console.log(
          `MediaRecorder.onstop fired for user: ${recordingUserId.current}. State: ${mediaRecorder.current?.state}`
        );
        recordingEndTime.current = Date.now();
        displayMessage(
          `Local recording stopped. Finalizing chunks for ${recordingUserId.current}...`
        );
        try {
          await Promise.all(pendingChunkUploadPromises.current);
          console.log(
            `All local chunks uploaded for conference recording ID: ${conferenceRecordingId.current} (User: ${recordingUserId.current}).`
          );
          await sendEndOfRecordingSignal(
            currentRoomId.current,
            conferenceRecordingId.current,
            recordingUserId.current,
            recordingStartTime.current,
            recordingEndTime.current
          );
        } catch (error) {
          console.error(
            `Error during local recording finalization for conference recording ID: ${conferenceRecordingId.current} (User: ${recordingUserId.current}):`,
            error
          );
          displayError(`Failed to finalize local recording: ${error.message}`);
        } finally {
          pendingChunkUploadPromises.current = [];
          updateButtonStates();
        }
      };

      mediaRecorder.current.start(10000); // 10-second timeslice
      displayMessage(
        "Conference recording started! Your chunks are being sent."
      );
      updateButtonStates();
    },
    [
      displayError,
      displayMessage,
      updateButtonStates,
      uploadVideoChunk,
      sendEndOfRecordingSignal,
    ]
  );

  const stopLocalRecording = useCallback(() => {
    console.log(
      `stopLocalRecording called for user: ${recordingUserId.current}. Current mediaRecorder state: ${mediaRecorder.current?.state}`
    );
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      displayMessage("Stopping conference recording...");
      mediaRecorder.current.stop();
      console.log(
        `mediaRecorder.stop() called for user: ${recordingUserId.current}`
      );
      if (
        isHost.current &&
        ws.current &&
        ws.current.readyState === WebSocket.OPEN
      ) {
        ws.current.send(
          JSON.stringify({
            type: "stop_recording_signal",
            roomId: currentRoomId.current,
            conferenceRecordingId: conferenceRecordingId.current,
          })
        );
        console.log(
          `Host ${recordingUserId.current}: Sending stop_recording_signal for conference ID: ${conferenceRecordingId.current}`
        );
      }
    } else {
      console.log(
        `No active recording to stop locally for user: ${recordingUserId.current}, or mediaRecorder is not in 'recording' state.
Current state: ${mediaRecorder.current?.state}`
      );
    }
  }, [displayMessage]);

  const pollConferenceStatus = useCallback(async () => {
    if (!currentRoomId.current || !conferenceRecordingId.current) {
      setStatusList([]);
      setIsMergeReady(false);
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_API_URL}/conference-status/${currentRoomId.current}/${conferenceRecordingId.current}`
      );
      if (!response.ok) {
        if (response.status === 404) {
          setStatusList([
            {
              id: "waiting",
              text: `Waiting for conference recording to register in room '${currentRoomId.current}'...`,
              className: "",
            },
          ]);
          setIsMergeReady(false);
          return;
        }
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const status = await response.json();

      const newStatusList = [];
      if (status.totalTracks > 0) {
        newStatusList.push({
          id: "header",
          text: `Recorded Tracks Status for Room '${
            currentRoomId.current
          }' (Session: ${conferenceRecordingId.current.substring(0, 8)}): ${
            status.totalTracks
          }, Ready: ${status.readyTracks}`,
          isHeader: true,
        });
        status.tracks.forEach((track) => {
          newStatusList.push({
            id: track.userId,
            text: `User ${track.userId} (Track: ${track.recordingId.substring(
              0,
              8
            )}...): `,
            statusText: track.isReady ? "Ready" : "Processing...",
            className: track.isReady ? "status-ready" : "status-pending",
          });
        });
      } else {
        newStatusList.push({
          id: "no-tracks",
          text: `No recording tracks initiated yet for room '${currentRoomId.current}'.`,
          className: "",
        });
      }
      setStatusList(newStatusList);

      setIsMergeReady(status.readyForMerge && isHost.current);

      if (status.readyForMerge && conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
        triggerConferenceMerge();
        conferenceStatusPollingInterval.current = null;

        displayMessage("All recordings processed individually. ");
      }
    } catch (error) {
      console.error("Error polling conference status:", error);
      displayError(
        `Failed to fetch conference status for room '${currentRoomId.current}': ${error.message}`
      );
      setIsMergeReady(false);
      if (error.message.includes("404")) {
        // Expected 404 before recordings start, keep polling
      } else if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
        conferenceStatusPollingInterval.current = null;
      }
    }
  }, [displayError, displayMessage]);

  const joinRoom = useCallback(() => {
    const room = roomId.trim();
    if (!room) {
      displayError(new Error("Please enter a Room ID."));
      return;
    }
    if (!localStream.current) {
      displayError(
        new Error("Please start your local camera first to join a room.")
      );
      return;
    }
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      currentRoomId.current = room;
      ws.current.send(
        JSON.stringify({ type: "join", roomId: currentRoomId.current })
      );
      setCurrentRoomDisplay(`Joined Room: ${currentRoomId.current}`);
      displayMessage(`Attempting to join room "${currentRoomId.current}"...`);
      updateButtonStates();
      if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
      }
      conferenceStatusPollingInterval.current = setInterval(
        pollConferenceStatus,
        3000
      );
    } else {
      displayError(
        new Error("WebSocket not connected. Please refresh and try again.")
      );
    }
  }, [
    roomId,
    displayError,
    displayMessage,
    updateButtonStates,
    pollConferenceStatus,
  ]);

  const leaveRoom = useCallback(() => {
    if (
      ws.current &&
      ws.current.readyState === WebSocket.OPEN &&
      currentRoomId.current
    ) {
      ws.current.send(
        JSON.stringify({ type: "leave", roomId: currentRoomId.current })
      );
      displayMessage(`Leaving room "${currentRoomId.current}"...`);
      // The onclose handler in useEffect will clean up local state
    }
  }, [displayMessage]);

  // --- WebSocket Signaling Logic (useEffect for setup and teardown) ---
  useEffect(() => {
    const connectWebSocket = () => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        console.log("WebSocket already connected.");
        return;
      }

      ws.current = new WebSocket(SIGNALING_SERVER_URL);

      ws.current.onopen = () => {
        console.log("WebSocket connected to signaling server.");
        displayMessage("Connected to signaling server.");
      };

      ws.current.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "participant_joined":
            if (!localClientId.current) {
              localClientId.current = message.clientId;
              console.log(localClientId.current);
              recordingUserId.current =
                "webrtc-user-" +
                localClientId.current.substring(
                  localClientId.current.lastIndexOf(":") + 1
                );
            }
            isHost.current = message.isHost;
            if (message.isHost) {
              hostUserId.current =
                "webrtc-user-" +
                message.clientId.substring(
                  message.clientId.lastIndexOf(":") + 1
                );
            }
            setLocalClientIdDisplay(
              `Your Client ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            );
            setRoomSizeDisplay(`Participants in room: ${message.roomSize}`);
            console.log(
              `Participant ${message.clientId} joined. Room size: ${message.roomSize}. Is Host: ${isHost.current}`
            );
            if (message.clientId !== localClientId.current) {
              const pc = createPeerConnection(message.clientId);
              peerConnections.current[message.clientId] = pc;
              await sendOffer(message.clientId);
            }
            updateButtonStates();
            break;
          case "existing_participants":
            message.participants.forEach((existingParticipant) => {
              console.log(
                `Existing participant in room: ${existingParticipant.clientId}`
              );
              const pc = createPeerConnection(existingParticipant.clientId);
              peerConnections.current[existingParticipant.clientId] = pc;
              if (existingParticipant.isHost) {
                hostUserId.current =
                  "webrtc-user-" +
                  existingParticipant.clientId.substring(
                    existingParticipant.clientId.lastIndexOf(":") + 1
                  );
              }
            });
            updateButtonStates();
            break;
          case "participant_left":
            console.log(
              `Participant ${message.clientId} left. Room size: ${message.roomSize}`
            );
            setRoomSizeDisplay(`Participants in room: ${message.roomSize}`);
            closePeerConnection(message.clientId);
            removeRemoteVideo(message.clientId);
            if (
              hostUserId.current &&
              message.clientId ===
                hostUserId.current.replace("webrtc-user-", "")
            ) {
              isHost.current = false;
              hostUserId.current = null;
            }
            updateButtonStates();
            break;
          case "offer":
            await handleOffer(message.sdp, message.senderClientId);
            break;
          case "answer":
            await handleAnswer(message.sdp, message.senderClientId);
            break;
          case "candidate":
            await handleCandidate(message.candidate, message.senderClientId);
            break;
          case "host_status_update":
            isHost.current = message.isHost;
            if (isHost.current) {
              hostUserId.current =
                "webrtc-user-" +
                localClientId.current.substring(
                  localClientId.current.lastIndexOf(":") + 1
                );
            } else {
              hostUserId.current = null;
            }
            setLocalClientIdDisplay(
              `Your Client ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            );
            displayMessage(
              `You are now ${
                isHost.current ? "the Host" : "a regular participant"
              }.`
            );
            updateButtonStates();
            break;
          case "start_recording_signal":
            if (
              !isHost.current &&
              message.senderClientId !== localClientId.current
            ) {
              console.log(
                `Guest ${localClientId.current.substring(
                  localClientId.current.lastIndexOf(":") + 1
                )} received start_recording_signal from host ${
                  message.senderClientId
                }. Conference Recording ID: ${message.conferenceRecordingId}`
              );
              startLocalRecording(message.conferenceRecordingId);
            }
            break;
          case "stop_recording_signal":
            if (
              !isHost.current &&
              message.senderClientId !== localClientId.current
            ) {
              console.log(
                `Guest ${localClientId.current.substring(
                  localClientId.current.lastIndexOf(":") + 1
                )} received stop_recording_signal from host ${
                  message.senderClientId
                }.`
              );
              stopLocalRecording();
            }
            break;
          default:
            console.warn(
              "Unknown message type from signaling server:",
              message.type
            );
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected from signaling server.");
        displayMessage("Disconnected from signaling server.");
        currentRoomId.current = null;
        localClientId.current = null;
        isHost.current = false;
        hostUserId.current = null;
        conferenceRecordingId.current = null;
        setCurrentRoomDisplay("");
        setLocalClientIdDisplay("");
        setRoomSizeDisplay("");
        Object.values(peerConnections.current).forEach((pc) => pc.close());
        peerConnections.current = {};
        if (remoteVideosContainerRef.current) {
          remoteVideosContainerRef.current.innerHTML = "";
          // Clear remote videos
        }
        updateButtonStates();
        if (conferenceStatusPollingInterval.current) {
          clearInterval(conferenceStatusPollingInterval.current);
          conferenceStatusPollingInterval.current = null;
        }
        setStatusList([]);
      };
      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        displayError(new Error("WebSocket error. Check console for details."));
      };
    };

    connectWebSocket();
    // Cleanup function for WebSocket and intervals
    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
      }
      stopLocalCamera(); // Ensure camera is stopped on unmount
    };
  }, [
    displayMessage,
    displayError,
    updateButtonStates,
    createPeerConnection,
    sendOffer,
    handleOffer,
    handleAnswer,
    handleCandidate,
    closePeerConnection,
    removeRemoteVideo,
    startLocalRecording,
    stopLocalRecording,
  ]);

  // Handle Recording Button Clicks
  const handleToggleRecording = () => {
    if (!isHost.current) {
      displayError(
        new Error("Only the host can start/stop conference recording.")
      );
      return;
    }
    if (!isInRoom) {
      displayError(new Error("Please join a room first."));
      return;
    }
    if (!isLocalCameraOn) {
      displayError(new Error("Please start your local camera first."));
      return;
    }

    if (isRecordingActive) {
      stopLocalRecording();
    } else {
      if (Object.keys(peerConnections.current).length === 0) {
        displayError(
          new Error(
            "Please wait for at least one other participant to join the room before starting recording."
          )
        );
        return;
      }
      startLocalRecording();
    }
  };

  const fetchAndPlayLastMergedVideo = async () => {
    displayMessage("Fetching last merged video from backend...");
    try {
      const response = await fetch(`${BACKEND_API_URL}/send-blob`, {
        method: "GET",
      });
      if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(
          `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
        );
      }
      const videoBlob = await response.blob();
      console.log("Received video Blob from backend:", videoBlob);
      const videoUrl = URL.createObjectURL(videoBlob);
      previewVideoRef.current.src = videoUrl;
      previewVideoRef.current.load();
      previewVideoRef.current.play();
      setDownloadLink({
        href: videoUrl,
        display: "block",
        filename: `merged-conference-${Date.now()}.webm`,
      });
      displayMessage(
        "Merged video fetched and loaded for preview. You can also download it."
      );
    } catch (error) {
      console.error("Error fetching/playing merged video from backend:", error);
      displayError(
        `Failed to fetch or play merged video from backend: ${error.message}`
      );
      if (previewVideoRef.current) previewVideoRef.current.src = "";
      setDownloadLink({ href: "#", display: "none", filename: "" });
    }
  };

  const triggerConferenceMerge = async () => {
    if (!currentRoomId.current || !conferenceRecordingId.current) {
      displayError(
        new Error(
          "No active conference recording session to merge. Please start and stop a recording first."
        )
      );
      return;
    }
    if (!isHost.current) {
      displayError(
        new Error("Only the host can trigger the conference merge.")
      );
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_API_URL}/conference-status/${currentRoomId.current}/${conferenceRecordingId.current}`
      );
      const status = await response.json();
      if (!status.readyForMerge) {
        displayError(
          new Error(
            "Not all individual recorded tracks are processed yet. Please wait."
          )
        );
        return;
      }
    } catch (error) {
      displayError(
        new Error(
          `Could not verify recorded conference readiness: ${error.message}. Please try again.`
        )
      );
      return;
    }

    displayMessage(
      `Triggering conference merge for Room ID: ${currentRoomId.current}, Recording Session: ${conferenceRecordingId.current}... This might take a while!`
    );
    setIsMergeReady(false); // Disable button immediately

    try {
      const response = await fetch(
        `${BACKEND_API_URL}/trigger-conference-merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId: currentRoomId.current,
            conferenceRecordingId: conferenceRecordingId.current,
            hostUserId: hostUserId.current,
          }),
        }
      );
      if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(
          `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
        );
      }
      const result = await response.json();
      console.log("Conference merge request sent:", result);
      displayMessage(
        `Conference merge job queued for Room ID: ${currentRoomId.current}. Worker will process it.`
      );
    } catch (error) {
      console.error("Error triggering conference merge:", error);
      displayError(`Failed to trigger conference merge: ${error.message}`);
      setIsMergeReady(true); // Re-enable if error allows retrying
    }
  };

  return (
    <div className="container">
      <div className="main-content">
        <div className="video-section host-video-section" ref={hostSectionRef}>
          <h3></h3> {/* We'll fill this dynamically */}
          <div className="video-container">
            <video
              id="localVideo"
              ref={localVideoRef}
              autoPlay
              playsInline
              muted></video>
          </div>
        </div>

        <div className="video-section guest-video-section">
          <div
            id="remoteVideosContainer"
            className="remote-video-container"
            ref={remoteVideosContainerRef}>
            {/* Remote video elements will be added here dynamically by the createPeerConnection function */}
          </div>
        </div>
      </div>

      <div className="control-panel">
        <div className="controls-row">
          <button
            className={`control-button ${
              isRecordingActive ? "btn-red" : "btn-blue"
            }`}
            onClick={handleToggleRecording}
            disabled={!isHost.current || !isInRoom || !isLocalCameraOn}>
            {isRecordingActive ? "STOP RECORDING" : "START RECORDING"}
          </button>
          <button
            className="control-button"
            onClick={startLocalCamera}
            disabled={isLocalCameraOn}>
            CAM ON
          </button>
          <button
            className="control-button"
            onClick={stopLocalCamera}
            disabled={!isLocalCameraOn}>
            CAM OFF
          </button>
          <button
            className={`control-button ${isMuted ? "btn-red" : "btn-blue"}`}
            onClick={() => setIsMuted(!isMuted)} // Placeholder for mute functionality
          >
            {isMuted ? "UNMUTE" : "MUTE"}
          </button>
          <button className="control-button" disabled>
            {" "}
            {/* Placeholder as no direct functionality */}
            SPEAKER
          </button>
          <button
            className="control-button btn-red"
            onClick={leaveRoom}
            disabled={!isInRoom}>
            LEAVE
          </button>
        </div>
      </div>

      <div className="messages-container">
        <div id="messages">{messages}</div>
        <div id="errors">{errors}</div>
        <div id="current-room-display">{currentRoomDisplay}</div>
        <div id="local-client-id-display">{localClientIdDisplay}</div>
        <div id="room-size-display">{roomSizeDisplay}</div>
      </div>

      {/* Recording Status and Merge Controls */}
      {/* <h2 style={{ marginTop: "20px" }}>
        Conference Recording Status (Host Only)
      </h2>
      <div className="messages-container">
        <ul id="status-list">
          {statusList.map((item, index) => (
            <li key={item.id || index}>
              {item.isHeader ? (
                <strong>{item.text}</strong>
              ) : (
                <>
                  {item.text}
                  <span className={item.className}>{item.statusText}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="post-recording-controls">
        <button
          className="btn-purple"
          onClick={fetchAndPlayLastMergedVideo}
          disabled={isRecordingActive}>
          Fetch & Play Last Merged Video
        </button>
        <button
          className="btn-purple"
          onClick={triggerConferenceMerge}
          disabled={!isMergeReady || !isHost.current}>
          Trigger Conference Merge
        </button>
      </div>
      <video
        id="previewVideo"
        ref={previewVideoRef}
        controls
        style={{
          marginTop: "20px",
          maxWidth: "100%",
          display: downloadLink.display === "block" ? "block" : "none",
        }}></video>
      <a
        id="downloadLink"
        className="download-link"
        style={{ display: downloadLink.display }}
        href={downloadLink.href}
        download={downloadLink.filename}>
        Download Merged Video
      </a>
      {/* Room ID input and Join/Leave moved for better flow */}
      <div className="room-controls">
        <input
          type="text"
          id="roomIdInput"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={isInRoom}
        />
        <button
          className="btn-green"
          onClick={joinRoom}
          disabled={isInRoom || !isLocalCameraOn}>
          Join Room
        </button>
      </div>
    </div>
  );
}

export default VideoConference;
