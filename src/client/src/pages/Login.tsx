import { FormEvent, useState } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  error: string;
}

export function Login({ onLogin, error }: LoginProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    try {
      await onLogin(form.get("email") as string, form.get("password") as string);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface-secondary p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-lg bg-surface border border-border mb-4 overflow-hidden">
            <img
              src="/admin/assets/brand/mark.webp"
              alt="Routers9"
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">Routers9</h1>
          <p className="text-sm text-text-muted mt-1">Admin</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-lg p-6 space-y-4"
        >
          <Input
            id="email"
            name="email"
            type="text"
            label="Username"
            placeholder="admin"
            autoComplete="username"
            required
          />
          <Input
            id="password"
            name="password"
            type="password"
            label="Password"
            placeholder="Enter password"
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="text-sm text-danger bg-red-950/40 border border-red-800/50 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {loading ? "" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
