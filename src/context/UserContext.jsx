import { createContext, useContext, useState } from "react";

const UserContext = createContext();

export function UserProvider({ children }) {
  const [user, setUser] = useState({
    username: "Qamazi",
    avatarInitial: "Q",
    authStatus: "Authenticated User",
    role: "Applicant",
    progressionState: "accepted",
  });

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}