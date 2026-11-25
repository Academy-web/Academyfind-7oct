"use client";

import React, { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GraduationCap,
  Tag,
  Search,
  Filter,
  Users,
  Send,
  Download,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  Target,
  MessageSquare,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { adminBroadcastToStudents } from "./actions";

interface StudentUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  username: string | null;
  createdAt: Date;
  emailVerified: boolean;
}

interface StudentItem {
  id: string;
  userId: string;
  headline: string | null;
  bio: string | null;
  targetExam: string | null;
  targetYear: number | null;
  currentClass: string | null;
  city: string | null;
  locality: string | null;
  tags: string[];
  isVisible: boolean;
  updatedAt: Date;
  user: StudentUser;
}

interface AdminStudentDirectoryClientProps {
  students: StudentItem[];
  stats: {
    totalStudents: number;
    taggedStudentsCount: number;
    totalPages: number;
    currentPage: number;
  };
  topTags: { name: string; count: number }[];
  availableCities: string[];
  availableExams: string[];
  currentFilters: {
    search: string;
    tag: string;
    city: string;
    exam: string;
  };
}

const PRESET_POPULAR_TAGS = [
  "Guitar Lessons",
  "UPSC CSE",
  "IIT JEE",
  "NEET UG",
  "Coding / Python",
  "Spoken English",
  "Music & Vocals",
  "Classical Dance",
  "Web Development",
  "CAT / MBA",
  "CUET",
  "Commerce & CA",
  "Data Science",
  "Civil Services",
];

