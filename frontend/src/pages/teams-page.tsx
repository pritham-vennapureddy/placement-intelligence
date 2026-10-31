import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus, Users } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../contexts/auth-context";
import { teamsApi } from "../services/api";
import type { TeamRecord } from "../types/api";

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{message}</p>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function TeamCard({ team, editable, onSave }: {
  team: TeamRecord;
  editable: boolean;
  onSave: (team: TeamRecord, teamLeadId: string | null, psmIds: string[]) => void;
}) {
  const { data: users = [] } = useQuery({
    queryKey: ["teams", "users"],
    queryFn: teamsApi.listUsers,
    enabled: editable,
  });
  const [teamLeadId, setTeamLeadId] = useState(team.teamLeadId ?? "");
  const [psmIds, setPsmIds] = useState(team.members
    .filter((member) => member.roles.some(({ role }) => role.code === "PSM"))
    .map(({ id }) => id));
  const managers = users.filter((user) => user.roles.some(({ role }) => role.code === "MANAGER"));
  const psms = users.filter((user) => user.roles.some(({ role }) => role.code === "PSM"));

  return (
    <Card>
      <CardContent className="p-5">
        <CardHeader className="mb-4">
          <div>
            <CardTitle>{team.name}</CardTitle>
            <p className="mt-1 text-xs text-slate-400">{team.members.length} members · {team._count.sheetConnections} sheet connections</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Users size={17} /></span>
        </CardHeader>
        {editable ? (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-slate-600">
              Team lead
              <select value={teamLeadId} onChange={(event) => setTeamLeadId(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <option value="">No team lead assigned</option>
                {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName} · {manager.email}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              PSM members
              <select multiple value={psmIds} onChange={(event) => setPsmIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="mt-1.5 min-h-28 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm">
                {psms.map((psm) => <option key={psm.id} value={psm.id}>{psm.fullName} · {psm.email}</option>)}
              </select>
              <span className="mt-1 block font-normal text-slate-400">Use Ctrl or Command to select multiple PSMs. Each PSM can belong to one team.</span>
            </label>
            <Button size="sm" onClick={() => onSave(team, teamLeadId || null, psmIds)}>Save team assignments</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Team lead</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{team.teamLead?.fullName ?? "Not assigned"}</p>
            </div>
            {team.members.map((member) => <div key={member.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
              <div><p className="text-sm font-medium text-slate-700">{member.fullName}</p><p className="text-xs text-slate-400">{member.email}</p></div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{member.roles.map(({ role }) => role.code).join(", ")}</span>
            </div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MANAGER" | "PSM">("PSM");
  const [teamId, setTeamId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: teamsApi.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["teams"] });
  const createTeam = useMutation({ mutationFn: (name: string) => teamsApi.create(name), onSuccess: refresh });
  const createUser = useMutation({ mutationFn: (input: Parameters<typeof teamsApi.createUser>[0]) => teamsApi.createUser(input), onSuccess: refresh });
  const saveTeam = useMutation({
    mutationFn: ({ team, teamLeadId, psmIds }: { team: TeamRecord; teamLeadId: string | null; psmIds: string[] }) =>
      teamsApi.updateMembers(team.id, { teamLeadId, psmIds }),
    onSuccess: refresh,
  });
  const teams = teamsQuery.data ?? [];
  const selectedTeamOptions = useMemo(() => teams.map(({ id, name }) => ({ id, name })), [teams]);

  const handleCreateTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await createTeam.mutateAsync(teamName);
      setTeamName("");
    } catch (error) {
      setFormError(messageOf(error));
    }
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await createUser.mutateAsync({
        email,
        fullName,
        password,
        role,
        ...(teamId ? { teamId } : {}),
      });
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("PSM");
      setTeamId("");
    } catch (error) {
      setFormError(messageOf(error));
    }
  };

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card><CardContent className="p-5">
            <CardHeader className="mb-4"><div><CardTitle>Create a team</CardTitle><p className="mt-1 text-xs text-slate-400">Teams group PSMs under a team lead.</p></div><Plus className="text-indigo-500" size={18} /></CardHeader>
            <form onSubmit={(event) => void handleCreateTeam(event)} className="flex flex-col gap-3 sm:flex-row">
              <input required minLength={2} maxLength={80} value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Enterprise placements" className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
              <Button type="submit" disabled={createTeam.isPending}>{createTeam.isPending ? "Creating…" : "Create team"}</Button>
            </form>
          </CardContent></Card>
          <Card><CardContent className="p-5">
            <CardHeader className="mb-4"><div><CardTitle>Create a team account</CardTitle><p className="mt-1 text-xs text-slate-400">The admin sets and privately shares the initial password.</p></div><Users className="text-indigo-500" size={18} /></CardHeader>
            <form onSubmit={(event) => void handleCreateUser(event)} className="grid gap-3 sm:grid-cols-2">
              <input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Full name" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
              <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Work email" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
              <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Initial password (12+ characters)" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
              <select value={role} onChange={(event) => setRole(event.target.value as "MANAGER" | "PSM")} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <option value="PSM">PSM</option><option value="MANAGER">Team lead</option>
              </select>
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm sm:col-span-2">
                <option value="">{role === "PSM" ? "Select team for PSM" : "Assign team now (optional)"}</option>
                {selectedTeamOptions.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <div className="sm:col-span-2"><Button type="submit" disabled={createUser.isPending || (role === "PSM" && !teamId)}>{createUser.isPending ? "Creating account…" : "Create account"}</Button></div>
            </form>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">Passwords are stored as bcrypt hashes. They are never returned by the API or shown again after submission.</p>
          </CardContent></Card>
        </div>
      )}

      <ErrorMessage message={formError ?? (createTeam.error ? messageOf(createTeam.error) : createUser.error ? messageOf(createUser.error) : saveTeam.error ? messageOf(saveTeam.error) : null)} />
      {teamsQuery.isError && <ErrorMessage message={messageOf(teamsQuery.error)} />}
      {teamsQuery.isPending && <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />}
      {!teamsQuery.isPending && !teamsQuery.isError && teams.length === 0 && <Card><CardContent className="p-8 text-center"><Users className="mx-auto text-slate-300" size={26} /><p className="mt-3 text-sm font-semibold text-slate-700">No team assigned</p><p className="mt-1 text-xs text-slate-500">{isAdmin ? "Create your first team to start assigning PSMs." : "Ask an administrator to assign you to a team."}</p></CardContent></Card>}
      <section className="grid gap-5 xl:grid-cols-2">
        {teams.map((team) => <TeamCard key={team.id} team={team} editable={isAdmin} onSave={(target, teamLeadId, psmIds) => saveTeam.mutate({ team: target, teamLeadId, psmIds })} />)}
      </section>
      {!isAdmin && teams.length > 0 && <p className="flex items-center gap-2 text-xs text-slate-500"><BriefcaseBusiness size={14} /> Your team workspace is limited to this team&apos;s members and assigned work.</p>}
    </div>
  );
}
