import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseHubspotRecordId } from "@placement/shared";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "../../components/form-field";
import { PageHeader } from "../../components/page-header";
import { ErrorState, LoadingRows } from "../../components/states";
import { TagInput } from "../../components/tag-input";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { usePermissions } from "../../hooks/use-permissions";
import { useAuth } from "../../contexts/auth-context";
import { catalogApi, companiesApi, jobRequestsApi, newIdempotencyKey } from "../../services/api";
import type { JobRequestDetail, JobRequestInput, ProductOption } from "../../types/api";
import { CompanyFormDialog } from "../companies/company-form-dialog";
import { CompanyPicker } from "./company-picker";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalUrl = z.string().trim().refine((value) => !value || /^https?:\/\/\S+$/.test(value), "Enter a full link starting with https://");

const schema = z
  .object({
    jobId: z.string().trim().regex(UUID, "Paste the Job ID from HubSpot, e.g. 78e5a531-6ff2-4f04-970a-8162b9fa2a1a."),
    hubspotDeal: z.string().trim().refine((value) => !value || parseHubspotRecordId(value, "deal") !== null, "Paste the HubSpot deal link (…/record/0-3/…) or its numeric ID."),
    company: z.object({ id: z.string(), name: z.string() }, { message: "Choose the company." }).nullable().refine(Boolean, "Choose the company."),
    roleTitle: z.string().trim().min(2, "Enter the role.").max(160),
    techStack: z.array(z.string()).min(1, "Add at least one skill."),
    openings: z.coerce.number().int().min(1, "At least 1."),
    requiredCandidateCount: z.coerce.number().int().min(1, "At least 1."),
    ctcLpa: z.string().trim().refine((value) => !value || (Number(value) > 0 && Number(value) <= 500), "Enter the CTC in LPA, e.g. 4.5."),
    requestDate: z.string().min(1, "Choose the request date."),
    deadline: z.string(),
    timeline: z.string().trim().max(80),
    shortlistingMechanism: z.string().trim().max(500),
    companyRemarks: z.string().trim().max(2000),
    description: z.string().trim().max(10000),
    companySheetUrl: optionalUrl,
    internalSheetUrl: optionalUrl,
    eligibleProductIds: z.array(z.string()),
    psmOwnerId: z.string(),
    status: z.enum(["DRAFT", "OPEN"]),
  })
  .refine((values) => !values.deadline || values.deadline >= values.requestDate, { message: "The deadline cannot be before the request date.", path: ["deadline"] });
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

const CATEGORY_LABELS: Record<ProductOption["category"], string> = {
  ACADEMY: "Academy",
  ACADEMY_INTENSIVE: "Academy Intensive",
  EXTERNAL: "External",
};
const TIMELINES = ["Immediate", "1 Week", "2 Weeks", "1 Month"];
const nullIfBlank = (value: string) => value.trim() || null;

