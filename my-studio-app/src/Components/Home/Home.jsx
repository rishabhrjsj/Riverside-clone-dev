import React from "react";
import {
  Mic,
  Video,
  Layers,
  Sparkles,
  UserPlus,
  Play,
  Download,
  Star,
  Users,
  MonitorPlay,
} from "lucide-react";
import "./Home.css"; // Import the pure CSS file
import { Link } from "react-router-dom";

// HomePage Component
const Home = () => {
  return (
    <div className="homepage-container">
      {/* Hero Section */}
      <section className="hero-section">
        {/* Background gradient/glow effect */}
        <div className="hero-background-glow">
          <div className="glow-blob glow-blob-1"></div>
          <div className="glow-blob glow-blob-2"></div>
        </div>

        <div className="hero-content-wrapper">
          {/* Hero Content - Left */}
          <div className="hero-text-content">
            <h1 className="hero-headline">
              Record{" "}
              <span className="hero-headline-gradient">Limitless Quality.</span>{" "}
              From Anywhere.
            </h1>
            <p className="hero-subheadline">
              Capture pristine video and crystal-clear audio with independent
              tracks for every guest. The ultimate remote studio, simplified.
            </p>
            <div className="hero-cta-buttons">
              <Link to="/podcast" className="btn-primary">
                Start Recording Free
                <Play className="icon-after-text" />
              </Link>
              {/* <button className="btn-secondary">See Features</button> */}
            </div>
          </div>

          {/* Hero Visual - Right (Placeholder) */}
          <div className="hero-visual-placeholder">
            <div className="hero-visual-box">
              <div className="hero-visual-icon-container">
                <MonitorPlay className="hero-visual-icon" />
                <span className="hero-visual-text">
                  Sleek Product Interface Mockup
                </span>
              </div>
              <div className="hero-visual-top-bar"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section">
        <div className="section-header">
          <h2 className="section-title">Your Studio, Amplified.</h2>
          <p className="section-subtitle">
            Unrivaled quality and control at your fingertips.
          </p>
        </div>

        <div className="features-grid">
          {/* Feature Card 1 */}
          <div className="feature-card">
            <Mic className="feature-icon violet-icon" />
            <h3 className="feature-title">Local Recording Precision</h3>
            <p className="feature-description">
              Every participant is recorded directly on their device, ensuring
              zero quality loss from internet fluctuations.
            </p>
          </div>
          {/* Feature Card 2 */}
          <div className="feature-card">
            <Layers className="feature-icon red-icon" />
            <h3 className="feature-title">Separate Video Tracks</h3>
            <p className="feature-description">
              Get individual And Confererce high-resolution files for ultimate
              post-production flexibility and creative control.
            </p>
          </div>
          {/* Feature Card 3 */}
          <div className="feature-card">
            <Video className="feature-icon violet-icon" />
            <h3 className="feature-title">Lossless Video & Audio</h3>
            <p className="feature-description">
              Capture stunning visuals and pristine sound, ready for any
              platform and audience.
            </p>
          </div>
          {/* Feature Card 4 */}

          {/* Feature Card 5 */}
          <div className="feature-card">
            <Users className="feature-icon violet-icon" />
            <h3 className="feature-title">Seamless Collaboration</h3>
            <p className="feature-description">
              Invite guests . No downloads, no fuss, just pure recording.
            </p>
          </div>
          {/* Feature Card 6 */}
          <div className="feature-card">
            <Download className="feature-icon red-icon" />
            <h3 className="feature-title">Easy Export & Integration</h3>
            <p className="feature-description">
              Download your high-quality files
            </p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="how-it-works-section">
        <div className="section-header">
          <h2 className="section-title">Simple Steps to Professional Sound.</h2>
          <p className="section-subtitle">Get started in minutes, not hours.</p>
        </div>

        <div className="how-it-works-grid">
          {/* Step 1 */}
          <div className="how-it-works-card">
            <div className="step-number violet-bg">1</div>
            <h3 className="step-title">Create Your Studio Session</h3>
            {/* <p className="step-description">
              Generate a unique, secure link for your virtual recording studio
              in moments.
            </p> */}
          </div>
          {/* Step 2 */}
          <div className="how-it-works-card">
            <div className="step-number red-bg">2</div>
            <h3 className="step-title">Invite Your Guests</h3>
            <p className="step-description">
              Share the room name. Guests join effortlessly from any browser –
              no downloads needed.
            </p>
          </div>
          {/* Step 3 */}
          <div className="how-it-works-card">
            <div className="step-number violet-bg">3</div>
            <h3 className="step-title">Record & Export Flawlessly</h3>
            <p className="step-description">
              Hit record. Files auto-sync and are ready for download
            </p>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="testimonials-section">
        <div className="section-header">
          <h2 className="section-title">What Our Creators Are Saying</h2>
          <p className="section-subtitle">
            Trusted by podcasters and videographers worldwide.
          </p>
        </div>

        <div className="testimonials-grid">
          {/* Testimonial Card 1 */}
          <div className="testimonial-card">
            <div className="star-rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="star-icon violet-star" />
              ))}
            </div>
            <p className="testimonial-quote">
              "This platform is a game-changer! The{" "}
              <span className="text-violet">audio quality is unmatched</span>,
              and the ease of use makes remote recording a breeze."
            </p>
            <div className="testimonial-author">
              <img
                src="https://placehold.co/60x60/FF3B3B/FFFFFF?text=JD"
                alt="John Doe"
                className="author-avatar red-border"
              />
              <div>
                <p className="author-name">John Doe</p>
                <p className="author-title">
                  Podcast Host, "The Creative Mind"
                </p>
              </div>
            </div>
          </div>
          {/* Testimonial Card 2 */}
          <div className="testimonial-card">
            <div className="star-rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="star-icon red-star" />
              ))}
            </div>
            <p className="testimonial-quote">
              "Finally, a tool that delivers on its promise.{" "}
              <span className="text-red">video and separate tracks</span> are
              essential for my workflow."
            </p>
            <div className="testimonial-author">
              <img
                src="https://placehold.co/60x60/8A2BE2/FFFFFF?text=AJ"
                alt="Jane Smith"
                className="author-avatar violet-border"
              />
              <div>
                <p className="author-name">Jane Smith</p>
                <p className="author-title">Video Producer, "Visual Stories"</p>
              </div>
            </div>
          </div>
          {/* Testimonial Card 3
          <div className="testimonial-card">
            <div className="star-rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="star-icon violet-star" />
              ))}
            </div>
            <p className="testimonial-quote">
              "The{" "}
              <span className="text-violet">
                AI editing features save me hours
              </span>
              . It's like having a professional editor built right in!"
            </p>
            <div className="testimonial-author">
              <img
                src="https://placehold.co/60x60/FF3B3B/FFFFFF?text=MK"
                alt="Michael Kim"
                className="author-avatar red-border"
              />
              <div>
                <p className="author-name">Michael Kim</p>
                <p className="author-title">
                  Content Creator, "Digital Insights"
                </p>
              </div>
            </div>
          </div> */}
        </div>
      </section>

      {/* Final Call to Action Section */}
      <section className="final-cta-section">
        <div className="final-cta-content">
          <h2 className="final-cta-title">
            Elevate Your Content. Start Today.
          </h2>
          <p className="final-cta-subtitle">
            Join the new standard of remote recording. No credit card required
            to start your journey.
          </p>
          <Link to="/studio" className="btn-final-cta">
            Claim Your Free Studio
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Home;
