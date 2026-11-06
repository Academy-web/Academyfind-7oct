"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  MapPin,
  Pencil,
  Trash2,
  Network,
  Check,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { updateHub, deleteHub, ManagedInstituteOption } from "@/app/(public)/manager/hubs/actions";
import { cn } from "@/lib/utils";

export interface HubDetails {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  memberInstituteIds: string[];
}

interface EditHubDialogProps {
  hub: HubDetails;
  managedInstitutes: ManagedInstituteOption[];
  triggerButton?: React.ReactNode;
}

export function EditHubDialog({
  hub,
  managedInstitutes,
  triggerButton,
}: EditHubDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(hub.name);
  const [description, setDescription] = useState(hub.description || "");
  const [selectedIds, setSelectedIds] = useState<string[]>(hub.memberInstituteIds || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const toggleInstitute = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleUpdate = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for the hub.");
      return;
    }

    if (selectedIds.length < 2) {
      toast.error("Please select at least 2 centers to keep this hub active.");
      return;
    }

    setIsSubmitting(true);
    const result = await updateHub({
      hubId: hub.id,
      name: name.trim(),
      description: description.trim(),
      instituteIds: selectedIds,
    });
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Hub updated successfully!");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error || "Failed to update hub.");
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteHub(hub.id);
    setIsDeleting(false);

    if (result.success) {
      toast.success("Hub deleted successfully.");
      setOpen(false);
      setShowDeleteConfirm(false);
      router.refresh();
    } else {
      toast.error(result.error || "Failed to delete hub.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-stone-200 text-stone-700 hover:text-stone-900 hover:border-amber-400 gap-1.5 text-xs font-semibold"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit Hub</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border-stone-200/80 bg-white shadow-2xl p-6 sm:p-8">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 flex items-center justify-center shrink-0">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-stone-900 tracking-tight">
                Manage Network Hub
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                Update linked branch centers or rename this hub network.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 space-y-3 mt-2">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-red-950">
                  Delete "{hub.name}"?
                </h4>
                <p className="text-xs text-red-800 mt-1 leading-relaxed">
                  This will unlink all centers from this hub. None of the institutes themselves will be deleted, but the "Visit Our Other Centers" network connection will be removed.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-xl border-stone-200"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isDeleting}
                onClick={handleDelete}
                className="rounded-xl font-bold bg-red-600 hover:bg-red-700"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Deleting...
                  </>
                ) : (
                  "Confirm Delete Hub"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 mt-3">
            {/* Hub Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Hub Network Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hub Name"
                maxLength={100}
                className="rounded-xl border-stone-200 focus:border-amber-400 focus:ring-amber-400/20 text-sm h-11"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Description <span className="text-stone-400 font-normal lowercase">(optional)</span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this branch network"
                rows={2}
                maxLength={300}
                className="rounded-xl border-stone-200 focus:border-amber-400 focus:ring-amber-400/20 text-sm resize-none"
              />
            </div>

            {/* Center Selection */}
            <div className="space-y-2 pt-2 border-t border-stone-100">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                    Linked Centers <span className="text-red-500">*</span>
                  </label>
                  <p className="text-[11px] text-stone-500">
                    Select which of your managed centers belong to this hub.
                  </p>
                </div>
                <span className="text-xs font-bold text-stone-700">
                  {selectedIds.length} center{selectedIds.length === 1 ? "" : "s"} selected
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-2 pr-1 rounded-2xl border border-stone-100 p-2 bg-stone-50/50">
                {(managedInstitutes || []).map((inst) => {
                  const isSelected = selectedIds.includes(inst.id);
                  const displayImg = inst.imageUrl || inst.logo;

                  return (
                    <div
                      key={inst.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleInstitute(inst.id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          toggleInstitute(inst.id);
                        }
                      }}
                      className={cn(
                        "flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none",
                        isSelected
                          ? "bg-amber-500/10 border-amber-300 shadow-xs"
                          : "bg-white border-stone-200/80 hover:border-stone-300"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Custom styled checkbox indicator */}
                        <div
                          className={cn(
                            "w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors shrink-0",
                            isSelected
                              ? "bg-amber-500 border-amber-500 text-stone-950"
                              : "border-stone-300 bg-white"
                          )}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        {/* Image / Icon */}
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0 relative flex items-center justify-center">
                          {displayImg ? (
                            <img
                              src={displayImg}
                              alt={inst.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <Building2 className="w-4 h-4 text-stone-400" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs font-bold text-stone-900 truncate">
                            {inst.name}
                          </p>
                          <p className="text-[10px] text-stone-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-2.5 h-2.5 text-stone-400" />
                            {inst.cityName}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1 border border-amber-200">
                          <CheckCircle2 className="w-3 h-3 text-amber-700" /> Linked
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-stone-100">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs font-semibold gap-1.5 h-9 rounded-xl self-start sm:self-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Hub
              </Button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border-stone-200"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting || selectedIds.length < 2}
                  onClick={handleUpdate}
                  className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-stone-950 font-bold rounded-xl shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
