import React, { useEffect, useState, useContext } from "react";
import { useUser } from "../../Context/UserContext";
import "./Studio.css"; // Import the pure CSS file
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";

const Studio = () => {
  const { user } = useUser();
  const [roomIds, setRoomIds] = useState([]);
  const [webmFilesByRoom, setWebmFilesByRoom] = useState({});
  const [conferenceVideosByRoom, setConferenceVideosByRoom] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  let navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) return;

    const fetchRoomIds = async () => {
      try {
        const res = await fetch(
          `http://localhost:3000/api/users/${user.id}/room-ids`,
          {
            credentials: "include",
          }
        );
        const data = await res.json();
        if (res.status === 401) {
          toast.error("You must be logged in to view this page.");
          navigate("/login");
          return;
        }
        setRoomIds(data.roomIds);
      } catch (err) {
        console.error("Error fetching room IDs:", err);
        toast.error("Failed to load room data.");
      }
    };

    fetchRoomIds();
  }, [user, navigate]);

  useEffect(() => {
    const fetchAllVideos = async () => {
      setIsLoading(true);

      const participantFiles = {};
      const conferenceFiles = {};

      for (const roomId of roomIds) {
        try {
          // Participant videos
          const participantRes = await fetch(
            `http://localhost:3000/api/studio/finalvideos/${roomId}`,
            {
              credentials: "include",
            }
          );
          if (participantRes.status === 401) {
            toast.error("Session expired. Please log in again.");
            navigate("/login");
            setIsLoading(false);
            return;
          }
          if (participantRes.ok) {
            const data = await participantRes.json();
            participantFiles[roomId] = data;
          }

          // Conference videos
          const conferenceRes = await fetch(
            `http://localhost:3000/api/studio/conferencevideos/${roomId}`,
            {
              credentials: "include",
            }
          );
          if (conferenceRes.status === 401) {
            toast.error("Session expired. Please log in again.");
            navigate("/login");
            setIsLoading(false);
            return;
          }
          if (conferenceRes.ok) {
            const data = await conferenceRes.json();
            conferenceFiles[roomId] = data;
          }
        } catch (err) {
          console.error(`Error fetching videos for roomId ${roomId}:`, err);
          toast.error(`Failed to load videos for room ${roomId}.`);
        }
      }

      setWebmFilesByRoom(participantFiles);
      setConferenceVideosByRoom(conferenceFiles);
      setIsLoading(false);
    };

    if (roomIds.length > 0) {
      fetchAllVideos();
    } else if (!isLoading && roomIds.length === 0) {
      setIsLoading(false);
    }
  }, [roomIds, navigate]);

  return (
    <div className="studio-container">
      <h1 className="studio-title">Your Studio Recordings</h1>

      {isLoading && (
        <p className="studio-loading-message">
          Loading your recordings, please wait...
        </p>
      )}

      {!isLoading && roomIds.length === 0 && (
        <p className="studio-no-recordings">
          No recordings found for your account.
        </p>
      )}

      {!isLoading &&
        roomIds.map((roomId) => (
          <div key={roomId} className="studio-room-section">
            <h2 className="studio-room-title">Room ID: {roomId}</h2>

            <div className="studio-content-wrapper">
              {/* Participants Section */}
              <div className="studio-left">
                <h3 className="studio-subtitle">Participant Videos</h3>
                <>
                  {(webmFilesByRoom[roomId] || []).length === 0 && (
                    <p className="studio-no-recordings-sub">
                      No participant recordings found for this room.
                    </p>
                  )}
                  {(webmFilesByRoom[roomId] || []).map((file, idx) => (
                    <div key={idx} className="studio-card">
                      <video src={file.url} controls className="studio-video" />
                      <p className="studio-filename">{file.fileName}</p>
                      <p className="studio-date">
                        Recorded on:{" "}
                        {new Date(file.lastModified).toLocaleString()}
                      </p>
                      <a
                        href={file.url}
                        download
                        className="studio-download-btn">
                        Download Video
                      </a>
                    </div>
                  ))}
                </>
              </div>

              {/* Conference Section */}
              <div className="studio-right">
                <h3 className="studio-subtitle">Combined Conference Video</h3>
                <>
                  {(conferenceVideosByRoom[roomId] || []).length === 0 && (
                    <p className="studio-no-recordings-sub">
                      No combined conference video found for this room.
                    </p>
                  )}
                  {(conferenceVideosByRoom[roomId] || []).map((file, idx) => (
                    <div key={idx} className="studio-card">
                      <video src={file.url} controls className="studio-video" />
                      <p className="studio-filename">{file.fileName}</p>
                      <p className="studio-date">
                        Recorded on:{" "}
                        {new Date(file.lastModified).toLocaleString()}
                      </p>
                      <a
                        href={file.url}
                        download
                        className="studio-download-btn">
                        Download Video
                      </a>
                    </div>
                  ))}
                </>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
};

export default Studio;