export function AdminStudentDirectoryClient({
  students,
  stats,
  topTags,
  availableCities,
  availableExams,
  currentFilters,
}: AdminStudentDirectoryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Local state for search inputs
  const [searchInput, setSearchInput] = useState(currentFilters.search);
  const [selectedTag, setSelectedTag] = useState(currentFilters.tag);
  const [selectedCity, setSelectedCity] = useState(currentFilters.city);
  const [selectedExam, setSelectedExam] = useState(currentFilters.exam);

  // Multi-selection for broadcast and export
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  // Broadcast Modal State
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastActionUrl, setBroadcastActionUrl] = useState("");
  const [isBroadcasting, startBroadcastTransition] = useTransition();
  const [broadcastStatus, setBroadcastStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Apply filters via URL params
  const updateFilter = (updates: Partial<{ search: string; tag: string; city: string; exam: string; page: number }>) => {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = updates.search !== undefined ? updates.search : searchInput;
    const nextTag = updates.tag !== undefined ? updates.tag : selectedTag;
    const nextCity = updates.city !== undefined ? updates.city : selectedCity;
    const nextExam = updates.exam !== undefined ? updates.exam : selectedExam;
    const nextPage = updates.page !== undefined ? updates.page : 1;

    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    else params.delete("search");

    if (nextTag.trim()) params.set("tag", nextTag.trim());
    else params.delete("tag");

    if (nextCity.trim()) params.set("city", nextCity.trim());
    else params.delete("city");

    if (nextExam.trim()) params.set("exam", nextExam.trim());
    else params.delete("exam");

    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");

    router.push(`/af-ass-manage/students?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilter({ search: searchInput, page: 1 });
  };

  const handleTagClick = (tag: string) => {
    const nextTag = selectedTag === tag ? "" : tag;
    setSelectedTag(nextTag);
    updateFilter({ tag: nextTag, page: 1 });
  };

  const clearAllFilters = () => {
    setSearchInput("");
    setSelectedTag("");
    setSelectedCity("");
    setSelectedExam("");
    router.push("/af-ass-manage/students");
  };

  // Select all toggle
  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedUserIds([]);
      setSelectAll(false);
    } else {
      setSelectedUserIds(students.map((s) => s.user.id));
      setSelectAll(true);
    }
  };

  const toggleSelectUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter((id) => id !== userId));
      setSelectAll(false);
    } else {
      const next = [...selectedUserIds, userId];
      setSelectedUserIds(next);
      if (next.length === students.length) setSelectAll(true);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const targets = selectedUserIds.length > 0
      ? students.filter((s) => selectedUserIds.includes(s.user.id))
      : students;

    if (targets.length === 0) {
      alert("No students to export.");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Target Exam", "Year", "City", "Locality", "Tags", "Joined Date"];
    const rows = targets.map((s) => [
      `"${(s.user.name || "Student").replace(/"/g, '""')}"`,
      `"${(s.user.email || "").replace(/"/g, '""')}"`,
      `"${(s.user.phone || "").replace(/"/g, '""')}"`,
      `"${(s.targetExam || "").replace(/"/g, '""')}"`,
      `"${s.targetYear || ""}"`,
      `"${(s.city || "").replace(/"/g, '""')}"`,
      `"${(s.locality || "").replace(/"/g, '""')}"`,
      `"${(s.tags || []).join(", ").replace(/"/g, '""')}"`,
      `"${new Date(s.user.createdAt).toLocaleDateString()}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `students_tagged_${selectedTag || "all"}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Broadcast submit
  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) return;

    const targetUserIds = selectedUserIds.length > 0
      ? selectedUserIds
      : students.map((s) => s.user.id);

    if (targetUserIds.length === 0) {
      setBroadcastStatus({
        type: "error",
        message: "No students available to receive this broadcast.",
      });
      return;
    }

    startBroadcastTransition(async () => {
      setBroadcastStatus(null);
      const res = await adminBroadcastToStudents({
        studentUserIds: targetUserIds,
        title: broadcastTitle,
        message: broadcastMessage,
        actionUrl: broadcastActionUrl.trim() || undefined,
      });

      if (res.success) {
        setBroadcastStatus({
          type: "success",
          message: res.message || "Broadcast successfully transmitted to target students!",
        });
        setTimeout(() => {
          setIsBroadcastOpen(false);
          setBroadcastTitle("");
          setBroadcastMessage("");
          setBroadcastActionUrl("");
          setBroadcastStatus(null);
        }, 1800);
      } else {
        setBroadcastStatus({
          type: "error",
          message: res.error || "Failed to transmit broadcast.",
        });
      }
    });
  };

  const hasActiveFilters = Boolean(
    currentFilters.search || currentFilters.tag || currentFilters.city || currentFilters.exam
  );

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-md shadow-amber-500/20">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-900">
                Student Directory & Tag Search
              </h1>
              <p className="text-sm text-stone-500">
                Target, filter, and message students based on their specific learning interests and goals.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white hover:bg-stone-50 border border-stone-200/80 rounded-xl shadow-xs transition-all active:scale-95"
            title="Download CSV of visible or selected students"
          >
            <Download className="w-3.5 h-3.5 text-stone-500" />
            <span>Export CSV {selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : ""}</span>
          </button>

          <button
            onClick={() => setIsBroadcastOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl shadow-md shadow-amber-500/20 transition-all active:scale-95"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              Broadcast Alert {selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : "(All Visible)"}
            </span>
          </button>
        </div>
      </div>

      {/* ── KPI Stats Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">Total Students</span>
            <Users className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-stone-900">
            {stats.totalStudents.toLocaleString()}
          </div>
          <p className="mt-1 text-[11px] text-stone-500">Profiles created across AcademyFind</p>
        </div>

        <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">Tagged Students</span>
            <Tag className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-stone-900">
            {stats.taggedStudentsCount.toLocaleString()}
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">
            {stats.totalStudents > 0
              ? `${Math.round((stats.taggedStudentsCount / stats.totalStudents) * 100)}% high-intent tagged`
              : "0%"}
          </p>
        </div>

        <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">Top Interest</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-lg font-bold text-stone-900 truncate">
            {topTags[0] ? `${topTags[0].name} (${topTags[0].count})` : "General"}
          </div>
          <p className="mt-1 text-[11px] text-stone-500">Most requested subject / stream</p>
        </div>

        <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">Currently Filtered</span>
            <Filter className="w-4 h-4 text-sky-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-stone-900">
            {students.length}
          </div>
          <p className="mt-1 text-[11px] text-stone-500">Matching active criteria</p>
        </div>
      </div>

      {/* ── Search & Filter Controls ────────────────────────────────────────── */}
      <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          {/* Keyword Search */}
          <form onSubmit={handleSearchSubmit} className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by student name, email, phone, headline, or bio..."
              className="w-full pl-10 pr-4 py-2.5 text-xs bg-stone-50/70 hover:bg-stone-50 focus:bg-white rounded-xl border border-stone-200/80 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900 placeholder:text-stone-400"
            />
          </form>

          {/* Exam Filter */}
          <div className="w-full lg:w-48">
            <select
              value={selectedExam}
              onChange={(e) => {
                setSelectedExam(e.target.value);
                updateFilter({ exam: e.target.value, page: 1 });
              }}
              className="w-full px-3 py-2.5 text-xs bg-stone-50/70 hover:bg-stone-50 focus:bg-white rounded-xl border border-stone-200/80 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-800"
            >
              <option value="">All Exams / Goals</option>
              {availableExams.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>
          </div>

          {/* City Filter */}
          <div className="w-full lg:w-44">
            <select
              value={selectedCity}
              onChange={(e) => {
                setSelectedCity(e.target.value);
                updateFilter({ city: e.target.value, page: 1 });
              }}
              className="w-full px-3 py-2.5 text-xs bg-stone-50/70 hover:bg-stone-50 focus:bg-white rounded-xl border border-stone-200/80 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-800"
            >
              <option value="">All Cities</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-all"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* ── Popular Tags Ribbon (1-Click Tag Filters) ───────────────────── */}
        <div className="pt-2 border-t border-stone-100">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-stone-700">Quick Filter by Student Tag:</span>
            {selectedTag && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                Active: #{selectedTag}
                <button
                  onClick={() => handleTagClick(selectedTag)}
                  className="hover:text-amber-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_POPULAR_TAGS.map((t) => {
              const isSelected = selectedTag.toLowerCase() === t.toLowerCase();
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTagClick(t)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all active:scale-95 ${
                    isSelected
                      ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                      : "bg-white text-stone-600 border-stone-200/80 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50/50"
                  }`}
                >
                  #{t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Selection Action Bar (Appears when items are selected) ─────────────── */}
      {selectedUserIds.length > 0 && (
        <div className="bg-amber-500 text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {selectedUserIds.length} student{selectedUserIds.length > 1 ? "s" : ""} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="text-xs bg-white text-amber-800 font-semibold px-2.5 py-1 rounded-lg hover:bg-amber-50 transition-colors shadow-xs"
            >
              Export Selected
            </button>
            <button
              onClick={() => setIsBroadcastOpen(true)}
              className="text-xs bg-amber-900 text-white font-semibold px-3 py-1 rounded-lg hover:bg-amber-950 transition-colors shadow-xs"
            >
              Broadcast to {selectedUserIds.length}
            </button>
            <button
              onClick={() => setSelectedUserIds([])}
              className="text-xs text-amber-100 hover:text-white underline ml-2"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* ── Students List & Table ───────────────────────────────────────────── */}
      <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-stone-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {students.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-500 mb-3 shadow-inner">
              <Tag className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-stone-900">No students found</h3>
            <p className="text-xs text-stone-500 max-w-sm mx-auto mt-1">
              {hasActiveFilters
                ? "Try clearing some filters or picking another interest tag."
                : "No student profiles exist in the system yet."}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="mt-4 px-4 py-2 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-xl transition-all"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200/80 bg-stone-50/60 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-500/30 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Target Goal / Exam</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Learning Interest Tags</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-xs">
                {students.map((student) => {
                  const isSelected = selectedUserIds.includes(student.user.id);
                  const profileUrl = student.user.username
                    ? `/u/${student.user.username}`
                    : `/user/${student.userId}`;

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors hover:bg-stone-50/80 ${
                        isSelected ? "bg-amber-50/40" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectUser(student.user.id)}
                          className="rounded border-stone-300 text-amber-500 focus:ring-amber-500/30 cursor-pointer"
                        />
                      </td>

                      {/* Student Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="relative w-9 h-9 rounded-full bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                            {student.user.image ? (
                              <Image
                                src={student.user.image}
                                alt={student.user.name || "Student"}
                                fill
                                className="object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-bold text-stone-600 text-xs uppercase">
                                {(student.user.name || "S")[0]}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-stone-900">
                                {student.user.name || "Unnamed Student"}
                              </span>
                              {student.user.emailVerified && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-stone-400 mt-0.5">
                              {student.user.email && (
                                <span className="flex items-center gap-0.5">
                                  <Mail className="w-2.5 h-2.5 text-stone-400" />
                                  {student.user.email}
                                </span>
                              )}
                              {student.user.phone && (
                                <span className="flex items-center gap-0.5 text-stone-500 font-medium">
                                  <Phone className="w-2.5 h-2.5 text-stone-400" />
                                  {student.user.phone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Target Goal / Exam */}
                      <td className="py-3.5 px-4">
                        {student.targetExam ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 text-stone-800 font-semibold text-[11px]">
                              <Target className="w-3 h-3 text-amber-600" />
                              {student.targetExam}
                            </span>
                            {student.targetYear && (
                              <span className="ml-1.5 text-[10px] text-stone-400">
                                ({student.targetYear})
                              </span>
                            )}
                            {student.currentClass && (
                              <div className="text-[10px] text-stone-500 mt-0.5">
                                Class: {student.currentClass}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-stone-400 text-[11px] italic">Not specified</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-4">
                        {student.city ? (
                          <div className="flex items-center gap-1 text-stone-700">
                            <MapPin className="w-3 h-3 text-stone-400 shrink-0" />
                            <span>
                              {student.city}
                              {student.locality ? `, ${student.locality}` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-stone-400 text-[11px] italic">Unknown</span>
                        )}
                      </td>

                      {/* Tags */}
                      <td className="py-3.5 px-4">
                        {student.tags && student.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {student.tags.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => handleTagClick(t)}
                                title={`Filter by #${t}`}
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-all ${
                                  selectedTag.toLowerCase() === t.toLowerCase()
                                    ? "bg-amber-500 text-white border-amber-600"
                                    : "bg-amber-50/80 text-amber-800 border-amber-200/80 hover:bg-amber-100"
                                }`}
                              >
                                #{t}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-stone-400 text-[11px] italic">No tags set</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {student.user.phone && (
                            <a
                              href={`https://wa.me/91${student.user.phone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Message on WhatsApp"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <Link
                            href={profileUrl}
                            target="_blank"
                            title="View Public Profile"
                            className="p-1.5 text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ────────────────────────────────────────────────────── */}
        {stats.totalPages > 1 && (
          <div className="p-4 border-t border-stone-100 flex items-center justify-between text-xs text-stone-600">
            <span>
              Page {stats.currentPage} of {stats.totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={stats.currentPage <= 1}
                onClick={() => updateFilter({ page: stats.currentPage - 1 })}
                className="p-2 border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={stats.currentPage >= stats.totalPages}
                onClick={() => updateFilter({ page: stats.currentPage + 1 })}
                className="p-2 border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Admin Broadcast Modal ───────────────────────────────────────────── */}
      {isBroadcastOpen && (
        <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-stone-100 animate-in fade-in zoom-in-95 duration-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">
                    Broadcast to Tagged Students
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Will send instant in-app alerts and web push notifications
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBroadcastOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-900">
              Target Audience:{" "}
              <strong>
                {selectedUserIds.length > 0
                  ? `${selectedUserIds.length} selected students`
                  : `All ${students.length} currently filtered students`}
              </strong>
              {selectedTag ? ` (Tag: #${selectedTag})` : ""}
            </div>

            <form onSubmit={handleSendBroadcast} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Alert Title
                </label>
                <input
                  type="text"
                  required
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  placeholder="e.g. Special Batch Starting for UPSC Aspirants"
                  className="w-full px-3.5 py-2 text-xs bg-stone-50 focus:bg-white rounded-xl border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Announcement Message
                </label>
                <textarea
                  required
                  rows={4}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder="Share details, free demo class info, or offers relevant to their learning interest..."
                  className="w-full px-3.5 py-2 text-xs bg-stone-50 focus:bg-white rounded-xl border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Target Link (Optional)
                </label>
                <input
                  type="text"
                  value={broadcastActionUrl}
                  onChange={(e) => setBroadcastActionUrl(e.target.value)}
                  placeholder="e.g. /institute/elite-ias-academy or /community/buddies"
                  className="w-full px-3.5 py-2 text-xs bg-stone-50 focus:bg-white rounded-xl border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900"
                />
              </div>

              {broadcastStatus && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    broadcastStatus.type === "success"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : "bg-rose-50 text-rose-800 border border-rose-200"
                  }`}
                >
                  {broadcastStatus.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{broadcastStatus.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBroadcastOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBroadcasting}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl shadow-md shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isBroadcasting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Broadcasting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Alert Now</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
