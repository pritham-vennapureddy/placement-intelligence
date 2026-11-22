import { request } from "./api";

export interface RejectionReason {
  id: string;
  label: string;
  builtIn: boolean;
  sortOrder: number;
  /** Set when the reason was removed from the dropdown; old results keep it. */
  archivedAt: string | null;
  inUse?: number;
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

/** The company-round rejection reason list (built-in reasons plus the team's own). */
export const rejectionReasonsApi = {
  async list(): Promise<RejectionReason[]> {
    return (await request<{ data: { reasons: RejectionReason[] } }>("/rejection-reasons")).data.reasons;
  },
  async create(label: string): Promise<RejectionReason> {
    return (await request<{ data: { reason: RejectionReason } }>("/rejection-reasons", json("POST", { label }))).data.reason;
  },
  async rename(id: string, label: string): Promise<RejectionReason> {
    return (await request<{ data: { reason: RejectionReason } }>(`/rejection-reasons/${id}`, json("PATCH", { label }))).data.reason;
  },
  async remove(id: string): Promise<void> {
    await request(`/rejection-reasons/${id}`, { method: "DELETE" });
  },
};
