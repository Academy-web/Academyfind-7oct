"use client";

import React, { useState } from "react";
import { Tag, Plus, X, Sparkles } from "lucide-react";

interface StudentTagInputProps {
  initialTags?: string[];
  name?: string;
  categorySuggestions?: string[];
}

export const POPULAR_STUDENT_TAGS = [
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
  "Foundation (9th-10th)",
  "Commerce & CA",
  "Drawing & Fine Arts",
  "Civil Services",
  "Data Science",
  "Robotics & AI",
  "Yoga & Fitness",
];

export function StudentTagInput({
  initialTags = [],
  name = "tags",
  categorySuggestions = [],
}: StudentTagInputProps) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [inputVal, setInputVal] = useState("");

  const allAvailableSuggestions = Array.from(
    new Set([...categorySuggestions, ...POPULAR_STUDENT_TAGS])
  );

  const addTag = (rawTag: string) => {
    const cleaned = rawTag.trim().replace(/^#+/, "");
    if (!cleaned) return;
    if (tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setInputVal("");
      return;
    }
    if (tags.length >= 15) return;
    setTags([...tags, cleaned]);
    setInputVal("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputVal);
    } else if (e.key === "Backspace" && !inputVal && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Tag className="w-4 h-4 text-amber-500" />
          Learning Interests & Coaching Tags
        </label>
        <span className="text-xs text-slate-400 font-medium">
          {tags.length}/15 tags
        </span>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Tag your subjects and hobbies (e.g. Guitar Lessons, UPSC, Python, Dance) so institutes and tutors can send you relevant updates, demo invitations, and targeted offers.
      </p>

      {/* Hidden input for server action form submission */}
      <input type="hidden" name={name} value={tags.join(", ")} />

      {/* Tag input container */}
      <div className="min-h-[48px] p-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-amber-500/30 focus-within:border-amber-500 transition-all flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold px-2.5 py-1 rounded-full shadow-2xs hover:bg-amber-100/60 transition-colors animate-in fade-in zoom-in-95 duration-150"
          >
            <Tag className="w-3 h-3 text-amber-600 shrink-0" />
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="w-4 h-4 rounded-full flex items-center justify-center text-amber-700/70 hover:text-amber-900 hover:bg-amber-200/60 transition-colors"
              aria-label={`Remove ${tag}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        <div className="flex-1 min-w-[140px] flex items-center gap-1">
          <input
            type="text"
            list="student-tags-input-datalist"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              tags.length === 0
                ? "Type a category or tag (e.g. Guitar, UPSC) and press Enter..."
                : "Add another category / tag..."
            }
            className="w-full bg-transparent border-none outline-none text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 px-1 py-1"
          />
          <datalist id="student-tags-input-datalist">
            {allAvailableSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {inputVal.trim() && (
            <button
              type="button"
              onClick={() => addTag(inputVal)}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
      </div>

      {/* Quick Suggestions from Categories */}
      <div className="pt-1">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3 h-3 text-amber-500" />
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Popular Coaching Categories & Interests
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allAvailableSuggestions.slice(0, 16).map((preset) => {
            const isSelected = tags.some(
              (t) => t.toLowerCase() === preset.toLowerCase()
            );
            return (
              <button
                key={preset}
                type="button"
                disabled={isSelected}
                onClick={() => addTag(preset)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                  isSelected
                    ? "bg-slate-100 text-slate-400 border-slate-200/60 cursor-not-allowed opacity-60"
                    : "bg-white text-slate-700 border-slate-200/80 hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-900 shadow-2xs hover:scale-[1.02] active:scale-95"
                }`}
              >
                {!isSelected && <Plus className="w-2.5 h-2.5 text-slate-400" />}
                {preset}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
