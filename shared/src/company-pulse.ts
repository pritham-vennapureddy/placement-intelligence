// Monthly potential-company list, CRM remarks and RSA: shared by the API and the UI.

export const POTENTIAL_COMPANY_STATUSES = [
  "POTENTIAL",
  "IN_DISCUSSION",
  "CONFIRMED",
  "PROCESS_STARTED",
  "ON_HOLD",
  "NO_RESPONSE",
  "DROPPED",
] as const;
export type PotentialCompanyStatus = (typeof POTENTIAL_COMPANY_STATUSES)[number];

export const POTENTIAL_COMPANY_STATUS_LABELS: Record<PotentialCompanyStatus, string> = {
  POTENTIAL: "Potential",
  IN_DISCUSSION: "In discussion",
  CONFIRMED: "Confirmed for this month",
  PROCESS_STARTED: "Process started",
  ON_HOLD: "On hold",
  NO_RESPONSE: "No response",
  DROPPED: "Dropped",
};

/** Still alive in the month: counted in "in pipeline" and carried forward by default. */
export const ACTIVE_POTENTIAL_STATUSES: readonly PotentialCompanyStatus[] = ["POTENTIAL", "IN_DISCUSSION", "CONFIRMED", "PROCESS_STARTED", "ON_HOLD"];
/** Counted as "will start / started the process this month". */
export const STARTING_POTENTIAL_STATUSES: readonly PotentialCompanyStatus[] = ["CONFIRMED", "PROCESS_STARTED"];

export const CRM_CHANNELS = ["CALL", "EMAIL", "MEETING", "WHATSAPP", "OTHER"] as const;
export type CrmChannel = (typeof CRM_CHANNELS)[number];

export const CRM_CHANNEL_LABELS: Record<CrmChannel, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  WHATSAPP: "WhatsApp",
  OTHER: "Other",
};

/** "2026-11" → true. */
export const isMonthKey = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The month after "2026-12" is "2027-01". */
export function nextMonthKey(month: string): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
}