function defaultsFrom(job: JobRequestDetail | undefined, company: { id: string; name: string } | null): FormInput {
  return {
    jobId: job?.jobId ?? "",
    hubspotDeal: job?.hubspotDealId ?? "",
    company: job ? { id: job.company.id, name: job.company.name } : company,
    roleTitle: job?.roleTitle ?? "",
    techStack: job?.skills.map(({ skill }) => skill.name) ?? [],
    openings: job?.openings ?? 1,
    requiredCandidateCount: job?.requiredCandidateCount ?? 5,
    ctcLpa: job?.ctcLpa?.toString() ?? "",
    requestDate: job?.requestDate.slice(0, 10) ?? format(new Date(), "yyyy-MM-dd"),
    deadline: job?.deadline?.slice(0, 10) ?? "",
    timeline: job?.timeline ?? "",
    shortlistingMechanism: job?.shortlistingMechanism ?? "",
    companyRemarks: job?.companyRemarks ?? "",
    description: job?.description ?? "",
    companySheetUrl: job?.companySheetUrl ?? "",
    internalSheetUrl: job?.internalSheetUrl ?? "",
    eligibleProductIds: job?.eligibleProducts.map(({ product }) => product.id) ?? [],
    psmOwnerId: "",
    status: "OPEN",
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

/** Create a job request, or edit one at /job-requests/:id/edit. */
export function JobRequestFormPage() {
  const { jobRequestId } = useParams();
  const editing = Boolean(jobRequestId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canAssign = can("job:assign");
  const [addingCompany, setAddingCompany] = useState(false);
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const existing = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId!), enabled: editing });
  const presetCompanyId = params.get("companyId");
  const presetCompany = useQuery({ queryKey: ["companies", presetCompanyId], queryFn: () => companiesApi.get(presetCompanyId!), enabled: !editing && Boolean(presetCompanyId) });
  const products = useQuery({ queryKey: ["catalog", "products"], queryFn: catalogApi.products, staleTime: 5 * 60_000 });
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: canAssign && !editing });

  const form = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(schema), defaultValues: defaultsFrom(undefined, null) });
  useEffect(() => {
    if (existing.data) form.reset(defaultsFrom(existing.data, null));
  }, [existing.data, form]);
  useEffect(() => {
    if (presetCompany.data) form.setValue("company", { id: presetCompany.data.id, name: presetCompany.data.name });
  }, [presetCompany.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: JobRequestInput = {
        jobId: values.jobId,
        hubspotDeal: nullIfBlank(values.hubspotDeal),
        companyId: values.company!.id,
        roleTitle: values.roleTitle,
        techStack: values.techStack,
        openings: values.openings,
        requiredCandidateCount: values.requiredCandidateCount,
        ctcLpa: values.ctcLpa ? Number(values.ctcLpa) : null,
        description: values.description,
        requestDate: values.requestDate,
        deadline: nullIfBlank(values.deadline),
        timeline: nullIfBlank(values.timeline),
        shortlistingMechanism: nullIfBlank(values.shortlistingMechanism),
        companyRemarks: nullIfBlank(values.companyRemarks),
        companySheetUrl: nullIfBlank(values.companySheetUrl),
        internalSheetUrl: nullIfBlank(values.internalSheetUrl),
        eligibleProductIds: values.eligibleProductIds,
      };
      if (editing) {
        const { companyId: _companyId, ...changes } = input;
        await jobRequestsApi.update(jobRequestId!, changes);
        return jobRequestId!;
      }
      const created = await jobRequestsApi.create(
        { ...input, status: values.status, ...(values.psmOwnerId ? { psmOwnerId: values.psmOwnerId } : {}) },
        idempotencyKey,
      );
      return created.id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["job-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(editing ? "Job request updated" : "Job request created");
      navigate(`/job-requests/${id}`);
    },
  });

  if (editing && existing.isPending) return <Card><LoadingRows rows={8} /></Card>;
  if (editing && existing.error) return <Card><ErrorState error={existing.error} onRetry={() => void existing.refetch()} /></Card>;

  const { errors } = form.formState;
  const productsByCategory = Object.entries(CATEGORY_LABELS).map(([category, label]) => ({
    label,
    items: products.data?.filter((product) => product.category === category) ?? [],
  }));
  const isAdmin = Boolean(user?.roles.includes("ADMIN"));
  const ownerIsRequired = canAssign && !user?.roles.includes("EMPLOYEE") && !isAdmin;

  return (
    <form className="mx-auto max-w-4xl space-y-6" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <Link to={editing ? `/job-requests/${jobRequestId}` : "/job-requests"} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> {editing ? "Back to job request" : "Job requests"}
      </Link>
      <PageHeader
        eyebrow="Job request"
        title={editing ? `Edit ${existing.data?.roleTitle ?? "job request"}` : "New job request"}
        description="Copy the Job ID and deal link from the HubSpot deal. Candidates and sheets are added after the job is created."
      />

      <Section title="HubSpot" description="The Job ID connects this request to its HubSpot deal and to application exports.">
        <FormField id="jobId" label="Job ID" required error={errors.jobId?.message} hint="The UUID generated in HubSpot.">
          <Input id="jobId" className="font-mono" placeholder="78e5a531-6ff2-4f04-970a-8162b9fa2a1a" {...form.register("jobId")} />
        </FormField>
        <FormField id="hubspotDeal" label="HubSpot deal" error={errors.hubspotDeal?.message} hint="Paste the deal link or its record ID.">
          <Input id="hubspotDeal" placeholder="https://app.hubspot.com/contacts/…/record/0-3/…" {...form.register("hubspotDeal")} />
        </FormField>
      </Section>

      <Section title="Role">
        <FormField id="company" label="Company" required error={errors.company?.message} className="sm:col-span-2">
          <Controller
            control={form.control}
            name="company"
            render={({ field }) => (
              editing ? (
                <Input id="company" value={field.value?.name ?? ""} disabled />
              ) : (
                <CompanyPicker
                  id="company"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  onCreate={can("company:write") ? () => setAddingCompany(true) : undefined}
                  invalid={Boolean(errors.company)}
                />
              )
            )}
          />
        </FormField>
        <FormField id="roleTitle" label="Role" required error={errors.roleTitle?.message}>
          <Input id="roleTitle" placeholder="e.g. MERN Developer" {...form.register("roleTitle")} />
        </FormField>
        <FormField id="techStack" label="Tech stack" required error={errors.techStack?.message} hint="Press Enter after each skill.">
          <Controller
            control={form.control}
            name="techStack"
            render={({ field }) => (
              <TagInput id="techStack" value={field.value} onChange={field.onChange} placeholder="React, Node.js…" invalid={Boolean(errors.techStack)} />
            )}
          />
        </FormField>
        <FormField id="openings" label="Openings" required error={errors.openings?.message}>
          <Input id="openings" type="number" min={1} {...form.register("openings")} />
        </FormField>
        <FormField id="requiredCandidateCount" label="Profiles required" required error={errors.requiredCandidateCount?.message} hint="How many profiles the company wants to see.">
          <Input id="requiredCandidateCount" type="number" min={1} {...form.register("requiredCandidateCount")} />
        </FormField>
        <FormField id="ctcLpa" label="CTC (LPA)" error={errors.ctcLpa?.message} hint="Offered CTC in lakhs per year; use the upper figure for a range. Decides the < 8 LPA KPIs.">
          <Input id="ctcLpa" type="number" inputMode="decimal" min={0} step="0.1" placeholder="e.g. 4.5" {...form.register("ctcLpa")} />
        </FormField>
        <FormField id="description" label="Job description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea id="description" rows={4} {...form.register("description")} />
        </FormField>
      </Section>

      <Section title="Timeline">
        <FormField id="requestDate" label="Request date" required error={errors.requestDate?.message}>
          <Input id="requestDate" type="date" {...form.register("requestDate")} />
        </FormField>
        <FormField id="deadline" label="Deadline" error={errors.deadline?.message}>
          <Input id="deadline" type="date" {...form.register("deadline")} />
        </FormField>
        <FormField id="timeline" label="Timeline" error={errors.timeline?.message} hint="How quickly the company needs profiles.">
          <Input id="timeline" list="timeline-options" {...form.register("timeline")} />
          <datalist id="timeline-options">{TIMELINES.map((option) => <option key={option} value={option} />)}</datalist>
        </FormField>
        <FormField id="shortlistingMechanism" label="Proposed shortlisting mechanism" error={errors.shortlistingMechanism?.message}>
          <Input id="shortlistingMechanism" placeholder="e.g. Resume + coding assessment" {...form.register("shortlistingMechanism")} />
        </FormField>
        <FormField id="companyRemarks" label="Company remarks" error={errors.companyRemarks?.message} className="sm:col-span-2">
          <Textarea id="companyRemarks" rows={2} {...form.register("companyRemarks")} />
        </FormField>
      </Section>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-800">Eligible products</h2>
        <p className="mt-0.5 text-xs text-slate-400">Products whose candidates can apply. Leave all unticked if any product can apply.</p>
        <Controller
          control={form.control}
          name="eligibleProductIds"
          render={({ field }) => (
            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              {productsByCategory.map(({ label, items }) => (
                <fieldset key={label}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</legend>
                  <div className="space-y-2">
                    {items.map((product) => {
                      const checked = field.value.includes(product.id);
                      return (
                        <label key={product.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) =>
                              field.onChange(next ? [...field.value, product.id] : field.value.filter((id) => id !== product.id))}
                          />
                          {product.name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        />
      </Card>

      <Section title="Source-of-truth sheets" description="The Internal sheet supplies student and internal-stage details. The Company sheet is used for company-side pipeline updates.">
        <FormField id="internalSheetUrl" label="Internal sheet" error={errors.internalSheetUrl?.message}>
          <Input id="internalSheetUrl" placeholder="https://docs.google.com/spreadsheets/…" {...form.register("internalSheetUrl")} />
        </FormField>
        <FormField id="companySheetUrl" label="Company sheet" error={errors.companySheetUrl?.message}>
          <Input id="companySheetUrl" placeholder="https://docs.google.com/spreadsheets/…" {...form.register("companySheetUrl")} />
        </FormField>
      </Section>

      {!editing && (
        <Section title="Ownership and status">
          {canAssign ? (
            <FormField
              id="psmOwnerId"
              label="Employee owner"
              required={ownerIsRequired}
              error={errors.psmOwnerId?.message}
              hint={isAdmin ? "Leave empty to own this job yourself, or choose an employee." : ownerIsRequired ? undefined : "Leave empty to own it yourself."}
            >
              <Controller
                control={form.control}
                name="psmOwnerId"
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger id="psmOwnerId" className="h-10 w-full"><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                    <SelectContent>
                      {owners.data?.map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>{owner.fullName}{owner.team ? ` · ${owner.team.name}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          ) : (
            <FormField id="owner" label="Employee owner" hint="You will own this job request.">
              <Input id="owner" value={user?.fullName ?? ""} disabled />
            </FormField>
          )}
          <FormField id="status" label="Status" hint="Save as draft if details are still being confirmed.">
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="status" className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        </Section>
      )}

      {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
      <div className="flex justify-end gap-2 pb-6">
        <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Create job request"}</Button>
      </div>

      <CompanyFormDialog
        open={addingCompany}
        onOpenChange={setAddingCompany}
        onSaved={(company) => form.setValue("company", company, { shouldValidate: true })}
      />
    </form>
  );
}
