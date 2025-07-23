import React, { useState, useRef, useEffect } from "react";
import "./CreatePodcast.css";
import { useNavigate } from "react-router-dom";

const CreatePodcast = () => {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState(null);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState(null);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  const startStream = async (videoDeviceId, audioDeviceId) => {
    try {
      const constraints = {
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing media:", err);
      setError("Could not access selected camera/microphone.");
    }
  };

  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");

        setVideoDevices(cams);
        setAudioDevices(mics);

        if (cams.length > 0) setSelectedVideoDeviceId(cams[0].deviceId);
        if (mics.length > 0) setSelectedAudioDeviceId(mics[0].deviceId);
      } catch (err) {
        console.error("Access denied or error:", err);
        setError("Camera or microphone access denied.");
      }
    };

    initMedia();

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 🔄 Re-run stream when camera changes
  useEffect(() => {
    if (selectedVideoDeviceId || selectedAudioDeviceId) {
      startStream(selectedVideoDeviceId, selectedAudioDeviceId);
    }
  }, [selectedVideoDeviceId, selectedAudioDeviceId]);

  const handleJoin = () => {
    if (!roomName.trim()) {
      alert("Please enter a room name.");
      return;
    }

    navigate(`/room/${roomName}`);
  };

  return (
    <div className="podcast-container">
      <div className="podcast-box">
        {/* LEFT SIDE */}
        <div className="podcast-left">
          <p className="sub-heading">You're about to start a Podcast</p>
          <h2 className="heading">Let's set up your session</h2>

          <div className="input-group">
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Enter room name"
              className="input"
            />
            <span className="label">Room</span>
          </div>

          <button className="join-btn" onClick={handleJoin}>
            Join Podcast
          </button>

          <p className="note">You are joining as a Parcipant. </p>
        </div>

        {/* RIGHT SIDE */}
        <div className="podcast-right">
          <div className="video-preview">
            <span className="resolution">720p / 30fps</span>

            {error ? (
              <p style={{ color: "red", textAlign: "center" }}>{error}</p>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="preview-video"
              />
            )}
          </div>

          {/* 📷 Video Devices Dropdown */}
          <select
            className="dropdown"
            value={selectedVideoDeviceId}
            onChange={(e) => setSelectedVideoDeviceId(e.target.value)}>
            {videoDevices.length === 0 ? (
              <option>No camera found</option>
            ) : (
              videoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  🎥 {device.label || "Unnamed Camera"}
                </option>
              ))
            )}
          </select>

          {/* 🎙️ Audio Devices Dropdown */}
          <select
            className="dropdown"
            value={selectedAudioDeviceId}
            onChange={(e) => setSelectedAudioDeviceId(e.target.value)}>
            {audioDevices.length === 0 ? (
              <option>No microphone found</option>
            ) : (
              audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  🎙️ {device.label || "Unnamed Microphone"}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
    </div>
  );
};

export default CreatePodcast;
