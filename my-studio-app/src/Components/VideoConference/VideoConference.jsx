import React, { useState, useEffect, useRef, useCallback } from "react";
import "./VideoConference.css";
import { useUser } from "../../Context/UserContext"; /* cite: 108 */
import { useParams, useNavigate } from "react-router-dom"; /* cite: 108 */

// Import desired icons from react-icons
import {
  FaVideo,
  FaVideoSlash,
  FaMicrophone,
  FaMicrophoneSlash,
  FaHeadphones,
  FaStopCircle,
  FaPlayCircle,
  FaSignOutAlt,
} from "react-icons/fa"; // Using Font Awesome icons from react-icons

const SIGNALING_SERVER_URL = "ws://localhost:8080";
const BACKEND_API_URL = "http://localhost:3000"; /* cite: 109 */
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
}; /* cite: 110 */
function generateUUID() {
  return crypto.randomUUID();
}

function VideoConference() {
  const { roomname } = useParams();
  const navigate = useNavigate(); /* cite: 111 */
  const { user, setUser } = useUser(); /* cite: 108 */

  // UI State
  const [messages, setMessages] = useState("Initializing..."); /* cite: 112 */
  const [errors, setErrors] = useState(""); /* cite: 112 */
  const [currentRoomDisplay, setCurrentRoomDisplay] =
    useState(""); /* cite: 113 */
  const [localClientIdDisplay, setLocalClientIdDisplay] =
    useState(""); /* cite: 113 */
  const [roomSizeDisplay, setRoomSizeDisplay] = useState(""); /* cite: 113 */
  const [statusList, setStatusList] = useState([]); /* cite: 113 */
  const [downloadLink, setDownloadLink] = useState({
    href: "#",
    display: "none",
    filename: "",
  }); /* cite: 114 */

  // WebRTC State
  const ws = useRef(null);
  const localStream = useRef(null);
  const peerConnections = useRef({});
  const currentRoomId = useRef(null); /* cite: 115 */
  const localClientId = useRef(null); /* cite: 115 */
  const isHost = useRef(false); /* cite: 115 */
  const hostUserId = useRef(null); /* cite: 115 */

  // Recording State
  const mediaRecorder = useRef(null); /* cite: 116 */
  const chunkSequence = useRef(0); /* cite: 116 */
  const pendingChunkUploadPromises = useRef([]); /* cite: 116 */
  const recordingStartTime = useRef(null); /* cite: 117 */
  const recordingEndTime = useRef(null); /* cite: 117 */
  const recordingUserId = useRef(
    "webrtc-user-" + generateUUID().substring(0, 8)
  ); /* cite: 117 */
  const conferenceRecordingId = useRef(null); /* cite: 118 */
  const conferenceStatusPollingInterval = useRef(null); /* cite: 118 */
  const stopRecordingPromiseResolve = useRef(null); /* cite: 118 */

  // Video Refs
  const localVideoRef = useRef(null);
  const previewVideoRef = useRef(null); /* cite: 119 */
  const remoteVideosContainerRef = useRef(null); /* cite: 119 */
  const hostSectionRef = useRef(null); /* cite: 119 */

  // Button States
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false); /* cite: 120 */
  const [isInRoom, setIsInRoom] = useState(false); /* cite: 120 */
  const [isRecordingActive, setIsRecordingActive] =
    useState(false); /* cite: 121 */
  const [isConferenceRecordingActive, setIsConferenceRecordingActive] =
    useState(false); /* cite: 121 */
  const [isMergeReady, setIsMergeReady] = useState(false); /* cite: 121 */
  const [isMuted, setIsMuted] = useState(false); /* cite: 121 */

  // Synchronization State
  const [isWebSocketConnected, setIsWebSocketConnected] =
    useState(false); /* cite: 122 */
  const [isCameraReady, setIsCameraReady] = useState(false); /* cite: 122 */

  const displayMessage = useCallback((msg) => {
    setMessages(msg);
    setErrors("");
  }, []); /* cite: 123 */

  const displayError = useCallback((err) => {
    const errorName = err.name || "UnknownError";
    const errorMessage = err.message || "An unknown error occurred.";
    setErrors(`Error: ${errorName} - ${errorMessage}`);
    setMessages("");
    console.error("Detailed error:", err);
  }, []); /* cite: 124 */

  const updateButtonStates = useCallback(() => {
    setIsInRoom(currentRoomId.current !== null);
    setIsLocalCameraOn(localStream.current !== null);
    setIsRecordingActive(
      mediaRecorder.current && mediaRecorder.current.state === "recording"
    );
    setIsConferenceRecordingActive(conferenceRecordingId.current !== null);
  }, []); /* cite: 125 */

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
          )}`; /* cite: 126 */
          label.style.color = "#80c0ff";
          label.style.marginBottom = "6px";
        }
      }

      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      }); /* cite: 127 */
      localVideoRef.current.srcObject = localStream.current;
      displayMessage("Local camera and microphone access granted.");
      setIsCameraReady(true);
      updateButtonStates(); /* cite: 128 */
      return true;
    } catch (error) {
      displayError(
        new Error(`Error accessing local media devices: ${error.message}`)
      ); /* cite: 129 */
      setIsCameraReady(false); /* cite: 129 */
      updateButtonStates(); /* cite: 129 */
      return false;
    }
  }, [displayMessage, displayError, updateButtonStates]); /* cite: 130 */

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
  }, [displayMessage, updateButtonStates]); /* cite: 131 */

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
          remoteVideoElement.srcObject = event.streams[0]; /* cite: 132 */
        }
      } else {
        const wrapper = document.createElement("div");
        wrapper.className = "remote-video-wrapper"; // Use new wrapper class
        wrapper.id = `wrapper-${remoteClientId}`;

        const video = document.createElement("video");
        video.id = `remoteVideo-${remoteClientId}`;
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = event.streams[0]; /* cite: 133 */

        const label = document.createElement("h3"); /* cite: 134 */
        label.textContent = `Guest ${remoteClientId.substring(
          remoteClientId.lastIndexOf(":") + 1
        )}`; /* cite: 135 */
        label.style.color = "#e0e0e0"; /* cite: 135 */
        label.style.marginBottom = "5px"; /* cite: 135 */

        wrapper.appendChild(video);
        wrapper.appendChild(label);
        remoteVideosContainerRef.current.appendChild(wrapper);
      }
    }; /* cite: 136 */

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current.send(
          JSON.stringify({
            type: "candidate",
            candidate: event.candidate,
            targetClientId: remoteClientId,
          })
        ); /* cite: 137 */
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(
        `ICE connection state with ${remoteClientId}: ${pc.iceConnectionState}`
      ); /* cite: 138 */
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
      ); /* cite: 139 */
    } catch (error) {
      console.error(`Error sending offer to ${remoteClientId}:`, error);
    }
  }, []); /* cite: 140 */

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
        ); /* cite: 141 */
      } catch (error) {
        console.error(`Error handling offer from ${senderClientId}:`, error);
      }
    },
    [createPeerConnection] /* cite: 142 */
  );

  const handleAnswer = useCallback(async (answer, senderClientId) => {
    const pc = peerConnections.current[senderClientId];
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error(`Error handling answer from ${senderClientId}:`, error);
    }
  }, []); /* cite: 143 */

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
  }, []); /* cite: 144 */

  const removeRemoteVideo = useCallback((clientId) => {
    const wrapper = document.getElementById(`wrapper-${clientId}`);
    if (wrapper) {
      wrapper.remove();
    }
  }, []); /* cite: 145 */

  const closePeerConnection = useCallback((clientId) => {
    if (peerConnections.current[clientId]) {
      peerConnections.current[clientId].close();
      delete peerConnections.current[clientId];
    }
  }, []); /* cite: 146 */

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
        }); /* cite: 147 */
        if (!response.ok) {
          const errorDetails = await response.text(); /* cite: 148 */
          throw new Error(
            `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
          ); /* cite: 149 */
        }
        const result = await response.json();
        displayMessage(
          `Chunk ${chunkIndex} uploaded (${
            result.message || "success"
          }).` /* cite: 149 */
        );
        return true; /* cite: 150 */
      } catch (error) {
        displayError(
          new Error(
            `Failed to upload chunk ${chunkIndex}. Check console for details.`
          )
        ); /* cite: 151 */
        return false;
      }
    },
    [displayMessage, displayError]
  ); /* cite: 152 */

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
          console.log("Setting roomId for user:", user.id); /* cite: 153 */
          console.log("RoomId to set:", roomId); /* cite: 153 */
          const res = await fetch(
            `${BACKEND_API_URL}/api/users/setroom/${user.id}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              } /* cite: 154 */,
              credentials: "include",
              body: JSON.stringify({ roomId }),
            }
          );
          if (res.message) {
            console.log("Response from setroom:", res.message); /* cite: 155 */
          }
        }
        console.log("RoomId has been set:", roomId); /* cite: 156 */
        const response = await fetch(`${BACKEND_API_URL}/upload-chunk`, {
          method: "POST",
          body: formData,
        }); /* cite: 157 */
        if (!response.ok) {
          const errorDetails = await response.text(); /* cite: 158 */
          throw new Error(
            `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
          ); /* cite: 159 */
        }
        displayMessage(
          `Recording ended for ${userId}. Signaled backend for processing.`
        ); /* cite: 160 */
      } catch (error) {
        displayError(
          `Failed to send end of recording signal for ${userId}. Video may not finalize correctly.`
        ); /* cite: 161 */
      }
    },
    [displayMessage, displayError, user]
  ); /* cite: 162 */

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
          ); /* cite: 164 */
        }
      }

      chunkSequence.current = 0;
      pendingChunkUploadPromises.current = [];
      const options = { mimeType: "video/webm" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        displayError(
          `MIME type ${options.mimeType} is not supported.`
        ); /* cite: 165 */
        return;
      }

      mediaRecorder.current = new MediaRecorder(
        localStream.current,
        options
      ); /* cite: 166 */
      mediaRecorder.current.onstart = () => {
        recordingStartTime.current = Date.now();
        updateButtonStates();
      }; /* cite: 167 */
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
          ); /* cite: 169 */
        }
      };
      mediaRecorder.current.onstop = async () => {
        recordingEndTime.current = Date.now(); /* cite: 170 */
        displayMessage(
          "Local recording stopped. Finalizing chunks..."
        ); /* cite: 170 */
        try {
          await Promise.all(pendingChunkUploadPromises.current); /* cite: 171 */
          await sendEndOfRecordingSignal(
            currentRoomId.current,
            conferenceRecordingId.current,
            recordingUserId.current,
            recordingStartTime.current,
            recordingEndTime.current
          ); /* cite: 172 */
          if (stopRecordingPromiseResolve.current) {
            stopRecordingPromiseResolve.current();
            stopRecordingPromiseResolve.current = null; /* cite: 173 */
          }
        } catch (error) {
          displayError(
            `Failed to finalize local recording: ${error.message}`
          ); /* cite: 174 */
        } finally {
          pendingChunkUploadPromises.current = [];
          updateButtonStates(); /* cite: 175 */
        }
      };

      mediaRecorder.current.start(10000); // 10-second chunks
      displayMessage("Conference recording started!");
      updateButtonStates(); /* cite: 176 */
    },
    [
      displayError,
      displayMessage,
      updateButtonStates,
      uploadVideoChunk,
      sendEndOfRecordingSignal,
    ]
  ); /* cite: 177 */

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
        ); /* cite: 178 */
      }
      return new Promise((resolve) => {
        stopRecordingPromiseResolve.current = resolve;
      });
    }
    return Promise.resolve();
  }, [displayMessage]); /* cite: 179 */

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
      const videoUrl = URL.createObjectURL(videoBlob); /* cite: 180 */
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
      displayMessage(
        "Merged video fetched and loaded for preview."
      ); /* cite: 181 */
    } catch (error) {
      displayError(
        `Failed to fetch or play merged video: ${error.message}`
      ); /* cite: 182 */
      if (previewVideoRef.current)
        previewVideoRef.current.src = ""; /* cite: 182 */
      setDownloadLink({
        href: "#",
        display: "none",
        filename: "",
      }); /* cite: 182 */
    }
  }, [displayMessage, displayError]); /* cite: 183 */

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
      ); /* cite: 184 */
      const status = await response.json(); /* cite: 184 */
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
          }) /* cite: 186 */,
        }
      );
      if (!response.ok) {
        const errorDetails = await response.text(); /* cite: 188 */
        throw new Error(
          `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
        ); /* cite: 189 */
      }
      const result = await response.json();
      displayMessage(
        `Conference merge job queued: ${result.message}`
      ); /* cite: 190 */
    } catch (error) {
      displayError(`Failed to trigger conference merge: ${error.message}`);
      setIsMergeReady(true); /* cite: 191 */
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
          ]); /* cite: 193 */
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
        }); /* cite: 195 */
        status.tracks.forEach((track) => {
          newStatusList.push({
            id: track.userId,
            text: `User ${track.userId.substring(12, 20)}: ${
              track.isReady ? "Ready" : "Processing..."
            }`,
            className: track.isReady ? "status-ready" : "status-pending",
          }); /* cite: 196 */
        });
      } else {
        newStatusList.push({
          id: "no-tracks",
          text: "No recording tracks initiated yet.",
          className: "",
        }); /* cite: 197 */
      }
      setStatusList(newStatusList);

      setIsMergeReady(status.readyForMerge && isHost.current); /* cite: 198 */
      if (status.readyForMerge && isHost.current) {
        clearInterval(conferenceStatusPollingInterval.current);
        conferenceStatusPollingInterval.current = null;
        triggerConferenceMerge(); /* cite: 199 */
      }
    } catch (error) {
      displayError(`Failed to fetch conference status: ${error.message}`);
      setIsMergeReady(false); /* cite: 200 */
      if (!error.message.includes("404")) {
        clearInterval(conferenceStatusPollingInterval.current);
        conferenceStatusPollingInterval.current = null; /* cite: 201 */
      }
    }
  }, [displayError, displayMessage, triggerConferenceMerge]); /* cite: 202 */

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
  }, [
    roomname,
    displayError,
    updateButtonStates,
    pollConferenceStatus,
  ]); /* cite: 203 */

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
      } /* cite: 205 */
      displayMessage("Leaving room...");
      navigate(`/meetingended/${roomname}`);
    }
  }, [isRecordingActive, navigate]); /* cite: 206 */

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
        const cameraStarted = await startLocalCamera(); /* cite: 207 */
        if (cameraStarted && isMounted) {
          joinRoom();
        }
      };

      ws.current.onmessage = async (event) => {
        if (!isMounted) return;
        const message = JSON.parse(event.data);
        switch (message.type) {
          case "participant_joined" /* cite: 208 */:
            if (!localClientId.current) {
              localClientId.current = message.clientId;
              recordingUserId.current =
                "webrtc-user-" +
                message.clientId.substring(
                  message.clientId.lastIndexOf(":") + 1
                ); /* cite: 210 */
            }
            isHost.current = message.isHost; /* cite: 211 */
            if (message.isHost) {
              hostUserId.current =
                "webrtc-user-" +
                message.clientId.substring(
                  message.clientId.lastIndexOf(":") + 1
                ); /* cite: 212 */
            }
            setLocalClientIdDisplay(
              `Your ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            ); /* cite: 213 */
            setRoomSizeDisplay(
              `Participants: ${message.roomSize}`
            ); /* cite: 213 */
            if (message.clientId !== localClientId.current) {
              const pc = createPeerConnection(message.clientId); /* cite: 214 */
              peerConnections.current[message.clientId] = pc;
              await sendOffer(message.clientId);
            }
            updateButtonStates();
            break;
          case "existing_participants" /* cite: 215 */:
            message.participants.forEach((p) => {
              const pc = createPeerConnection(p.clientId);
              peerConnections.current[p.clientId] = pc;
              if (p.isHost) {
                hostUserId.current =
                  "webrtc-user-" +
                  p.clientId.substring(
                    p.clientId.lastIndexOf(":") + 1
                  ); /* cite: 216 */
              }
            });
            updateButtonStates(); /* cite: 217 */
            break;
          case "participant_left":
            setRoomSizeDisplay(
              `Participants: ${message.roomSize}`
            ); /* cite: 217 */
            closePeerConnection(message.clientId); /* cite: 217 */
            removeRemoteVideo(message.clientId); /* cite: 218 */
            if (
              hostUserId.current &&
              message.clientId ===
                hostUserId.current.replace("webrtc-user-", "")
            ) {
              isHost.current = false; /* cite: 219 */
              hostUserId.current = null; /* cite: 219 */
            }
            updateButtonStates();
            break;
          case "host_leave" /* cite: 220 */:
            displayMessage("The host has ended the meeting.");
            ws.current.close(); /* cite: 221 */
            navigate("/");
            break;
          case "offer" /* cite: 222 */:
            await handleOffer(message.sdp, message.senderClientId);
            break;
          case "answer" /* cite: 223 */:
            await handleAnswer(message.sdp, message.senderClientId);
            break;
          case "candidate" /* cite: 224 */:
            await handleCandidate(message.candidate, message.senderClientId);
            break;
          case "host_status_update" /* cite: 224 */:
            isHost.current = message.isHost; /* cite: 225 */
            if (isHost.current) {
              hostUserId.current =
                "webrtc-user-" +
                localClientId.current.substring(
                  localClientId.current.lastIndexOf(":") + 1
                ); /* cite: 226 */
            } else {
              hostUserId.current = null; /* cite: 227 */
            }
            setLocalClientIdDisplay(
              `Your ID: ${localClientId.current.substring(
                localClientId.current.lastIndexOf(":") + 1
              )} ${isHost.current ? "(Host)" : ""}`
            ); /* cite: 228 */
            updateButtonStates();
            break;
          case "start_recording_signal" /* cite: 229 */:
            if (!isHost.current) {
              startLocalRecording(
                message.conferenceRecordingId
              ); /* cite: 229 */
            }
            break;
          case "stop_recording_signal" /* cite: 230 */:
            if (!isHost.current) {
              stopLocalRecording(); /* cite: 231 */
            }
            break;
          default: /* cite: 232 */
            console.warn("Unknown message type:", message.type); /* cite: 233 */
        }
      };

      ws.current.onclose = () => {
        if (!isMounted) return; /* cite: 234 */
        displayMessage("Disconnected from signaling server.");
        setIsWebSocketConnected(false);
        currentRoomId.current = null;
        localClientId.current = null;
        isHost.current = false;
        hostUserId.current = null;
        conferenceRecordingId.current = null; /* cite: 235 */
        setCurrentRoomDisplay("");
        setLocalClientIdDisplay("");
        setRoomSizeDisplay("");
        Object.values(peerConnections.current).forEach((pc) => pc.close());
        peerConnections.current = {};
        if (remoteVideosContainerRef.current) {
          remoteVideosContainerRef.current.innerHTML = ""; /* cite: 236 */
        }
        updateButtonStates();
        if (conferenceStatusPollingInterval.current) {
          clearInterval(
            conferenceStatusPollingInterval.current
          ); /* cite: 237 */
          conferenceStatusPollingInterval.current = null; /* cite: 237 */
        }
        setStatusList([]);
      };
      ws.current.onerror = (error) => {
        if (!isMounted) return; /* cite: 238 */
        displayError(new Error("WebSocket error."));
        setIsWebSocketConnected(false);
      }; /* cite: 239 */
    };

    connectWebSocket();

    return () => {
      isMounted = false; /* cite: 240 */
      if (ws.current) {
        ws.current.close(); /* cite: 241 */
      }
      if (conferenceStatusPollingInterval.current) {
        clearInterval(conferenceStatusPollingInterval.current); /* cite: 242 */
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
  ]); /* cite: 243 */

  const handleToggleRecording = () => {
    if (!isHost.current) {
      displayError(new Error("Only the host can record.")); /* cite: 244 */
      return;
    }
    if (!isInRoom || !isLocalCameraOn) {
      displayError(
        new Error("Must be in a room with camera on to record.")
      ); /* cite: 245 */
      return;
    }
    if (Object.keys(peerConnections.current).length === 0) {
      displayError(
        new Error("Wait for a guest to join before recording.")
      ); /* cite: 246 */
      return;
    }

    if (isRecordingActive) {
      stopLocalRecording(); /* cite: 247 */
    } else {
      startLocalRecording();
    }
  }; /* cite: 248 */

  const toggleMute = useCallback(() => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      });
    }
  }, []);

  return (
    <div className="container">
      <div className="main-content">
        <div className="video-section host-video-section" ref={hostSectionRef}>
          <h3>Your Video</h3>
          <div className="video-container">
            <video
              id="localVideo"
              ref={localVideoRef}
              autoPlay /* cite: 249 */
              playsInline /* cite: 249 */
              muted={true} // Local video is always muted for self-listening
            ></video>
          </div>
        </div>
        <div className="video-section guest-video-section">
          <h3>Participants</h3>
          <div
            id="remoteVideosContainer"
            className="remote-video-container" /* cite: 250 */
            ref={remoteVideosContainerRef}></div>
        </div>
      </div>

      <div className="control-panel">
        <div className="controls-row">
          <button
            className={`control-button ${
              isRecordingActive ? "btn-red" : "btn-blue"
            }`}
            onClick={handleToggleRecording} /* cite: 251 */
            disabled={
              !isHost.current || !isInRoom || !isLocalCameraOn
            } /* cite: 252 */
          >
            {isRecordingActive ? <FaStopCircle /> : <FaPlayCircle />}
            {isRecordingActive ? "STOP RECORDING" : "START RECORDING"}{" "}
            {/* cite: 253 */}
          </button>
          <button
            className="control-button btn-blue"
            onClick={startLocalCamera}
            disabled={isLocalCameraOn}>
            <FaVideo />
            CAM ON
          </button>
          <button
            className="control-button btn-red"
            onClick={stopLocalCamera}
            disabled={!isLocalCameraOn}>
            <FaVideoSlash />
            CAM OFF
          </button>
          <button
            className={`control-button ${
              isMuted ? "btn-red" : "btn-blue"
            }`} /* cite: 255 */
            onClick={toggleMute}>
            {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
            {isMuted ? "UNMUTE" : "MUTE"} {/* cite: 256 */}
          </button>
          <button className="control-button btn-blue" disabled>
            <FaHeadphones />
            SPEAKER
          </button>
          <button
            className="control-button btn-red"
            onClick={leaveRoom}
            disabled={!isInRoom || isRecordingActive} /* cite: 257 */
          >
            <FaSignOutAlt />
            LEAVE
          </button>
        </div>
      </div>
    </div>
  ); /* cite: 258 */
}

export default VideoConference;
