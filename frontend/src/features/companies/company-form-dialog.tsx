import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseHubspotRecordId } from "@placement/shared";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "../../components/form-field";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { companiesApi, newIdempotencyKey } from "../../services/api";
import type { CompanyDetail } from "../../types/api";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the company name.").max(160),
  hubspotCompany: z
    .string()
    .trim()
    .refine((value) => !value || parseHubspotRecordId(value, "company") !== null, "Paste a HubSpot company link (…/record/0-2/…) or its numeric ID."),
  website: z.string().trim().refine((value) => !value || /^https?:\/\/\S+$/.test(value), "Enter a full link starting with https://"),
  industry: z.string().trim().max(120),
  location: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});
type FormValues = z.infer<typeof schema>;

const blankToNull = (value: string) => value || null;

/** Create a company, or edit one when `company` is given. */
export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: CompanyDetail;
  onSaved?: (company: { id: string; name: string }) => void;
}) {
  const queryClient = useQueryClient();
  // One key per opening of the dialog, so a double submit is not saved twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [open]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) {
      form.reset({
        name: company?.name ?? "",
        hubspotCompany: company?.hubspotCompanyId ?? "",
        website: company?.website ?? "",
        industry: company?.industry ?? "",
        location: company?.location ?? "",
        notes: company?.notes ?? "",
      });
    }
  }, [open, company, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const input = {
        name: values.name,
        hubspotCompany: blankToNull(values.hubspotCompany),
        website: blankToNull(values.website),
        industry: blankToNull(values.industry),
        location: blankToNull(values.location),
        notes: blankToNull(values.notes),
      };
      if (company) {
        await companiesApi.update(company.id, input);
        return { id: company.id, name: input.name };
      }
      return companiesApi.create(input, idempotencyKey);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(company ? "Company updated" : "Company added");
      onSaved?.(saved);
      onOpenChange(false);
    },
  });

  const { errors } = form.formState;
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{company ? "Edit company" : "Add company"}</DialogTitle>
          <DialogDescription>
            Enter the details from HubSpot. The HubSpot ID keeps the same company from being added twice.
          </DialogDescription>
        </DialogHeader>
        <form id="company-form" className="grid gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <FormField id="company-name" label="Company name" required error={errors.name?.message}>
            <Input id="company-name" autoFocus {...form.register("name")} />
          </FormField>
          <FormField
            id="company-hubspot"
            label="HubSpot company"
            hint="Paste the company's HubSpot link or its record ID."
            error={errors.hubspotCompany?.message}
          >
            <Input id="company-hubspot" placeholder="https://app.hubspot.com/contacts/…/record/0-2/…" {...form.register("hubspotCompany")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="company-industry" label="Industry" error={errors.industry?.message}>
              <Input id="company-industry" {...form.register("industry")} />
            </FormField>
            <FormField id="company-location" label="Location" error={errors.location?.message}>
              <Input id="company-location" {...form.register("location")} />
            </FormField>
          </div>
          <FormField id="company-website" label="Website" error={errors.website?.message}>
            <Input id="company-website" placeholder="https://" {...form.register("website")} />
          </FormField>
          <FormField id="company-notes" label="Notes" error={errors.notes?.message}>
            <Textarea id="company-notes" rows={3} {...form.register("notes")} />
          </FormField>
          {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="company-form" disabled={save.isPending}>
            {save.isPending ? "Saving…" : company ? "Save changes" : "Add company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
