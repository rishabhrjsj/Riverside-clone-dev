import { BrowserRouter } from "react-router-dom";
import Navbar from "./Components/Navbar/Navbar";
import "./App.css";
import Footer from "./Components/Footer/Footer";
import VideoConference from "./Components/VideoConference/VideoConference";

function App() {
  return (
    <BrowserRouter>
      <Navbar isLoggedIn={true} handleLogout={() => {}} />
      <div className="main-content">
        <VideoConference />
      </div>
      <Footer />
    </BrowserRouter>
  );
}

export default App;
