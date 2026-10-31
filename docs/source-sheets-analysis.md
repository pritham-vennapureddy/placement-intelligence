# Source sheets analysis

Reviewed 2026-10-31 from three downloaded workbooks supplied by the PSM team. This file records **structure only**: no candidate names, contacts or links are copied here, and the workbooks themselves are not stored in the repository.

| Workbook | What it is | Maps to |
|---|---|---|
| `_8lpa work tracker` | PSM task log per job request, per-PSM copies, incentive and monthly performance dashboards | `JobRequest`, `PsmTask`, `JobContribution`, `GuidanceSession`, incentive rules, monthly targets |
| `Asama.ai :: Internal :: <date>` | One company drive's internal screening: eligible pool, applications, resume scoring, TA / SC / SP stage tabs | `Candidate`, `Application`, `ResumeAssessment`, `InternalStageCandidate` |
| `<Company>: Candidate Profiles :: NxtWave` | The sheet shared with the company: one tab per role, candidate details and one column per company round | `CompanyNomination`, `CompanyInterviewRound`, `CompanyInterview` |

## 1. PSM work tracker

### `mainsheet` (the master) and per-PSM tabs

Each per-PSM tab (pritham, vinay, pramod, venkat, vijaya lakshmi, pradeep) has the same 49 columns as `mainsheet`, with a title block and the header on row 6.

**One row is one task on a job, not one job.** `mainsheet` has 12 rows for 5 Job IDs.

| Columns | Meaning | Platform home |
|---|---|---|
| Job ID (`CMP-104`) | PSM-entered job code | `JobRequest.jobId` |
| Product | Holds role names (Data Analyst, QA Automation Engineer…) | `JobRequest.roleTitle` (see question Q3) |
| Company Name, Hubspot Link | Company | `Company.name`, `Company.hubspotCompanyId` |
| PC, CRM (`PC-04`, `CRM-04`) | Unknown codes | Question Q4 |
| Tech Stack (`SQL / Python / BI`) | Slash-separated skills | `JobRequestSkill` |
| Company remarks, Timeline (Immediate / 1 Week / 2 Weeks), Proposed Shortlisting Mechanism, No of Profiles Required | Job brief | `JobRequest` fields |
| Openings, Selects, Drive Status (Active / Completed) | Job outcome | `JobRequest.openings`, `status`; selects are **derived** from candidate outcomes |
| Company Sheet, Internal Sheet, which subsheets… | Links to working sheets | `JobRequest.companySheetUrl`, `internalSheetUrl` |
| Date & time, Task Done by, Input / Output candidates count, academy / intensive / external / assesed counts, Shortlisting Criteria followed, Task Delivered time and date, TAT (in hours), TAT (Remarks), Completion Status, Remarks | One task | `PsmTask`; TAT is computed from the two timestamps |
| Resume Shortlisting + Shortlisted Count, Screening Status + Screened Count | Stage progress | `InternalProcessStage.status`; counts derived from `InternalStageCandidate` |
| Screened By (Primary / Secondary), Guidance Session, Guidance Taken By (Primary / Secondary) | Who contributed | `JobContribution`, `GuidanceSession` |
| Assignment Round, TR1 Round, TR2 Round, HR Round, Final Selects (Cleared / In Progress / Pending / Completed) | Company round progress, job level | `CompanyInterviewRound` + outcomes per candidate |
| Master Sheet Updated?, Last Activity Date, Remarks / Next Steps | Housekeeping | Replaced by the platform's audit trail; next steps → `FollowUp` |

### `incentivesheet` and `October 2026` (monthly)

These sheets contain formulas over `mainsheet`. The rules they encode:

- **Direct selects** = sum of `Selects` on rows where the PSM is `Task Done by`, credited at 100 %.
- **Guidance selects** = sum of `Selects` where the PSM is `Guidance Taken By (Primary)`, credited at 20 %.
- **Screening selects** = sum of `Selects` where the PSM is `Screened By (Primary)`, credited at 25 %.
- **Incentive score** = direct + 0.20 × guidance + 0.25 × screening.
- **Tier**: ≥ 15 Tier 1 (High Impact), ≥ 10 Tier 2 (Core Contributor), ≥ 5 Tier 3 (Active Support), > 0 Tier 4 (Developing), else Onboarding.
- **Monthly target** per PSM (25 / 30 / 25 / 20); **achievement** = score ÷ target; ≥ 120 % Exceeded, ≥ 100 % Achieved, ≥ 80 % On Track, else In Progress.
- The monthly sheet filters `mainsheet` rows by `Date & time` within the month.

**Double counting in the current sheet.** Because one job appears on several task rows, the formulas add the same job's openings and selects more than once. The sample sums to 104 openings and 81 selects, but the 5 unique jobs have 43 openings and 33 selects. The platform will count selects once per selected candidate and credit contributors per job.

