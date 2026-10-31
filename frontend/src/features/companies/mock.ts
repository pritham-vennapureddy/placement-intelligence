// PREVIEW DATA ONLY — fictional companies used to build the Companies screen
// before the Phase 2 API exists. Never mixed with live data.

export interface CompanyPreviewRow {
  id: string;
  name: string;
  hubspotCompanyId: string | null;
  industry: string;
  location: string;
  status: "ACTIVE" | "INACTIVE";
  openJobRequests: number;
  openPositions: number;
  psmOwners: string[];
  lastActivity: string;
}

export const companyPreviewRows: CompanyPreviewRow[] = [
  { id: "c1", name: "Northwind Analytics", hubspotCompanyId: "18734201", industry: "Data & analytics", location: "Bengaluru", status: "ACTIVE", openJobRequests: 3, openPositions: 7, psmOwners: ["Ananya Rao"], lastActivity: "2026-10-29" },
  { id: "c2", name: "Bluepeak Fintech", hubspotCompanyId: "18734377", industry: "Financial services", location: "Hyderabad", status: "ACTIVE", openJobRequests: 2, openPositions: 4, psmOwners: ["Rahul Menon", "Ananya Rao"], lastActivity: "2026-10-30" },
  { id: "c3", name: "Kestrel Health Systems", hubspotCompanyId: null, industry: "Healthcare technology", location: "Chennai", status: "ACTIVE", openJobRequests: 1, openPositions: 2, psmOwners: ["Sneha Kulkarni"], lastActivity: "2026-10-24" },
  { id: "c4", name: "Lattice Commerce", hubspotCompanyId: "18735012", industry: "E-commerce", location: "Pune", status: "ACTIVE", openJobRequests: 4, openPositions: 11, psmOwners: ["Vikram Iyer"], lastActivity: "2026-10-31" },
  { id: "c5", name: "Orbit Logistics Tech", hubspotCompanyId: "18735144", industry: "Logistics", location: "Gurugram", status: "ACTIVE", openJobRequests: 1, openPositions: 3, psmOwners: ["Rahul Menon"], lastActivity: "2026-10-18" },
  { id: "c6", name: "Saffron EdTech", hubspotCompanyId: null, industry: "Education", location: "Hyderabad", status: "INACTIVE", openJobRequests: 0, openPositions: 0, psmOwners: [], lastActivity: "2026-08-02" },
  { id: "c7", name: "Cobalt Cloud Services", hubspotCompanyId: "18736020", industry: "Cloud infrastructure", location: "Bengaluru", status: "ACTIVE", openJobRequests: 2, openPositions: 5, psmOwners: ["Sneha Kulkarni", "Vikram Iyer"], lastActivity: "2026-10-27" },
  { id: "c8", name: "Meridian Insurance Digital", hubspotCompanyId: "18736233", industry: "Insurance", location: "Mumbai", status: "ACTIVE", openJobRequests: 1, openPositions: 1, psmOwners: ["Ananya Rao"], lastActivity: "2026-10-21" },
  { id: "c9", name: "Tidewater Mobility", hubspotCompanyId: null, industry: "Automotive software", location: "Chennai", status: "ACTIVE", openJobRequests: 2, openPositions: 6, psmOwners: ["Rahul Menon"], lastActivity: "2026-10-28" },
  { id: "c10", name: "Quillstone Media", hubspotCompanyId: "18737001", industry: "Digital media", location: "Noida", status: "ACTIVE", openJobRequests: 1, openPositions: 2, psmOwners: ["Vikram Iyer"], lastActivity: "2026-10-12" },
  { id: "c11", name: "Arcadia Retail Labs", hubspotCompanyId: "18737118", industry: "Retail technology", location: "Bengaluru", status: "ACTIVE", openJobRequests: 3, openPositions: 8, psmOwners: ["Sneha Kulkarni"], lastActivity: "2026-10-30" },
  { id: "c12", name: "Helix Biotech Informatics", hubspotCompanyId: null, industry: "Life sciences", location: "Hyderabad", status: "ACTIVE", openJobRequests: 1, openPositions: 1, psmOwners: ["Ananya Rao"], lastActivity: "2026-10-09" },
];
