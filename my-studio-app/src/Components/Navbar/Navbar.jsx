import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import "./Navbar.css";
import { useUser } from "../../Context/UserContext";
import { useNavigate } from "react-router-dom";

export default function Navbar() {
  const { user, setUser } = useUser();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      const res = await fetch("http://localhost:3000/api/users/logout", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // ✅ Important for cookie handling
      });

      const data = await res.json();

      if (res.ok) {
        setUser(null);
        toast.success(data.message || "Logged out successfully");
        navigate("/");
      } else {
        toast.error(data.message || "Logout failed");
      }
    } catch (error) {
      toast.error("Network error");
      console.error("Logout Error:", error);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <div className="logo">
          <Link to="/">🎙 Riverside</Link>
        </div>
        <div className="nav-links">
          {user && (
            <>
              <Link to="/podcast">Start Podcast</Link>
              <Link to="/studio">Your Studio</Link>
            </>
          )}
        </div>
      </div>

      <div className="navbar-right">
        {!user ? (
          <>
            <Link to="/signup">
              <button className="nav-btn">Signup</button>
            </Link>
            <Link to="/signin">
              <button className="nav-btn">Signin</button>
            </Link>
          </>
        ) : (
          <>
            <p className="navbar-user">{user.name}</p>
            <button className="nav-btn logout" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
