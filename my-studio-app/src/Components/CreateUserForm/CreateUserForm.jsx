import React, { useState } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "./CreateUserForm.css"; // Import the CSS file

const CreateUserForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.password) {
      toast.error("Please fill in all fields.");
      return;
    }

    try {
      const res = await fetch("http://localhost:3000/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(data.message || "User created successfully!");
        setFormData({ name: "", email: "", password: "" });
        navigate("/signin");
      } else {
        toast.error(data.message || "Failed to create user.");
      }
    } catch (error) {
      toast.error("Network error. Please try again.");
    }
  };

  return (
    <div className="create-user-page-wrapper">
      {" "}
      {/* New wrapper for full page background */}
      <div className="create-user-container">
        <h2 className="create-user-heading">Create New User</h2>
        <form onSubmit={handleSubmit} className="create-user-form">
          <div className="input-group">
            <label htmlFor="name">Name </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              required
              onChange={handleChange}
            />
          </div>

          <div className="input-group">
            <label htmlFor="email">Email </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              required
              onChange={handleChange}
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password </label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              required
              onChange={handleChange}
            />
          </div>

          <button type="submit" className="submit-button">
            Create User
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateUserForm;
