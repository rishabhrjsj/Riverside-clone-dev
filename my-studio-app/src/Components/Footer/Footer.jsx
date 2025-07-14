import React from "react";
import "./Footer.css";
import { FaInstagram, FaGithub, FaLinkedin, FaTwitter } from "react-icons/fa";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top-border" />

      <div className="footer-content">
        <div className="footer-section logo-section">
          <h2 className="logo-text">🎙 LOGO</h2>
          <p>Your voice. Your studio. Your platform.</p>
        </div>

        <div className="footer-section links-section">
          <h3>Quick Links</h3>
          <ul>
            <li>
              <a href="/start">Start Podcast</a>
            </li>
            <li>
              <a href="/studio">Your Studio</a>
            </li>
            <li>
              <a href="/signup">Signup</a>
            </li>
            <li>
              <a href="/signin">Signin</a>
            </li>
          </ul>
        </div>

        <div className="footer-section social-section">
          <h3>Connect</h3>
          <div className="social-icons">
            <a href="#">
              <FaInstagram />
            </a>
            <a href="#">
              <FaGithub />
            </a>
            <a href="#">
              <FaLinkedin />
            </a>
            <a href="#">
              <FaTwitter />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} Riverside. All rights reserved.</p>
      </div>
    </footer>
  );
}
