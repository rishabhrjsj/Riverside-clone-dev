import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import "./App.css";

import Navbar from "./Components/Navbar/Navbar";
import Home from "./Components/Home/Home";
import Footer from "./Components/Footer/Footer";
import VideoConference from "./Components/VideoConference/VideoConference";
import CreateUserForm from "./Components/CreateUserForm/CreateUserForm";
import LoginForm from "./Components/Login/LoginForm";
import Studio from "./Components/Studio/Studio";
import CreatePodcast from "./Components/CreatePodcast/CreatePodcast";
import MeetingEnd from "./Components/helperComponent/MeetingEnd";

function App() {
  return (
    <BrowserRouter>
      <Navbar />

      <div className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signup" element={<CreateUserForm />} />
          <Route path="/signin" element={<LoginForm />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/podcast" element={<CreatePodcast />} />
          <Route path="/room/:roomname" element={<VideoConference />} />
          <Route path="/meetingended/:roomname" element={<MeetingEnd />} />
        </Routes>
      </div>

      <Footer />

      {/* ✅ ToastContainer globally at the root level */}
      <ToastContainer position="top-center" autoClose={3000} />
    </BrowserRouter>
  );
}

export default App;
