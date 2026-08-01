import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";

/**
 * Sign in / sign up.
 *
 * `redirect` carries where the user was actually headed when the `_auth` guard
 * turned them away, so a deep link survives the round trip through login
 * instead of dumping everyone on the console root.
 *
 * The reverse guard matters as much as the forward one: without it, an
 * already-signed-in user following a stale `/login` link is shown a sign-in
 * form for a session they already have.
 */
export const Route = createFileRoute("/login")({
  component: RouteComponent,
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
  beforeLoad: async ({ search }) => {
    const { data: session } = await authClient.getSession();
    if (session) {
      throw redirect({ to: search.redirect ?? "/" });
    }
  },
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);
  const { redirect: redirectTo } = Route.useSearch();

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} redirectTo={redirectTo} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} redirectTo={redirectTo} />
  );
}
