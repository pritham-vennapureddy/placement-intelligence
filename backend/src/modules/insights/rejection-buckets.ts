/**
 * Internal rejection reasons are free text typed in the sheets. Stakeholder
 * reviews want them grouped into a few macro reasons; the first rule that
 * matches wins, so the more specific groups come first.
 */
export const REJECTION_BUCKETS = [
  "Did not attend / no response",
  "Not interested / withdrew",
  "Eligibility (academics, batch, location)",
  "Communication",
  "Technical / coding",
  "Aptitude / test score",
  "Resume / profile fit",
  "Attitude / seriousness",
  "Other",
  "Reason not recorded",
] as const;
export type RejectionBucket = (typeof REJECTION_BUCKETS)[number];

const RULES: [RejectionBucket, RegExp][] = [
  ["Did not attend / no response", /no[\s-]?show|not\s+(attend|join|turn|pick|respond|reachable|available)|absent|did\s*n[o']?t\s+(attend|join|come|appear|respond|turn)|unreachable|no\s+response|not\s+responding|didn.?t\s+pick|missed/i],
  ["Not interested / withdrew", /not\s+interested|withdr[ae]w|opted?\s+out|declin|backed\s+out|dropped|not\s+willing/i],
  ["Eligibility (academics, batch, location)", /cgpa|gpa|percent|%|backlog|arrear|year\s+of|pass\s*-?\s*out|batch|eligib|graduat|degree|branch|stream|location|relocat|\bage\b|gap/i],
  ["Communication", /communicat|english|fluen|articulat|spoken|verbal|confiden|express/i],
  ["Technical / coding", /tech|coding|code|dsa|algorithm|logic|problem[\s-]?solv|concept|fundamental|sql|python|java|react|node|programming|\bskill|knowledge|depth|debug/i],
  ["Aptitude / test score", /aptitude|score|test|assessment|marks|cut[\s-]?off|mcq|quant|reasoning|low\s+in/i],
  ["Resume / profile fit", /resume|\bcv\b|profile|project|experience|mismatch|not\s+(relevant|suitable|matching|a\s+fit)|requirement|portfolio|github/i],
  ["Attitude / seriousness", /attitude|behaviou?r|professional|serious|commitment|interest|discipline|punctual/i],
];

export function bucketRejectionReason(reason: string | null | undefined): RejectionBucket {
  const text = reason?.trim();
  if (!text) return "Reason not recorded";
  for (const [bucket, pattern] of RULES) if (pattern.test(text)) return bucket;
  return "Other";
}
