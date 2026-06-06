import { FormEvent, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
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
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary-600 mb-4">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">9router</h1>
          <p className="text-sm text-text-muted mt-1">Admin Panel</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 shadow-lg space-y-4"
        >
          <Input
            id="email"
            name="email"
            type="text"
            label="Username"
            placeholder="9router"
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
            <p className="text-sm text-danger bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
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