## 2. Internal screening workbook (one per company drive)

| Tab | Rows | Content | Platform home |
|---|---|---|---|
| Eligible Students | ~18.9k | `user_id`, name, mobile, alternate mobile, email, skills, `product` | Candidate pool and products; not applications |
| Applied Users | 940 | Applied Datetime, User Id, **Job Id (platform UUID)**, Product, gender, location, education (bachelors, masters, 12th, 10th %), Resume Link | `Application` (TA) + candidate profile |
| Form Responses 1 | 211 | Company-specific Google Form: UID, interest, work experience, internships, full-time roles, notice period, GitHub, coding profile, resume | Candidate profile, `CandidateExperience`, application answers |
| tool | 1.1k | Resume analysis per candidate: skills / projects / experience / certification / education / summary, each with a 0–1 score, project titles, latest company, analysis time | `ResumeAssessment` |
| TA | 1.1k | Mobile, resume, product, name (FILTER of Applied Users), no header | Stage TA |
| SC | 28 | mobile, resume, priority `P1/P2/P3`, resume decision `c / reject / hold`, email **or** a reason in the same column, `tech` and `comm` scores (1–5), screening `status` consider / reject / hold, remark | RS outcome + SC outcome |
| SP | 6 | mobile, resume, priority | Stage SP |

Observations:

- **Candidate key.** `user_id` (UUID) is the platform candidate ID. The stage tabs (TA / SC / SP) only carry the **mobile number**, so imports match stage rows to candidates by mobile.
- **Email and mobile are not unique per candidate.** In Eligible Students, 175 emails and 177 mobiles belong to more than one `user_id`. This conflicts with decision D1 (email unique).
- **Candidates can have more than one product.** 30 users appear with two products (e.g. `CCBP_INTENSIVE` + `External`). Products seen: `CCBP_ACADEMY_SMART`, `CCBP_ACADEMY_GENIUS`, `CCBP_ACADEMY_EDGE`, `CCBP_ACADEMY_SMART_CAREER_PLUS`, `CCBP_ACADEMY_GENIUS_CAREER_PLUS`, `CCBP_INTENSIVE`, `CCBP_INTENSIVE_NSDC_SKILL_INDIA`, `INTENSIVE_COLLEGE_PLUS`, `External`. Category (Academy / Intensive / External) follows from the product code.
- **One job draws applicants from many products**, so product belongs to the candidate and to each application (as it was when they applied), not to the job.
- **Two job identifiers.** Applied Users carries a platform Job Id (UUID); the tracker uses `CMP-xxx`.
- **Stages without their own tab.** There is no RS tab (the resume decision sits in SC column D) and no AS tab, as expected from the requirements.
- **2,339 users appear on more than one row** of Eligible Students; all but 30 are exact repeats.
- **140 of 940 applicants** are not in Eligible Students.
- **Mixed column** in SC: one column holds either an email or a rejection reason (`no projects`, `resume not good`, `no github`).
- Academic scores mix percentages and CGPA in the same column; some percentages are `0`.

## 3. Company candidate-profiles workbook

One tab per role (`AIML Engineer`, `MERN Developer`). Columns: Full Name, Mobile Number, Email Id, Bachelors Course / Department / Year / Percentage, Resume, then one column per company round (`Screening Round`, `TR Round 1`, `MR Round`, `Final Status`), all still empty.

- No Candidate ID and no Job ID: rows are matched by email / mobile, and the job by company + tab (role).
- The round columns differ per company. This confirms that rounds are configured per job request.
- One mobile number appears on two rows of the same tab.

## 4. Design changes this implies

1. `JobRequest`: drop the single required product; add the optional platform Job Id, timeline, proposed shortlisting mechanism, company remarks, sheet links; optionally the products eligible to apply.
2. `Product`: holds the product codes above, each with a category (Academy / Intensive / External).
3. `Candidate`: `candidateCode` = platform `user_id`; email and mobile **indexed, not unique**. Probable duplicates are raised as data-quality issues. Products many-to-many with first-seen dates.
4. `Application`: records the candidate's product at the time of applying.
5. Candidate profile detail: `CandidateEducation` (10th, 12th / diploma, bachelors, masters, with score type percentage or CGPA) and `CandidateExperience` (internship / full-time).
6. `ResumeAssessment`: imported scores from the resume-analysis tool.
7. `InternalStageCandidate`: add priority (P1–P3), technical and communication scores.
8. PSM operations: `PsmTask`, `JobContribution` (lead owner, primary / secondary screener, primary / secondary guidance), `GuidanceSession`.
9. Incentives: `IncentiveRule` (role → weight, effective dates), tier and target-status thresholds as configuration, `PsmMonthlyTarget`. Scores are computed from candidate outcomes and contributions, never stored as the source of truth.
