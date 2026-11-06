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
  Plus,
  Network,
  Search,
  Check,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { createHub, ManagedInstituteOption } from "@/app/(public)/manager/hubs/actions";
import { cn } from "@/lib/utils";

interface CreateHubDialogProps {
  managedInstitutes: ManagedInstituteOption[];
  preselectedInstituteId?: string;
  triggerButton?: React.ReactNode;
}

export function CreateHubDialog({
  managedInstitutes,
  preselectedInstituteId,
  triggerButton,
}: CreateHubDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    preselectedInstituteId ? [preselectedInstituteId] : []
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered institutes based on search
  const filteredInstitutes = (managedInstitutes || []).filter(
    (inst) =>
      inst?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inst?.cityName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleInstitute = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(filteredInstitutes.map((i) => i.id));
  };

  const handleClearAll = () => {
    setSelectedIds([]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for the hub.");
      return;
    }

    if (selectedIds.length < 2) {
      toast.error("Please select at least 2 centers to link them together.");
      return;
    }

    setIsSubmitting(true);
    const result = await createHub({
      name: name.trim(),
      description: description.trim(),
      instituteIds: selectedIds,
    });
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Network Hub created successfully!");
      setOpen(false);
      setName("");
      setDescription("");
      if (!preselectedInstituteId) setSelectedIds([]);
      router.refresh();
    } else {
      toast.error(result.error || "Failed to create hub.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-stone-950 font-bold rounded-2xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center gap-2">
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Create New Hub</span>
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
              <DialogTitle className="text-xl font-black text-stone-900 tracking-tight flex items-center gap-2">
                Create Network Hub
                <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                Group multiple centers under one brand network to show "Visit Our Other Centers" on their public profiles.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-3">
          {/* Hub Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-800 uppercase tracking-wider">
              Hub Network Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Akash Classes Network, Delhi NCR Hub"
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
              placeholder="e.g. All our flagship and suburban branches across India."
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
                  Select Your Centers <span className="text-red-500">*</span>
                </label>
                <p className="text-[11px] text-stone-500">
                  Select 2 or more centers you manage to link them.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-amber-700 hover:text-amber-800 font-semibold transition"
                >
                  Select All
                </button>
                <span className="text-stone-300">•</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-stone-500 hover:text-stone-700 font-medium transition"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Quick search if > 4 institutes */}
            {managedInstitutes && managedInstitutes.length > 4 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3 pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter centers by name or city..."
                  className="pl-9 h-9 text-xs rounded-xl border-stone-200"
                />
              </div>
            )}

            {/* Institute List */}
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 rounded-2xl border border-stone-100 p-2 bg-stone-50/50">
              {filteredInstitutes.length === 0 ? (
                <div className="py-8 text-center text-xs text-stone-500">
                  No managed centers found matching your query.
                </div>
              ) : (
                filteredInstitutes.map((inst) => {
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
                })
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-stone-500 px-1 pt-1">
              <span>
                Selected:{" "}
                <strong className={selectedIds.length >= 2 ? "text-amber-800" : "text-stone-700"}>
                  {selectedIds.length} center{selectedIds.length === 1 ? "" : "s"}
                </strong>
              </span>
              {selectedIds.length < 2 && (
                <span className="text-amber-700 font-medium text-[11px]">
                  (Select at least {2 - selectedIds.length} more)
                </span>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-stone-100">
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
              onClick={handleSubmit}
              className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-stone-950 font-bold rounded-xl shadow-md disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating Hub...
                </>
              ) : (
                "Create Hub & Link Centers"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
