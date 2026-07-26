import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
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
    <main className="min-h-screen flex items-center justify-center bg-surface-secondary p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary-500/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative page-enter">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 mb-4 shadow-lg shadow-primary-900/25">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Routers9</h1>
          <p className="text-sm text-text-muted mt-1">Admin Panel</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface/90 backdrop-blur border border-border rounded-2xl p-6 shadow-xl space-y-4"
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
            <p className="text-sm text-danger bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {loading ? "" : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-xs text-text-muted mt-6">
          White-label AI API Gateway
        </p>
      </div>
    </main>
  );
}
