import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Trash2, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useAuth } from "../contexts/auth-context";
import { usersApi, type UserRoleCode } from "../services/api";
import type { UserAccessRecord } from "../types/api";

const roleLabels: Record<UserRoleCode, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAKEHOLDER: "Stakeholder",
  EMPLOYEE: "Employee",
};

const inputClass = "h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 14 random characters without look-alikes, from the browser's secure generator. */
function generatePassword(length = 14): string {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (value) => ALPHABET[value % ALPHABET.length]).join("");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

const roleOf = (user: UserAccessRecord) => (user.roles[0]?.role.code ?? "EMPLOYEE") as UserRoleCode;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy. Select the text and copy it manually.");
  }
}

/** Password input with show/hide and a generate button. */
function PasswordField({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          id={id}
          required
          type={visible ? "text" : "password"}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Password (12+ characters)"
          className={`${inputClass} pr-10 font-mono`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700"
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <Button type="button" variant="outline" onClick={() => { onChange(generatePassword()); setVisible(true); }} title="Generate a strong password">
        <Wand2 size={14} /> Generate
      </Button>
    </div>
  );
}

/** Shows a password once, right after it was set, so the admin can pass it on. */
function PasswordReveal({ title, email, password, onClose }: { title: string; email: string; password: string | null; onClose: () => void }) {
  return (
    <Dialog open={password !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Share these sign-in details with the user. The password is shown only now; after you close this, use Reset password to set a new one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</p>
            <p className="mt-1 break-all text-sm text-slate-800">{email}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Password</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="break-all text-base font-semibold text-slate-900">{password}</code>
              <Button size="sm" variant="outline" onClick={() => password && void copy(password)}><Copy size={13} /> Copy</Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy(`Email: ${email}\nPassword: ${password}`)}><Copy size={13} /> Copy both</Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserAccessRecord | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRoleCode>("EMPLOYEE");
  useEffect(() => {
    if (user) { setFullName(user.fullName); setEmail(user.email); setRole(roleOf(user)); }
  }, [user]);
  const save = useMutation({
    mutationFn: () => usersApi.updateUser(user!.id, {
      ...(fullName.trim() !== user!.fullName ? { fullName: fullName.trim() } : {}),
      ...(email.trim().toLowerCase() !== user!.email ? { email: email.trim() } : {}),
      ...(role !== roleOf(user!) ? { role } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
      onClose();
    },
  });
  const unchanged = !user || (fullName.trim() === user.fullName && email.trim().toLowerCase() === user.email && role === roleOf(user));
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>A new role or email takes effect the next time they sign in.</DialogDescription>
        </DialogHeader>
        <form id="edit-user" className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Full name
            <input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} className={inputClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Work email
            <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Role
            <select value={role} onChange={(event) => setRole(event.target.value as UserRoleCode)} className={`${inputClass} bg-white`}>
              {Object.entries(roleLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
        </form>
        {save.error && <p role="alert" className="text-sm text-rose-600">{messageOf(save.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="edit-user" disabled={save.isPending || unchanged}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: UserAccessRecord | null; onClose: () => void; onDone: (password: string) => void }) {
  const [password, setPassword] = useState("");
  useEffect(() => { if (user) setPassword(generatePassword()); }, [user]);
  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user!.id, password),
    onSuccess: ({ password: saved }) => onDone(saved),
  });
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && !reset.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>{user?.fullName} will be signed out everywhere and must use the new password.</DialogDescription>
        </DialogHeader>
        <form id="reset-password" onSubmit={(event) => { event.preventDefault(); reset.mutate(); }}>
          <PasswordField id="reset-password-input" value={password} onChange={setPassword} />
        </form>
        {reset.error && <p role="alert" className="text-sm text-rose-600">{messageOf(reset.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reset.isPending}>Cancel</Button>
          <Button type="submit" form="reset-password" disabled={reset.isPending || password.length < 12}>{reset.isPending ? "Saving…" : "Set new password"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserAccessPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRoleCode>("EMPLOYEE");
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAccessRecord | null>(null);
  const [resetting, setResetting] = useState<UserAccessRecord | null>(null);
  const [deleting, setDeleting] = useState<UserAccessRecord | null>(null);
  const [revealed, setRevealed] = useState<{ title: string; email: string; password: string } | null>(null);

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: usersApi.list });
  const createUser = useMutation({
    mutationFn: (input: { fullName: string; email: string; password: string; role: UserRoleCode }) => usersApi.createUser(input),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setRevealed({ title: "Account created", email: input.email.toLowerCase(), password: input.password });
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("EMPLOYEE");
      setFormError(null);
    },
  });
  const deleteUser = useMutation({
    mutationFn: (userId: string) => usersApi.deleteUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted");
    },
  });

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await createUser.mutateAsync({ fullName, email, password, role });
    } catch (error) {
      setFormError(messageOf(error));
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-5">
          <CardHeader className="mb-4">
            <div>
              <CardTitle>Create a user account</CardTitle>
              <p className="mt-1 text-xs text-slate-400">Choose a role and set an initial password. All users share one workspace.</p>
            </div>
            <Users className="text-indigo-500" size={18} />
          </CardHeader>
          <form onSubmit={(event) => void handleCreateUser(event)} className="grid gap-3 sm:grid-cols-2">
            <input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Full name" className={inputClass} />
            <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Work email" className={inputClass} />
            <PasswordField id="new-user-password" value={password} onChange={setPassword} />
            <select value={role} onChange={(event) => setRole(event.target.value as UserRoleCode)} className={`${inputClass} bg-white`}>
              {Object.entries(roleLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
            <div className="sm:col-span-2"><Button type="submit" disabled={createUser.isPending}>{createUser.isPending ? "Creating account…" : "Create account"}</Button></div>
          </form>
          <p className="mt-3 text-[11px] leading-5 text-slate-400">Passwords are stored one-way (bcrypt), so a saved password can never be viewed again. You see it once after creating the account; after that, use Reset password.</p>
          {(formError ?? (createUser.error ? messageOf(createUser.error) : null)) && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError ?? messageOf(createUser.error)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <CardHeader className="mb-4"><div><CardTitle>Active users</CardTitle><p className="mt-1 text-xs text-slate-400">User access in the shared placement workspace.</p></div></CardHeader>
          {usersQuery.isError && <p role="alert" className="text-sm text-rose-600">{messageOf(usersQuery.error)}</p>}
          {usersQuery.isPending && <div className="h-28 animate-pulse rounded-xl bg-slate-100" />}
          {usersQuery.data && usersQuery.data.length === 0 && <p className="text-sm text-slate-500">No active users found.</p>}
          <div className="divide-y divide-slate-100">
            {usersQuery.data?.map((user) => {
              const isMe = user.id === me?.id;
              return (
                <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{user.fullName}{isMe && <span className="ml-2 text-[10px] font-normal text-slate-400">(you)</span>}</p>
                    <p className="break-all text-xs text-slate-400">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {user.roles.map(({ role: item }) => <span key={item.code} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{roleLabels[item.code as UserRoleCode] ?? item.code}</span>)}
                    <Button size="sm" variant="outline" onClick={() => setEditing(user)}><Pencil size={13} /> Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setResetting(user)}><KeyRound size={13} /> Reset password</Button>
                    {!isMe && <Button size="sm" variant="outline" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleting(user)}><Trash2 size={13} /> Delete</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(saved) => {
          if (resetting) setRevealed({ title: "Password reset", email: resetting.email, password: saved });
          setResetting(null);
        }}
      />
      <PasswordReveal title={revealed?.title ?? ""} email={revealed?.email ?? ""} password={revealed?.password ?? null} onClose={() => setRevealed(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.fullName ?? "this user"}?`}
        description="They are signed out and can no longer sign in. Their companies, job requests and history stay in the workspace. Creating an account with the same email later brings it back."
        confirmLabel="Delete user"
        destructive
        onConfirm={async () => { if (deleting) await deleteUser.mutateAsync(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}
