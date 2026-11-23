"use client";

import React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, MapPin, X, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";

const POPULAR_TAG_FILTERS = [
  "ALL",
  "Guitar Lessons",
  "UPSC CSE",
  "IIT JEE",
  "NEET UG",
  "Coding / Python",
  "Spoken English",
  "Classical Dance",
  "Music & Vocals",
  "Robotics & AI",
  "Web Development",
];

const EXAMS = [
  { id: "ALL", label: "All Exams" },
  { id: "JEE", label: "JEE Main & Adv" },
  { id: "NEET", label: "NEET-UG" },
  { id: "UPSC", label: "UPSC CSE" },
  { id: "CAT", label: "CAT / MBA" },
  { id: "GATE", label: "GATE" },
  { id: "CUET", label: "CUET" },
  { id: "CLAT", label: "CLAT / Law" },
  { id: "FOUNDATION", label: "Class 9-10" },
];

const CITIES = [
  "ALL",
  "Kota",
  "Delhi / NCR",
  "Hyderabad",
  "Pune",
  "Bangalore",
  "Mumbai",
  "Jaipur",
  "Patna",
  "Lucknow",
];

export function BuddyFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentExam = searchParams.get("exam") || "ALL";
  const currentCity = searchParams.get("city") || "ALL";
  const currentTag = searchParams.get("tag") || "ALL";
  const currentSearch = searchParams.get("q") || "";

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "ALL") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = formData.get("q") as string;
    updateParam("q", query.trim());
  };

  return (
    <div className="space-y-4">
      {/* Search & City selectors */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            name="q"
            defaultValue={currentSearch}
            placeholder="Search students by name, exam, coaching locality (e.g. Vigyan Nagar, Mukherjee Nagar)..."
            className="pl-10 pr-9 h-11 rounded-full border-slate-200 bg-white text-sm focus-visible:ring-amber-500 shadow-xs"
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

        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-500 pointer-events-none" />
            <select
              value={currentCity}
              onChange={(e) => updateParam("city", e.target.value)}
              className="h-11 pl-9 pr-8 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500 shadow-xs cursor-pointer"
            >
              <option value="ALL">All Hubs & Cities</option>
              {CITIES.filter((c: string) => c !== "ALL").map((c: string) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Exam Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {EXAMS.map((exam: { id: string; label: string }) => {
          const active = currentExam === exam.id;
          return (
            <button
              key={exam.id}
              type="button"
              onClick={() => updateParam("exam", exam.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                active
                  ? "bg-amber-500 text-white shadow-xs font-bold"
                  : "bg-white text-slate-600 border border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 hover:text-amber-800"
              }`}
            >
              {exam.label}
            </button>
          );
        })}
      </div>

      {/* Interest & Coaching Tag Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1">
          <Tag className="w-3 h-3 text-amber-500" />
          Tags:
        </span>
        {POPULAR_TAG_FILTERS.map((tag) => {
          const active = currentTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => updateParam("tag", tag)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                active
                  ? "bg-amber-600 text-white shadow-xs font-bold ring-1 ring-amber-600"
                  : "bg-amber-50/60 text-amber-900 border border-amber-200/70 hover:bg-amber-100 hover:border-amber-300"
              }`}
            >
              {tag === "ALL" ? "All Tags" : `#${tag}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
