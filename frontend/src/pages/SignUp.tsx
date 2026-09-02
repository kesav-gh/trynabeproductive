import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/authApi";
import { ApiError } from "@/lib/http";

export function SignUp() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const submit = async () => {
    setServerError(undefined);
    setFieldErrors({});

    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: "Passwords don't match." });
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await authApi.register(email, username, password, confirmPassword);
      setUser(user);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError) {
        // The backend's ValidationError carries which field is wrong in
        // its message text, not a machine field name -- a small, known
        // set of substrings is enough to route it without over-parsing.
        const msg = err.message.toLowerCase();
        if (msg.includes("email")) setFieldErrors({ email: err.message });
        else if (msg.includes("username")) setFieldErrors({ username: err.message });
        else if (msg.includes("password")) setFieldErrors({ password: err.message });
        else setServerError(err.message);
      } else {
        setServerError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Optional"
          title="Create an account"
          subtitle="Not required to play — guest games work exactly the same either way. An account is just a way to sign back in as yourself later."
        />

        <Card>
          <CardBody className="flex flex-col gap-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              error={fieldErrors.email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((f) => ({ ...f, email: "" }));
              }}
            />
            <TextField
              label="Username"
              autoComplete="username"
              hint="3-20 characters: letters, numbers and underscores."
              value={username}
              error={fieldErrors.username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFieldErrors((f) => ({ ...f, username: "" }));
              }}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={password}
              error={fieldErrors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((f) => ({ ...f, password: "" }));
              }}
            />
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              error={fieldErrors.confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setFieldErrors((f) => ({ ...f, confirmPassword: "" }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </CardBody>
        </Card>

        {serverError ? <ErrorBanner message={serverError} /> : null}

        <div className="flex flex-col gap-3">
          <Button size="lg" fullWidth onClick={submit} disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-center text-sm text-chalk-faint">
            Already have an account?{" "}
            <ButtonLink to="/login" variant="ghost" className="inline w-auto px-1 py-0 align-baseline text-mint-400">
              Log in
            </ButtonLink>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
