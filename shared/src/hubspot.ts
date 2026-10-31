// HubSpot record references. PSMs paste either a record link such as
// https://app.hubspot.com/contacts/<portal>/record/0-3/<id> or the bare numeric ID.

export const HUBSPOT_OBJECT = {
  company: "0-2",
  deal: "0-3",
} as const;
export type HubspotObject = keyof typeof HUBSPOT_OBJECT;

/**
 * Returns the numeric record ID, or null when the input is neither a bare ID
 * nor a link to a record of the expected type.
 */
export function parseHubspotRecordId(input: string, object: HubspotObject): string | null {
  const value = input.trim();
  if (/^\d{1,20}$/.test(value)) {
    return value;
  }
  const match = /\/record\/(\d+-\d+)\/(\d{1,20})(?:[/?#]|$)/.exec(value);
  if (!match || match[1] !== HUBSPOT_OBJECT[object]) {
    return null;
  }
  return match[2] ?? null;
}

export function hubspotRecordUrl(portalId: string, object: HubspotObject, recordId: string): string {
  return `https://app.hubspot.com/contacts/${portalId}/record/${HUBSPOT_OBJECT[object]}/${recordId}`;
}
