import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/authApi";
import { ApiError } from "@/lib/http";

export function Login() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const submit = async () => {
    setError(undefined);
    if (!login.trim() || !password) {
      setError("Enter your email or username, and your password.");
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await authApi.login(login, password);
      setUser(user);
      navigate("/");
    } catch (err) {
      // The backend deliberately returns one generic message for a
      // wrong password, an unknown account, or a deactivated one -- this
      // page shows exactly that message verbatim, rather than trying to
      // be more specific than the server was willing to be.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Welcome back" title="Log in" subtitle="Guest play doesn't need this — only sign in if you already have an account." />

        <Card>
          <CardBody className="flex flex-col gap-4">
            <TextField
              label="Email or username"
              autoComplete="username"
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
                setError(undefined);
              }}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              error={error}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-3">
          <Button size="lg" fullWidth onClick={submit} disabled={submitting}>
            {submitting ? "Signing in…" : "Log in"}
          </Button>
          <p className="text-center text-sm text-chalk-faint">
            New here?{" "}
            <ButtonLink to="/signup" variant="ghost" className="inline w-auto px-1 py-0 align-baseline text-mint-400">
              Create an account
            </ButtonLink>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
