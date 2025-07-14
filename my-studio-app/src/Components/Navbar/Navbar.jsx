import React from "react";
import { Link } from "react-router-dom";
import "./Navbar.css";

export default function Navbar() {
  // Dummy authentication variable
  const isAuthenticated = false; // Set true to simulate logged-in state

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <div className="logo">
          <Link to="/">🎙 LOGO</Link>
        </div>
        <div className="nav-links">
          <Link to="/start">Start Podcast</Link>
          <Link to="/studio">Your Studio</Link>
        </div>
      </div>

      <div className="navbar-right">
        {!isAuthenticated ? (
          <>
            <Link to="/signup">
              <button className="nav-btn">Signup</button>
            </Link>
            <Link to="/signin">
              <button className="nav-btn">Signin</button>
            </Link>
          </>
        ) : (
          <Link to="/logout">
            <button className="nav-btn logout">Logout</button>
          </Link>
        )}
      </div>
    </nav>
  );
}
