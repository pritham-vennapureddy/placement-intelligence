import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { useAuth } from "../contexts/auth-context";

const loginFormSchema = z.object({
  email: z.email("Enter a valid work email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

export function LoginPage() {
  const { signIn } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setSubmitError(null);
    try {
      await signIn(email, password);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to sign in.");
    }
  });

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-36 -top-32 h-[520px] w-[520px] rounded-full border border-white/10" />
        <div className="absolute -right-16 -top-12 h-[360px] w-[360px] rounded-full border border-white/10" />
        <div className="absolute -bottom-48 -left-24 h-[440px] w-[440px] rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500">
            <GraduationCap size={24} />
          </div>
          <span className="text-sm font-bold tracking-wide">PlacementOS</span>
        </div>
        <div className="relative max-w-xl">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">Placement intelligence</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            Turn placement operations into measurable outcomes.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
            A single workspace for teams to coordinate employer demand, candidate readiness, and every milestone in between.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-slate-300">
            <span className="flex -space-x-2">
              <span className="h-8 w-8 rounded-full border-2 border-slate-950 bg-indigo-300" />
              <span className="h-8 w-8 rounded-full border-2 border-slate-950 bg-teal-300" />
              <span className="h-8 w-8 rounded-full border-2 border-slate-950 bg-amber-300" />
            </span>
            Built for placement teams, managers, and leadership
          </div>
        </div>
        <p className="relative text-xs text-slate-500">Secure access for your placement workspace</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <GraduationCap size={22} />
            </div>
            <span className="font-bold">PlacementOS</span>
          </div>
          <p className="text-sm font-semibold text-indigo-600">Welcome back</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Sign in to your account</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">Use the credentials provided by your platform administrator.</p>

          <form className="mt-8 space-y-5" onSubmit={(event) => void onSubmit(event)}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Work email</span>
              <span className="relative block">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input
                  autoComplete="username"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                  placeholder="you@company.com"
                  type="email"
                  {...register("email")}
                />
              </span>
              {errors.email && <span className="mt-1.5 block text-xs text-rose-600">{errors.email.message}</span>}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <span className="relative block">
                <LockKeyhole className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input
                  autoComplete="current-password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                  placeholder="Enter your password"
                  type="password"
                  {...register("password")}
                />
              </span>
              {errors.password && <span className="mt-1.5 block text-xs text-rose-600">{errors.password.message}</span>}
            </label>

            {submitError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            )}

            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting && <LoaderCircle className="animate-spin" size={17} />}
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-center text-xs leading-5 text-slate-400">
            Need access? Contact your platform administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
