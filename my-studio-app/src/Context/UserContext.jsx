import { createContext, useContext, useEffect, useState } from "react";

const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  // 🔁 Run once on app load to check if user is still logged in
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/users/profile", {
          method: "GET",
          credentials: "include",
        });

        const data = await res.json();

        if (res.ok) {
          setUser(data); // data = { id, name, email }
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error("Auto login check failed", err);
        setUser(null);
      }
    };

    fetchUser();
  }, []); // 👈 only runs once on page load

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
