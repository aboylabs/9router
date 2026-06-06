import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Admin = { id?: string; email: string };

export function useAuth() {
  const [admin, setAdmin] = useState<Admin | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ admin: Admin | null }>("/admin/me")
      .then((data) => setAdmin(data.admin))
      .catch(() => setAdmin(null));
  }, []);

  async function login(email: string, password: string) {
    setError("");
    try {
      const data = await api<{ admin: Admin }>("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setAdmin(data.admin);
    } catch {
      setError("Login failed. Check email and password.");
    }
  }

  async function logout() {
    await api("/admin/auth/logout", { method: "POST" });
    setAdmin(null);
  }

  return { admin, login, logout, error, setError, isLoading: admin === undefined };
}
