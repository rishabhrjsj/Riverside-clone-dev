import React, { useState, useEffect, useRef, useCallback } from "react";
import "./VideoConference.css";
import { useUser } from "../../Context/UserContext";
import { useParams, useNavigate } from "react-router-dom";

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
  const { roomname } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useUser();

  // UI State
  const [messages, setMessages] = useState("Initializing...");
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
  const peerConnections = useRef({});
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
  const stopRecordingPromiseResolve = useRef(null);

  // Video Refs
  const localVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const remoteVideosContainerRef = useRef(null);
  const hostSectionRef = useRef(null);

  // Button States
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isConferenceRecordingActive, setIsConferenceRecordingActive] =
    useState(false);
  const [isMergeReady, setIsMergeReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Synchronization State
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);

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

  const startLocalCamera = useCallback(async () => {
    displayMessage("Requesting local camera access...");
    if (!localVideoRef.current) {
      displayError(
        new Error("Local video element not ready. Cannot start camera.")
      );
      return false;
    }

    try {
      if (hostSectionRef.current && localClientId.current) {
        const label = hostSectionRef.current.querySelector("h3");
        if (label) {
          label.innerText = `ID: ${localClientId.current.substring(
            localClientId.current.lastIndexOf(":") + 1
          )}`;
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
      setIsCameraReady(true);
      updateButtonStates();
      return true;
    } catch (error) {
      displayError(
        new Error(`Error accessing local media devices: ${error.message}`)
      );
      setIsCameraReady(false);
      updateButtonStates();
      return false;
    }
  }, [displayMessage, displayError, updateButtonStates]);

  const stopLocalCamera = useCallback(() => {
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      localStream.current = null;
      displayMessage("Local camera and microphone stopped.");
    }
    setIsCameraReady(false);
    updateButtonStates();
  }, [displayMessage, updateButtonStates]);

  const createPeerConnection = useCallback((remoteClientId) => {
    const pc = new RTCPeerConnection(rtcConfig);

    if (localStream.current) {
      localStream.current
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStream.current));
    }

    pc.ontrack = (event) => {
      let remoteVideoElement = document.getElementById(
        `remoteVideo-${remoteClientId}`
      );
      if (remoteVideoElement) {
        if (remoteVideoElement.srcObject !== event.streams[0]) {
          remoteVideoElement.srcObject = event.streams[0];
        }
      } else {
        const wrapper = document.createElement("div");
        wrapper.className = "video-container";
        wrapper.id = `wrapper-${remoteClientId}`;

        const video = document.createElement("video");
        video.id = `remoteVideo-${remoteClientId}`;
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = event.streams[0];
        const label = document.createElement("h3");
        label.textContent = `Guest ${remoteClientId.substring(
          remoteClientId.lastIndexOf(":") + 1
        )}`;
        label.style.color = "#e0e0e0";
        label.style.marginBottom = "5px";

        wrapper.appendChild(video);
        wrapper.appendChild(label);
        remoteVideosContainerRef.current.appendChild(wrapper);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
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
  }, []);

  const sendOffer = useCallback(async (remoteClientId) => {
    const pc = peerConnections.current[remoteClientId];
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.current.send(
        JSON.stringify({
          type: "offer",
          sdp: pc.localDescription,
          targetClientId: remoteClientId,
        })
      );
    } catch (error) {
      console.error(`Error sending offer to ${remoteClientId}:`, error);
    }
  }, []);

  const handleOffer = useCallback(
    async (offer, senderClientId) => {
      let pc = peerConnections.current[senderClientId];
      if (!pc) {
        pc = createPeerConnection(senderClientId);
        peerConnections.current[senderClientId] = pc;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
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
    const pc = peerConnections.current[senderClientId];
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error(`Error handling answer from ${senderClientId}:`, error);
    }
  }, []);

  const handleCandidate = useCallback(async (candidate, senderClientId) => {
    const pc = peerConnections.current[senderClientId];
    if (!pc) return;
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
    }
  }, []);

  const closePeerConnection = useCallback((clientId) => {
    if (peerConnections.current[clientId]) {
      peerConnections.current[clientId].close();
      delete peerConnections.current[clientId];
    }
  }, []);

  const uploadVideoChunk = useCallback(
    async (chunkBlob, chunkIndex, roomId, recordingId, userId) => {
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
        displayError(
          new Error(
            `Failed to upload chunk ${chunkIndex}. Check console for details.`
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
      formData.append("recordingStartTime", startTime);
      formData.append("recordingEndTime", endTime);

      try {
        if (isHost.current && user && user.id) {
          await fetch(`${BACKEND_API_URL}/api/users/setroom/${user.id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ roomId }),
          });
        }

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
        displayMessage(
          `Recording ended for ${userId}. Signaled backend for processing.`
        );
      } catch (error) {
        displayError(
          `Failed to send end of recording signal for ${userId}. Video may not finalize correctly.`
        );
      }
    },
    [displayMessage, displayError, user]
  );

  const startLocalRecording = useCallback(
    async (sharedConferenceRecordingId = null) => {
      if (!currentRoomId.current || !localStream.current) {
        displayError("Cannot record without being in a room with camera on.");
        return;
      }
      if (mediaRecorder.current?.state === "recording") return;

      if (sharedConferenceRecordingId) {
        conferenceRecordingId.current = sharedConferenceRecordingId;
      } else {
        conferenceRecordingId.current = generateUUID();
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify({
              type: "start_recording_signal",
              roomId: currentRoomId.current,
              conferenceRecordingId: conferenceRecordingId.current,
            })
          );
        }
      }

      chunkSequence.current = 0;
      pendingChunkUploadPromises.current = [];
      const options = { mimeType: "video/webm" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        displayError(`MIME type ${options.mimeType} is not supported.`);
        return;
      }

      mediaRecorder.current = new MediaRecorder(localStream.current, options);
      mediaRecorder.current.onstart = () => {
        recordingStartTime.current = Date.now();
        updateButtonStates();
      };

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          pendingChunkUploadPromises.current.push(
            uploadVideoChunk(
              event.data,
              chunkSequence.current++,
              currentRoomId.current,
              conferenceRecordingId.current,
              recordingUserId.current
            )
          );
        }
      };
      mediaRecorder.current.onstop = async () => {
        recordingEndTime.current = Date.now();
        displayMessage("Local recording stopped. Finalizing chunks...");
        try {
          await Promise.all(pendingChunkUploadPromises.current);
          await sendEndOfRecordingSignal(
            currentRoomId.current,
            conferenceRecordingId.current,
            recordingUserId.current,
            recordingStartTime.current,
            recordingEndTime.current
          );
          if (stopRecordingPromiseResolve.current) {
            stopRecordingPromiseResolve.current();
            stopRecordingPromiseResolve.current = null;
          }
        } catch (error) {
          displayError(`Failed to finalize local recording: ${error.message}`);
        } finally {
          pendingChunkUploadPromises.current = [];
          updateButtonStates();
        }
      };

      mediaRecorder.current.start(10000); // 10-second chunks
      displayMessage("Conference recording started!");
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
    if (mediaRecorder.current?.state === "recording") {
      displayMessage("Stopping conference recording...");
      mediaRecorder.current.stop();
      if (isHost.current && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: "stop_recording_signal",
            roomId: currentRoomId.current,
            conferenceRecordingId: conferenceRecordingId.current,
          })
        );
      }
      return new Promise((resolve) => {
        stopRecordingPromiseResolve.current = resolve;
      });
    }
    return Promise.resolve();
  }, [displayMessage]);

  const fetchAndPlayLastMergedVideo = useCallback(async () => {
    displayMessage("Fetching last merged video...");
    try {
      const response = await fetch(`${BACKEND_API_URL}/send-blob`);
      if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(
          `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
        );
      }
      const videoBlob = await response.blob();
      const videoUrl = URL.createObjectURL(videoBlob);
      if (previewVideoRef.current) {
        previewVideoRef.current.src = videoUrl;
        previewVideoRef.current.load();
        previewVideoRef.current.play();
      }
      setDownloadLink({
        href: videoUrl,
        display: "block",
        filename: `merged-conference-${Date.now()}.webm`,
      });
      displayMessage("Merged video fetched and loaded for preview.");
    } catch (error) {
      displayError(`Failed to fetch or play merged video: ${error.message}`);
      if (previewVideoRef.current) previewVideoRef.current.src = "";
      setDownloadLink({ href: "#", display: "none", filename: "" });
    }
  }, [displayMessage, displayError]);

  const triggerConferenceMerge = useCallback(async () => {
    if (!currentRoomId.current || !conferenceRecordingId.current) {
      displayError(new Error("No active recording session to merge."));
      return;
    }
    if (!isHost.current) {
      displayError(new Error("Only the host can trigger the merge."));
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_API_URL}/conference-status/${currentRoomId.current}/${conferenceRecordingId.current}`
      );
      const status = await response.json();
      if (!status.readyForMerge) {
        displayError(new Error("Not all tracks are ready for merge."));
        return;
      }
    } catch (error) {
      displayError(
        new Error(`Could not verify conference readiness: ${error.message}.`)
      );
      return;
    }

    displayMessage("Triggering conference merge... This might take a while!");
    setIsMergeReady(false);

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
      displayMessage(`Conference merge job queued: ${result.message}`);
    } catch (error) {
      displayError(`Failed to trigger conference merge: ${error.message}`);
      setIsMergeReady(true);
    }
  }, [displayMessage, displayError]);

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
              text: `Waiting for recording to register...`,
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
          text: `Tracks Status (Session: ${conferenceRecordingId.current.substring(
            0,
            8
          )}): ${status.readyTracks}/${status.totalTracks} Ready`,
          isHeader: true,
        });
        status.tracks.forEach((track) => {
          newStatusList.push({
            id: track.userId,
            text: `User ${track.userId.substring(12, 20)}: ${
              track.isReady ? "Ready" : "Processing..."
            }`,
            className: track.isReady ? "status-ready" : "status-pending",
          });
        });
      } else {
        newStatusList.push({
          id: "no-tracks",
          text: "No recording tracks initiated yet.",
          className: "",
        });
      }
      setStatusList(newStatusList);

      setIsMergeReady(status.readyForMerge && isHost.current);
      if (status.readyForMerge && isHost.current) {
        clearInterval(conferenceStatusPollingInterval.current);
        conferenceStatusPollingInterval.current = null;
        triggerConferenceMerge();
      }
    } catch (error) {
      displayError(`Failed to fetch conference status: ${error.message}`);
      setIsMergeReady(false);
      if (!error.message.includes("404")) {
        clearInterval(conferenceStatusPollingInterval.current);
        conferenceStatusPollingInterval.current = null;
      }
    }
  }, [displayError, displayMessage, triggerConferenceMerge]);

  const joinRoom = useCallback(() => {
    if (!roomname) {
      displayError(new Error("Room ID is missing."));
      return;
    }
    if (!localStream.current) {
      displayError(new Error("Camera not started."));
      return;
    }
    if (ws.current?.readyState === WebSocket.OPEN) {
      currentRoomId.current = roomname;
      ws.current.send(JSON.stringify({ type: "join", roomId: roomname }));
      setCurrentRoomDisplay(`Joined Room: ${roomname}`);
      updateButtonStates();

      if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
      }
      conferenceStatusPollingInterval.current = setInterval(
        pollConferenceStatus,
        3000
      );
    } else {
      displayError(new Error("WebSocket not connected."));
    }
  }, [roomname, displayError, updateButtonStates, pollConferenceStatus]);

  const leaveRoom = useCallback(async () => {
    if (ws.current?.readyState === WebSocket.OPEN && currentRoomId.current) {
      if (isHost.current && !isRecordingActive) {
        ws.current.send(
          JSON.stringify({ type: "host_leave", roomId: currentRoomId.current })
        );
      } else {
        ws.current.send(
          JSON.stringify({ type: "leave", roomId: currentRoomId.current })
        );
      }
      displayMessage("Leaving room...");
      navigate(`/meetingended/${roomname}`);
    }
  }, [isRecordingActive, navigate]);

  useEffect(() => {
    let isMounted = true;

    const connectWebSocket = () => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        setIsWebSocketConnected(true);
        return;
      }

      ws.current = new WebSocket(SIGNALING_SERVER_URL);

      ws.current.onopen = async () => {
        if (!isMounted) return;
        displayMessage("Connected to signaling server.");
        setIsWebSocketConnected(true);
        const cameraStarted = await startLocalCamera();
        if (cameraStarted && isMounted) {
          joinRoom();
        }
      };

      ws.current.onmessage = async (event) => {
        if (!isMounted) return;
        const message = JSON.parse(event.data);
        switch (message.type) {
          case "participant_joined":
            if (!localClientId.current) {
              localClientId.current = message.clientId;
              recordingUserId.current =
                "webrtc-user-" +
                message.clientId.substring(
                  message.clientId.lastIndexOf(":") + 1
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
              `Your ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            );
            setRoomSizeDisplay(`Participants: ${message.roomSize}`);
            if (message.clientId !== localClientId.current) {
              const pc = createPeerConnection(message.clientId);
              peerConnections.current[message.clientId] = pc;
              await sendOffer(message.clientId);
            }
            updateButtonStates();
            break;
          case "existing_participants":
            message.participants.forEach((p) => {
              const pc = createPeerConnection(p.clientId);
              peerConnections.current[p.clientId] = pc;
              if (p.isHost) {
                hostUserId.current =
                  "webrtc-user-" +
                  p.clientId.substring(p.clientId.lastIndexOf(":") + 1);
              }
            });
            updateButtonStates();
            break;
          case "participant_left":
            setRoomSizeDisplay(`Participants: ${message.roomSize}`);
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
          case "host_leave":
            displayMessage("The host has ended the meeting.");
            ws.current.close();
            navigate("/");
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
              `Your ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            );
            updateButtonStates();
            break;
          case "start_recording_signal":
            if (!isHost.current) {
              startLocalRecording(message.conferenceRecordingId);
            }
            break;
          case "stop_recording_signal":
            if (!isHost.current) {
              stopLocalRecording();
            }
            break;
          default:
            console.warn("Unknown message type:", message.type);
        }
      };

      ws.current.onclose = () => {
        if (!isMounted) return;
        displayMessage("Disconnected from signaling server.");
        setIsWebSocketConnected(false);
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
        }
        updateButtonStates();
        if (conferenceStatusPollingInterval.current) {
          clearInterval(conferenceStatusPollingInterval.current);
          conferenceStatusPollingInterval.current = null;
        }
        setStatusList([]);
      };

      ws.current.onerror = (error) => {
        if (!isMounted) return;
        displayError(new Error("WebSocket error."));
        setIsWebSocketConnected(false);
      };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (ws.current) {
        ws.current.close();
      }
      if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current);
      }
      stopLocalCamera();
    };
  }, [
    roomname,
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
    startLocalCamera,
    joinRoom,
    navigate,
  ]);

  const handleToggleRecording = () => {
    if (!isHost.current) {
      displayError(new Error("Only the host can record."));
      return;
    }
    if (!isInRoom || !isLocalCameraOn) {
      displayError(new Error("Must be in a room with camera on to record."));
      return;
    }
    if (Object.keys(peerConnections.current).length === 0) {
      displayError(new Error("Wait for a guest to join before recording."));
      return;
    }

    if (isRecordingActive) {
      stopLocalRecording();
    } else {
      startLocalRecording();
    }
  };

  return (
    <div className="container">
      <div className="main-content">
        <div className="video-section host-video-section" ref={hostSectionRef}>
          <h3></h3>
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
            ref={remoteVideosContainerRef}></div>
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
            onClick={() => setIsMuted(!isMuted)}>
            {isMuted ? "UNMUTE" : "MUTE"}
          </button>
          <button className="control-button" disabled>
            SPEAKER
          </button>
          <button
            className="control-button btn-red"
            onClick={leaveRoom}
            disabled={!isInRoom || isRecordingActive}>
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

      <h2 style={{ marginTop: "20px" }}>Conference Recording Status</h2>
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
          display: downloadLink.display,
        }}></video>
      <a
        id="downloadLink"
        className="download-link"
        style={{ display: downloadLink.display }}
        href={downloadLink.href}
        download={downloadLink.filename}>
        Download Merged Video
      </a>
    </div>
  );
}

export default VideoConference;
