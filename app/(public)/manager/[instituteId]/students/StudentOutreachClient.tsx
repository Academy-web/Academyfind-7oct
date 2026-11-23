"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  Tag,
  Search,
  MapPin,
  Users,
  Radio,
  Send,
  MessageSquarePlus,
  ExternalLink,
  CheckSquare,
  Square,
  CheckCircle2,
  X,
  Megaphone,
  Loader2,
  GraduationCap,
  ArrowRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  broadcastToStudents,
  createStudentGroupFromTags,
} from "@/lib/manager/studentOutreachActions";
import toast from "react-hot-toast";

interface StudentItem {
  id: string;
  userId: string;
  headline?: string | null;
  bio?: string | null;
  targetExam?: string | null;
  currentClass?: string | null;
  city?: string | null;
  locality?: string | null;
  tags: string[];
  user: {
    id: string;
    name?: string | null;
    username: string;
    image?: string | null;
  };
}

interface StudentOutreachClientProps {
  instituteId: string;
  instituteName: string;
  instituteCity: string;
  students: StudentItem[];
  availableTags: string[];
  currentTag: string;
  currentCity: string;
  currentSearch: string;
  totalCount: number;
}

export function StudentOutreachClient({
  instituteId,
  instituteName,
  instituteCity,
  students,
  availableTags,
  currentTag,
  currentCity,
  currentSearch,
  totalCount,
}: StudentOutreachClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals state
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  // Broadcast form state
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastActionUrl, setBroadcastActionUrl] = useState("");

  // Group form state
  const [groupTitle, setGroupTitle] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupInitialMessage, setGroupInitialMessage] = useState("");

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "ALL") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = (formData.get("q") as string) || "";
    updateParam("q", q.trim());
  };

  const toggleSelectStudent = (userId: string) => {
    if (selectedIds.includes(userId)) {
      setSelectedIds(selectedIds.filter((id) => id !== userId));
    } else {
      setSelectedIds([...selectedIds, userId]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === students.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(students.map((s) => s.userId));
    }
  };

  // Open Broadcast modal with smart defaults
  const handleOpenBroadcast = () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one student to broadcast.");
      return;
    }
    const tagContext = currentTag !== "ALL" ? `for ${currentTag}` : "Special Update";
    setBroadcastTitle(`Exclusive Session ${tagContext}`);
    setBroadcastMessage(
      `Hello! We noticed your interest in ${
        currentTag !== "ALL" ? currentTag : "your learning goals"
      }. ${instituteName} is organizing a special demo session with faculty guidance. Reply or click below to reserve your seat!`
    );
    setBroadcastOpen(true);
  };

  // Open Group modal with smart defaults
  const handleOpenGroup = () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one student to create a group.");
      return;
    }
    const tagLabel = currentTag !== "ALL" ? currentTag : "Learning";
    setGroupTitle(`${instituteName} - ${tagLabel} Cohort`);
    setGroupDescription(
      `Dedicated group hosted by ${instituteName} for students pursuing ${tagLabel}. Discuss topics, share notes, and ask questions directly.`
    );
    setGroupInitialMessage(
      `Welcome to our ${tagLabel} group! Feel free to ask doubts, interact with fellow students, and explore upcoming coaching schedules.`
    );
    setGroupOpen(true);
  };

  // Submit Broadcast
  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      toast.error("Please provide both title and message.");
      return;
    }
    setLoadingAction(true);
    try {
      const res = await broadcastToStudents({
        instituteId,
        studentUserIds: selectedIds,
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        actionUrl: broadcastActionUrl.trim() || undefined,
      });

      if (res.success) {
        toast.success(res.message || "Broadcast sent successfully!");
        setBroadcastOpen(false);
        setSelectedIds([]);
      } else {
        toast.error(res.error || "Failed to send broadcast.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(msg);
    } finally {
      setLoadingAction(false);
    }
  };

  // Submit Group Creation
  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle.trim()) {
      toast.error("Please enter a group title.");
      return;
    }
    setLoadingAction(true);
    try {
      const res = await createStudentGroupFromTags({
        instituteId,
        groupTitle: groupTitle.trim(),
        description: groupDescription.trim() || undefined,
        tag: currentTag !== "ALL" ? currentTag : undefined,
        studentUserIds: selectedIds,
        initialMessage: groupInitialMessage.trim() || undefined,
      });

      if (res.success && res.conversationId) {
        toast.success(res.message || "Group created successfully!");
        setGroupOpen(false);
        setSelectedIds([]);
        router.push(`/chat/${res.conversationId}`);
      } else {
        toast.error(res.error || "Failed to create group.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(msg);
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-amber-600 to-orange-500 p-6 sm:p-8 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-xs font-bold tracking-wider uppercase text-amber-100 mb-3 border border-white/20">
            <Radio className="w-3.5 h-3.5 animate-pulse text-amber-200" />
            Targeted Student Discovery & Outreach
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-tight">
            Find Students By Learning Interests & Broadcast
          </h1>
          <p className="mt-2 text-sm text-amber-100/90 leading-relaxed">
            Filter students interested in <strong>Guitar Lessons</strong>, <strong>UPSC</strong>, <strong>Coding</strong>, or any subject. Instantly broadcast official updates or create dedicated study cohorts to boost admissions.
          </p>
        </div>

        {/* Quick Action Pills in Header */}
        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-white/20">
          <div className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-3.5 py-1.5 rounded-xl text-xs font-semibold">
            <Users className="w-4 h-4 text-amber-200" />
            <span>{totalCount} Matching Students</span>
          </div>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 bg-white text-slate-900 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md animate-in fade-in zoom-in-95">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{selectedIds.length} Selected</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-md p-4 sm:p-5 shadow-xs space-y-4">
        {/* Search & City row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              name="q"
              defaultValue={currentSearch}
              placeholder="Search by student name, tag (e.g. Guitar, UPSC), or locality..."
              className="pl-10 pr-9 h-11 rounded-xl border-slate-200 bg-slate-50 text-sm focus-visible:ring-amber-500"
            />
            {currentSearch && (
              <button
                type="button"
                onClick={() => updateParam("q", "")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>

          {/* City Filter */}
          <div className="relative shrink-0">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-500 pointer-events-none" />
            <select
              value={currentCity}
              onChange={(e) => updateParam("city", e.target.value)}
              className="h-11 pl-9 pr-8 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs cursor-pointer"
            >
              <option value="ALL">All Cities & Pan-India</option>
              {instituteCity && (
                <option value={instituteCity}>Your Hub ({instituteCity})</option>
              )}
              <option value="Kota">Kota</option>
              <option value="Delhi">Delhi / NCR</option>
              <option value="Pune">Pune</option>
              <option value="Bangalore">Bangalore</option>
              <option value="Hyderabad">Hyderabad</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Patna">Patna</option>
              <option value="Lucknow">Lucknow</option>
              <option value="Jaipur">Jaipur</option>
            </select>
          </div>
        </div>

        {/* Tag Filters Scrollable Row */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-amber-500" /> Filter by Student Interest Tag:
            </span>
            {currentTag !== "ALL" && (
              <button
                onClick={() => updateParam("tag", "ALL")}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 underline"
              >
                Clear Tag Filter
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => updateParam("tag", "ALL")}
              className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                currentTag === "ALL"
                  ? "bg-slate-900 text-white font-bold shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"
              }`}
            >
              All Tags
            </button>
            {availableTags.map((tag) => {
              const active = currentTag.toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => updateParam("tag", tag)}
                  className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                    active
                      ? "bg-amber-500 text-white shadow-xs font-bold ring-2 ring-amber-400/40"
                      : "bg-amber-50/70 text-amber-900 border border-amber-200/70 hover:bg-amber-100 hover:border-amber-300"
                  }`}
                >
                  <Tag className="w-3 h-3 text-amber-600" />
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Select All & Actions Bar */}
      {students.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-amber-50/60 rounded-2xl border border-amber-200/60">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              {selectedIds.length === students.length ? (
                <>
                  <CheckSquare className="w-4 h-4 text-amber-600" />
                  Deselect All ({students.length})
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 text-slate-400" />
                  Select All ({students.length})
                </>
              )}
            </button>
            <span className="text-xs text-slate-500 font-medium">
              {selectedIds.length} of {students.length} selected
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <Button
              size="sm"
              onClick={handleOpenBroadcast}
              disabled={selectedIds.length === 0}
              className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs h-9 gap-1.5 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              Broadcast Notification ({selectedIds.length})
            </Button>

            <Button
              size="sm"
              onClick={handleOpenGroup}
              disabled={selectedIds.length === 0}
              variant="outline"
              className="rounded-xl border-amber-300 bg-white hover:bg-amber-50 text-amber-900 font-bold text-xs h-9 gap-1.5"
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-amber-600" />
              Create Cohort Group
            </Button>

            <Button
              size="sm"
              asChild
              variant="ghost"
              className="rounded-xl text-slate-600 hover:text-amber-800 text-xs font-semibold h-9"
            >
              <Link href={`/advertise?tag=${encodeURIComponent(currentTag !== "ALL" ? currentTag : "")}`}>
                <Megaphone className="w-3.5 h-3.5 text-amber-500 mr-1" />
                Targeted Ads
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* Student Cards Grid */}
      {students.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white/70 rounded-3xl border border-dashed border-slate-300">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-3">
            <Users className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            No students found matching this criteria
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Try choosing a different interest tag (e.g. Guitar Lessons, UPSC, Coding) or clear city filters to discover more aspirants.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                updateParam("tag", "ALL");
                updateParam("city", "ALL");
                updateParam("q", "");
              }}
              className="rounded-xl text-xs font-semibold"
            >
              Reset All Filters
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {students.map((student) => {
            const isSelected = selectedIds.includes(student.userId);
            return (
              <div
                key={student.id}
                className={`group relative rounded-2xl border p-5 transition-all duration-300 flex flex-col justify-between ${
                  isSelected
                    ? "border-amber-400 bg-amber-50/40 shadow-md ring-2 ring-amber-400/20"
                    : "border-slate-200/80 bg-white/90 hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5"
                }`}
              >
                <div>
                  {/* Top Bar: Checkbox + Avatar + Name */}
                  <div className="flex items-start gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => toggleSelectStudent(student.userId)}
                      className="mt-1 text-slate-400 hover:text-amber-600 transition-colors shrink-0"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-amber-600" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>

                    <div className="relative w-11 h-11 rounded-full bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                      {student.user.image ? (
                        <Image
                          src={student.user.image}
                          alt={student.user.name || "Student"}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-bold text-slate-500 text-sm">
                          {student.user.name?.charAt(0) || "S"}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <Link
                          href={`/u/${student.user.username}`}
                          target="_blank"
                          className="font-bold text-slate-900 text-sm hover:text-amber-600 truncate flex items-center gap-1 group/name"
                        >
                          <span className="truncate">{student.user.name || "Student"}</span>
                          <ExternalLink className="w-3 h-3 text-slate-400 group-hover/name:text-amber-600 shrink-0" />
                        </Link>
                      </div>
                      <p className="text-xs text-slate-400 font-medium truncate">
                        @{student.user.username}
                      </p>
                    </div>
                  </div>

                  {/* Target Exam & City */}
                  <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                    {student.targetExam && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[11px]">
                        <GraduationCap className="w-3 h-3 text-amber-600" />
                        {student.targetExam}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-slate-500 text-[11px] font-medium">
                      <MapPin className="w-3 h-3 text-rose-500" />
                      {student.city || "Pan-India"}
                    </span>
                  </div>

                  {/* Headline or Bio */}
                  {(student.headline || student.bio) && (
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-3">
                      {student.headline || student.bio}
                    </p>
                  )}

                  {/* Tags */}
                  {student.tags && student.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {student.tags.map((t) => {
                        const isMatch =
                          currentTag !== "ALL" &&
                          t.toLowerCase() === currentTag.toLowerCase();
                        return (
                          <span
                            key={t}
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isMatch
                                ? "bg-amber-500 text-white shadow-2xs ring-1 ring-amber-400"
                                : "bg-amber-50 text-amber-900 border border-amber-200/80"
                            }`}
                          >
                            #{t}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Card Action footer */}
                <div className="pt-3 border-t border-slate-100 mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => toggleSelectStudent(student.userId)}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800"
                  >
                    {isSelected ? "Remove from selection" : "+ Select student"}
                  </button>

                  <Link
                    href={`/chat`}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    Direct Chat <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Modal 1: Broadcast to Selected Students ─── */}
      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Megaphone className="w-5 h-5 text-amber-500" />
              Broadcast to {selectedIds.length} Student{selectedIds.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Send an instant official notification and push alert to all selected students with interest in {currentTag !== "ALL" ? `#${currentTag}` : "your coaching"}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleBroadcastSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Notification Title</Label>
              <Input
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="e.g. 🎸 Free Guitar Workshop this Saturday!"
                maxLength={90}
                required
                className="rounded-xl border-slate-200 text-sm focus-visible:ring-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Broadcast Message</Label>
              <Textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Write your invitation, workshop details, or admission offer..."
                rows={4}
                maxLength={800}
                required
                className="rounded-xl border-slate-200 text-xs focus-visible:ring-amber-500"
              />
              <span className="text-[10px] text-slate-400 block text-right">
                {broadcastMessage.length}/800 characters
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Action Link (Optional)</Label>
              <Input
                value={broadcastActionUrl}
                onChange={(e) => setBroadcastActionUrl(e.target.value)}
                placeholder="e.g. /batchbuy or external registration link"
                className="rounded-xl border-slate-200 text-xs focus-visible:ring-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBroadcastOpen(false)}
                disabled={loadingAction}
                className="rounded-xl text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loadingAction}
                className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs gap-1.5"
              >
                {loadingAction ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Send Broadcast ({selectedIds.length})
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Modal 2: Create Group with Selected Students ─── */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <MessageSquarePlus className="w-5 h-5 text-amber-500" />
              Create Group with {selectedIds.length} Student{selectedIds.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Create a dedicated study group conversation on AcademyFind and add these students so they can ask doubts, get updates, and connect with peers.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleGroupSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Group Title</Label>
              <Input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="e.g. Apex Academy - Guitar Enthusiasts Cohort"
                maxLength={80}
                required
                className="rounded-xl border-slate-200 text-sm focus-visible:ring-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Description (Optional)</Label>
              <Textarea
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="What is this group about? (rules, class schedules, guidance)..."
                rows={2}
                maxLength={300}
                className="rounded-xl border-slate-200 text-xs focus-visible:ring-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">First Welcome Message</Label>
              <Textarea
                value={groupInitialMessage}
                onChange={(e) => setGroupInitialMessage(e.target.value)}
                placeholder="Initial message to be posted in the group chat..."
                rows={2}
                maxLength={500}
                className="rounded-xl border-slate-200 text-xs focus-visible:ring-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGroupOpen(false)}
                disabled={loadingAction}
                className="rounded-xl text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loadingAction}
                className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs gap-1.5"
              >
                {loadingAction ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating Group...
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    Create Group & Open Chat
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
