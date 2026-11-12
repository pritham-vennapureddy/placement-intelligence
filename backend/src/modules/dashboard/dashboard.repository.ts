import { prisma } from "../../db.js";
import { assumedSharedWhere, companySheetPendingSelect, isCompanySheetPending, shareStatusOf } from "../tracking/tracking.service.js";
import { companyProcessLabel, type DecisionStage, type StageOutcome } from "@placement/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import type { KpiJob } from "./placement-kpis.js";

/** Guidance / RSA status and every contributor's name (team members first, then outside names). */
function supportCell(row: { status: { label: string; tone: string }; doneOn: Date | null; otherContributors: string | null; contributors: { user: { fullName: string } }[] } | undefined) {
  if (!row) return null;
  return {
    status: row.status.label,
    tone: row.status.tone,
    doneOn: row.doneOn,
    contributors: [...row.contributors.map(({ user }) => user.fullName), ...(row.otherContributors ? [row.otherContributors] : [])],
  };
}

export const dashboardRepository = {
  /** Jobs that carry positions to fill (not draft or cancelled), with each live application's category and company outcome. */
  async placementKpiJobs(filter: Prisma.JobRequestWhereInput): Promise<KpiJob[]> {
    const jobs = await prisma.jobRequest.findMany({
      where: { ...filter, archivedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: {
        id: true,
        companyId: true,
        openings: true,
        requestDate: true,
        ctcLpa: true,
        company: { select: { name: true } },
        applications: {
          where: { status: { not: "WITHDRAWN" } },
          select: {
            product: { select: { category: true } },
            candidate: { select: { category: true } },
            nomination: { select: { status: true, pipelineStatus: true } },
          },
        },
      },
    });
    return jobs.map((job) => ({
      id: job.id,
      companyId: job.companyId,
      companyName: job.company.name,
      openings: job.openings,
      requestDate: job.requestDate,
      ctcLpa: job.ctcLpa,
      applications: job.applications.map((application) => ({
        productCategory: application.product?.category ?? null,
        candidateCategory: application.candidate.category,
        nomination: application.nomination,
      })),
    }));
  },

  /** Companies with at least one matching job request; every company when `filter` is null. */
  countCompanies(filter: Prisma.JobRequestWhereInput | null) {
    return prisma.company.count({ where: filter ? { jobRequests: { some: filter } } : {} });
  },

  async openRequestStats(filter: Prisma.JobRequestWhereInput) {
    const result = await prisma.jobRequest.aggregate({
      where: { ...filter, status: "OPEN" },
      _count: { _all: true },
      _sum: { openings: true },
    });
    return { activeJobRequests: result._count._all, openPositions: result._sum.openings ?? 0 };
  },

  countActiveEmployees(ownerIds?: string[]) {
    return prisma.user.count({
      where: {
        isActive: true,
        roles: { some: { role: { code: "EMPLOYEE" } } },
        ...(ownerIds ? { id: { in: ownerIds } } : {}),
      },
    });
  },

  async listCompaniesWithJobRequests(filter: Prisma.JobRequestWhereInput) {
    const [companies, applicationCounts] = await Promise.all([
      prisma.company.findMany({
        where: { jobRequests: { some: filter } },
        select: {
          id: true,
          name: true,
          jobRequests: {
            where: filter,
            select: {
              id: true,
              jobId: true,
              roleTitle: true,
              openings: true,
              status: true,
              processPhase: true,
              processPhaseAt: true,
              processRound: { select: { id: true, name: true } },
              interviewRounds: { select: { id: true, name: true }, orderBy: { sequence: "asc" } },
              psmOwner: { select: { id: true, fullName: true } },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.application.groupBy({
        by: ["jobRequestId"],
        where: { jobRequest: filter, status: { not: "WITHDRAWN" } },
        _count: { _all: true },
      }),
    ]);
    const countsByJob = new Map(applicationCounts.map(({ jobRequestId, _count }) => [jobRequestId, _count._all]));
    return companies.map((company) => ({
      ...company,
      jobRequests: company.jobRequests.map(({ processRound, interviewRounds, ...job }) => ({
        ...job,
        processLabel: companyProcessLabel(job.processPhase, processRound?.name),
        processRoundId: processRound?.id ?? null,
        rounds: interviewRounds,
        applications: countsByJob.get(job.id) ?? 0,
      })),
    }));
  },

  async companyAnalytics(companyId: string, filter: Prisma.JobRequestWhereInput) {
    const [company, jobs] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
      prisma.jobRequest.findMany({
        where: filter,
        select: {
          id: true,
          jobId: true,
          roleTitle: true,
          openings: true,
          status: true,
          companySheetUrl: true,
          processPhase: true,
          processPhaseAt: true,
          processRound: { select: { id: true, name: true } },
          psmOwner: { select: { id: true, fullName: true } },
          internalProcess: {
            select: {
              stages: { select: { id: true, stage: true, status: true, remarks: true, skipReason: true } },
            },
          },
          recruitmentBatches: {
            select: { id: true, name: true, sequence: true, status: true },
            orderBy: { sequence: "asc" },
          },
          interviewRounds: { select: { id: true, name: true, sequence: true }, orderBy: { sequence: "asc" } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    if (!company || jobs.length === 0) return { company, jobs: [] };

    const jobIds = jobs.map(({ id }) => id);
    const batchIds = jobs.flatMap((job) => job.recruitmentBatches.map(({ id }) => id));
    const [applicationGroups, outcomeGroups, profileGroups, selectionBasisGroups, cohortRows, importBatches] = await Promise.all([
      prisma.application.groupBy({
        by: ["jobRequestId", "recruitmentBatchId", "productId"],
        where: { jobRequestId: { in: jobIds }, status: { not: "WITHDRAWN" } },
        _count: { _all: true },
      }),
      prisma.internalStageCandidate.groupBy({
        by: ["jobRequestId", "stageId", "outcome"],
        where: { jobRequestId: { in: jobIds }, application: { status: { not: "WITHDRAWN" } } },
        _count: { _all: true },
      }),
      prisma.candidateAdditionalProfile.groupBy({
        by: ["jobRequestId", "classification"],
        where: { jobRequestId: { in: jobIds } },
        _count: { _all: true },
      }),
      prisma.internalStageCandidate.groupBy({
        by: ["jobRequestId", "selectionBasis"],
        where: {
          jobRequestId: { in: jobIds },
          selectionBasis: { not: null },
          stage: { stage: "FINAL_SHORTLIST" },
          application: { status: { not: "WITHDRAWN" } },
        },
        _count: { _all: true },
      }),
      // Candidate level detail is needed for category/competency analytics.
      // This remains scoped to each job's imported application cohort.
      prisma.application.findMany({
        where: { jobRequestId: { in: jobIds }, status: { not: "WITHDRAWN" } },
        select: {
          jobRequestId: true,
          recruitmentBatchId: true,
          productId: true,
          candidate: { select: { mobile: true, category: true } },
          stageOutcomes: { select: { outcome: true, stage: { select: { stage: true } } } },
        },
      }),
      prisma.importBatch.findMany({
        where: { recruitmentBatchId: { in: batchIds }, target: "INTERNAL_SCREENING", status: "COMMITTED" },
        select: { id: true, batchCode: true, recruitmentBatchId: true, summary: true, committedAt: true },
        orderBy: { committedAt: "desc" },
      }),
    ]);
    const assessedMobiles = [...new Set(cohortRows.flatMap(({ candidate }) => candidate.mobile ? [candidate.mobile] : []))];
    const poolRecords = assessedMobiles.length
      ? await prisma.assessedPoolRecord.findMany({
        where: { mobile: { in: assessedMobiles } },
        select: { mobile: true, bucketTier: true, tr1Status: true, tr2Status: true, competencyLevel: true, isCompetencyPoolMember: true },
      })
      : [];
    const poolByMobile = new Map(poolRecords.map((record) => [record.mobile, record]));
    const clear = (value: string | null) => value?.trim().toLowerCase() === "clear" || value?.trim().toLowerCase() === "cleared";
    const emptyBreakdown = () => ({ total: 0, intensive: 0, academy: 0, external: 0, inPool: 0, competencyPool: 0, trCleared: 0, buckets: { A: 0, B: 0, C: 0, D: 0 }, competencyLevels: {} as Record<string, number> });
    const stageKeys = ["RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST", "FINAL_SHORTLIST"] as const;
    const emptyStageCounts = () => Object.fromEntries(stageKeys.map((stage) => [stage, {
      selected: 0, rejected: 0, pending: 0, onHold: 0, noShow: 0, withdrawn: 0,
    }])) as Record<(typeof stageKeys)[number], { selected: number; rejected: number; pending: number; onHold: number; noShow: number; withdrawn: number }>;
    const emptyProductCounts = () => ({
      applicants: 0, resumeShortlisted: 0, screeningShortlisted: 0, assignmentShortlisted: 0, finalShortlisted: 0,
      inPool: 0, poolFinalShortlisted: 0,
    });
    const emptyJobBreakdown = () => ({
      applications: emptyBreakdown(),
      shortlisted: emptyBreakdown(),
      resumeShortlisted: emptyBreakdown(),
      screeningShortlisted: emptyBreakdown(),
      assignmentShortlisted: emptyBreakdown(),
      finalShortlisted: emptyBreakdown(),
    });
    const breakdownByJob = new Map<string, ReturnType<typeof emptyJobBreakdown>>();
    const breakdownFor = (jobId: string) => breakdownByJob.get(jobId) ?? (() => {
      const value = emptyJobBreakdown();
      breakdownByJob.set(jobId, value);
      return value;
    })();
    const batchStages = new Map<string, ReturnType<typeof emptyStageCounts>>();
    const batchProducts = new Map<string, Map<string, ReturnType<typeof emptyProductCounts>>>();
    const productStages = new Map<string, ReturnType<typeof emptyProductCounts>>();
    const latestImportByBatch = new Map<string, (typeof importBatches)[number]>();
    for (const batch of importBatches) {
      if (!latestImportByBatch.has(batch.recruitmentBatchId)) latestImportByBatch.set(batch.recruitmentBatchId, batch);
    }
    for (const row of cohortRows) {
      const jobBreakdown = breakdownFor(row.jobRequestId);
      const stagesSelected = new Set(row.stageOutcomes.filter(({ outcome }) => outcome === "SELECTED").map(({ stage }) => stage.stage));
      const pool = row.candidate.mobile ? poolByMobile.get(row.candidate.mobile) : undefined;
      const add = (target: ReturnType<typeof emptyBreakdown>) => {
        target.total++;
        if (row.candidate.category === "ACADEMY_INTENSIVE") target.intensive++;
        if (row.candidate.category === "ACADEMY") target.academy++;
        if (row.candidate.category === "EXTERNAL") target.external++;
        if (pool) target.inPool++;
        if (pool?.isCompetencyPoolMember) target.competencyPool++;
        if (pool && (clear(pool.tr1Status) || clear(pool.tr2Status))) target.trCleared++;
        const tier = pool?.bucketTier?.trim().toUpperCase();
        if (tier === "A" || tier === "B" || tier === "C" || tier === "D") target.buckets[tier]++;
        const level = pool?.competencyLevel?.trim().toUpperCase();
        if (level) target.competencyLevels[level] = (target.competencyLevels[level] ?? 0) + 1;
      };
      add(jobBreakdown.applications);
      // A candidate is shortlisted once in this rollup if selected at any internal stage.
      if (stagesSelected.size > 0) add(jobBreakdown.shortlisted);
      const batchKey = `${row.jobRequestId}:${row.recruitmentBatchId}`;
      const countsForBatch = batchStages.get(batchKey) ?? emptyStageCounts();
      batchStages.set(batchKey, countsForBatch);
      for (const outcome of row.stageOutcomes) {
        const stage = outcome.stage.stage;
        if (!stageKeys.includes(stage as (typeof stageKeys)[number])) continue;
        const counts = countsForBatch[stage as (typeof stageKeys)[number]];
        if (outcome.outcome === "SELECTED") counts.selected++;
        else if (outcome.outcome === "REJECTED") counts.rejected++;
        else if (outcome.outcome === "PENDING") counts.pending++;
        else if (outcome.outcome === "ON_HOLD") counts.onHold++;
        else if (outcome.outcome === "NO_SHOW") counts.noShow++;
        else if (outcome.outcome === "WITHDRAWN") counts.withdrawn++;
        if (outcome.outcome === "SELECTED") {
          const metric = stage === "RESUME_SHORTLIST" ? "resumeShortlisted"
            : stage === "SCREENING_SHORTLIST" ? "screeningShortlisted"
              : stage === "ASSIGNMENT_SHORTLIST" ? "assignmentShortlisted" : "finalShortlisted";
          add(jobBreakdown[metric]);
        }
      }
      if (row.productId) {
        const productKey = `${row.jobRequestId}:${row.productId}`;
        const productCounts = productStages.get(productKey) ?? emptyProductCounts();
        productCounts.applicants++;
        productStages.set(productKey, productCounts);
        const productCountsForBatch = batchProducts.get(batchKey) ?? new Map<string, ReturnType<typeof emptyProductCounts>>();
        const batchProductCounts = productCountsForBatch.get(row.productId) ?? emptyProductCounts();
        batchProductCounts.applicants++;
        if (pool) {
          productCounts.inPool++;
          batchProductCounts.inPool++;
          if (stagesSelected.has("FINAL_SHORTLIST")) {
            productCounts.poolFinalShortlisted++;
            batchProductCounts.poolFinalShortlisted++;
          }
        }
        productCountsForBatch.set(row.productId, batchProductCounts);
        batchProducts.set(batchKey, productCountsForBatch);
        for (const stage of stageKeys) {
          if (!stagesSelected.has(stage)) continue;
          const metric = stage === "RESUME_SHORTLIST" ? "resumeShortlisted"
            : stage === "SCREENING_SHORTLIST" ? "screeningShortlisted"
              : stage === "ASSIGNMENT_SHORTLIST" ? "assignmentShortlisted" : "finalShortlisted";
          productCounts[metric]++;
          batchProductCounts[metric]++;
        }
      }
    }
    const [pipelineGroups, interviewGroups, companyImports] = await Promise.all([prisma.companyNomination.groupBy({
      by: ["jobRequestId", "pipelineStatus"],
      where: { jobRequestId: { in: jobIds }, status: "NOMINATED", application: { status: { not: "WITHDRAWN" } } },
      _count: { _all: true },
    }), prisma.companyInterview.groupBy({
      by: ["roundId", "outcome"],
      where: { jobRequestId: { in: jobIds }, nomination: { status: "NOMINATED", application: { status: { not: "WITHDRAWN" } } } },
      _count: { _all: true },
    }), prisma.importBatch.findMany({
      where: { jobRequestId: { in: jobIds }, target: "COMPANY_PIPELINE", status: "COMMITTED" },
      select: { id: true, jobRequestId: true, batchCode: true, committedAt: true, sourceUrl: true },
      orderBy: { committedAt: "desc" },
    })]);
    const latestCompanyImport = new Map<string, (typeof companyImports)[number]>();
    for (const batch of companyImports) if (!latestCompanyImport.has(batch.jobRequestId)) latestCompanyImport.set(batch.jobRequestId, batch);
    const interviewCounts = new Map(interviewGroups.map((group) => [`${group.roundId}:${group.outcome}`, group._count._all]));
    const pipelineByJob = new Map<string, { status: string; count: number }[]>();
    for (const group of pipelineGroups) {
      (pipelineByJob.get(group.jobRequestId) ?? pipelineByJob.set(group.jobRequestId, []).get(group.jobRequestId)!).push({ status: group.pipelineStatus, count: group._count._all });
    }
    const productIds = [...new Set(applicationGroups.flatMap(({ productId }) => productId ? [productId] : []))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const applicationsByJob = new Map<string, typeof applicationGroups>();
    const applicationsByBatch = new Map<string, typeof applicationGroups>();
    for (const group of applicationGroups) {
      (applicationsByJob.get(group.jobRequestId) ?? applicationsByJob.set(group.jobRequestId, []).get(group.jobRequestId)!).push(group);
      const key = `${group.jobRequestId}:${group.recruitmentBatchId}`;
      (applicationsByBatch.get(key) ?? applicationsByBatch.set(key, []).get(key)!).push(group);
    }
    const outcomesByJobAndStage = new Map<string, typeof outcomeGroups>();
    for (const group of outcomeGroups) {
      const key = `${group.jobRequestId}:${group.stageId}`;
      (outcomesByJobAndStage.get(key) ?? outcomesByJobAndStage.set(key, []).get(key)!).push(group);
    }
    const profilesByJob = new Map<string, typeof profileGroups>();
    for (const group of profileGroups) {
      (profilesByJob.get(group.jobRequestId) ?? profilesByJob.set(group.jobRequestId, []).get(group.jobRequestId)!).push(group);
    }
    const selectionBasisByJob = new Map<string, { selectionBasis: string; count: number }[]>();
    for (const group of selectionBasisGroups) {
      if (!group.selectionBasis) continue;
      (selectionBasisByJob.get(group.jobRequestId) ?? selectionBasisByJob.set(group.jobRequestId, []).get(group.jobRequestId)!).push({
        selectionBasis: group.selectionBasis,
        count: group._count._all,
      });
    }

    return {
      company,
      jobs: jobs.map((job) => {
        const applicationGroupsForJob = applicationsByJob.get(job.id) ?? [];
        const applications = applicationGroupsForJob.reduce((total, group) => total + group._count._all, 0);
        const stages = Object.fromEntries(job.internalProcess?.stages.map((stage) => {
          const outcomes = outcomesByJobAndStage.get(`${job.id}:${stage.id}`) ?? [];
          return [stage.stage, {
            status: stage.status,
            remarks: stage.remarks,
            skipReason: stage.skipReason,
            selected: outcomes.find(({ outcome }) => outcome === "SELECTED")?._count._all ?? 0,
            rejected: outcomes.find(({ outcome }) => outcome === "REJECTED")?._count._all ?? 0,
            pending: outcomes.find(({ outcome }) => outcome === "PENDING")?._count._all ?? 0,
          }];
        }) ?? []);
        const jobProductCounts = new Map<string, number>();
        for (const group of applicationGroupsForJob) {
          if (group.productId) jobProductCounts.set(group.productId, (jobProductCounts.get(group.productId) ?? 0) + group._count._all);
        }
        const productCounts = [...jobProductCounts].flatMap(([productId, applicants]) => {
          const product = productById.get(productId);
          const stageCounts = productStages.get(`${job.id}:${productId}`);
          return product ? [{ ...product, ...(stageCounts ?? { ...emptyProductCounts(), applicants }) }] : [];
        });
        const batches = job.recruitmentBatches.map((batch) => {
          const batchKey = `${job.id}:${batch.id}`;
          const batchImport = latestImportByBatch.get(batch.id);
          const summary = batchImport?.summary;
          const summaryRecord = summary && typeof summary === "object" && !Array.isArray(summary)
            ? summary as Prisma.JsonObject
            : null;
          const applicationSummary = summaryRecord?.applications;
          const applicationRecord = applicationSummary && typeof applicationSummary === "object" && !Array.isArray(applicationSummary)
            ? applicationSummary as Prisma.JsonObject
            : null;
          const numericSummaryValue = (value: Prisma.JsonValue | undefined) => typeof value === "number" ? value : null;
          const batchProductCounts = batchProducts.get(batchKey);
          return {
            ...batch,
            applications: (applicationsByBatch.get(batchKey) ?? []).reduce((total, group) => total + group._count._all, 0),
            stages: batchStages.get(batchKey) ?? emptyStageCounts(),
            products: [...(batchProductCounts ?? [])].flatMap(([productId, counts]) => {
              const product = productById.get(productId);
              return product ? [{ ...product, ...counts }] : [];
            }),
            sourceRows: numericSummaryValue(applicationRecord?.total),
            excludedRows: numericSummaryValue(applicationRecord?.errors),
            importBatchId: batchImport?.id ?? null,
            importBatchCode: batchImport?.batchCode ?? null,
            importedAt: batchImport?.committedAt ?? null,
          };
        });
        return {
          id: job.id,
          jobId: job.jobId,
          roleTitle: job.roleTitle,
          openings: job.openings,
          status: job.status,
          applications,
          breakdown: breakdownByJob.get(job.id) ?? emptyJobBreakdown(),
          stages,
          batches,
          companySheetUrl: job.companySheetUrl,
          psmOwner: job.psmOwner,
          process: {
            phase: job.processPhase,
            label: companyProcessLabel(job.processPhase, job.processRound?.name),
            roundId: job.processRound?.id ?? null,
            updatedAt: job.processPhaseAt,
          },
          companyImport: (() => {
            const batch = latestCompanyImport.get(job.id);
            return batch ? { id: batch.id, batchCode: batch.batchCode, committedAt: batch.committedAt, sourceUrl: batch.sourceUrl } : null;
          })(),
          companyPipeline: pipelineByJob.get(job.id) ?? [],
          companyRounds: job.interviewRounds.map((round) => ({
            id: round.id,
            name: round.name,
            sequence: round.sequence,
            scheduled: interviewCounts.get(`${round.id}:SCHEDULED`) ?? 0,
            cleared: interviewCounts.get(`${round.id}:CLEARED`) ?? 0,
            rejected: interviewCounts.get(`${round.id}:REJECTED`) ?? 0,
            onHold: interviewCounts.get(`${round.id}:ON_HOLD`) ?? 0,
            noShow: interviewCounts.get(`${round.id}:NO_SHOW`) ?? 0,
          })),
          products: productCounts,
          additionalProfiles: (profilesByJob.get(job.id) ?? []).map((group) => ({ classification: group.classification, count: group._count._all })),
          selectionBasisBreakdown: selectionBasisByJob.get(job.id) ?? [],
        };
      }),
    };
  },

  async jobCandidates(
    jobRequestId: string,
    page: number,
    pageSize: number,
    recruitmentBatchId?: string,
    filters: { stage?: DecisionStage; outcome?: StageOutcome | "NONE"; q?: string } = {},
  ) {
    const stageFilter: Prisma.ApplicationWhereInput = !filters.stage ? {}
      : filters.outcome === "NONE"
        ? { stageOutcomes: { none: { stage: { stage: filters.stage } } } }
        : { stageOutcomes: { some: { stage: { stage: filters.stage }, ...(filters.outcome ? { outcome: filters.outcome } : {}) } } };
    const digits = filters.q?.replace(/\D/g, "") ?? "";
    const searchFilter: Prisma.ApplicationWhereInput = !filters.q ? {}
      : {
        candidate: {
          OR: [
            { fullName: { contains: filters.q, mode: "insensitive" } },
            ...(digits.length >= 4 ? [{ mobile: { contains: digits } }] : []),
          ],
        },
      };
    const where: Prisma.ApplicationWhereInput = {
      jobRequestId,
      status: { not: "WITHDRAWN" },
      ...(recruitmentBatchId ? { recruitmentBatchId } : {}),
      ...stageFilter,
      ...searchFilter,
    };
    const [total, applications] = await Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ candidate: { fullName: "asc" } }, { candidateId: "asc" }],
        select: {
          candidateId: true,
          recruitmentBatchId: true,
          jobRequest: companySheetPendingSelect.jobRequest,
          recruitmentBatch: { select: { name: true, importBatches: companySheetPendingSelect.importBatches } },
          product: { select: { name: true, category: true } },
          candidate: {
            select: {
              candidateCode: true,
              fullName: true,
              mobile: true,
              category: true,
              resumeUrl: true,
              skills: { select: { skill: { select: { name: true } } } },
            },
          },
          stageOutcomes: { select: { outcome: true, selectionBasis: true, priority: true, techScore: true, commScore: true, rejectionReason: true, remarks: true, stage: { select: { stage: true } } } },
          nomination: { select: { status: true, pipelineStatus: true } },
          support: { select: { kind: true, status: { select: { label: true, tone: true } }, doneOn: true, otherContributors: true, contributors: { select: { user: { select: { fullName: true } } } } } },
        },
      }),
    ]);
    const mobiles = [...new Set(applications.flatMap(({ candidate }) => candidate.mobile ? [candidate.mobile] : []))];
    const poolRecords = mobiles.length
      ? await prisma.assessedPoolRecord.findMany({
        where: { mobile: { in: mobiles } },
        select: { mobile: true, processType: true, isCompetencyPoolMember: true, competencyLevel: true, category: true, bucketTier: true, tr1Status: true, tr2Status: true, competencyStatus: true },
      })
      : [];
    const poolByMobile = new Map(poolRecords.map(({ mobile, ...record }) => [mobile, record]));
    const candidateIds = applications.map(({ candidateId }) => candidateId);
    const [assessments, profiles] = candidateIds.length === 0
      ? [[], []] as [Awaited<ReturnType<typeof prisma.candidateResumeAssessment.findMany>>, Awaited<ReturnType<typeof prisma.candidateAdditionalProfile.findMany>>]
      : await Promise.all([
        prisma.candidateResumeAssessment.findMany({
          where: { jobRequestId, candidateId: { in: candidateIds }, ...(recruitmentBatchId ? { recruitmentBatchId } : {}) },
          select: { candidateId: true, scores: true, skills: true, projects: true },
        }),
        prisma.candidateAdditionalProfile.findMany({
          where: { jobRequestId, candidateId: { in: candidateIds }, ...(recruitmentBatchId ? { recruitmentBatchId } : {}) },
          select: { candidateId: true, classification: true, sourceSheet: true, data: true },
          orderBy: [{ sourceSheet: "asc" }, { classification: "asc" }],
        }),
      ]);
    const assessmentsByCandidate = new Map(assessments.map((assessment) => [assessment.candidateId, assessment]));
    const profilesByCandidate = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      (profilesByCandidate.get(profile.candidateId) ?? profilesByCandidate.set(profile.candidateId, []).get(profile.candidateId)!).push(profile);
    }
    return {
      page,
      pageSize,
      total,
      items: applications.map(({ candidateId, recruitmentBatchId, recruitmentBatch, jobRequest, product, candidate, stageOutcomes, nomination, support }) => ({
        candidateId,
        recruitmentBatchId,
        recruitmentBatchName: recruitmentBatch.name,
        candidateCode: candidate.candidateCode,
        fullName: candidate.fullName,
        mobile: candidate.mobile,
        category: candidate.category,
        product,
        assessedPool: (candidate.mobile ? poolByMobile.get(candidate.mobile) : undefined) ?? null,
        resumeUrl: candidate.resumeUrl,
        skills: candidate.skills.map(({ skill }) => skill.name),
        resumeAssessment: assessmentsByCandidate.get(candidateId) ?? null,
        additionalProfiles: profilesByCandidate.get(candidateId) ?? [],
        shareStatus: shareStatusOf({ stageOutcomes, nomination, companySheetPending: isCompanySheetPending({ jobRequest, recruitmentBatch }) }),
        pipelineStatus: nomination?.status === "NOMINATED" ? nomination.pipelineStatus : null,
        guidance: supportCell(support.find(({ kind }) => kind === "GUIDANCE")),
        rsa: supportCell(support.find(({ kind }) => kind === "RSA")),
        outcomes: stageOutcomes.map(({ stage, outcome, selectionBasis, priority, techScore, commScore, rejectionReason, remarks }) => ({
          stage: stage.stage,
          outcome,
          selectionBasis,
          priority,
          techScore: techScore === null ? null : Number(techScore),
          commScore: commScore === null ? null : Number(commScore),
          rejectionReason,
          remarks,
        })),
      })),
    };
  },

  /** Placement funnel for the job requests matching the filter, counted from candidate records. */
  async funnel(filter: Prisma.JobRequestWhereInput) {
    const inJobs = { jobRequest: filter };
    const selectedAt = (stage: "RESUME_SHORTLIST" | "SCREENING_SHORTLIST" | "ASSIGNMENT_SHORTLIST" | "FINAL_SHORTLIST") =>
      prisma.internalStageCandidate.count({
        where: { outcome: "SELECTED", stage: { stage }, application: { ...inJobs, status: { not: "WITHDRAWN" } } },
      });
    const [candidates, applications, rs, sc, as, sp, pipeline, assumedShared] = await Promise.all([
      prisma.candidate.count({ where: { applications: { some: { ...inJobs, status: { not: "WITHDRAWN" } } } } }),
      prisma.application.count({ where: { ...inJobs, status: { not: "WITHDRAWN" } } }),
      selectedAt("RESUME_SHORTLIST"),
      selectedAt("SCREENING_SHORTLIST"),
      selectedAt("ASSIGNMENT_SHORTLIST"),
      selectedAt("FINAL_SHORTLIST"),
      prisma.companyNomination.groupBy({ by: ["pipelineStatus"], where: { status: "NOMINATED", application: inJobs }, _count: { _all: true } }),
      // Shared per the job's process status while the company sheet is pending, with no nomination yet.
      prisma.application.count({ where: { ...inJobs, ...assumedSharedWhere, nomination: { is: null } } }),
    ]);
    const count = (...statuses: string[]) => pipeline.filter((row) => statuses.includes(row.pipelineStatus)).reduce((sum, row) => sum + row._count._all, 0);
    return {
      candidates,
      applications,
      resumeShortlisted: rs,
      screeningShortlisted: sc,
      assignmentShortlisted: as,
      finalShortlisted: sp,
      nominated: assumedShared + count("NOT_SUBMITTED", "IN_PROCESS", "ON_HOLD", "REJECTED", "SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED", "DROPPED"),
      inCompanyProcess: count("IN_PROCESS", "ON_HOLD"),
      selected: count("SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
      offersReleased: count("OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
      offersAccepted: count("OFFER_ACCEPTED", "JOINED"),
      joined: count("JOINED"),
    };
  },
};
