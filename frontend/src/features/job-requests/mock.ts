// PREVIEW DATA ONLY — fictional job requests used to build the Job requests
// screen before the Phase 2 API exists. Never mixed with live data.

export type JobRequestStatus = "DRAFT" | "OPEN" | "ON_HOLD" | "FILLED" | "CANCELLED" | "CLOSED";

export interface JobRequestPreviewRow {
  id: string;
  jobId: string;
  company: string;
  roleTitle: string;
  product: string;
  techStack: string[];
  openings: number;
  requiredCandidates: number;
  psmOwner: string;
  requestDate: string;
  deadline: string | null;
  status: JobRequestStatus;
}

export const jobRequestPreviewRows: JobRequestPreviewRow[] = [
  { id: "j1", jobId: "JR-2026-0141", company: "Northwind Analytics", roleTitle: "Data Analyst", product: "Data Analytics", techStack: ["SQL", "Python", "Power BI"], openings: 3, requiredCandidates: 15, psmOwner: "Ananya Rao", requestDate: "2026-10-06", deadline: "2026-11-10", status: "OPEN" },
  { id: "j2", jobId: "JR-2026-0142", company: "Bluepeak Fintech", roleTitle: "Backend Developer (Node.js)", product: "Full Stack Development", techStack: ["Node.js", "PostgreSQL"], openings: 2, requiredCandidates: 10, psmOwner: "Rahul Menon", requestDate: "2026-10-08", deadline: "2026-11-05", status: "OPEN" },
  { id: "j3", jobId: "JR-2026-0143", company: "Lattice Commerce", roleTitle: "Frontend Developer", product: "Full Stack Development", techStack: ["React", "TypeScript"], openings: 4, requiredCandidates: 20, psmOwner: "Vikram Iyer", requestDate: "2026-10-09", deadline: "2026-11-15", status: "OPEN" },
  { id: "j4", jobId: "JR-2026-0144", company: "Kestrel Health Systems", roleTitle: "QA Automation Engineer", product: "QA Automation", techStack: ["Selenium", "Java"], openings: 2, requiredCandidates: 8, psmOwner: "Sneha Kulkarni", requestDate: "2026-10-12", deadline: "2026-11-20", status: "ON_HOLD" },
  { id: "j5", jobId: "JR-2026-0145", company: "Cobalt Cloud Services", roleTitle: "Cloud Support Associate", product: "Full Stack Development", techStack: ["Linux", "AWS"], openings: 3, requiredCandidates: 12, psmOwner: "Sneha Kulkarni", requestDate: "2026-10-14", deadline: null, status: "OPEN" },
  { id: "j6", jobId: "JR-2026-0146", company: "Arcadia Retail Labs", roleTitle: "Business Analyst", product: "Data Analytics", techStack: ["Excel", "SQL"], openings: 2, requiredCandidates: 10, psmOwner: "Sneha Kulkarni", requestDate: "2026-10-15", deadline: "2026-11-08", status: "OPEN" },
  { id: "j7", jobId: "JR-2026-0131", company: "Orbit Logistics Tech", roleTitle: "Full Stack Developer", product: "Full Stack Development", techStack: ["React", "Node.js", "MongoDB"], openings: 3, requiredCandidates: 12, psmOwner: "Rahul Menon", requestDate: "2026-09-22", deadline: "2026-10-25", status: "FILLED" },
  { id: "j8", jobId: "JR-2026-0147", company: "Tidewater Mobility", roleTitle: "Embedded Software Trainee", product: "Full Stack Development", techStack: ["C++", "Python"], openings: 4, requiredCandidates: 16, psmOwner: "Rahul Menon", requestDate: "2026-10-20", deadline: "2026-12-01", status: "OPEN" },
  { id: "j9", jobId: "JR-2026-0148", company: "Meridian Insurance Digital", roleTitle: "Data Engineer", product: "Data Analytics", techStack: ["Python", "Spark", "SQL"], openings: 1, requiredCandidates: 6, psmOwner: "Ananya Rao", requestDate: "2026-10-21", deadline: "2026-11-30", status: "DRAFT" },
  { id: "j10", jobId: "JR-2026-0125", company: "Saffron EdTech", roleTitle: "Content Developer", product: "Data Analytics", techStack: ["Python"], openings: 2, requiredCandidates: 8, psmOwner: "Vikram Iyer", requestDate: "2026-09-02", deadline: "2026-09-30", status: "CANCELLED" },
  { id: "j11", jobId: "JR-2026-0149", company: "Lattice Commerce", roleTitle: "SDET", product: "QA Automation", techStack: ["Playwright", "TypeScript"], openings: 2, requiredCandidates: 10, psmOwner: "Vikram Iyer", requestDate: "2026-10-24", deadline: "2026-11-25", status: "OPEN" },
  { id: "j12", jobId: "JR-2026-0150", company: "Bluepeak Fintech", roleTitle: "Data Analyst", product: "Data Analytics", techStack: ["SQL", "Tableau"], openings: 2, requiredCandidates: 10, psmOwner: "Ananya Rao", requestDate: "2026-10-28", deadline: "2026-12-05", status: "OPEN" },
];
