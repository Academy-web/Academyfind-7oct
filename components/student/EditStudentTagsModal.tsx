"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Tag,
  Plus,
  X,
  Check,
  Loader2,
  GraduationCap,
  Pencil,
  Search,
  FolderTree,
} from "lucide-react";
import { saveStudentTags, getPlatformCategoriesForTags } from "@/lib/student/tagActions";
import { POPULAR_STUDENT_TAGS } from "./StudentTagInput";
import toast from "react-hot-toast";

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface EditStudentTagsModalProps {
  initialTags?: string[];
  initialCategories?: CategoryOption[];
  triggerStyle?: "pill" | "button" | "banner";
  className?: string;
}

export function EditStudentTagsModal({
  initialTags = [],
  initialCategories = [],
  triggerStyle = "button",
  className = "",
}: EditStudentTagsModalProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [inputVal, setInputVal] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>(initialCategories);
  const [categorySearch, setCategorySearch] = useState("");
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Load categories when opening modal
  const handleOpenModal = () => {
    setIsOpen(true);
    if (categories.length === 0) {
      setIsLoadingCategories(true);
      getPlatformCategoriesForTags()
        .then((cats) => {
          if (cats && cats.length > 0) setCategories(cats);
        })
        .catch((err) => console.error("Error loading categories:", err))
        .finally(() => setIsLoadingCategories(false));
    }
  };

  const addTag = (rawTag: string) => {
    const cleaned = rawTag.trim().replace(/^#+/, "");
    if (!cleaned) return;
    if (tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setInputVal("");
      return;
    }
    if (tags.length >= 20) {
      toast.error("You can add up to 20 interest tags.");
      return;
    }
    setTags([...tags, cleaned]);
    setInputVal("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t.toLowerCase() !== tagToRemove.toLowerCase()));
  };

  const toggleTag = (tagName: string) => {
    const exists = tags.some((t) => t.toLowerCase() === tagName.toLowerCase());
    if (exists) {
      removeTag(tagName);
    } else {
      addTag(tagName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputVal);
    }
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveStudentTags(tags);
      if (res.success) {
        toast.success("Learning tags updated successfully! ✓");
        setIsOpen(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update tags.");
      }
    });
  };

  // Combine platform categories with popular tags fallback
  const allCategoryNames = Array.from(
    new Set([
      ...categories.map((c) => c.name),
      ...POPULAR_STUDENT_TAGS,
    ])
  );

  const filteredCategories = allCategoryNames.filter((cat) =>
    cat.toLowerCase().includes(categorySearch.toLowerCase().trim())
  );

  return (
    <>
      {/* ── Trigger element ───────────────────────────────────────────────── */}
      {triggerStyle === "pill" && (
        <button
          type="button"
          onClick={handleOpenModal}
          className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 text-xs font-semibold px-2.5 py-1 border border-amber-300/60 transition-all hover:scale-102 active:scale-95 ${className}`}
        >
          <Tag className="w-3 h-3 text-amber-600" />
          <span>{tags.length > 0 ? "Edit Tags" : "+ Add Tags"}</span>
        </button>
      )}

      {triggerStyle === "button" && (
        <button
          type="button"
          onClick={handleOpenModal}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold shadow-xs hover:bg-amber-100/80 transition-all active:scale-95 ${className}`}
        >
          <Pencil className="w-3 h-3 text-amber-700" />
          <span>{tags.length > 0 ? "Manage Learning Tags" : "Add Learning Tags"}</span>
        </button>
      )}

      {triggerStyle === "banner" && (
        <div
          onClick={handleOpenModal}
          className={`group cursor-pointer rounded-2xl border border-dashed border-amber-300 bg-gradient-to-br from-amber-50/90 via-white to-amber-50/50 p-5 transition-all hover:border-amber-400 hover:shadow-md ${className}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm shadow-amber-500/20 group-hover:scale-105 transition-transform">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-stone-900 group-hover:text-amber-700 transition-colors">
                  Add Categories as Your Learning Tags
                </h4>
                <p className="text-xs text-stone-600 mt-0.5 max-w-md">
                  Select coaching categories (e.g. UPSC CSE, Guitar Lessons, IIT JEE, Coding) so coachings can connect with you and recommend relevant courses!
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-amber-500 rounded-xl shadow-xs group-hover:bg-amber-600 transition-colors shrink-0">
              <Plus className="w-3.5 h-3.5" />
              <span>Select Categories & Tags</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Modal Dialog ─────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-stone-200/80 animate-in fade-in zoom-in-95 duration-200 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-sm shadow-amber-500/20">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">
                    Add Categories as Interest Tags
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Select coaching categories or custom subjects you are learning.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Current Active Tags Display */}
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                Your Selected Tags ({tags.length}/20)
              </label>
              {tags.length === 0 ? (
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-3 text-center text-xs text-amber-800 font-medium">
                  No tags added yet. Pick from the coaching categories below or type a custom tag.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 p-3 bg-stone-50/60 border border-stone-200/80 rounded-2xl min-h-[52px]">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-xs"
                    >
                      <Tag className="w-3 h-3 opacity-80" />
                      #{tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:bg-amber-700/60 rounded-full p-0.5 ml-0.5 transition-colors"
                        title="Remove tag"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Browse & Select from Platform Categories */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5 text-amber-600" />
                  Select from Coaching Categories
                </span>
                {isLoadingCategories && (
                  <span className="text-[10px] text-stone-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading categories...
                  </span>
                )}
              </div>

              {/* Category Search Filter */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Search categories (e.g. UPSC, Guitar, NEET, Coding)..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-stone-50 focus:bg-white rounded-xl border border-stone-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900 placeholder:text-stone-400"
                />
              </div>

              {/* Categories Pills Grid */}
              <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1.5 bg-stone-50/50 rounded-xl border border-stone-100">
                {filteredCategories.length === 0 ? (
                  <p className="text-xs text-stone-400 py-2 text-center w-full">
                    No matching categories found. You can add it as a custom tag below!
                  </p>
                ) : (
                  filteredCategories.map((catName) => {
                    const isSelected = tags.some(
                      (t) => t.toLowerCase() === catName.toLowerCase()
                    );
                    return (
                      <button
                        key={catName}
                        type="button"
                        onClick={() => toggleTag(catName)}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all active:scale-95 ${
                          isSelected
                            ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                            : "bg-white text-stone-700 border-stone-200 hover:border-amber-400 hover:text-amber-800 hover:bg-amber-50/60"
                        }`}
                      >
                        {isSelected ? (
                          <span className="flex items-center gap-1">
                            <Check className="w-3 h-3 text-white" />
                            #{catName}
                          </span>
                        ) : (
                          `+ #${catName}`
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Custom Tag Input */}
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                Or Add Custom Tag
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 font-bold text-xs">
                    #
                  </span>
                  <input
                    type="text"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type custom skill, instrument, or topic..."
                    className="w-full pl-8 pr-4 py-2 text-xs bg-stone-50 focus:bg-white rounded-xl border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all text-stone-900 placeholder:text-stone-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => addTag(inputVal)}
                  disabled={!inputVal.trim()}
                  className="px-3.5 py-2 text-xs font-semibold text-stone-800 bg-stone-100 hover:bg-stone-200 disabled:opacity-40 disabled:hover:bg-stone-100 rounded-xl transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl shadow-md shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Tags...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Learning Tags</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
