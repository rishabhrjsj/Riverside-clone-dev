import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./MeetingEnded.css"; // Make sure to create this CSS file

const MeetingEnded = () => {
  const { roomname } = useParams();
  const navigate = useNavigate();

  return (
    <div className="meeting-ended-container">
      <h1 className="meeting-ended-heading">
        Meeting for room <span className="room-name">{roomname}</span> has
        ended.
      </h1>
      <button className="go-home-button" onClick={() => navigate("/")}>
        Go to Home
      </button>
    </div>
  );
};

export default MeetingEnded;
