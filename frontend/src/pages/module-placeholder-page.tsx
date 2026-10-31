import { Construction } from "lucide-react";
import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/states";
import { Card } from "../components/ui/card";

export interface ModuleOutline {
  eyebrow: string;
  title: string;
  description: string;
  phase: number;
  capabilities: string[];
}

/** Stand-in for modules scheduled in later phases. */
export function ModulePlaceholderPage({ module }: { module: ModuleOutline }) {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={module.eyebrow} title={module.title} description={module.description} />
      <Card>
        <EmptyState
          icon={Construction}
          title={`Planned for Phase ${module.phase}`}
          description="This module is not built yet. Here is what it will cover:"
        />
        <ul className="mx-auto grid max-w-2xl gap-2 px-6 pb-10 text-sm text-slate-600 sm:grid-cols-2">
          {module.capabilities.map((capability) => (
            <li key={capability} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              {capability}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export const MODULE_OUTLINES = {
  candidates: {
    eyebrow: "Placements",
    title: "Candidates",
    description: "Candidate profiles, categories, assessed-pool status and application history.",
    phase: 3,
    capabilities: [
      "Profiles with Candidate ID, college, degree and skills",
      "Academy, Academy Intensive and External categories",
      "Assessed pool: Yes, No or Unknown (never assumed)",
      "Separate history for every job request applied to",
      "Contact details visible only to permitted roles",
      "Classification change history",
    ],
  },
  screening: {
    eyebrow: "Placements",
    title: "Internal screening",
    description: "The PSM's TA → RS → SC → AS → SP shortlist for each job request.",
    phase: 3,
    capabilities: [
      "Stage status set explicitly, never inferred",
      "Candidate outcome, reason and remarks per stage",
      "Save progress candidate by candidate",
      "Shortlisting method recorded per job request",
      "Next planned date and stage owner",
      "Internally rejected candidates cannot be nominated",
    ],
  },
  pipeline: {
    eyebrow: "Placements",
    title: "Company pipeline",
    description: "Company-side interview rounds, offers and joining for nominated candidates.",
    phase: 4,
    capabilities: [
      "Configurable rounds per job request",
      "Interview dates, interviewer and feedback",
      "Selected, offer released, offer accepted and joined tracked separately",
      "Full stage history per candidate",
    ],
  },
  psmOperations: {
    eyebrow: "Operations",
    title: "PSM operations",
    description: "Ownership, tasks, follow-ups and company coordination.",
    phase: 6,
    capabilities: [
      "Job request ownership history",
      "Tasks, delivery dates and turnaround time",
      "Company activities and follow-ups",
      "Guidance sessions and screening contributions",
    ],
  },
  rsa: {
    eyebrow: "Operations",
    title: "RSA & homework",
    description: "Skill assessments, gaps, homework and mentor feedback.",
    phase: 6,
    capabilities: [
      "RSA assessments and skill-gap identification",
      "Homework assignment and submission tracking",
      "Mentor feedback and improvement history",
      "Ready for WhatsApp and Google Forms channels",
    ],
  },
  imports: {
    eyebrow: "Data",
    title: "Import centre",
    description: "Excel, CSV and Google Sheets imports with review before anything is saved.",
    phase: 5,
    capabilities: [
      "Worksheet detection and preview",
      "Column mapping and TA/RS/SC/AS/SP sheet mapping",
      "Duplicate detection and validation errors",
      "Human approval before saving",
      "Job ID used to match job requests",
      "Rows missing from a source are flagged, never deleted",
    ],
  },
  reports: {
    eyebrow: "Data",
    title: "Reports",
    description: "Funnels, conversion and performance reports with Excel and CSV export.",
    phase: 6,
    capabilities: [
      "Internal screening and company hiring funnels",
      "PSM, company, product and tech-stack performance",
      "Assessed-pool analytics",
      "Monthly reports with Excel/CSV export",
    ],
  },
} satisfies Record<string, ModuleOutline>;
